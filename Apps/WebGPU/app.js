/*global Cesium*/
const C = Cesium;
const canvas = document.getElementById("globe");
const status = document.getElementById("status");
const selection = document.getElementById("selection");
let scene,
  frame,
  stopped = false;
function fail(error) {
  if (error.recoverable) {
    status.textContent = `部分数据暂不可用：${error.message}`;
    return;
  }
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
  const marker = scene.primitives.add(
    new C.Primitive({
      geometryInstances: new C.GeometryInstance({
        geometry: C.BoxGeometry.fromDimensions({
          dimensions: new C.Cartesian3(160000, 160000, 160000),
          vertexFormat: C.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
        }),
        modelMatrix: C.Transforms.eastNorthUpToFixedFrame(
          C.Cartesian3.fromDegrees(103.85, 1.29, 100000),
        ),
        attributes: {
          color: C.ColorGeometryInstanceAttribute.fromColor(
            C.Color.fromCssColorString("#ff685e"),
          ),
        },
        id: "新加坡示例标记",
      }),
      appearance: new C.PerInstanceColorAppearance({
        flat: true,
        translucent: false,
        closed: true,
      }),
    }),
  );
  const gridCanvas = document.createElement("canvas");
  gridCanvas.width = gridCanvas.height = 256;
  const gridContext = gridCanvas.getContext("2d");
  gridContext.strokeStyle = "#7ffff0";
  gridContext.lineWidth = 2;
  for (let i = 0; i <= 256; i += 32) {
    gridContext.beginPath();
    gridContext.moveTo(i, 0);
    gridContext.lineTo(i, 256);
    gridContext.moveTo(0, i);
    gridContext.lineTo(256, i);
    gridContext.stroke();
  }
  const grid = scene.globe.imageryLayers.addImageryProvider(
    new C.UrlTemplateImageryProvider({
      url: gridCanvas.toDataURL(),
      maximumLevel: 4,
      tilingScheme: new C.WebMercatorTilingScheme(),
    }),
  );
  grid.show = false;
  grid.alpha = 0.65;
  document.getElementById("overlay").onchange = (event) => {
    grid.show = event.target.checked;
  };
  document.getElementById("alpha").oninput = (event) => {
    grid.alpha = Number(event.target.value);
  };
  const scheme = new C.GeographicTilingScheme();
  const heightmap = new C.CustomHeightmapTerrainProvider({
    width: 65,
    height: 65,
    callback: (x, y, level) => {
      const rectangle = scheme.tileXYToRectangle(x, y, level),
        heights = new Float32Array(65 * 65);
      for (let row = 0; row < 65; row++) {
        for (let column = 0; column < 65; column++) {
          const longitude = C.Math.toDegrees(
              rectangle.west + (rectangle.width * column) / 64,
            ),
            latitude = C.Math.toDegrees(
              rectangle.north - (rectangle.height * row) / 64,
            );
          heights[row * 65 + column] =
            3500 *
              Math.exp(
                -((longitude - 103.85) ** 2 + (latitude - 1.29) ** 2) / 0.0015,
              ) +
            1700 *
              Math.exp(
                -((longitude - 103.89) ** 2 + (latitude - 1.32) ** 2) / 0.0006,
              );
        }
      }
      return heights;
    },
  });
  const terrainSelect = document.getElementById("terrain");
  let terrainGeneration = 0;
  terrainSelect.onchange = async () => {
    const generation = ++terrainGeneration;
    terrainSelect.setAttribute("aria-busy", "true");
    try {
      const provider =
        terrainSelect.value === "quantized"
          ? await C.CesiumTerrainProvider.fromUrl(
              "/Specs/WebGPU/fixtures/terrain/",
              { requestVertexNormals: true },
            )
          : terrainSelect.value === "heightmap"
            ? heightmap
            : new C.EllipsoidTerrainProvider();
      if (stopped || generation !== terrainGeneration) {
        return;
      }
      scene.globe.terrainProvider = provider;
      scene.globe.enableLighting = terrainSelect.value !== "ellipsoid";
      if (terrainSelect.value !== "ellipsoid") {
        marker.show = false;
        document.getElementById("marker").checked = false;
        terrainView();
      }
      scene.render();
    } catch (error) {
      fail(error);
    } finally {
      if (generation === terrainGeneration) {
        terrainSelect.setAttribute("aria-busy", "false");
      }
    }
  };
  function terrainView() {
    const quantized = terrainSelect.value === "quantized";
    scene.camera.lookAt(
      C.Cartesian3.fromDegrees(
        quantized ? 30 : 103.85,
        quantized ? 20 : 1.29,
        1500,
      ),
      new C.HeadingPitchRange(0, -Math.PI / 4, 18000),
    );
    scene.camera.lookAtTransform(C.Matrix4.IDENTITY);
  }
  document.getElementById("terrain-view").onclick = terrainView;
  document.getElementById("exaggeration").oninput = (event) => {
    scene.verticalExaggeration = Number(event.target.value);
    document.getElementById("exaggeration-value").textContent =
      `${event.target.value} 倍`;
  };
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
    if (event.button !== 0 || !event.isPrimary || stopped) {
      return;
    }
    canvas.setPointerCapture(event.pointerId);
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      distance: 0,
    };
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag || drag.id !== event.pointerId || stopped) {
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
    scene.camera.rotateUp(-dy * speed);
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.distance += Math.abs(dx) + Math.abs(dy);
  });
  canvas.addEventListener("pointerup", async (event) => {
    if (drag?.id !== event.pointerId) {
      return;
    }
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
      selection.textContent = `经度 ${C.Math.toDegrees(location.longitude).toFixed(4)}° · 纬度 ${C.Math.toDegrees(location.latitude).toFixed(4)}° · 高程 ${location.height.toFixed(1)} 米`;
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
