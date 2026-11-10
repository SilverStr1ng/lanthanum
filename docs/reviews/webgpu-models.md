# N05/N06-A 双轴审查记录

固定点 a9582d50；初审HEAD 3734d92fb2，修复0b7efc055d，最终实现9c60b88fe3。使用 code-review 技能分别委派只读 Standards 与 Spec 审查；审查者未运行GPU，红绿与正式硬件采集由主任务执行。

## Standards

- P2明确缺陷：geometry hash漏掉索引格式/count，同字节的u16/u32可共享错误绘制元数据，违反ADR0005格式身份与DrawPacket契约。加入格式/count，collision16/collision32 CPU与真实GPU先失败后通过，复核关闭。
- P3判断建议：模型每draw分配矩阵，与CodingGuide热路径scratch建议不符。复用四个Matrix4，移除行列式临时Array/Matrix3与重复校验，复核关闭；未宣称性能认证。

Standards初审2项，最终未解决0项。未发现其他明确所有权、取消、失败重试、迟到结果释放或纹理路径违规。

## Spec

- N05.2/N05.3缓存身份缺陷与上项同源，独立发现并复核关闭；没有把双轴重复发现计为两种bug。
- P2：N06.1及矩阵支持“非零缩放”，绝对determinant阈值却拒绝合法1e-6尺度，补偿父子缩放也失败。改用列归一化的非零/手性判断，Loader、构造与绘制统一；CPU红绿、GPU颜色/大小/ID与tiny modelMatrix控制通过，真正零缩放仍拒绝。
- 规格缺口：N05.2执行4要求CPU内容身份复用，最初仅URL解析去重。补payload引用缓存，同内容typed arrays和编码图像跨URL共享；保留相对URL基址独立，最后引用释放账本归零。独立CPU复核与真实浏览器断言通过。

Spec初审3项（含与Standards同源的缓存缺陷），最终未解决0项；未发现额外scope creep。红绿记录在benchmarks/webgpu/models-v1/audit；最终147项模型专项三轮通过。
