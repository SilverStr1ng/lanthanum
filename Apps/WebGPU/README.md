# 原生 WebGPU：影像、地形、Primitive 与静态模型

基于 CesiumJS 1.147 的实验性 JavaScript 入口。复用 Cesium Camera、Globe、四叉树调度、provider 和 CPU/Worker 几何构建；GPU 资源、WGSL、颜色/深度/对象 ID 附件、命令提交和读回由原生 WebGPU 执行。没有隐藏 WebGL 补绘。

## 运行

需要 Node.js 24.15.0 / npm 11.6.1，以及支持硬件 WebGPU 的桌面 Chrome/Edge，在 localhost 或 HTTPS 下运行：

```sh
npm ci
npm run webgpu:start
```

打开输出的 `/Apps/WebGPU/index.html`。左键拖拽时地表沿鼠标方向移动，滚轮缩放，点击地表查看经纬度与网格高程。红色标记使用标准 Primitive，可拾取和显隐。侧栏可选择椭球、合成山地 heightmap、1500 米 quantized-mesh 样本，以及高程夸张、网格影像和透明度。

Natural Earth 本地影像只有 0—2 级，近看会模糊。合成山地位于新加坡附近，**不是当地真实地貌**；quantized 样本位于东经 30°、北纬 20°，用于验证二进制加载和缺块上采样。均不需要 token。

从地球页面进入 `/Apps/WebGPU/models.html` 可查看非平坦地形上的多个静态纹理模型。两个彩色盒体分别来自外部 glTF 和内嵌 GLB，砖纹平面使用 JPEG；另一个盒体在地形下方，隐藏地球后可见。点击返回模型 ID，可切换近地/高空/轨道视角、显隐、移除、取消和重新加载。模型高度为指定的绝对椭球高度，不是自动贴地。

`npm run webgpu:test` 构建后依次执行基础、流式、绘制契约、非平坦地形和模型五组场景，每组附带原13项页面交互测试；模型组另有独立模型页面检查。单独运行模型可用 `npm run webgpu:test-models`。证据写入新的 `benchmarks/runs/` 子目录，包含检查、硬件信息、源码提交、构建/原资产/模型资产与测试源 hash、请求列表和截图。独立 quantized-mesh 数据已提交；可用 `npm run webgpu:terrain-fixtures` 重建，不修改原冻结 WebGL fixture。

## 静态模型 API

```js
const model = await Cesium.WebGPUModel.fromGltfAsync({
  scene,
  url: "/Specs/WebGPU/fixtures/models/box.glb",
  modelMatrix: Cesium.Transforms.eastNorthUpToFixedFrame(
    Cesium.Cartesian3.fromDegrees(30.234375, 20.390625, 4500),
  ),
  id: "box-model",
  signal: abortController.signal,
});
scene.models.add(model);
scene.render();
// pickAsync 返回 { primitive: model, id: "box-model" }。
model.show = false;
// 可更改 model.modelMatrix；glTF Y-up 已自动转为地理 ENU Z-up。
scene.models.remove(model); // 销毁实例；重新加载得到新实例。
```

该实验入口在 CPU 解析、上传排队与异步管线编译完成后 resolve，不依赖渲染循环，不自动加入集合。加载期间 AbortSignal 仅取消本调用；成功后的实例由集合/scene 管理。移除默认销毁，跨 scene 或重复加入明确拒绝。尚未 add 的实例也在 scene.destroy 时释放。隐藏后恢复、移除发生于异步拾取完成前，旧结果失效。

仅接受明确 `KHR_materials_unlit` 的静态 OPAQUE 材质，纹理×factor×顶点色在线性域相乘、sRGB 输出，alpha=0 仍不透明。支持 PNG/JPEG、相对外部资源/GLB、索引/非索引、TRS/matrix、负/非均匀缩放、两种 GPU 顶点布局、nearest/linear 与三种 wrap。显式 mip、默认 PBR、MASK/BLEND、动画/skin/morph、压缩和未支持扩展明确拒绝。精确类型与边界见[模型支持矩阵](../../docs/model-support.md)，不是全部 glTF/S11 支持。

