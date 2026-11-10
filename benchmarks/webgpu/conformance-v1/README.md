# N01—N04 基础子集验收包

最终实现：`64d333bc8b03f7cafc22367ffd85327eb6208fb3`。干净工作树，Node24.15.0，Chrome157.0.8103.40，Windows，原生NVIDIA/Blackwell；RTX5080来自环境契约，浏览器device字符串为空。后续提交只更新CI顺序、文档与证据，不改变已测运行时/测试实现。

三轮均为基础49、流式59、成对绘制111、山脊49项，每个入口另13项页面检查；合计960次累计断言。268项专项断言和13项页面检查不等于完整Cesium功能覆盖；重复次数不增加独立能力。详见summary.json与check-names.json，原始结果按套件/轮次保留。

## 问题关闭表

| 问题 | 结果 | 证据 |
| --- | --- | --- |
| F01代际取消 | 关闭当前复现 | audit/n01-red.log与n01-green-2.log，最终CPU19项日志；terrain-*/result.json含20次返回、100ms/1s迟到与真实上传计数 |
| F02普通ST裁剪 | 关闭 | red-green/n02-red：WebGL2控制组通过、WebGPU失败；最终conformance-*正常，旧影像裁剪专项保持 |
| F03显式near/高海拔近处 | 关闭当前用例 | conformance-*海拔0/5000、距离1/2/10与frustum保持；旧轨道与遮挡用例继续通过 |
| F04闭合透明体 | 关闭当前用例 | conformance-*盒体/椭球内外、RGB/ID与frustum；背面后正面双pass，不承诺OIT |
| F05默认目录 | 关闭 | audit/n03-directory-red.log、CPU不覆盖测试、clean-default真实浏览器结果；测试前移走已有runs目录保留历史输出 |
| F06安装/工具链 | 安装问题关闭 | audit/ci-64d333bc-jobs.json及两平台完整日志，npm ci/ast-grep/build/types/lint/CPU均成功；旧dev lint顺序问题另有红日志与CI修复提交 |
| 上采样/影像LOD耦合 | 明确延期 | terrain-*原始请求、fallback/upsampledFromParent与work统计；docs/issues/terrain-imagery-lod.md阻塞高分辨率业务工作集 |

非平坦夹具、相机、接缝采样与阈值见adr/0004-basic-conformance.md。CPU网格高程与GPU遮挡分别断言，新增4500m控制盒体验证GPU夸张的可见→遮挡→重现。原平坦heightmap/quantized-mesh、49/59/13断言和frozen manifest没有替换。

## 回归与限制

完整Jasmine重跑16018通过、17失败、67跳过。audit/failure-comparison.json按身份比较，新增/消失均为空。它在实现提交前执行，之后引擎内容与构建hash相同；后续变更仅补强测试和文档。所有三轮GPU结果记录相同实现SHA、构建与两套fixture hash，控制台与validation错误均为0。

通用CI没有执行硬件WebGPU；本包三轮是独立硬件证据。全工作区仍有Sandcastle TypeScript6 Debug Failure、原计划Markdown末尾空行、上游大面积Prettier差异；已实际执行并保留日志，未禁用检查。根/engine类型检查与本轮改动文件lint/格式另行通过。build-ts的旧JSDoc警告不表示静态类型完整覆盖。

未执行正式1080p/30s预热/120s×3性能、完整S07精度、跨GPU/浏览器认证。未实现glTF/PBR/Tiles、完整Viewer/Entity或设备自动恢复。N05只交付adr/0005-model-render-contract-proposal.md建议，不能标为接口已实现。

Windows本地clean目录从旧提交导出并覆盖本轮源变更后npm ci；操作系统CI则对最终实现执行真实checkout。中间51fba5ab三轮在相邻conformance-review-51fba5ab目录单独保留，不混入本包960计数；red-green为开发红绿，允许dirty tree，最终验收全部clean。
