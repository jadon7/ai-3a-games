#!/usr/bin/env python3
"""把 styleboard/template.html 加上数据生成 styleboard/index.html，并把 concepts/ 和 refs/ 里的图缩成网页用的 jpg 放到 styleboard/img/。

用法：python3 tools/build_styleboard.py
"""
import json, os, re, glob
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, "styleboard/img")
os.makedirs(IMG, exist_ok=True)


def web(src, name, maxside=1500, q=84):
    dst = os.path.join(IMG, name + ".jpg")
    if os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
        return
    im = Image.open(src).convert("RGB")
    im.thumbnail((maxside, maxside), Image.LANCZOS)
    im.save(dst, quality=q, optimize=True)


# 概念图
for f in glob.glob(os.path.join(ROOT, "concepts/*/*.png")):
    if "/_raw/" in f:
        continue
    web(f, os.path.splitext(os.path.basename(f))[0])

# 对标清单
md = open(os.path.join(ROOT, "docs/benchmark.md")).read()
refmap, reffile = {}, {}
for m in re.finditer(r"^\| ([THVU]\d+) \| (\S+\.jpg) \| (.+?) \|$", md, re.M):
    refmap[m.group(1)] = m.group(3)
    reffile[m.group(1)] = m.group(2)
for k, f in reffile.items():
    web(os.path.join(ROOT, "refs/dota2", f), "ref-" + k, maxside=1600, q=80)
sections = []
for title, prefix, rp in [("一、地形", "A", "T"), ("二、英雄", "B", "H"), ("三、特效", "C", "V"), ("四、界面", "D", "U")]:
    rows = [list(m.groups()) for m in re.finditer(r"^\| (%s\d+) \| (.+?) \| (.+?) \| (.+?) \|$" % prefix, md, re.M)]
    refs = [{"id": k, "what": v} for k, v in refmap.items() if k.startswith(rp)]
    sections.append({"title": title, "rows": rows, "refs": refs})
bench = {"sections": sections, "refmap": refmap}

heroes = json.load(open(os.path.join(ROOT, "styleboard/heroes.json")))
notes = json.load(open(os.path.join(ROOT, "styleboard/notes.json")))

t = open(os.path.join(ROOT, "styleboard/template.html")).read()
t = t.replace("/*HEROES*/[]", json.dumps(heroes, ensure_ascii=False))
t = t.replace("/*BENCH*/{}", json.dumps(bench, ensure_ascii=False))
t = t.replace("/*NOTES*/[]", json.dumps(notes, ensure_ascii=False))
open(os.path.join(ROOT, "styleboard/index.html"), "w").write(t)
print("rows", [len(s["rows"]) for s in sections], "refs", len(refmap), "imgs", len(os.listdir(IMG)))
