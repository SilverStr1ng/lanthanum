/*global window*/
import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { serve } from "../webgpuBaseline/server.js";
import { png } from "../webgpuBaseline/imageMetrics.js";
import { verifyManifest } from "../webgpuBaseline/manifest.js";
import { checkDemo } from "./demo.js";

const output = path.resolve(
  process.argv.find((v) => v.startsWith("--output="))?.slice(9) ??
    `benchmarks/runs/webgpu-${Date.now()}`,
);
await mkdir(output, { recursive: false });
const { server, url } = await serve();
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=d3d11"],
});
const errors = [];
const requests = [];
try {
  const page = await browser.newPage({
    viewport: { width: 960, height: 540 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      errors.push(`HTTP ${response.status()}: ${response.url()}`);
    }
  });
  page.on("request", (request) =>
    requests.push(request.url().replace(url, "")),
  );
  page.on("console", (m) => {
    if (m.type() === "error") {
      errors.push(m.text());
    }
  });
  await page.route("**/*", (route) =>
    route.request().url().startsWith(url) ||
    /^(data|blob):/.test(route.request().url())
      ? route.continue()
      : route.abort(),
  );
  await page.goto(`${url}/Specs/WebGPU/index.html`);
  await page.waitForFunction(
    () => window.results?.done,
    {},
    { timeout: 120000 },
  );
  const result = await page.evaluate(() => window.results);
  const capture = await page.evaluate(() => window.captureBase64);
  result.browser = browser.version();
  result.date = new Date().toISOString();
  result.node = process.version;
  result.fixtureManifestSha256 = (await verifyManifest()).sha256;
  result.buildSha256 = createHash("sha256")
    .update(await readFile("Build/CesiumUnminified/Cesium.js"))
    .digest("hex");
  result.commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  result.workingTree = execFileSync("git", ["status", "--short"], {
    encoding: "utf8",
  }).trim();
  if (capture) {
    await writeFile(
      path.join(output, "frame.png"),
      png(...result.captureSize, Buffer.from(capture, "base64")),
    );
  } else {
    await page.screenshot({ path: path.join(output, "failure.png") });
  }
  if (result.passed) {
    try {
      result.demoChecks = await checkDemo(page, url, output);
    } catch (error) {
      result.passed = false;
      result.demoError = String(error.stack);
      await page.screenshot({ path: path.join(output, "demo-failure.png") });
    }
  }
  result.consoleErrors = errors;
  result.requests = requests;
  result.passed &&= errors.length === 0;
  await writeFile(
    path.join(output, "result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
