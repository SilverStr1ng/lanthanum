/*global Cesium*/
const C = Cesium;
const result = (window.results = { checks: [] });
function check(name, passed, detail) {
  result.checks.push({ name, passed, detail });
  if (!passed) {
    throw new Error(`${name}: ${JSON.stringify(detail)}`);
  }
}
async function settle(scene) {
  const end = performance.now() + 30000;
  do {
    scene.render();
    await new Promise(requestAnimationFrame);
    if (performance.now() > end) {
      throw new Error(`Readiness timeout ${JSON.stringify(scene.statistics)}`);
    }
  } while (
    !scene.globe.tilesLoaded ||
    scene.statistics.selectedTiles === 0 ||
    scene.statistics.pendingTiles > 0
  );
  scene.render();
}
async function center(scene) {
  const bytes = await scene.captureAsync(),
    offset = (270 * 960 + 480) * 4;
  return [...bytes.slice(offset, offset + 4)];
}
async function waitPrimitive(scene, primitive) {
  const deadline = performance.now() + 15000;
  while (!primitive.ready) {
    scene.render();
    await new Promise(requestAnimationFrame);
    if (performance.now() > deadline) {
      throw new Error("Primitive readiness timeout");
    }
  }
  scene.render();
}
function instance(geometry, color, id, height = 2500) {
  return new C.GeometryInstance({
    geometry,
    id,
    modelMatrix: C.Transforms.eastNorthUpToFixedFrame(
      C.Cartesian3.fromDegrees(30, 20, height),
    ),
    attributes: {
      color: C.ColorGeometryInstanceAttribute.fromColor(color),
      show: new C.ShowGeometryInstanceAttribute(true),
    },
  });
}
function near(actual, expected, tolerance = 3) {
  return expected.every((n, i) => Math.abs(actual[i] - n) <= tolerance);
}
function solid(color, scheme = new C.GeographicTilingScheme()) {
  const image = document.createElement("canvas");
  image.width = image.height = 16;
  const context = image.getContext("2d");
  context.fillStyle = color;
  context.fillRect(0, 0, 16, 16);
  return new C.UrlTemplateImageryProvider({
    url: image.toDataURL(),
    maximumLevel: 0,
    tilingScheme: scheme,
  });
}
async function run() {
  const canvas = document.getElementById("scene");
  const scene = await C.Scene.createAsync({ canvas, backend: "webgpu" });
  result.adapter = scene.context.capabilities;
  scene.globe = new C.Globe();
  scene.globe.baseColor = C.Color.BLACK;
  scene.camera.setView({
    destination: C.Cartesian3.fromDegrees(30, 20, 18000000),
  });
  const layers = ["#ff0000", "#00ff00", "#0000ff", "#ffffff"].map((color) =>
    scene.globe.imageryLayers.addImageryProvider(solid(color)),
  );
  for (const layer of layers) {
    layer.alpha = 0.5;
  }
  await settle(scene);
  check(
    "four native imagery layers blend in collection order",
    near(await center(scene), [143, 159, 191]),
    await center(scene),
  );
  scene.globe.imageryLayers.lowerToBottom(layers[3]);
  await settle(scene);
  check(
    "imagery reorder updates composition",
    near(await center(scene), [48, 80, 143]),
    await center(scene),
  );
  scene.globe.imageryLayers.remove(layers[3]);
  await settle(scene);
  check(
    "imagery removal updates composition",
    near(await center(scene), [32, 64, 128]),
    await center(scene),
  );
  layers[2].show = false;
  await settle(scene);
  check(
    "imagery show and alpha update live",
    near(await center(scene), [64, 128, 0]),
    await center(scene),
  );
  check(
    "native imagery produces no GPU errors",
    scene.context.errors.length === 0,
    scene.context.errors,
  );
  scene.globe.terrainProvider = new C.CustomHeightmapTerrainProvider({
    width: 33,
    height: 33,
    callback: () => new Float32Array(33 * 33).fill(1000),
  });
  scene.camera.setView({
    destination: C.Cartesian3.fromDegrees(30, 20, 10000),
  });
  await settle(scene);
  const terrainHeight = () =>
    C.Cartographic.fromCartesian(
      scene.globe.pick(
        scene.camera.getPickRay(new C.Cartesian2(480, 270)),
        scene,
      ),
    ).height;
  check(
    "heightmap terrain renders and picks actual elevation",
    Math.abs(terrainHeight() - 1000) < 10,
    terrainHeight(),
  );
  scene.verticalExaggeration = 2;
  await settle(scene);
  check(
    "terrain exaggeration changes geometry and picking",
    Math.abs(terrainHeight() - 2000) < 10,
    terrainHeight(),
  );
  scene.verticalExaggeration = 1;
  await settle(scene);
  const box = scene.primitives.add(
    new C.Primitive({
      geometryInstances: new C.GeometryInstance({
        geometry: C.BoxGeometry.fromDimensions({
          dimensions: new C.Cartesian3(800, 800, 800),
          vertexFormat: C.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
        }),
        modelMatrix: C.Transforms.eastNorthUpToFixedFrame(
          C.Cartesian3.fromDegrees(30, 20, 2000),
        ),
        id: "standard-box",
        attributes: {
          color: C.ColorGeometryInstanceAttribute.fromColor(C.Color.RED),
          show: new C.ShowGeometryInstanceAttribute(true),
        },
      }),
      appearance: new C.PerInstanceColorAppearance({
        flat: true,
        translucent: false,
        closed: true,
      }),
    }),
  );
  const readyDeadline = performance.now() + 15000;
  while (!box.ready) {
    scene.render();
    await new Promise(requestAnimationFrame);
    if (performance.now() > readyDeadline) {
      throw new Error("Primitive readiness timeout");
    }
  }
  scene.render();
  check(
    "standard asynchronous Primitive draws geometry",
    near(await center(scene), [255, 0, 0]),
    await center(scene),
  );
  const picked = await scene.pickAsync(new C.Cartesian2(480, 270));
  check(
    "standard Primitive picks GeometryInstance id",
    picked?.primitive === box && picked?.id === "standard-box",
    picked?.id,
  );
  const attributes = box.getGeometryInstanceAttributes("standard-box");
  attributes.color = C.ColorGeometryInstanceAttribute.toValue(C.Color.YELLOW);
  scene.render();
  check(
    "Primitive instance color updates",
    near(await center(scene), [255, 255, 0]),
    await center(scene),
  );
  attributes.show = C.ShowGeometryInstanceAttribute.toValue(false);
  scene.render();
  check(
    "hidden instance stops drawing and picking",
    (await scene.pickAsync(new C.Cartesian2(480, 270)))?.id === "globe",
  );
  scene.primitives.remove(box);
  check("Primitive removal destroys its resources", box.isDestroyed());
  const nonPickable = scene.primitives.add(
    new C.Primitive({
      allowPicking: false,
      geometryInstances: instance(
        C.BoxGeometry.fromDimensions({
          dimensions: new C.Cartesian3(500, 500, 500),
          vertexFormat: C.VertexFormat.POSITION_ONLY,
        }),
        C.Color.RED,
        "non-pickable",
      ),
      appearance: new C.PerInstanceColorAppearance({
        flat: true,
        translucent: false,
      }),
    }),
  );
  await waitPrimitive(scene, nonPickable);
  scene.globe.show = false;
  check(
    "allowPicking false does not return the visible object",
    (await scene.pickAsync(new C.Cartesian2(480, 270))) === undefined,
  );
  check(
    "allowPicking false cannot turn background into a hit",
    (await scene.pickAsync(new C.Cartesian2(2, 2))) === undefined,
  );
  scene.globe.show = true;
  scene.primitives.remove(nonPickable);
  const initiallyHidden = scene.primitives.add(
    new C.Primitive({
      show: false,
      geometryInstances: instance(
        C.BoxGeometry.fromDimensions({
          dimensions: new C.Cartesian3(500, 500, 500),
          vertexFormat: C.VertexFormat.POSITION_ONLY,
        }),
        C.Color.RED,
        "initially-hidden",
      ),
      appearance: new C.PerInstanceColorAppearance({
        flat: true,
        translucent: false,
      }),
    }),
  );
  await waitPrimitive(scene, initiallyHidden);
  check(
    "hidden Primitive completes asynchronous initialization",
    initiallyHidden.ready &&
      (await scene.pickAsync(new C.Cartesian2(480, 270)))?.id === "globe",
  );
  initiallyHidden.show = true;
  scene.render();
  check(
    "initially hidden Primitive becomes drawable",
    (await scene.pickAsync(new C.Cartesian2(480, 270)))?.id ===
      "initially-hidden",
  );
  scene.primitives.remove(initiallyHidden);
  scene.globe.terrainProvider = await C.CesiumTerrainProvider.fromUrl(
    "/Specs/WebGPU/fixtures/terrain/",
    { requestVertexNormals: true },
  );
  await settle(scene);
  check(
    "quantized-mesh binary terrain decodes and picks 1500 m",
    Math.abs(terrainHeight() - 1500) < 10,
    terrainHeight(),
  );
  scene.verticalExaggeration = 2;
  await settle(scene);
  check(
    "quantized-mesh exaggeration picks 3000 m",
    Math.abs(terrainHeight() - 3000) < 10,
    terrainHeight(),
  );
  scene.verticalExaggeration = 1;
  await settle(scene);
  scene.globe.showSkirts = false;
  scene.render();
  check(
    "quantized-mesh without skirts remains visible",
    (await scene.pickAsync(new C.Cartesian2(480, 270)))?.id === "globe",
  );
  scene.globe.showSkirts = true;
  check(
    "terrain and primitives produce no GPU errors",
    scene.context.errors.length === 0,
    scene.context.errors,
  );
  const hiddenBox = scene.primitives.add(
    new C.Primitive({
      asynchronous: false,
      geometryInstances: instance(
        C.BoxGeometry.fromDimensions({
          dimensions: new C.Cartesian3(500, 500, 500),
          vertexFormat: C.VertexFormat.POSITION_ONLY,
        }),
        C.Color.RED,
        "below-terrain",
        500,
      ),
      appearance: new C.PerInstanceColorAppearance({
        flat: true,
        translucent: false,
      }),
    }),
  );
  await waitPrimitive(scene, hiddenBox);
  check(
    "real terrain occludes a lower Primitive",
    (await scene.pickAsync(new C.Cartesian2(480, 270)))?.id === "globe",
  );
  scene.primitives.remove(hiddenBox);
  const nested = scene.primitives.add(new C.PrimitiveCollection());
  const material = C.Material.fromType("Color", { color: C.Color.CYAN });
  const ellipsoid = nested.add(
    new C.Primitive({
      geometryInstances: instance(
        new C.EllipsoidGeometry({
          radii: new C.Cartesian3(600, 600, 600),
          vertexFormat: C.VertexFormat.POSITION_NORMAL_AND_ST,
        }),
        C.Color.WHITE,
        "ellipsoid",
      ),
      appearance: new C.MaterialAppearance({
        material,
        flat: true,
        translucent: false,
      }),
    }),
  );
  await waitPrimitive(scene, ellipsoid);
  check(
    "Color material and ellipsoid geometry draw",
    near(await center(scene), [0, 255, 255]),
    await center(scene),
  );
  material.uniforms.color = C.Color.MAGENTA;
  scene.render();
  check(
    "material uniforms update live",
    near(await center(scene), [255, 0, 255]),
    await center(scene),
  );
  const pendingPick = scene.pickAsync(new C.Cartesian2(480, 270));
  nested.show = false;
  check(
    "hidden nested collection invalidates pending pick",
    (await pendingPick) === undefined,
  );
  nested.show = true;
  ellipsoid.modelMatrix = C.Matrix4.fromTranslation(
    new C.Cartesian3(100000, 0, 0),
  );
  scene.render();
  check(
    "Primitive modelMatrix moves geometry",
    (await scene.pickAsync(new C.Cartesian2(480, 270)))?.id === "globe",
  );
  scene.primitives.remove(nested);
  for (const [name, geometry] of [
    [
      "line",
      new C.SimplePolylineGeometry({
        arcType: C.ArcType.NONE,
        positions: [
          new C.Cartesian3(-1000, 0, 0),
          new C.Cartesian3(1000, 0, 0),
        ],
      }),
    ],
    [
      "point",
      new C.Geometry({
        attributes: {
          position: new C.GeometryAttribute({
            componentDatatype: C.ComponentDatatype.DOUBLE,
            componentsPerAttribute: 3,
            values: new Float64Array([0, 0, 0]),
          }),
        },
        primitiveType: C.PrimitiveType.POINTS,
      }),
    ],
  ]) {
    const primitive = scene.primitives.add(
      new C.Primitive({
        geometryInstances: instance(geometry, C.Color.RED, name),
        appearance: new C.PerInstanceColorAppearance({
          flat: true,
          translucent: false,
        }),
      }),
    );
    await waitPrimitive(scene, primitive);
    const bytes = await scene.captureAsync();
    let red = 0;
    for (let y = 266; y <= 274; y++) {
      for (let x = 476; x <= 484; x++) {
        const i = (y * 960 + x) * 4;
        if (bytes[i] > 240 && bytes[i + 1] < 10 && bytes[i + 2] < 10) {
          red++;
        }
      }
    }
    check(`standard ${name} topology is rasterized`, red > 0, red);
    scene.primitives.remove(primitive);
  }
  // Insert the near object first: transparent rendering must still sort back to front.
  scene.globe.imageryLayers.removeAll();
  scene.globe.baseColor = C.Color.BLACK;
  for (const [height, color, id] of [
    [3000, new C.Color(1, 0, 0, 0.5), "near"],
    [2500, new C.Color(0, 0, 1, 0.5), "far"],
  ]) {
    const geometry = new C.PlaneGeometry({
      vertexFormat: C.VertexFormat.POSITION_ONLY,
    });
    const item = instance(geometry, color, id, height);
    C.Matrix4.multiplyByScale(
      item.modelMatrix,
      new C.Cartesian3(1500, 1500, 1),
      item.modelMatrix,
    );
    const primitive = scene.primitives.add(
      new C.Primitive({
        asynchronous: false,
        geometryInstances: item,
        appearance: new C.PerInstanceColorAppearance({
          flat: true,
          translucent: true,
        }),
      }),
    );
    await waitPrimitive(scene, primitive);
  }
  check(
    "transparent Primitive order blends back to front",
    near(await center(scene), [128, 0, 64], 4),
    await center(scene),
  );
  check(
    "transparent Primitive pick returns nearest instance",
    (await scene.pickAsync(new C.Cartesian2(480, 270)))?.id === "near",
  );
  scene.primitives.removeAll();

  scene.globe.terrainProvider = new C.EllipsoidTerrainProvider();
  const map = document.createElement("canvas");
  map.width = map.height = 256;
  const brush = map.getContext("2d");
  brush.fillStyle = "#0000ff";
  brush.fillRect(0, 0, 256, 256);
  brush.fillStyle = "#ff0000";
  brush.fillRect(143, 68, 14, 14);
  brush.fillStyle = "#00ff00";
  brush.fillRect(0, 0, 8, 256);
  brush.fillStyle = "#ffff00";
  brush.fillRect(248, 0, 8, 256);
  brush.fillStyle = "#ffffff";
  brush.fillRect(0, 0, 256, 4);
  scene.globe.imageryLayers.addImageryProvider(
    new C.UrlTemplateImageryProvider({
      url: map.toDataURL(),
      maximumLevel: 0,
      tilingScheme: new C.WebMercatorTilingScheme(),
    }),
  );
  for (const [longitude, latitude, expected, name] of [
    [30, 60, [255, 0, 0], "Mercator latitude control point"],
    [-179, 0, [0, 255, 0], "west date line"],
    [179, 0, [255, 255, 0], "east date line"],
    [30, 89, [255, 255, 255], "Mercator polar extension"],
  ]) {
    scene.camera.setView({
      destination: C.Cartesian3.fromDegrees(longitude, latitude, 1000000),
    });
    await settle(scene);
    check(name, near(await center(scene), expected, 5), await center(scene));
  }
  scene.globe.imageryLayers.removeAll();
  const local = await C.SingleTileImageryProvider.fromUrl(
    solid("#ff00ff").url,
    { rectangle: C.Rectangle.fromDegrees(29, 19, 31, 21) },
  );
  scene.globe.imageryLayers.addImageryProvider(local);
  for (const [longitude, expected, name] of [
    [30, [255, 0, 255], "local SingleTile imagery inside rectangle"],
    [32, [0, 0, 0], "local imagery clipped outside rectangle"],
  ]) {
    scene.camera.setView({
      destination: C.Cartesian3.fromDegrees(longitude, 20, 100000),
    });
    await settle(scene);
    check(name, near(await center(scene), expected), await center(scene));
  }
  scene.globe.imageryLayers.removeAll();
  const failing = solid("#ff0000"),
    originalRequest = failing.requestImage.bind(failing);
  Object.defineProperty(failing, "maximumLevel", { value: 2 });
  failing.requestImage = (x, y, level, request) =>
    level === 0
      ? originalRequest(x, y, level, request)
      : Promise.reject(new Error("Intentional child imagery failure"));
  scene.globe.imageryLayers.addImageryProvider(failing);
  await settle(scene);
  check(
    "failed child imagery retains ready ancestor",
    near(await center(scene), [255, 0, 0]) &&
      scene.statistics.tileErrors.length > 0,
    scene.statistics,
  );
  scene.globe.imageryLayers.removeAll();
  const dateImage = document.createElement("canvas");
  dateImage.width = 32;
  dateImage.height = 16;
  const dateBrush = dateImage.getContext("2d");
  dateBrush.fillStyle = "red";
  dateBrush.fillRect(0, 0, 16, 16);
  dateBrush.fillStyle = "blue";
  dateBrush.fillRect(16, 0, 16, 16);
  scene.globe.imageryLayers.addImageryProvider(
    await C.SingleTileImageryProvider.fromUrl(dateImage.toDataURL(), {
      rectangle: C.Rectangle.fromDegrees(170, -10, -170, 10),
    }),
  );
  for (const [longitude, expected] of [
    [175, [255, 0, 0]],
    [-175, [0, 0, 255]],
  ]) {
    scene.camera.setView({
      destination: C.Cartesian3.fromDegrees(longitude, 0, 100000),
    });
    await settle(scene);
    check(
      `local date-line imagery at ${longitude}`,
      near(await center(scene), expected),
      await center(scene),
    );
  }
  scene.globe.maximumScreenSpaceError = 1e9;
  for (const [longitude, expected] of [
    [175, [255, 0, 0]],
    [-175, [0, 0, 255]],
  ]) {
    scene.camera.setView({
      destination: C.Cartesian3.fromDegrees(longitude, 0, 18000000),
    });
    await settle(scene);
    check(
      `root LOD local date-line imagery at ${longitude}`,
      near(await center(scene), expected),
      await center(scene),
    );
  }
  scene.globe.maximumScreenSpaceError = 2;
  scene.globe.imageryLayers.removeAll();
  let policyReady = false;
  const discard = solid("#ff0000"),
    redRequest = discard.requestImage.bind(discard);
  Object.defineProperties(discard, {
    maximumLevel: { value: 2 },
    tileDiscardPolicy: {
      value: {
        isReady: () => policyReady,
        shouldDiscardImage: (image) => image.width === 32,
      },
    },
  });
  const greenImage = document.createElement("canvas");
  greenImage.width = 32;
  greenImage.height = 32;
  greenImage.getContext("2d").fillStyle = "green";
  greenImage.getContext("2d").fillRect(0, 0, 32, 32);
  discard.requestImage = (x, y, level, request) =>
    level === 0
      ? redRequest(x, y, level, request)
      : Promise.resolve(greenImage);
  scene.globe.imageryLayers.addImageryProvider(discard);
  for (let i = 0; i < 15; i++) {
    scene.render();
    await new Promise(requestAnimationFrame);
  }
  check(
    "discard policy readiness keeps tiles pending",
    !scene.globe.tilesLoaded,
  );
  policyReady = true;
  await settle(scene);
  check(
    "late discard policy rejects child and retains ancestor",
    near(await center(scene), [255, 0, 0]),
    await center(scene),
  );
  scene.globe.imageryLayers.removeAll();
  check(
    "streaming GPU validation stays clean",
    scene.context.errors.length === 0,
    scene.context.errors,
  );
  await settle(scene);
  scene.camera.setView({
    destination: C.Cartesian3.fromDegrees(30, 20, 100000),
  });
  await settle(scene);
  const beforeLoops = scene.resourceStatistics.live;
  for (let loop = 0; loop < 10; loop++) {
    const layer = scene.globe.imageryLayers.addImageryProvider(local);
    const primitive = scene.primitives.add(
      new C.Primitive({
        geometryInstances: instance(
          C.BoxGeometry.fromDimensions({
            dimensions: new C.Cartesian3(500, 500, 500),
            vertexFormat: C.VertexFormat.POSITION_ONLY,
          }),
          C.Color.RED,
          loop,
        ),
        appearance: new C.PerInstanceColorAppearance({ flat: true }),
      }),
    );
    await settle(scene);
    await waitPrimitive(scene, primitive);
    scene.primitives.remove(primitive);
    scene.globe.imageryLayers.remove(layer, false);
    await settle(scene);
    check(
      `add/remove cycle ${loop + 1} releases textures and primitive buffers`,
      scene.resourceStatistics.live === beforeLoops &&
        scene.statistics.imageryTextures === 0,
      scene.resourceStatistics,
    );
  }
  scene.destroy();
  check(
    "layer textures and draws are released",
    scene.resourceStatistics.live === 0,
    scene.resourceStatistics,
  );
  const travel = await C.Scene.createAsync({
    canvas,
    backend: "webgpu",
    maximumTerrainLevel: 6,
    maximumImageryTextures: 24,
    maximumImageryBytes: 24 * 16 * 16 * 4,
  });
  travel.globe = new C.Globe();
  travel.globe.tileCacheSize = 24;
  const travelProvider = solid("#00ff00");
  Object.defineProperty(travelProvider, "maximumLevel", { value: 6 });
  travel.globe.imageryLayers.addImageryProvider(travelProvider);
  result.travel = [];
  for (let loop = 0; loop < 10; loop++) {
    for (const longitude of [-150, -60, 30, 120]) {
      travel.camera.setView({
        destination: C.Cartesian3.fromDegrees(longitude, 20, 2000000),
      });
      await settle(travel);
    }
    result.travel.push({
      ...travel.resourceStatistics,
      imageryTextures: travel.statistics.imageryTextures,
    });
  }
  const plateau = result.travel.slice(3),
    lives = plateau.map((s) => s.live);
  check(
    "ten camera circuits keep bounded texture residency",
    result.travel.every((s) => s.imageryTextures <= 24),
    result.travel,
  );
  check(
    "ten camera circuits reach a stable GPU resource plateau",
    Math.max(...lives) - Math.min(...lives) <= 10,
    result.travel,
  );
  check(
    "camera streaming has no GPU validation errors",
    travel.context.errors.length === 0,
    travel.context.errors,
  );
  travel.destroy();
  check(
    "travel scene releases all resources",
    travel.resourceStatistics.live === 0,
    travel.resourceStatistics,
  );
  const cancelled = await C.Scene.createAsync({ canvas, backend: "webgpu" });
  cancelled.globe = new C.Globe();
  cancelled.globe.terrainProvider = new C.CustomHeightmapTerrainProvider({
    width: 33,
    height: 33,
    callback: () =>
      new Promise((resolve) =>
        setTimeout(() => resolve(new Float32Array(1089).fill(1000)), 100),
      ),
  });
  cancelled.camera.setView({
    destination: C.Cartesian3.fromDegrees(30, 20, 10000),
  });
  cancelled.render();
  cancelled.destroy();
  await new Promise((resolve) => setTimeout(resolve, 200));
  check(
    "destroy during terrain loading prevents late GPU uploads",
    cancelled.resourceStatistics.live === 0,
    cancelled.resourceStatistics,
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
