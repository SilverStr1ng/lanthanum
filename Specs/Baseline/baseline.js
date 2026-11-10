/*global Cesium*/
import instrumentWebGL from "./instrumentWebGL.js";

const C = Cesium;
const params = new URLSearchParams(location.search);
const id = params.get("scene") ?? "T01";
const canvas = document.getElementById("scene");
const width = 1920,
  height = 1080;
canvas.width = width;
canvas.height = height;
const gl = canvas.getContext("webgl2", {
  antialias: false,
  alpha: false,
  preserveDrawingBuffer: true,
  powerPreference: "high-performance",
});
if (!gl) {
  throw new Error("Required WebGL2 context unavailable");
}
const ledger = instrumentWebGL(gl);
const renderer = gl.getExtension("WEBGL_debug_renderer_info");
const gpu = {
  backend: "webgl2",
  version: gl.getParameter(gl.VERSION),
  renderer: renderer ? gl.getParameter(renderer.UNMASKED_RENDERER_WEBGL) : null,
  vendor: renderer ? gl.getParameter(renderer.UNMASKED_VENDOR_WEBGL) : null,
  hardwareVerified: false,
};
gpu.hardwareVerified = Boolean(
  gpu.renderer &&
  !/swiftshader|llvmpipe|software|basic render/i.test(gpu.renderer),
);
const time = C.JulianDate.fromIso8601("2026-11-09T12:00:00Z");
const errors = [];
window.addEventListener("unhandledrejection", (event) =>
  errors.push(String(event.reason?.stack ?? event.reason)),
);
const scene = new C.Scene({
  canvas,
  contextOptions: {
    requestWebgl1: false,
    webgl: { antialias: false, alpha: false, preserveDrawingBuffer: true },
  },
  orderIndependentTranslucency: false,
});
if (!scene.context.webgl2) {
  throw new Error("Cesium selected a non-WebGL2 context");
}
scene.rethrowRenderErrors = true;
scene.backgroundColor = C.Color.BLACK;
scene.highDynamicRange = false;
scene.msaaSamples = 1;
scene.fxaa = false;
scene.postProcessStages.fxaa.enabled = false;
scene.fog.enabled = false;
scene.sun = undefined;
scene.moon = undefined;
const origin = C.Cartesian3.fromDegrees(-75, 40, 0);
const transform = C.Transforms.eastNorthUpToFixedFrame(origin);
const objects = [];
const checks = [];
const counters = { renderCpu: [], raf: [] };
let ready = false,
  stopped = false,
  collecting = false,
  previousFrame,
  failure;
let beforeFrame;
const start = performance.now();
let readyMs;
const record = (name, passed, detail) => {
  checks.push({ name, passed, detail });
  if (!passed) {
    throw new Error(`${name}: ${JSON.stringify(detail)}`);
  }
};

function render() {
  scene.initializeFrame();
  scene.render(time);
}
function loop(now) {
  if (stopped) {
    return;
  }
  try {
    ledger.resetFrame();
    if (beforeFrame) {
      beforeFrame(now);
    }
    const t = performance.now();
    render();
    if (collecting) {
      counters.renderCpu.push(performance.now() - t);
      if (previousFrame !== undefined) {
        counters.raf.push(now - previousFrame);
      }
    }
    previousFrame = now;
  } catch (error) {
    failure = String(error.stack);
    stopped = true;
  }
  if (!stopped) {
    requestAnimationFrame(loop);
  }
}
requestAnimationFrame(loop);

async function until(condition, description, timeout = 45000) {
  const deadline = performance.now() + timeout;
  while (!condition()) {
    if (failure) {
      throw new Error(failure);
    }
    if (performance.now() > deadline) {
      throw new Error(`Timed out: ${description}`);
    }
    await new Promise(requestAnimationFrame);
  }
}

function view(range = 400, heading = 0, pitch = -0.7) {
  scene.camera.lookAt(origin, new C.HeadingPitchRange(heading, pitch, range));
}

function box(name, x, y, z, color, size = 80) {
  const matrix = C.Matrix4.multiplyByTranslation(
    transform,
    new C.Cartesian3(x, y, z),
    new C.Matrix4(),
  );
  const primitive = scene.primitives.add(
    new C.Primitive({
      geometryInstances: new C.GeometryInstance({
        id: name,
        modelMatrix: matrix,
        geometry: C.BoxGeometry.fromDimensions({
          dimensions: new C.Cartesian3(size, size * 0.65, size * 1.2),
          vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT,
        }),
        attributes: {
          color: C.ColorGeometryInstanceAttribute.fromColor(color),
        },
      }),
      appearance: new C.PerInstanceColorAppearance({
        flat: true,
        translucent: color.alpha < 1,
        closed: true,
      }),
      asynchronous: false,
    }),
  );
  objects.push(primitive);
  return primitive;
}

