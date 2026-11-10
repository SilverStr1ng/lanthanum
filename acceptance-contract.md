# 验收契约 v2

冻结日期：2026-11-10。更改门槛、资产、画质或采集方法必须先修改本文件及 manifest，再产生新结果；不得事后放宽门槛。S00/S01 的首轮结果不构成 WebGPU 功能或生产性能认证。

第二轮扩充（采集前登记）：保留既有图像/数值/资源门槛和13个子例，新增6个子例：T01-layers（两个本地纯色图层的顺序、0/0.5/1 alpha及移除的像素断言）；T01-dateline（±179°、20°纬度、2000km高度，双半球瓦片与LOD细化）；T05-entity（两个时间样本的移动、材质更新、隐藏/恢复及拾取）；T05-geojson（点线面可视化）；T05-czml（盒体）；T05-kml（绝对高度多边形）。数据源用例均连接DataSourceDisplay，检查显示/隐藏、实际像素、对象ID和销毁。最终相机参数和断言在已hash的extendedScenarios.js中；动态Entity最终时间为12:00:10Z，其他场景仍为12:00:00Z。新增文件及测试源导致manifest身份变更，第二轮保存新目录，不与旧身份混比；引擎释放修复已在旧manifest下单独对比过T01/T01-mercator/T02。新子例仍不能替代完整测试族。

正式采集前追加第7个新子例T05-entity-box，总计20个：保留开发运行发现的动态盒体pickAsync失败，断言不会放宽或排除出默认入口。T05-entity明确使用PointGraphics（60px，SampledPositionProperty）；T05-entity-box使用BoxGraphics（60×60×80m），并有同步pick及红色像素控制。盒体动态Visualizer每帧销毁并重建Primitive，异步读回期间pick ID可能已被释放；保留实际失败，待独立处理拾取生命周期。失败路径也采集断言、诊断和销毁账本。

审阅后重采集登记：GeoJSON/CZML/KML显隐新增逐目标颜色检查，隐藏后RGB必须为0，恢复后与初始值各通道误差≤3/255；原有拾取断言保留。该测试源变更再次更新manifest，使用新目录 `round2-reviewed/`，此前 `round2-final/` 和 `round2-replay/` 原样保留。引擎另修复地形fill VA延迟释放队列在下一帧前销毁时的残留，专用真实WebGL2测试覆盖此时序。WebGL stub只能测普通销毁，真实GPU账本测试明确pending，不冒充硬件通过。

## 主验收环境

- Windows 11 Pro 10.0.26300，x64。
- CPU：AMD Ryzen 7 9800X3D，8核。
- NVIDIA GeForce RTX 5080，驱动 32.0.16.2101；另有 AMD Radeon 集显 32.0.21042.62，未认证。
- Chrome 157.0.8103.40；Edge 157.0.4341.42 可供补测，二者同属 Chromium。
- Windows 电源方案“平衡”（381b4222-f694-41f0-9685-ff5bb260df2e）。采集期间禁止另跑 GPU 压测。
- 1920×1080 实际 framebuffer，CSS 同尺寸，DPR=1。headless Chrome，`--use-angle=d3d11`，从 WebGL debug renderer 和 CDP SystemInfo 留存实际 GPU。软件/不可识别适配器直接失败，不能以 navigator.gpu 存在推断 WebGPU 已运行。
- 此机器 rAF 实测约 240 Hz；不得把约 4.17 ms 的 rAF 当作 GPU 耗时或 60 Hz 产品性能保证。GPU 时间未采集，输出 `null`。

## 固定场景、资产与可复现性

`fixtures/manifest.json` 记录每个资产字节数、SHA-256、来源及许可证。生成资产完全本地；测试拦截非 localhost 请求。固定时间 2026-11-09T12:00:00Z，固定相机参数见浏览器测试源（同样进入 hash）。关闭光照随机变化、阴影、HDR、FXAA、OIT；**MSAA=1**，canvas antialias=false。默认三维模式。

