# 进度报告：S01 第二轮

范围仍为实施计划第9节的S00—S01；当前是WebGL2修复分支，没有WebGPU原生实现。首轮报告归档于 `docs/reports/s00-s01-round1.md`，旧证据未覆写。完整S01尚未验收。

## 实现与验证

- 修复 `QuadtreePrimitive.destroy()` 未释放已加载瓦片树的问题；清空渲染/高度回调引用、销毁provider并正确标记对象已销毁。不改变LOD选择和请求调度。
- 新增真实WebGL2资源回归，渲染并确认地球可拾取后销毁，要求全部GL对象和Buffer字节归零；另测首帧之前销毁，以及没有影像重投影能力的通用provider。
- 原manifest下先复现T01/T02资源失败，再对比修复后的T01/T01-mercator/T02：图像通过原门槛，资源归零。证据为 `benchmarks/baseline/round2-release-red/` 和 `round2-release-green/`。
- 新增7个子例，共20个。图层顺序、透明度、移除恢复和±179°日期变更线LOD；动态点Entity位置/颜色/显隐；GeoJSON点线面、CZML盒体和KML绝对高度面均通过实际显示、拾取和显隐开发验证。
- `T05-entity-box` 保留动态盒体的异步拾取失败：画面有红色盒体，但持续更新时pickAsync返回空。测试没有冻结Visualizer来规避失败。每帧Primitive重建与异步读回间的pick ID生命周期是后续调查重点，当前不宣称已修复。
- 失败路径也保存断言、诊断和销毁账本，默认回归仍包含失败子例并返回非零。

第二轮manifest：`12be48cec9f16f1367d8acdbb2f158cc1e543cc9b9de515ec0b8112646973cd3`，168项。契约v2登记了新增用例，图像/数值门槛没有放宽；不跨manifest强行对比旧图像。

## 当前检查

日志位于 `benchmarks/baseline/round2-audit/`：

| 检查 | 实际结果 |
| --- | --- |
| Globe及Surface相关Jasmine | 125项通过（含新增真实GPU释放与首帧前销毁） |
| Quadtree最终专项 | 43项通过（含通用provider销毁） |
| 完整默认Jasmine | 执行16,033/16,100，16,016通过、17失败、67跳过；退出1 |
| 全套失败身份对比 | 与未修改上游的17项完全一致，无新增/消失，见failure-comparison.json |
| 完整套件之后的改动 | 仅补充可选cancelReprojections守卫及通用provider回归；43项专项已复测 |
| Node工具测试 | 6/6通过 |
| 根tsc、新改JS ESLint、Prettier | 通过 |

全套仍保留Billboard像素容差、射线拾取、Polyline等既有失败；早期WebGL validation的中断也未改写成通过。未重复宣称类型检查覆盖所有浏览器JS。

正式20×3采集、独立双轴审查和最终证据提交正在进行；完成后在本报告补充准确结果与实现commit。第二轮不把1.5秒smoke误称为新的性能认证；首轮T08长采样仅适用于原无纹理合成工作集。

## 未完成与下一步

动态盒体异步拾取问题及原17项上游失败待处理；完整S01仍缺T00布局/实例化、T02接缝/缺瓦片、T03动画/skin/morph/压缩、T04外部/隐式/metadata、T05贴地/裁剪/分类及更多数据源选项。连续LOD轨迹、CPU/解码/上传预算与long-task归因仍需补齐。

生产v1原生WebGPU验收仍为0，G0未整体通过，不按代码量计算完成度。S02准备任务保持首轮报告中的异步启动状态机、feature/limit分级、context创建前后端选择、真实GPU清屏/resize/destroy、错误注入；其正式验收仍依赖S01。
