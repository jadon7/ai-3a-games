#!/usr/bin/env python3
"""生成阶段 5 的验收页 docs/hero/5/index.html：六个英雄、技能和特效、装备商店，以及上一阶段 8 条意见的处理。
内容写在 art/hero/page5.json 里：一串小节（sections），每节可以有说明、录像、表格、图片、几栏文字。
图片在 docs/hero/5/img/，录像在 docs/hero/5/vid/；文件不存在的图和录像自动跳过。
"""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs/hero/5")
A = json.load(open(os.path.join(ROOT, "art/hero/page5.json"), encoding="utf-8"))
src = open(os.path.join(ROOT, "docs/map/2.3/index.html"), encoding="utf-8").read().split("\n")
end = next(i for i, l in enumerate(src) if l.strip() == "</style>")
head = "\n".join(src[:end]).replace("<title>烬与潮 样板间</title>", "<title>烬与潮 六个英雄</title>")
i0 = head.index("/* 布局："); head = head.replace(head[i0:head.index("*/", i0) + 2], "/* 布局：阶段 5 验收。顶部说明 → 一串小节，每节是说明加录像、表格、图片或几栏文字 */")
head += """
.row.one{grid-template-columns:minmax(0,1fr)}
.row.three{grid-template-columns:repeat(3,minmax(0,1fr))}
@media (max-width:760px){.row.three{grid-template-columns:minmax(0,1fr)}}
.wide img{aspect-ratio:auto}
.clip{display:flex;flex-direction:column;gap:6px;min-width:0}
.clip video{width:100%;display:block;background:#000;border:1px solid var(--line)}
.clip p{margin:0;font-size:13.5px;color:var(--muted)}
.clip b{color:var(--fg);font-weight:600}
.keys{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px 24px;margin:16px 0 0;padding:0;list-style:none;font-size:14.5px}
.keys li{display:grid;grid-template-columns:6.4em minmax(0,1fr);gap:0 8px;align-items:baseline}
.keys b{font:600 13px/1.6 var(--util);letter-spacing:.04em;color:var(--tide)}
.stack{display:flex;flex-direction:column;gap:10px}
</style>"""
have = lambda p: os.path.exists(os.path.join(OUT, p))
def fig(f): return f'<figure class="wide"><img src="img/{f["img"]}" alt="{f["cap"]}" loading="lazy"><figcaption><span class="who {f.get("cls", "ours")}">{f.get("who", "现在")}</span>{f["cap"]}</figcaption></figure>'
def rowf(fs):
    fs = [f for f in fs if have("img/" + f["img"])]
    return f'<div class="row{" one" if len(fs) == 1 else " three" if len(fs) == 3 else ""}">' + "".join(fig(f) for f in fs) + "</div>" if fs else ""
def clip(c): return f'<div class="clip"><video controls muted loop playsinline preload="metadata" src="vid/{c["src"]}"></video><p>{c["cap"]}</p></div>' if have("vid/" + c["src"]) else ""
def clips(cs, cols=2):
    out = [clip(c) for c in cs]; out = [o for o in out if o]
    return f'<div class="row{" one" if len(out) == 1 or cols == 1 else " three" if cols == 3 else ""}">' + "".join(out) + "</div>" if out else ""
def ul(items): return "<ul>" + "".join(f"<li>{x}</li>" for x in items) + "</ul>"
def table(t): return '<div class="tbl"><table' + (' class="narrow"' if t.get("narrow") else "") + '><thead><tr>' + "".join(f'<th{" class=n" if h.startswith("#") else ""}>{h.lstrip("#")}</th>' for h in t["head"]) + "</tr></thead><tbody>" + "".join("<tr>" + "".join(f'<td{" class=n" if t["head"][i].startswith("#") else ""}>{c}</td>' for i, c in enumerate(r)) + "</tr>" for r in t["rows"]) + "</tbody></table></div>"
def section(s):
    h = f'<section>\n  <h2>{s["h2"]}</h2>'
    if s.get("note"): h += f'\n  <p class="note">{s["note"]}</p>'
    if s.get("clips"): h += "\n  " + clips(s["clips"], s.get("clip_cols", 2))
    if s.get("keys"): h += '\n  <ul class="keys">' + "".join(f"<li><b>{k}</b><span>{v}</span></li>" for k, v in s["keys"]) + "</ul>"
    if s.get("table"): h += "\n  " + table(s["table"])
    if s.get("figures"): h += '\n  <div class="stack" style="margin-top:12px">' + "".join(rowf(r) for r in s["figures"]) + "</div>"
    if s.get("how"): h += '\n  <div class="how" style="margin-top:16px">' + "".join(f"<section><h3>{a}</h3><p>{b}</p></section>" for a, b in s["how"]) + "</div>"
    if s.get("cols"): h += '\n  <div class="cols">' + "".join(f"<section><h3>{a}</h3>{ul(b)}</section>" for a, b in s["cols"]) + "</div>"
    return h + "\n</section>"
body = f'''
<div class="wrap">
<header>
  <p class="eyebrow">烬与潮 · 阶段 5 · 英雄批量、技能、装备</p>
  <h1>{A["h1"]}</h1>
  <p class="lede">{A["lede"]}</p>
</header>
{chr(10).join(section(s) for s in A["sections"])}
<footer class="foot">{A["foot"]}</footer>
</div>
'''
os.makedirs(OUT, exist_ok=True)
open(os.path.join(OUT, "index.html"), "w", encoding="utf-8").write('<meta charset="utf-8">\n' + head + body)
print("写好了", len(head + body))
