# 进度报告：N05/N06-A 已验收

**N05 已实现并验收，N06-A 静态 unlit 子集已验收。** 在已有影像、非平坦地形和 Primitive 的原生 WebGPU 地球中，多个静态纹理 glTF/GLB 已具备正确定位、朝向、尺寸、双向遮挡、对象拾取和安全的取消/移除/重新加载。

- 最终实现：9c60b88fe3fcec3ab4b1b49435bec498b1fb4f66；五套专项同一干净提交连续三轮。
- 原始证据提交：4f653e15d89d337d1262f32e278b033935a855a5；后续文档归档不改变已验收运行时。
- 旧四套保持49/59/111/49项及每入口13项页面检查，三轮960次；模型147项、原页面13项和独立模型页面10项，三轮510次。总计1470次通过，不作为功能覆盖百分比。
- CPU 66项通过；完整Jasmine 16018通过、17失败、67跳过，失败身份与历史完全一致，新增为零，原始退出码1保留。
- Windows/Ubuntu清洁CI与dev四个job全部成功，实际运行身份与日志见完整报告；hosted CI不替代硬件WebGPU。
- 20次生命周期循环每轮均回到资源/任务基线；真实慢下载、解码、编译、失败重试及device loss已覆盖。

[完整报告与逐步验收](docs/reports/webgpu-models-v1.md) · [原始三轮证据](benchmarks/webgpu/models-v1/summary.json) · [使用说明](Apps/WebGPU/README.md) · [模型演示](Apps/WebGPU/models.html)

完整N06/S11、PBR、MASK/BLEND、动画/skin/morph、压缩、Tiles、完整S07、N08性能和自动恢复继续开放。生产v1工程粗估仍为 **25%—35%（约三成）**，不按累计断言增长上调。下一步按[N07材质任务](docs/issues/n07-static-materials.md)推进。

历史N01—N04报告保留在[先前报告](docs/reports/webgpu-conformance-v1.md)，旧资产、断言和验收包不覆盖。
