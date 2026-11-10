# 进度报告：S01 第二轮

范围仍为实施计划第9节的S00—S01；当前是WebGL2修复分支，没有WebGPU原生实现。首轮报告归档于 `docs/reports/s00-s01-round1.md`，旧证据未覆写。完整S01尚未验收。

审查前采集commit：`de51ee9cc761d2751ebe54c267b3068b0bd23bec`，采集开始时工作树干净。上游固定commit仍为 `2aaf1daa6b9be58fb087fdc9f05f2f4d7ee37a87`。审查后补齐延迟fill释放和数据源显隐像素检查，最终采集另存 `round2-reviewed/`。

## 实现与验证

- 修复 `QuadtreePrimitive.destroy()` 未释放已加载瓦片树的问题；清空渲染/高度回调引用、销毁provider并正确标记对象已销毁。不改变LOD选择和请求调度。
- 审查后修复provider等待下一帧释放的旧fill VA队列；真实GPU回归证明修复前2 Buffer/1 VA/4428字节残留，修复后归零。
- 新增真实WebGL2资源回归，渲染并确认地球可拾取后销毁，要求全部GL对象和Buffer字节归零；另测首帧之前销毁，以及没有影像重投影能力的通用provider。
- 原manifest下先复现T01/T02资源失败，再对比修复后的T01/T01-mercator/T02：图像通过原门槛，资源归零。证据为 `benchmarks/baseline/round2-release-red/` 和 `round2-release-green/`。
- 新增7个子例，共20个。图层顺序、透明度、移除恢复和±179°日期变更线LOD；动态点Entity位置/颜色/显隐；GeoJSON点线面、CZML盒体和KML绝对高度面均通过实际显示、拾取和显隐开发验证。
- `T05-entity-box` 保留动态盒体的异步拾取失败：画面有红色盒体，但持续更新时pickAsync返回空。测试没有冻结Visualizer来规避失败。每帧Primitive重建与异步读回间的pick ID生命周期是后续调查重点，当前不宣称已修复。
- 失败路径也保存断言、诊断和销毁账本，默认回归仍包含失败子例并返回非零。

审查前manifest：`12be48cec9f16f1367d8acdbb2f158cc1e543cc9b9de515ec0b8112646973cd3`；审查后最终manifest：`0d476e0b577d9aed36a878f0a7029ac33b9230164e3a60760d8dbed4f863d3d8`，均为168项。契约v2登记了新增及增强的检查，图像/数值门槛没有放宽；不跨manifest强行对比旧图像。

## 当前检查

日志位于 `benchmarks/baseline/round2-audit/`：

| 检查 | 实际结果 |
| --- | --- |
| Globe及Surface相关Jasmine | 最终126项通过（含真实GPU释放、延迟fill释放与首帧前销毁） |
| Quadtree最终专项 | 43项通过（含通用provider销毁） |
| 最终完整默认Jasmine | 执行16,035/16,102，16,018通过、17失败、67跳过；退出1，full-reviewed.log |
| 全套失败身份对比 | 与未修改上游的17项完全一致，无新增/消失，见failure-comparison-reviewed.json |
| WebGL stub专项 | 普通销毁1项通过，2项真实GPU测试明确pending；未把stub当硬件认证 |
| Node工具测试 | 6/6通过 |
| 根tsc、新改JS ESLint、Prettier | 通过 |

全套仍保留Billboard像素容差、射线拾取、Polyline等既有失败；早期WebGL validation的中断也未改写成通过。未重复宣称类型检查覆盖所有浏览器JS。

## 第二轮审查前证据（保留）

`benchmarks/baseline/round2-final/summary.json`：20个子例×3次，**57次通过、3次失败，退出码1**。环境为Node24.15.0、Chrome157.0.8103.40、RTX5080/ANGLE D3D11、1920×1080/DPR1。所有60次销毁后GL对象及Buffer字节归零；外部请求、HTTP/console错误均为0。失败是明确的对象ID断言，未计为通过。

57次正常捕获的图像全部达到原门槛，最小SSIM=0.9999999972126116，显著差异像素比例最大为0；三个失败用例仅保存诊断JSON及失败截图，没有伪造比较图像。动态盒体三次均先通过红色像素 `[255,0,0,255]` 和同步pick控制，再在pickAsync处返回空值。它们的移动、改材质与显隐后续断言尚未执行，不能算作通过。

人工检查了新增的日期变更线、图层移除后编号影像、动态点、GeoJSON点线面、CZML盒体、KML多边形画面，均符合各固定fixture。详细检查序列、像素、对象ID和资源账本在每个JSON中。干净git archive导出后重新生成，168项hash完全一致，见 `round2-audit/clean-export.json`。

T08三次仍为16瓦片/1,228,800三角形，readyMs=753/741/745ms；这是1.5秒smoke及非严格冷启动，不是新的性能认证。首轮T08长采样仅适用于原无纹理合成工作集。

独立双轴审查与重放的最终结果见 `docs/reviews/s01-round2.md`。

审查前新增6个通过子例另做 `--compare` 重放，全部通过，证据 `round2-replay/`。最终增强版正在按新manifest单独采集，结果不覆盖上述记录。

## 未完成与下一步

动态盒体异步拾取问题及原17项上游失败待处理；完整S01仍缺T00布局/实例化、T02接缝/缺瓦片、T03动画/skin/morph/压缩、T04外部/隐式/metadata、T05贴地/裁剪/分类及更多数据源选项。连续LOD轨迹、CPU/解码/上传预算与long-task归因仍需补齐。

生产v1原生WebGPU验收仍为0，G0未整体通过，不按代码量计算完成度。S02准备任务保持首轮报告中的异步启动状态机、feature/limit分级、context创建前后端选择、真实GPU清屏/resize/destroy、错误注入；其正式验收仍依赖S01。
