/*global Cesium*/
const C = Cesium;
const result = (window.results = { checks: [] });
const contexts = [];
const originalGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type, ...args) {
  contexts.push(type);
  return originalGetContext.call(this, type, ...args);
};
function check(name, passed, detail) {
  result.checks.push({ name, passed, detail });
  if (!passed) {
    throw new Error(`${name}: ${JSON.stringify(detail)}`);
  }
}
async function rejects(name, action, pattern) {
  let error;
  try {
    await action();
  } catch (caught) {
    error = caught;
  }
  check(name, !!error && pattern.test(String(error)), String(error));
}
function makeCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  document.body.append(canvas);
  return canvas;
}
async function settle(scene) {
  const deadline = performance.now() + 45000;
  do {
    scene.render();
    await new Promise(requestAnimationFrame);
    if (performance.now() > deadline) {
      throw new Error(`Readiness timeout: ${JSON.stringify(scene.statistics)}`);
    }
  } while (
    !scene.globe.tilesLoaded ||
    scene.statistics.selectedTiles === 0 ||
    scene.statistics.pendingTiles !== 0
  );
  scene.render();
}
function pixel(bytes, canvas) {
  const offset =
    (Math.floor(canvas.height / 2) * canvas.width +
      Math.floor(canvas.width / 2)) *
    4;
  return [...bytes.slice(offset, offset + 4)];
}
function isColor(value, target) {
  return target.every((channel, i) => Math.abs(channel - value[i]) <= 4);
}
function imagery() {
  return new C.UrlTemplateImageryProvider({
    url: "/fixtures/generated/geographic-{z}-{x}-{y}.png",
    maximumLevel: 2,
    tilingScheme: new C.GeographicTilingScheme(),
  });
}
async function run() {
  const canvas = document.getElementById("scene");
  const scene = await C.Scene.createAsync({
    canvas,
    backend: "webgpu",
    maximumTerrainLevel: 10,
  });
  result.adapter = scene.context.capabilities;
  check(
    "native WebGPU selected",
    scene.isWebGPU === true && result.adapter.hardware,
  );
  scene.backgroundColor = C.Color.RED;
  scene.render();
  check(
    "native red clear",
    isColor(pixel(await scene.captureAsync(), canvas), [255, 0, 0]),
  );
  scene.globe = new C.Globe();
  scene.globe.maximumScreenSpaceError = 128;
  const layer = scene.globe.imageryLayers.addImageryProvider(imagery());
  scene.backgroundColor = C.Color.BLACK;
  // Fixture red square: x=20..49,y=190..219 in the western root, geographic (-155.39,-54.14).
  scene.camera.setView({
    destination: C.Cartesian3.fromDegrees(-155.39, -54.14, 18000000),
  });
  await settle(scene);
  let value = pixel(await scene.captureAsync(), canvas);
  check(
    "southwest imagery control point is red",
    isColor(value, [255, 0, 0]),
    value,
  );
  scene.camera.setView({
    destination: C.Cartesian3.fromDegrees(-155.39, 54.14, 18000000),
  });
  await settle(scene);
  value = pixel(await scene.captureAsync(), canvas);
  check(
    "northwest imagery is not mirrored red",
    !isColor(value, [255, 0, 0]) && value[2] > 20,
    value,
  );
  scene.camera.setView({
    destination: C.Cartesian3.fromDegrees(-75, 25, 18000000),
  });
  await settle(scene);
  const center = new C.Cartesian2(
    canvas.clientWidth / 2,
    canvas.clientHeight / 2,
  );
  const position = scene.globe.pick(scene.camera.getPickRay(center), scene);
  const cartographic = C.Cartographic.fromCartesian(position);
  const ray = scene.camera.getPickRay(center);
  const residual = C.Cartesian3.magnitude(
    C.Cartesian3.cross(
      C.Cartesian3.subtract(position, ray.origin, new C.Cartesian3()),
      ray.direction,
      new C.Cartesian3(),
    ),
  );
  check(
    "globe mesh ray intersection",
    Math.abs(C.Math.toDegrees(cartographic.longitude) + 75) < 0.01 &&
      residual < 0.001,
    { cartographic, residual },
  );
  check("native GPU globe ID", (await scene.pickAsync(center))?.id === "globe");
  check(
    "background has no object",
    (await scene.pickAsync(new C.Cartesian2(0, 0))) === undefined,
  );
  const geometry = C.BoxGeometry.createGeometry(
    C.BoxGeometry.fromDimensions({
      dimensions: new C.Cartesian3(1000000, 1000000, 1000000),
      vertexFormat: C.VertexFormat.POSITION_ONLY,
    }),
  );
  const transform = (lon, lat) =>
    C.Transforms.eastNorthUpToFixedFrame(
      C.Cartesian3.fromDegrees(lon, lat, 900000),
    );
  const front = scene.addGeometry({
    geometry,
    modelMatrix: transform(-75, 25),
    color: C.Color.RED,
    id: "front",
  });
  const back = scene.addGeometry({
    geometry,
    modelMatrix: transform(105, -25),
    color: C.Color.LIME,
    id: "back",
  });
  scene.render();
  value = pixel(await scene.captureAsync(), canvas);
  check("opaque geometry color and depth", isColor(value, [255, 0, 0]), value);
  check("native geometry ID", (await scene.pickAsync(center))?.id === "front");
  front.color = C.Color.BLUE;
  scene.render();
  value = pixel(await scene.captureAsync(), canvas);
  check("geometry color updates", isColor(value, [0, 0, 255]), value);
  front.modelMatrix = transform(-20, 25);
  scene.render();
  check(
    "geometry transform updates",
    (await scene.pickAsync(center))?.id === "globe",
  );
  front.modelMatrix = transform(-75, 25);
  front.show = false;
  check(
    "hidden geometry and globe occlusion",
    (await scene.pickAsync(center))?.id === "globe",
  );
  front.show = true;
  const removedPick = scene.pickAsync(center);
  scene.removeGeometry(front);
  check(
    "removed object is not returned by pending pick",
    (await removedPick) === undefined,
  );
  scene.removeGeometry(back);
  const loadedResources = scene.resourceStatistics.live;
  for (let i = 0; i < 30; i++) {
    scene.render();
  }
  check(
    "continuous frames do not accumulate resources",
    scene.resourceStatistics.live === loadedResources,
  );
  const rootLevel = scene.statistics.maximumSelectedLevel;
  scene.globe.maximumScreenSpaceError = 4;
  for (const longitude of [179, -179]) {
    scene.camera.setView({
      destination: C.Cartesian3.fromDegrees(longitude, 20, 700000),
    });
    await settle(scene);
    check(
      `LOD and antimeridian ${longitude}`,
      scene.statistics.maximumSelectedLevel > rootLevel &&
        (await scene.pickAsync(center))?.id === "globe",
      scene.statistics,
    );
  }
  scene.camera.setView({
    destination: C.Cartesian3.fromDegrees(-173.85, 8.96, 100000),
  });
  await settle(scene);
  value = pixel(await scene.captureAsync(), canvas);
  check(
    "ancestor imagery UV orientation",
    scene.statistics.maximumSelectedLevel > 2 && isColor(value, [255, 0, 0]),
    { value, level: scene.statistics.maximumSelectedLevel },
  );
  layer.show = false;
  scene.globe.baseColor = C.Color.DARKBLUE;
  await settle(scene);
  value = pixel(await scene.captureAsync(), canvas);
  check("imagery visibility changes", isColor(value, [0, 0, 139]), value);
  layer.show = true;
  await settle(scene);
  check(
    "imagery restored",
    isColor(pixel(await scene.captureAsync(), canvas), [255, 0, 0]),
  );
  const before = C.Cartesian3.clone(scene.camera.positionWC);
  scene.camera.rotateLeft(0.1);
  scene.camera.rotateUp(0.05);
  scene.camera.zoomOut(1000000);
  await settle(scene);
  check(
    "Cesium camera orbit and zoom",
    C.Cartesian3.distance(before, scene.camera.positionWC) > 100000,
  );
  scene.camera.setView({
    destination: C.Cartesian3.fromDegrees(-75, 25, 18000000),
  });
  await settle(scene);
  canvas.width = 641;
  canvas.height = 359;
  scene.render();
  const resized = await scene.captureAsync();
  check(
    "resize including unaligned readback rows",
    resized.length === 641 * 359 * 4 &&
      (await scene.pickAsync(center))?.id === "globe",
    { bytes: resized.length },
  );
  await rejects(
    "unsupported imagery alpha is explicit",
    () => {
      layer.alpha = 0.5;
      scene.render();
    },
    /alpha/,
  );
  layer.alpha = 1;
  await rejects(
    "2D is explicitly rejected",
    () => {
      scene.mode = C.SceneMode.SCENE2D;
    },
    /3D/,
  );
  await rejects(
    "request render mode is explicitly rejected",
    () => {
      scene.requestRenderMode = true;
    },
    /requestRenderMode/,
  );
  await rejects(
    "invalid pick is rejected",
    () => scene.pickAsync({ x: NaN, y: 1 }),
    /finite/,
  );
  const aborted = new AbortController();
  aborted.abort();
  await rejects(
    "pick cancellation",
    () => scene.pickAsync(center, { signal: aborted.signal }),
    /AbortError/,
  );
  await rejects(
    "initialization cancellation",
    () => C.Scene.createAsync({ canvas: makeCanvas(), signal: aborted.signal }),
    /AbortError/,
  );
  await rejects(
    "forced missing feature does not fallback",
    () =>
      C.Scene.createAsync({
        canvas: makeCanvas(),
        backend: "webgpu",
        requiredFeatures: ["missing-feature"],
      }),
    /Missing WebGPU feature/,
  );
  const second = await C.Scene.createAsync({
    canvas: makeCanvas(),
    backend: "webgpu",
  });
  const originalAdapterRequest = navigator.gpu.requestAdapter;
  const cancelledStartup = new AbortController();
  navigator.gpu.requestAdapter = async () => {
    cancelledStartup.abort();
    return null;
  };
  try {
    await rejects(
      "cancelled adapter failure never falls back",
      async () => {
        const unexpected = await C.Scene.createAsync({
          canvas: makeCanvas(),
          backend: "auto",
          signal: cancelledStartup.signal,
        });
        unexpected.destroy();
      },
      /AbortError/,
    );
  } finally {
    navigator.gpu.requestAdapter = originalAdapterRequest;
  }
  const cancelledDevice = new AbortController();
  navigator.gpu.requestAdapter = async () => ({
    info: {},
    features: new Set(),
    limits: {},
    requestDevice: async () => {
      cancelledDevice.abort();
      throw new Error("Injected device rejection");
    },
  });
  try {
    await rejects(
      "cancelled device rejection never falls back",
      () =>
        C.Scene.createAsync({
          canvas: makeCanvas(),
          backend: "auto",
          signal: cancelledDevice.signal,
        }),
      /AbortError/,
    );
  } finally {
    navigator.gpu.requestAdapter = originalAdapterRequest;
  }
  const originalTerrain = scene.globe.terrainProvider;
  for (const [name, options] of [
    ["non-WGS84", { ellipsoid: C.Ellipsoid.UNIT_SPHERE }],
    [
      "one root",
      {
        tilingScheme: new C.GeographicTilingScheme({
          numberOfLevelZeroTilesX: 1,
        }),
      },
    ],
    ["Mercator", { tilingScheme: new C.WebMercatorTilingScheme() }],
  ]) {
    scene.globe.terrainProvider = new C.EllipsoidTerrainProvider(options);
    await rejects(`${name} terrain is rejected`, () => scene.render(), /WGS84/);
  }
  scene.globe.terrainProvider = originalTerrain;
  second.backgroundColor = C.Color.LIME;
  second.render();
  check(
    "multiple scenes are independent",
    isColor(pixel(await second.captureAsync(), second.canvas), [0, 255, 0]),
  );
  await rejects(
    "globe ownership is exclusive",
    () => {
      second.globe = scene.globe;
    },
    /unowned/,
  );
  second.context.device.destroy();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await rejects(
    "device loss stops rendering explicitly",
    () => second.render(),
    /lost/,
  );
  second.destroy();
  check("lost device resources released", second.resourceStatistics.live === 0);
  const pendingScene = await C.Scene.createAsync({
    canvas: makeCanvas(),
    backend: "webgpu",
  });
  pendingScene.globe = new C.Globe();
  const delayedImagery = imagery();
  const imageRequest = delayedImagery.requestImage.bind(delayedImagery);
  let finish,
    started = 0;
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  delayedImagery.requestImage = async (...args) => {
    started++;
    await gate;
    return imageRequest(...args);
  };
  pendingScene.globe.imageryLayers.addImageryProvider(delayedImagery);
  const deadline = performance.now() + 10000;
  while (!started && performance.now() < deadline) {
    pendingScene.render();
    await new Promise(requestAnimationFrame);
  }
  check("async imagery really started", started > 0);
  pendingScene.destroy();
  finish();
  await new Promise((resolve) => setTimeout(resolve, 200));
  check(
    "late imagery cannot resurrect destroyed scene",
    pendingScene.resourceStatistics.live === 0,
  );
  const failedScene = await C.Scene.createAsync({
    canvas: makeCanvas(),
    backend: "webgpu",
  });
  failedScene.globe = new C.Globe();
  const failedImagery = imagery();
  failedImagery.requestImage = () =>
    Promise.reject(new Error("Injected imagery failure"));
  failedScene.globe.imageryLayers.addImageryProvider(failedImagery);
  let tileError;
  failedScene.renderError.addEventListener((error) => {
    tileError = error;
  });
  const failureDeadline = performance.now() + 10000;
  while (!tileError && performance.now() < failureDeadline) {
    failedScene.render();
    await new Promise(requestAnimationFrame);
  }
  check(
    "imagery failure reaches scene error event",
    /Injected imagery failure/.test(tileError?.message),
  );
  failedScene.destroy();
  check(
    "failed imagery releases resources",
    failedScene.resourceStatistics.live === 0,
  );
  await rejects(
    "invalid canvas dimensions reject initialization",
    () => {
      const invalid = makeCanvas();
      invalid.width = 0;
      return C.Scene.createAsync({ canvas: invalid, backend: "auto" });
    },
    /dimensions/,
  );
  await rejects(
    "invalid terrain level rejects initialization",
    () =>
      C.Scene.createAsync({
        canvas: makeCanvas(),
        backend: "webgpu",
        maximumTerrainLevel: -1,
      }),
    /maximumTerrainLevel/,
  );
  check(
    "native rendering never requests WebGL",
    !contexts.some((type) => /webgl/i.test(type)),
    contexts,
  );
  const fallback = await C.Scene.createAsync({
    canvas: makeCanvas(),
    backend: "auto",
    requiredFeatures: ["missing-feature"],
  });
  check(
    "auto fallback before canvas binding",
    !fallback.isWebGPU &&
      /Missing WebGPU feature/.test(fallback.fallbackReason),
  );
  fallback.destroy();
  scene.render();
  const bytes = await scene.captureAsync();
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  }
  window.captureBase64 = btoa(binary);
  result.captureSize = [canvas.width, canvas.height];
  result.scene = scene.statistics;
  check(
    "no GPU validation errors",
    scene.context.errors.length === 0,
    scene.context.errors,
  );
  const pendingPick = scene.pickAsync(center).then(
    () => false,
    () => true,
  );
  scene.destroy();
  check("pending pick rejects on destroy", await pendingPick);
  check("scene destroyed", scene.isDestroyed());
  check(
    "GPU resources released",
    scene.resourceStatistics.live === 0,
    scene.resourceStatistics,
  );
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
