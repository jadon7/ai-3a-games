"""把成品里熔炉（材质 forge）的贴图压暗：游戏的着色会提亮、加边缘光，原来的铁色在游戏里像一只铝桶，和设计的黑铁 #2E2A28 差太远。
直接改 GLB 里的图片字节（骨架、网格、动作一个字节都不动，所以不用重跑 rig）：熔炉和火钳本来共用一张铁的贴图，这里给熔炉另加一张压暗的，火钳不变。
用法: PY art/hero/hedda/tone_forge.py <in.glb> <out.glb> [倍率=0.6]"""
import sys, json, struct, io
import numpy as np
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]; k = float(sys.argv[3]) if len(sys.argv) > 3 else 0.6
b = open(src, "rb").read(); jl = struct.unpack("<I", b[12:16])[0]; J = json.loads(b[20:20 + jl]); bo = 20 + jl
bl = struct.unpack("<I", b[bo:bo + 4])[0]; BIN = bytearray(b[bo + 8:bo + 8 + bl])
mat = next(m for m in J["materials"] if m["name"] == "forge"); ti = mat["pbrMetallicRoughness"]["baseColorTexture"]["index"]; tex = J["textures"][ti]
ext = tex.get("extensions", {}).get("EXT_texture_webp"); ii = ext["source"] if ext else tex["source"]; img = J["images"][ii]; bv = J["bufferViews"][img["bufferView"]]
raw = bytes(BIN[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]])
im = Image.open(io.BytesIO(raw)).convert("RGB"); a = np.asarray(im).astype(np.float32) / 255
a = a * k * (1 - 0.25 * a)                                     # 整体压暗，亮的地方（铁箍的磨亮边）压得更多一点
out = io.BytesIO(); Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).save(out, "WEBP", quality=88); data = out.getvalue()
while len(BIN) % 4: BIN.append(0)
J["bufferViews"].append({"buffer": 0, "byteOffset": len(BIN), "byteLength": len(data)}); BIN += data
while len(BIN) % 4: BIN.append(0)
J["buffers"][0]["byteLength"] = len(BIN)
J["images"].append({"name": "hedda_forge_dark", "mimeType": img.get("mimeType", "image/webp"), "bufferView": len(J["bufferViews"]) - 1})
nt = dict(tex); nt["extensions"] = {"EXT_texture_webp": {"source": len(J["images"]) - 1}} if ext else nt.get("extensions"); 
if not ext: nt["source"] = len(J["images"]) - 1
J["textures"].append(nt); mat["pbrMetallicRoughness"]["baseColorTexture"]["index"] = len(J["textures"]) - 1
js = json.dumps(J, separators=(",", ":")).encode(); js += b" " * ((4 - len(js) % 4) % 4)
glb = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(BIN)) + struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(BIN), 0x004E4942) + bytes(BIN)
open(dst, "wb").write(glb); print("TONED forge", im.size, "x", k, "->", dst, round(len(glb) / 1e6, 2), "MB")
