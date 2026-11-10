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
  await page.mouse.move(760, 350);
  await page.mouse.down();
  await page.mouse.move(850, 400, { steps: 8 });
  await page.mouse.up();
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
