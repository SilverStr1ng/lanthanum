# S01 第二轮双轴审查

固定比较点：实施计划指定的上游 `2aaf1daa6b9be58fb087fdc9f05f2f4d7ee37a87`；本轮重点增量 `d668c2b...de51ee9`。两个独立审查代理只读源码与日志，未运行GPU，修复及实测由主代理完成。

## Standards

依据 CONTRIBUTING、CodingGuide、TestingGuide。发现1项P2回归：GlobeLifecycle真实GPU账本测试在 `--webglStub` 下监控的是未使用的真实context，导致Buffer计数断言失败；必须显式跳过，不能把stub计作GPU释放通过。

处理：先实测1失败1通过，再为真实GPU账本用例增加Jasmine pending。普通首帧前销毁继续执行；最终stub专项1通过，两个真实GPU用例跳过。日志 `lifecycle-stub-red.log`、`lifecycle-stub-reviewed.log`。未发现需处理的代码异味；新增场景已拆为独立模块。

Standards代理已复核最终stub处理、VA队列清理和真实TerrainFillMesh回归，无剩余可行动发现。

## Spec

依据实施计划的“资源正确释放”和验收契约的颜色/显隐/拾取要求。发现2项P2：

1. 真实地形替换fill后，旧VA已进入延迟释放队列并从瓦片脱离；下一帧前destroy仍会泄漏。实测复现2 Buffer、1 VA、4428 Buffer字节残留。provider的initialize/destroy现共用清理函数；新增实际TerrainFillMesh创建、入队、立即销毁回归。Globe相关126项通过，见 `deferred-fill-red.log` 和 `globe-reviewed.log`。
2. GeoJSON/CZML/KML原显隐阶段仅验证pick，无法证明颜色pass同步。现逐目标验证隐藏后RGB归零，恢复后与初始RGB差≤3/255，保留所有对象ID断言。

Spec代理已复核两项修复，无剩余可行动发现。动态盒体pickAsync失败及其余S01缺口保留，不构成完整阶段验收。

最终实测：实现b72b7f9的完整上游套件16,035项执行，17项失败身份与原版完全一致；最终baseline为57/60通过，3次为已登记动态盒体失败，60次资源归零。增强的三类数据源显隐像素断言各三轮通过，并分别对已存图像重放通过。最终manifest为0d476e0b开头，证据 `round2-reviewed/` 和 `round2-reviewed-replay/`。

本轮初始发现数：Standards 1，Spec 2；两轴最高均为P2，分别处理，不合并排名。最终采集/实现版本以 `progress-report.md` 和证据summary为准。