`statistics.modelWork` 分别记录 network/CPU/payloads/decoding/geometry/textures/samplers/pipelines 的 active、queued、entries、references、started/hits/peakActive。下载/CPU/解码各最多4个物理任务，编译最多2个；CPU资产项32、管线项64、其他缓存项128。不同URL的相同CPU几何/编码图像按内容共享payload，场景所有者负责其引用。零引用立即退休，未结束解码/编译继续占槽，迟到结果不得写回。`model.loadStatistics` 的 cpuReadyMilliseconds/drawableMilliseconds 是本次调用延迟，不能称为 GPU 时间或严格冷启动。

## 使用 API

当前主工具链固定为 Node 24.15.0 / npm 11.6.1，`npm run toolchain:check` 可检查版本；其他版本没有本轮安装承诺。清洁 Windows/Linux 安装与通用检查由 `native-contract` 工作流独立记录，hosted CI不声称执行硬件WebGPU。

N01—N04修复地形代际所有权、Color几何的ST误裁剪、显式near/far被覆盖和闭合透明物体缺背面绘制。相机默认near=0.1、far=500000000；render保留应用设置，要求有限且0<near<far。采用反向depth32float，仍不代表完整S07精度通过。closed透明三角形先背面再正面，两次不写深度、共用ID；相交透明排序仍不保证。

山脊专项 `node scripts/webgpuTest/run.js --suite=terrain` 保存相邻LOD、裙边、缺块、20次返回以及terrainWork/影像层级记录。`terrainWork.cancelled`只计离开视区取消，代际切换另由generation表示。影像LOD仍受地形level约束，上采样标记尚未驱动提前停止；见[后续工单](../../docs/issues/terrain-imagery-lod.md)。验收状态以[进度报告](../../progress-report.md)为准。

```js
const C = Cesium;
const scene = await C.Scene.createAsync({
  canvas,
  backend: "webgpu", // auto | webgpu | webgl2
  maximumTerrainLevel: 12,
  maximumImageryTextures: 256,
  maximumImageryBytes: 128 * 1024 * 1024,
});
scene.globe = new C.Globe();
scene.globe.imageryLayers.addImageryProvider(
  new C.UrlTemplateImageryProvider({
    url: "/imagery/{z}/{x}/{y}.png",
    maximumLevel: 16,
    tilingScheme: new C.WebMercatorTilingScheme(),
  }),
);
scene.globe.terrainProvider = await C.CesiumTerrainProvider.fromUrl(
  "/terrain/",
  {
    requestVertexNormals: true,
  },
);
scene.verticalExaggeration = 1;

const primitive = scene.primitives.add(
  new C.Primitive({
    geometryInstances: new C.GeometryInstance({
      geometry: C.BoxGeometry.fromDimensions({
        dimensions: new C.Cartesian3(100, 100, 100),
        vertexFormat: C.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
      }),
      modelMatrix: C.Transforms.eastNorthUpToFixedFrame(
        C.Cartesian3.fromDegrees(30, 20, 2000),
      ),
      id: "box",
      attributes: {
        color: C.ColorGeometryInstanceAttribute.fromColor(C.Color.RED),
        show: new C.ShowGeometryInstanceAttribute(true),
      },
    }),
    appearance: new C.PerInstanceColorAppearance({
      flat: true,
      translucent: false,
    }),
  }),
);
scene.camera.setView({ destination: C.Cartesian3.fromDegrees(30, 20, 10000) });
// 在 requestAnimationFrame 中持续调用 scene.render()。
// primitive.ready 后可通过 getGeometryInstanceAttributes("box") 更新 color/show。
const picked = await scene.pickAsync(new C.Cartesian2(x, y));
const point = scene.globe.pick(
  scene.camera.getPickRay(new C.Cartesian2(x, y)),
  scene,
);
// 结束动画循环后释放场景。
scene.destroy();
```

`auto` 只在绑定 canvas 前的设备/能力失败时整场景回退到 WebGL2，原因在 `fallbackReason`；取消和绑定后的故障不会切换后端。同步 `new Scene()` / `new Viewer()` 仍走原 WebGL 路径。该异步入口尚未迁移 Viewer/Widget，也不提供完整 Scene 类型兼容。

