# Lanthanum WebGPU：N01—N04 复核与 N05—N06 执行任务书

> 日期：2026-11-10（Asia/Singapore）  
> 仓库：[SilverStr1ng/lanthanum](https://github.com/SilverStr1ng/lanthanum)  
> 审查基线：`a9582d50f5d319936f7586ac66b081ff3b968e1d`，本次核查时 main 指向该提交。  
> 上轮审查：`89bc1ef49af6b19cbca37ca815d2db6e1ce0312e`。  
> 最终硬件验收实现：`64d333bc8b03f7cafc22367ffd85327eb6208fb3`。  
> 本轮方式：固定版本源码审查、原始结果与真实 CI 日志核对、独立地形生命周期逻辑复核；没有重新执行真实 GPU 场景。  
> 本文是下一轮开发与验收依据，未修改仓库代码。

## 1. 结论与下一轮目标

**接受 N01—N04 在已冻结范围内完成收口，上一轮 F01—F06 可以关闭。没有发现需要阻止 N05/N06 开始的新增阻塞问题。**

这轮工作使“影像、地形、标准 Primitive 可用子集”具备了更可靠的生命周期、绘制语义与清洁环境验收。实际代码、专项测试和报告相互对应，主线没有偏离。[progress] [adr4] [summary]

下一轮建议交付：

> **N05 可执行的最小模型渲染契约 + N06 静态纹理模型闭环。**

终点是：原生地球上可以加载一个范围明确的静态 glTF/GLB，正确处理节点变换、纹理、遮挡、对象 ID、共享资源和销毁；N05 的接口由真实模型检验。

N07 的完整静态 PBR 材质验收、N08 正式性能另行推进。原计划仍为 S11 基础模型、S12 模型扩展、S13 3D Tiles；本轮子集通过不会自动关闭整个 S11 或其精度前置门槛。[original-plan]

## 2. N01—N04 关闭判断

### 2.1 六项旧问题的复核

| 旧问题 | 实际修复与验证 | 本轮结论 |
| --- | --- | --- |
| F01 地形代际竞态 | `isCurrent` 同时检查 provider 存活、取消、generation 和 tile.data 身份；请求、Worker、上传、失败、finishFrame 均约束写回；真实在途任务仍占八槽预算 | 关闭 |
| F02 Color Primitive 被影像 UV 裁剪 | `clipEnabled` 默认关闭，影像显式开启；缺省、0.5、-2、2 的 ST 在两种颜色外观下有颜色/ID 对照 | 关闭 |
| F03 near 被海拔覆盖 | near/far 仅初始化默认，render 验证后保留；CPU 双精度投影转换与反向深度、清零、greater-equal 一致；两海拔、三距离通过 | 关闭限定缺陷；完整 S07 继续开放 |
| F04 闭合透明体缺背面 | closed + translucent 三角形先背面、后正面；两次绘制使用同一份不变参数；盒/椭球内外控制组通过 | 关闭限定缺陷；相交透明/OIT 继续开放 |
| F05 清洁测试目录不存在 | 先递归创建父目录，再非递归创建叶目录；重复创建明确 EEXIST，历史证据不被覆盖 | 关闭 |
| F06 平台依赖安装失败 | 工具链统一、optional dependency 与 integrity 补齐；Windows/Linux 真正完成 npm ci、ast-grep、构建、类型、JS lint 和 CPU 测试 | 关闭安装/工具链问题 |

依据：[地形实现][terrain]、[生命周期测试][terrain-cpu]、[共享 renderer][renderer]、[场景][scene]、[绘制专项][conformance-tests]、[输出目录实现][output-dir]、[工具链测试][toolchain-test]。

### 2.2 本轮独立逻辑验证

另用同一验证脚本读取两个固定提交的实际地形类方法，仅替换外部数学/GPU 依赖，执行原始竞态顺序：

1. 旧任务开始。
2. 相机离开，旧任务逻辑取消但尚未完成。
3. 相机返回，为同一 tile 创建新 data。
4. 新任务先完成并上传。
5. finishFrame 再次遇到旧任务。
6. 旧任务最终完成。

结果：

~~~text
旧 89bc1ef：新瓦片被重置为 START，断言失败。
新 a9582d50：PASS；requests=2，uploads=1，renderable=true，state=DONE，inFlight=0。
~~~

这是生命周期逻辑证据。真实浏览器中的迟到任务、绘制与资源结果来自仓库归档，二者分别记录。

### 2.3 960 次断言的核对

已核对最终四套、三轮的 12 份原始 `result.json`，结果与摘要一致。

| 套件 | 每次专项断言 | 每次页面断言 | 三轮累计 |
| --- | ---: | ---: | ---: |
| index | 49 | 13 | 186 |
| streaming | 59 | 13 | 216 |
| conformance | 111 | 13 | 372 |
| terrain | 49 | 13 | 186 |
| 合计 | 268 | 每套各 13 | **960** |

计算为 `(49 + 59 + 111 + 49 + 13 × 4) × 3 = 960`。这表示累计断言通过次数；四套测试运行于同一 Windows/NVIDIA Blackwell 硬件环境，并非四种硬件配置。[summary]

12 份结果中的实现 SHA、空 workingTree、浏览器、adapter、构建与夹具 hash 一致；没有失败断言或控制台错误。RTX 5080 的具体型号来自环境契约，浏览器 device/description 字符串仍为空。[contract] [conformance-result] [terrain-result]

固定身份：

- 实现：`64d333bc8b03f7cafc22367ffd85327eb6208fb3`。
- 构建：`10adf9a0a0624eecafe230174c83d267b050a4c65d70e4015cb07a956814ae60`。
- 原 fixture manifest：`0d476e0b577d9aed36a878f0a7029ac33b9230164e3a60760d8dbed4f863d3d8`。
- 新 conformance fixture：`b64bd2ca3c22bce194fc6b962104e1dc6343cb178f6dd02fa2a2bea4b3b4c8a0`。

对最终测试实现与当前 HEAD 的完整 Git tree 进行比较后，`packages/`、`Specs/`、`scripts/` 没有内容变化。之后的变化为 CI 顺序、文档与证据，因此这些硬件结果能够对应当前运行时内容。[tested-commit] [head]

### 2.4 CI 与 Jasmine 的准确状态

当前 HEAD 的 `native-contract`，Windows 和 Ubuntu 均已完成成功。实际执行包含清洁安装、工具链、ast-grep、build/build-ts、根与 engine 类型、JavaScript lint、19 项 CPU/文件系统测试等；该工作流明确没有执行硬件 WebGPU。[head-native-ci] [native-workflow]

当前 `dev` 工作流状态如下：

| Job | 状态 | 说明 |
| --- | --- | --- |
| lint | 失败 | 安装、build、JS lint 成功；Markdownlint 在原实施计划尾部空行失败 |
| node-smoke-test | 成功 | 当前 run 的 job 结论 |
| release-tests | 成功 | 当前 run 的 job 结论，不替代本机完整 Jasmine 口径 |
| coverage | 成功 | 当前 run 的 job 结论 |

当前 lint 的具体错误为 `docs/Cesium-WebGPU-Implementation-Plan.md:1024` 的 MD012 多余空行；后续 format/types/jsdoc 步骤因前面失败而 skipped。不能从这次 dev run 推导这些后续检查通过。[head-dev-ci] [head-lint]

完整本机 Jasmine 归档为 16,018 通过、17 失败、67 跳过。失败名称与旧轮集合完全一致，新增/消失均为空，日志保留真实失败退出码。运行早于最后的专项补强提交；之后该提交只加强地形 GPU 夸张测试和文档，引擎与构建内容保持一致。[jasmine-log] [failure-comparison] [tested-commit]

**处理决定：** 将原计划尾部空行作为下一轮的独立小清理提交，保留所有检查，再报告后续实际结果。历史 Sandcastle 类型问题与全仓格式债务单独登记，不把数千文件格式化并入模型主线，也不保证修掉这一行后所有检查就会全绿。

### 2.5 仍应保留的验收边界

- 同 tile 的原始乱序竞态由针对性 Node 逻辑测试覆盖；真实浏览器迟到专项覆盖 provider 切换后的旧 root 请求。
- 地形第三轮 20 次返回中 `cancelled=0`，证明该轨迹的绘制/资源稳定，不能单独称为 20 次硬件复现了原取消竞态。
- 山脊接缝是冻结解析夹具的有限像素采样；CPU 高程、GPU 对象 ID 遮挡分别验证，不等同于任意地形无裂缝或 GPU 位置精度认证。
- 绘制旧行为红测的工作树包含新增测试等修改，不能称为“纯净旧提交整套复跑”。最终通过记录的工作树是干净的。
- LOD 耦合、完整 S07、N08 正式性能、跨 GPU/浏览器、自动设备恢复、Viewer/Entity 和 glTF/PBR/Tiles 仍按现有边界推进。[adr4] [lod-issue] [progress]

这些边界不构成重新打开 F01—F06 的理由；后续阶段验收必须继续保留它们。

## 3. 当前进度与剩余主线

| 维度 | 本次判断 |
| --- | --- |
| 上轮任务 N01—N04 | **4/4，限定范围内接受完成** |
| 主线方向 | 正确：地球基础收口后进入模型渲染 |
| 当前产品状态 | 原生 WebGPU 影像、地形、标准 Primitive 可用子集，具有更完整的正确性证据 |
| N05 | 有 ADR 建议，尚无对应模型渲染运行时实现 |
| 生产 v1 工程粗估 | 仍可暂按约三成理解，沿用上轮 25%—35% 区间 |
| 正式验收完成度 | 按原固定矩阵与 gate 计算；本报告不把工程粗估替换成已验收百分比 |

本轮主要减少了已有能力的风险，并没有新增整个模型/Tiles 功能族，因此不把断言数量增长直接换成百分比上涨。工程估计是排期参考，不是测量值或剩余工时承诺。

剩余主线按顺序为：

1. N05/N06：可执行契约与静态纹理模型。
2. N07：静态 PBR、法线/切线、MASK 与约定透明语义，收口 S11 剩余项。
3. S12：动画、skin/morph、实例化、压缩和约定扩展。
4. S13：3D Tiles 内容、遍历/缓存/预算、metadata/style。
5. S14—S18：交互、业务 API、贴地分类、效果与扩展。
6. S19—S21：正式性能、异常恢复、长时与跨平台、发行。

LOD 耦合在真实高分辨率地球工作集之前关闭；完整精度门槛在依赖它的正式阶段签收前关闭。它们不必与第一个静态模型实现混成一次大改。[lod-issue] [original-plan]

## 4. 对 ADR 0005 的决定

**接受 ADR 0005 作为 N05 起点，但实施前应把以下契约具体化。** 已有建议中的 CPU/GPU 分层、device generation、DrawPacket、材质/纹理语义、完整 pipeline key、异步编译方向合理。[adr5]

### 4.1 几何 typed array 不能替代完整 CPU loader 边界

`GltfLoader.loadAttributesAsTypedArray` 可以影响属性与索引输出，但纹理仍通过 `ResourceCache.getTextureLoader` 进入 `GltfTextureLoader.process` 和旧 Texture 创建。用一张真正有贴图的 glTF 验证边界，不能只让无纹理三角形成功。[gltf-attributes] [gltf-textures] [texture-loader]

采用已有解析、accessor、bufferView、图像获取/解码能力，新增明确的 CPU 描述与 WebGPU 上传适配。复用的公共路径修改要保持旧 WebGL 行为与测试。

### 4.2 把场景成员关系与拾取一起设计

当前 `visitPrimitives` 仅接受 Primitive/PrimitiveCollection；拾取分支也假设对象具有 Primitive adapter 和实例 attributes。因此新增模型入口时需要一起定义命令收集、队列、ID registry 与移除失效规则。[scene-membership] [scene-pick]

本轮建议沿用 ADR 的独立 `scene.models` 集合；与 `scene.primitives` 共用场景颜色、反向深度、ID 附件和适当的排序队列。模型不能在一个与地球无关的第二 canvas 中绘制后再宣称集成完成。

### 4.3 明确异步 API 的返回时点

上游 `Model.fromGltfAsync` 返回后，后续资源处理仍依赖 update/frameState；不能仅凭名称假定它返回时模型已可绘制。[upstream-model]

对本轮新实验入口，建议冻结如下使用流程：

~~~javascript
// 拟新增接口示意；不是当前仓库已经可用的 API。
const model = await WebGPUModel.fromGltfAsync({
  url: "fixtures/models/unlit-box.glb",
  scene,
  modelMatrix,
  id: "sample-model",
  signal: abortController.signal,
});
scene.models.add(model);
scene.render();
~~~

本任务书默认语义：

- `scene` 指定 GPU 资源与 generation 的归属；Promise 在本轮所需 CPU 数据、上传与 pipeline 准备完成、模型可绘制时 resolve，不自动加入集合。
- 加载/编译准备不要求调用者先启动渲染循环，否则上面的顺序可能死锁。
- 错误与取消明确 reject；成功只 resolve 一次。资源已排入同一设备队列即可按提交顺序使用，不要求逐模型做同步 GPU 等待。
- 创建后尚未加入集合的模型也受 scene/device 生命周期约束，scene 销毁不能漏掉这类资源。
- 默认移除即销毁该模型实例并释放其拥有的引用；再次显示同一资产需重新加载新实例，不能重新添加已销毁对象。跨 scene 添加明确拒绝，未来跨场景复用单独设计。
- 若实现选择其他 ready 语义，先在 ADR 写出完整可执行调用流程和失败/取消行为，并用自动测试验证；不要留下两个含混的“ready”。

### 4.4 共享请求和编译任务也需要所有权

一个模型取消，只能移除自己的引用与等待者，不能让另一个共享相同 buffer、纹理或 pipeline 的模型失败。相反，最后一个引用离开后不能永久保留临时资源。

不可立即终止的实际解码或编译任务继续占用物理并发槽，完成后只允许向仍有效的 generation 写回。device loss 时结束当前模型任务、失效缓存；自动恢复仍属于后续阶段。

### 4.5 N06 的材质范围统一为静态 unlit 子集

将 ADR 末尾“N06 静态模型与基本 PBR”改成明确的本轮子集，避免与 N07 重叠。

本轮正式成功样例采用 `KHR_materials_unlit`，输出依据 baseColorFactor、baseColorTexture 与存在的顶点颜色；这提供了明确的材质语义，适合先验证加载与渲染链路。[unlit-spec]

普通 metallic-roughness 材质留至 N07。若保留 baseColor 诊断模式，必须由显式诊断开关启用并标注，不能作为默认 PBR 支持的成功证据。

### 4.6 扩展拒绝与回退保持准确

未支持的 `extensionsRequired` 明确失败。对仅列入 `extensionsUsed` 的可选扩展，只有核心回退路径存在、属于当前支持子集且已验证时才允许忽略；其余给出具体错误。[gltf-spec]

skin/morph/animation 是需要单独处理的能力，不能因为它们未出现在 required 扩展数组中就静态显示后宣称支持。压缩或材质扩展也按实际能力检测，不用一个笼统的“加载成功”掩盖语义缺失。

## 5. 下一轮范围冻结

以下是建议的 **N06-A 静态纹理子集**。它是原 N06 的有限增量；未支持组合明确拒绝，完成后不能直接写“全部 glTF”或“整个 S11 完成”。

| 类别 | 本轮必须实现 | 明确留到后续或拒绝 |
| --- | --- | --- |
| 文件 | glTF 2.0 JSON + 外部 bin/PNG/JPEG；GLB 内嵌几何/图片；相对 URL 解析 | 其他资产传输/压缩能力按支持矩阵处理 |
| 几何 | TRIANGLES；索引/非索引；POSITION、TEXCOORD_0、存在时的 COLOR_0；合法步长/偏移；u8/u16/u32 索引正确归一化 | 其他拓扑、未实现的 accessor 组合明确失败 |
| accessor | POSITION float32；UV/color float32 与约定 normalized 整数输入；交错/分离数据 | sparse 等未完成项逐项列明，不输出错误网格 |
| 层级 | 多 mesh/node；选定 scene；TRS/matrix；地理 modelMatrix；非均匀/负缩放与正确包围体 | 动画、skin、morph、GPU 实例化 |
| 材质 | 明确的 KHR_materials_unlit；OPAQUE；baseColor 纹理/factor/顶点色；doubleSided 的几何剔除行为 | metallic-roughness、normal/occlusion/emissive、MASK/BLEND 进入 N07 |
| 纹理 | PNG/JPEG；方向与颜色空间；repeat/clamp/mirrored-repeat；nearest/linear | mip 采样策略要实际实现，或将要求未实现 mip 行为的组合明确拒绝；KTX2/Basis 后续 |
| 场景 | 原生地球中绘制、深度遮挡、模型 show/modelMatrix 更新、对象级 ID、移除/销毁 | 完整 Viewer、Entity、feature/node 级拾取与 GPU 位置拾取 |
| 异常 | 无效数据/URL、未知 required extension、编译失败、取消、失效 generation | 自动 device 恢复后续 |

“normalized 整数输入”“mip 策略”等矩阵必须在第一步固定精确类型与测试资产，不能写成模糊的尽量支持。可以在 CPU 归一化为合适 GPU 格式，记录成本即可。WebGPU 索引格式和布局限制按实际设备能力与规范处理。[webgpu-spec]

## 6. 分步执行：每一步的交付物与完成标准

### N05.1：冻结接口、状态与测试资产

**前置：** 当前 a9582d50 基线与 N01—N04 验收结论。

**执行：**

1. 固定第 4、5 节的 API、集合、ready/失败/取消、材质和格式矩阵。
2. 明确 CPU 模型描述、ResourceFactory、DrawPacket、MaterialDescriptor、TextureBinding、PipelineKey 的职责；名称可按仓库风格调整。
3. 给旧 renderer 到新接口的迁移列出实际调用方，先处理模型需要的边界；不要一次重写全部引擎。
4. 建立新模型 fixture manifest，保存资产来源、hash、预期行为和控制图；原有冻结 manifest 保留。
5. 单独修正原实施计划的尾部空行，重新执行检查并记录后续实际暴露的问题。

**交付物：** 更新的 ADR 0005、精确支持矩阵、接口草案、模型夹具与检查清单。

**完成标准：**

- [ ] API 示例能明确回答何时 loaded、compiled、drawable，以及何时加入场景。
- [ ] 每个对象的 CPU/GPU 所有者、引用计数、device generation 和释放责任唯一。
- [ ] 每一类不支持输入都有预期错误，不依赖开发者猜测。
- [ ] 夹具至少覆盖纹理方位与中灰、repeat UV、索引/非索引、多节点、共享资源和错误输入。
- [ ] 当前 Markdown 空行错误消失；所有后续检查按实际结果报告，历史失败身份继续登记。

### N05.2：实现 CPU 模型描述与 GPU 资源隔离

**前置：** N05.1。

**执行：**

1. 审计并复用现有 glTF/GLB、accessor、bufferView 和图像加载能力，建立无 GPU 对象的 CPU 描述。
2. 将几何上传、纹理/sampler 创建和旧 Texture/Buffer 路径分离；明确所有 post-process 分支。
3. 实现设备归属的资源句柄、共享引用和取消规则。
4. CPU 数据按内容身份复用；GPU 缓存包含设备/generation 与实际资源用途、格式、颜色语义等身份。
5. 区分 buffer/texture 的显式销毁与 sampler/pipeline 的引用/缓存释放，按真实 API 能力操作。

**交付物：** CPU 描述适配器、ResourceFactory、资源共享与失败专项。

**完成标准：**

- [ ] 真正有纹理的 glTF 和 GLB 能输出完整几何、图片、sampler、节点描述，没有创建 WebGL Buffer/Texture。
- [ ] 两个模型共享同一资源时，取消或移除其中一个不会破坏另一个。
- [ ] 最后引用释放后资源回到约定基线，重复 dispose 幂等。
- [ ] 两个 device/generation 不能复用同一个 GPU 句柄；旧 generation 的迟到结果无法写回。
- [ ] 无效步长、越界 accessor、坏图片、缺少资源均给出含资产定位的错误并回收临时资源。

### N05.3：实现 DrawPacket 与异步 PipelineCache

**前置：** N05.2；shader/布局设计可与资源工作并行。

**执行：**

1. DrawPacket 明确顶点格式/stride/offset、索引、范围、模型局部原点/变换、材质、包围体、对象 ID 和 pass。
2. 支持实际需要的多种 GPU 顶点布局；不再把现有固定 position/st/normal 八 float 作为模型接口。
3. 管线键覆盖 shader/entry/变体、vertex/bind group layout、目标格式、深度、混合、剔除/frontFace、拓扑和采样数；作用域含 device generation。
4. 采用有界异步编译，重复请求共享 pending Promise；绘制路径只消费已就绪 packet。
5. 编译失败关联 shader 诊断、变体、模型；共享任务取消与引用分离。
6. 每次绘制的参数拥有独立存储或正确对齐的范围，避免同一提交中的多个对象读到最后一次参数写入。

**交付物：** 可执行 packet、管线缓存、unlit WGSL 与编译/布局专项。

**完成标准：**

- [ ] 至少两种实际 GPU 顶点布局可绘制；uint16/uint32 索引与非索引绘制正确。
- [ ] 相同变体只发起一次有效编译；只改颜色 factor 或换同类型纹理不会无谓新增 pipeline。
- [ ] 改变不兼容布局或状态会生成正确的新管线，没有错误缓存命中。
- [ ] 编译失败、等待中取消、device 失效均能结束用户 Promise；真实未结束的编译保持物理并发统计。
- [ ] 一次提交中多个不同 transform/color/ID 的 packet 均正确，参数没有串写。
- [ ] 未出现新增非预期 GPU validation error；错误注入用例按预期捕获并单独标记。

WebGPU 的异步管线创建提供完成 Promise 和编译失败结果；本步在此之上建立项目的共享、取消与状态契约。[webgpu-spec]

### N05.4：接入场景、反向深度与对象注册

**前置：** N05.3。

**执行：**

1. 实现本轮选定的模型集合与生命周期，收集模型 packet 并进入原生场景提交。
2. 复用当前 CPU 双精度投影转换、反向深度清除/比较；颜色、深度和 ID 使用一致几何与裁剪。
3. 将拾取 registry 从 Primitive 专用分支扩为明确对象种类与有效性检查，保留已有 Primitive 行为。
4. 隐藏、移除、销毁后重新加载新实例和 scene 销毁，同时更新成员关系、任务和拾取有效性。
5. 在转换时保留局部坐标，避免先把地心坐标压成 float32 后再抵消。

**交付物：** 场景模型接入、通用对象注册、混合几何测试。

**完成标准：**

- [ ] 同一个颜色/深度/ID 帧中，地球、Primitive 与模型测试 packet 正确相互遮挡。
- [ ] 模型渲染与拾取没有额外 WebGL context，没有第二个补绘 canvas。
- [ ] 隐藏或删除发生在异步 pick 完成前时，结果遵循已冻结的失效规则；旧 ID 不会误指向新对象。
- [ ] 用户 near/far 保留，原高海拔近处目标用例继续通过。
- [ ] 创建完成但尚未 add 的对象在 scene 销毁时也不泄漏。
- [ ] N04 四套专项保持通过；到此可签收 N05 的可执行契约，不把接口文档本身当作实现完成。

### N06.1：加载、节点变换与地理放置

**前置：** N05.4；资产解析工作可提前，但集成验收必须使用完成的接口。

**执行：**

1. 实现 `WebGPUModel.fromGltfAsync` 的冻结语义，串联 CPU 描述、资源、编译与可绘制状态。
2. 接通 glTF 外部资源与 GLB，处理相对路径、加载失败和 AbortSignal。
3. 支持静态节点树、TRS/matrix、多个 mesh，以及 glTF 局部坐标到地理 modelMatrix。
4. 正确计算包围体，处理非均匀/负缩放和 doubleSided 几何剔除。
5. 为 unsupported 特性执行预检，并给出可定位错误。

**交付物：** 实验模型入口、静态模型适配器、变换与文件格式专项。

**完成标准：**

- [ ] 无渲染循环时，准备流程也能完成或明确失败，不出现等待 ready 与等待 render 相互依赖。
- [ ] 外部 glTF 与等价 GLB 的变换、大小、方向、对象 ID 和画面满足冻结对照。
- [ ] 多节点父子变换、正/负/非均匀缩放、模型 matrix 更新均有已知参考点检查。
- [ ] 模型在指定经纬度与高度显示，不能只在原点附近通过。
- [ ] 未支持 skin/morph/animation、材质或 required extension 时明确失败，没有错误静态姿态被当作成功。

### N06.2：静态 unlit 纹理语义

**前置：** N06.1。

**执行：**

1. 实现限定 unlit + OPAQUE 的 baseColorFactor、baseColorTexture 与 COLOR_0 组合；OPAQUE 的覆盖与输出透明度按不透明语义处理，不能继承旧 renderer 的低 alpha 丢弃规则。
2. 冻结图片上传方向、UV 约定、sRGB 解码和输出编码边界；与影像路径分开处理。
3. 实现约定 sampler wrap/filter，明确 mip 链的生成/使用或不支持策略。
4. 使用四象限图、重复纹理、非纯色中灰与非 1 factor 验证，避免只有红绿蓝纯色看不出 gamma 错误。
5. 对无 NORMAL/TANGENT 的 unlit 资产正确处理；N07 的受光照法线生成另行验收。

**交付物：** unlit 材质路径、纹理/颜色专项、支持矩阵更新。

**完成标准：**

- [ ] 四象限方向正确，repeat/mirrored-repeat 的负值与大于 1 UV 正确，不触发影像区域裁剪。
- [ ] 中灰和颜色乘数用例符合预先计算/冻结的控制结果，没有重复 gamma、错误预乘或通道偏差。
- [ ] nearest/linear 按冻结资产验证；要求未支持 mip 行为的输入明确失败，不能静默替换成另一过滤模式。
- [ ] 同一个图片资源在不同已声明用途/颜色语义下不会错误共享不兼容绑定。
- [ ] OPAQUE、双面几何、颜色和 ID 行为一致；MASK/BLEND 在本轮矩阵中明确拒绝或单独列为未验收，不能当作不透明成功。
- [ ] 在 OPAQUE 下，纹理、factor 或 COLOR_0 的 alpha 即使为 0，仍正确输出不透明颜色、深度和 ID，不因 alpha 被 discard。[gltf-spec]

### N06.3：地球组合场景与生命周期

**前置：** N06.2。

**执行：**

1. 建立固定“影像 + 非平坦地形 + Primitive + 多静态模型”场景。
2. 覆盖近地、高海拔与轨道视角；验证地形/模型双向遮挡和对象 ID。
3. 覆盖慢下载、慢解码、慢编译、失败、删除、同资产重新加载为新实例、共享引用与 scene 销毁。
4. 连续 20 次加载/取消/移除，采集资源和任务账本；同时测试两个共享资产的模型。
5. 记录资源 ready 与 pipeline 首次/复用统计，为 N08 留基线，不在本轮宣称正式性能通过。

**交付物：** 组合示例、生命周期专项、加载与编译统计。

**完成标准：**

- [ ] 模型能被地形遮挡，也能遮挡其后方 Primitive；点击返回约定模型对象/ID。
- [ ] 显隐、modelMatrix 更新与删除不污染其他模型或已有地球内容。
- [ ] 共享模型 A 取消/销毁后 B 仍可正确绘制；最后一个引用释放后按预算回收。
- [ ] 删除后迟到的网络/解码/编译/拾取结果不能恢复已删除对象。
- [ ] 20 次循环无持续增长的活动对象/临时资源，物理任务保持有界；scene.destroy 后管理资源归零。
- [ ] 未产生每帧同步 GPU 读回或全设备等待；旧 N04 用例保持。

### N06.4：三轮验收、文档和交付

**前置：** N06.3。

**执行：**

1. 在最终同一干净实现上运行 N04 四套专项和新模型专项，连续三轮。
2. 归档实现 SHA、build hash、原/新 fixture hash、浏览器/adapter、逐项结果、截图、错误与资源统计。
3. 重跑新增 CPU 测试与相关回归；完整 Jasmine 按失败身份比较，明确硬件与 hosted CI 边界。
4. 更新 ADR、Apps/WebGPU/README、进度、支持矩阵和报告；新增演示展示实际支持范围。
5. 形成 N07 的剩余项清单，包括 PBR、normal/tangent、MASK、约定 BLEND、材质对照与精度前置。

**交付物：** N05/N06-A 验收包、可运行地球模型示例、下一轮清单。

**完成标准：**

- [ ] N04 的既有断言保留；新增模型断言独立计数，三轮只作为重复执行次数。
- [ ] 每个声明支持的组合至少有对应正例；不支持/失败/取消路径有明确反例。
- [ ] 三轮实现与资产身份一致，控制图和阈值在正式采集前冻结。
- [ ] 双平台清洁 CI 实际通过约定检查；完整工作流其余失败与 skipped 单独列出。
- [ ] 17 项历史 Jasmine 失败按身份追踪，新增失败为零；结果变化有具体解释。
- [ ] 报告写明“N05 已实现并验收、N06-A 静态 unlit 子集已验收”；完整 N06/S11 剩余条目继续登记。
- [ ] 本轮没有真实 GPU 条件时，对应硬件项标为未验收，不能用 CPU stub 或 hosted CI 替代。

## 7. 测试资产与证据安排

### 7.1 最小资产集

| 资产 | 主要目的 | 必须能观察的结果 |
| --- | --- | --- |
| A01 外部 glTF unlit 盒体 | 外部 bin/图片、相对路径、基本加载 | 纹理、大小、方位、ID 正确 |
| A02 与 A01 等价 GLB | GLB 容器路径 | 与 A01 的关键结果一致 |
| A03 非索引三角形/多布局网格 | vertex layout、索引归一化 | 两种实际 GPU 布局、u8/u16/u32 输入正确 |
| A04 四象限/中灰/repeat UV | 翻转、gamma、sampler、影像 clip 分离 | 固定内部像素满足解析或控制组结果 |
| A05 多节点与负缩放 | TRS/matrix、层级、包围体、剔除 | 已知参考点与相机视角下结果正确 |
| A06 两模型共享纹理/几何 | refcount、pending 去重、取消 | 删除 A 后 B 不变；最后释放后回收 |
| A07 慢/坏资源与未知扩展 | 错误、取消、迟到结果 | Promise 必定结束，资源归位，无假成功 |
| A08 地球组合场景 | 地理变换、反向深度、ID 与生命周期 | 地形/Primitive/模型共同正确 |

优先使用自制、可解析的小型夹具；采用外部样例时保存其版本、来源与许可证。所有正式资产在测试前登记。数量是建议的测试组织方式，不是固定的断言总数。

### 7.2 图像与性能口径

- unlit 平面颜色/方向用例可沿用明确固定的 WebGL2 控制组，关闭不相关效果；内部像素容差在实现前冻结。抗锯齿边界另设 mask，不能用全黑背景稀释差异。
- 必须包含中灰与乘数，避免纯色测试掩盖颜色空间问题。
- 本轮可以记录加载时间、编译次数、提交耗时和资源数；正式性能仍使用 N08 的固定硬件、1920×1080 drawing buffer、30 s 预热、120 s 采集、三轮协议。
- 性能比较分两组：原 N04 场景不加模型，检查底层重构回归；新增模型场景按冻结绝对预算或同资产/同画质控制组比较。不能用无模型场景评价新增模型后的总成本。
- 没有 GPU timestamp 数据就记为未采集；CPU 提交或 rAF 间隔不能写成 GPU 时间。

## 8. 提交组织与停止条件

建议按可回归边界组织中文 Angular 风格的小提交，示例：

~~~text
docs(webgpu): 冻结静态模型接口与验收范围
fix(ci): 修正实施计划尾部空行
refactor(webgpu): 分离模型CPU描述与设备资源
feat(webgpu): 增加绘制包与异步管线缓存
feat(webgpu): 接入模型集合和对象拾取注册
feat(webgpu): 支持静态unlit glTF与GLB
test(webgpu): 验收模型地球场景与资源生命周期
docs(webgpu): 归档模型子集验收和后续材质任务
~~~

顺序上 N05.1 先冻结契约；N05.2 与 N05.3 的部分工作可分工并行，但场景接入必须使用一致接口。模型加载与测试资产可以提前准备。最终证据只采集合并后的同一实现版本。

遇到以下情况时先修复本轮缺陷，再继续扩展范围：

- 新模型实际调用旧 WebGL Buffer/Texture，或创建隐藏补绘 context。
- 新接口使 N04 既有能力回退。
- 同一 device/generation 内资源所有权不清，取消破坏其他模型，或迟到写回恢复已删除对象。
- 只有无纹理模型成功，却无法证明图像/纹理 loader 边界。
- 默认 PBR 被无声改成 unlit 后报告为材质支持。
- 正式证据依赖未提交修改或不一致资产身份。

这些停止条件针对本轮实现正确性，不要求先解决所有历史格式问题、全部 LOD 或整个 Cesium 功能集。

## 9. 可直接交给 Codex 的任务书

~~~text
项目：SilverStr1ng/lanthanum
参考基线：a9582d50f5d319936f7586ac66b081ff3b968e1d
上一轮结论：N01—N04 在限定范围内接受完成，F01—F06 已关闭。

本轮目标：完成 N05 可执行渲染契约，并用 N06-A 静态 unlit 纹理模型
验证它。最终必须在已有原生地球、影像、非平坦地形和 Primitive 场景中
加载/显示/遮挡/拾取/移除 glTF 与 GLB。

开工先记录实际提交与工作树，阅读 ADR0004、ADR0005、支持矩阵、
验收契约和本任务书。若 main 已有后续提交，先核对差异再沿用任务。

按 N05.1 → N05.2 → N05.3 → N05.4 → N06.1 → N06.2 → N06.3 → N06.4 执行：

1. 将 ADR0005 从建议落为明确接口：CPU模型描述、资源工厂、DrawPacket、
   TextureBinding、PipelineKey、异步状态、scene.models、对象ID注册。
   明确 fromGltfAsync 的完成时点与取消语义，验证无render循环也不死锁。
   单独修复原实施计划尾部空行，不做全仓无关格式化。
2. 复用 CPU 解析/解码，分离所有 GPU 创建路径。特别检查纹理模型：
   loadAttributesAsTypedArray 不是整个 GltfLoader 的 CPU-only 开关。
3. 实现设备/generation 资源归属、共享引用、迟到结果检查；一个模型
   取消不能破坏另一个共享资源的模型。记录实际未结束的任务预算。
4. 实现有限并发异步 pipeline、pending 去重、变体键、编译诊断、
   正确的每draw参数存储。用至少两种实际GPU顶点布局验证接口。
5. 接入同一原生场景的颜色/反向深度/对象ID，与地形和Primitive互相
   遮挡；模型移除、隐藏与异步拾取完成的时序必须验证。
6. 接通 glTF 外部bin/PNG/JPEG 与 GLB、索引/非索引、多节点TRS/matrix、
   地理modelMatrix、负缩放、约定sampler与unlit baseColor语义。
   正式成功资产使用明确的 KHR_materials_unlit；普通PBR留给N07。
7. 冻结精确支持矩阵。不支持required扩展明确失败；optional扩展
   只在规范允许且当前核心回退已验证时忽略。skin/morph/动画/压缩、
   未实现材质与accessor组合不得错误静态显示后报成功。
8. 新建模型fixture manifest，保留原冻结资产。覆盖中灰和颜色乘数、
   repeat UV、两模型共享资源、加载/编译中取消、删除后迟到、20次循环。
9. 同一干净实现跑 N04 四套硬件专项和新增模型专项，连续三轮；
   保存SHA、build/fixture hash、浏览器/adapter、逐项结果、截图与账本。
   双平台清洁CI、相关CPU与回归实际执行；Jasmine按17项旧失败身份比较。
10. 按中文Angular风格组织小提交，更新ADR、README、支持矩阵、
    progress-report与验收包。报告明确已实现、已验收、未执行、已知限制。

完成标准：本任务书第6节全部适用checkbox有证据；N05为运行时实现通过，
N06-A为有限静态unlit子集通过。完整N06/S11和N07剩余能力逐项登记。

本轮不扩展完整PBR、动画/skin/morph、Draco/KTX2、3D Tiles、Entity或
自动设备恢复；这些已有后续阶段。禁止隐藏WebGL补绘、降低旧断言、
覆盖历史结果或将CPU/hosted CI当作硬件WebGPU验收。
~~~

## 10. 下一轮报告模板

~~~markdown
# N05/N06-A 进度与验收报告

## 基线与范围
- 开始提交 / 最终实现提交 / 证据提交：
- 本轮支持矩阵：

## 已实现
- CPU/GPU边界：
- 资源、管线、ready与集合：
- glTF/GLB、变换、纹理、深度、拾取：

## 已验收
- N05.1—N05.4 / N06.1—N06.4 逐项结果：
- N04旧专项与新增模型专项分别列出：
- 三轮实现与fixture身份：
- 双平台CI与Jasmine失败身份差异：
- 20次生命周期和共享资源结果：

## 未执行与限制
- 硬件/平台未测项：
- N06/S11剩余项、N07材质项：
- LOD、完整S07、N08性能、恢复：

## 下一步
- N07进入条件与固定材质测试资产：
~~~

## 11. 来源与追溯

代码、文档和结果链接均固定在本次审查提交；CI 指向具体 run/job。关闭结论和下一轮任务拆分属于本报告的工程判断。外部规范用于后续模型和 WebGPU 语义参考。

[head]: https://github.com/SilverStr1ng/lanthanum/commit/a9582d50f5d319936f7586ac66b081ff3b968e1d
[tested-commit]: https://github.com/SilverStr1ng/lanthanum/commit/64d333bc8b03f7cafc22367ffd85327eb6208fb3
[progress]: https://github.com/SilverStr1ng/lanthanum/blob/a9582d50f5d319936f7586ac66b081ff3b968e1d/progress-report.md
[adr4]: https://github.com/SilverStr1ng/lanthanum/blob/a9582d50f5d319936f7586ac66b081ff3b968e1d/adr/0004-basic-conformance.md
[adr5]: https://github.com/SilverStr1ng/lanthanum/blob/a9582d50f5d319936f7586ac66b081ff3b968e1d/adr/0005-model-render-contract-proposal.md
[original-plan]: https://github.com/SilverStr1ng/lanthanum/blob/a9582d50f5d319936f7586ac66b081ff3b968e1d/docs/Cesium-WebGPU-Implementation-Plan.md
[summary]: https://github.com/SilverStr1ng/lanthanum/blob/a9582d50f5d319936f7586ac66b081ff3b968e1d/benchmarks/webgpu/conformance-v1/summary.json
[contract]: https://github.com/SilverStr1ng/lanthanum/blob/a9582d50f5d319936f7586ac66b081ff3b968e1d/acceptance-contract.md
[terrain]: https://github.com/SilverStr1ng/lanthanum/blob/a9582d50f5d319936f7586ac66b081ff3b968e1d/packages/engine/Source/Scene/WebGPUGlobeTileProvider.js#L155
[terrain-cpu]: https://github.com/SilverStr1ng/lanthanum/blob/a9582d50f5d319936f7586ac66b081ff3b968e1d/scripts/webgpuTest/terrainLifecycle.test.js
[renderer]: https://github.com/SilverStr1ng/lanthanum/blob/a9582d50f5d319936f7586ac66b081ff3b968e1d/packages/engine/Source/Renderer/WebGPUGeometryRenderer.js
[scene]: https://github.com/SilverStr1ng/lanthanum/blob/a9582d50f5d319936f7586ac66b081ff3b968e1d/packages/engine/Source/Scene/WebGPUScene.js
[conformance-tests]: https://github.com/SilverStr1ng/lanthanum/blob/a9582d50f5d319936f7586ac66b081ff3b968e1d/Specs/WebGPU/conformance.js
[conformance-result]: https://github.com/SilverStr1ng/lanthanum/blob/a9582d50f5d319936f7586ac66b081ff3b968e1d/benchmarks/webgpu/conformance-v1/conformance-1/result.json
[terrain-result]: https://github.com/SilverStr1ng/lanthanum/blob/a9582d50f5d319936f7586ac66b081ff3b968e1d/benchmarks/webgpu/conformance-v1/terrain-3/result.json
[output-dir]: https://github.com/SilverStr1ng/lanthanum/blob/a9582d50f5d319936f7586ac66b081ff3b968e1d/scripts/webgpuTest/outputDirectory.js#L5
[toolchain-test]: https://github.com/SilverStr1ng/lanthanum/blob/a9582d50f5d319936f7586ac66b081ff3b968e1d/scripts/webgpuTest/toolchain.test.js
[head-native-ci]: https://github.com/SilverStr1ng/lanthanum/actions/runs/42769458057
[native-workflow]: https://github.com/SilverStr1ng/lanthanum/blob/a9582d50f5d319936f7586ac66b081ff3b968e1d/.github/workflows/native-contract.yml
[head-dev-ci]: https://github.com/SilverStr1ng/lanthanum/actions/runs/42769457772
[head-lint]: https://github.com/SilverStr1ng/lanthanum/actions/runs/42769457772/job/129673567439
[jasmine-log]: https://github.com/SilverStr1ng/lanthanum/blob/a9582d50f5d319936f7586ac66b081ff3b968e1d/benchmarks/webgpu/conformance-v1/audit/full-jasmine.log
[failure-comparison]: https://github.com/SilverStr1ng/lanthanum/blob/a9582d50f5d319936f7586ac66b081ff3b968e1d/benchmarks/webgpu/conformance-v1/audit/failure-comparison.json
[lod-issue]: https://github.com/SilverStr1ng/lanthanum/blob/a9582d50f5d319936f7586ac66b081ff3b968e1d/docs/issues/terrain-imagery-lod.md
[gltf-attributes]: https://github.com/SilverStr1ng/lanthanum/blob/a9582d50f5d319936f7586ac66b081ff3b968e1d/packages/engine/Source/Scene/GltfLoader.js#L1387
[gltf-textures]: https://github.com/SilverStr1ng/lanthanum/blob/a9582d50f5d319936f7586ac66b081ff3b968e1d/packages/engine/Source/Scene/GltfLoader.js#L1619
[texture-loader]: https://github.com/SilverStr1ng/lanthanum/blob/a9582d50f5d319936f7586ac66b081ff3b968e1d/packages/engine/Source/Scene/GltfTextureLoader.js#L131
[scene-membership]: https://github.com/SilverStr1ng/lanthanum/blob/a9582d50f5d319936f7586ac66b081ff3b968e1d/packages/engine/Source/Scene/WebGPUScene.js#L437
[scene-pick]: https://github.com/SilverStr1ng/lanthanum/blob/a9582d50f5d319936f7586ac66b081ff3b968e1d/packages/engine/Source/Scene/WebGPUScene.js#L395
[upstream-model]: https://github.com/SilverStr1ng/lanthanum/blob/a9582d50f5d319936f7586ac66b081ff3b968e1d/packages/engine/Source/Scene/Model/Model.js#L3410
[unlit-spec]: https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_unlit/README.md
[gltf-spec]: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
[webgpu-spec]: https://www.w3.org/TR/2026/CRD-webgpu-20260915/
