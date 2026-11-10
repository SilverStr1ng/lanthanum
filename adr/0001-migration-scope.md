# ADR 0001：锁定三维迁移范围和后端路线

- 日期：2026-11-10（Asia/Singapore）
- 状态：已决策；WebGPU 能力均尚待实现/验收
- 决策角色：引擎架构负责人；本轮由执行代理实现并记录，正式发布审查由维护者负责
- 上游：CesiumJS 1.147 / `2aaf1daa6b9be58fb087fdc9f05f2f4d7ee37a87`

## 决策

保留 CPU 地理数学、provider、调度、解析器、场景与 Entity 语义；在 S03 建立最小资源、命令和 pass 接口，同时保留 WebGL2 对照。核心着色器使用受控 WGSL 模块与变体，frame/view/material/object 参数由共享 schema 打包。不得用第二个隐藏 WebGL canvas 补绘 WebGPU 不支持的功能。

生产 v1 是 S00—S21 固定三维范围；S22—S24 才验收 2D、Columbus View、morph 与约定的剩余能力。范围分母是 `compatibility-matrix.md` 的编号条目；每项必须有负责人角色、步骤及测试族，子用例尚缺时写明，不将“能解析”算作“已渲染”。阶段权重沿用计划，未通过 gate 不获得进度权重。

初始化通过未来新增的异步创建入口完成 `auto/webgpu/webgl2` 选择。同步 Viewer 保持原有 WebGL 行为；强制 WebGPU 失败明确拒绝。必须在 canvas 获得 context 前选择后端。运行期回退重建整个 Viewer/canvas，恢复已记录的相机、时间、数据源和应用状态，不原地更换 context。

沿用 `Scene.pickAsync` 的对象拾取语义；深度和其他 GPU readback 增加显式异步入口，支持取消、过期结果丢弃和队列上限。原同步方法不得悄悄返回 Promise 或历史缓存。`CustomShader`/Material 的任意 GLSL 不承诺自动转换；只支持列明子集与 WGSL 受控扩展。第三方插件、实验 API、专有 SDK 默认未认证，调用时明确诊断或应用选择整个 WebGL2 场景。

## 候选 fork 的限时实际评估

候选：https://github.com/kurtyoung-dev/cesium-webgpu ，HEAD `b2e774dd7b8783ba7b7b02712d88ad0c9a6c1dbd`，package 版本 1.145.0，Apache-2.0。独立评估目录为 `D:/Nothing/Lanthanum-fork-audit`。本项目没有复制其实现文件。

实际执行：`npm install --ignore-scripts --no-audit --no-fund` 安装成功；`npm run build` 退出 1，失败于 `draco3d/draco_decoder_nodejs.js` 的 `require("node:fs")` 无法打入浏览器包。完整记录见 `benchmarks/baseline/audit/fork-install.log` 和 `fork-build.log`。样例 `Apps/WebGPUTest/primitive-box-webgpu.html` 的入口/调用已审阅，但构建未通过，未得到可认证样例画面。没有采用 README 的自报百分比。

源码比较显示候选增加 `GraphicsContext`、ContextFactory、Feature Renderers、WGSL registry、双后端构建等较大改造；基线落后两次上游版本，尚未采用 1.147 的 core/gltf 拆分布局。示例有 `Scene.createAsync`、`contextOptions.renderer` 和 `isWebGPU`，这些不是锁定上游现有 API。其架构思路可作为后续研究输入，但整体采用会同时引入大量无法在本轮独立验证的行为。

**复用结论：不整体采用；本轮不复制代码。** 后续允许逐模块评估局部借鉴，需保留来源 SHA、许可证、最小差异和本仓库测试证据。此次构建失败仅说明本机锁定候选未通过，不说明其所有能力不可用，也不推断跨平台结果。

## 后果和风险归属

| 风险 | 处理步骤/角色 |
| --- | --- |
| ECEF f32 精度、深度/NDC/投影方向 | S05/S07，渲染负责人 |
| GLSL 宏、自动 uniform、派生命令、颜色/alpha | S04/S06/S11/S17，shader 负责人 |
| GPU 创建耦合、ContextLimits 多实例污染 | S03/S04/S20，后端负责人 |
| 瓦片取消、缓存、上传背压、父级替代 | S10/S12/S13/S19，流式数据负责人 |
| 对象/位置拾取及 Widget 异步语义 | S14/S16/S21，交互与 API 负责人 |
| 地球销毁残留、device lost、长期增长 | S04/S20，资源生命周期负责人 |
| 平台能力、软件适配器、打包/Worker/WASM | S02/S20/S21，验证与发布负责人 |

S00/S01 不重写地形、Tiles 调度，也不加入云、GI 或 GPU culling。
