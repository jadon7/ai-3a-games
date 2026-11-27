"""把几个套动作的试验收成一个查看页：拼图、录像、数字表。图和录像拷到输出目录（证据放主目录 docs/ 下，不进 git）。
用法: /opt/homebrew/opt/python@3.14/bin/python3.14 tools/retarget/page.py <输出目录> <开头那段说明.html> <case 目录> [<case 目录> …]
"""
import sys, os, json, shutil, html, glob

out, intro = sys.argv[1], sys.argv[2]; cases = sys.argv[3:]
os.makedirs(out, exist_ok=True)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from table import foot_cells

CSS = """
:root{--bg:#f4f4f2;--fg:#1d2024;--mut:#61666d;--card:#fff;--line:#d9dcdf;--hl:#0c6b5d}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#15181b;--fg:#e8eaec;--mut:#9aa1a8;--card:#1d2125;--line:#30363c;--hl:#5fd0bd}}
body{background:var(--bg);color:var(--fg);font:15px/1.6 "PingFang SC","Hiragino Sans GB",system-ui,sans-serif;margin:0;padding:0 16px 60px}
main{max-width:1400px;margin:0 auto}h1{font-size:26px;margin:28px 0 8px}h2{font-size:20px;margin:36px 0 6px;border-top:1px solid var(--line);padding-top:18px}
h3{font-size:16px;margin:18px 0 6px}.mut{color:var(--mut)}table{border-collapse:collapse;font-size:13px;margin:8px 0;background:var(--card)}
td,th{border:1px solid var(--line);padding:3px 7px;text-align:left;vertical-align:top}th{background:var(--bg)}tr.src td{color:var(--mut)}tr.ik td:nth-child(2){color:var(--hl);font-weight:600}
img,video{max-width:100%;border:1px solid var(--line);background:#888}details{margin:6px 0}summary{cursor:pointer;color:var(--hl)}
.wrap{overflow-x:auto}.card{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:12px 16px;margin:12px 0}
"""
parts = [f"<!doctype html><html lang=zh><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>套动作试验</title><style>{CSS}</style></head><body><main>",
         open(intro, encoding="utf-8").read()]
nav = []
for cd in cases:
    case = json.load(open(os.path.join(cd, "case.json"), encoding="utf-8")); name = case["name"]; od = os.path.join(out, name); os.makedirs(od, exist_ok=True)
    nav.append(f"<a href='#{name}'>{name}</a>")
    labels = case.get("labels", []); variants = list(case.get("variants", {}).keys()); lab_of = dict(zip(["src"] + variants, labels))
    parts.append(f"<h2 id='{name}'>{html.escape(name)}</h2><p>{html.escape(case.get('title', ''))}</p>")
    mj = os.path.join(cd, "measure.json")
    if os.path.exists(mj):
        d = json.load(open(mj, encoding="utf-8")); shutil.copy(mj, os.path.join(od, "measure.json"))
        rr = json.load(open(os.path.join(cd, "motions", "retarget_report.json"), encoding="utf-8")) if os.path.exists(os.path.join(cd, "motions", "retarget_report.json")) else {}
        rows = ["<div class=wrap><table><tr><th>动作</th><th>版本</th><th>脚滑 m/s（中位，p90）</th><th>陷地/飘 cm</th><th>身体最低 cm</th><th>手插进身体 帧%</th><th>出手时刻差（帧）</th><th>出手时手伸出（身高）</th><th>备注</th></tr>"]
        for clip, c in d.items():
            labs = [k for k in c if k not in ("speed", "events")]
            run = any("该填runSpeed" in v for k, v in c[labs[0]].items() if k.startswith("脚:"))
            for lab in labs:
                m = c[lab]; fc = foot_cells(m, run); ev = m.get("出手", {})
                reach = "；".join(f"{v['手伸出']}" for v in ev.values())
                extra = rr.get("clips", {}).get(clip, {}).get(lab, {})
                note = fc["备注"] + "；".join(f"{k} {v}" for k, v in extra.items() if k not in ("k", "接地帧", "跑步贴地速度") and v not in (0, 0.0, -0.0))
                rows.append(f"<tr class='{lab}'><td>{clip}</td><td>{html.escape(lab_of.get(lab, lab))}</td><td>{fc['脚滑 m/s']}</td><td>{fc['陷地/飘 cm']}</td><td>{m.get('身体最低cm', '-')}</td><td>{m.get('手和武器插进身体的帧%', '-')}</td><td>{m.get('出手时刻差(帧)', '') if lab != 'src' else ''}</td><td>{reach}</td><td>{html.escape(note)}</td></tr>")
        rows.append("</table></div>"); parts.append("".join(rows))
    vids = sorted(glob.glob(os.path.join(cd, "video", "*.mp4")))
    if vids:
        parts.append("<h3>录像</h3>")
        for v in vids:
            shutil.copy(v, os.path.join(od, os.path.basename(v))); parts.append(f"<details><summary>{os.path.basename(v)}</summary><video controls loop muted preload=none src='{name}/{os.path.basename(v)}'></video></details>")
    sheets = sorted(glob.glob(os.path.join(cd, "sheets", "*.jpg")))
    if sheets:
        parts.append("<h3>逐段抽帧（每段动作一块：一行一个版本，上面是斜前方、下面是正侧面，左到右是时间）</h3>")
        for s in sheets:
            shutil.copy(s, os.path.join(od, os.path.basename(s))); parts.append(f"<details><summary>{os.path.basename(s)[:-4]}</summary><img loading=lazy src='{name}/{os.path.basename(s)}'></details>")
parts.insert(2, "<p class=mut>跳到：" + " · ".join(nav) + "</p>")
parts.append("</main></body></html>")
open(os.path.join(out, "index.html"), "w", encoding="utf-8").write("\n".join(parts)); print(os.path.join(out, "index.html"))
