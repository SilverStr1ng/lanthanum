# 地形上采样与影像独立 LOD

状态：开放；阻塞真实高分辨率工作集验收。范围：S08—S10、S19；N04只观察，未修复。

`WebGPUGlobeTileProvider` 未设置 `tile.upsampledFromParent`，即使四个子块全来自上采样仍可继续构网至 maximumTerrainLevel。`WebGPUImagery.prepare` 以地形tile.level决定影像请求；N04里影像provider支持16级，但最高请求仅8级。默认地形上限12同样会限制常规16级影像。祖先替代不能补高分辨率。

复现：`node scripts/webgpuTest/run.js --suite=terrain`。查看 result.json 的 terrainRequests、imageryRequests、snapshots 与 terrainWork。当前缺块fallback为true而upsampledFromParent为false；requested/upsampled/uploaded、inFlight/meshes保留作后续比较。

后续设计需区分真实地形数据细化、表面几何细分与影像texel需求；不能只设置upsampledFromParent使四叉树停止而令影像更模糊。关闭条件：冻结同一相机与影像画质；真实地形缺块时CPU构网/上传有界；需要的16级影像可独立请求并正确覆盖粗网格；接边、日期线、祖先替代、预算、取消与销毁全部通过，新增统计可与N04原始值比较。
