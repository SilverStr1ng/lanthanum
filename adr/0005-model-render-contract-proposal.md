# ADR0005：N05 模型运行时契约

状态：运行时已实现，最终验收状态以 progress-report.md 与独立模型证据包为准。N05.1 起点a9582d50f5d319936f7586ac66b081ff3b968e1d，工作树干净。原N01—N04边界与证据不变。格式见docs/model-support.md；依据新任务书第9节。

```js
const model = await Cesium.WebGPUModel.fromGltfAsync({url, scene, modelMatrix, id, signal});
scene.models.add(model);
scene.render();
scene.models.remove(model);
```

ready仅在CPU数据完成、GPU上传已排队、所需pipeline准备完成后为true。加载不依赖render循环，不自动add。内部loaded/compiled/drawable独立统计；失败/取消reject一次。scene同时持有未add实例和任务；destroy/device loss结束等待，禁止迟到写回。移除默认销毁，再次显示须新实例；跨scene/add已销毁/重复add拒绝。show/modelMatrix可更新；pick返回{primitive:model,id:model.id}，隐藏/删除在读回完成前发生则undefined，ID单调分配不复用。

## 模块与所有权

- WebGPUModelLoader产出纯CPU描述，复用@cesium/gltf的parseGlb/readAccessorPacked/getNodeTransform及现有loadImageFromTypedArray。避开GltfLoader整条process，它的typedArray选项仍进入GltfTextureLoader。旧WebGL ResourceCache GPU缓存不参与原生模型路径。
- WebGPUAsyncCache管理pending去重、引用租约、有限物理并发。取消只释放自己的等待者；最后引用离开可中止请求，不可中止的实际任务继续占槽直到结束。失败可重试，旧代结果立即释放，不永久保留零引用项。
- WebGPUModelResources归scene/context/device generation；CPU请求按规范化URL身份去重，GPU几何/纹理按内容SHA256及用途/格式/颜色语义去重。buffer/texture归context账本并显式destroy；sampler/pipeline仅释放引用，无虚构destroy。CPU加载4、解码4、pipeline编译2物理并发，pending有界，超限明确reject。
- DrawPacket声明geometry布局/index/count、local/node transform、material/texture/sampler、bounds、objectId与opaque pass。每packet独立96字节uniform，防止多draw串写。CPU双精度合并对象/view/反向projection后再上传f32，地心坐标不提前量化。
- WebGPUModelRenderer/PipelineCache使用独立unlit shader和bind布局。key包含shader/entry/variant、vertex布局、bind布局、topology、frontFace/cull、target/depth格式、compare/write、blend、sampleCount。factor与同类纹理不进入key。预编译正/负determinant管线，matrix更新不在render热路径编译。
- scene.models收集到同一render pass，先地球，再不透明模型/Primitive，最后既有透明Primitive；共用颜色/反向深度/ID附件。注册表增加明确kind与存活检查，保留旧Primitive行为。

## 纹理与迁移

PNG/JPEG不翻转、不预乘、不做浏览器颜色转换；UV(0,0)取左上。baseColor为rgba8unorm-srgb自动解码，factor/vertex color在线性域相乘，再显式sRGB编码到已有unorm画布；OPAQUE alpha强制1。单mip、nearest/linear、三种wrap实现；显式mip要求拒绝。白色占位与真实baseColor身份分开。

实际调用方：WebGPUScene新增模型服务/集合/注册；WebGPUContext提供账本与丢失通知；WebGPUGeometryRenderer仅抽出共享反向投影计算，旧地形/影像/Primitive不重写。

N05验收要求两种实际布局、索引/非索引、pending共享/取消/失败/generation、独立uniform、同帧深度/ID、未add销毁及旧四套专项。N06-A采用显式unlit；N07再处理PBR/normal/tangent/MASK/BLEND，N08正式性能与完整S07继续开放。

## 实现审查补充

共享 geometry key 除顶点/索引内容 hash 和 stride，还必须包含 indexFormat/count；同字节的 Uint16 与 Uint32 索引含义不同，collision16/collision32 资产用真实 GPU 验证隔离。CPU 解析任务按规范化 URL 与选定 scene 共享，其产出的 typed arrays 和编码图片通过独立 payload 租约按内容身份复用，解码图像与 GPU 资源也按内容身份复用；不把两个相同 JSON 但相对路径基址不同的文档错误合并。

节点层级的非均匀缩放加旋转可能产生剪切，模型包围球使用线性变换最大奇异值，不能只取最大列长度。绘制复用 scratch 矩阵。管线验证错误与 device loss 的注入结果单列 expectedErrors；不计为正常运行 validation 错误。

节点、模型与最终世界矩阵共用列归一化的非奇异/手性检查，不用绝对 determinant 阈值拒绝合法小单位。small-scale 与 small-compensated 资产验证微小尺度及补偿父子缩放，真正零缩放仍拒绝。
