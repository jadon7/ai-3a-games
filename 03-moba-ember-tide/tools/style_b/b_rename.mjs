// 换画风 B：出品以后给 GLB 的材质改名，让游戏认出这是 B 的卡通厚涂模型（src/map/hero/hero.ts 的 isB 认材质名结尾 /_b(_\d+)?$/，走 HB 那套处理：不用凹凸、软交界、顺光亮边）。
// 为什么要单独一步：人形走 tools/blender/hero_build.py，build.json 写 "body_material": "hero_b" 就行；四足英雄和野怪走 tools/blender/creature_build.py，
// 它把材质一律改名成 hero / heroN，没有这个选项（共用脚本，没改它）。所以四足出品以后跑这一步，再跑 strip_maps.mjs（它也只认 _b 结尾的材质）。
// b-polish 把两份合成了这一份：原来 w-quad 用这里的 b_rename.mjs（hero → hero_b），w-beast 用 art/style_b/beasts/mob_b.mjs（hero → mob_b）。
// 两种名字游戏都认，效果一样（游戏只看 _b 结尾和 weapon 开头，不看前面叫什么）；--as 留着是为了野怪重新出品时名字和现在的文件一样。
// 规则：
//   · 名字以 weapon 开头的（武器，游戏靠它认刀光、出手点）和已经以 _b / _b_N 结尾的，不动
//   · 不给 --as：别的材质一律在名字后面加 _b（hero → hero_b、hero1 → hero1_b、forge → forge_b）
//   · 给 --as <名字>：creature_build 起的 hero / heroN 改成 <名字>_b / <名字>_b_N（野怪用 --as mob：hero → mob_b、hero1 → mob_b_1），别的照上一条加 _b
// 网格、动画、贴图都不动，原地改写。
// 用法: node tools/style_b/b_rename.mjs [--as <名字>] <模型.glb> [更多模型.glb …]
//   四足英雄（art/style_b/quad/rebuild.sh）: node tools/style_b/b_rename.mjs public/assets/hero/kaz.glb
//   野怪（art/style_b/beasts/rebuild.sh）:   node tools/style_b/b_rename.mjs --as mob public/assets/unit/wolf.glb
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
const args = process.argv.slice(2), ai = args.indexOf("--as"), as = ai >= 0 ? args.splice(ai, 2)[1] : "";
if (ai >= 0 && !as) { console.error("--as 后面要跟名字，比如 --as mob"); process.exit(1); }
if (!args.length) { console.error("用法: node tools/style_b/b_rename.mjs [--as <名字>] <模型.glb> [更多 …]"); process.exit(1); }
await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
const rename = n => { if (n.startsWith("weapon") || /_b(_\d+)?$/.test(n)) return null; const k = as && /^hero(\d*)$/.exec(n); return k ? (k[1] ? `${as}_b_${k[1]}` : `${as}_b`) : n + "_b"; };
for (const f of args) {
  const doc = await io.read(f), names = [];
  for (const m of doc.getRoot().listMaterials()) { const n = m.getName(), to = rename(n); if (to === null) continue; m.setName(to); names.push(`${n} → ${to}`); }
  await io.write(f, doc);
  console.log(`${f}: ${names.join("，") || "没有要改的"}`);
}
