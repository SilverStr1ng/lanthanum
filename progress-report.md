# 进度报告：N01—N04 基础子集收口

依据2026-11-10新任务书，在89bc1ef49af6b19cbca37ca815d2db6e1ce0312e基础上继续。当前仍称为原生WebGPU影像、地形与标准Primitive可用子集；没有宣称原计划完整G1/G2或生产v1通过。

## 已实现

- 地形tile.data/generation所有权检查，取消旧任务不能重置新瓦片；实际未结束的请求/Worker继续占据八槽预算。
- 普通Color几何不再应用影像ST裁剪；显式near/far生效，CPU双精度反向深度转换；闭合透明三角形按背面/正面两遍绘制。
- runner创建父目录并拒绝覆盖既有叶目录；Node24.15.0/npm11.6.1契约、跨平台optional包与完整integrity锁文件、Windows/Linux清洁CI。
- 独立非平坦山脊、相邻LOD、缺块上采样、裙边、遮挡、夸张和快速返回专项。S11基础模型/S12模型扩展/S13 Tiles编号已统一。

## 已验收

最终实现64d333bc8b03f7cafc22367ffd85327eb6208fb3在干净工作树连续三轮运行四套真实硬件专项，每轮基础49、流式59、绘制契约111、非平坦地形49项通过，每个入口另有13项页面检查。总计960次累计断言；不是960个独立功能。12次构建/夹具hash一致，Chrome157.0.8103.40、NVIDIA Blackwell（环境契约RTX5080）、Windows，控制台与WebGPU validation错误均为0。证据与逐项检查名见[验收包](benchmarks/webgpu/conformance-v1/summary.json)。

N01逻辑红绿11项、runner文件系统与跨平台锁文件2项、旧工具6项，共19项CPU测试通过。N02原生三类绘制问题的WebGL2控制组红绿保存。N03 Windows隔离npm ci、构建/类型/lint/ast-grep及没有runs目录的默认入口通过；最终实现的[Windows/Linux清洁CI](https://github.com/SilverStr1ng/lanthanum/actions/runs/42768425465)均成功，包含安装、工具链、ast-grep、build/build-ts、根/engine类型、ESLint与CPU测试，原始日志在验收包audit。完整Jasmine重跑16018通过、17失败、67跳过，失败身份与旧集合完全一致，无新增或消失；此后仅测试/文档改动，运行时代码与构建hash一致。

双轴审查：Standards 0项；Spec发现1项GPU夸张验证缺口，新增4500m盒体可见→遮挡→重现三项ID断言，已通过并只读复核关闭。见[审查记录](docs/reviews/webgpu-conformance.md)。

## 未执行与限制

全工作区检查仍有旧失败：Sandcastle gallery在TypeScript6中Debug Failure；原实施计划末尾空行触发Markdownlint；全仓Prettier扫描2966个文件提示（本轮改动文件格式另行检查）。未跳过或删除这些检查，日志保留。旧dev工作流在build前lint导致workspace导出缺失的问题另由cfe30afe6f修复，未禁用检查；修复后真实CI的JavaScript lint通过，该次Markdown检查发现验收契约与原计划文档两处尾部空行；本轮引入的验收契约空行已在归档提交中修复，原计划空行保留登记，未称整个dev为绿色。通用CI没有执行硬件WebGPU。

完整S07精度、N08正式性能、跨GPU/浏览器认证、自动设备恢复、完整Viewer/Entity、glTF/PBR/3D Tiles未执行或未实现。GPU对象ID遮挡和CPU网格高程是两类证据，不能互换。上采样继续细化与影像LOD受terrain level约束仍开放，见[阻塞工单](docs/issues/terrain-imagery-lod.md)。N05只有[最小模型契约建议](adr/0005-model-render-contract-proposal.md)，无模型运行时代码。

## 历史记录

上一轮实现6cce0f41、发布89bc1ef4及402累计断言的证据仍在benchmarks/webgpu/streaming-v1；旧报告见[2026-11-10先前交付](docs/reports/webgpu-streaming-v1.md)。旧17项Jasmine失败按身份保留。冻结manifest为0d476e0b577d9aed36a878f0a7029ac33b9230164e3a60760d8dbed4f863d3d8，不重新冻结、不覆盖旧资产或证据。
