# 本轮进度报告：S00—S01 首批基线

- 范围依据：实施计划第9节；本轮没有实现S02—S24，也没有WebGPU原生功能。
- 基线commit：`2aaf1daa6b9be58fb087fdc9f05f2f4d7ee37a87`。
- 当前步骤：S00的固定基线、范围与复用决策已落地；S01首批13个子例可运行，完整S01待验收。
- 版本、工具链、清洁安装与命令：`baseline.md`。
- 支持范围/责任角色/测试族：`compatibility-matrix.md`。
- 资产hash、许可证、参数：`fixtures/manifest.json`。
- 图像/数值/资源/性能方法与缺口：`acceptance-contract.md`。
- 后端路线、API差异、候选fork实际构建：`adr/0001-migration-scope.md`。

## 当前证据及未通过项

首批场景覆盖几何颜色和对象ID、地理/WebMercator编号影像、quantized-mesh、glTF、四种旧Tiles容器、GIS基本图元、异步对象拾取及解析深度、20轮双Scene生命周期、122.88万三角形合成城市。正式三次采集与最终审阅结果在本报告后续证据提交中补齐。

已确认的上游问题：地球场景destroy后仍有瓦片资源残留；全量WebGL validation运行在Buffer/CubeMap处发生INVALID_ENUM。所有失败保留原始日志及非零退出码。无引擎改动，无隐藏WebGL/WebGPU混合绘制。

完整S01缺少T00布局/实例化、T01多层/日期变更线、T02真实地形接缝与缺瓦片、T03动画/skin/morph/压缩扩展、T04隐式/外部/metadata、T05动态Entity/数据源可视化等专项基线；CPU/解码/上传预算也尚未冻结。详情逐项列在验收契约，不能以首批13子例替代完整T00—T08。

## 进度及下一步

生产v1、扩展兼容、平台认证与API兼容分别记录。当前WebGPU原生已验收为0；S00/S01未整体通过G0，生产v1已验收权重暂为0%，不将文档或代码量计作功能完成度。

下一轮优先完成S01缺口和上游已知失败的最小复现/处置记录。S02可以准备实现，但依赖S01正式gate，不能提前宣布验收。

S02细化任务：

1. 定义异步bootstrap状态机：idle/requesting-adapter/requesting-device/configuring/ready/failed/destroyed；统一取消和销毁结果。
2. 冻结必需feature/limit、可选增强及真实device能力快照；能力不足给出具体差异。
3. 实现context创建前的auto/webgpu/webgl2选择；强制webgpu不隐式降级，重复使用已有canvas给明确错误。
4. 在独立T00清屏用例上验证连续呈现、resize、标签、destroy；监听device.lost/uncapturederror后停止提交。
5. 实测无navigator.gpu、空adapter、requestDevice失败、limit不足、HTTP不安全源和localhost/HTTPS；记录真实GPU与软件adapter区别。
6. 保持WebGL2回归；涉及GPU绘制时在真实设备留证。完整运行期恢复属于S20。
