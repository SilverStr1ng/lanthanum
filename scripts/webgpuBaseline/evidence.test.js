import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareOutputDirectory } from "./evidence.js";

test("replay cannot overwrite references or earlier evidence", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "cesium-baseline-test-"),
  );
  try {
    const baseline = path.join(directory, "baseline");
    await prepareOutputDirectory(baseline);
    await writeFile(path.join(baseline, "T00-1.rgba.gz"), "original");
    await assert.rejects(prepareOutputDirectory(baseline), /not empty/);
    await assert.rejects(prepareOutputDirectory(baseline, baseline), /overlap/);
    await assert.rejects(
      prepareOutputDirectory(path.join(baseline, "child"), baseline),
      /overlap/,
    );
    await assert.rejects(
      prepareOutputDirectory(directory, baseline),
      /overlap/,
    );
    await prepareOutputDirectory(path.join(directory, "new-run"), baseline);
    assert.equal(
      await readFile(path.join(baseline, "T00-1.rgba.gz"), "utf8"),
      "original",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
