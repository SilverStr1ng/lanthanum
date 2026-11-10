import assert from "node:assert/strict";
import { test } from "node:test";
import { Cartesian3, Event } from "@cesium/core";
import GeographicTilingScheme from "../../packages/engine/Source/Core/GeographicTilingScheme.js";
import WebGPUGlobeTileProvider from "../../packages/engine/Source/Scene/WebGPUGlobeTileProvider.js";
import QuadtreeTileLoadState from "../../packages/engine/Source/Scene/QuadtreeTileLoadState.js";
import ImageryLayerCollection from "../../packages/engine/Source/Scene/ImageryLayerCollection.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const requests = [],
    scheme = new GeographicTilingScheme(),
    live = new Set();
  const terrain = {
    tilingScheme: scheme,
    requestTileGeometry() {
      const job = deferred();
      requests.push(job);
      return job.promise;
    },
  };
  const renderer = {
    createMesh() {
      const mesh = {};
      live.add(mesh);
      return mesh;
    },
    destroyMesh(mesh) {
      live.delete(mesh);
    },
  };
  const provider = new WebGPUGlobeTileProvider(
    {
      terrainProvider: terrain,
      translucency: { enabled: false },
      imageryLayers: new ImageryLayerCollection(),
    },
    { errorEvent: new Event() },
    renderer,
    () => {},
  );
  const tile = {
    x: 0,
    y: 0,
    level: 0,
    rectangle: scheme.tileXYToRectangle(0, 0, 0),
  };
  provider.quadtree = {
    invalidateAllTiles() {
      tile.data?.freeResources();
    },
  };
  const mesh = {
    vertices: new Float32Array(9),
    indices: new Uint16Array([0, 1, 2]),
    indexCountWithoutSkirts: 3,
    center: new Cartesian3(6378137, 0, 0),
    minimumHeight: 0,
    maximumHeight: 0,
    encoding: {
      stride: 3,
      getExaggeratedPosition(vertices, index, result) {
        assert.equal(vertices.length, 9);
        return Cartesian3.fromElements(
          6378137,
          index === 1 ? 1 : 0,
          index === 2 ? 1 : 0,
          result,
        );
      },
      decodeTextureCoordinates(vertices, index, result) {
        assert.ok(index < vertices.length / 3);
        result.x = 0;
        result.y = 0;
        return result;
      },
    },
  };
  const data = { createMesh: () => Promise.resolve(mesh) };
  return { provider, tile, requests, data, live };
}

test("cancelled old terrain job cannot reset a successfully uploaded replacement", async () => {
  const { provider, tile, requests, data, live } = fixture();
  provider.loadTile({ frameNumber: 1 }, tile);
  const old = tile.data;
  provider.finishFrame({ frameNumber: 4 });
  assert.equal(old.cancelled, true);
  provider.loadTile({ frameNumber: 5 }, tile);
  requests[1].resolve(data);
  await flush();
  provider.initialize();
  const current = tile.data,
    mesh = current.gpuMesh;
  assert.equal(tile.state, QuadtreeTileLoadState.DONE);
  assert.equal(tile.renderable, true);
  provider.loadTile({ frameNumber: 10 }, tile);
  provider.finishFrame({ frameNumber: 10 });
  requests[0].resolve(data);
  await flush();
  provider.initialize();
  assert.equal(tile.data, current);
  assert.equal(current.gpuMesh, mesh);
  assert.equal(
    tile.state,
    QuadtreeTileLoadState.DONE,
    "old cancellation must not reset current tile state",
  );
  assert.equal(tile.renderable, true);
  assert.equal(live.size, 1);
  current.freeResources();
  provider.destroy();
  assert.equal(live.size, 0);
});

