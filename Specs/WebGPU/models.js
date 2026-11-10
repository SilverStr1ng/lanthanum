/*global Cesium*/
import { lifecycle, destroyedDuringWork } from "./modelLifecycle.js";
import { globeModels } from "./modelGlobe.js";
const C = Cesium,
  result = (window.results = { checks: [], stages: [], expectedErrors: [] });
window.conformanceFrames = [];
const base = "/Specs/WebGPU/fixtures/models/";
function check(name, passed, detail) {
  result.checks.push({ name, passed, detail });
  if (!passed) {
    throw new Error(`${name}: ${JSON.stringify(detail)}`);
  }
}
function near(actual, expected, tolerance = 3) {
  return expected.every((v, i) => Math.abs(actual[i] - v) <= tolerance);
}
function placement(longitude = 30, latitude = 20, height = 0, scale = 1000) {
  const matrix = C.Transforms.eastNorthUpToFixedFrame(
    C.Cartesian3.fromDegrees(longitude, latitude, height),
  );
  return C.Matrix4.multiplyByUniformScale(matrix, scale, matrix);
}
async function capture(scene, name) {
  const bytes = await scene.captureAsync();
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  window.conformanceFrames.push({
    name,
    width: 512,
    height: 512,
    rgba: btoa(binary),
  });
  return bytes;
}
function pixel(bytes, x, y) {
  return [...bytes.slice((y * 512 + x) * 4, (y * 512 + x) * 4 + 4)];
}
function uvAt(scene, x, y) {
  const ray = scene.camera.getPickRay(new C.Cartesian2(x + 0.5, y + 0.5));
  const inverse = C.Matrix4.inverse(placement(), new C.Matrix4());
  const origin = C.Matrix4.multiplyByPoint(
    inverse,
    ray.origin,
    new C.Cartesian3(),
  );
  const direction = C.Matrix4.multiplyByPointAsVector(
    inverse,
    ray.direction,
    new C.Cartesian3(),
  );
  const t = -origin.z / direction.z;
  return [
    (origin.x + t * direction.x + 1) / 2,
    (1 - origin.y - t * direction.y) / 2,
  ];
}
function encode(v) {
  return Math.round(
    255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055),
  );
}
const pause = () => new Promise(requestAnimationFrame);
async function idle(scene) {
  const deadline = performance.now() + 15000;
  while (
    Object.values(scene.statistics.modelWork ?? {}).some(
      (v) => v?.active || v?.queued,
    )
  ) {
    if (performance.now() > deadline) {
      throw new Error(
        `Model task timeout ${JSON.stringify(scene.statistics.modelWork)}`,
      );
    }
    await pause();
  }
}
async function run() {
  const contexts = [],
    originalContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...args) {
    contexts.push(type);
    return originalContext.call(this, type, ...args);
  };
  const scene = await C.Scene.createAsync({
    canvas: document.getElementById("scene"),
    backend: "webgpu",
  });
  result.adapter = scene.context.capabilities;
  scene.camera.setView({ destination: C.Cartesian3.fromDegrees(30, 20, 5000) });
  const model = await C.WebGPUModel.fromGltfAsync({
    scene,
    url: `${base}plane.gltf`,
    id: "plane",
    modelMatrix: placement(),
  });
  check(
    "model becomes drawable without render loop and is not auto-added",
    model.ready && scene.statistics.frames === 0 && scene.models.length === 0,
    scene.statistics,
  );
  scene.models.add(model);
  scene.render();
  const frame = await capture(scene, "quadrants");
  for (const [name, x, y, rgb] of [
    ["upper-left", 212, 212, [255, 0, 0]],
    ["upper-right", 300, 212, [0, 255, 0]],
    ["lower-left", 212, 300, [0, 0, 255]],
    ["lower-right", 300, 300, [255, 255, 255]],
  ]) {
    check(
      `PNG ${name} direction and color`,
      near(pixel(frame, x, y), rgb),
      pixel(frame, x, y),
    );
  }
  const hit = await scene.pickAsync(new C.Cartesian2(212, 212));
  check(
    "model picks its own object and application ID",
    hit?.primitive === model && hit.id === "plane",
    hit?.id,
  );
  model.show = false;
  for (const name of [
    "u8",
    "u32",
    "nonindexed",
    "interleaved",
    "normalized8",
    "normalized16",
    "color-float",
    "color3",
    "vertex-tint",
    "no-texture",
    "gray",
    "gray-factor",
    "alpha-zero",
    "optional-fallback",
  ]) {
    const item = scene.models.add(
      await C.WebGPUModel.fromGltfAsync({
        scene,
        url: `${base}${name}.gltf`,
        id: name,
        modelMatrix: placement(),
      }),
    );
    scene.render();
    const bytes = await capture(scene, name),
      expected =
        name === "vertex-tint"
          ? [66, 92, 46, 255]
          : name === "no-texture"
            ? [188, 137, 255, 255]
            : name === "gray"
              ? [128, 128, 128, 255]
              : name === "gray-factor"
                ? [92, 92, 92, 255]
                : [255, 0, 0, 255];
    check(
      `${name} layout color and OPAQUE alpha`,
      near(pixel(bytes, 212, 212), expected),
      pixel(bytes, 212, 212),
    );
    const pick = await scene.pickAsync(new C.Cartesian2(212, 212));
    check(
      `${name} model ID`,
      pick?.primitive === item && pick.id === name,
      pick?.id,
    );
    scene.models.remove(item);
  }
  const spawn = async (name, options = {}) =>
    scene.models.add(
      await C.WebGPUModel.fromGltfAsync({
        scene,
        url: `${base}${name.includes(".") ? name : `${name}.gltf`}`,
        id: name,
        modelMatrix: placement(),
        ...options,
      }),
    );
  for (const [name, expected] of [
    [
      "repeat",
      [
        [255, 0, 0],
        [255, 255, 255],
        [255, 255, 255],
      ],
    ],
    [
      "mirror",
      [
        [255, 255, 255],
        [255, 0, 0],
        [255, 0, 0],
      ],
    ],
    [
      "clamp",
      [
        [255, 0, 0],
        [255, 0, 0],
        [255, 255, 255],
      ],
    ],
  ]) {
    const item = await spawn(name);
    scene.render();
    const bytes = await capture(scene, name);
    for (const [i, p] of [200, 232, 312].entries()) {
      check(`${name} UV sample ${p}`, near(pixel(bytes, p, p), expected[i]), {
        uv: uvAt(scene, p, p).map((v) => v * 4 - 1.5),
        actual: pixel(bytes, p, p),
        expected: expected[i],
      });
    }
    scene.models.remove(item);
  }
  const linear = await spawn("linear");
  scene.render();
  const linearBytes = await capture(scene, "linear");
  const uv = uvAt(scene, 256, 256),
    fx = uv[0] * 8 - 3.5,
    fy = uv[1] * 8 - 3.5,
    expectedLinear = [(1 - fx) * (1 - fy) + fx * fy, fx, fy].map(encode);
  check(
    "linear sampler interpolates in linear color space",
    near(pixel(linearBytes, 256, 256), expectedLinear),
    { actual: pixel(linearBytes, 256, 256), expected: expectedLinear, uv },
  );
  scene.models.remove(linear);
  const jpeg = await spawn("jpeg");
  scene.render();
  const jpegBytes = await capture(scene, "jpeg");
  const bitmap = await createImageBitmap(
    await (await fetch(`${base}bricks.jpg`)).blob(),
    { premultiplyAlpha: "none", colorSpaceConversion: "none" },
  );
  const control = document.createElement("canvas");
  control.width = bitmap.width;
  control.height = bitmap.height;
  const brush = control.getContext("2d");
  brush.drawImage(bitmap, 0, 0);
  const jpgUV = uvAt(scene, 212, 212),
    jpgExpected = [
      ...brush.getImageData(
        Math.floor(jpgUV[0] * bitmap.width),
        Math.floor(jpgUV[1] * bitmap.height),
        1,
        1,
      ).data,
    ];
  bitmap.close();
  check(
    "JPEG texture matches decoded interior source pixel",
    near(pixel(jpegBytes, 212, 212), jpgExpected, 5),
    { actual: pixel(jpegBytes, 212, 212), expected: jpgExpected },
  );
  scene.models.remove(jpeg);
  const box = await spawn("box.gltf");
  scene.render();
  const external = await capture(scene, "external-box");
  check(
    "external box is drawable and pickable",
    (await scene.pickAsync(new C.Cartesian2(256, 256)))?.primitive === box,
  );
  scene.models.remove(box);
  const glb = await spawn("box.glb");
  scene.render();
  const embedded = await capture(scene, "embedded-box");
  check(
    "GLB embedded geometry and PNG match external glTF",
    external.every((v, i) => Math.abs(v - embedded[i]) <= 3) &&
      (await scene.pickAsync(new C.Cartesian2(256, 256)))?.primitive === glb,
  );
  scene.models.remove(glb);
  const beforePipelines = scene.statistics.modelWork.pipelines.started;
  const leftMatrix = placement(30, 20, 0, 800),
    rightMatrix = C.Matrix4.clone(leftMatrix);
  C.Matrix4.multiplyByTranslation(
    leftMatrix,
    new C.Cartesian3(-1.8, 0, 0),
    leftMatrix,
  );
  C.Matrix4.multiplyByTranslation(
    rightMatrix,
    new C.Cartesian3(1.8, 0, 0),
    rightMatrix,
  );
  const left = await spawn("gray", { modelMatrix: leftMatrix }),
    right = await spawn("gray-factor", { modelMatrix: rightMatrix });
  scene.render();
  const pair = await capture(scene, "independent-draws");
  check(
    "same frame retains independent transform factor and ID",
    near(pixel(pair, 130, 256), [128, 128, 128]) &&
      near(pixel(pair, 382, 256), [92, 92, 92]) &&
      (await scene.pickAsync(new C.Cartesian2(130, 256)))?.primitive === left &&
      (await scene.pickAsync(new C.Cartesian2(382, 256)))?.primitive === right,
  );
  check(
    "factor and same-type textures reuse compatible pipelines",
    scene.statistics.modelWork.pipelines.started === beforePipelines,
    scene.statistics.modelWork.pipelines,
  );
  check(
    "different assets with identical geometry and image share GPU handles",
    left._packets[0].geometry.vertex === right._packets[0].geometry.vertex &&
      scene.statistics.modelWork.textures.entries === 2,
    scene.statistics.modelWork,
  );
  scene.models.remove(left);
  check(
    "removing shared A leaves B drawable",
    (await scene.pickAsync(new C.Cartesian2(382, 256)))?.primitive === right,
  );
  scene.models.remove(right);
  const multi = await spawn("multi", {
    modelMatrix: placement(30, 20, 0, 400),
  });
  scene.render();
  await capture(scene, "multi-node");
  check(
    "multi-node TRS matrix and reflected node occupy known reference points",
    (await scene.pickAsync(new C.Cartesian2(185, 256)))?.primitive === multi &&
      (await scene.pickAsync(new C.Cartesian2(362, 256)))?.primitive === multi,
  );
  const centerInverse = C.Matrix4.inverse(
      placement(30, 20, 0, 400),
      new C.Matrix4(),
    ),
    localCenter = C.Matrix4.multiplyByPoint(
      centerInverse,
      multi.boundingSphere.center,
      new C.Cartesian3(),
    );
  check(
    "nonuniform node bounds conservatively enclose known extents",
    localCenter.x > -2 &&
      localCenter.x < 3 &&
      multi.boundingSphere.radius >= 1200 &&
      multi.boundingSphere.radius < 2500,
    { localCenter, radius: multi.boundingSphere.radius },
  );
  scene.models.remove(multi);
  const rotated = await spawn("rotation");
  scene.render();
  const rotatedBytes = await capture(scene, "node-rotation");
  check(
    "node quaternion rotates the texture orientation",
    near(pixel(rotatedBytes, 212, 212), [0, 255, 0]),
    pixel(rotatedBytes, 212, 212),
  );
  scene.models.remove(rotated);
  const selected = await spawn("selected-scene", {
    sceneIndex: 1,
    modelMatrix: placement(30, 20, 0, 500),
  });
  check(
    "explicit glTF scene selects translated node",
    (await scene.pickAsync(new C.Cartesian2(345, 256)))?.primitive ===
      selected &&
      (await scene.pickAsync(new C.Cartesian2(200, 256))) === undefined,
  );
  scene.models.remove(selected);
  model.show = true;
  model.modelMatrix = C.Matrix4.multiplyByScale(
    placement(),
    new C.Cartesian3(-1, 0.5, 2),
    new C.Matrix4(),
  );
  scene.render();
  const reflection = await capture(scene, "negative-model-scale");
  check(
    "negative and nonuniform modelMatrix retains front-face rendering",
    near(pixel(reflection, 212, 235), [0, 255, 0]) &&
      (await scene.pickAsync(new C.Cartesian2(212, 235)))?.primitive === model,
    pixel(reflection, 212, 235),
  );
  model.modelMatrix = placement();
  const pendingHidden = scene.pickAsync(new C.Cartesian2(212, 212));
  model.show = false;
  model.show = true;
  check(
    "hide then reshow invalidates an earlier async model pick",
    (await pendingHidden) === undefined,
  );
  const pendingRemoved = scene.pickAsync(new C.Cartesian2(212, 212));
  scene.models.remove(model);
  check(
    "removing model invalidates an earlier async pick",
    (await pendingRemoved) === undefined,
  );
  let destroyedRejected = false;
  try {
    scene.models.add(model);
  } catch {
    destroyedRejected = true;
  }
  check("destroyed instance cannot be re-added", destroyedRejected);
  const back = await spawn("plane");
  back.modelMatrix = C.Matrix4.multiply(
    placement(),
    C.Matrix4.fromRotationTranslation(C.Matrix3.fromRotationX(Math.PI)),
    new C.Matrix4(),
  );
  scene.render();
  check(
    "single-sided geometry culls its back face",
    (await scene.pickAsync(new C.Cartesian2(256, 256))) === undefined,
  );
  scene.models.remove(back);
  const twoSided = await spawn("double-sided");
  twoSided.modelMatrix = C.Matrix4.multiply(
    placement(),
    C.Matrix4.fromRotationTranslation(C.Matrix3.fromRotationX(Math.PI)),
    new C.Matrix4(),
  );
  check(
    "doubleSided retains back face color and ID",
    (await scene.pickAsync(new C.Cartesian2(256, 256)))?.primitive === twoSided,
  );
  scene.models.remove(twoSided);
  await idle(scene);
  const emptyResources = scene.resourceStatistics.live;
  for (const name of [
    "required",
    "optional",
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
    "decode",
    "cycle",
    "normalized",
    "uv",
    "topology",
    "singular",
  ]) {
    let error;
    try {
      await spawn(`bad-${name}`);
    } catch (reason) {
      error = reason;
    }
    await idle(scene);
    check(
      `unsupported ${name} rejects and releases resources`,
      !!error &&
        error.message.includes(`bad-${name}.gltf`) &&
        scene.resourceStatistics.live === emptyResources,
      { error: error?.message, resources: scene.resourceStatistics },
    );
  }
  result.stages.push({
    name: "formats and materials",
    work: scene.statistics.modelWork,
  });
  await lifecycle(scene, check, result, placement);
  await destroyedDuringWork(check, result);
  await destroyedDuringWork(check, result, true);
  await globeModels(scene, check, result, capture);
  check(
    "models do not create hidden WebGL contexts",
    !contexts.some((type) => /webgl/.test(type)),
    contexts,
  );
  check(
    "model GPU validation stays clean",
    scene.context.errors.length === 0,
    scene.context.errors,
  );
  scene.destroy();
  check(
    "model scene releases all buffers and textures",
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
