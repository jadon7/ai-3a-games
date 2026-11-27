// 用法: node tools/lite_glb.mjs <输入.glb> <输出.glb> <颜色贴图最大边长> <别的贴图最大边长>
// 把一个模型的贴图缩小（网格和动画不动）。颜色贴图和法线、粗糙度贴图分开给尺寸。tools/pack_assets.sh 用它做手机那一档。
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { textureCompress } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";
const [src, out, c, o] = process.argv.slice(2);
await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
const doc = await io.read(src);
await doc.transform(
  textureCompress({ encoder: sharp, targetFormat: "webp", quality: 82, resize: [+c, +c], slots: /baseColor/i }),
  textureCompress({ encoder: sharp, targetFormat: "webp", quality: 82, resize: [+o, +o], slots: /normal|metallicRoughness|occlusion|emissive/i }),
);
await io.write(out, doc);
console.log(doc.getRoot().listTextures().map(t => `${t.getName().slice(0, 8)} ${t.getSize()?.join("×")} ${Math.round(t.getImage().byteLength / 1024)}KB`).join("，"));
