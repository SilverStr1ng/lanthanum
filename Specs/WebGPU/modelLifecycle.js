/*global Cesium*/
// Fault injection delays real browser operations; successful loads still use the real GPU.
const C = Cesium;
const base = "/Specs/WebGPU/fixtures/models/";
const tick = () => new Promise(requestAnimationFrame);
function gate() {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function until(predicate) {
  const deadline = performance.now() + 15000;
  while (!predicate()) {
    if (performance.now() > deadline) {
      throw new Error("Lifecycle stage timed out");
    }
    await tick();
  }
}
function outcome(promise) {
  return promise.then(
    (model) => ({ model }),
    (error) => ({ error }),
  );
}
function empty(work) {
  return (
    work.instances === 0 &&
    Object.values(work).every(
      (v) =>
        !v ||
        typeof v !== "object" ||
        (!v.active && !v.queued && !v.entries && !v.references),
    )
  );
}
export async function lifecycle(scene, check, result, placement) {
  const load = (options = {}) =>
    C.WebGPUModel.fromGltfAsync({
      scene,
      url: `${base}plane.gltf`,
      modelMatrix: placement(),
      ...options,
    });
  const idle = () =>
    until(() =>
      Object.values(scene.statistics.modelWork).every(
        (v) => !v?.active && !v?.queued,
      ),
    );
  const baseline = scene.resourceStatistics.live;
  const fetchOriginal = window.fetch;
  let physical = 0;
  const download = gate();
  window.fetch = async (...args) => {
    const response = await fetchOriginal(...args);
    if (String(args[0]).endsWith("plane.gltf")) {
      physical++;
      await download.promise;
    }
    return response;
  };
  try {
    const controller = new AbortController();
    const a = outcome(load({ signal: controller.signal })),
      b = load({ id: "network-survivor" });
    await until(() => physical === 1);
    controller.abort();
    check(
      "shared download A cancellation settles independently",
      (await a).error?.name === "AbortError",
    );
    check(
      "shared download remains physically active for B",
      scene.statistics.modelWork.network.active === 1,
    );
    download.resolve();
    const survivor = scene.models.add(await b);
    check(
      "shared download is deduplicated and B draws after A cancellation",
      physical === 1 &&
        (await scene.pickAsync(new C.Cartesian2(212, 212)))?.primitive ===
          survivor,
    );
    scene.models.remove(survivor);
  } finally {
    download.resolve();
    window.fetch = fetchOriginal;
  }
  await idle();

  const lateDownload = gate();
  let bodyReady = false;
  window.fetch = async (...args) => {
    const response = await fetchOriginal(...args);
    const bytes = await response.arrayBuffer();
    bodyReady = true;
    await lateDownload.promise;
    return new Response(bytes);
  };
  try {
    const controller = new AbortController(),
      job = outcome(load({ signal: controller.signal }));
    await until(() => bodyReady);
    controller.abort();
    check(
      "last download waiter cancels while physical network work stays bounded",
      (await job).error?.name === "AbortError" &&
        scene.statistics.modelWork.network.active === 1,
    );
    lateDownload.resolve();
    await idle();
    check(
      "late network result cannot restore cancelled model",
      empty(scene.statistics.modelWork) &&
        scene.resourceStatistics.live === baseline,
    );
  } finally {
    lateDownload.resolve();
    window.fetch = fetchOriginal;
  }

  const bitmapOriginal = window.createImageBitmap,
    decoding = gate();
  let decoded = false,
    closed = 0;
  window.createImageBitmap = async (...args) => {
    const image = await bitmapOriginal(...args);
    decoded = true;
    const close = image.close.bind(image);
    image.close = () => {
      closed++;
      close();
    };
    await decoding.promise;
    return image;
  };
  try {
    const controller = new AbortController(),
      job = outcome(load({ signal: controller.signal }));
    await until(() => decoded);
    controller.abort();
    check(
      "slow decode cancellation rejects without waiting for physical decode",
      (await job).error?.name === "AbortError",
    );
    check(
      "cancelled unabortable decode retains its physical slot",
      scene.statistics.modelWork.decoding.active === 1 &&
        scene.statistics.modelWork.instances === 0,
    );
    decoding.resolve();
    await idle();
    check(
      "late image closes once and cannot recreate deleted model resources",
      closed === 1 &&
        empty(scene.statistics.modelWork) &&
        scene.resourceStatistics.live === baseline,
      scene.statistics,
    );
  } finally {
    decoding.resolve();
    window.createImageBitmap = bitmapOriginal;
  }

  const device = scene.context.device,
    compileOriginal = device.createRenderPipelineAsync.bind(device);
  const compiling = gate();
  let started = 0;
  device.createRenderPipelineAsync = async (...args) => {
    started++;
    const pipeline = await compileOriginal(...args);
    await compiling.promise;
    return pipeline;
  };
  try {
    const controller = new AbortController(),
      a = outcome(load({ signal: controller.signal })),
      b = load({ id: "compile-survivor" });
    await until(() => started === 2);
    controller.abort();
    check(
      "shared pipeline cancellation rejects only A",
      (await a).error?.name === "AbortError",
    );
    check(
      "two variants compile once within the physical budget",
      scene.statistics.modelWork.pipelines.active === 2 &&
        scene.statistics.modelWork.pipelines.peakActive <= 2,
    );
    compiling.resolve();
    const survivor = scene.models.add(await b);
    check(
      "pending pipeline dedup preserves B color and ID",
      started === 2 &&
        (await scene.pickAsync(new C.Cartesian2(212, 212)))?.primitive ===
          survivor,
    );
    scene.models.remove(survivor);
  } finally {
    compiling.resolve();
    device.createRenderPipelineAsync = compileOriginal;
  }
  await idle();

  const shaderOriginal = device.createShaderModule.bind(device);
  device.pushErrorScope("validation");
  device.createShaderModule = (descriptor) =>
    shaderOriginal({ ...descriptor, code: "invalid WGSL injection" });
  let failure;
  try {
    failure = await outcome(load());
  } finally {
    device.createShaderModule = shaderOriginal;
  }
  await idle();
  const validation = await device.popErrorScope();
  result.expectedErrors.push({
    stage: "invalid WGSL",
    error: failure.error?.message,
    validation: validation?.message,
  });
  check(
    "shader failure identifies asset variant and compiler diagnostic",
    failure.error?.message.includes("plane.gltf") &&
      failure.error.message.includes("variant") &&
      !!validation,
  );
  check(
    "failed compile cleans shared resources and can retry",
    empty(scene.statistics.modelWork) &&
      scene.resourceStatistics.live === baseline,
  );
  const retried = scene.models.add(await load());
  check(
    "retry after shader failure renders",
    (await scene.pickAsync(new C.Cartesian2(212, 212)))?.primitive === retried,
  );
  scene.models.remove(retried);
  await idle();

  // Deterministic network failures without console HTTP errors hiding unrelated failures.
  window.fetch = (url, ...args) =>
    String(url).endsWith("missing.bin")
      ? Promise.resolve(new Response("missing fixture", { status: 404 }))
      : fetchOriginal(url, ...args);
  try {
    const failed = await outcome(load({ url: `${base}missing-buffer.gltf` }));
    await idle();
    check(
      "missing external buffer rejects with URL and HTTP status",
      failed.error?.message.includes("missing.bin") &&
        failed.error.message.includes("404") &&
        empty(scene.statistics.modelWork),
    );
  } finally {
    window.fetch = fetchOriginal;
  }

  result.cycles = [];
  for (let i = 0; i < 20; i++) {
    const pending = gate();
    let calls = 0;
    device.createRenderPipelineAsync = async (...args) => {
      calls++;
      const value = await compileOriginal(...args);
      await pending.promise;
      return value;
    };
    try {
      const controller = new AbortController(),
        job = outcome(load({ signal: controller.signal }));
      await until(() => calls === 2);
      controller.abort();
      const cancelled = (await job).error?.name === "AbortError";
      const occupied = scene.statistics.modelWork.pipelines.active === 2;
      pending.resolve();
      await idle();
      device.createRenderPipelineAsync = compileOriginal;
      const a = scene.models.add(await load({ id: `cycle-${i}-A` })),
        b = scene.models.add(await load({ id: `cycle-${i}-B` }));
      const pendingPick = scene.pickAsync(new C.Cartesian2(212, 212));
      scene.models.remove(b);
      const stale = await pendingPick;
      const survivor = await scene.pickAsync(new C.Cartesian2(212, 212));
      scene.models.remove(a);
      await idle();
      const sample = {
        cycle: i + 1,
        cancelled,
        occupied,
        staleInvalid: stale === undefined,
        survivor: survivor?.primitive === a,
        resources: scene.resourceStatistics,
        work: scene.statistics.modelWork,
      };
      result.cycles.push(sample);
      check(
        `load cancel reload share remove cycle ${i + 1}`,
        cancelled &&
          occupied &&
          sample.staleInvalid &&
          sample.survivor &&
          sample.resources.live === baseline &&
          empty(sample.work),
        sample,
      );
    } finally {
      pending.resolve();
      device.createRenderPipelineAsync = compileOriginal;
    }
  }
  // Two actual devices must not share GPU handles; unregistered instances are owned too.
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const other = await C.Scene.createAsync({ canvas, backend: "webgpu" });
  const a = await load(),
    b = await C.WebGPUModel.fromGltfAsync({
      scene: other,
      url: `${base}plane.gltf`,
    });
  let crossScene = false;
  try {
    other.models.add(a);
  } catch {
    crossScene = true;
  }
  check(
    "cross-scene membership rejects and devices have distinct GPU buffers",
    crossScene &&
      a._packets[0].geometry.vertex !== b._packets[0].geometry.vertex,
  );
  other.destroy();
  check(
    "scene destroy releases drawable model never added to its collection",
    b.isDestroyed() &&
      other.resourceStatistics.live === 0 &&
      empty(other.statistics.modelWork),
  );
  a.destroy();
  a.destroy();
  await idle();
  check(
    "double destroy is idempotent and last shared references reach baseline",
    empty(scene.statistics.modelWork) &&
      scene.resourceStatistics.live === baseline,
  );
  result.stages.push({ name: "lifecycle", work: scene.statistics.modelWork });
}

export async function destroyedDuringWork(check, result, loss = false) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const scene = await C.Scene.createAsync({ canvas, backend: "webgpu" }),
    device = scene.context.device,
    original = device.createRenderPipelineAsync.bind(device),
    delayed = gate();
  let calls = 0;
  device.createRenderPipelineAsync = async (...args) => {
    calls++;
    const pipeline = await original(...args);
    await delayed.promise;
    return pipeline;
  };
  try {
    const job = outcome(
      C.WebGPUModel.fromGltfAsync({ scene, url: `${base}plane.gltf` }),
    );
    await until(() => calls === 2);
    if (loss) {
      device.destroy();
      await until(() => scene.context.lost);
      result.expectedErrors.push({
        stage: "device loss injection",
        errors: [...scene.context.errors],
      });
    }
    scene.destroy();
    check(
      `${loss ? "device loss" : "destroy"} during compilation rejects loader and keeps physical task accounting`,
      (await job).error?.name === "AbortError" &&
        scene.statistics.modelWork.pipelines.active === 2 &&
        scene.resourceStatistics.live === 0,
    );
    delayed.resolve();
    await until(() => empty(scene.statistics.modelWork));
    check(
      `late pipelines after ${loss ? "device loss" : "scene generation change"} cannot resurrect resources`,
      scene.resourceStatistics.live === 0 && empty(scene.statistics.modelWork),
    );
    result.stages.push({
      name: `${loss ? "device loss" : "destroy"} during compile`,
      work: scene.statistics.modelWork,
    });
  } finally {
    delayed.resolve();
    device.createRenderPipelineAsync = original;
    scene.destroy();
  }
}
