#!/usr/bin/env python3
"""Sketchfab 小工具：搜索可下载模型、下载缩略图、下载 glb。
用法：
  skfb.py search "<关键词>" [数量] [--thumbs 目录]
  skfb.py info <uid>
  skfb.py get <uid> <输出目录>      # 下载 glb（没有就下 gltf 压缩包）
"""
import json, os, sys, urllib.parse, urllib.request, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY = None
for line in open(os.path.join(ROOT, "keys.env")):
    if line.startswith("SKFB_KEY="):
        KEY = line.strip().split("=", 1)[1]
API = "https://api.sketchfab.com/v3"


def req(url, auth=True):
    r = urllib.request.Request(url, headers={"User-Agent": "curl/8.0"})
    if auth:
        r.add_header("Authorization", f"Token {KEY}")
    with urllib.request.urlopen(r, timeout=60) as f:
        return json.load(f)


def fetch(url, dst):
    r = urllib.request.Request(url, headers={"User-Agent": "curl/8.0"})
    with urllib.request.urlopen(r, timeout=600) as f, open(dst, "wb") as o:
        while True:
            b = f.read(1 << 20)
            if not b:
                break
            o.write(b)


def search(q, n=24, thumbs=None, extra=""):
    url = f"{API}/search?type=models&downloadable=true&count={n}&q={urllib.parse.quote(q)}&sort_by=-likeCount{extra}"
    d = req(url)
    for i, m in enumerate(d.get("results", [])):
        lic = (m.get("license") or {}).get("label", "?")
        arch = m.get("archives", {}) or {}
        glb = (arch.get("glb") or {}).get("size")
        print(f"{i:2d} {m['uid']} | {m['name'][:48]:48s} | {lic[:14]:14s} | faces {m.get('faceCount')} | likes {m.get('likeCount')} | glb {round((glb or 0)/1e6,1)}MB | by {m['user']['username']}")
        if thumbs:
            os.makedirs(thumbs, exist_ok=True)
            ims = sorted(m["thumbnails"]["images"], key=lambda x: abs(x["width"] - 640))
            if ims:
                try:
                    fetch(ims[0]["url"], os.path.join(thumbs, f"{i:02d}_{m['uid']}.jpg"))
                except Exception as e:
                    print("  thumb fail", e)


def info(uid):
    m = req(f"{API}/models/{uid}")
    print(json.dumps({k: m.get(k) for k in ["name", "faceCount", "vertexCount", "animationCount", "isDownloadable", "description"]}, ensure_ascii=False)[:1500])
    print("license:", (m.get("license") or {}).get("label"), "| by", m["user"]["username"], "|", m.get("viewerUrl"))


def get(uid, outdir):
    os.makedirs(outdir, exist_ok=True)
    d = req(f"{API}/models/{uid}/download")
    if "glb" in d:
        dst = os.path.join(outdir, "model.glb")
        fetch(d["glb"]["url"], dst)
    else:
        z = os.path.join(outdir, "model.zip")
        fetch(d["gltf"]["url"], z)
        with zipfile.ZipFile(z) as zf:
            for n in zf.namelist():
                p = os.path.realpath(os.path.join(outdir, n))
                if not p.startswith(os.path.realpath(outdir) + os.sep):
                    raise SystemExit("zip 路径越界: " + n)
            zf.extractall(outdir)
        os.remove(z)
        dst = outdir
    m = req(f"{API}/models/{uid}")
    with open(os.path.join(outdir, "CREDIT.txt"), "w") as f:
        f.write(f"{m['name']} by {m['user']['username']} ({m.get('viewerUrl')}) license: {(m.get('license') or {}).get('label')}\n")
    print("saved", dst, os.listdir(outdir))


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[0] == "search":
        thumbs = None
        if "--thumbs" in a:
            i = a.index("--thumbs"); thumbs = a[i + 1]; del a[i:i + 2]
        search(a[1], int(a[2]) if len(a) > 2 else 24, thumbs)
    elif a[0] == "info":
        info(a[1])
    elif a[0] == "get":
        get(a[1], a[2])
