# 原生 WebGPU 基本交互演示

基于 CesiumJS 1.147 的实验性 JavaScript 入口，复用 WGS84 数学、Camera、Globe、QuadtreePrimitive、EllipsoidTerrainProvider、UrlTemplateImageryProvider 和 CPU 网格生成。GPU 资源、WGSL、深度及对象 ID 附件、命令提交和异步读回由原生 WebGPU 执行，不创建 WebGL context 补绘。

## 运行

需要 Node.js ≥22.17 和具有硬件 WebGPU 支持的桌面 Chrome 或 Edge，在 localhost 或 HTTPS 运行。

```sh
npm ci
npm run webgpu:start
```

打开命令输出的 `/Apps/WebGPU/index.html` 地址。拖动旋转，滚轮缩放，按钮定位；点击地球查看经纬度，点击红色立方体选择对象。Natural Earth 影像随仓库提供，不需要 token；只有0—2级，放大后的清晰度受源影像限制。

`npm run webgpu:test` 先构建并生成固定测试影像，再运行真实 Chrome WebGPU 和页面鼠标交互检查。结果、适配器、构建 hash、fixture manifest、请求列表和截图写入新的 `benchmarks/runs/webgpu-*` 目录，禁止覆盖旧输出。

## JavaScript API

```js
const scene = await Cesium.Scene.createAsync({
  canvas,
  backend: "webgpu", // auto | webgpu | webgl2
  maximumTerrainLevel: 12,
});
scene.globe = new Cesium.Globe();
scene.globe.imageryLayers.addImageryProvider(
  new Cesium.UrlTemplateImageryProvider({
    url: "/tiles/{z}/{x}/{y}.png",
    maximumLevel: 2,
    tilingScheme: new Cesium.GeographicTilingScheme(),
  }),
);
scene.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(110, 20, 18000000),
});
// 在应用的 requestAnimationFrame 中调用 scene.render()。
const object = await scene.pickAsync(new Cesium.Cartesian2(x, y));
const point = scene.globe.pick(
  scene.camera.getPickRay(new Cesium.Cartesian2(x, y)),
  scene,
);
// 结束动画循环后释放场景及其拥有的 globe。
scene.destroy();
```

`auto` 仅在 canvas 绑定前的设备/能力失败时整场景回退到 WebGL2，原因在 `fallbackReason`。强制 `webgpu` 失败会 reject；绑定后失败、取消、设备丢失不会切换后端。`new Scene()`、`new Viewer()` 保留同步 WebGL 路径，本演示没有迁移 Viewer/Widget。

`scene.addGeometry({geometry, modelMatrix, color, id})` 接受含 position 和 indices 的三角形 Geometry，返回句柄。可改 `show`、`color`（alpha=1）、`modelMatrix`；使用 `removeGeometry(handle)` 删除。资源由场景管理，不应直接修改内部 mesh。局部原点和双精度 view×model 在上传前抵消地心大坐标；尚未通过完整高低位/多视锥精度认证。

`pickAsync` 接受 canvas CSS 像素坐标，返回 `{primitive,id}` 或 undefined。地球 ID 为 `"globe"`，几何体 ID 为传入值。最多8个在途拾取，支持 AbortSignal；移除/隐藏对象、销毁场景时不会返回失效对象。`Globe.pick` 是当前已渲染三角网格的 CPU 射线交点，低 LOD 网格高度可低于数学椭球，不能代替精密高度查询。

## 支持边界

| 功能     | 本次支持范围                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------- |
| 启动     | 异步设备、feature/limit 检查、取消、硬件适配器、WebGL2 回退                                                    |
| 地球     | WGS84、3D、EllipsoidTerrainProvider、四叉树 LOD/缓存/释放                                                      |
| 影像     | 一个可见 UrlTemplate 图层；地理投影；全球矩形；根瓦片2×1；minimumLevel=0；无 discard policy；最大级别后祖先 UV |
| 更新     | 连续 render、图层添加/移除/显隐、地球显隐、几何体移动/换色/显隐                                                |
| 相机     | setView、rotateLeft/rotateUp、zoomIn/zoomOut；示例提供指针控制                                                 |
| 绘制     | indexed triangle-list、不透明颜色/纹理、背面剔除、深度遮挡                                                     |
| 拾取     | GPU r32uint 对象 ID 异步读回、CPU Globe.pick                                                                   |
| 生命周期 | resize、销毁、加载中销毁、图像失败事件、设备丢失后停止                                                         |

未支持：多影像层合成、alpha/调色、Web Mercator、局部影像矩形、其他 imagery provider、真实高程地形、glTF、3D Tiles、Entity、通用 Primitive、透明、光照/大气/阴影/后处理、自定义 shader、2D/Columbus、Camera.flyTo/跟踪、requestRenderMode。标准 Globe 上未迁移的效果属性不会生效；常见不支持的模式、材质、光照、裁剪、透明、影像布局/调色会明确拒绝。支持声明仅限上表，不承诺完整 Scene/Globe API 兼容。

设备丢失后需由应用销毁并显式重新创建场景，目前不自动恢复。`renderError` 报告设备/瓦片失败；同步参数错误由调用抛出。`resourceStatistics` 只统计本后端管理的 buffer/texture 数量和估算字节，不是全部 GPU 对象或物理显存。Shader、pipeline、sampler 随设备销毁回收。没有完成长时间稳定性、跨GPU/跨OS或生产性能认证。

原 WebGL2 的动态盒体异步拾取失败和17项上游 Jasmine 失败继续记录在根进度报告；本演示通过不等于完整 S01 或后续阶段通过。
