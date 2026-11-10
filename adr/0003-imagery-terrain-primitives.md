# ADR 0003：影像、地形与 Primitive 可用链路

- 依据：用户明确要求本轮完成影像、地形和 Primitive，并修复左键方向。
- 范围：按原计划 S09/S10 的场景链路推进，保留尚未完成的整体阶段依赖，不宣称生产 v1。
- 影像：至少四层（声明上限八层）、增删/显隐/排序/alpha、地理与 Web Mercator、局部矩形、祖先替代、失败与纹理缓存。
- 地形：复用 heightmap / quantized-mesh CPU 解码和 mesh，接入高程、skirts、夸张、包围体/地平线剔除、缺块上采样、加载取消和预算。
- Primitive：标准 PrimitiveCollection / Primitive / GeometryInstance 入口，常用面、线、点几何体、PerInstanceColorAppearance 和基础 Color 材质，颜色/显隐/模型矩阵更新、异步构建、拾取和释放。GroundPrimitive、Entity、任意 GLSL、自定义外观不在本轮支持声明内。
- 验证接口沿用已采用的 Scene.createAsync、真实 framebuffer/pick 和实际示例指针交互；新能力也从标准公开 API 验证。使用离线固定数据、10圈资源稳定性检查和双轴审查。
- 左键回归要求地表点沿鼠标方向移动；不是仅检测相机位置发生变化。
