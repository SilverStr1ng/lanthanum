/*global Cesium*/
import {
  modelLocation,
  modelPlacement,
  modelView,
  populateModelWorld,
  loadWorldModels,
} from "../../Apps/WebGPU/modelWorld.js";
const C = Cesium;
async function settle(scene) {
  const deadline = performance.now() + 30000;
  do {
    scene.render();
    await new Promise(requestAnimationFrame);
    if (performance.now() > deadline) {
      throw new Error(
        `Model world terrain timeout ${JSON.stringify(scene.statistics)}`,
      );
    }
  } while (
    !scene.globe.tilesLoaded ||
    scene.statistics.pendingTiles ||
    !scene.statistics.selectedTiles
  );
  scene.render();
}
function project(scene, lon, lat, height) {
  const point = C.Cartesian3.fromDegrees(lon, lat, height),
    view = C.Matrix4.multiplyByPoint(
      scene.camera.viewMatrix,
      point,
      new C.Cartesian3(),
    ),
    clip = C.Matrix4.multiplyByVector(
      scene.camera.frustum.projectionMatrix,
      new C.Cartesian4(view.x, view.y, view.z, 1),
      new C.Cartesian4(),
    );
  return new C.Cartesian2(
    (clip.x / clip.w + 1) * 256,
    (1 - clip.y / clip.w) * 256,
  );
}
export async function globeModels(scene, check, result, capture) {
  const { behind, front } = populateModelWorld(scene);
  const models = await loadWorldModels(scene);
  const { longitude, latitude, height } = modelLocation;
  modelView(scene, "top");
  scene.camera.frustum.near = 0.25;
  scene.camera.frustum.far = 30000000;
  await settle(scene);
  const center = project(scene, longitude, latitude, height),
    buried = project(scene, longitude + 0.03, latitude, 1000);
  check(
    "geographic model over nonflat terrain occludes the underlying Primitive",
    (await scene.pickAsync(center))?.primitive === models[0],
  );
  const image = await capture(scene, "world-top");
  const unique = new Set();
  for (let i = 0; i < image.length; i += 4) {
    unique.add(`${image[i]},${image[i + 1]},${image[i + 2]}`);
  }
  const terrainPoint = scene.globe.pick(
    scene.camera.getPickRay(new C.Cartesian2(270, 270)),
    scene,
  );
  check(
    "combined scene contains real imagery and elevated terrain",
    scene.statistics.imageryTextures > 0 &&
      unique.size > 40 &&
      C.Cartographic.fromCartesian(terrainPoint).height > 3000,
    {
      colors: unique.size,
      statistics: scene.statistics,
      height: C.Cartographic.fromCartesian(terrainPoint).height,
    },
  );
  check(
    "terrain occludes a model below the ridge",
    (await scene.pickAsync(buried))?.id === "globe",
  );
  scene.globe.show = false;
  check(
    "buried model is drawable when occluding terrain is hidden",
    (await scene.pickAsync(buried))?.primitive === models[2],
  );
  scene.globe.show = true;
  models[0].show = false;
  check(
    "hiding foreground model reveals the original Primitive",
    (await scene.pickAsync(center))?.primitive === behind,
  );
  models[0].show = true;
  front.show = true;
  check(
    "foreground Primitive occludes model using the same ID and depth attachments",
    (await scene.pickAsync(center))?.primitive === front,
  );
  await capture(scene, "world-primitive-front");
  front.show = false;
  models[0].modelMatrix = modelPlacement(longitude, latitude, 2000, 400);
  behind.show = false;
  check(
    "modelMatrix update moves model beneath terrain without changing other models",
    (await scene.pickAsync(center))?.id === "globe" &&
      models[1].ready &&
      models[3].ready,
  );
  models[0].modelMatrix = modelPlacement(longitude, latitude, height, 400);
  behind.show = true;
  check(
    "restored modelMatrix restores model object ID",
    (await scene.pickAsync(center))?.primitive === models[0],
  );
  for (const view of ["near", "high", "orbit"]) {
    modelView(scene, view);
    await settle(scene);
    const frame = await capture(scene, `world-${view}`);
    const nonblack = frame.reduce(
      (count, value, index) => count + (index % 4 === 1 && value > 5 ? 1 : 0),
      0,
    );
    check(
      `${view} view preserves user frustum and visible globe`,
      scene.camera.frustum.near === 0.25 &&
        scene.camera.frustum.far === 30000000 &&
        nonblack > 1000,
      { nonblack, statistics: scene.statistics },
    );
    if (view !== "orbit") {
      const point = project(scene, longitude, latitude, height);
      check(
        `${view} view picks geographic model`,
        (await scene.pickAsync(point))?.primitive === models[0],
        point,
      );
    }
  }
  modelView(scene, "top");
  await settle(scene);
  const oldId = models[0]._objectId;
  scene.models.remove(models[0]);
  const replacement = await C.WebGPUModel.fromGltfAsync({
    scene,
    url: "/Specs/WebGPU/fixtures/models/box.glb",
    id: "replacement",
    modelMatrix: modelPlacement(longitude, latitude, height, 400),
  });
  scene.models.add(replacement);
  check(
    "same asset reload creates a new object and never reuses a stale ID",
    replacement._objectId > oldId &&
      (await scene.pickAsync(center))?.primitive === replacement,
  );
  result.stages.push({
    name: "combined globe",
    statistics: scene.statistics,
    resources: scene.resourceStatistics,
    loading: models.slice(1).map((m) => m.loadStatistics),
  });
  for (const model of [...models, replacement]) {
    model.destroy();
  }
}
