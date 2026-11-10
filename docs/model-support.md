# N06-A 精确支持与错误矩阵

N05.1冻结，基线a9582d50；运行时已实现，最终验收与证据身份见progress-report.md。N06-A仅静态unlit，不关闭完整S11。工程粗估仍25%—35%，不按断言增长计进度。

| 输入 | 本轮支持 | 明确拒绝 |
| --- | --- | --- |
| 容器 | glTF2 JSON、GLB2、相对外部bin/PNG/JPEG、data URI、GLB内嵌图像 | glTF1、无效GLB长度/chunk、非PNG/JPEG |
| 几何 | TRIANGLES；索引u8转u16、u16/u32，非索引；POSITION float32 VEC3 | 其他topology、sparse、越界、无效stride/alignment、非有限值 |
| UV | TEXCOORD_0 float32或normalized u8/u16 VEC2 | 其他UV集、非normalized整数 |
| 颜色 | COLOR_0 float32或normalized u8/u16，VEC3/VEC4；缺省白 | 有符号整数、其他格式 |
| 布局 | 无颜色GPU stride20(position+uv)；有颜色stride36(+rgba)；CPU保留输入stride/offset语义并打包 | 未声明的attribute；NORMAL/TANGENT允许合法float但unlit不使用 |
| 节点 | 默认/指定scene，多mesh/node，TRS或matrix，Y-up转ENU Z-up，正/负/非均匀非零scale | skin、morph、animation、循环/多父节点、奇异/透视矩阵 |
| 材质 | 显式KHR_materials_unlit、OPAQUE、baseColorFactor×纹理×COLOR_0；alpha强制1；doubleSided | 默认PBR、MASK/BLEND、其他材质语义 |
| sampler | wrap 33071/10497/33648；min/mag 9728/9729，缺省linear无mip；单mip | 显式9984—9987 mip minFilter；KTX2/Basis |
| 扩展 | KHR_materials_unlit；仅Used未知名称且无实际payload、核心unlit路径完整时可忽略 | 未支持Required；未知payload、压缩、纹理变换等 |

错误包含资产URL和accessor/node/material/texture定位。不支持输入上传前预检；网络/图片/编译失败释放已取得引用，不以纯色替代伪装成功。

资产由scripts/webgpuTest/generateModels.js生成并独立manifest记录。A01外部盒体/A02等价GLB，A03布局/索引，A04四象限/中灰/重复/sampler/alpha0，A05层级缩放，A06共享，A07错误/迟到，A08地球组合。内部RGB容差≤3（JPEG≤5），不取抗锯齿边缘；中灰128×线性factor0.5预期sRGB92。原fixture与四套断言不改。

补充冻结资产：collision16/collision32 拥有完全相同的索引字节，前者两个退化三角形、后者一个实际三角形，用来验证格式/count身份；multi-mesh 验证同场景两个mesh不同材质；bad-decode.png验证真实图片解码失败。地球组合模型使用独立双峰解析heightmap，公式与地理放置固定于Apps/WebGPU/modelWorld.js并纳入source hash。正式采集前冻结所有资产和测试源，调试红绿记录不作为最终三轮。