function globe(scheme = "geographic") {
  scene.globe = new C.Globe();
  scene.globe.enableLighting = false;
  scene.globe.showGroundAtmosphere = false;
  scene.globe.maximumScreenSpaceError = 8;
  scene.globe.imageryLayers.addImageryProvider(
    new C.UrlTemplateImageryProvider({
      url: `/fixtures/generated/${scheme}-{z}-{x}-{y}.png`,
      maximumLevel: 2,
      tilingScheme:
        scheme === "geographic"
          ? new C.GeographicTilingScheme()
          : new C.WebMercatorTilingScheme(),
      credit: "Procedural Apache-2.0 baseline fixture",
    }),
  );
  scene.camera.setView({
    destination: C.Cartesian3.fromDegrees(-75, 25, 18000000),
  });
}

async function tiles(url, city = false) {
  const tileset = await C.Cesium3DTileset.fromUrl(url, {
    maximumScreenSpaceError: 16,
    cacheBytes: 512 * 1024 * 1024,
    maximumCacheOverflowBytes: 256 * 1024 * 1024,
  });
  scene.primitives.add(tileset);
  objects.push(tileset);
  if (city) {
    tileset.modelMatrix = transform;
    view(6000, 0, -1.3);
  } else {
    scene.camera.viewBoundingSphere(
      tileset.boundingSphere,
      new C.HeadingPitchRange(0, -0.7, tileset.boundingSphere.radius * 4),
    );
  }
  await until(
    () => tileset.tilesLoaded && tileset.statistics.numberOfCommands > 0,
    "tiles render",
  );
  record("tiles have selected content", tileset.statistics.selected > 0, {
    selected: tileset.statistics.selected,
  });
  return tileset;
}

function pixels() {
  render();
  const rgba = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  record("WebGL error", gl.getError() === gl.NO_ERROR);
  let binary = "";
  for (let i = 0; i < rgba.length; i += 32768) {
    binary += String.fromCharCode(...rgba.subarray(i, i + 32768));
  }
  return btoa(binary);
}

