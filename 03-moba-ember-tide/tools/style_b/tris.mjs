// 用法: node tools/style_b/tris.mjs <a.glb> [b.glb …]  数每个 GLB 的三角形（认 gzip 包着的和 meshopt 压过的）
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import fs from "node:fs";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
try { const { MeshoptDecoder } = await import("meshoptimizer"); await MeshoptDecoder.ready; io.registerDependencies({ "meshopt.decoder": MeshoptDecoder }); } catch {}
for (const f of process.argv.slice(2)) {
  try {
    let buf = fs.readFileSync(f); if (buf[0] === 0x1f && buf[1] === 0x8b) buf = (await import("node:zlib")).gunzipSync(buf);
    const doc = await io.readBinary(new Uint8Array(buf)); let t = 0;
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); t += i ? i.getCount() / 3 : p.getAttribute("POSITION").getCount() / 3; }
    console.log(f.split("/").slice(-2).join("/"), Math.round(t));
  } catch (e) { console.log(f, "读不了", e.message.slice(0, 60)); }
}
