import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("native optional dependencies remain locked for all declared platforms", async () => {
  const lock = JSON.parse(
    await readFile(new URL("../../package-lock.json", import.meta.url), "utf8"),
  );
  for (const name of [
    "@ast-grep/cli",
    "esbuild",
    "lightningcss",
    "pagefind",
    "rolldown",
    "sharp",
  ]) {
    const parent = lock.packages[`node_modules/${name}`];
    for (const [dependency, version] of Object.entries(
      parent.optionalDependencies,
    )) {
      const entry = lock.packages[`node_modules/${dependency}`];
      assert.ok(entry, `${name}: missing ${dependency}`);
      assert.equal(entry.version, version);
      assert.ok(entry.integrity, `${dependency}: missing integrity`);
    }
  }
});
