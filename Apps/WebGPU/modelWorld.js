/*global Cesium*/
const C = Cesium;
export const modelLocation = Object.freeze({
  longitude: 30.234375,
  latitude: 20.390625,
  height: 4500,
});
// Independent model-world fixture: two smooth hills with a known 3300 m summit.
function modelTerrain() {
  const scheme = new C.GeographicTilingScheme(),
    size = 33;
  const provider = new C.CustomHeightmapTerrainProvider({
    width: size,
    height: size,
    callback(x, y, level) {
      const rectangle = scheme.tileXYToRectangle(x, y, level),
        values = new Float32Array(size * size);
      for (let row = 0; row < size; row++) {
        for (let column = 0; column < size; column++) {
          const lon =
              C.Math.toDegrees(
                rectangle.west + (rectangle.width * column) / (size - 1),
              ) - modelLocation.longitude,
            lat =
              C.Math.toDegrees(
                rectangle.north - (rectangle.height * row) / (size - 1),
              ) - modelLocation.latitude;
          values[row * size + column] =
            800 +
            2500 * Math.exp(-(lon * lon + lat * lat) / 0.0025) +
            1200 * Math.exp(-((lon - 0.08) ** 2 + (lat - 0.06) ** 2) / 0.0005);
        }
      }
      return values;
    },
  });
  provider.getLevelMaximumGeometricError = (level) => 500000 / 2 ** level;
  return provider;
}
export function modelPlacement(
  longitude,
  latitude,
  height,
  scale = 1,
  heading = 0,
) {
  const frame = C.Transforms.eastNorthUpToFixedFrame(
    C.Cartesian3.fromDegrees(longitude, latitude, height),
  );
  const turn = C.Matrix4.fromRotationTranslation(
    C.Matrix3.fromRotationZ(heading),
  );
  C.Matrix4.multiply(frame, turn, frame);
  return C.Matrix4.multiplyByUniformScale(frame, scale, frame);
}
export function modelView(scene, view = "near") {
  const { longitude, latitude } = modelLocation;
  const ranges = { near: 18000, high: 80000, orbit: 18000000, top: 18000 };
  scene.camera.lookAt(
    C.Cartesian3.fromDegrees(longitude, latitude, 3300),
    new C.HeadingPitchRange(
      0,
      view === "top" || view === "orbit" ? -Math.PI / 2 : -0.65,
      ranges[view],
    ),
  );
  scene.camera.lookAtTransform(C.Matrix4.IDENTITY);
}
export function populateModelWorld(scene) {
  scene.globe = new C.Globe();
  scene.globe.tileCacheSize = 32;
  scene.globe.maximumScreenSpaceError = 4;
  scene.globe.terrainProvider = modelTerrain();
  scene.globe.enableLighting = true;
  scene.globe.imageryLayers.addImageryProvider(
    new C.UrlTemplateImageryProvider({
      url: "/Build/CesiumUnminified/Assets/Textures/NaturalEarthII/{z}/{x}/{reverseY}.jpg",
      maximumLevel: 2,
      tilingScheme: new C.GeographicTilingScheme(),
    }),
  );
  const { longitude, latitude } = modelLocation;
  function primitive(id, height, dimensions, color) {
    return scene.primitives.add(
      new C.Primitive({
        geometryInstances: new C.GeometryInstance({
          geometry: C.BoxGeometry.fromDimensions({
            dimensions,
            vertexFormat: C.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
          }),
          modelMatrix: modelPlacement(longitude, latitude, height),
          attributes: {
            color: C.ColorGeometryInstanceAttribute.fromColor(color),
          },
          id,
        }),
        appearance: new C.PerInstanceColorAppearance({
          flat: true,
          translucent: false,
          closed: true,
        }),
        asynchronous: false,
      }),
    );
  }
  const behind = primitive(
    "模型下方的 Primitive",
    3700,
    new C.Cartesian3(600, 600, 200),
    C.Color.YELLOW,
  );
  const front = primitive(
    "模型上方的 Primitive",
    5500,
    new C.Cartesian3(300, 300, 300),
    C.Color.CYAN,
  );
  front.show = false;
  modelView(scene);
  return { behind, front };
}
export async function loadWorldModels(scene, signal) {
  const { longitude, latitude, height } = modelLocation;
  const definitions = [
    ["纹理盒体 GLB", "box.glb", longitude, latitude, height, 400, 0],
    [
      "旋转纹理盒体 glTF",
      "box.gltf",
      longitude - 0.025,
      latitude + 0.01,
      4200,
      500,
      Math.PI / 6,
    ],
    ["地形下方的模型", "box.glb", longitude + 0.03, latitude, 1000, 400, 0],
    [
      "JPEG 纹理模型",
      "jpeg.gltf",
      longitude - 0.005,
      latitude - 0.025,
      3800,
      600,
      0,
    ],
  ];
  const models = [];
  try {
    for (const [id, file, lon, lat, altitude, scale, heading] of definitions) {
      const model = await C.WebGPUModel.fromGltfAsync({
        scene,
        signal,
        url: `/Specs/WebGPU/fixtures/models/${file}`,
        id,
        modelMatrix: modelPlacement(lon, lat, altitude, scale, heading),
      });
      models.push(model);
    }
    for (const model of models) {
      scene.models.add(model);
    }
    return models;
  } catch (error) {
    for (const model of models) {
      model.destroy();
    }
    throw error;
  }
}
