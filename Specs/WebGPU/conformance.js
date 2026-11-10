/*global Cesium*/
const C = Cesium,
  result = (window.results = { checks: [], cases: [] });
window.conformanceFrames = [];
function check(name, passed, detail) {
  result.checks.push({ name, passed, detail });
}
const contexts = [],
  getContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type, ...args) {
  contexts.push(type);
  return getContext.call(this, type, ...args);
};
function position(height, distance = 0) {
  const eye = C.Cartesian3.fromDegrees(30, 20, height),
    enu = C.Transforms.eastNorthUpToFixedFrame(eye);
  const direction = C.Matrix4.multiplyByPointAsVector(
      enu,
      C.Cartesian3.UNIT_Y,
      new C.Cartesian3(),
    ),
    up = C.Matrix4.multiplyByPointAsVector(
      enu,
      C.Cartesian3.UNIT_Z,
      new C.Cartesian3(),
    );
  const model = C.Matrix4.clone(enu);
  C.Matrix4.setTranslation(
    model,
    C.Cartesian3.add(
      eye,
      C.Cartesian3.multiplyByScalar(direction, distance, new C.Cartesian3()),
      new C.Cartesian3(),
    ),
    model,
  );
  return { eye, direction, up, model };
}
async function draw(scene, primitive) {
  const deadline = performance.now() + 15000;
  do {
    scene.initializeFrame();
    scene.render();
    await new Promise(requestAnimationFrame);
    if (performance.now() > deadline) {
      throw new Error("Primitive readiness timeout");
    }
  } while (!primitive.ready);
  scene.initializeFrame();
  scene.render();
}
async function pick(scene) {
  let done = false,
    value,
    error;
  scene.pickAsync(new C.Cartesian2(128, 128)).then(
    (answer) => {
      value = answer;
      done = true;
    },
    (reason) => {
      error = reason;
      done = true;
    },
  );
  const deadline = performance.now() + 5000;
  while (!done) {
    scene.initializeFrame();
    scene.render();
    await new Promise(requestAnimationFrame);
    if (performance.now() > deadline) {
      throw new Error("Pick timeout");
    }
  }
  if (error) {
    throw error;
  }
  return value;
}
async function pixels(scene, backend, name) {
  const bytes =
    backend === "webgpu"
      ? await scene.captureAsync()
      : scene.context.readPixels({ width: 256, height: 256 });
  const rgba = new Uint8Array(bytes.length);
  for (let y = 0; y < 256; y++) {
    const row = backend === "webgpu" ? y : 255 - y;
    rgba.set(bytes.subarray(row * 1024, (row + 1) * 1024), y * 1024);
  }
  let binary = "";
  for (let i = 0; i < rgba.length; i += 8192) {
    binary += String.fromCharCode(...rgba.subarray(i, i + 8192));
  }
  window.conformanceFrames.push({
    name: `${backend}-${name}`,
    width: 256,
    height: 256,
    rgba: btoa(binary),
  });
  return [...rgba.slice((128 * 256 + 128) * 4, (128 * 256 + 128) * 4 + 4)];
}
async function run() {
  for (const backend of ["webgl2", "webgpu"]) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    document.getElementById("scene").replaceWith(canvas);
    canvas.id = "scene";
    contexts.length = 0;
    const scene = await C.Scene.createAsync({
      canvas,
      backend,
      orderIndependentTranslucency: false,
      contextOptions: { webgl: { antialias: false, alpha: false } },
    });
    scene.backgroundColor = C.Color.BLACK;
    if (backend === "webgl2") {
      scene.highDynamicRange = false;
      scene.logarithmicDepthBuffer = false;
      scene.postProcessStages.fxaa.enabled = false;
    } else {
      result.adapter = scene.context.capabilities;
    }
    const cases = [];
    for (const appearance of ["instance", "material"]) {
      for (const st of [undefined, 0.5, -2, 2]) {
        cases.push({
          name: `uv-${appearance}-${st ?? "none"}`,
          height: 1000,
          distance: 10,
          st,
          appearance,
          expected: 255,
        });
      }
    }
    for (const height of [0, 5000]) {
      for (const distance of [1, 2, 10]) {
        cases.push({
          name: `near-${height}-${distance}`,
          height,
          distance,
          expected: 255,
        });
      }
    }
    for (const shape of ["box", "ellipsoid"]) {
      for (const inside of [false, true]) {
        cases.push({
          name: `closed-${shape}-${inside ? "inside" : "outside"}`,
          shape,
          inside,
          height: 1000,
          distance: inside ? 0 : 10,
          transparent: true,
          expected: inside ? 128 : 192,
        });
      }
    }
    for (const item of cases) {
      const at = position(item.height, item.distance);
      scene.camera.setView({
        destination: at.eye,
        orientation: { direction: at.direction, up: at.up },
      });
      scene.camera.frustum.near = 0.1;
      scene.camera.frustum.far = 30000000;
      const dimensions = item.transparent ? 4 : 0.3;
      const description =
        item.shape === "ellipsoid"
          ? new C.EllipsoidGeometry({
              radii: new C.Cartesian3(2, 2, 2),
              vertexFormat: C.VertexFormat.POSITION_NORMAL_AND_ST,
            })
          : C.BoxGeometry.fromDimensions({
              dimensions: new C.Cartesian3(dimensions, dimensions, dimensions),
              vertexFormat: C.VertexFormat.POSITION_NORMAL_AND_ST,
            });
      const geometry = description.constructor.createGeometry(description);
      if (item.st === undefined) {
        delete geometry.attributes.st;
      } else {
        geometry.attributes.st.values.fill(item.st);
      }
      const color = new C.Color(1, 0, 0, item.transparent ? 128 / 255 : 1);
      const appearance =
        item.appearance === "material"
          ? new C.MaterialAppearance({
              flat: true,
              translucent: false,
              material: C.Material.fromType("Color", { color }),
            })
          : new C.PerInstanceColorAppearance({
              flat: true,
              closed: !!item.transparent,
              translucent: !!item.transparent,
            });
      const primitive = scene.primitives.add(
        new C.Primitive({
          asynchronous: false,
          geometryInstances: new C.GeometryInstance({
            geometry,
            modelMatrix: at.model,
            id: item.name,
            attributes: {
              color: C.ColorGeometryInstanceAttribute.fromColor(color),
            },
          }),
          appearance,
        }),
      );
      await draw(scene, primitive);
      const pixel = await pixels(scene, backend, item.name),
        hit = await pick(scene);
      result.cases.push({
        backend,
        name: item.name,
        pixel,
        id: hit?.id,
        near: scene.camera.frustum.near,
        far: scene.camera.frustum.far,
      });
      check(
        `${backend} ${item.name} color`,
        Math.abs(pixel[0] - item.expected) <= 3 &&
          pixel[1] <= 3 &&
          pixel[2] <= 3,
        pixel,
      );
      check(`${backend} ${item.name} ID`, hit?.id === item.name, hit?.id);
      check(
        `${backend} ${item.name} explicit frustum`,
        scene.camera.frustum.near === 0.1 &&
          scene.camera.frustum.far === 30000000,
        { near: scene.camera.frustum.near, far: scene.camera.frustum.far },
      );
      scene.primitives.remove(primitive);
    }
    if (backend === "webgpu") {
      check(
        "native conformance never creates a WebGL context",
        !contexts.some((type) => /webgl|experimental-webgl/.test(type)),
        contexts,
      );
      check(
        "native conformance has no validation errors",
        scene.context.errors.length === 0,
        scene.context.errors,
      );
    }
    scene.destroy();
    if (backend === "webgpu") {
      check(
        "native conformance releases all resources",
        scene.resourceStatistics.live === 0,
        scene.resourceStatistics,
      );
    }
  }
}
run()
  .then(() => {
    result.passed = result.checks.every((check) => check.passed);
  })
  .catch((error) => {
    result.passed = false;
    result.error = String(error.stack);
  })
  .finally(() => {
    result.done = true;
  });