async function initialize() {
  if (id === "T00") {
    view(500);
    box("left-red", -100, 0, 45, C.Color.RED);
    box("right-green", 100, 0, 45, C.Color.LIME, 100);
    box("rear-blue", 0, 150, 45, C.Color.BLUE);
    await until(
      () => objects.every((object) => object.ready),
      "geometry ready",
    );
    render();
    for (const [name, x, y, color] of [
      ["left-red", -100, 0, [255, 0, 0]],
      ["right-green", 100, 0, [0, 255, 0]],
      ["rear-blue", 0, 150, [0, 0, 255]],
    ]) {
      const world = C.Matrix4.multiplyByPoint(
        transform,
        new C.Cartesian3(x, y, 45),
        new C.Cartesian3(),
      );
      const screen = C.SceneTransforms.worldToWindowCoordinates(scene, world);
      const pixel = new Uint8Array(4);
      gl.readPixels(
        Math.floor(screen.x),
        height - 1 - Math.floor(screen.y),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixel,
      );
      record(
        `${name} analytic color`,
        color.every(
          (expected, channel) => Math.abs(pixel[channel] - expected) <= 3,
        ),
        { pixel: [...pixel], screen },
      );
      const picked = await scene.pickAsync(screen);
      record(`${name} object ID`, picked?.id === name, { id: picked?.id });
      render();
    }
  } else if (id === "T01" || id === "T01-mercator") {
    globe(id === "T01" ? "geographic" : "mercator");
    await until(
      () =>
        scene.globe.tilesLoaded &&
        scene.globe._surface._tilesToRender.length > 0 &&
        scene.globe._surface._tilesToRender.every((tile) =>
          tile.data.imagery.some((item) => item.readyImagery?.state === 4),
        ),
      "imagery tiles",
    );
    record(
      "imagery tiles selected",
      scene.globe._surface._tilesToRender.length > 0,
    );
  } else if (id === "T02") {
    globe();
    const terrain = await C.CesiumTerrainProvider.fromUrl(
      "/Specs/Data/CesiumTerrainTileJson/QuantizedMesh/",
    );
    scene.terrainProvider = terrain;
    scene.camera.setView({
      destination: C.Cartesian3.fromDegrees(10, 20, 20000000),
    });
    await until(
      () =>
        scene.globe.tilesLoaded &&
        scene.globe._surface._tilesToRender.some(
          (tile) =>
            tile.data?.terrainData instanceof C.QuantizedMeshTerrainData,
        ),
      "quantized mesh terrain",
    );
    const data = await terrain.requestTileGeometry(0, 0, 0);
    record("quantized mesh decoded", data._quantizedVertices.length > 0, {
      vertices: data._quantizedVertices.length / 3,
    });
  } else if (id === "T03") {
    view(12, 0.4, -0.6);
    const model = await C.Model.fromGltfAsync({
      url: "/fixtures/generated/box.glb",
      modelMatrix: transform,
      id: "gltf-box",
    });
    scene.primitives.add(model);
    objects.push(model);
    await until(() => model.ready, "glTF model");
    record("glTF ready", model.ready);
  } else if (id.startsWith("T04")) {
    const paths = {
      T04: "Batched/BatchedWithBatchTable",
      "T04-i3dm": "Instanced/InstancedWithBatchTable",
      "T04-pnts": "PointCloud/PointCloudRGB",
      "T04-cmpt": "Composite/CompositeOfInstanced",
    };
    await tiles(`/Specs/Data/Cesium3DTiles/${paths[id]}/tileset.json`);
  } else if (id === "T05") {
    await document.fonts.load("24px BaselineOpenSans");
    record("fixed font loaded", document.fonts.check("24px BaselineOpenSans"));
    view(600);
    box("primitive", -110, 0, 40, C.Color.CYAN);
    const points = scene.primitives.add(new C.PointPrimitiveCollection());
    points.add({
      position: C.Matrix4.multiplyByPoint(
        transform,
        new C.Cartesian3(80, 0, 60),
        new C.Cartesian3(),
      ),
      color: C.Color.YELLOW,
      pixelSize: 20,
      id: "point",
    });
    const lines = scene.primitives.add(new C.PolylineCollection());
    lines.add({
      positions: [
        new C.Cartesian3(-150, 0, 100),
        new C.Cartesian3(150, 0, 100),
      ].map((p) => C.Matrix4.multiplyByPoint(transform, p, new C.Cartesian3())),
      width: 5,
      material: C.Material.fromType("Color", { color: C.Color.ORANGE }),
      id: "line",
    });
    const labels = scene.primitives.add(new C.LabelCollection());
    labels.add({
      position: C.Matrix4.multiplyByPoint(
        transform,
        new C.Cartesian3(0, 0, 160),
        new C.Cartesian3(),
      ),
      text: "T05 Local GIS",
      font: "24px BaselineOpenSans",
      fillColor: C.Color.WHITE,
    });
    const billboards = scene.primitives.add(new C.BillboardCollection());
    const billboard = billboards.add({
      position: C.Matrix4.multiplyByPoint(
        transform,
        new C.Cartesian3(120, 0, 120),
        new C.Cartesian3(),
      ),
      image: "/fixtures/generated/four-colors.png",
      width: 48,
      height: 48,
      id: "billboard",
    });
    await until(
      () => billboard.ready && labels.ready,
      "billboard and label atlas ready",
    );
    render();
    const screen = C.SceneTransforms.worldToWindowCoordinates(
      scene,
      billboard.position,
    );
    const pickedBillboard = await scene.pickAsync(screen);
    record(
      "textured billboard rendered and pickable",
      pickedBillboard?.id === "billboard",
      { id: pickedBillboard?.id },
    );
    render();
    for (const [dx, dy, expected] of [
      [-12, -12, [255, 0, 0]],
      [12, -12, [0, 255, 0]],
      [-12, 12, [0, 0, 255]],
      [12, 12, [255, 255, 0]],
    ]) {
      const pixel = new Uint8Array(4);
      gl.readPixels(
        Math.floor(screen.x + dx),
        height - 1 - Math.floor(screen.y + dy),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixel,
      );
      record(
        `texture quadrant ${dx}/${dy}`,
        expected.every(
          (value, channel) => Math.abs(pixel[channel] - value) <= 3,
        ),
        { pixel: [...pixel] },
      );
    }
    const data = await C.GeoJsonDataSource.load("/Specs/Data/test.geojson");
    record("GeoJSON parsed", data.entities.values.length > 0, {
      entities: data.entities.values.length,
    });
    // Data source visualization and dynamic Entity coverage remain explicit subcases.
  } else if (id === "T06") {
    view(300, 0, -Math.PI / 2);
    box("back", 0, 0, 0, C.Color.BLUE, 100);
    box("front", 0, 0, 100, C.Color.RED, 80);
    await until(() => objects.every((object) => object.ready), "pick objects");
    render();
    const point = new C.Cartesian2(width / 2, height / 2);
    const picked = await scene.pickAsync(point);
    record("async pick front object", picked?.id === "front", {
      id: picked?.id,
    });
    render();
    const world = scene.pickPosition(point);
    record(
      "depth position finite",
      C.defined(world) && Number.isFinite(C.Cartesian3.magnitude(world)),
      { world },
    );
    const ray = scene.camera.getPickRay(point);
    const inverse = C.Matrix4.inverseTransformation(transform, new C.Matrix4());
    const rayOrigin = C.Matrix4.multiplyByPoint(
      inverse,
      ray.origin,
      new C.Cartesian3(),
    );
    const rayDirection = C.Matrix4.multiplyByPointAsVector(
      inverse,
      ray.direction,
      new C.Cartesian3(),
    );
    const distance = (148 - rayOrigin.z) / rayDirection.z;
    const reference = C.Ray.getPoint(ray, distance);
    const errorMeters = C.Cartesian3.distance(world, reference);
    record("depth against analytic box plane <= 0.1m", errorMeters <= 0.1, {
      errorMeters,
    });
  } else if (id === "T07") {
    view(500);
    box("lifecycle", 0, 0, 40, C.Color.YELLOW);
    const results = [];
    for (let i = 0; i < 20; i++) {
      const temporaryCanvas = document.createElement("canvas");
      temporaryCanvas.style.display = "none";
      document.body.appendChild(temporaryCanvas);
      temporaryCanvas.width = 64;
      temporaryCanvas.height = 64;
      const temporaryLedger = instrumentWebGL(
        temporaryCanvas.getContext("webgl2"),
      );
      const temporary = new C.Scene({
        canvas: temporaryCanvas,
        contextOptions: { requestWebgl1: false },
      });
      temporary.initializeFrame();
      temporary.msaaSamples = 1;
      temporary.render(time);
      temporaryCanvas.width = 128;
      temporary.initializeFrame();
      temporary.render(time);
      record(`resize cycle ${i}`, temporary.context.drawingBufferWidth === 128);
      temporary.destroy();
      results.push(
        temporary.isDestroyed() &&
          Object.values(temporaryLedger.snapshot().live).every(
            (count) => count === 0,
          ),
      );
      temporaryCanvas
        .getContext("webgl2")
        .getExtension("WEBGL_lose_context")
        ?.loseContext();
      temporaryCanvas.remove();
    }
    record("20 scene lifecycle cycles", results.every(Boolean));
  } else if (id === "T08") {
    const city = await tiles("/fixtures/generated/city.json", true);
    record(
      "city triangles loaded",
      city.statistics.numberOfTrianglesSelected === 1228800,
      { triangles: city.statistics.numberOfTrianglesSelected },
    );
  } else {
    throw new Error(`Unknown baseline scene ${id}`);
  }
  await until(
    () => objects.every((object) => object.ready !== false),
    "scene resources ready",
  );
  // Let image decoding, glyph atlases, and final derived commands settle.
  for (let i = 0; i < 30; i++) {
    await new Promise(requestAnimationFrame);
  }
  ready = true;
  readyMs = performance.now() - start;
}

