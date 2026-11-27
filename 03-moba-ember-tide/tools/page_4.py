#!/usr/bin/env python3
"""生成阶段 4 的验收页 docs/match/4/index.html：对局循环（兵线、塔、水晶、补刀、死亡复活、迷雾、小地图、胜负）。
文字和要放哪些图、哪些录像写在 art/match/page.json 里；图片在 docs/match/4/img/，录像在 docs/match/4/vid/。
"""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs/match/4")
A = json.load(open(os.path.join(ROOT, "art/match/page.json"), encoding="utf-8"))
src = open(os.path.join(ROOT, "docs/map/2.3/index.html"), encoding="utf-8").read().split("\n")
end = next(i for i, l in enumerate(src) if l.strip() == "</style>")
head = "\n".join(src[:end]).replace("<title>烬与潮 样板间</title>", "<title>烬与潮 对局循环</title>")
i0 = head.index("/* 布局："); head = head.replace(head[i0:head.index("*/", i0) + 2], "/* 布局：阶段 4 验收。顶部说明 → 四段录像 → 规则表 → 一局的节奏 → 各个环节的截图 → 怎么做的、验证了什么 → 差距、没验证的、花费 */")
head += """
.row.one{grid-template-columns:minmax(0,1fr)}
.wide img{aspect-ratio:auto}
.clip{display:flex;flex-direction:column;gap:6px;min-width:0}
.clip video{width:100%;display:block;background:#000;border:1px solid var(--line)}
.clip p{margin:0;font-size:13.5px;color:var(--muted)}
.keys{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px 24px;margin:16px 0 0;padding:0;list-style:none;font-size:14.5px}
.keys li{display:grid;grid-template-columns:5.6em minmax(0,1fr);gap:0 8px;align-items:baseline}
.keys b{font:600 13px/1.6 var(--util);letter-spacing:.04em;color:var(--tide)}
</style>"""
have = lambda p: os.path.exists(os.path.join(OUT, p))
def fig(f):
    return f'<figure class="wide"><img src="img/{f["img"]}" alt="{f["cap"]}" loading="lazy"><figcaption><span class="who {f.get("cls", "ours")}">{f.get("who", "现在")}</span>{f["cap"]}</figcaption></figure>'
def row(fs):
    fs = [f for f in fs if have("img/" + f["img"])]
    return f'<div class="row{" one" if len(fs) == 1 else ""}">' + "".join(fig(f) for f in fs) + "</div>" if fs else ""
def clip(c): return f'<div class="clip"><video controls muted loop playsinline preload="metadata" src="vid/{c["src"]}"></video><p>{c["cap"]}</p></div>' if have("vid/" + c["src"]) else ""
def ul(items): return "<ul>" + "".join(f"<li>{x}</li>" for x in items) + "</ul>"
def table(t): return '<div class="tbl"><table' + (' class="narrow"' if t.get("narrow") else "") + '><thead><tr>' + "".join(f'<th{" class=n" if h.startswith("#") else ""}>{h.lstrip("#")}</th>' for h in t["head"]) + "</tr></thead><tbody>" + "".join("<tr>" + "".join(f'<td{" class=n" if t["head"][i].startswith("#") else ""}>{c}</td>' for i, c in enumerate(r)) + "</tr>" for r in t["rows"]) + "</tbody></table></div>"

body = f'''
<div class="wrap">
<header>
  <p class="eyebrow">烬与潮 · 阶段 4 · 对局循环</p>
  <h1>一局<em>能打完了</em></h1>
  <p class="lede">{A["lede"]}</p>
</header>

<section>
  <h2>录像</h2>
  <p class="note">{A["clips_note"]}</p>
  <div class="row{" one" if sum(1 for c in A["clips"] if have("vid/" + c["src"])) == 1 else ""}">{"".join(clip(c) for c in A["clips"])}</div>
  <ul class="keys">{"".join(f"<li><b>{k}</b><span>{v}</span></li>" for k, v in A["keys"])}</ul>
</section>

<section>
  <h2>规则</h2>
  <p class="note">{A["rules_note"]}</p>
  {table(A["rules"])}
</section>

<section>
  <h2>一局的节奏</h2>
  <p class="note">{A["run_note"]}</p>
  {table(A["run"])}
</section>

<section>
  <h2>各个环节</h2>
  <div style="display:flex;flex-direction:column;gap:10px">{"".join(row(r) for r in A["figures"])}</div>
</section>

<section>
  <h2>怎么做的、验证了什么</h2>
  <div class="how">{"".join(f"<section><h3>{h}</h3><p>{p}</p></section>" for h, p in A["how"])}</div>
  <div style="margin-top:18px;display:flex;flex-direction:column;gap:10px">{"".join(row(r) for r in A.get("unit_figures", []))}</div>
</section>

<section>
  <h2>差距、没验证的、花费</h2>
  <div class="cols">
    <section><h3>我自己看出来的差距</h3>{ul(A["gaps"])}</section>
    <section><h3>没验证的</h3>{ul(A["unverified"])}</section>
    <section><h3>花费</h3>{ul(A["cost"])}</section>
  </div>
</section>

<footer class="foot">{A["foot"]}</footer>
</div>
'''
os.makedirs(OUT, exist_ok=True)
open(os.path.join(OUT, "index.html"), "w", encoding="utf-8").write('<meta charset="utf-8">\n' + head + body)
print("写好了", len(head + body))
