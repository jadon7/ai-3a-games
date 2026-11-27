"""Sketchfab 辅助：搜索（生成缩略图拼图）与下载。
用法:
  sf.py search "<query>" [--n 12] [--animated] [--tag out_name] [--maxfaces N] [--sort likes]
  sf.py info <uid>
  sf.py download <uid> <name>      # 下载 glTF 压缩包并解压到 assets/<name>/
"""
import sys, os, json, io, zipfile, argparse, textwrap
import requests
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY = json.load(open(os.path.join(ROOT, "scripts", "keys.json")))["sketchfab"]
H = {"Authorization": f"Token {KEY}"}
API = "https://api.sketchfab.com/v3"


def thumb_url(m, want=640):
    imgs = (m.get("thumbnails") or {}).get("images") or []
    if not imgs:
        return None
    imgs = sorted(imgs, key=lambda i: abs(i.get("width", 0) - want))
    return imgs[0]["url"]


def search(args):
    p = {
        "type": "models", "q": args.query, "downloadable": "true",
        "count": args.n, "sort_by": "-likeCount" if args.sort == "likes" else "-relevance",
    }
    if args.sort == "rel":
        p.pop("sort_by")
    if args.animated:
        p["animated"] = "true"
    if args.maxfaces:
        p["max_face_count"] = args.maxfaces
    if args.minfaces:
        p["min_face_count"] = args.minfaces
    r = requests.get(f"{API}/search", params=p, headers=H, timeout=30)
    r.raise_for_status()
    res = r.json().get("results", [])
    tiles = []
    for i, m in enumerate(res):
        lic = (m.get("license") or {}).get("label", "?")
        print(f"[{i}] {m['uid']} | {m['name'][:60]} | {lic} | faces={m.get('faceCount')} | anim={m.get('animationCount')} | likes={m.get('likeCount')} | by {m['user']['username']}")
        u = thumb_url(m)
        try:
            im = Image.open(io.BytesIO(requests.get(u, timeout=30).content)).convert("RGB")
        except Exception:
            im = Image.new("RGB", (640, 360), (40, 40, 40))
        im = im.resize((480, 270))
        d = ImageDraw.Draw(im)
        d.rectangle([0, 0, 480, 18], fill=(0, 0, 0))
        d.text((4, 3), f"[{i}] {m['name'][:48]} f={m.get('faceCount')} a={m.get('animationCount')}", fill=(255, 255, 0))
        tiles.append(im)
    if tiles:
        cols = 4
        rows = (len(tiles) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * 480, rows * 270), (0, 0, 0))
        for i, t in enumerate(tiles):
            sheet.paste(t, ((i % cols) * 480, (i // cols) * 270))
        out = os.path.join(ROOT, "thumbs", f"{args.tag}.jpg")
        sheet.save(out, quality=82)
        print("SHEET", out)


def info(uid):
    r = requests.get(f"{API}/models/{uid}", headers=H, timeout=30)
    r.raise_for_status()
    m = r.json()
    keep = {k: m.get(k) for k in ("name", "faceCount", "vertexCount", "animationCount", "isDownloadable", "viewerUrl")}
    keep["license"] = (m.get("license") or {}).get("label")
    keep["user"] = m["user"]["username"]
    keep["description"] = (m.get("description") or "")[:400]
    keep["archives"] = {k: {kk: v.get(kk) for kk in ("size", "faceCount", "textureCount", "textureMaxResolution")} for k, v in (m.get("archives") or {}).items() if v}
    print(json.dumps(keep, ensure_ascii=False, indent=1))
    return m


def download(uid, name, fmt="gltf"):
    m = requests.get(f"{API}/models/{uid}", headers=H, timeout=30).json()
    r = requests.get(f"{API}/models/{uid}/download", headers=H, timeout=30)
    if r.status_code != 200:
        print("DOWNLOAD_API_FAIL", r.status_code, r.text[:300])
        return
    d = r.json()
    if fmt not in d:
        fmt = "gltf" if "gltf" in d else list(d.keys())[0]
    url = d[fmt]["url"]
    size = d[fmt].get("size")
    dest = os.path.join(ROOT, "assets", name)
    os.makedirs(dest, exist_ok=False)
    print(f"downloading {m['name']} [{fmt}] size={size} -> {dest}")
    zpath = os.path.join(dest, "_archive.zip")
    with requests.get(url, stream=True, timeout=120) as s:
        s.raise_for_status()
        with open(zpath, "wb") as f:
            for chunk in s.iter_content(1 << 20):
                f.write(chunk)
    if zipfile.is_zipfile(zpath):
        with zipfile.ZipFile(zpath) as z:
            for n in z.namelist():
                # 防止路径穿越
                tgt = os.path.realpath(os.path.join(dest, n))
                if not tgt.startswith(os.path.realpath(dest) + os.sep):
                    print("SKIP unsafe path", n)
                    continue
                z.extract(n, dest)
        os.remove(zpath)
    else:
        os.rename(zpath, os.path.join(dest, f"model.{'glb' if fmt == 'glb' else fmt}"))
    meta = {
        "uid": uid, "name": m["name"], "author": m["user"]["username"],
        "license": (m.get("license") or {}).get("label"), "url": m.get("viewerUrl"),
    }
    json.dump(meta, open(os.path.join(dest, "_credit.json"), "w"), ensure_ascii=False, indent=1)
    for root, _, files in os.walk(dest):
        for fn in files:
            fp = os.path.join(root, fn)
            print("  ", os.path.relpath(fp, dest), os.path.getsize(fp) // 1024, "KB")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd")
    s = sub.add_parser("search")
    s.add_argument("query")
    s.add_argument("--n", type=int, default=12)
    s.add_argument("--animated", action="store_true")
    s.add_argument("--tag", default="search")
    s.add_argument("--maxfaces", type=int, default=0)
    s.add_argument("--minfaces", type=int, default=0)
    s.add_argument("--sort", default="rel")
    i = sub.add_parser("info")
    i.add_argument("uid")
    d = sub.add_parser("download")
    d.add_argument("uid")
    d.add_argument("name")
    d.add_argument("--fmt", default="gltf")
    a = ap.parse_args()
    if a.cmd == "search":
        search(a)
    elif a.cmd == "info":
        info(a.uid)
    elif a.cmd == "download":
        download(a.uid, a.name, a.fmt)
