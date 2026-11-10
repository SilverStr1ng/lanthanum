/*global Cesium*/
const C = Cesium;
const canvas = document.getElementById("globe");
const status = document.getElementById("status");
const selection = document.getElementById("selection");
let scene,
  frame,
  stopped = false;
function fail(error) {
  stopped = true;
  cancelAnimationFrame(frame);
  const box = document.getElementById("error");
  box.hidden = false;
  box.textContent = `暂时无法显示地球：${error.message}。请使用支持 WebGPU 的桌面 Chrome 或 Edge，通过本地启动命令打开。`;
  status.textContent = "已停止绘制";
  scene?.destroy();
}
function resize() {
  const scale = Math.min(devicePixelRatio, 2);
  canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale));
  canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale));
}
function home() {
  scene.camera.setView({
    destination: C.Cartesian3.fromDegrees(110, 20, 18000000),
  });
}
async function start() {
  resize();
  scene = await C.Scene.createAsync({ canvas, backend: "webgpu" });
  window.demoScene = scene;
  scene.renderError.addEventListener(fail);
  scene.backgroundColor = C.Color.fromCssColorString("#07111d");
  scene.globe = new C.Globe();
  scene.globe.maximumScreenSpaceError = 3;
  scene.globe.baseColor = C.Color.fromCssColorString("#1c5263");
  const layer = scene.globe.imageryLayers.addImageryProvider(
    new C.UrlTemplateImageryProvider({
      url: "/Build/CesiumUnminified/Assets/Textures/NaturalEarthII/{z}/{x}/{reverseY}.jpg",
      maximumLevel: 2,
      tilingScheme: new C.GeographicTilingScheme(),
    }),
  );
  const marker = scene.addGeometry({
    geometry: C.BoxGeometry.createGeometry(
      C.BoxGeometry.fromDimensions({
        dimensions: new C.Cartesian3(160000, 160000, 160000),
        vertexFormat: C.VertexFormat.POSITION_ONLY,
      }),
    ),
    modelMatrix: C.Transforms.eastNorthUpToFixedFrame(
      C.Cartesian3.fromDegrees(103.85, 1.29, 100000),
    ),
    color: C.Color.fromCssColorString("#ff685e"),
    id: "新加坡示例标记",
  });
  home();
  document.getElementById("reset").onclick = home;
  document.getElementById("singapore").onclick = () =>
    scene.camera.setView({
      destination: C.Cartesian3.fromDegrees(103.85, 1.29, 1500000),
    });
  document.getElementById("imagery").onchange = (event) => {
    layer.show = event.target.checked;
  };
  document.getElementById("marker").onchange = (event) => {
    marker.show = event.target.checked;
  };
  let drag;
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    drag = { x: event.clientX, y: event.clientY, distance: 0 };
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag || stopped) {
      return;
    }
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y;
    const speed =
      Math.min(
        1,
        Math.max(0.002, scene.camera.positionCartographic.height / 12000000),
      ) * 0.004;
    scene.camera.rotateLeft(dx * speed);
    scene.camera.rotateUp(dy * speed);
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.distance += Math.abs(dx) + Math.abs(dy);
  });
  canvas.addEventListener("pointerup", async (event) => {
    const click = drag && drag.distance < 5;
    drag = undefined;
    if (!click || stopped) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const position = new C.Cartesian2(
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
    try {
      const object = await scene.pickAsync(position);
      if (stopped) {
        return;
      }
      if (!object) {
        selection.textContent = "此处是天空，试试点击地球。";
        return;
      }
      if (object.id !== "globe") {
        selection.textContent = `已选中：${object.id}`;
        return;
      }
      const point = scene.globe.pick(scene.camera.getPickRay(position), scene);
      if (!point) {
        selection.textContent = "该区域正在加载，请稍后重试。";
        return;
      }
      const location = C.Cartographic.fromCartesian(point);
      selection.textContent = `经度 ${C.Math.toDegrees(location.longitude).toFixed(4)}° · 纬度 ${C.Math.toDegrees(location.latitude).toFixed(4)}°`;
    } catch (error) {
      if (!stopped) {
        fail(error);
      }
    }
  });
  canvas.addEventListener("pointercancel", () => {
    drag = undefined;
  });
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (stopped) {
        return;
      }
      const height = scene.camera.positionCartographic.height;
      const next = C.Math.clamp(
        height * Math.exp(event.deltaY * 0.001),
        10000,
        40000000,
      );
      scene.camera.zoomIn(height - next);
    },
    { passive: false },
  );
  window.addEventListener("resize", resize);
  window.addEventListener(
    "pagehide",
    () => {
      stopped = true;
      cancelAnimationFrame(frame);
      scene.destroy();
    },
    { once: true },
  );
  let previous = performance.now(),
    lastStatus = -Infinity;
  function draw(now) {
    if (stopped) {
      return;
    }
    try {
      if (document.getElementById("rotate").checked) {
        scene.camera.rotateLeft(Math.min(now - previous, 100) * 0.000025);
      }
      previous = now;
      scene.render();
      if (now - lastStatus > 500) {
        status.textContent = scene.globe.tilesLoaded
          ? "地球已就绪 · 拖拽探索"
          : "正在加载地表…";
        lastStatus = now;
      }
      frame = requestAnimationFrame(draw);
    } catch (error) {
      fail(error);
    }
  }
  frame = requestAnimationFrame(draw);
}
start().catch(fail);
