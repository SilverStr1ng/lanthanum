# 进度报告：原生 WebGPU 基本交互演示

依据用户继续推进到基本可用并发布到 SilverStr1ng/lanthanum 的要求，以及 ADR0002，现已实现原生 WebGPU 的地球交互链路。旧 S01 第二轮报告原样归档于 `docs/reports/s01-round2.md`；本次没有将 S01 或 S02—S24 正式阶段标为通过。

## 已实现

- `Scene.createAsync` 选择 auto/webgpu/webgl2，原同步 Scene/Viewer 不变。
- 原生 device、buffer/texture、WGSL 管线、颜色/深度/对象ID附件、提交与异步读回。
- 复用 Cesium Camera、Globe、QuadtreePrimitive、EllipsoidTerrainProvider 和 UrlTemplateImageryProvider；WGS84 椭球、单层全球地理影像、LOD 与祖先 UV。
- 连续绘制、相机旋转/缩放/定位、opaque Geometry 颜色/位置/显隐、遮挡和 GPU 异步拾取。
- 图层显隐、resize、取消、加载失败事件、设备丢失后停止、多实例和销毁。
- 中文交互页面使用本地 Natural Earth 影像，`npm run webgpu:start` 启动；`npm run webgpu:test` 执行原生及页面回归。

支持范围及错误处理约定详见 `Apps/WebGPU/README.md`。当前只有椭球地表，不包含真实高程、glTF、3D Tiles、Entity、透明/光照/后处理和二维模式，不是计划中的 MVP 或生产 v1。没有用隐藏 WebGL canvas 补绘。

## 当前验证

开发验证 `benchmarks/runs/webgpu-pre-review/result.json`：44项原生集成检查、9项实际页面交互检查通过。包含影像地理控制点像素、祖先UV、±179° LOD、颜色/遮挡/对象ID、几何体移动/显隐/删除、异步加载后销毁、设备丢失、异常/取消、资源归零及禁止WebGL调用的检查。Chrome157.0.8103.40，NVIDIA Blackwell，真实硬件 WebGPU。

完整默认 Jasmine 执行16,035/16,102项，16,018通过、17失败、67跳过；不是全绿。原有 WebGL2 动态盒体异步拾取问题仍见 `docs/issues/dynamic-box-async-pick.md`。完整回归日志 `benchmarks/runs/webgpu-full-regression.log`；失败身份和正式证据正在最终核验。

根 TypeScript 配置只覆盖 scripts 根文件，不能据此声称所有浏览器源码类型检查通过。工作区 `gulp tsc` 目前存在上游类型声明缺项，重新 buildTs 后仍触发 TypeScript 6.0.2 Debug Failure；此项保留为失败，不阻止已验证的 JavaScript 演示。没有修改上游类型声明来掩盖错误。

正式实现提交、三轮证据、两轴审查及远端推送结果在本轮完成后追加。旧manifest与旧证据没有覆写。
