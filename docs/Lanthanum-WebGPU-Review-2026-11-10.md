# Lanthanum WebGPU：代码审查、阶段评估与下一轮任务书

> 审查日期：2026-11-10  
> 仓库：[SilverStr1ng/lanthanum](https://github.com/SilverStr1ng/lanthanum)  
> 审查分支与提交：main，`89bc1ef49af6b19cbca37ca815d2db6e1ce0312e`  
> 归档测试对应实现：`6cce0f41fc57afb20fab375909d580bd7d46a2bf`  
> 对照计划：仓库内 `docs/Cesium-WebGPU-Implementation-Plan.md`，S00—S24。  
> 审查方式：固定提交源码审查、归档证据核对、GitHub Actions 日志核对、隔离逻辑复现；本轮未重跑真实 GPU 场景。

## 1. 结论与下一步

**地形、影像和标准 Primitive 的原生 WebGPU 可用子集已经建立，主线整体正确。下一轮应先修复当前子集中的确定问题、冻结模型接入所需的最小渲染契约，然后进入 S11 静态 glTF/PBR。**

可以保留当前可运行的地球、地形、图元、相机与异步对象拾取链路，继续增量推进。现阶段适合称为：

> 原生 WebGPU 影像、地形与标准 Primitive 可用原型。

它覆盖了 S02/S04/S05/S08—S10 的重要部分，并提前完成了一些 S14/S15 子项；还没有完成完整 Viewer、glTF/3D Tiles、Entity、生产性能与恢复能力。仓库本身也明确保留这些边界。[usage] [progress] [scope]

本轮最重要的发现是一个地形任务代际竞态：**旧任务已取消，但仍可能把新一代、已经上传成功的瓦片重置为不可渲染，而且后续加载不能自动恢复。** 此外，普通 Primitive 的 UV 被错误裁剪、闭合透明物体缺背面绘制、高海拔近地裁剪、清洁测试入口和 CI 安装也需要处理。详见第 4 节。

---

## 2. 审查范围与证据可信度

### 2.1 本轮实际检查了什么

- 原生设备、附件、资源统计与读回：`WebGPUContext.js`。
- 管线、WGSL、uniform、绘制：`WebGPUGeometryRenderer.js`。
- 场景、相机、提交、拾取和销毁：`WebGPUScene.js`、`Scene.createAsync`。
- 地形请求、解码、上采样、上传和取消：`WebGPUGlobeTileProvider.js`。
- 多影像层、纹理缓存与地形/影像层级关联：`WebGPUImagery.js`。
- 标准 Primitive 适配与上游对照：`WebGPUPrimitive.js`、`Primitive.js`。
- 原生基础、流式与页面专项，以及测试 runner。
- 当前进度、支持矩阵、验收契约、三轮结果摘要和原始 JSON。
- 当前提交的 CI 安装日志、工作流配置和相关锁文件记录。
- 后续模型迁移的资源创建边界：`GltfLoader` 与 `GltfVertexBufferLoader`。

本轮只进行了读取和审查，没有修改或提交用户仓库代码。

### 2.2 三轮归档证据可以支持什么

归档摘要记录：每轮 49 项基础专项、59 项流式专项；两个入口各执行 13 项页面检查，连续三轮，总计：

`(49 + 59 + 13 × 2) × 3 = 402`

**402 是累计断言通过次数，不是 402 个独立功能。** 原始结果抽查与摘要一致，记录了干净工作树、相同构建 hash、Chrome 157.0.8103.40、NVIDIA/Blackwell WebGPU adapter，以及空的控制台错误列表。[evidence] [basic-result] [streaming-result]

实现提交到当前 HEAD 的变化只涉及证据归档和进度文字，没有运行时或测试代码变化，因此归档结果能对应当前实现内容。但这仍是仓库保存的测试结果，不能表述成本轮审查在新设备上重新运行通过。[head]

精确 RTX 5080 型号来自环境契约；原生结果中的 device/description 字符串为空，记录了 vendor 与 architecture。支持范围应限定为该已记录环境，不能扩大到其他 GPU/操作系统。[contract] [streaming-result]

### 2.3 仍然缺少的证据

| 项目 | 当前已有证据 | 仍待证明 |
| --- | --- | --- |
| 原生绘制 | 原生设备、颜色/深度/ID 附件、真实提交与读回；专项检查未请求隐藏 WebGL 补绘 | 全部支持能力与平台的持续认证 |
| 地形高程 | 1000 m heightmap、1500 m quantized-mesh；CPU 网格拾取和 GPU 遮挡 | 完整 S07 的 0.5 px 投影误差、高精度 GPU 位置拾取 |
| 流式资源 | 十轮增删、相机巡游、管理资源账本有界及销毁归零 | 复杂业务资产、取消乱序、长时间运行和设备恢复 |
| 性能 | 功能短跑和小规模资源统计 | 原生 1080p、30 s 预热、120 s 采集、三轮分位数 |
| 回归 | 归档完整 Jasmine 16,018 通过、17 失败、67 跳过，失败身份无新增 | 当前修复后的完整重新回归；跨平台安装与运行 |
| 发行 | 本地启动与专项入口 | 清洁安装可复现、部署、完整 Viewer/Widget、迁移文档 |

高程专项主要通过 `Globe.pick` 的 CPU 网格交点验证，容差为 10 m；同时另有 GPU 地形遮挡测试。这些结果有价值，但不能换算为“GPU 位置误差已达 0.1 m”。[stream-tests]

原生 runner 的浏览器窗口为 960×540，测试内部还会设置较小的 canvas；页面检查使用另外的窗口尺寸。现有记录不能当作原计划的 1920×1080 正式性能验收。[runner] [demo-tests]

---

## 3. 当前阶段定位与进度

### 3.1 已完成的可用子集

| 模块 | 已能确认的实现 | 当前边界 |
| --- | --- | --- |
| 影像 | 多图层，顺序/show/alpha 与基础调色；Geographic/Web Mercator；局部矩形、日期线、祖先替代、纹理预算 | 声明上限八层；更多 provider 协议、独立影像 LOD、生产工作集和完整图像对照待补 |
| 地形 | 复用 Cesium/Worker 的 heightmap、quantized-mesh 解码与构网；高程、skirts、夸张、基础法线光照、剔除、缺块上采样 | WGS84、全球 Geographic 2×1 根；完整深度精度、取消代际、复杂接缝与生产负载待补 |
| Primitive | 真正通过标准 Primitive/GeometryInstance/PrimitiveCollection 接入；同步/异步构建、ready、点线面、Color 外观、实例属性、ID 与销毁 | 每实例独立 mesh；尚无 batching/instancing、Entity、Label/Billboard、GroundPrimitive、任意材质 |
| 交互 | 原生异步对象 ID 拾取、输入与演示控件、有限在途读回 | 实验 Scene；同步 Viewer 不变；无完整 Widget、GPU 位置拾取、flyTo/tracking/requestRenderMode |
| 生命周期 | 管理资源账本、销毁、初始化失败与设备丢失后停止 | 不等于自动恢复、整场景运行中回退或长期认证 |

这些结论同时依据实际代码和本轮支持说明；不是把文档中的功能名直接当作实现完成。[usage] [scene] [primitive] [terrain] [imagery]

### 3.2 对照原计划

| 原计划步骤 | 本次判断 |
| --- | --- |
| S00—S01 | 已有范围、基线与证据机制；完整 S01 的专项覆盖与可复现性仍待收口，既有失败需持续登记 |
| S02 | 异步初始化与明确后端选择已有实现；启动、能力与失败分支的完整验收待补，完整恢复另属 S20 |
| S03—S06 | 原生资源、特制 shader、管线和 Primitive 适配已有实现；尚未形成可覆盖 Model 的完整后端、材质与变体契约 |
| S07 | 已有 CPU 双精度局部原点抵消与投影转换；完整精度门槛未认证，且 near 策略有明确缺陷 |
| S08—S10 | 实验场景中的地球、影像、地形已形成实际链路；完整步骤仍有功能与验收缺口 |
| S11—S13 | 原生 glTF、模型动画/扩展和 3D Tiles 尚未接入，是下一条主要能力链 |
| S14 | 异步对象 ID 子集已做；GPU 位置、矩形拾取、接口时效与 Widget 仍待收口 |
| S15 | 标准 Primitive 子集提前推进；Entity、数据源、标注等未完成 |
| S16—S18 | 贴地分类、广泛效果、自定义 shader 等主要工作仍在后续 |
| S19—S21 | 已有部分统计与释放测试；正式性能、恢复、跨平台与发行未完成 |
| S22—S24 | 扩展兼容阶段尚未开始 |

依据是当前实现、支持矩阵与验收契约，不把实验子集替换为原计划完整 gate。[compat] [contract]

**编号需要统一：** 仓库支持矩阵把部分动画/压缩项归入 S11、Tiles 主体归入 S12，与原实施计划的 S11 基础模型、S12 模型扩展、S13 Tiles 不完全一致。本报告沿用原实施计划编号；N04 应修正矩阵映射，避免后续执行错位。[compat] [original-plan]

### 3.3 完成百分比如何理解

如果需要用于安排资源的粗估，**生产 v1 的工程实现进度约为 25%—35%，可以暂按约三成理解**。这是基于原阶段权重的工程判断，不是已经测得的验收完成率，也不是剩余工时的精确预测。

原计划规定了阶段权重；下面每一阶段计入的区间是本轮主观工程估计，并非原计划预先划定的子任务验收分值。

| 阶段 | 原计划权重 | 估计计入总进度的百分点 |
| --- | ---: | ---: |
| G0 范围与证据 | 5 | 3 |
| G1 渲染基础 | 25 | 8—10 |
| G2 地球系统 | 20 | 12—15 |
| G3 模型与交互 | 20 | 1—2 |
| G4 业务覆盖 | 15 | 1—4 |
| G5 生产交付 | 15 | 0—1 |
| 合计 | 100 | 25—35 |

该估计给了可运行的地球系统实质进度，同时保留 glTF/Tiles、材质体系、GIS 业务能力和生产验证的大量工作。代码量、截图数、断言累计次数都不用于直接计算百分比。

**完整 WebGPU 阶段尚未正式签收。** 这表示验收链还未闭合，不表示已经完成的实现没有价值。正式进度仍应按固定矩阵和 gate 记录，不能把本节估计填成“已验收 30%”。

---

## 4. 本轮发现的问题

严重度说明：P1 表示优先修复的正确性/生命周期问题；P2 表示需要处理的功能边界或工程可复现性问题。本次未发现需要称为 P0 的全局阻断事故。

### F01 · P1：旧地形任务可以破坏新一代瓦片状态

**位置：** `WebGPUGlobeTileProvider.finishFrame()`、`loadTile()`、`NativeTileData.freeResources()`。[terrain-cancel] [terrain-load]

**触发顺序：**

1. 某瓦片的旧请求或 Worker 任务仍未完成。
2. 相机离开超过两帧，`finishFrame` 调用旧 data 的 `freeResources`，将它标记为 cancelled。
3. 旧任务不能立即结束，因此仍在 `_terrainRequests` 中。
4. 相机返回，同一 tile 生成新 data；新请求先完成并上传，tile 已为 DONE/renderable。
5. 后续 `finishFrame` 再次遍历旧 data，无条件将它引用的 tile 改为 START、renderable=false。
6. 新 data 的 `started` 仍为 true，下一次 `loadTile` 直接返回，不能恢复已被改坏的状态。

这会使受影响瓦片无法正常恢复渲染，具体画面取决于父级替代等调度行为，不能只依赖用户再次飞走来解除。

**本轮复核：** 执行固定版本类中的实际方法，只对外部几何与 GPU 依赖使用 stub，按上述可达顺序完成确定性复现。输出为：

~~~text
新一代上传完成：DONE，renderable=true，currentStarted=true
旧取消任务再次处理：START，renderable=false，currentStarted=true
旧任务最终结束后再 loadTile：仍为 START，renderable=false
~~~

这是逻辑复现，未声称已经采集了真实 GPU 黑洞截图。

**修复方向：**

- 所有异步状态写回检查当前所有权，例如 tile.data 是否仍是当前 data，以及 provider/scene generation 是否有效。
- 已取消旧任务不能继续改写 tile.state、renderable 或当前 mesh。
- 区分逻辑取消与实际仍在执行的请求/Worker，保持物理在途工作预算，避免为了清空计数而无限发新任务。
- provider 切换、夸张参数变更、tile 重建及 scene 销毁采用同一套有效性规则。

**完成标准：**

- [ ] 新增“旧任务取消→返回→新任务先完成→旧任务后完成”的红测，修复前稳定失败。
- [ ] 新瓦片成功上传后，旧任务的完成、拒绝与取消都不能再改变它。
- [ ] 延迟 100 ms、1 s 与受控长等待均有明确结束或取消行为。
- [ ] 重复至少 20 次离开/返回，状态、请求预算和资源账本保持正确。
- [ ] 既有 provider 切换、地形夸张、加载中销毁测试继续通过。

### F02 · P2：普通 Primitive 被影像的 UV 裁剪规则误删

**位置：** 共用 WGSL 片元程序无条件执行 UV clip；draw 默认 clip 为约 [0,1]；Primitive 原样上传 ST。[renderer-clip] [renderer-default] [primitive-upload]

合法的 Color/PerInstanceColor 三角形可以带有负数或大于 1 的 ST。其颜色外观并不使用 ST 决定可见性，但当前 shader 仍会把这些片元 discard。例如三个顶点的 ST 都为 (2,2) 时，整个三角形和对象 ID 都会消失。

已通过实际 upload 方法的隔离检查确认 ST 被接受并原样进入顶点数据；再根据当前 WGSL 条件确认必然触发裁剪。未重跑真实 GPU 像素测试。

**修复方向：** 显式区分影像瓦片裁剪与普通几何材质行为，例如按 draw 用途启用裁剪或拆分 shader 模块。后续 glTF 的 UV repeat 也依赖这个边界。

**完成标准：**

- [ ] Color/PerInstanceColor 下，缺省 ST、[0,1]、负值、>1 四组几何都可正常显示和拾取。
- [ ] 影像局部矩形、日期变更线、祖先 UV 裁剪继续正确。
- [ ] 不靠修改输入 ST 或扩大一个任意 clip 常量掩盖用途混淆。

### F03 · P2：高海拔近地物体可能被自动 near 裁掉

**位置：** `WebGPUScene.render()` 每帧按椭球高程重写 near/far。[scene-depth]

当前 near 为 `max(0.1, abs(椭球高程)/1000)`。相机位于约 5001 m 高程、面对前方 1 m 的物体时，near 变为 5.001 m；即使应用事先设置 near=0.1，也会被覆盖。

按当前投影与深度映射解析计算，1 m 处目标的 WebGPU NDC 深度约为 -4.001，位于近裁剪面之外。这是确定的裁剪策略问题，不能用“使用了 depth32float”解决。

**修复方向：** 明确应用可设 frustum 与内部深度策略的边界。使用合适的可见距离、地形相对距离或受控分区，保留有效的近处几何；不要直接把椭球高程当作最近可见距离。

**完成标准：**

- [ ] 海平面及约 5000 m 高程平台，前方 1/2/10 m 控制几何均正确可见和可拾取。
- [ ] 显式 near 设置按文档契约生效。
- [ ] 远景、轨道视角和既有地形遮挡回归继续通过。
- [ ] 记录 near/far/深度策略；不把解决这个用例等同于完整 S07 已通过。

### F04 · P2：闭合透明 Primitive 缺少背面绘制

**位置：** 新路径对 closed 外观固定剔除背面，每条记录仅绘制一次；上游 Primitive 对 closed 且 translucent 明确生成前后两次绘制。[primitive-cull] [scene-draw] [upstream-transparent]

单个、不与其他透明物体相交的半透明盒体就能暴露差异。在黑色背景、flat 红色、alpha=128/255 的条件下，只混合前表面约得到红色 128；前后表面的解析混合值约为 192。相机进入盒内时，固定背面剔除还会使内表面消失。

本轮已核对两条代码路径并计算预期混合值，仍需用相同设置的 WebGL2 控制组生成真实 GPU 红测。该问题不属于文档已经声明的“相交透明对象排序不保证正确”，也不要求先完成 OIT。

**完成标准：**

- [ ] 闭合透明盒体与椭球，外部/内部视角都与约定的上游行为一致。
- [ ] 背面与正面的顺序、depthWrite、ID 与混合规则明确。
- [ ] 不只把 cull 改成 none 后依赖偶然的三角形索引顺序。
- [ ] 已有近远透明对象排序用例不回退。

### F05 · P2：默认测试入口依赖未提交的父目录

**位置：** `scripts/webgpuTest/run.js` 默认使用 `benchmarks/runs/webgpu-*`，但直接以 `recursive:false` 创建叶目录。[runner-mkdir]

固定 HEAD 中没有 `benchmarks/runs`，生成 fixture 的脚本只创建其自身输出目录。因此清洁 checkout 的测试入口会在浏览器启动前遇到 ENOENT；开发机已有被忽略目录时不会暴露。

本轮在临时空目录执行当前源码的 mkdir 语句，确认结果为 ENOENT。这是文件系统最小复现，没有执行完整 npm/GPU 流程。

**修复方向与标准：**

- [ ] 先递归创建 output 的父目录，再以非递归方式创建唯一叶目录。
- [ ] 保持已有证据目录不被覆盖的保护。
- [ ] 完全不存在 runs 父目录时可启动测试。
- [ ] 叶目录已存在时明确失败或选用新的唯一目录，不能覆盖历史证据。

### F06 · P2：当前 CI 在依赖安装阶段失败

当前 main 的 dev、sandcastle-dev、deploy 均有失败；核查日志后，失败发生在 `npm install`，原因为：

~~~text
@ast-grep/cli
node postinstall.js
Failed to locate @ast-grep/cli native binary.
~~~

这是安装/工具链可复现性问题，不能据此宣称 WebGPU 渲染测试失败，因为后续构建和测试没有执行。[ci-dev] [ci-sandcastle] [ci-deploy]

本地契约固定 Node 24.15.0/npm 11.6.1，CI 主工作流仍使用 Node 22，实际日志为 22.23.4/npm 10.9.9。锁文件声明了各平台 optional dependency，但对应安装包条目只见 Windows x64，缺少 Linux x64 项。这与日志症状吻合，仍需清洁 Linux 安装确认根因，不能写成已经证明的唯一原因。[workflow] [lock] [baseline]

**完成标准：**

- [ ] 明确唯一主工具链及额外支持版本，CI 与本地配置一致。
- [ ] Windows 与 Linux 清洁安装都能解析并安装正确平台的依赖。
- [ ] 使用冻结锁文件的可复现安装流程，不通过浮动 install 隐式改变验收依赖。
- [ ] 实际运行 ast-grep、构建、lint/类型检查；不能通过永久跳过检查取得表面绿色。
- [ ] 本轮保留原 17 项已知失败及其身份比较，新增失败必须显式暴露。
- [ ] 通用 CI 没有真实 WebGPU 硬件时，与硬件专项分开报告。

### 4.7 应单独安排的 LOD 收敛工作

另外两个有源码依据的限制应共同处理：

1. 原生地形路径未维护 `upsampledFromParent`。上游四叉树依赖它停止四个子瓦片全为上采样时的无意义继续细化。当前仍受 maximumTerrainLevel 截止，**不是无限递归**，但缺少更细真实数据时可能额外触发 CPU 构网和上传。[terrain] [quadtree]
2. 影像层级直接采用 terrain tile.level 并受其上限约束。通常 minimumLevel 不高于当前 tile.level 时，地形封顶 12 会使 provider 的 16 级影像得不到请求；祖先回退只能降级，不能补上更高影像细节。[imagery-level]

两者有耦合：直接让所有上采样子瓦片停止细分，可能进一步锁住影像细节。应设计地形数据细化、地表几何细分与影像 texel 需求之间的关系；当前可先记录边界并加入测试，放在真实高分辨率业务工作集之前验收。

---

## 5. 从当前代码继续执行的分步计划

以下是针对当前实现调整后的近期计划，沿用原计划 S00—S24 的范围和阶段名称。N01—N04 组成下一轮“基础能力收口”；N05—N08 组成其后的“静态模型接入”。这些是本报告提出的执行任务与验收门槛，不是已经完成的结果。

| 顺序 | 任务 | 依赖 | 交付物 | 通过后获得的能力 |
| --- | --- | --- | --- | --- |
| N01 | 修复地形代际取消竞态 | 当前实现 | 生命周期修复、乱序完成专项 | 快速离开/返回时瓦片可靠恢复 |
| N02 | 修复共享绘制语义 | 当前实现；可与 N01 分工并行 | UV、透明闭合体、近裁剪修复与回归 | 现有 Primitive 与地球交互更可靠 |
| N03 | 修复清洁安装和测试入口 | 当前实现；可并行 | 跨平台锁文件/工具链、runner 修复 | 新环境能复现验收 |
| N04 | 关闭本轮验收与文档差异 | N01—N03 | 非平坦地形专项、三轮结果、支持矩阵 | 形成可继续扩展的基础版本 |
| N05 | 冻结模型接入的最小渲染契约 | N04；接口研究可提前 | ADR、绘制/资源接口、边界测试 | Model 不再被迫套进影像绘制规则 |
| N06 | 接入静态 glTF 最小链路 | N05 | 原生模型适配器、资源加载、样例 | 地球上正确显示和拾取静态模型 |
| N07 | 完成约定 PBR 与材质行为 | N06 | WGSL 材质变体、材质对照图 | 静态模型具有可信的材质表现 |
| N08 | 验收静态模型子集 | N06—N07 | 组合场景、生命周期/性能证据 | 可进入 S12、S13 的基础版本 |

N01—N03 可以由不同开发者并行，但应保持小提交和独立回归。N04 的证据必须来自合并后的同一个实现版本。N05—N08 不与第一轮修复混成一个难以回归的大提交。

下面“子集通过”表示限定能力的工程验收通过，可以继续增量开发。**原 S11 的正式签收仍需精度与地球系统等前置 gate 闭合**，或按项目既有范围治理形成明确修订；不能用子集名称悄然替换原阶段的完成标准。

### N01：先修复地形任务所有权

**目标：** 消除 F01，建立地形请求、Worker 构网、上传队列与 tile 当前状态之间的一致所有权。

**执行步骤：**

1. 将第 4 节 F01 的可达顺序加入自动化测试。使用可手动 resolve/reject 的 provider，控制两代任务的完成顺序。
2. 明确 tile data、provider/夸张版本和 scene 的有效期；将检查放在异步回调、上传入口与状态回写处。
3. 区分逻辑取消、真实网络请求结束、Worker 任务结束和 GPU 资源释放，分别维护预算。
4. 补充取消后返回、切换 provider、修改夸张、销毁后迟到完成四类回归。

**交付物：** 生命周期修复、小型确定性逻辑测试、真实浏览器集成用例、状态/资源计数结果。

**完成标准：**

- [ ] 修复前，旧代晚到可以稳定使新瓦片不可渲染；修复后同一用例通过。
- [ ] 新代先完成、旧代先完成、旧代拒绝、旧代无法立即 abort 四种顺序全部通过。
- [ ] 20 次离开/返回后，可见瓦片恢复完成，且实际在途工作不超过配置预算。
- [ ] 新 data 已经成功上传时，旧任务不能改变其 state、renderable、mesh 或资源所有权。
- [ ] 场景销毁后没有新 GPU 上传、无未处理 Promise rejection，管理资源返回约定基线。

**退出条件：** F01 关闭后，地形模块才进入本轮最终验收。只让资源计数归零而画面不能恢复，不能算通过。

### N02：把普通几何与影像专用规则分开

**目标：** 修复 F02—F04，使现有 Primitive 和后续模型可以共享底层资源与管线，而保留不同材质的语义。

**执行步骤：**

1. 让影像 UV 范围裁剪成为显式能力或专用 shader 变体；纯色几何不读取无关的裁剪状态。
2. 冻结 near/far 的控制规则，支持高海拔地表附近的近物体，不再每帧无条件覆盖用户设置。
3. 对 closed + translucent 实现明确的背面/正面绘制规则；核对剔除、排序、深度与 ID 行为。
4. 将颜色、遮挡、ID 三条可见性规则对齐；保留现有每次绘制所需参数的正确生命周期。

**交付物：** 三类修复、成对的 WebGL2/WebGPU 夹具、像素/ID 对照结果。

**完成标准：**

- [ ] 同一 Color Primitive 在无 ST、ST 属于 [0,1]、ST 为负、ST 大于 1 时都正确显示并可拾取。
- [ ] 局部影像、日期线裁剪和祖先替代的既有专项继续通过。
- [ ] 海拔 0 m 与约 5000 m 两组场景中，眼前 1 m、2 m、10 m 的目标按 frustum 设置正确显示；轨道远景仍正确。
- [ ] 单个闭合透明盒体/椭球在外部和内部视角与冻结的控制组规则一致。
- [ ] 修复不会引入每帧同步 GPU 读回，也不会使同一提交中的不同 draw 误读最后一次 uniform 更新。

**退出条件：** 三个问题各有修复前失败、修复后通过的证据。真实 GPU 验证仍未运行的用例必须保持“待验收”。

### N03：恢复清洁环境的可复现性

**目标：** 修复 F05—F06，使本地成功的运行能够在新目录和 CI 环境中复现。

**执行步骤：**

1. 明确 Node/npm 主版本契约，让本地文档、package 配置和工作流一致；额外支持版本独立列出。
2. 在清洁 Windows/Linux 环境检查 optional dependency 的实际安装，修复或重新生成可跨平台使用的锁文件。
3. 使用冻结锁文件的安装流程执行构建与检查；核实 ast-grep 可运行。
4. 修复 runner 父目录创建，并保留证据目录不被覆盖的规则。
5. 分开报告通用 CI、WebGL2 回归和有真实 adapter 的 WebGPU 专项，不能以一种结果替代另一种。

**交付物：** 工具链契约、锁文件和工作流修复、两平台安装记录、runner 文件系统测试。

**完成标准：**

- [ ] 两个平台从无 node_modules 的 checkout 完成冻结依赖安装。
- [ ] 构建、lint/类型检查和约定 CPU 测试实际执行，未因 postinstall 失败提前退出。
- [ ] 没有 `benchmarks/runs` 时，默认 WebGPU 测试入口能进入浏览器阶段。
- [ ] 输出叶目录已存在时，不覆盖原始结果。
- [ ] 回归报告显示旧失败集合与当前失败集合的差异；不得只比较失败数量。
- [ ] 如果通用 CI 没有 WebGPU 硬件，报告明确写“未执行”，并指向独立硬件结果。

### N04：完成基础子集的本轮签收

**目标：** 把“影像、地形、Primitive 已完成”转化为有范围、有版本、有证据的阶段结果。

**执行步骤：**

1. 增加一组非平坦地形夹具：至少 2×2 相邻瓦片、两种相邻 LOD、明显山脊、已知缺瓦片；保存预期边界与高程样本。
2. 在约定相机轨迹下检查接缝、遮挡、裙边开关、缺块替代、离开/返回和夸张更新。
3. 对上采样细化与影像 LOD 添加独立观察用例；决定本版本是修复，还是明确列为下一工作集的阻塞条件。
4. 在合并后的实现提交运行完整既有专项与新增专项，连续三轮；归档代码 SHA、构建 hash、fixture hash、浏览器/adapter、结果和截图。
5. 同步根 README、Apps/WebGPU/README、progress-report、compatibility-matrix、acceptance-contract。统一原计划与支持矩阵的步骤编号；历史基线标明日期，避免被理解为当前状态。

**交付物：** 基础能力验收包、已知限制列表、本轮关闭/未关闭问题表。

**完成标准：**

- [ ] F01—F06 每项都有明确结果，未关闭项不能隐藏在“测试全过”的总句后面。
- [ ] 非平坦、多级相邻地形在冻结相机轨迹中没有新增可见接缝或遮挡反转；记录裙边开关对应的预期行为。
- [ ] 记录真实地形请求、上采样任务、上传数及影像请求层级，以便后续 LOD 工作可比较。
- [ ] 既有 49/59/页面专项与新增用例均按名称列出；重复三次仅计为三次运行，不扩大功能数量。
- [ ] 新增回归失败为零，旧失败集合可追踪；专项无未处理错误、无非预期 GPU validation error。
- [ ] “原生可用子集”“完整原计划步骤”“生产 v1”三个状态分别记录。
- [ ] 模型扩展与 Tiles 的 S11/S12/S13 映射统一，任务编号能直接回指原计划。

**本轮到此可以独立交付。** 不要求同时完成所有旧阶段的全部功能，但不允许把当前子集签收写成 G1/G2 全部完成。

### N05：为 Model 冻结最小渲染契约

**目标：** 接通模型所需的明确接口，避免继续向“影像 + 纯色几何”的固定布局叠加隐式分支。

**关键现状：** 上游 `GltfVertexBufferLoader` 会调用 `Buffer.createVertexBuffer` 创建资源。这说明复用 loader 不能简单等同于把现有 WebGPUContext 传给旧 WebGL 资源路径；必须识别 CPU 解析/解码与 GPU 创建的边界。[loader]

**执行步骤：**

1. 审计 GltfLoader、子 loader、ResourceCache 与 Model pipeline：标注可直接复用、需要适配、必须新增的部分。
2. 定义设备资源所有权与静态模型 draw packet：顶点布局、索引、实例变换、材质、包围体、拾取 ID、pass 与生命周期。
3. 定义模型纹理语义：用途、颜色空间、sampler、mip、UV 集合。把影像区域裁剪留在影像路径。
4. 将 shader 变体、绑定布局、目标格式、深度、混合、剔除及采样数纳入所需管线键；不把未来变体塞进只适用于当前固定 shader 的键。
5. 用 ADR 决定公开入口：接入原生 `Model.fromGltfAsync` 的哪一部分，或提供明确命名的实验异步适配入口。选定后统一文档和测试。
6. 将 pipeline 编译纳入有限并发的异步准备与缓存流程；区分资源已加载、材质已编译和对象可绘制，编译失败携带模型、shader 与变体信息。

**交付物：** 一份接口 ADR、loader 边界清单、可执行的资源/绘制接口、基础回归结果。

**完成标准：**

- [ ] 资源创建边界明确，模型路径不会调用 WebGL Buffer/Texture/Context，也不会启动第二个 WebGL canvas。
- [ ] 地形、影像、Color Primitive 三条既有路径继续通过 N04 专项。
- [ ] 不同材质/顶点布局不能错误命中相同的不兼容 pipeline；同类静态绘制能复用 pipeline。
- [ ] 缓存项的引用、销毁、device generation 和异步写回规则都有明确所有者。
- [ ] 模型仍未实现的 API/能力明确返回不支持，而不是悄悄降级成颜色网格。
- [ ] 新材质首次进入与同变体重复加载分别验收；复杂管线不会在每帧绘制热路径反复编译，编译失败与取消能结束 ready 流程并释放临时资源。

**范围控制：** 本步只建立真实需求驱动的最小接口，不要求先写一个覆盖全部图形 API 的通用 RHI。

### N06：实现静态 glTF/GLB 最小闭环（S11a）

**目标：** 在原生地球场景中加载、显示、定位、拾取、移除一个具有纹理的静态模型。

**执行步骤：**

1. 固定静态子集与资产：glTF 2.0 JSON + 外部 bin/图片，以及 GLB；先覆盖三角形、索引/非索引、节点层级和静态变换。
2. 优先复用已有 CPU 解析与 accessor 处理；对交错步长、偏移、归一化属性、稀疏 accessor 分别列出支持或拒绝策略。
3. 接入原生 buffer/texture/sampler 上传，处理异步 ready、失败、取消与迟到完成。
4. 实现 baseColor 的静态材质路径；声明支持 unlit 时，给该扩展独立用例和能力项。
5. 将模型局部坐标、节点变换与地理 modelMatrix 对齐，并接入颜色、深度、对象 ID 和销毁链路。

**交付物：** 静态模型适配器、示例页面、资产清单、加载与变换专项。

**完成标准：**

- [ ] `.gltf + .bin + PNG/JPEG` 与 `.glb` 两种路径均可从固定本地 fixture 加载。
- [ ] 索引/非索引、交错/独立属性 buffer、多个 mesh/node、TRS/matrix 层级均有覆盖；未支持的 accessor 类型明确失败。
- [ ] 模型按已知地理位置、朝向和米制尺寸显示，地形能遮挡模型，模型也能遮挡其他几何。
- [ ] baseColor 纹理无翻转/错位；repeat UV 超出 [0,1] 时不会被影像 clip 丢弃。
- [ ] 拾取返回约定的模型对象/ID；异步读取完成时已删除的模型不会被当作当前有效对象。
- [ ] 未支持的 required extension 明确报错；皮肤、morph、动画和压缩资产的支持状态有可见说明与测试，不能把静态错误结果视为支持。
- [ ] 没有隐藏 WebGL 模型绘制；原有地形、影像和 Primitive 专项继续通过。

**命名要求：** 此时称为“S11 静态 glTF 子集”或“S11a”，不称为“完整 glTF/Model 已完成”。

### N07：补齐静态 PBR 与可见性规则（S11b）

**目标：** 让静态模型的材质结果符合本版本选定的 glTF 行为，而不是仅保留外形。

glTF 的静态模型约定涉及节点变换、纹理采样、金属度/粗糙度材质、alpha 和双面行为。具体语义以官方规范为依据；下面的实施顺序和测试门槛是本项目的工程建议。[gltf-spec]

**执行步骤：**

1. 实现 metallic-roughness 核心路径，包括相应纹理通道、factor、normal、occlusion、emissive；区分颜色纹理与数据纹理。
2. 冻结照明与输出：方向光、环境贡献/IBL 的支持范围、曝光、色调映射与输出颜色空间。与控制组使用同一约定，不拿不同照明下的截图判定实现优劣。
3. 覆盖有/无 normal、有/无 tangent、非均匀缩放、负缩放、双面法线与背面剔除。合法缺省 NORMAL 的三角形使用约定面法线；normal map 缺省 TANGENT 时采用受控重建或导数策略，并检查镜像/退化 UV。
4. 先完成 OPAQUE/MASK；MASK 的丢弃规则在颜色、深度和 ID 路径一致。BLEND 单独实现和验收，或明确留在后续 S17 收口，不能无声当作 OPAQUE。
5. 核对 sampler wrap/filter 和 mip；使用正确语义处理多个材质和多个 UV 集合，未支持组合明确写入矩阵。

**交付物：** 材质变体、支持矩阵、固定光照控制组、差分图/数值结果。

**完成标准：**

- [ ] 金属/非金属与粗糙度变化、normal、occlusion、emissive 分别有隔离用例，避免一个复杂模型掩盖错误。
- [ ] 颜色空间、纹理通道与采样模式的数值用例通过；模型换材质不污染其他 draw 的绑定。
- [ ] 非均匀/负缩放和 doubleSided 用例正确；默认材质有稳定结果。
- [ ] 缺省 NORMAL、缺省 TANGENT、镜像 UV 与退化三角形各有隔离用例，不产生 NaN 法线；S11a 暂时拒绝的缺省法线资产在本步关闭前得到正确处理。
- [ ] MASK 透明孔洞在颜色、深度遮挡、ID 拾取上完全一致。
- [ ] 对照图使用实施前冻结的相机、照明、曝光、画布和差分阈值；不在看到失败后放宽阈值。
- [ ] 已支持、部分支持、明确拒绝三类能力与运行结果一致。

**退出条件：** 与 N06 一起完成后，可以签收约定的静态模型/PBR 子集。原 S11 的剩余验收项仍要逐项对照，不自动标记整个阶段完成。

### N08：对组合场景、资源和性能做阶段验收

**目标：** 证明模型接入后，已有地球链路仍可持续使用，并留下进入 S12/S13 的基线。

**执行步骤：**

1. 建立“影像 + 非平坦地形 + Primitive + 多静态模型”的固定组合场景，覆盖近地、山地高海拔和轨道视角。
2. 验证慢下载、失败资源、加载中取消、删除后迟到结果、重新添加同一资源及共享纹理引用。
3. 沿用原计划性能协议：固定真实硬件和 1920×1080 drawing buffer，30 s 预热、120 s 采集、连续三轮。分别运行不含模型的 N04 场景和新增模型组合场景；必要时按同一协议重测 N04 版本作为控制组。
4. 记录 CPU 帧耗时与 GPU 时间的可用性、p50/p95/p99、上传量、draw 数、资源账本、首帧和可交互时间；不能把 CPU 提交时间称为 GPU 时间。
5. 归档静态模型子集证据和明确的下一阶段入口。

**交付物：** 集成专项、性能基线、资源生命周期结果、当前实现/证据 SHA 与资产 hash。

**完成标准：**

- [ ] N04 的全部当前子集专项与新增模型专项在同一实现版本连续三轮通过。
- [ ] 20 次加载/取消/移除循环后，活动对象与在途任务归位，缓存保持预算内；scene.destroy 后管理资源归零。
- [ ] 模型移除不会破坏仍被其他模型引用的纹理；共享资源最终只释放一次。
- [ ] 固定工作集无持续增长的资源趋势，无未处理错误和非预期 GPU validation error。
- [ ] 对完全相同、不含模型的 N04 场景，后端改造的帧耗时/上传回归不超过事先冻结的预算。
- [ ] 新增模型组合场景按其事先冻结的绝对预算或同资产、同画质的 WebGL2 控制组独立验收，不与无模型场景直接比较总成本；预算变更单独说明依据。
- [ ] 报告分别列出功能通过、性能达标、未测平台与未支持特性；下一步明确为 S12 模型能力或 S13 Tiles 所需前置项。

Khronos 的 glTF Sample Assets 可用于挑选静态材质资产；应固定文件版本、hash 和资产说明，按模型自身许可保留归属信息。先选能隔离一项行为的模型，再加入代表性复杂模型。[gltf-assets]

---

## 6. 可直接交给开发者或 Codex 的下一轮任务书

以下任务书限定为 N01—N04。完成后再按 N05—N08 开始模型工作，保持每轮结果可检查。

~~~text
项目：SilverStr1ng/lanthanum
参考审查提交：89bc1ef49af6b19cbca37ca815d2db6e1ce0312e
目标：收口当前原生 WebGPU 影像、地形、标准 Primitive 可用子集。

开工时先记录实际基线提交。若已包含后续修复，按对应复现用例确认，
不要机械重复修改。阅读现有 ADR、acceptance-contract、compatibility-matrix、
Apps/WebGPU/README 与本报告，保留现有范围约定。

必须依次完成：
1. 为旧地形 data 取消后仍能重置新 tile 的竞态加入稳定失败用例，
   修复代际所有权；覆盖两种完成顺序、拒绝、无法立即 abort、销毁。
2. 修复 Color Primitive 被影像 UV clip 丢弃、closed translucent
   缺背面绘制、海拔驱动 near 裁掉近处对象三类问题。
3. 修复清洁 checkout 的测试输出目录创建；排查并修复 CI 中
   @ast-grep/cli 平台依赖安装失败，统一 Node/npm 与锁文件流程。
4. 增加非平坦相邻 LOD 地形、缺瓦片和快速离开/返回集成用例。
   对上采样停止细化与影像 LOD 耦合建立独立用例和明确后续工单。
5. 对合并后的同一实现运行既有专项及新增专项，连续三轮。
   保存实现 SHA、构建 hash、fixture hash、浏览器/adapter、原始结果、
   截图及失败身份差异；没有真实 GPU 执行的项目标为未测。
6. 更新 README、进度报告、支持矩阵和验收说明；历史基线标明日期。

验收：本报告 N01—N04 的全部 checkbox 逐项提供证据。
旧的上游失败保持可追踪，不要求借此轮顺便修复所有不相关问题；
任何新增失败都必须显式列出。不得通过隐藏 WebGL 绘制、跳过检查、
覆盖历史结果或减少测试断言来取得通过。

交付报告必须分开说明：已实现、已验收、未执行、已知限制。
本轮结束时给出 N05 最小渲染契约的建议接口和影响文件清单，
静态 glTF/PBR 的实际开发进入下一轮 N05—N08。
~~~

---

## 7. 此后主线与里程碑

| 里程碑 | 原步骤 | 主要交付 | 明确完成标准 |
| --- | --- | --- | --- |
| M1 基础子集稳定 | N01—N04；对应 S07—S10/S14/S15 子项 | 当前影像、地形、Primitive 的可靠版本 | 六项问题有结论，乱序/接缝/清洁环境用例通过，三轮证据可复现 |
| M2 静态模型 | N05—N08；S11 子集 | 原生 glTF/GLB、约定 PBR、地理定位、对象拾取 | 支持矩阵全部专项通过，组合场景与生命周期合格 |
| M3 模型内容能力 | S12 | 动画、skin/morph、实例化、压缩及约定扩展 | 每种承诺能力有固定资产；动态更新、解码取消与资源预算通过 |
| M4 3D Tiles | S13 | 内容加载、SSE/遍历、缓存、属性/样式和约定数据类型 | 固定真实 Tiles 工作集可遍历、卸载、重新加载；样式/拾取一致，预算有界 |
| M5 业务 API | S14—S16 | 深度位置与 Widget 交互、Entity/标注/数据源、贴地分类等 | 以冻结业务样例逐项验收，不以底层 Primitive 可画替代高层功能 |
| M6 效果与扩展 | S17—S18 | 透明、阴影、后处理、约定 shader 扩展 | 既定效果组合与资源/性能回归通过，扩展接口有文档和示例 |
| M7 生产 v1 | S19—S21 | 性能、恢复、平台、打包与迁移 | 正式工作集、异常注入、长时运行、目标平台及发行门槛全部有证据 |
| M8 扩展兼容 | S22—S24 | 2D/CV、剩余兼容、维护交接 | 针对锁定上游版本的完整对照矩阵逐项签收 |

M3 中与目标 Tiles 数据无关的扩展可以并行安排；M4 依赖的数据类型和解码能力必须先可用。Viewer/Widget、深度位置拾取和 Entity 要根据实际业务入口安排，但不能因为已经有独立 WebGPU 演示页面就默认完成。

**排期方法：** 先用 N01—N04 的实际耗时与回归成本校准团队速度，再估算 N05—N08。当前没有团队规模、每周可用工时和目标数据集，报告不虚构固定周数。每个里程碑只在完成标准达到后关闭。

---

## 8. 最终核对表

- [ ] 当前模块的“完成”均指向明确支持范围，而非整个 Cesium 功能族。
- [ ] 每项修复有可复现用例、对应实现版本和结果。
- [ ] 每个下一步任务有依赖、交付物和完成标准。
- [ ] 三轮重复结果与独立测试覆盖数量分别统计。
- [ ] CPU/逻辑验证、归档真实 GPU 结果、本轮真实 GPU 重跑分别记录。
- [ ] 工程进度粗估与正式验收进度分开。
- [ ] 现有 17 项失败按身份追踪，新增失败不会被总数抵消。
- [ ] 模型接入复用 CPU 解析能力，同时明确替换 GPU 资源创建与绘制边界。
- [ ] 原计划保留，本报告作为当前实现的增量执行依据。

---

## 9. 来源与追溯

仓库代码、文档和证据链接均固定在本轮审查提交。问题优先级、进度区间、N01—N08 的拆分与新增验收门槛是本报告的工程判断。CI 链接指向具体运行，外部规范用于后续模型语义参考。

| 来源 | 用途 |
| --- | --- |
| [原实施计划][original-plan] | S00—S24、阶段权重与验收框架 |
| [WebGPU 使用说明][usage]、[进度报告][progress]、[支持矩阵][compat] | 当前公开能力与已知边界 |
| [第三轮范围 ADR][scope]、[验收契约][contract] | 增量交付约定与环境 |
| [三轮摘要][evidence]、[基础原始结果][basic-result]、[流式原始结果][streaming-result] | 归档证据与断言口径 |
| [证据归档提交][head] | 测试实现与当前 HEAD 的映射 |
| [地形实现][terrain]、[影像实现][imagery]、[Primitive 适配][primitive] | 功能实现及问题复核 |
| [场景实现][scene]、[几何 renderer][renderer]、[上游 Primitive][upstream-primitive] | 绘制、深度、透明对照 |
| [流式专项][stream-tests]、[测试 runner][runner]、[页面专项][demo-tests] | 用例范围及实际画布尺寸 |
| [dev 安装日志][ci-dev]、[sandcastle-dev][ci-sandcastle]、[deploy][ci-deploy] | 当前 CI 失败阶段 |
| [工作流][workflow]、[锁文件][lock]、[基线][baseline] | 工具链与依赖判断 |
| [glTF 顶点资源 loader][loader] | CPU 复用与 GPU 创建边界 |
| [glTF 2.0 官方规范][gltf-spec]、[Khronos Sample Assets][gltf-assets] | 模型语义和后续测试资产来源 |

[original-plan]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/docs/Cesium-WebGPU-Implementation-Plan.md
[usage]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/Apps/WebGPU/README.md
[progress]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/progress-report.md
[scope]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/adr/0003-imagery-terrain-primitives.md
[evidence]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/benchmarks/webgpu/streaming-v1/summary.json
[basic-result]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/benchmarks/webgpu/streaming-v1/basic-1/result.json
[streaming-result]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/benchmarks/webgpu/streaming-v1/streaming-1/result.json
[head]: https://github.com/SilverStr1ng/lanthanum/commit/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e
[contract]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/acceptance-contract.md
[runner]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/scripts/webgpuTest/run.js
[demo-tests]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/scripts/webgpuTest/demo.js
[stream-tests]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/Specs/WebGPU/streaming.js
[scene]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/packages/engine/Source/Scene/WebGPUScene.js
[primitive]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/packages/engine/Source/Scene/WebGPUPrimitive.js
[terrain]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/packages/engine/Source/Scene/WebGPUGlobeTileProvider.js
[imagery]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/packages/engine/Source/Scene/WebGPUImagery.js
[compat]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/compatibility-matrix.md
[terrain-cancel]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/packages/engine/Source/Scene/WebGPUGlobeTileProvider.js#L437
[terrain-load]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/packages/engine/Source/Scene/WebGPUGlobeTileProvider.js#L267
[renderer]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/packages/engine/Source/Renderer/WebGPUGeometryRenderer.js
[renderer-clip]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/packages/engine/Source/Renderer/WebGPUGeometryRenderer.js#L35
[renderer-default]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/packages/engine/Source/Renderer/WebGPUGeometryRenderer.js#L221
[primitive-upload]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/packages/engine/Source/Scene/WebGPUPrimitive.js#L271
[scene-depth]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/packages/engine/Source/Scene/WebGPUScene.js#L249
[primitive-cull]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/packages/engine/Source/Scene/WebGPUPrimitive.js#L243
[scene-draw]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/packages/engine/Source/Scene/WebGPUScene.js#L319
[upstream-primitive]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/packages/engine/Source/Scene/Primitive.js
[upstream-transparent]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/packages/engine/Source/Scene/Primitive.js#L2200
[runner-mkdir]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/scripts/webgpuTest/run.js#L12
[ci-dev]: https://github.com/SilverStr1ng/lanthanum/actions/runs/42760067565/job/129643410476
[ci-sandcastle]: https://github.com/SilverStr1ng/lanthanum/actions/runs/42760067561/job/129643409898
[ci-deploy]: https://github.com/SilverStr1ng/lanthanum/actions/runs/42760067510/job/129643409908
[workflow]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/.github/workflows/dev.yml
[lock]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/package-lock.json#L250
[baseline]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/baseline.md
[quadtree]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/packages/engine/Source/Scene/QuadtreePrimitive.js#L842
[imagery-level]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/packages/engine/Source/Scene/WebGPUImagery.js#L359
[loader]: https://github.com/SilverStr1ng/lanthanum/blob/89bc1ef49af6b19cbca37ca815d2db6e1ce0312e/packages/engine/Source/Scene/GltfVertexBufferLoader.js#L615
[gltf-spec]: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
[gltf-assets]: https://github.com/KhronosGroup/glTF-Sample-Assets
