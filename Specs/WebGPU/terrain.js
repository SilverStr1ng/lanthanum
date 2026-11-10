/*global Cesium*/
import { ridge, height, terrainProvider } from "./ridgeFixture.js";
const C = Cesium,
  result = (window.results = {
    checks: [],
    terrainRequests: [],
    imageryRequests: [],
    snapshots: [],
  });
window.conformanceFrames = [];
function check(name, passed, detail) {
  result.checks.push({ name, passed, detail });
  if (!passed) {
    throw new Error(`${name}: ${JSON.stringify(detail)}`);
  }
}
const tick = () => new Promise(requestAnimationFrame);
async function settle(scene) {
  const deadline = performance.now() + 30000;
  do {
    scene.render();
    await tick();
    if (performance.now() > deadline) {
      throw new Error(`Terrain timeout: ${JSON.stringify(scene.statistics)}`);
    }
  } while (
    !scene.globe.tilesLoaded ||
    !scene.statistics.selectedTiles ||
    scene.statistics.pendingTiles
  );
  scene.render();
}
function project(scene, longitude, latitude, altitude) {
  const world = C.Cartesian3.fromDegrees(longitude, latitude, altitude),
    view = C.Matrix4.multiplyByPoint(
      scene.camera.viewMatrix,
      world,
      new C.Cartesian3(),
    );
  const clip = C.Matrix4.multiplyByVector(
    scene.camera.frustum.projectionMatrix,
    new C.Cartesian4(view.x, view.y, view.z, 1),
    new C.Cartesian4(),
  );
  return new C.Cartesian2(
    (clip.x / clip.w + 1) * 480,
    (1 - clip.y / clip.w) * 270,
  );
}
function view(scene, range = 500000, pitch = -0.65) {
  scene.camera.lookAt(
    C.Cartesian3.fromDegrees(ridge.longitude, ridge.latitude, 3300),
    new C.HeadingPitchRange(0, pitch, range),
  );
}
async function capture(scene, name) {
  const bytes = await scene.captureAsync();
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  window.conformanceFrames.push({
    name,
    width: 960,
    height: 540,
    rgba: btoa(binary),
  });
  return bytes;
}
function snapshot(scene, name) {
  const tiles = scene.globe._surface.tileProvider._selected;
  const value = {
    name,
    statistics: scene.statistics,
    tiles: tiles.map((t) => ({
      x: t.x,
      y: t.y,
      level: t.level,
      fallback: !!t.data.fallback,
      upsampledFromParent: t.upsampledFromParent,
    })),
  };
  result.snapshots.push(value);
  return value;
}
async function run() {
  const contexts = [],
    getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...args) {
    contexts.push(type);
    return getContext.call(this, type, ...args);
  };
  const scene = await C.Scene.createAsync({
    canvas: document.getElementById("scene"),
    backend: "webgpu",
    maximumTerrainLevel: 8,
  });
  result.adapter = scene.context.capabilities;
  scene.globe = new C.Globe();
  scene.globe.tileCacheSize = 24;
  scene.globe.enableLighting = true;
  scene.globe.baseColor = C.Color.GREEN;
  scene.globe.maximumScreenSpaceError = 8;
  const terrain = terrainProvider(result.terrainRequests);
  scene.globe.terrainProvider = terrain;
  const image = document.createElement("canvas");
  image.width = image.height = 16;
  const brush = image.getContext("2d");
  brush.fillStyle = "#228833";
  brush.fillRect(0, 0, 16, 16);
  const imagery = new C.UrlTemplateImageryProvider({
    url: image.toDataURL(),
    maximumLevel: 16,
    tilingScheme: new C.GeographicTilingScheme(),
  });
  const requestImage = imagery.requestImage.bind(imagery);
  imagery.requestImage = (x, y, level, request) => {
    result.imageryRequests.push({ x, y, level });
    return requestImage(x, y, level, request);
  };
  scene.globe.imageryLayers.addImageryProvider(imagery);
  view(scene);
  await settle(scene);
  const mixed = snapshot(scene, "oblique mixed LOD"),
    levels = new Set(mixed.tiles.map((t) => t.level));
  check(
    "ridge view selects adjacent LODs",
    levels.has(7) && levels.has(8),
    mixed.tiles,
  );
  for (const skirts of [true, false]) {
    scene.globe.showSkirts = skirts;
    scene.render();
    const bytes = await capture(scene, `mixed-lod-skirts-${skirts}`);
    const samples = [];
    // L8 y=100 meets L7 y=49 at latitude 19.6875.
    for (const longitude of [29.9, 30.1, 30.3, 30.5]) {
      const latitude = 19.6875;
      const p = project(
        scene,
        longitude,
        latitude,
        height(longitude, latitude),
      );
      for (const dy of [-2, 0, 2]) {
        const x = Math.round(p.x),
          y = Math.round(p.y) + dy;
        samples.push({ x, y, green: bytes[(y * 960 + x) * 4 + 1] });
      }
    }
    check(
      `mixed LOD edge has no black pixels skirts=${skirts}`,
      samples.every(
        (p) => p.x > 0 && p.x < 960 && p.y > 0 && p.y < 540 && p.green > 30,
      ),
      samples,
    );
  }
  view(scene, 110000, -Math.PI / 2);
  await settle(scene);
  const overhead = snapshot(scene, "2x2 and missing tile");
  check(
    "four adjacent ridge tiles render including missing fallback",
    [298, 299].every((x) =>
      [98, 99].every((y) =>
        overhead.tiles.some((t) => t.x === x && t.y === y && t.level === 8),
      ),
    ),
    overhead.tiles,
  );
  check(
    "known missing tile is upsampled without a terrain request",
    overhead.tiles.some(
      (t) => t.x === 299 && t.y === 99 && t.level === 8 && t.fallback,
    ) &&
      !result.terrainRequests.some(
        (t) => t.x === 299 && t.y === 99 && t.level === 8,
      ),
    scene.statistics.terrainWork,
  );
  for (const [longitude, latitude, expected] of ridge.samples) {
    const p = project(scene, longitude, latitude, expected),
      hit = scene.globe.pick(scene.camera.getPickRay(p), scene),
      actual = hit && C.Cartographic.fromCartesian(hit).height;
    check(`CPU ridge height ${longitude}`, Math.abs(actual - expected) < 30, {
      actual,
      expected,
      tolerance: 30,
    });
  }
  for (const skirts of [true, false]) {
    scene.globe.showSkirts = skirts;
    scene.render();
    const bytes = await capture(scene, `ridge-skirts-${skirts}`);
    const samples = [];
    for (const d of [-0.3, -0.15, 0, 0.15, 0.3]) {
      for (const [lon, lat] of [
        [ridge.longitude, ridge.latitude + d],
        [ridge.longitude + d, ridge.latitude],
      ]) {
        const p = project(scene, lon, lat, height(lon, lat));
        for (const dx of [-2, 0, 2]) {
          const x = Math.round(p.x) + dx,
            y = Math.round(p.y),
            offset = (y * 960 + x) * 4;
          samples.push({ x, y, green: bytes[offset + 1] });
        }
      }
    }
    check(
      `ridge shared edges have no black pixels skirts=${skirts}`,
      samples.every(
        (p) => p.x > 0 && p.x < 960 && p.y > 0 && p.y < 540 && p.green > 30,
      ),
      samples,
    );
    const provider = scene.globe._surface.tileProvider;
    check(
      `skirts=${skirts} selects expected index ranges`,
      provider._selected.every(
        (t) =>
          t.data.gpuMesh.count ===
          (skirts
            ? t.data.mesh.indices.length
            : t.data.mesh.indexCountWithoutSkirts),
      ),
    );
  }
  scene.globe.showSkirts = true;
  const box = scene.primitives.add(
    new C.Primitive({
      asynchronous: false,
      geometryInstances: new C.GeometryInstance({
        geometry: C.BoxGeometry.fromDimensions({
          dimensions: new C.Cartesian3(1000, 1000, 500),
          vertexFormat: C.VertexFormat.POSITION_ONLY,
        }),
        modelMatrix: C.Transforms.eastNorthUpToFixedFrame(
          C.Cartesian3.fromDegrees(ridge.longitude, ridge.latitude, 2200),
        ),
        id: "under-ridge",
        attributes: {
          color: C.ColorGeometryInstanceAttribute.fromColor(C.Color.RED),
        },
      }),
      appearance: new C.PerInstanceColorAppearance({
        flat: true,
        translucent: false,
      }),
    }),
  );
  scene.render();
  check(
    "ridge occludes buried Primitive ID",
    (await scene.pickAsync(new C.Cartesian2(480, 270)))?.id === "globe",
  );
  scene.globe.show = false;
  scene.render();
  check(
    "buried Primitive control is drawable",
    (await scene.pickAsync(new C.Cartesian2(480, 270)))?.id === "under-ridge",
  );
  scene.globe.show = true;
  scene.primitives.remove(box);
  const exaggerationBox = scene.primitives.add(
    new C.Primitive({
      asynchronous: false,
      geometryInstances: new C.GeometryInstance({
        geometry: C.BoxGeometry.fromDimensions({
          dimensions: new C.Cartesian3(1000, 1000, 500),
          vertexFormat: C.VertexFormat.POSITION_ONLY,
        }),
        modelMatrix: C.Transforms.eastNorthUpToFixedFrame(
          C.Cartesian3.fromDegrees(ridge.longitude, ridge.latitude, 4500),
        ),
        id: "exaggeration-control",
        attributes: {
          color: C.ColorGeometryInstanceAttribute.fromColor(C.Color.RED),
        },
      }),
      appearance: new C.PerInstanceColorAppearance({
        flat: true,
        translucent: false,
      }),
    }),
  );
  check(
    "4500 m control is visible above original ridge",
    (await scene.pickAsync(new C.Cartesian2(480, 270)))?.id ===
      "exaggeration-control",
  );
  scene.verticalExaggeration = 2;
  await settle(scene);
  const point = project(scene, ridge.longitude, ridge.latitude, 6600),
    hit = scene.globe.pick(scene.camera.getPickRay(point), scene),
    exaggerated = C.Cartographic.fromCartesian(hit).height;
  check(
    "nonflat ridge exaggeration updates mesh height",
    Math.abs(exaggerated - 6600) < 30,
    exaggerated,
  );
  check(
    "exaggerated ridge occludes 4500 m control on GPU",
    (await scene.pickAsync(new C.Cartesian2(480, 270)))?.id === "globe",
  );
  await capture(scene, "ridge-exaggerated");
  scene.verticalExaggeration = 1;
  await settle(scene);
  check(
    "restoring exaggeration reveals 4500 m control on GPU",
    (await scene.pickAsync(new C.Cartesian2(480, 270)))?.id ===
      "exaggeration-control",
  );
  scene.primitives.remove(exaggerationBox);
  // Observer only: do not stop geometry refinement and silently reduce imagery detail.
  check(
    "LOD observer records bounded upsampling and imagery terrain cap",
    scene.statistics.terrainWork.upsampled > 0 &&
      Math.max(...result.imageryRequests.map((t) => t.level)) === 8 &&
      imagery.maximumLevel === 16,
    {
      work: scene.statistics.terrainWork,
      imageryMaximumRequested: Math.max(
        ...result.imageryRequests.map((t) => t.level),
      ),
      imageryMaximumSupported: 16,
    },
  );
  result.returns = [];
  for (let i = 0; i < 20; i++) {
    scene.camera.lookAtTransform(C.Matrix4.IDENTITY);
    scene.camera.setView({
      destination: C.Cartesian3.fromDegrees(-150, -20, 1000000),
    });
    for (let j = 0; j < 4; j++) {
      scene.render();
      await tick();
    }
    view(scene, 110000, -Math.PI / 2);
    await settle(scene);
    const state = {
      iteration: i + 1,
      work: scene.statistics.terrainWork,
      resources: scene.resourceStatistics,
    };
    result.returns.push(state);
    check(
      `rapid return ${i + 1} restores ridge`,
      (await scene.pickAsync(new C.Cartesian2(480, 270)))?.id === "globe" &&
        state.work.inFlight === 0 &&
        state.work.peakInFlight <= 8,
      state,
    );
  }
  const counts = result.returns.slice(5).map((s) => s.resources.live);
  check(
    "rapid returns keep resource residency bounded",
    Math.max(...counts) - Math.min(...counts) <= 16,
    counts,
  );
  snapshot(scene, "final work counters");
  check(
    "ridge rendering has no GPU validation errors",
    scene.context.errors.length === 0,
    scene.context.errors,
  );
  check(
    "ridge suite never creates WebGL context",
    !contexts.some((t) => /webgl/.test(t)),
    contexts,
  );
  scene.destroy();
  check(
    "ridge scene releases all GPU resources",
    scene.resourceStatistics.live === 0,
    scene.resourceStatistics,
  );
  // Real browser/Worker/GPU late-write test: deliberately hold the first root request.
  for (const delay of [100, 1000]) {
    const late = await C.Scene.createAsync({
      canvas: document.getElementById("scene"),
      backend: "webgpu",
      maximumTerrainLevel: 0,
    });
    late.globe = new C.Globe();
    let release;
    const provider = terrainProvider([]),
      original = provider.requestTileGeometry.bind(provider),
      held = new Promise((resolve) => {
        release = resolve;
      });
    let first = true;
    provider.requestTileGeometry = (...args) => {
      const data = original(...args);
      if (first) {
        first = false;
        return held.then(() => data);
      }
      return data;
    };
    late.globe.terrainProvider = provider;
    late.render();
    const old = late.globe._surface.tileProvider;
    late.globe.terrainProvider = terrainProvider([]);
    for (let frame = 0; frame < 180; frame++) {
      late.render();
      await tick();
      if (
        old.workStatistics.uploaded >= 2 &&
        old.workStatistics.inFlight === 1
      ) {
        break;
      }
    }
    const before = old.workStatistics.uploaded;
    check(
      `browser late ${delay}ms has a completed replacement before release`,
      before >= 2 && old.workStatistics.inFlight === 1,
      old.workStatistics,
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
    release();
    await settle(late);
    check(
      `browser late ${delay}ms generation cannot overwrite uploaded terrain`,
      old.workStatistics.inFlight === 0 &&
        old.workStatistics.uploaded === before &&
        (await late.pickAsync(new C.Cartesian2(480, 270)))?.id === "globe",
      old.workStatistics,
    );
    late.destroy();
    check(
      `late ${delay}ms scene releases resources`,
      late.resourceStatistics.live === 0,
    );
  }
}
run()
  .then(() => {
    result.passed = true;
  })
  .catch((error) => {
    result.passed = false;
    result.error = String(error.stack);
  })
  .finally(() => {
    result.done = true;
  });
