# 固定兼容矩阵 v1（CesiumJS 1.147）

范围冻结于2026-11-10。**当前所有 GPU 能力仅为上游 WebGL2，WebGPU 原生已验收条目为0。** “需适配”是未来目标，不是支持声明；“CPU复用”也不表示整个调用链已支持WebGPU。负责人填写角色而非虚构团队成员。功能编号是固定分母，新增范围须变更ADR。API语义差异单独列出，不用百分比掩盖。

测试族及当前缺口详见 `acceptance-contract.md`。表中测试编号是目标验收位置；已运行证据只覆盖报告中明确列出的子例。平台每个组合独立认证。

| ID | 能力/API/格式 | 决策 | 目标步骤 | 测试 | 负责角色 | 未支持时的行为/范围 |
| --- | --- | --- | --- | --- | --- | --- |
| C01 | WGS84/ECEF/ENU、Cartesian、矩阵、时间 | CPU复用 | S00/S07 | T00/T01 | 地理数学 | GPU上传前编码high/low；不改变CPU精度 |
| C02 | 3D Camera、控制、flyTo、lookAt、tracking | 需适配 | S07/S08/S15 | T01/T05 | 场景 | 保持相机语义，Widget异步需迁移 |
| C03 | Clock/光照时钟/requestRenderMode | 需适配 | S06/S08 | T01/T07 | 场景 | 资源/管线/拾取完成必须唤醒渲染 |
| R01 | auto/webgpu/webgl2异步启动 | 需适配 | S02 | T00/T07 | 后端 | 强制WebGPU失败明确拒绝；auto整场景回退 |
| R02 | 同步Viewer构造 | 保留WebGL2 | S02/S21 | T07 | API | 不把原同步返回改成Promise |
| R03 | Buffer/Texture/Sampler/VA/附件 | 需适配 | S04 | T00/T07 | 资源 | 不向业务散布GPU原始句柄 |
| R04 | uniform schema及WGSL内存布局 | 需适配 | S04 | T00 | shader | 显式对齐、矩阵/数组/动态偏移 |
| R05 | draw/indexed/instanced/depth/stencil/blend | 需适配 | S05 | T00 | 渲染 | 不用占位命令计为原生 |
| R06 | shader变体/AutomaticUniforms/DerivedCommand | 需适配 | S06 | T00/T03/T06 | shader | 核心WGSL模块；失败记录源码/变体 |
| R07 | 多视锥/对数深度/high-low精度 | 需适配 | S07 | T00/T01/T06 | 渲染 | 0.5px专门gate，不先合并ECEF为f32 |
| R08 | 色彩、sRGB、预乘alpha、HDR/色调映射 | 需适配 | S04/S11/S17 | T00/T03 | shader | 固定转换边界 |
| G01 | 椭球/Globe/地球遮挡 | 需适配 | S08 | T01 | 地球 | 必须接真实Cesium场景 |
| G02 | 地理与WebMercator影像、本地UrlTemplate | 需适配 | S09 | T01 | 影像 | 其他投影逐项诊断 |
| G03 | 影像层顺序、alpha、亮度、日期变更线 | 需适配 | S09 | T01 | 影像 | 不把单层显示计为全部支持 |
| G04 | TMS/WMTS/WMS/ArcGIS imagery providers | CPU复用+适配 | S09/S21 | T01 | provider | 本地服务契约fixture；不可凭公网偶然成功验收 |
| G05 | ion/Bing/Google/商业专有影像服务 | 需适配，条件认证 | S21/S23 | T01 | provider/发布 | 需用户合法凭证与服务条款；核心验收不依赖token |
| G06 | EllipsoidTerrainProvider | 需适配 | S08 | T01 | 地形 | 与地球一起验收 |
| G07 | quantized-mesh/heightmap/vertex normals/water mask | 需适配 | S10 | T02 | 地形 | 解码、绘制、接缝、释放一起验收 |
| G08 | 地形LOD、skirt、父级替代、缺瓦片 | 需适配 | S10 | T02 | 流式数据 | 保留CPU调度，失败有明确替代 |
| G09 | sampleTerrain/sampleTerrainMostDetailed | CPU复用 | S10/S16 | T02/T06 | 地形 | CPU高度查询不等于GPU位置拾取 |
| M01 | glTF2/GLB、metallic-roughness PBR、normal/occlusion/emissive | 需适配 | S11 | T03 | 模型 | 基础glTF先完成颜色/深度/释放 |
| M02 | OPAQUE/MASK/BLEND、双面材质 | 需适配 | S11/S17 | T03/T06 | 模型/shader | MASK须共享颜色/深度/拾取裁剪 |
| M03 | 动画、skin、morph targets | 需适配 | S11 | T03 | 模型 | 静态姿态不等于动画支持 |
| M04 | EXT_mesh_gpu_instancing | 需适配 | S11/S12 | T03 | 模型 | 实例变换/法线/ID/释放一起验收 |
| M05 | KHR_draco_mesh_compression | 需适配 | S11 | T03 | loader | CPU/WASM解码与GPU资源均需验收 |
| M06 | EXT_meshopt_compression | 需适配 | S11 | T03 | loader | 不支持时明确错误 |
| M07 | KHR_texture_basisu/KTX2 | 需适配 | S04/S11 | T00/T03 | 纹理 | 按device压缩能力选择转码；不得黑纹理成功 |
| M08 | KHR_texture_transform | 需适配 | S11 | T03 | 材质 | UV方向及变换数值验证 |
| M09 | KHR_materials_unlit | 需适配 | S11 | T03 | 材质 | 固定输出颜色空间 |
| M10 | KHR_mesh_quantization | 需适配 | S11 | T03 | loader | 解码/布局/精度验证 |
| M11 | EXT_mesh_features/EXT_structural_metadata | 需适配 | S13/S14 | T04/T06 | 特征属性 | 属性解析、style、拾取共同验收 |
| M12 | KHR_materials_clearcoat/specular/ior/transmission/volume/sheen/iridescence/anisotropy | 延后 | S23 | T03/T09 | 材质 | 生产v1遇到required扩展明确拒绝，optional扩展按glTF合法基础回退并诊断 |
| M13 | KHR_materials_variants及剩余扩展 | 延后 | S23 | T03/T09 | 模型 | 逐扩展工单，不宣称任意扩展支持 |
| D01 | 3D Tiles1.1直接glTF内容 | 需适配 | S12 | T04/T08 | Tiles | T08仅WebGL2直接glTF基线 |
| D02 | b3dm | 需适配 | S12/S13 | T04 | Tiles | 批属性、绘制与释放 |
| D03 | i3dm | 需适配 | S12/S13 | T04 | Tiles | 实例与每实例ID |
| D04 | pnts | 需适配 | S12/S13 | T04 | 点云 | 点大小、颜色、属性、拾取 |
| D05 | cmpt | 需适配 | S12/S13 | T04 | Tiles | 内层内容共同释放/拾取 |
| D06 | ADD/REPLACE、外部tileset | 需适配 | S12 | T04/T08 | 流式数据 | 不能只验证JSON解析 |
| D07 | implicit tiling/subtree | 需适配 | S12/S13 | T04 | Tiles | 可用性、请求、LOD端到端 |
| D08 | feature/batch table、metadata、Cesium3DTileStyle | 需适配 | S13 | T04/T06 | 属性/style | 动态显隐、高亮、ID保持 |
| D09 | SSE、调度、缓存、取消、并发上传预算 | CPU复用+适配 | S12/S19 | T04/T08 | 流式数据 | 固定内容/画质后比较性能 |
| P01 | Primitive/GeometryInstance/点线面 | 需适配 | S15 | T05 | GIS图元 | 每图元及关键选项列子用例 |
| P02 | Billboard/Label/纹理图集 | 需适配 | S15 | T05 | GIS图元 | 文字字体、alpha边缘、拾取单独验收 |
| P03 | Entity/Visualizer、动态属性、选中/跟踪 | 需适配 | S15 | T05 | Entity/Widget | 解析数据不算可视化完成 |
| P04 | GeoJSON | 需适配 | S15 | T05 | 数据源 | 本轮仅解析；生产需显示/更新/释放 |
| P05 | CZML | 需适配 | S15 | T05 | 数据源 | 固定时钟动态Entity |
| P06 | KML/KMZ基础路径 | 需适配 | S15 | T05 | 数据源 | 外部NetworkLink等逐项条件认证 |
| P07 | GroundPrimitive/GroundPolyline/clampToGround | 需适配 | S16 | T02/T05 | GIS图元 | 贴地不能只采一个高度后浮空绘制 |
| P08 | ClassificationPrimitive/裁剪平面及多边形 | 需适配 | S16 | T04/T05 | 分类/裁剪 | 与深度、拾取一致 |
| I01 | Scene.pickAsync | 需适配 | S14 | T06 | 拾取 | 显式异步、对象ID与时效 |
| I02 | pick/drillPick同步GPU读回 | 破坏性差异 | S14/S21 | T06 | API | WebGPU提供显式异步替代或拒绝；不返回陈旧数据 |
| I03 | pickPosition/深度重建 | 破坏性差异 | S14/S16 | T06 | API/深度 | WebGPU新增异步方法；上游同步语义保留于WebGL2 |
| I04 | sampleHeight/clampToHeight及MostDetailed | 需适配 | S16 | T02/T06 | 高度查询 | 涉及GPU路径需声明异步差异 |
| I05 | ScreenSpaceEventHandler/输入路由 | CPU复用+适配 | S14/S15 | T05/T06 | 交互 | DOM/CSS坐标换算与取消 |
| E01 | 基础大气/雾 | 需适配 | S17 | T01 | 效果 | 与颜色空间/深度一致 |
| E02 | 排序透明与OIT能力等级 | 需适配 | S17 | T03/T06 | 效果 | 不用排序透明冒充OIT等价 |
| E03 | 阴影/抗锯齿 | 需适配 | S17 | T03/T05 | 效果 | 独立阴影与MSAA/FXAA子用例 |
| E04 | 常用后处理：FXAA、色调映射、Bloom、轮廓 | 需适配 | S17 | T05 | 后处理 | 列明支持stage；任意GLSL stage不自动兼容 |
| X01 | CustomShader、Material fabric、PostProcessStage GLSL | 受控适配 | S18 | T03/T05 | 扩展API | 明确子集/WGSL替代；任意GLSL默认不支持 |
| X02 | 第三方插件/专有SDK | 未认证 | S18/S21/S23 | T05/T09 | 生态 | 按插件版本做端到端验证；不承诺零修改 |
| L01 | device lost/uncaptured error/恢复 | 需适配 | S02/S20 | T07 | 生命周期 | 先停止提交；恢复策略S20验收 |
| L02 | 多Viewer、混合后端、resize、销毁 | 需适配 | S04/S20 | T07 | 生命周期 | 每device/context隔离，账本可追踪 |
| L03 | CPU/GPU预算、背压、管线预热 | 需适配 | S19 | T08 | 性能 | 固定工作集后测试，不能删内容过关 |
| L04 | ESM/发行包/types/Worker/WASM/署名 | 需适配 | S21 | T07/T08 | 发布 | 清洁环境和受控HTTPS部署验证 |
| B01 | Windows/Chromium/RTX5080 | WebGL2基线已运行 | S01/S20 | T00—T08 | 验证 | 仅精确版本；WebGPU未认证 |
| B02 | Windows/Chromium/AMD集显 | 待认证 | S20 | T00—T08 | 验证 | 不因系统列出设备就声称通过 |
| B03 | macOS/WebKit或Gecko/实际GPU | 待认证 | S20/S21 | T00—T08 | 验证 | 当前无此硬件，正式发布必须补测 |
| B04 | Linux/Chromium或Gecko/实际GPU | 待认证 | S20/S21 | T00—T08 | 验证 | 与B03共同选择至少两个OS/浏览器引擎 |
| B05 | 移动端 | 明确不属生产v1 | 后续独立版本 | T07/T08 | 产品/验证 | 默认未认证，不套用桌面功耗/性能预算 |
| B06 | 无navigator.gpu、空adapter、能力不足、软件GPU、非安全HTTP | 必须诊断/回退 | S02/S20 | T07 | 后端/验证 | 强制WebGPU报错；auto整场景WebGL2 |
| F01 | SCENE2D、地图重复、二维拾取 | 延后 | S22 | T09 | 模式 | 生产v1 WebGPU明确不支持 |
| F02 | Columbus View/morph | 延后 | S22 | T09 | 模式 | 20次切换和状态一致性专项 |
| F03 | Voxel/I3S/粒子/其余图元 | 延后 | S23 | T09 | 扩展 | 每能力独立工单与证据 |
| F04 | GI/复杂体积云/GPU驱动渲染 | 不属本轮路线 | S24之后另立项 | 独立测试 | 产品/架构 | 不占用本次分母、不宣称支持 |

对“延后”或“不支持”条目，未来WebGPU入口必须抛出可定位诊断，或由应用按矩阵预先选整个WebGL2场景。当前没有WebGPU入口，不存在静默混合后端的支持声明。
