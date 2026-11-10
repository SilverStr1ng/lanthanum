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

最终实现 commit：`3e3e677fc902ffc5cfc530067ca924e221e997c6`。在干净工作树上连续三轮验证，每轮49项原生集成检查、9项实际页面交互检查通过，共174项断言。包含地理控制点像素、祖先UV、±179° LOD、颜色/遮挡/对象ID、几何体移动/显隐/删除、加载中销毁、设备丢失、初始化中取消、地形布局拒绝、资源归零及禁止WebGL调用的检查。Chrome157.0.8103.40，NVIDIA Blackwell，真实硬件 WebGPU。证据归档 `benchmarks/webgpu/basic-v1/`。

三轮构建hash一致，最终帧PNG的SHA256均为 `35ca30bc0626c6a76e74499d282e4a48c6623e56aa51bf7c0ef98663856c1401`。三轮控制台错误为0，销毁后本后端管理的buffer/texture数量与字节均为0；这不是全部物理显存计量。已查看真实帧截图和交互页面截图。

审查前完整默认 Jasmine 执行16,035/16,102项，16,018通过、17失败、67跳过；17项失败身份与原上游基线完全一致，无新增/消失，见 `audit/webgpu-failure-comparison.json`。原生入口审查后的改动仅涉及初始化取消和新provider参数校验，并重跑原生专项。不是全套通过声明。

WebGL2对照20子例×3次仍为57通过、3失败；失败均为已登记动态盒体异步拾取，见 `docs/issues/dynamic-box-async-pick.md`。全部60次资源账本归零；57张正常捕获图与旧证据比较，最小SSIM=0.9999999972126116，显著差异比例=0。对照采集发生于原生功能提交前，summary诚实保留当时e6f1639+工作树修改状态；没有改写成干净正式版本。fixture manifest仍为 `0d476e0b577d9aed36a878f0a7029ac33b9230164e3a60760d8dbed4f863d3d8`。

新改JS ESLint、Prettier和6项Node工具测试通过。根 TypeScript 配置及生成声明后的engine项目检查通过，但未启用checkJs的浏览器JS不因此获得完整类型验证。初次工作区检查缺失生成声明，执行buildTs后该问题消失；随后全工作区检查在 `packages/sandcastle/gallery/tsconfig.json` 触发 TypeScript 6.0.2 Debug Failure。这项失败保留在audit日志，不改写为通过。

双轴审查各发现2项P2，两个轴独立发现同一组取消竞态与地形布局问题；均已修复并只读复核关闭。详情见 `docs/reviews/webgpu-basic.md`。旧manifest和旧证据没有覆写。此交付只满足ADR0002的基本交互范围；完整S01、真实高程、glTF/Tiles/Entity及生产稳定性仍待后续推进。
