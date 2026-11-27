"""把影片用的资产整理成网页游戏可直接加载的形式（不经过 Blender 的部分）。
  .venv/bin/python scripts/game_assets.py [room|hdri|fx|vm|gltf <src.gltf> <dst_dir> <max_px>]
"""
import os, sys, json, shutil
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(ROOT, "assets")
G = os.path.join(ROOT, "game", "assets")


def convert_gltf(src_gltf, dst_dir, max_px=2048, max_px_aux=1024, quality=88):
    """复制 glTF，并把贴图缩小、转成 JPEG（带透明通道的保留 PNG）。"""
    sdir = os.path.dirname(src_gltf)
    os.makedirs(os.path.join(dst_dir, "textures"), exist_ok=True)
    g = json.load(open(src_gltf))
    for b in g.get("buffers", []):
        shutil.copyfile(os.path.join(sdir, b["uri"]), os.path.join(dst_dir, os.path.basename(b["uri"])))
        b["uri"] = os.path.basename(b["uri"])
    total = 0
    for im in g.get("images", []):
        p = os.path.join(sdir, im["uri"])
        img = Image.open(p)
        name = os.path.splitext(os.path.basename(p))[0]
        base = "basecolor" in name.lower() or "diffuse" in name.lower()
        lim = max_px if base else max_px_aux
        if max(img.size) > lim:
            s = lim / max(img.size)
            img = img.resize((max(1, int(img.size[0] * s)), max(1, int(img.size[1] * s))), Image.LANCZOS)
        has_alpha = img.mode in ("RGBA", "LA") and np.asarray(img.convert("RGBA"))[..., 3].min() < 250
        if has_alpha:
            out = f"textures/{name}.png"; img.save(os.path.join(dst_dir, out)); im["mimeType"] = "image/png"
        else:
            out = f"textures/{name}.jpg"; img.convert("RGB").save(os.path.join(dst_dir, out), quality=quality); im["mimeType"] = "image/jpeg"
        im["uri"] = out
        total += os.path.getsize(os.path.join(dst_dir, out))
    json.dump(g, open(os.path.join(dst_dir, "scene.gltf"), "w"))
    print(f"gltf -> {dst_dir}: {len(g.get('images', []))} textures, {total / 1e6:.1f} MB")


def room():
    src = os.path.join(A, "env_manufactory"); dst = os.path.join(G, "room")
    os.makedirs(os.path.join(dst, "textures"), exist_ok=True); os.makedirs(os.path.join(dst, "textures4k"), exist_ok=True)
    shutil.copyfile(os.path.join(src, "scene.bin"), os.path.join(dst, "scene.bin"))
    g = json.load(open(os.path.join(src, "scene.gltf")))
    for im in g["images"]:
        p = os.path.join(src, im["uri"]); name = os.path.splitext(os.path.basename(p))[0]
        img = Image.open(p).convert("RGB")
        img.save(os.path.join(dst, "textures", name + ".jpg"), quality=92)
        img.resize((4096, 4096), Image.LANCZOS).save(os.path.join(dst, "textures4k", name + ".jpg"), quality=90)
        im["uri"] = f"textures/{name}.jpg"; im["mimeType"] = "image/jpeg"
    json.dump(g, open(os.path.join(dst, "scene.gltf"), "w"))
    print("room ok", [(f, os.path.getsize(os.path.join(dst, 'textures', f)) // 1024) for f in os.listdir(os.path.join(dst, 'textures'))])


def hdri():
    os.makedirs(os.path.join(G, "hdri"), exist_ok=True)
    shutil.copyfile(os.path.join(A, "hdri", "abandoned_slipway_4k.hdr"), os.path.join(G, "hdri", "exterior_4k.hdr"))
    print("hdri ok")


def fx():
    dst = os.path.join(G, "fx"); os.makedirs(dst, exist_ok=True)
    src = os.path.join(A, "fx")
    def atlas(prefix, n, cols, tile, name):
        rows = (n + cols - 1) // cols
        sheet = Image.new("RGBA", (cols * tile, rows * tile), (0, 0, 0, 0))
        for i in range(n):
            im = Image.open(os.path.join(src, f"{prefix}_{i}.png")).convert("RGBA").resize((tile, tile), Image.LANCZOS)
            sheet.paste(im, ((i % cols) * tile, (i // cols) * tile))
        sheet.save(os.path.join(dst, name)); print(name, sheet.size)
    atlas("puff", 8, 4, 256, "puff_atlas.png")
    atlas("flash_star", 8, 4, 256, "flash_star_atlas.png")
    atlas("flash_side", 4, 4, 256, "flash_side_atlas.png")
    atlas("hole", 4, 4, 128, "hole_atlas.png")
    # 镜头污渍（和影片后期同一张）
    sys.path.insert(0, os.path.join(ROOT, "scripts"))
    import post
    d = (np.clip(post.LENS_DIRT[..., 0], 0, 1) * 255).astype(np.uint8)
    Image.fromarray(d, "L").save(os.path.join(dst, "lens_dirt.png")); print("lens_dirt", d.shape)


def vm():
    convert_gltf(os.path.join(A, "arms_g17", "scene.gltf"), os.path.join(G, "vm"), 2048, 1024)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if cmd in ("room", "all"): room()
    if cmd in ("hdri", "all"): hdri()
    if cmd in ("fx", "all"): fx()
    if cmd in ("vm", "all"): vm()
    if cmd == "gltf": convert_gltf(sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 2048)
