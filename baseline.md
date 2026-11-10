# Cesium WebGPU 迁移基线

本仓库执行 `docs/Cesium-WebGPU-Implementation-Plan.md` 第 9 节的首轮任务：S00—S01。当前实现仍为原版 **WebGL2**；没有新增 WebGPU 渲染功能。阶段状态与证据见 `progress-report.md`。

## 版本与工具链

| 项目 | 固定值 |
| --- | --- |
| 上游 | https://github.com/CesiumGS/cesium |
| 发布 tag | 1.147 |
| tag 对象 | 5cc6896c063a5a5a70ea8af9b290290bf5369f65 |
| 完整 commit | 2aaf1daa6b9be58fb087fdc9f05f2f4d7ee37a87 |
| 工作分支 | webgpu/s00-s01-baseline |
| Node | 24.15.0，见 `.nvmrc` |
| npm | 11.6.1 |
| 依赖 | 提交 `package-lock.json`，使用 `npm ci`；禁止验收时重新解析浮动版本 |
| 授权 | 上游及自制测试资产 Apache-2.0，保留 `LICENSE.md`、`ThirdParty.json` 与原有署名 |

开始时 `D:/Nothing/Lanthanum` 是空目录，没有 Git 仓库或用户修改。通过 `git ls-remote` 核验 tag 解引用与计划一致，再检出该版本建立分支。没有修改 `packages/` 引擎或 Widget 代码。上游 `.gitignore` 原先忽略 lockfile，本分支取消这一忽略以使安装可重现。

宿主最初是 Node 24.11.0；第一次依赖解析出现部分 lint 依赖要求 >=24.15.0 的警告，因此固定支持的 24.15.0 并重新清洁安装。浏览器使用系统 Chrome/Edge，不下载一个不同版本的 Playwright Chromium。测试结果记录具体版本，不将 `channel=chrome` 当作永久固定浏览器版本。

## 清洁安装与复现

安装 Node 24.15.0、npm 11.6.1 及 Chrome 后，在仓库根目录运行：

```sh
npm ci --ignore-scripts --no-audit --no-fund
npx gulp prepare
npm run build
npm run baseline:generate
npm run baseline:verify
npm run baseline:test
npm run baseline:run
```

`--ignore-scripts` 避免上游 prepare 自动下载浏览器；显式 `gulp prepare`/`build` 已包含本回归必需的构建步骤。生成器重建约 74 MB 的城市几何及编号影像，生成内容不提交 Git，SHA-256 固定在 `fixtures/manifest.json`。不要把 `baseline:freeze` 加入 CI 或正常复测流程；它只用于经过审查的资产/测试契约变更。

```sh
# 手工查看本地页面，命令打印实际 URL；?scene=T00 ... T08
npm run baseline:serve
# 独立输出目录，重复三次；失败时仍写 JSON/PNG 并返回非零
npm run baseline:run -- --output=benchmarks/runs/recheck
# 与保存的像素基线比较
npm run baseline:run -- --compare=benchmarks/baseline/chrome --output=benchmarks/runs/compare
# 固定城市轨迹，30 秒预热、120 秒采样、三轮
npm run baseline:run -- --scenes=T08 --performance --output=benchmarks/runs/performance
# Edge 是同一 Chromium 引擎的补充，不算第二浏览器引擎
npm run baseline:run -- --channel=msedge --output=benchmarks/runs/edge
```

## 原有检查与已知失败

保留上游所有 npm scripts。`npm test -- --browsers ChromeHeadless --failTaskOnError --suppressPassed` 是完整 Jasmine 入口；`npm test -- --includeName Buffer --browsers ChromeHeadless --webglValidation --failTaskOnError` 可定位验证问题。Windows 可用 `CHROME_BIN` 指向安装的 Chrome。

初次完整 `--webglValidation` 运行在 16,098 项中执行至 7,514 项，52 项失败并中断，主要是 Buffer suite beforeAll 中 CubeMap 初始化 `INVALID_ENUM`，继发 teardown 失败。原始输出保存于 `benchmarks/baseline/audit/upstream-validation.log`。这不是绿色回归，也不能把未执行的项计作通过；引擎源码与锁定 SHA 相同。

原版地球销毁后，T01/T01-mercator/T02 的账本仍有瓦片 Buffer/Texture/VertexArray。源码 `QuadtreePrimitive.destroy()` 仅销毁 tileProvider，未释放 level-zero tiles；本轮保留这一失败作为后续生命周期回归基线，不替上游悄悄修正后再称原版基线通过。

## 源码审计入口

- CPU：`packages/core/Source`；provider、请求调度和部分 Core 仍在 engine。
- `Renderer/Context.js` 创建 WebGL context 并写全局 `ContextLimits`；后端隔离需要 S03/S04。
- `Renderer/ShaderSource.js` 及 `AutomaticUniforms.js` 保留 GLSL 组合语义，WGSL 需要独立变体和布局。
- `Scene/GlobeSurfaceTile.js` 创建 VA/Buffer；Model pipeline 和 DrawCommand 仍引用 WebGL 包装对象。
- `Scene/Scene.js` 公开 `pickAsync`，`pickPosition` 仍同步；S14 提供明确的异步迁移入口。
- 非官方 fork 评估和路线决策见 `adr/0001-migration-scope.md`。

基线 PNG 保存原始 framebuffer，不含页面上的 DOM 署名层；交互页面保留 Cesium 默认署名。本地网络限制阻止所有非本地 URL；JSON 记录所有请求及失败。
