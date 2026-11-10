/*global window, document*/
export async function checkModelDemo(page, url, output) {
  const checks = [];
  function check(name, passed, detail) {
    checks.push({ name, passed, detail });
    if (!passed) {
      throw new Error(`Model demo ${name}: ${JSON.stringify(detail)}`);
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${url}/Apps/WebGPU/models.html`);
  const ready = () =>
    page.waitForFunction(
      () =>
        window.modelDemoScene?.models.length === 4 &&
        window.modelDemoScene.globe.tilesLoaded,
    );
  await ready();
  await page.screenshot({ path: `${output}/model-demo-near.png` });
  check(
    "model demo loads four models with imagery and terrain",
    await page.evaluate(
      () => window.modelDemoScene.statistics.imageryTextures > 0,
    ),
  );
  await page.getByRole("button", { name: "俯视模型" }).click();
  await ready();
  await page.mouse.click(640, 400);
  await page.waitForFunction(() =>
    document.getElementById("selection").textContent.includes("纹理盒体 GLB"),
  );
  check("click returns visible GLB model object", true);
  await page.getByLabel("显示模型上方图元").check();
  await page.mouse.click(640, 400);
  await page.waitForFunction(() =>
    document
      .getElementById("selection")
      .textContent.includes("模型上方的 Primitive"),
  );
  check("foreground Primitive occludes model in interactive demo", true);
  await page.getByLabel("显示模型上方图元").uncheck();
  await page.getByLabel("显示模型", { exact: true }).uncheck();
  await page.mouse.click(640, 400);
  await page.waitForFunction(() =>
    document
      .getElementById("selection")
      .textContent.includes("模型下方的 Primitive"),
  );
  check("hiding models reveals underlying Primitive", true);
  await page.getByLabel("显示模型", { exact: true }).check();
  const oldId = await page.evaluate(
    () => window.modelDemoScene.models.get(0)._objectId,
  );
  await page.getByRole("button", { name: "移除模型", exact: true }).click();
  await page.waitForFunction(() => window.modelDemoScene.models.length === 0);
  check(
    "remove control removes all models without destroying globe",
    await page.evaluate(
      () =>
        !window.modelDemoScene.isDestroyed() &&
        window.modelDemoScene.globe.tilesLoaded,
    ),
  );
  await page.getByRole("button", { name: "重新加载模型" }).click();
  await ready();
  check(
    "reload creates new valid model objects",
    await page.evaluate(
      (id) => window.modelDemoScene.models.get(0)._objectId > id,
      oldId,
    ),
  );
  // Hold a real fetch so a user cancellation has a deterministic in-flight target.
  await page.evaluate(() => {
    const original = window.fetch;
    window.demoFetchOriginal = original;
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (String(args[0]).endsWith("box.glb")) {
        await new Promise((resolve) => {
          window.releaseDemoDownload = resolve;
        });
      }
      return response;
    };
  });
  await page.getByRole("button", { name: "重新加载模型" }).click();
  await page.waitForFunction(() => !!window.releaseDemoDownload);
  await page.getByRole("button", { name: "取消加载" }).click();
  await page.waitForFunction(() =>
    document.getElementById("model-status").textContent.includes("已取消"),
  );
  await page.evaluate(() => {
    window.fetch = window.demoFetchOriginal;
    window.releaseDemoDownload();
  });
  check(
    "cancel control settles in-flight model load",
    await page.evaluate(() => window.modelDemoScene.models.length === 0),
  );
  await page.getByRole("button", { name: "重新加载模型" }).click();
  await ready();
  await page.screenshot({ path: `${output}/model-demo-top.png` });
  check("reload after cancellation succeeds", true);
  check(
    "interactive model demo has no validation errors",
    await page.evaluate(
      () =>
        window.modelDemoScene.context.errors.length === 0 &&
        document.getElementById("error").hidden,
    ),
  );
  const stats = await page.evaluate(() => {
    window.dispatchEvent(new Event("pagehide"));
    return window.modelDemoScene.resourceStatistics;
  });
  check("model demo page exit releases GPU resources", stats.live === 0, stats);
  return checks;
}