## 本轮支持范围

| 能力      | 可用子集与边界                                                                                                                                                                                                                   |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 影像      | 最多 8 个可见层，增删/排序/show/alpha、亮度/对比度/gamma/hue/saturation、split、colorToAlpha；Geographic/Web Mercator、局部矩形（含跨日期线）、minimum/maximumLevel、祖先替代、延迟 discard policy、署名                         |
| Provider  | 验证了 UrlTemplate、SingleTile、CustomHeightmap、CesiumTerrainProvider 的 quantized-mesh 二进制路径；其他影像 provider 必须提供相同的 requestImage/tilingScheme 接口，商业服务与其他服务协议尚未逐项认证                         |
| 地形      | WGS84、全球 Geographic 2×1 根、heightmap/quantized-mesh、真实高程、skirts、CPU 网格拾取、夸张/相对高度、法线基础光照、包围体/地平线剔除、缺块上采样、请求失败后祖先/椭球替代                                                     |
| Primitive | PrimitiveCollection（含嵌套）、Primitive、GeometryInstance；异步 Worker 或同步构建、ready、颜色/show、modelMatrix、allowPicking、移除/销毁；每实例独立 mesh，尚未 GPU instancing/batching                                        |
| 几何/外观 | 含 xyz positions 的 TRIANGLES/LINES/POINTS（有/无 indices）；Box、Ellipsoid、Plane、SimplePolyline 等标准 CPU 几何；PerInstanceColorAppearance 与 MaterialAppearance 的 Color 材质。线宽/点大小为 1 像素；带光照的几何需 normals |
| 透明      | 按实例包围球中心距离从远到近排序、alpha 混合；不是 OIT，交叉/相交透明面不保证正确排序                                                                                                                                            |
| 拾取      | 异步 GPU 对象 ID，返回原 Primitive 和 instance.id；CSS 像素坐标，最多 8 个在途请求、支持 AbortSignal；地球 ID 为 `globe`；移除/隐藏后不返回失效对象                                                                              |
| 资源      | 默认最多 8 个地形任务和 8 个影像请求/解码排队项；每帧最多上传 2 个 terrain mesh、4 张纹理；GPU 影像默认 256 张/128 MiB，可配置；地形缓存复用 globe.tileCacheSize；加载中销毁阻止迟到上传                                         |

`scene.addGeometry` 保留早期接口，仅接受不透明 indexed triangles；新代码优先使用标准 Primitive。`Globe.pick` 返回当前网格的交点，粗网格可能低于数学椭球/原始样本高程，不能替代精密高程查询。坐标在 CPU 双精度下抵消局部原点；未完成完整 high/low、多视锥深度精度认证。

尚未支持 GroundPrimitive/GroundPolyline、Entity、Billboard/Label、完整 glTF/PBR/3D Tiles、任意 GLSL/custom renderState、Primitive 的非 Color 材质、切割/分类、阴影/大气/后处理、二维/Columbus、flyTo/跟踪和 requestRenderMode。不支持的 primitive 类型、外观、拓扑、裁剪和地形布局明确报错；完整 Globe/Scene 的其他效果属性不在本支持声明内。地球基础光照使用固定方向光，不等价于完整时钟/太阳光照系统。

可恢复瓦片错误通过 `renderError` 的 `error.recoverable` 和 `statistics.tileErrors` 报告，不停止整个场景；失败块在本次驻留期使用祖先，重新加载/替换 provider 可重试。GPU 预算不足时降级到已驻留祖先，最小预算无法容纳根纹理时显示 baseColor。设备丢失仍须销毁并重新创建场景。

`resourceStatistics` 统计后端管理的 buffer/texture 数量与估算字节，不是全部物理显存。十轮回归通过不代表长时间/跨 GPU/跨 OS 认证；本轮交付不宣称原计划完整阶段、MVP 或生产 v1 通过。旧 WebGL 动态盒体拾取和上游 Jasmine 失败继续保留在进度报告。
