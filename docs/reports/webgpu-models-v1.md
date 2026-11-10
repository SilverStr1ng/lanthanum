# N05/N06-A 进度与验收报告

**N05 已实现并验收；N06-A 静态 unlit 子集已验收。** 原生 WebGPU 地球可同时显示影像、非平坦地形、Primitive 与多个静态纹理模型，支持正确放置、朝向/尺寸、双向遮挡、对象拾取、取消、移除和重新加载。完整 N06/S11、PBR 与 Tiles 仍开放。生产 v1 继续沿用 **25%—35%（约三成）工程粗估**，不按断言累计量上调。

## 基线与范围

- 开始提交：`a9582d50f5d319936f7586ac66b081ff3b968e1d`；先以 `c4c0a8c25c` 修复原计划尾部空行，`594ea4c7da` 冻结 N05.1 契约和模型资产。
- 最终实现提交：`9c60b88fe3fcec3ab4b1b49435bec498b1fb4f66`。所有正式硬件结果的 workingTree 为空；随后提交仅归档证据与报告。
- 证据提交：`4f653e15d89d337d1262f32e278b033935a855a5`；[独立验收包](../../benchmarks/webgpu/models-v1/summary.json)。
- 精确范围：[模型支持矩阵](../model-support.md)、[ADR0005](../../adr/0005-model-render-contract-proposal.md)、[验收契约](../../acceptance-contract.md)。旧 N01—N04 报告保留在[历史报告](webgpu-conformance-v1.md)，旧证据不覆盖。

## 已实现

- CPU/GPU 边界：复用 glTF CPU 的 parseGlb/readAccessorPacked/getNodeTransform 与图像获取/解码，不进入旧 GltfLoader 的 WebGL Texture/Buffer 创建路径。CPU 描述纯数据；URL/scene 管解析，内容 hash 管几何和编码图片 payload 共享。
- 资源与 ready：scene/device generation 所有权、引用租约、pending 去重、失败重试、零引用回收；实际下载/解码/编译未结束时仍占物理槽。fromGltfAsync 在上传排队与管线准备完成后 resolve，无需 render，不自动 add，未 add 实例也归 scene 管理。
- DrawPacket：两种实际 GPU 顶点布局、u8→u16/u16/u32/非索引、完整管线变体身份、有界异步编译、独立96字节参数。共享几何键包含索引格式和count；draw复用矩阵，节点/模型/最终矩阵共用尺度无关的手性校验。
- glTF/GLB：相对外部 bin、PNG/JPEG、内嵌GLB、多mesh/node/选定scene、TRS/matrix、Y-up转ENU Z-up、正/负/非均匀缩放。剪切包围体按最大奇异值计算；小尺度与补偿层级有回归。
- 材质：显式 KHR_materials_unlit + OPAQUE，baseColorTexture×factor×COLOR_0，sRGB解码/线性乘法/输出编码；alpha=0仍输出不透明颜色、深度和ID。支持nearest/linear、repeat/clamp/mirrored-repeat，未支持mip、材质/扩展/动画等明确拒绝。
- 场景：scene.models 接入同一颜色/反向深度/ID附件；地形、模型与Primitive双向遮挡；隐藏/删除使在途pick失效，ID不复用。加载/解码/编译/设备丢失后的迟到结果不能恢复旧对象。
- 演示：[模型页面](../../Apps/WebGPU/models.html) 可从原地球演示进入，含四个模型、两座合成山峰、本地影像、Primitive、显隐、取消/重载/移除和视角切换。左键方向既有回归继续通过。

## 已验收

### N05/N06-A 逐步结果

| 步骤 | 结论 | 可追溯证据 |
| --- | --- | --- |
| N05.1 | 通过 | ADR0005、model-support、74个独立资产manifest；Markdownlint全仓通过，原计划MD012消失 |
| N05.2 | 通过 | CPU无GPU解析、GLB对照、不同URL内容共享、跨设备隔离、坏资源/越界/步长反例、共享取消与最后引用回收 |
| N05.3 | 通过 | 两种真实GPU布局、索引碰撞红绿、独立draw变换/factor/ID、pipeline pending去重、两物理编译槽、编译诊断/重试 |
| N05.4 | 通过 | 混合地球/模型/Primitive遮挡，异步pick失效、未add实例销毁、无隐藏WebGL、旧四套全部保留 |
| N06.1 | 通过 | 无render也ready，外部glTF/GLB画面/ID相同，多mesh/TRS/matrix/scene/负缩放/微小尺度与地理放置 |
| N06.2 | 通过 | 四象限、中灰128、factor后92、vertex tint 66/92/46、JPEG、三wrap、两filter、alpha0 OPAQUE、单双面与拒绝矩阵 |
| N06.3 | 通过 | 双峰地球组合近地/高空/轨道，模型/地形/Primitive遮挡；每轮20次真实编译中取消/重载/共享/移除，所有活动账本回基线 |
| N06.4 | 通过 | 同一干净实现五套×三轮，双平台清洁CI、66项CPU、完整Jasmine失败身份比较、文档与独立验收包 |

