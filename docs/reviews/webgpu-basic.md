# 原生 WebGPU 基本交互双轴审查

全任务比较点为计划指定上游 `2aaf1daa6b9be58fb087fdc9f05f2f4d7ee37a87`；本轮新增实现比较 `e6f1639...db0cc74`。审查依据实施计划、ADR0002、Apps/WebGPU支持范围及仓库贡献指南。两个代理独立只读审查，不运行GPU；主代理负责复现、修复和真实GPU验证。

## Standards

初始发现2项P2：

- Scene.createAsync 的 catch 只识别捕获的AbortError，遗漏等待adapter/device期间发生取消、随后普通失败的组合，可能在取消后继续回退WebGL2。
- 只验证EllipsoidTerrainProvider类型仍允许非WGS84、不同投影或根瓦片布局，与相机和影像坐标体系不匹配。

未发现需要单独报告的判断型代码异味。最终复核：取消状态在adapter返回后和fallback catch中优先检查；每帧限定WGS84、全球Geographic、2×1根，覆盖运行中替换provider；两项均关闭。

## Spec

初始发现2项P2，与上述两个缺陷独立重合：

- 取消回退行为违反README的“取消…不会切换后端”。
- 自定义地形布局会静默拉伸或错置影像，违反ADR“未实现能力明确报错，不默默模拟成功”，以及WGS84/geographic2×1的支持声明。

没有将明确延期的完整精度认证或S10—S24列为本轮缺陷。最终复核确认两项均关闭，无遗留。

## 实测与收尾

红测 `benchmarks/webgpu/basic-v1/review-red/result.json` 复现adapter失败时取消仍回退；绿测增加adapter-null+abort、device-reject+abort、UNIT_SPHERE/单根/Mercator三种无效地形。修复提交 `3e3e677fc9` 使用中文Angular消息。

两轴复核后，对该提交在干净工作树执行三轮，每轮49项原生检查和9项页面操作全部通过。最终帧hash一致，控制台错误为0，销毁后的buffer/texture归零。证据和未通过的旧WebGL2/工作区类型检查详见根进度报告。

初始发现数：Standards 2、Spec 2；最高等级分别为P2、P2；两轴均无剩余发现。
