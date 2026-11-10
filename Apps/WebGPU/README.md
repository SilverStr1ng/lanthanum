# 原生 WebGPU：影像、地形与 Primitive

基于 CesiumJS 1.147 的实验性 JavaScript 入口。复用 Cesium Camera、Globe、四叉树调度、provider 和 CPU/Worker 几何构建；GPU 资源、WGSL、颜色/深度/对象 ID 附件、命令提交和读回由原生 WebGPU 执行。没有隐藏 WebGL 补绘。

## 运行

需要 Node.js ≥22.17，以及支持硬件 WebGPU 的桌面 Chrome/Edge，在 localhost 或 HTTPS 下运行：

```sh
npm ci
npm run webgpu:start
```

打开输出的 `/Apps/WebGPU/index.html`。左键拖拽时地表沿鼠标方向移动，滚轮缩放，点击地表查看经纬度与网格高程。红色标记使用标准 Primitive，可拾取和显隐。侧栏可选择椭球、合成山地 heightmap、1500 米 quantized-mesh 样本，以及高程夸张、网格影像和透明度。

Natural Earth 本地影像只有 0—2 级，近看会模糊。合成山地位于新加坡附近，**不是当地真实地貌**；quantized 样本位于东经 30°、北纬 20°，用于验证二进制加载和缺块上采样。均不需要 token。

`npm run webgpu:test` 构建后依次执行基础、流式场景和真实页面交互测试。证据写入新的 `benchmarks/runs/` 子目录，包含检查、硬件信息、源码提交、构建/数据 hash、请求列表和截图。独立 quantized-mesh 数据已提交；可用 `npm run webgpu:terrain-fixtures` 重建，不修改原冻结 WebGL fixture。

## 使用 API

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

尚未支持 GroundPrimitive/GroundPolyline、Entity、Billboard/Label、glTF/3D Tiles、任意 GLSL/custom renderState、非 Color 材质、切割/分类、阴影/大气/后处理、二维/Columbus、flyTo/跟踪和 requestRenderMode。不支持的 primitive 类型、外观、拓扑、裁剪和地形布局明确报错；完整 Globe/Scene 的其他效果属性不在本支持声明内。地球基础光照使用固定方向光，不等价于完整时钟/太阳光照系统。

可恢复瓦片错误通过 `renderError` 的 `error.recoverable` 和 `statistics.tileErrors` 报告，不停止整个场景；失败块在本次驻留期使用祖先，重新加载/替换 provider 可重试。GPU 预算不足时降级到已驻留祖先，最小预算无法容纳根纹理时显示 baseColor。设备丢失仍须销毁并重新创建场景。

`resourceStatistics` 统计后端管理的 buffer/texture 数量与估算字节，不是全部物理显存。十轮回归通过不代表长时间/跨 GPU/跨 OS 认证；本轮交付不宣称原计划完整阶段、MVP 或生产 v1 通过。旧 WebGL 动态盒体拾取和上游 Jasmine 失败继续保留在进度报告。
