# 第二轮审计日志

- `full-default.log`：完整默认套件，16,033执行、17失败；`failure-comparison.json`逐项对比首轮失败身份，新增/消失均为空。
- `globe.log`：125通过；`quadtree-final.log`：最终43通过。
- `provider-red-2.log` / `provider-green.log`：通用provider无cancelReprojections时的真实失败/修复；`provider-red.log`是第一次脚本导入路径错误，不作为产品失败证据。
- `format.log`是初次格式失败；修正后的结果为 `format-final.log`。空的eslint/tsc日志表示命令成功且无诊断，不代表全引擎均完成类型覆盖。
- `clean-export.json`：从已提交源导出并重建所有168个资产，无重新freeze。
- `evidence-summary.json`：从正式60次JSON聚合，保留57通过、3失败；全部60次资源归零。

审查前采集运行的是 `de51ee9`。最终审阅版运行 `b72b7f9`，对应 `*-reviewed` 文件：完整套件16,035执行、17个原失败不变；Globe126项通过；stub普通销毁1项通过、真实GPU2项跳过。最终baseline再次57/60通过、全部资源归零，见 `evidence-summary-reviewed.json`。不覆盖旧日志；历史失败不因后续修复而改写成PASS。
