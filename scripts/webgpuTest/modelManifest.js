import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export async function verifyModelManifest() {
  const directory = "Specs/WebGPU/fixtures/models/";
  const bytes = await readFile(`${directory}manifest.json`);
  const manifest = JSON.parse(bytes);
  for (const [file, expected] of Object.entries(manifest.files)) {
    const actual = createHash("sha256")
      .update(await readFile(`${directory}${file}`))
      .digest("hex");
    if (actual !== expected) {
      throw new Error(`Model fixture changed: ${file}`);
    }
  }
  const source = createHash("sha256");
  for (const file of [
    "Specs/WebGPU/models.js",
    "Specs/WebGPU/modelLifecycle.js",
    "Specs/WebGPU/modelGlobe.js",
    "Apps/WebGPU/modelWorld.js",
    "Apps/WebGPU/modelApp.js",
    "scripts/webgpuTest/modelDemo.js",
  ]) {
    source.update(file);
    source.update((await readFile(file, "utf8")).replaceAll("\r\n", "\n"));
  }
  return {
    manifestSha256: createHash("sha256").update(bytes).digest("hex"),
    sourceSha256: source.digest("hex"),
    assetCount: Object.keys(manifest.files).length,
  };
}
