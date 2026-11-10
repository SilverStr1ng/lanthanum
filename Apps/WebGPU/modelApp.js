/*global Cesium*/
import {
  modelView,
  populateModelWorld,
  loadWorldModels,
} from "./modelWorld.js";
const C = Cesium,
  canvas = document.getElementById("globe"),
  status = document.getElementById("model-status");
let scene,
  controller,
  frame,
  generation = 0,
  stopped = false,
  models = [];
function resize() {
  const scale = Math.min(devicePixelRatio, 2);
  canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale));
  canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale));
}
function fail(error) {
  if (stopped) {
    return;
  }
  const box = document.getElementById("error");
  box.hidden = false;
  box.textContent = error.message;
}
function remove() {
  generation++;
  controller?.abort();
  for (const model of models) {
    model.destroy();
  }
  models = [];
  document.getElementById("cancel-models").disabled = true;
  status.textContent = "模型已移除，可重新加载";
}
async function reload() {
  remove();
  const current = generation;
  controller = new AbortController();
  status.textContent = "正在加载纹理模型…";
  document.getElementById("cancel-models").disabled = false;
  try {
    const loaded = await loadWorldModels(scene, controller.signal);
    if (stopped || current !== generation) {
      for (const model of loaded) {
        model.destroy();
      }
      return;
    }
    models = loaded;
    for (const model of models) {
      model.show = document.getElementById("models-visible").checked;
    }
    status.textContent = "4 个模型已就绪 · 1 个在地形下方";
  } catch (error) {
    if (current === generation && !stopped) {
      status.textContent =
        error.name === "AbortError"
          ? "已取消加载，可重新加载"
          : `模型加载失败：${error.message}`;
    }
  } finally {
    if (current === generation) {
      document.getElementById("cancel-models").disabled = true;
    }
  }
}
async function start() {
  resize();
  scene = await C.Scene.createAsync({ canvas, backend: "webgpu" });
  window.modelDemoScene = scene;
  const { front } = populateModelWorld(scene);
  scene.renderError.addEventListener(fail);
  const owner = scene;
  for (const view of ["near", "top", "high", "orbit"]) {
    document.getElementById(view).onclick = () => modelView(owner, view);
  }
  document.getElementById("reload-models").onclick = reload;
  document.getElementById("remove-models").onclick = remove;
  document.getElementById("cancel-models").onclick = () => controller?.abort();
  document.getElementById("models-visible").onchange = (event) => {
    for (const model of models) {
      model.show = event.target.checked;
    }
  };
  document.getElementById("terrain-visible").onchange = (event) => {
    scene.globe.show = event.target.checked;
  };
  document.getElementById("front-visible").onchange = (event) => {
    front.show = event.target.checked;
  };
  let drag;
  canvas.onpointerdown = (event) => {
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }
    canvas.setPointerCapture(event.pointerId);
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      distance: 0,
    };
  };
  canvas.onpointermove = (event) => {
    if (drag?.id !== event.pointerId) {
      return;
    }
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y,
      speed =
        Math.min(
          1,
          Math.max(
            0.00005,
            scene.camera.positionCartographic.height / 12000000,
          ),
        ) * 0.004;
    scene.camera.rotateLeft(dx * speed);
    scene.camera.rotateUp(-dy * speed);
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.distance += Math.abs(dx) + Math.abs(dy);
  };
  canvas.onpointercancel = () => {
    drag = undefined;
  };
  canvas.onpointerup = async (event) => {
    if (drag?.id !== event.pointerId) {
      return;
    }
    const click = drag.distance < 5;
    drag = undefined;
    if (!click) {
      return;
    }
    try {
      const rect = canvas.getBoundingClientRect(),
        hit = await scene.pickAsync(
          new C.Cartesian2(event.clientX - rect.left, event.clientY - rect.top),
        );
      if (!stopped) {
        document.getElementById("selection").textContent = hit
          ? `已选中：${hit.id}`
          : "此处没有对象";
      }
    } catch (error) {
      fail(error);
    }
  };
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const altitude = scene.camera.positionCartographic.height,
        next = C.Math.clamp(
          altitude * Math.exp(event.deltaY * 0.001),
          4000,
          40000000,
        );
      scene.camera.zoomIn(altitude - next);
    },
    { passive: false },
  );
  window.addEventListener("resize", resize);
  window.addEventListener(
    "pagehide",
    () => {
      stopped = true;
      remove();
      cancelAnimationFrame(frame);
      scene.destroy();
    },
    { once: true },
  );
  let previous = 0;
  function draw(now) {
    if (stopped) {
      return;
    }
    try {
      scene.render();
      if (now - previous > 500) {
        document.getElementById("status").textContent = scene.globe.tilesLoaded
          ? "山地已就绪 · 拖拽探索"
          : "正在加载地形与影像…";
        previous = now;
      }
      frame = requestAnimationFrame(draw);
    } catch (error) {
      fail(error);
    }
  }
  frame = requestAnimationFrame(draw);
  await reload();
}
start().catch(fail);