| 族 | 本轮可运行子例 | 尚待补齐的专项基线 |
| --- | --- | --- |
| T00 | 非对称盒体、颜色读回、三个对象 ID；真实 Cesium Primitive；T05另有四象限纹理读回 | 解析三角形边界、单独实例化网格、布局矩阵 |
| T01 | WGS84 椭球、地理/Web Mercator 本地编号 PNG；可见瓦片纹理必须 READY；新增图层顺序/alpha/移除像素断言及±179° LOD细化 | 连续飞行轨迹及多投影组合的专项差异图 |
| T02 | 上游 quantized-mesh 本地 decode/render | 真实相邻 LOD、缺瓦片、海岸/山地剖面；当前上游 tile 是重复映射的测试瓦片，不是全球真实地形 |
| T03 | 自制 glTF 2.0 PBR 盒体，加载/绘制/释放 | alpha MASK/BLEND、skin、morph、动画、压缩、扩展逐项图像 |
| T04 | 上游 b3dm/i3dm/pnts/cmpt；T08 直接 glTF content | ADD/REPLACE 转换、外部/隐式切片、metadata/style 专项用例 |
| T05 | Primitive、点、线、固定OpenSans字体Label、Billboard；新增动态点Entity及GeoJSON点线面、CZML盒体、KML绝对高度多边形的像素/拾取/显隐 | 动态盒体异步拾取失败；更多数据源选项、CZML动态时钟、KMZ/NetworkLink及贴地/裁剪/分类 |
| T06 | 遮挡对象 pickAsync、pickPosition 对解析盒顶面的误差 <=0.1m | 透明/地形重叠、多请求取消和异步位置拾取（未来 API） |
| T07 | 主场景与临时场景并存、20 次创建/resize/销毁、逐次资源计数 | WebGPU/WebGL 混用、device lost/error 注入、长时泄漏 |
| T08 | 16 个固定本地 glTF 瓦片，102,400 盒体，1,228,800 三角形，3.2km×3.2km 合成建筑网格 | 真实业务城市影像/地形/材质工作集与流式 LOD，不能将纯几何合成负载推广为所有城市业务 |
| T09 | 登记延期 S22 | 2D/Columbus/morph |

以上缺口是可见的 S01 后续子任务，**完整 S01 未验收**。本轮完成的是可复现基础环境及各测试族的增量子例，不用场景数量代替完整矩阵覆盖。

## 正确性、资源与退出码

- 每个场景独立浏览器 context，重复三次；不同轮不得隐藏失败。记录 uncaught JS、rejection、console.error、HTTP 错误和外部 URL。
- 保存原始 RGBA gzip、PNG、diff PNG、JSON。首次采集检验重复性；`--compare` 与已保存基线对比。新基线仍需人工审阅画面，首次图像与自己比较不是正确性证明。
- T00：99.5% 像素 RGB 最大通道差 <=3/255；其他场景 SSIM >=0.98 且任一 RGB 通道 >10/255 的像素比例 <=1%。SSIM 为非重叠 8×8 亮度窗口，C1=6.5025、C2=58.5225、总体协方差，alpha 不参与。当前不遮罩任何像素。
- 数值：对象 ID 不允许错误；T06 控制面误差 <=0.1m。S07 再验收至少六个地点、五档高度、GPU 投影最大0.5px；本轮不声称达到此 gate。
- 所有本轮用例要求实际绘制且至少1,000非黑像素；这只是空画面保护，不能替代专项断言和图像审阅。
- GL 对象按 create/delete 计数；Buffer 记录分配字节，Tiles 记录上游几何/纹理账本。通用 Texture 字节尚未测量，返回 null；不伪称物理显存。场景销毁后未归零即失败；上游已知残留也保留非零退出码。
- 测试中任何失败都返回1并保留证据；已知失败登记不改变原始结果为 PASS。

## 性能方法与预算

短跑只采样1.5秒，标注 smoke，不可用于性能验收。T08 正式入口预热30秒、采集120秒、三轮分别报告p50/p95/p99。每帧不读回、不等待GPU队列；单次截图和统计诊断在计时窗外。CPU render 时间包含 Scene 更新和命令提交及轻量仪表开销，未拆分，不报告 GPU 时间。轨迹：原点(-75°,40°,0m)，range=6000m，pitch=-1.3rad，heading=2πt/30；每轮重启轨迹。

生产 v1 预算保持计划：p95帧间隔<=33.3ms，CPU更新+编码p95<=10ms，同画质不比WebGL2恶化>10%，引擎主线程任务不得>100ms；T01本地首画<=3s，T08交互工作集<=5s，拾取p95<=100ms，GPU账本建议<=768MiB，稳定后10圈资源增幅<=5%，连续2小时。当前合成T08无纹理；16瓦片全部就绪且选中1,228,800三角形才算工作集就绪，SSE=16，cacheBytes=512MiB，overflow=256MiB。

HTTP缓存由服务端no-store及每轮独立context控制；浏览器进程/驱动shader缓存未清理，不能把当前readyMs称作五轮严格冷启动结果。CPU缓存、在途解码/上传背压预算及long-task归因尚缺，属于S01未完成项。三台机器、两个GPU厂商、两个OS及两个浏览器引擎、HTTPS发行验证留到S20/S21，不能由本次单机Chromium替代。
