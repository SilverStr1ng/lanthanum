# 本轮进度报告：S00—S01 首批基线

- 范围依据：实施计划第9节；本轮没有实现S02—S24，也没有WebGPU原生功能。
- 上游基线commit：`2aaf1daa6b9be58fb087fdc9f05f2f4d7ee37a87`；最终采集实现commit：`d84d8a39ce6079e4837ced59d9486a5fd9a3c0b6`。
- 当前步骤：S00的固定基线、范围与复用决策已落地；S01首批13个子例可运行，完整S01待验收。
- 版本、工具链、清洁安装与命令：`baseline.md`。
- 支持范围/责任角色/测试族：`compatibility-matrix.md`。
- 资产hash、许可证、参数：`fixtures/manifest.json`。
- 图像/数值/资源/性能方法与缺口：`acceptance-contract.md`。
- 后端路线、API差异、候选fork实际构建：`adr/0001-migration-scope.md`。

## 当前证据及未通过项

首批场景覆盖几何颜色和对象ID、地理/WebMercator编号影像、quantized-mesh、glTF、四种旧Tiles容器、GIS基本图元、异步对象拾取及解析深度、20轮双Scene生命周期、122.88万三角形合成城市。

最终证据目录：`benchmarks/baseline/chrome-final/`；主索引 `summary.json`，每次运行有JSON、PNG、RGBA gzip和差异图。实现/manifest/依赖锁/构建hash、实际OS/CPU/GPU/浏览器一并留存。Node24.15.0、Chrome157.0.8103.40、RTX5080/D3D11、1920×1080/DPR1。资产manifest SHA-256为 `542eb7fa3533241d778b9018ee1354ab652905f5a0e989324acf61123dae002e`。

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| 清洁npm ci、gulp prepare/build | 通过 | `benchmarks/baseline/audit/clean-install.log`、`build.log` |
| 干净git archive导出后重建资产 | 162项hash全部一致 | `benchmarks/baseline/audit/clean-export.json` |
| 工具逻辑测试 | 6/6通过 | `audit/tool-tests.log` |
| 新增JS的ESLint、格式、原有根tsc | 通过；不声称浏览器JS获得完整类型检查 | `audit/eslint.log`、`format.log`、`typecheck.log` |
| 13子例×3次实测 | 30次通过，9次资源释放失败；退出码1 | `chrome-final/summary.json` |
| 图像重复性 | 全39次通过；最小SSIM=0.9999999972，显著差异像素比例=0 | 各子例JSON与diff PNG |
| JS异常/console.error/外部请求 | 均为0 | 各子例JSON；上游Karma结果另列 |
| T06解析深度 | 三轮误差约0.000383m，小于0.1m | `chrome-final/T06-1.json`等；只代表合成盒面 |
| T07生命周期 | 每轮20次双Scene并存/resize/销毁通过，共60次 | `chrome-final/T07-*.json` |
| T08工作集 | 每轮16瓦片/1,228,800三角形；几何73,728,000字节、纹理0字节；20 draw/帧（含辅助pass） | `chrome-final/T08-*.json` |
| T08就绪耗时 | 741/735/736ms；非严格冷启动 | 同上，驱动缓存未清理 |
| 上游默认完整Jasmine | 执行16,031/16,098，17失败、67跳过，退出1 | `audit/upstream-default.log` |
| 上游WebGL validation | 执行至7,514，52失败、中断，退出1 | `audit/upstream-validation.log` |

城市轨迹实测：`benchmarks/baseline/performance/summary.json`。每轮30秒预热、120秒采样，三轮rAF样本数28,802/28,800/28,799；三轮rAF p50/p95/p99均约4.2/4.3/4.3ms，CPU Scene更新+提交p50/p95/p99均约0.3/0.4/0.5ms。三轮均无JS/网络错误，最终选中16瓦片、1,228,800三角形，销毁后账本归零。GPU时间未测。这是240Hz headless、无纹理合成几何场景的测量，不能推广为60Hz真实城市业务或生产v1性能认证。

`--compare`实际重放T00/T05/T08，各1次，通过图像、断言和资源检查；输出 `benchmarks/baseline/replay/`，未覆写原参考目录。

资源失败三轮稳定重现：T01剩余3 Buffer/2 Texture/2 VA（Buffer 21,340字节）；T01-mercator剩余3/8/2（21,340字节）；T02剩余4/2/2（20,032字节）。其他子例账本归零。没有将已知失败降级为通过。

已人工检查最终T01/T02/T05画面，确认编号影像、地形绘制、固定字体与四色Billboard存在。初次采集 `benchmarks/baseline/chrome/` 保留了T08仅12瓦片便提前判定就绪的失败；已修复为等待完整16瓦片并重新采集，不覆写初次证据。审阅发现的输出覆盖、Buffer重载计数、字体和Billboard就绪问题全部解决，详见 `docs/reviews/s00-s01.md`。

已确认的上游问题：地球场景destroy后仍有瓦片资源残留；全量WebGL validation运行在Buffer/CubeMap处发生INVALID_ENUM。所有失败保留原始日志及非零退出码。无引擎改动，无隐藏WebGL/WebGPU混合绘制。

完整S01缺少T00布局/实例化、T01多层/日期变更线、T02真实地形接缝与缺瓦片、T03动画/skin/morph/压缩扩展、T04隐式/外部/metadata、T05动态Entity/数据源可视化等专项基线；CPU/解码/上传预算也尚未冻结。详情逐项列在验收契约，不能以首批13子例替代完整T00—T08。

## 进度及下一步

生产v1、扩展兼容、平台认证与API兼容分别记录。当前WebGPU原生已验收为0；S00/S01未整体通过G0，生产v1已验收权重暂为0%，不将文档或代码量计作功能完成度。

下一轮优先完成S01缺口和上游已知失败的最小复现/处置记录。S02可以准备实现，但依赖S01正式gate，不能提前宣布验收。

S02细化任务：

1. 定义异步bootstrap状态机：idle/requesting-adapter/requesting-device/configuring/ready/failed/destroyed；统一取消和销毁结果。
2. 冻结必需feature/limit、可选增强及真实device能力快照；能力不足给出具体差异。
3. 实现context创建前的auto/webgpu/webgl2选择；强制webgpu不隐式降级，重复使用已有canvas给明确错误。
4. 在独立T00清屏用例上验证连续呈现、resize、标签、destroy；监听device.lost/uncapturederror后停止提交。
5. 实测无navigator.gpu、空adapter、requestDevice失败、limit不足、HTTP不安全源和localhost/HTTPS；记录真实GPU与软件adapter区别。
6. 保持WebGL2回归；涉及GPU绘制时在真实设备留证。完整运行期恢复属于S20。
