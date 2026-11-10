# 影像、地形、Primitive 双轴审查

- 比较点：上一已发布基本版本 `ae07b760e9e116fcac7709be5ce93ac81713db9c`；完整工程基准仍为锁定上游 `2aaf1daa6b9be58fb087fdc9f05f2f4d7ee37a87`。
- 需求：用户本轮明确要求影像、地形、Primitive 和左键方向，范围落在 ADR0003；未宣称完整计划阶段通过。
- 规范：仓库贡献约定、原生/上游生命周期语义、code-review 的可维护性启发式。格式由 ESLint/Prettier 检查。
- 两个独立代理只读审查源码和证据，未代跑 GPU。根代理负责真实浏览器红绿回归。

## Standards

初审 2 项 P2，复核均关闭：

1. 不可拾取 Primitive 注册 ID 0，背景 ID 被错误解析为对象。现不注册 0，读回 0 直接返回 undefined；可见对象和背景像素均有回归。
2. discard policy 未就绪时接受影像，之后不复查。现上传前等待策略；每帧只遍历原队列一次，等待项不占实际上传额度。策略就绪后丢弃缺图并保留祖先。

其余释放、加载取消、Worker、地形替换、嵌套集合路径未发现新增明确问题或需要单独报告的判断型异味。

## Spec

初审 1 项 P1、3 项 P2，复核均关闭：

1. P1：ID 0 被注册为对象，违反标准 Primitive 拾取语义。与 Standards 第一项为同一缺陷，已修复。
2. P2：跨日期线局部影像缺西半边；首次修复仍有粗 LOD UV 展开错误。现归一化 tile rectangle，并按 clip 所在经度分支展开；近景及强制根 LOD 的东西两侧像素通过，独立 CPU 复核 U=0.25/0.75。
3. P2：隐藏 Primitive 不能 ready。现允许隐藏状态完成 Worker 构建/上传，只跳过绘制；隐藏 ready、再显示绘制和拾取通过。
4. P2：缺图策略未就绪时被跳过，破坏祖先替代。与 Standards 第二项为同一缺陷，已修复。

## 证据

红测均复现：`round4-review-pick-red`、`round4-review-date-red`、`round4-review-policy-red`、`round4-review-hidden-red`；绿测 `round4-review-green-final` 为 59 项专项和 13 项页面交互通过，控制台错误为 0。红绿原始输出归档至 `benchmarks/webgpu/streaming-v1/review/`。

Standards 共 2 项、已关闭 2 项；Spec 共 4 项、已关闭 4 项；两个轴均无遗留。
