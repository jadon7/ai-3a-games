#!/usr/bin/env python3
"""Poly Haven 下载：phaven.py hdri <id> <res> | tex <id> <res>   → assets/ph/<id>/"""
import json, os, sys, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def get(url):
    r = urllib.request.Request(url, headers={"User-Agent": "curl/8.0"})
    return urllib.request.urlopen(r, timeout=300)
kind, aid, res = sys.argv[1:4]
files = json.load(get(f"https://api.polyhaven.com/files/{aid}"))
out = os.path.join(ROOT, "assets", "ph", aid); os.makedirs(out, exist_ok=True)
todo = []
if kind == "hdri":
    todo.append(files["hdri"][res]["hdr"]["url"])
else:
    print("maps:", list(files.keys()))
    for k in ("Diffuse", "nor_gl", "Rough", "Displacement", "arm"):
        if k in files and res in files[k]:
            fm = files[k][res]
            todo.append((fm.get("jpg") or fm.get("png"))["url"])
for u in todo:
    dst = os.path.join(out, os.path.basename(u))
    if not os.path.exists(dst):
        with get(u) as f, open(dst, "wb") as o:
            o.write(f.read())
    print("ok", dst, os.path.getsize(dst) // 1024, "KB")