for (const order of ["old-first", "new-first", "old-reject", "worker-late"]) {
  test(`terrain generations preserve ownership: ${order}`, async () => {
    const { provider, tile, requests, data, live } = fixture(),
      worker = deferred();
    provider.loadTile({ frameNumber: 1 }, tile);
    if (order === "worker-late") {
      requests[0].resolve({ createMesh: () => worker.promise });
      await flush();
      assert.equal(provider.workStatistics.meshes, 1);
    }
    provider.finishFrame({ frameNumber: 4 });
    provider.loadTile({ frameNumber: 5 }, tile);
    assert.equal(
      provider.workStatistics.inFlight,
      2,
      "logical cancellation must retain the physical work slot",
    );
    if (order === "old-first") {
      requests[0].resolve(data);
      await flush();
    }
    requests[1].resolve(data);
    await flush();
    provider.initialize();
    const current = tile.data,
      mesh = current.gpuMesh;
    for (let frame = 6; frame <= 25; frame++) {
      provider.loadTile({ frameNumber: frame }, tile);
      provider.finishFrame({ frameNumber: frame });
      assert.equal(tile.renderable, true);
      assert.equal(tile.state, QuadtreeTileLoadState.DONE);
    }
    if (order === "old-reject") {
      requests[0].reject(new Error("late rejection"));
    } else if (order === "worker-late") {
      worker.resolve(await data.createMesh());
    } else {
      requests[0].resolve(data);
    }
    await flush();
    provider.initialize();
    assert.equal(tile.data, current);
    assert.equal(current.gpuMesh, mesh);
    assert.equal(provider.workStatistics.inFlight, 0);
    assert.equal(provider.errors.length, 0);
    current.freeResources();
    provider.destroy();
    assert.equal(live.size, 0);
  });
}
for (const delay of [100, 1000]) {
  test(`unabortable request settles after ${delay} ms without late upload`, async () => {
    const { provider, tile, requests, data, live } = fixture();
    provider.loadTile({ frameNumber: 1 }, tile);
    provider.destroy();
    assert.equal(provider.workStatistics.inFlight, 1);
    await new Promise((resolve) => setTimeout(resolve, delay));
    requests[0].resolve(data);
    await flush();
    provider.initialize();
    assert.equal(provider.workStatistics.inFlight, 0);
    assert.equal(provider.workStatistics.uploaded, 0);
    assert.equal(live.size, 0);
  });
}
test("twenty departures and returns keep replacement meshes and physical budgets bounded", async () => {
  const { provider, tile, requests, data, live } = fixture();
  for (let cycle = 0; cycle < 20; cycle++) {
    tile.data?.freeResources();
    const frame = cycle * 10;
    provider.loadTile({ frameNumber: frame }, tile);
    const old = requests.at(-1);
    provider.finishFrame({ frameNumber: frame + 3 });
    provider.loadTile({ frameNumber: frame + 4 }, tile);
    requests.at(-1).resolve(data);
    await flush();
    provider.initialize();
    provider.loadTile({ frameNumber: frame + 7 }, tile);
    provider.finishFrame({ frameNumber: frame + 7 });
    assert.equal(tile.renderable, true);
    old.resolve(data);
    await flush();
    assert.equal(live.size, 1);
    assert.equal(provider.workStatistics.inFlight, 0);
  }
  assert.equal(provider.workStatistics.peakInFlight, 2);
  tile.data.freeResources();
  provider.destroy();
  assert.equal(live.size, 0);
});
test("unresolved physical jobs throttle replacements at eight slots", async () => {
  const { provider, tile, requests, data } = fixture();
  for (let cycle = 0; cycle < 20; cycle++) {
    provider.loadTile({ frameNumber: cycle * 4 }, tile);
    provider.finishFrame({ frameNumber: cycle * 4 + 3 });
  }
  assert.equal(requests.length, 8);
  assert.equal(provider.workStatistics.inFlight, 8);
  assert.equal(provider.workStatistics.peakInFlight, 8);
  for (const request of requests) {
    request.resolve(data);
  }
  await flush();
  provider.loadTile({ frameNumber: 100 }, tile);
  assert.equal(requests.length, 9);
  provider.destroy();
  requests.at(-1).resolve(data);
  await flush();
  assert.equal(provider.workStatistics.inFlight, 0);
});
for (const replacement of ["provider", "exaggeration"]) {
  test(`${replacement} change invalidates request and upload generations`, async () => {
    const { provider, tile, requests, data, live } = fixture();
    provider.loadTile({ frameNumber: 1 }, tile);
    requests[0].resolve(data);
    await flush();
    assert.equal(provider.workStatistics.queuedUploads, 1);
    if (replacement === "provider") {
      provider.globe.terrainProvider = { ...provider.terrainProvider };
    }
    provider.update({
      frameNumber: 2,
      camera: { positionWC: new Cartesian3(7000000, 0, 0) },
      verticalExaggeration: replacement === "exaggeration" ? 2 : 1,
    });
    provider.initialize();
    assert.equal(live.size, 0);
    provider.loadTile({ frameNumber: 3 }, tile);
    requests[1].resolve(data);
    await flush();
    provider.initialize();
    assert.equal(tile.renderable, true);
    assert.equal(provider.workStatistics.uploaded, 1);
    tile.data.freeResources();
    provider.destroy();
    assert.equal(live.size, 0);
  });
}
