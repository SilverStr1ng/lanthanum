/*global window*/
import { chromium } from "@playwright/test";
import { writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { serve, root } from "./server.js";
import { sceneIds, verifyManifest } from "./manifest.js";
import { compareImages, percentiles, png } from "./imageMetrics.js";
import { prepareOutputDirectory } from "./evidence.js";

const value = (flag, fallback) =>
  process.argv
    .find((argument) => argument.startsWith(`${flag}=`))
    ?.slice(flag.length + 1) ?? fallback;
const selected = value("--scenes", sceneIds.join(",")).split(",");
if (selected.some((id) => !sceneIds.includes(id))) {
  throw new Error("Unknown scene ID");
}
const repeats = Number(value("--repeats", "3"));
if (!Number.isInteger(repeats) || repeats < 1) {
  throw new Error("repeats must be a positive integer");
}
const performanceRun = process.argv.includes("--performance");
const output = path.resolve(
  root,
  value(
    "--output",
    `benchmarks/runs/${new Date().toISOString().replaceAll(/[:.]/g, "-")}`,
  ),
);
const comparisonPath = value("--compare", undefined);
await prepareOutputDirectory(output, comparisonPath);
const fixture = await verifyManifest();
if (comparisonPath) {
  const previous = JSON.parse(
    await readFile(path.resolve(comparisonPath, "summary.json"), "utf8"),
  );
  if (previous.fixtureManifestSha256 !== fixture.sha256) {
    throw new Error(
      "Comparison fixture/harness identity differs; review the contract before comparing",
    );
  }
}
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const summary = {
  schemaVersion: 1,
  date: new Date().toISOString(),
  commit: git("rev-parse", "HEAD"),
  workingTree: git("status", "--short"),
  fixtureManifestSha256: fixture.sha256,
  node: process.version,
  os: {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpu: os.cpus()[0].model,
  },
  browserChannel: value("--channel", "chrome"),
  performanceRun,
  mode: "WebGL2 baseline; not WebGPU certification",
  runs: [],
  passed: true,
};
summary.buildSha256 = createHash("sha256")
  .update(await readFile(path.join(root, "Build/CesiumUnminified/Cesium.js")))
  .digest("hex");
summary.lockSha256 = createHash("sha256")
  .update(await readFile(path.join(root, "package-lock.json")))
  .digest("hex");
const { server, url } = await serve();
let browser;
try {
  browser = await chromium.launch({
    channel: summary.browserChannel,
    headless: true,
    args: ["--use-angle=d3d11"],
  });
  summary.browserVersion = browser.version();
  const cdp = await browser.newBrowserCDPSession();
  summary.systemInfo = await cdp.send("SystemInfo.getInfo");
  await cdp.detach();
  for (const id of selected) {
    let reference;
    for (let iteration = 1; iteration <= repeats; iteration++) {
      const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
        serviceWorkers: "block",
      });
      const page = await context.newPage();
      const errors = [],
        requests = [],
        external = [];
      await context.route("**/*", (route) => {
        const requestUrl = route.request().url();
        if (
          requestUrl.startsWith(`${url}/`) ||
          requestUrl.startsWith("data:") ||
          requestUrl.startsWith("blob:")
        ) {
          return route.continue();
        }
        external.push(requestUrl);
        return route.abort("blockedbyclient");
      });
      page.on("pageerror", (error) => errors.push(String(error.stack)));
      page.on("console", (message) => {
        if (message.type() === "error") {
          errors.push(message.text());
        }
      });
      page.on("response", (response) => {
        if (response.status() >= 400) {
          errors.push(`HTTP ${response.status()}: ${response.url()}`);
        }
      });
      page.on("requestfinished", (request) =>
        requests.push(request.url().replace(url, "")),
      );
      const name = `${id}-${iteration}`;
      try {
        const started = Date.now();
        await page.goto(`${url}/Specs/Baseline/index.html?scene=${id}`);
        await page.waitForFunction(
          () => window.baseline?.ready || window.baseline?.failure,
          {},
          { timeout: 120000 },
        );
        const initial = await page.evaluate(() => window.baseline.report());
        if (initial.failure || !initial.ready) {
          throw new Error(initial.failure ?? "Scene never ready");
        }
        if (!initial.gpu.hardwareVerified) {
          throw new Error(
            `Hardware renderer not established: ${initial.gpu.renderer}`,
          );
        }
        const readyMs = Date.now() - started;
        const raw = Buffer.from(
          await page.evaluate(() => window.baseline.capture()),
          "base64",
        );
        let nonBlack = 0;
        for (let i = 0; i < raw.length; i += 4) {
          nonBlack += Number(raw[i] + raw[i + 1] + raw[i + 2] > 15);
        }
        if (nonBlack < 1000) {
          throw new Error(`Blank or nearly blank frame (${nonBlack} pixels)`);
        }
        await writeFile(
          path.join(output, `${name}.png`),
          png(1920, 1080, raw, true),
        );
        await writeFile(path.join(output, `${name}.rgba.gz`), gzipSync(raw));
        if (!reference) {
          reference = raw;
        }
        const compared = comparisonPath
          ? gunzipSync(
              await readFile(path.resolve(comparisonPath, `${id}-1.rgba.gz`)),
            )
          : reference;
        const { diff, ...metrics } = compareImages(compared, raw, 1920, 1080);
        await writeFile(
          path.join(output, `${name}-diff.png`),
          png(1920, 1080, diff, true),
        );
        const imagePassed =
          metrics.ssim >= 0.98 &&
          metrics.significantFraction <= 0.01 &&
          (id !== "T00" || metrics.withinThreeFraction >= 0.995);
        if (performanceRun && id === "T08") {
          await page.evaluate(() => window.baseline.startMeasurement(true));
          await page.waitForTimeout(30000);
          await page.evaluate(() => window.baseline.startMeasurement(true));
          // Two bounded waits keep the process responsive to cancellation.
          await page.waitForTimeout(60000);
          await page.waitForTimeout(60000);
        } else {
          await page.evaluate(() => window.baseline.startMeasurement());
          await page.waitForTimeout(1500);
        }
        await page.evaluate(() => window.baseline.stopMeasurement());
        const report = await page.evaluate(() => window.baseline.report());
        const destroyed = await page.evaluate(() => window.baseline.destroy());
        const resourcesReleased = Object.values(destroyed.resources.live).every(
          (count) => count === 0,
        );
        const result = {
          ...report,
          readyMs,
          image: metrics,
          imagePassed,
          resourcesReleased,
          destroyed,
          nonBlack,
          timing: {
            raf: percentiles(report.counters.raf),
            renderCpu: percentiles(report.counters.renderCpu),
            gpu: null,
            label:
              performanceRun && id === "T08"
                ? "30s warmup + 120s trajectory"
                : "1.5s smoke; not performance acceptance",
          },
          errors,
          external,
          requests,
          passed:
            imagePassed &&
            resourcesReleased &&
            !report.failure &&
            !report.errors.length &&
            !errors.length &&
            !external.length,
        };
        await writeFile(
          path.join(output, `${name}.json`),
          `${JSON.stringify(result, null, 2)}\n`,
        );
        summary.runs.push({
          id,
          iteration,
          passed: result.passed,
          readyMs,
          image: metrics,
          timing: result.timing,
          resourcesReleased,
          gpu: report.gpu,
          tiles: report.tiles,
          result: `${name}.json`,
        });
        summary.passed &&= result.passed;
        console.log(
          `${name}: ${result.passed ? "PASS" : "FAIL"}, ${report.gpu.renderer}, ready ${readyMs} ms`,
        );
      } catch (error) {
        summary.passed = false;
        const result = {
          id,
          iteration,
          passed: false,
          error: String(error.stack),
          errors,
          external,
          requests,
        };
        // Keep assertions and the resource ledger even when initialization fails.
        result.diagnostic = await page
          .evaluate(() => window.baseline?.report())
          .catch((error) => ({ error: String(error) }));
        await page
          .screenshot({ path: path.join(output, `${name}-failure.png`) })
          .catch(() => {});
        result.destroyed = await page
          .evaluate(() => window.baseline?.destroy())
          .catch((error) => ({ error: String(error) }));
        summary.runs.push(result);
        await writeFile(
          path.join(output, `${name}.json`),
          `${JSON.stringify(result, null, 2)}\n`,
        );
        console.error(`${name}: ${error.message}`);
      } finally {
        await context.close();
      }
      await writeFile(
        path.join(output, "summary.json"),
        `${JSON.stringify(summary, null, 2)}\n`,
      );
    }
  }
} catch (error) {
  summary.passed = false;
  summary.error = String(error.stack);
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await writeFile(
    path.join(output, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
}
console.log(`Evidence: ${output}`);
if (!summary.passed) {
  process.exitCode = 1;
}
