# 进度报告：N01—N04 基础子集收口

依据2026-11-10新任务书，在89bc1ef49af6b19cbca37ca815d2db6e1ce0312e基础上继续。当前仍称为原生WebGPU影像、地形与标准Primitive可用子集；没有宣称原计划完整G1/G2或生产v1通过。

## 已实现

- 地形tile.data/generation所有权检查，取消旧任务不能重置新瓦片；实际未结束的请求/Worker继续占据八槽预算。
- 普通Color几何不再应用影像ST裁剪；显式near/far生效，CPU双精度反向深度转换；闭合透明三角形按背面/正面两遍绘制。
- runner创建父目录并拒绝覆盖既有叶目录；Node24.15.0/npm11.6.1契约、跨平台optional包与完整integrity锁文件、Windows/Linux清洁CI。
- 独立非平坦山脊、相邻LOD、缺块上采样、裙边、遮挡、夸张和快速返回专项。S11基础模型/S12模型扩展/S13 Tiles编号已统一。

## 已验证与待归档

N01逻辑红绿、N02真实WebGL2/WebGPU红绿、N03 Windows隔离npm ci/构建/类型/lint/ast-grep/19项CPU测试与无runs目录默认入口已执行；N04开发态专项通过。最终实现SHA的三轮硬件结果、Linux CI与完整Jasmine身份比较将在本报告最终归档时填写，当前不先行宣称全部签收。

## 未执行与限制

完整S07精度、N08正式性能、跨GPU/浏览器认证、自动设备恢复、完整Viewer/Entity、glTF/PBR/3D Tiles未执行或未实现。GPU对象ID遮挡和CPU网格高程是两类证据，不能互换。上采样继续细化与影像LOD受terrain level约束仍开放，见[阻塞工单](docs/issues/terrain-imagery-lod.md)。N05只有[最小模型契约建议](adr/0005-model-render-contract-proposal.md)，无模型运行时代码。

## 历史记录

上一轮实现6cce0f41、发布89bc1ef4及402累计断言的证据仍在benchmarks/webgpu/streaming-v1；旧报告见[2026-11-10先前交付](docs/reports/webgpu-streaming-v1.md)。旧17项Jasmine失败按身份保留。冻结manifest为0d476e0b577d9aed36a878f0a7029ac33b9230164e3a60760d8dbed4f863d3d8，不重新冻结、不覆盖旧资产或证据。
