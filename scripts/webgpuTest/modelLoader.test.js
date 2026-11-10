import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import loadWebGPUModel from "../../packages/engine/Source/Scene/WebGPUModelLoader.js";
import WebGPUAsyncCache from "../../packages/engine/Source/Renderer/WebGPUAsyncCache.js";
import { BoundingSphere, Cartesian3, Matrix4 } from "@cesium/core";
import { transformModelBounds } from "../../packages/engine/Source/Renderer/WebGPUTransforms.js";
import { modelPipelineKey } from "../../packages/engine/Source/Renderer/WebGPUModelRenderer.js";
import { verifyModelManifest } from "./modelManifest.js";

const root = new URL("../../Specs/WebGPU/fixtures/models/", import.meta.url);
const read = async (url) => new Uint8Array(await readFile(new URL(url)));
for (const name of [
  "plane",
  "box",
  "u8",
  "u32",
  "nonindexed",
  "interleaved",
  "normalized8",
  "normalized16",
  "color-float",
  "multi",
  "jpeg",
  "optional-fallback",
  "color3",
  "vertex-tint",
  "rotation",
  "selected-scene",
]) {
  test(`CPU model ${name} has validated geometry and encoded image without GPU`, async () => {
    const result = await loadWebGPUModel(
      new URL(`${name}.gltf`, root).href,
      read,
    );
    assert.ok(result.nodes.length > 0);
    assert.ok(result.images[0].bytes.length > 0);
    assert.ok(result.nodes[0].primitives[0].hash);
  });
}
test("GLB and external glTF produce identical geometry and image content", async () => {
  const [a, b] = await Promise.all(
    ["box.gltf", "box.glb"].map((name) =>
      loadWebGPUModel(new URL(name, root).href, read),
    ),
  );
  assert.equal(a.nodes[0].primitives[0].hash, b.nodes[0].primitives[0].hash);
  assert.equal(a.images[0].hash, b.images[0].hash);
});
for (const name of [
  "required",
  "animation",
  "skin",
  "morph",
  "pbr",
  "mask",
  "blend",
  "mip",
  "sparse",
  "stride",
  "bounds",
  "image",
  "cycle",
  "normalized",
  "uv",
  "topology",
  "singular",
  "optional",
]) {
  test(`CPU model rejects ${name} with asset identity`, async () => {
    const url = new URL(`bad-${name}.gltf`, root).href;
    await assert.rejects(loadWebGPUModel(url, read), (error) =>
      error.message.includes(url),
    );
  });
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
test("shared cache cancellation preserves another waiter and last release destroys once", async () => {
  const job = deferred(),
    disposed = [];
  let calls = 0;
  const cache = new WebGPUAsyncCache({
      label: "test",
      destroyValue: (v) => disposed.push(v),
    }),
    controller = new AbortController();
  const create = () => {
    calls++;
    return job.promise;
  };
  const a = cache.acquire("same", create, controller.signal),
    b = cache.acquire("same", create);
  controller.abort();
  await assert.rejects(a.promise, { name: "AbortError" });
  job.resolve(42);
  assert.equal(await b.promise, 42);
  assert.equal(calls, 1);
  assert.deepEqual(disposed, []);
  b.release();
  b.release();
  assert.deepEqual(disposed, [42]);
  await flush();
  assert.equal(cache.statistics.entries, 0);
});
test("cancelled physical work retains slots and stale completion cannot replace new entry", async () => {
  const cache = new WebGPUAsyncCache({ label: "test", concurrency: 1 }),
    old = deferred(),
    next = deferred();
  const a = cache.acquire("same", () => old.promise);
  await flush();
  a.release();
  await assert.rejects(a.promise, { name: "AbortError" });
  const b = cache.acquire("same", () => next.promise);
  await flush();
  assert.equal(cache.statistics.active, 1);
  assert.equal(cache.statistics.queued, 1);
  old.resolve("stale");
  await flush();
  next.resolve("fresh");
  assert.equal(await b.promise, "fresh");
  b.release();
  await flush();
  assert.equal(cache.statistics.peakActive, 1);
});
test("cache destruction rejects waiters but tracks unabortable work until completion", async () => {
  const job = deferred(),
    disposed = [],
    cache = new WebGPUAsyncCache({
      label: "compile",
      destroyValue: (v) => disposed.push(v),
    });
  const lease = cache.acquire("shader", () => job.promise);
  await flush();
  cache.destroy();
  await assert.rejects(lease.promise, { name: "AbortError" });
  assert.equal(cache.statistics.active, 1);
  job.resolve("pipeline");
  await flush();
  assert.equal(cache.statistics.active, 0);
  assert.deepEqual(disposed, ["pipeline"]);
  lease.release();
});
test("failed cache entries can retry without poisoning shared references", async () => {
  const cache = new WebGPUAsyncCache({ label: "compile" });
  const a = cache.acquire("bad", () => Promise.reject(new Error("bad shader")));
  await assert.rejects(a.promise, /bad shader/);
  const b = cache.acquire("bad", () => Promise.resolve("fixed"));
  assert.equal(await b.promise, "fixed");
  a.release();
  b.release();
});

test("model fixture bytes match the independent frozen manifest", async () => {
  const manifest = await verifyModelManifest();
  assert.ok(manifest.assetCount > 40);
});
test("model bounds contain sheared directions from rotated nonuniform hierarchy", () => {
  const matrix = new Matrix4(
    1,
    1,
    0,
    30,
    0,
    1,
    0,
    20,
    0,
    0,
    -2,
    10,
    0,
    0,
    0,
    1,
  );
  const sphere = transformModelBounds(
    new BoundingSphere(Cartesian3.ZERO, 1),
    matrix,
  );
  assert.ok(Math.abs(sphere.radius - 2) < 1e-10);
  assert.deepEqual(sphere.center, new Cartesian3(30, 20, 10));
  matrix[10] = 1;
  const shear = transformModelBounds(
    new BoundingSphere(Cartesian3.ZERO, 1),
    matrix,
  );
  assert.ok(Math.abs(shear.radius - (1 + Math.sqrt(5)) / 2) < 1e-10);
});
test("pipeline identity distinguishes actual layouts targets culling and handedness", () => {
  const keys = [
    ["bgra8unorm", 20, false, false],
    ["rgba8unorm", 20, false, false],
    ["bgra8unorm", 36, false, false],
    ["bgra8unorm", 20, true, false],
    ["bgra8unorm", 20, false, true],
  ].map((args) => modelPipelineKey(...args));
  assert.equal(new Set(keys).size, keys.length);
});
test("bounded queue rejects excess work and releases queued cancellations", async () => {
  const cache = new WebGPUAsyncCache({
      label: "budget",
      concurrency: 1,
      maximumEntries: 3,
    }),
    job = deferred();
  const a = cache.acquire("a", () => job.promise),
    b = cache.acquire("b", () => Promise.resolve(2));
  assert.throws(() => cache.acquire("c", () => Promise.resolve(3)), /budget/);
  b.release();
  await assert.rejects(b.promise, { name: "AbortError" });
  assert.equal(cache.statistics.queued, 0);
  job.resolve(1);
  await a.promise;
  a.release();
  await flush();
  assert.equal(cache.statistics.entries, 0);
});
