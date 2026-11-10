# ADR 0004：N01—N04 当前子集收口

- 实际基线：`89bc1ef49af6b19cbca37ca815d2db6e1ce0312e`，开工工作树干净。
- 本轮依据：用户提供的 `docs/Lanthanum-WebGPU-Review-2026-11-10.md`，执行 N01—N04；N05 仅交付接口建议，模型实现不进入本轮。
- 公开测试接口沿用 Scene.createAsync、framebuffer、pickAsync、Globe.pick；按任务书新增实际地形 provider 方法的确定性逻辑测试，外部 GPU 和受控任务使用替身，逻辑测试与硬件结果分开报告。
- F02—F04 控制组在修复前冻结：256×256、DPR=1、黑色背景、flat 红色、关闭 MSAA/HDR/FXAA/OIT/logDepth，显式 near=0.1、far=30000000。中心 RGB 每通道误差≤3，ID 必须一致。ST 为缺省、0.5、-2、2；海拔 0/5000 米，前方 1/2/10 米；闭合盒体/椭球，外侧/内侧。透明 alpha=128/255，外侧两层预期红色192，内侧一层128。WebGL2 独立控制场景不可用于原生补绘。
- near/far 契约：创建原生 Camera 时给出默认 near=0.1、far=500000000；render 保留应用显式设置，只验证有限且0<near<far。这不是完整 S07 精度认证。
- 深度：在 CPU 双精度投影矩阵中先将 OpenGL 的 [-1,1] 转为反向 WebGPU [1,0]，再与 view/model 合并上传。depth32float 清零，greater-equal 比较；避免在 WGSL 中对两个地心量级的 clip 分量相减而丢失近远差异。颜色/深度/ID 使用同一投影；没有新增每帧读回。
- 透明闭合体：每实例按距离排序，内部先剔除正面绘制背面，再剔除背面绘制正面，两次均 depthWrite=false，使用相同 ID 和同一份不变 uniform；不是 OIT。
- 代际：tile.data 身份、provider/夸张 generation 和 scene 存活共同决定所有权；逻辑取消不释放实际请求/Worker 槽位，真实完成后才回收。
- 既有49项基础、59项流式、13项页面检查保持原断言；新增检查另列，三轮仅作为重复运行次数。历史证据与冻结 fixture 不覆盖。

## N04 山脊夹具与采集冻结

初次探索记录保存在 `benchmarks/runs/n01-n04/n04-first` 至 `n04-fourth`，不作为最终签收。初始视距200 km未选出混合LOD，改为500 km；取样移至画面内侧；地形缓存固定24，使快速返回比较使用同一驻留预算。断言容差没有放宽。最终三轮开始前冻结以下参数：

- `Specs/WebGPU/ridgeFixture.js`：33×33 heightmap，WGS84 Geographic；山脊顶点(30.234375°,20.390625°)高3300 m，左右±0.3515625°高2675 m；基底800 m、山脊幅值2500 m、半宽1.40625°，纬向每度100 m（限±1°）。完整公式和缺块后代规则见文件。
- L8相邻四块x=298/299、y=98/99；(299,99,8)及后代缺块。混合视角heading=0、pitch=-0.65 rad、range=500000 m，L8 y=100与L7 y=49在纬度19.6875°接边。俯视range=110000 m、pitch=-π/2，目标山脊顶点。
- 960×540、DPR1，maximumTerrainLevel=8、SSE=8、tileCacheSize=24，固定方向基础光照。裙边开/关均采集接边±2 px邻域，绿色通道>30表示非背景；相邻解析边界一致，故本资产裙边关闭也不应出现黑缝。此用例不证明任意不同分辨率真实源都无裂缝。
- CPU网格样本误差<30 m；GPU只验证可见像素与埋藏Primitive的对象ID遮挡，不冒充GPU高程测量。夸张2倍后山脊6600 m。20次快速离开4帧并返回；稳定段资源数量极差≤16、物理在途峰值≤8、最终销毁归零。
- 真实浏览器受控root任务等待新代上传后延迟100 ms/1000 ms释放；旧代不得再上传。独立Node测试覆盖同一tile乱序、拒绝、Worker迟到、八槽背压。
- `terrainWork.cancelled`只统计因离开视区而取消的任务；代际失效不计入它。requests/upsamples/meshes是当前阶段数量，requested/upsampled/uploaded是累计数量；inFlight包含逻辑取消但尚未实际完成的工作。
- 本轮仅观察上采样标记与影像LOD耦合，后续工单 `docs/issues/terrain-imagery-lod.md` 阻塞高分辨率业务工作集签收。
