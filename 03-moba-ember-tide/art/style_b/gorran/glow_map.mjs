// 葛隆 B（w-gh）：给身体加一张自发光贴图，只让面罩的 T 形缝和胸口炉栅发光。
// 为什么：STYLE.md 身份表里葛隆的阵营色是琥珀橙，发光处是“面罩缝、胸口炉栅、盾栅”。盾栅是脚本建的（weapon_ember_b 自带发光），
// 但面罩和胸口画在 Tripo 的颜色贴图里：hero/hero.ts 只认青色的纹路自己发光（沉月会的），橙色只是贴图里的一块颜色；
// 葛隆的提亮又压到了 1.15（不然钢甲发白），炉栅跟着暗下去，游戏镜头里不像在烧。
// 做法：在颜色贴图里找“又亮又橙”的像素（R > 0.7、R − B > 0.45、G > 0.3），去掉小于 60 像素的连通块（铜铆钉的高光点），
// 稍微外扩、模糊，乘一个饱和的琥珀橙当自发光贴图（512），emissiveFactor 由 rebuild.sh 给（1.6：试过 0.9 白色的看不出、1.0 橙色的看得出但不像在烧）。网格、动作一个字节不动，原地改写 GLB。
// 用法: node art/style_b/gorran/glow_map.mjs <模型.glb> [强度=0.9]
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";
const [file, k = "0.9"] = process.argv.slice(2);
await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
const doc = await io.read(file);
const mat = doc.getRoot().listMaterials().find(m => m.getName() === "hero_b");
if (!mat) throw new Error("没有 hero_b 材质");
const N = 1024, tex = mat.getBaseColorTexture();
const { data } = await sharp(Buffer.from(tex.getImage())).resize(N, N).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const m = new Uint8Array(N * N);
for (let i = 0; i < N * N; i++) { const r = data[i * 3] / 255, g = data[i * 3 + 1] / 255, b = data[i * 3 + 2] / 255; if (r > 0.7 && r - b > 0.45 && g > 0.3) m[i] = 1; }
// 连通块：小于 60 像素的不要（铆钉）
const lab = new Int32Array(N * N); let cur = 0, kept = 0, dropped = 0;
for (let s = 0; s < N * N; s++) {
  if (!m[s] || lab[s]) continue;
  cur++; const st = [s], px = []; lab[s] = cur;
  while (st.length) { const p = st.pop(); px.push(p); const y = (p / N) | 0, x = p % N;
    for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const yy = y + dy, xx = x + dx; if (yy < 0 || yy >= N || xx < 0 || xx >= N) continue; const q = yy * N + xx; if (m[q] && !lab[q]) { lab[q] = cur; st.push(q); } } }
  if (px.length < 60) { for (const p of px) m[p] = 0; dropped++; } else kept++;
}
// 外扩 2 像素（缝的边缘也亮），再模糊一点
const mk = Buffer.alloc(N * N);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let on = 0; for (let dy = -2; dy <= 2 && !on; dy++) for (let dx = -2; dx <= 2; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < N && xx >= 0 && xx < N && m[yy * N + xx]) { on = 1; break; } } mk[y * N + x] = on * 255; }
const { data: soft, info } = await sharp(mk, { raw: { width: N, height: N, channels: 1 } }).blur(1.5).raw().toBuffer({ resolveWithObject: true });
const ch = info.channels, em = Buffer.alloc(N * N * 3), GLOW = [255, 150, 50];      // 发光用一个饱和的琥珀橙（#FF9632），不用贴图本身的颜色：贴图里的炉栅是偏白的浅橙，乘上去加的光也是白的，看不出“在烧”
for (let i = 0; i < N * N; i++) { const a = soft[i * ch] / 255; em[i * 3] = GLOW[0] * a; em[i * 3 + 1] = GLOW[1] * a; em[i * 3 + 2] = GLOW[2] * a; }
const png = await sharp(em, { raw: { width: N, height: N, channels: 3 } }).resize(512, 512).png().toBuffer();
const et = doc.createTexture("gorran_glow_b").setImage(png).setMimeType("image/png");
mat.setEmissiveTexture(et).setEmissiveFactor([+k, +k, +k]);
mat.getEmissiveTextureInfo().setTexCoord(mat.getBaseColorTextureInfo().getTexCoord());
await io.write(file, doc);
console.log(`GLOW ${file}: 发光块 ${kept} 个，去掉的小点 ${dropped} 个，强度 ${k}`);
