import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createOutputDirectory } from "./outputDirectory.js";

test("fresh output parents are created without permitting evidence overwrite", async () => {
  const prefix = path.join(os.tmpdir(), "lanthanum-output-"),
    directory = await mkdtemp(prefix);
  try {
    const output = path.join(directory, "benchmarks", "runs", "webgpu-unique");
    await createOutputDirectory(output);
    assert.equal((await stat(output)).isDirectory(), true);
    const evidence = path.join(output, "result.json");
    await writeFile(evidence, "original");
    await assert.rejects(createOutputDirectory(output), { code: "EEXIST" });
    assert.equal(await readFile(evidence, "utf8"), "original");
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve(prefix)));
    await rm(directory, { recursive: true });
  }
});
