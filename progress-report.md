# 进度报告：影像、地形与 Primitive 基本可用

本轮完成用户要求的多图层影像、heightmap / quantized-mesh 地形、标准 Primitive 链路，并修复左键垂直拖拽反向。依据 ADR0003，在原生 WebGPU 上绘制，没有隐藏 WebGL 补绘；完整计划的正式阶段、MVP 和生产 v1 仍未标为通过。

## 已实现

- 最多 8 个可见影像层，增删、顺序、show/alpha 和基础调色；地理/Web Mercator、极区延展、局部矩形及日期变更线、祖先替代、延迟 discard policy、署名和纹理预算。
- 复用 Cesium Worker 解码/构网，真实 heightmap 和 CesiumTerrainProvider quantized-mesh 二进制路径；高程、skirts、夸张、法线基础光照、剔除、缺块上采样、取消、每帧上传预算。
- 标准 PrimitiveCollection / Primitive / GeometryInstance；异步构建与 ready、点线面、Color 材质/PerInstanceColorAppearance、实例颜色/显隐、modelMatrix、排序透明、ID 拾取、移除/释放。每实例独立 mesh，不宣称 GPU instancing。
- 页面使用标准 Primitive 标记，新增地形选择、高程夸张、叠加影像和透明度。左键回归跟踪同一个地表点，验证其沿鼠标右下方向移动。

运行：`npm run webgpu:start`。测试：`npm run webgpu:test`。详细 API 和限制见 `Apps/WebGPU/README.md`。示例山地是合成数据；Natural Earth 仅 0—2 级。GroundPrimitive、Entity、glTF/Tiles、任意 GLSL、OIT、阴影/大气/后处理等仍待后续实现。

## 本轮验证

真实 Chrome 157.0.8103.40、NVIDIA Blackwell / RTX 5080、Windows。基础专项 49 项、流式专项 59 项、页面交互 13 项通过；控制台和 WebGPU validation 错误为 0。包括四层顺序混合、Mercator/极区/日期线与局部图像控制点、1000 米 heightmap / 1500 米 quantized mesh 高程与夸张、真实地形遮挡、点线面/透明/材质、隐藏 ready、非拾取对象、异步销毁。

十轮增删后资源回到基准；十轮四站相机巡游的纹理数量不超过配置的 24 张，GPU 管理资源形成稳定平台，场景销毁后数量/字节归零。该账本不是全部物理显存计量，十轮不替代长期或跨硬件认证。

完整默认 Jasmine：16,018 通过、17 失败、67 跳过。17 个失败身份与旧基线完全相同，无新增或消失。完整套件在审查前执行；审查修复仅涉及原生分支，随后复跑两个原生套件。根 TypeScript、生成声明后的 engine TypeScript、ESLint/Prettier、6 项 Node 工具测试通过；checkJs 未启用，不因此宣称浏览器 JS 已获得完整静态类型验证。旧全工作区 Sandcastle 的 TypeScript 6 Debug Failure 仍为已记录限制，本轮未重跑该已知失败配置。

双轴审查发现 4 个独立边界缺陷（两个轴有重叠），均有红测复现、修复、绿测及只读复核关闭。详情 `docs/reviews/webgpu-streaming.md`。最终干净提交的三轮结果、截图、构建/fixture hash 和回归日志归档至 `benchmarks/webgpu/streaming-v1/`，以其中 summary 为准。

## 保留的历史证据

原基本交互报告已归档 `docs/reports/webgpu-basic-v1.md`；原证据 `benchmarks/webgpu/basic-v1/` 未覆盖。冻结 WebGL fixture manifest 仍为 `0d476e0b577d9aed36a878f0a7029ac33b9230164e3a60760d8dbed4f863d3d8`。本轮独立 quantized-mesh fixture 在 `Specs/WebGPU/fixtures/terrain/`，另记 hash。

历史 WebGL2 对照 20 子例×3 为 57 通过/3 失败，失败均为动态盒体异步拾取，60 次资源账本均归零；本轮未重新采集该组图像对照，不将旧结果改写为新版本通过。原 S01/S02—S24 的完整验收缺口仍按固定兼容矩阵和验收契约记录。
