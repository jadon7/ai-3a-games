// 换画风 B（b-lan 定的）：卡通厚涂的模型去掉游戏里用不上的法线、粗糙度/金属、AO 贴图，只留颜色贴图。
// 为什么：B 的材质处理（src/map/hero/hero.ts 的 HB）不用凹凸、不用金属和粗糙度贴图（明暗和高光已经画在 Tripo 照卡通设定图出的颜色贴图里），
// 这几张贴图留在文件里只是白白下载。只动材质名以 _b 结尾的（老模型不会被误伤）。网格和动画不动，原地改写。
// 用法: node tools/style_b/strip_maps.mjs <模型.glb> [更多模型.glb …]
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import fs from "node:fs";
await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
for (const f of process.argv.slice(2)) {
  const before = fs.statSync(f).size, doc = await io.read(f); let n = 0;
  for (const m of doc.getRoot().listMaterials()) {
    if (!/_b(_\d+)?$/.test(m.getName())) continue;
    m.setNormalTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null).setMetallicFactor(0).setRoughnessFactor(1); n++;
  }
  await doc.transform(prune({ keepAttributes: true }));
  await io.write(f, doc);
  console.log(`${f}: ${n} 个 B 材质，${(before / 1e6).toFixed(2)} → ${(fs.statSync(f).size / 1e6).toFixed(2)} MB；剩下的贴图 ${doc.getRoot().listTextures().map(t => `${t.getName().slice(0, 10)} ${t.getSize()?.join("×")}`).join("，")}`);
}
