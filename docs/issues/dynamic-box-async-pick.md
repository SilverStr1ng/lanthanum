# 动态盒体的异步拾取生命周期

状态：已复现、未修复。属于S01已知失败记录；不代表WebGPU实现问题。当前与上游1.147相同的DynamicGeometryUpdater和PickFramebuffer路径参与复现，地球销毁修复不参与此无Globe场景。

## 复现

按 `baseline.md` 构建、生成并验证fixture后运行：

```sh
npm run baseline:run -- --scenes=T05-entity-box --repeats=3 --output=benchmarks/runs/dynamic-box-repro
```

预期退出1，不可复用已有输出目录。固定时间、SampledPositionProperty、一个60×60×80m BoxGraphics，通过DataSourceDisplay每帧更新。画面红色像素和同步scene.pick先成功，随后scene.pickAsync应命中同一Entity，却返回undefined。

证据：`benchmarks/baseline/round2-final/T05-entity-box-{1,2,3}.json`；每轮都在第一个样本的pickAsync断言失败。初始颜色为[255,0,0,255]、同步pick控制通过，销毁后账本为0。移动、改色和显隐的后续断言尚未执行。最终审阅版也保留同一失败子例。

## 当前定位与后续验证

DynamicGeometryUpdater.update每帧removeAndDestroy旧Primitive并建立新Primitive，即使场景时间不变。PickFramebuffer.endAsync等待GPU同步完成后才从颜色查询context的pick对象注册表。若旧Primitive的pick ID在等待期间被销毁，颜色读回仍有效，但对象映射已失效。这是当前有源码支持的生命周期假设，尚未通过隔离回归证明完整因果。

下一步先写最小回归，区分“同一Entity更换绘制Primitive”与“Entity已从场景移除”的语义；同时覆盖多个在途pick、取消、销毁与requestRenderMode。比较按请求保留ID映射、推迟回收和减少无效重建的方案，检查内存界限及返回已删除对象的风险。不得通过暂停Visualizer、返回上次缓存或改同步pick来令测试通过。

动态点T05-entity使用稳定PointPrimitive路径，移动/颜色/显隐/异步拾取已通过；不能据此宣称所有动态Entity都兼容。
