/*global window, document*/
export async function checkDemo(page, url, output) {
  const checks = [];
  const check = (name, passed, detail) => {
    checks.push({ name, passed, detail });
    if (!passed) {
      throw new Error(`Demo ${name}: ${JSON.stringify(detail)}`);
    }
  };
  const position = () =>
    page.evaluate(() => {
      const p = window.demoScene.camera.positionWC;
      return [p.x, p.y, p.z];
    });
  const ready = () =>
    page.waitForFunction(
      () =>
        document.getElementById("terrain")?.getAttribute("aria-busy") !==
          "true" &&
        window.demoScene?.globe?.tilesLoaded &&
        window.demoScene.statistics.selectedTiles > 0 &&
        window.demoScene.statistics.pendingTiles === 0 &&
        !window.demoScene.isDestroyed(),
    );
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${url}/Apps/WebGPU/index.html`);
  await ready();
  await page.screenshot({ path: `${output}/demo.png` });
  const before = await position();
  const trackedPoint = await page.evaluate(() => {
    const scene = window.demoScene;
    const C = window.Cesium;
    const point = scene.camera.pickEllipsoid(new C.Cartesian2(760, 350));
    return [point.x, point.y, point.z];
  });
  await page.mouse.move(760, 350);
  await page.mouse.down();
  await page.mouse.move(850, 400, { steps: 8 });
  await page.mouse.up();
  const draggedPoint = await page.evaluate((point) => {
    const scene = window.demoScene,
      C = window.Cesium;
    const transform = C.Matrix4.multiply(
      scene.camera.frustum.projectionMatrix,
      scene.camera.viewMatrix,
      new C.Matrix4(),
    );
    const clip = C.Matrix4.multiplyByVector(
      transform,
      new C.Cartesian4(...point, 1),
      new C.Cartesian4(),
    );
    return { x: (clip.x / clip.w + 1) * 640, y: (1 - clip.y / clip.w) * 400 };
  }, trackedPoint);
  check(
    "left drag moves the surface with the pointer",
    draggedPoint.x > 760 && draggedPoint.y > 350,
    draggedPoint,
  );
  check(
    "pointer drag moves the camera",
    JSON.stringify(before) !== JSON.stringify(await position()),
  );
  const altitude = await page.evaluate(
    () => window.demoScene.camera.positionCartographic.height,
  );
  await page.mouse.wheel(0, -300);
  await page.waitForFunction(
    (height) => window.demoScene.camera.positionCartographic.height < height,
    altitude,
  );
  check("wheel zooms toward the globe", true);
  await page.getByRole("button", { name: "全球视角" }).click();
  await ready();
  await page.mouse.click(640, 400);
  await page.waitForFunction(() =>
    document.getElementById("selection").textContent.includes("经度"),
  );
  check("click reports geographic coordinates", true);
  await page.getByRole("button", { name: "前往新加坡" }).click();
  await ready();
  await page.mouse.click(640, 400);
  await page.waitForFunction(() =>
    document.getElementById("selection").textContent.includes("已选中"),
  );
  check("click selects a native geometry object", true);
  await page.getByLabel("显示示例标记").uncheck();
  await page.getByLabel("显示地表影像").uncheck();
  await ready();
  check(
    "layer toggle changes the rendered surface",
    await page.evaluate(async () => {
      const scene = window.demoScene;
      const bytes = await scene.captureAsync();
      const offset = (400 * scene.canvas.width + 640) * 4;
      return [28, 82, 99].every((v, i) => Math.abs(bytes[offset + i] - v) <= 2);
    }),
  );
  await page.getByLabel("显示地表影像").check();
  await ready();
  await page.getByLabel("自动旋转").check();
  const rotateStart = await position();
  await page.waitForFunction(
    (p) => window.demoScene.camera.positionWC.x !== p[0],
    rotateStart,
  );
  await page.getByLabel("自动旋转").uncheck();
  check("automatic rotation advances frames", true);
  await page.setViewportSize({ width: 900, height: 600 });
  await page.waitForFunction(
    () =>
      window.demoScene.canvas.width === 900 &&
      window.demoScene.canvas.height === 600,
  );
  check("window resize updates drawing buffer", true);
  await page.getByLabel("地形", { exact: true }).selectOption("heightmap");
  await ready();
  check(
    "heightmap control loads an elevated surface",
    await page.evaluate(() => {
      const scene = window.demoScene,
        C = window.Cesium;
      const point = scene.globe.pick(
        scene.camera.getPickRay(new C.Cartesian2(450, 300)),
        scene,
      );
      return point && C.Cartographic.fromCartesian(point).height > 1000;
    }),
  );
  await page.getByLabel("叠加网格影像").check();
  await ready();
  await page.getByLabel("叠加透明度").fill("0.3");
  await page.getByLabel("高程夸张").fill("2");
  await ready();
  check(
    "overlay and exaggeration controls update the scene",
    await page.evaluate(
      () =>
        window.demoScene.verticalExaggeration === 2 &&
        window.demoScene.globe.imageryLayers.get(1).alpha === 0.3,
    ),
  );
  await page.screenshot({ path: `${output}/demo-terrain.png` });
  await page.getByLabel("地形", { exact: true }).selectOption("quantized");
  await ready();
  check(
    "quantized terrain control loads binary tiles",
    await page.evaluate(() => {
      const scene = window.demoScene,
        C = window.Cesium;
      const point = scene.globe.pick(
        scene.camera.getPickRay(new C.Cartesian2(450, 300)),
        scene,
      );
      return (
        point &&
        Math.abs(C.Cartographic.fromCartesian(point).height - 3000) < 30
      );
    }),
  );
  check(
    "no demo rendering errors",
    await page.evaluate(
      () =>
        window.demoScene.context.errors.length === 0 &&
        document.getElementById("error").hidden,
    ),
  );
  const resources = await page.evaluate(() => {
    window.dispatchEvent(new Event("pagehide"));
    return window.demoScene.resourceStatistics;
  });
  check(
    "page exit releases GPU buffers and textures",
    resources.live === 0,
    resources,
  );
  return checks;
}