window.baseline = {
  get ready() {
    return ready;
  },
  get failure() {
    return failure;
  },
  capture: pixels,
  startMeasurement(trajectory = false) {
    counters.renderCpu.length = 0;
    counters.raf.length = 0;
    previousFrame = undefined;
    collecting = true;
    if (trajectory) {
      const epoch = performance.now();
      beforeFrame = (now) =>
        view(6000, ((now - epoch) / 30000) * Math.PI * 2, -1.3);
    }
  },
  stopMeasurement() {
    collecting = false;
    beforeFrame = undefined;
  },
  report() {
    return {
      diagnostic: {
        frame: scene.frameState.frameNumber,
        msaa: scene.msaaSamples,
        globe: scene.globe?._surface._tilesToRender.map((tile) => ({
          x: tile.x,
          y: tile.y,
          level: tile.level,
          state: tile.state,
          imagery: tile.data.imagery.map((item) => ({
            ready: item.readyImagery?.state,
            loading: item.loadingImagery?.state,
          })),
        })),
        pickDepths: scene.defaultView.frustumCommandsList.map((_, i) =>
          scene._picking
            .getPickDepth(scene, i)
            .getDepth(scene.context, width / 2, height / 2),
        ),
      },
      id,
      ready,
      failure,
      gpu,
      width,
      height,
      dpr: devicePixelRatio,
      time: C.JulianDate.toIso8601(time),
      loadMs: readyMs,
      errors,
      checks,
      counters,
      resources: ledger.snapshot(),
      tiles: objects
        .filter((object) => object instanceof C.Cesium3DTileset)
        .map((object) => ({
          selected: object.statistics.selected,
          triangles: object.statistics.numberOfTrianglesSelected,
          geometryBytes: object.statistics.geometryByteLength,
          textureBytes: object.statistics.texturesByteLength,
          totalMemoryUsageInBytes: object.totalMemoryUsageInBytes,
        })),
    };
  },
  destroy() {
    stopped = true;
    scene.destroy();
    return {
      destroyed: scene.isDestroyed(),
      resources: ledger.snapshot(),
      errors,
      failure,
    };
  },
};
initialize().catch((error) => {
  failure = String(error.stack);
});
