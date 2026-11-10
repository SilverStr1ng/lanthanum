# N07：静态 PBR 与 S11 剩余门槛

前置：N05 运行时与 N06-A 静态 unlit 子集验收，继续保留旧四套和模型专项。不得将本轮静态 unlit 当作默认 PBR 回退。

- 固定 metallic-roughness 材质资产、光照和同画质控制图；baseColor、metallic/roughness、normal、occlusion、emissive 各自明确颜色空间与资源身份。
- NORMAL/TANGENT 的加载、缺省生成及 normal map 正负手系；非均匀/负缩放与层级剪切下的法线变换。
- MASK 的 cutoff、颜色/深度/ID 一致性；约定 BLEND 的排序、双面和交叠限制。OIT另行登记。
- mip链生成/采样与各filter组合；PNG/JPEG之外的压缩纹理进入S12，不静默降级。
- 补足完整S07六地点/五高度、0.5px及GPU高程精度门槛，再签收依赖它的完整S11；本轮CPU双精度转换与对象ID遮挡不替代该gate。
- 完整N06/S11剩余：PBR材质、normal/tangent、透明语义、完整模型精度与材质对照。动画/skin/morph、Draco/KTX2/实例化及扩展属于S12；3D Tiles遍历、内容与metadata属于S13。
- 影像/地形LOD耦合继续由terrain-imagery-lod.md跟踪。N08正式1080p/30s预热/120s×3性能、长时/多厂商/多OS/浏览器、自动设备恢复继续开放。

进入N07前先登记独立资产manifest、光照/色彩控制值与错误矩阵；每个支持声明对应正例，拒绝与取消路径对应反例，保持与既有证据身份隔离。