逐项断言名称、结果和资源快照在 [模型第一轮原始结果](../../benchmarks/webgpu/models-v1/models-1/result.json)；第二/三轮同目录独立文件。该表映射任务书第6节适用检查，CPU逻辑证据、实际GPU证据和hosted CI分别保留。

### 旧专项与新模型专项

| 套件 | 每轮专项 | 每轮原页面 | 每轮模型页面 | 三轮累计 |
| --- | ---: | ---: | ---: | ---: |
| index | 49 | 13 | 0 | 186 |
| streaming | 59 | 13 | 0 | 216 |
| conformance | 111 | 13 | 0 | 372 |
| terrain | 49 | 13 | 0 | 186 |
| models | 147 | 13 | 10 | 510 |
| 合计 | 415 | 65 | 10 | 1470 |

旧四套合计仍为960次，新模型入口510次。重复次数不是独立功能数量。15份结果均通过，正常GPU validation/控制台错误为0；故意注入的坏WGSL与device loss分别列在 expectedErrors。硬件为 Windows / Chrome `157.0.8103.40` / NVIDIA Blackwell，RTX5080具体型号来自环境契约，浏览器device/description字段为空。

三轮固定身份：

- build：`c097bc8ccf5a7f9674f963343fd2d97c0cd262fc8c308caf2d391b82c50ae568`。
- 原fixture：`0d476e0b577d9aed36a878f0a7029ac33b9230164e3a60760d8dbed4f863d3d8`；N04 fixture：`b64bd2ca3c22bce194fc6b962104e1dc6343cb178f6dd02fa2a2bea4b3b4c8a0`，均未改变。
- 模型manifest：`0bbfface6e21c0b8b5b12f36144f52af0f068ac7b5f132973a8a012121093b3f`；模型测试/组合场景源：`a3ee344b2c20932af2a94a801fd43511c920e3c9e65e321829c51ead7dd149a5`。

### 生命周期、CI 与回归

每轮20次循环均真实等待两条管线开始后取消，再加载两个共享实例、移除一个并拾取另一个、最后全释放。对象、CPU payload、几何/纹理/管线租约及活动/排队任务均回到基线；编译物理峰值2。另测慢网络、慢解码、共享取消、编译失败重试、scene销毁、device loss，最终后端管理buffer/texture归零。不可中断任务的物理完成与逻辑取消分开记录。

[native-contract 42779879168](https://github.com/SilverStr1ng/lanthanum/actions/runs/42779879168) 的 Windows 与 Ubuntu 清洁安装均成功：npm ci、toolchain、build/build-ts、根/engine类型、ESLint、66项CPU、ast-grep测试及扫描。hosted CI未执行硬件WebGPU。

[dev 42779879125](https://github.com/SilverStr1ng/lanthanum/actions/runs/42779879125) 的 lint、release-tests、node-smoke-test、coverage 全部成功；lint实际继续完成了Markdown、全仓format、build types、lint types与jsdoc。其他工作流状态和全部skipped步骤见验收包 audit，不将条件上传skipped算成测试通过。

本机完整Jasmine：**16018通过、17失败、67跳过，真实退出码1**。按失败名称比较新增/消失均为空，[对照结果](../../benchmarks/webgpu/models-v1/audit/failure-comparison.json)与完整日志保留。新CPU模型相关47项加旧19项合计66项通过。本机build-ts、根/engine类型、JS lint、Markdownlint、ast-grep通过；本机全仓Prettier仍报告2964文件，改动文件全部通过。Linux CI的全仓format通过，二者按各自环境实际结果记录。

双轴审查发现的索引缓存身份、小尺度阈值、CPU内容共享缺口均已修复并复核；矩阵热路径分配建议也已处理。见[审查记录](../reviews/webgpu-models.md)。

## 未执行与限制

- 仅认证本次Windows/NVIDIA/Chrome组合；其他GPU、浏览器引擎和OS的硬件WebGPU未验收。真实device loss只验证失效/清理，自动恢复未实现。
- 完整N06/S11未关闭：PBR、normal/tangent生成与受光照语义、MASK/BLEND、mip、完整精度和材质对照继续开放；动画/skin/morph、压缩/实例化与扩展属于S12，Tiles属于S13。
- LOD耦合、完整S07、N08正式性能、长时/多平台、Viewer/Entity仍开放。绝对高度定位不等于自动贴地；合成山峰不是实际地貌；Natural Earth仅0—2级，近看低分辨率。
- ready耗时和pipeline首次/复用计数已留基线，没有GPU timestamp；不宣称冷启动、帧率或正式性能通过。所有资源统计都是管理账本，不是物理显存测量。

## 下一步

按 [N07剩余项](../issues/n07-static-materials.md) 先冻结PBR/normal/tangent/MASK/BLEND材质资产、颜色与光照控制图，以及完整S07前置验收。继续保留旧四套与本轮独立模型专项，生产v1工程粗估维持25%—35%。
