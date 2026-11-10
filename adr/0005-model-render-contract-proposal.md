# ADR 0005：N05 最小模型渲染契约建议

状态：建议，尚未实现。N01—N04交付只冻结问题边界；本文件不代表glTF/PBR已接入。步骤统一为S11基础模型、S12模型扩展、S13 Tiles。

## 资源与 loader 边界

| 文件/模块 | 可复用部分 | 必须隔离或新增 |
| --- | --- | --- |
| GltfLoader.js | glTF/GLB解析、accessor、节点和材质描述 | 当前process与frameState/context相连，不能把WebGPUContext直接传给整条旧路径；抽离CPU模型描述 |
| GltfVertexBufferLoader.js | bufferView与Draco解码；loadTypedArray=true | loadBuffer=true最终调用Buffer.createVertexBuffer；原生分支必须禁用并上传GPUBuffer |
| GltfIndexBufferLoader.js | 索引typed array与解码 | Buffer.createIndexBuffer边界由原生resource factory替代 |
| GltfImageLoader.js / GltfTextureLoader.js | 图像获取/解码、CPU元数据 | Texture与sampler创建、mip及转码格式必须适配WebGPU，不复用WebGL Texture |
| ResourceCache.js / ResourceCacheKey.js | CPU请求去重、引用计数 | GPU缓存键必须包含backend/device generation、usage、格式、布局；禁止不同设备共享旧GPU对象 |
| Model/ModelSceneGraph及pipeline stages | 节点变换、包围体、CPU语义 | ShaderBuilder/DrawCommand/WebGL vertex array不能直接提交，产出明确draw packet |

## 建议接口

- ResourceFactory归device所有：createBuffer/Texture/Sampler返回带generation的句柄；引用由model实例持有，缓存仅管理共享引用。dispose幂等；取消与device丢失使所有异步写回先检验所有权，实际工作槽位直到完成才回收。
- DrawPacket声明vertex buffers/layout（format、stride、offset、stepMode）、index format/range、topology、local origin/model/normal transforms、bounds、material、object ID、pass与draw范围。position/st/normal固定8-float布局不能成为模型接口。
- MaterialDescriptor声明OPAQUE/MASK/BLEND、alphaCutoff、doubleSided与metallic-roughness参数。颜色、深度、ID共享MASK判定；单独定义背面法线和BLEND排序范围。
- TextureBinding声明语义、颜色空间、sampler、mip、UV集合和transform。baseColor/emissive为sRGB；normal/metallicRoughness/occlusion为线性。影像区域clip是影像draw特性，不能隐含裁剪模型UV repeat。
- PipelineKey包括shader模块/entry/变体、vertex layout、bind group layout、目标格式、depth format/compare/write、blend、cull/frontFace、topology和sample count。缓存归device generation；不同材质布局不得误命中。
- prepareAsync有明确loaded/compiled/drawable三个状态；有限并发createRenderPipelineAsync与缓存，绘制热路径只提交ready packet；错误携带资产URL、shader和variant；取消必须结束ready Promise并释放临时资源。

## 入口和影响文件

建议首先提供明确命名的实验 `WebGPUModel.fromGltfAsync`，通过原生Scene的模型集合接入；标准Model.fromGltfAsync保持现有行为，待兼容测试具备后再公开统一入口。缺失的skin/morph/压缩/扩展明确报不支持，禁止用纯色网格伪装成功。

涉及既有文件：上述loader/cache、`Renderer/WebGPUContext.js`、`Renderer/WebGPUGeometryRenderer.js`、`Scene/WebGPUScene.js`、`Scene/WebGPUPrimitive.js`、`Scene/WebGPUImagery.js`。建议新增WebGPUResourceFactory、WebGPUDrawPacket、WebGPUPipelineCache、WebGPUModelAdapter及相应WGSL模块；最终命名在N05实施时确定。

N05退出门槛：资源跨device不混用、pipeline键冲突测试、编译失败/取消/重复加载资源回收、首次与复用编译统计，以及N04四组硬件专项全部保持。N06再接通静态模型与基本PBR；N07模型语义；N08正式性能。此轮未创建任何模型运行时接口。
