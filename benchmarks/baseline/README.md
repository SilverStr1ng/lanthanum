# S00—S01 基线证据索引

正式首批基线是 `chrome-final/summary.json`，不是 `chrome/`。后者保留一次旧的就绪判定失败，见下表。所有图像来自WebGL2；没有WebGPU认证结果。

| 路径 | 内容与结论 |
| --- | --- |
| `chrome-final/` | 实现commit d84d8a3；13子例各3次：30通过/9资源销毁失败；39次图像重复性均通过 |
| `performance/` | 相同commit/manifest，T08固定轨迹30秒预热+120秒采样×3；只报告实测，不替代完整性能gate |
| `replay/` | 使用--compare读取chrome-final参考，T00/T05/T08三例实测重放通过，不覆写参考 |
| `chrome/` | 实现commit09d4b24的首次采集；T08过早认定工作集就绪，12/16瓦片导致3次失败，已修复并重新采集到chrome-final |
| `audit/clean-install.log` | Node24.15.0/npm11.6.1的npm ci成功 |
| `audit/build.log` | 固定源码和依赖的gulp build成功 |
| `audit/clean-export.json` | 干净Git导出后重新生成并校验162项hash成功 |
| `audit/upstream-default.log` | 原版默认全量Jasmine：16031执行、17失败、67跳过；非零退出 |
| `audit/upstream-validation.log` | 原版validation套件：7514执行、52失败后中断；未执行部分不计通过 |
| `audit/fork-install.log`、`fork-build.log`、`fork-comparison.json` | 候选fork的精确SHA、依赖安装成功、浏览器包构建失败；没有样例通过声明 |
| `audit/gpu-drivers.json`、`os.json`、`power.txt` | 主验收机OS、驱动和电源设置；实际选中的GPU另见每次运行JSON |
| `audit/tool-tests.log`、`eslint.log`、`typecheck.log`、`format.log` | 最终工具测试6/6、ESLint、根tsc、格式检查通过；无输出的检查日志是正常成功输出 |

每个最终子例保留三轮PNG、原始RGBA gzip、差异PNG、检查/请求/错误/资源/逐帧采样JSON。summary中的`passed`是本工具的图像、断言、错误和资源释放联合结果；性能窗口的预算与产品gate须结合验收契约单独评定。初始轮对自身图像的比较只用于建立参考，不能证明正确性；数值断言、后两轮重复性与人工画面检查提供额外证据。

原始日志/JSON的失败不因被列为“已知”而改变。不同实现或fixture身份必须写入新目录，禁止覆写旧证据。当前两个capture目录hash不同；正常后续比较使用chrome-final。参见根目录 `baseline.md` 和 `progress-report.md`。
