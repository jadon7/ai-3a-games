#!/usr/bin/env python3
"""生成阶段 3 的验收页 docs/hero/3/index.html：游戏里的演示录像、动作预览、动作是怎么来的。

页面里有一个 3D 查看器（tools/hero_viewer.js 内联进去），模型以 base64 文本随页面发布（Artifact 不能直接放 .glb）。
每段动作的说明写在 art/hero/lan/actions.json 里；管线的考试成绩、每段视频的检查结果直接读 video2rig 里的文件。
"""
import base64, json, os, shutil
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
V2R = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
OUT = os.path.join(ROOT, "docs/hero/3")
os.makedirs(os.path.join(OUT, "vid"), exist_ok=True)
A = json.load(open(os.path.join(ROOT, "art/hero/lan/actions.json"), encoding="utf-8"))

# 模型：base64 文本
glb = open(os.path.join(ROOT, "public/assets/hero/lan.glb"), "rb").read()
open(os.path.join(OUT, "lan.glb.txt"), "w").write(base64.b64encode(glb).decode())
# 参考视频
acts = []
for a in A["actions"]:
    src = os.path.join(V2R, "out/seedance", a.get("video", ""))
    item = {"id": a["id"], "label": a["label"], "loop": a.get("loop", False), "note": a.get("note", "")}
    if a.get("video") and os.path.exists(src):
        shutil.copyfile(src, os.path.join(OUT, "vid", a["id"] + ".mp4")); item["video"] = "vid/" + a["id"] + ".mp4"
    acts.append(item)
view = {"model": "lan.glb.txt", "look": A["look"], "actions": acts}

def jload(p):
    try: return json.load(open(p, encoding="utf-8"))
    except Exception: return None
rep = jload(os.path.join(ROOT, "art/hero/lan/motions/report.json")) or {}
exams = [e for e in (jload(os.path.join(V2R, "runs/lan", f"exam_seed{s}.json")) for s in (1, 2)) if e]

src = open(os.path.join(ROOT, "docs/map/2.3/index.html"), encoding="utf-8").read().split("\n")
end = next(i for i, l in enumerate(src) if l.strip() == "</style>")
head = "\n".join(src[:end]).replace("<title>烬与潮 样板间</title>", "<title>烬与潮 岚的动作</title>")
i0 = head.index("/* 布局："); head = head.replace(head[i0:head.index("*/", i0) + 2], "/* 布局：阶段 3 验收。顶部说明 → 游戏里的演示录像 → 3D 动作查看器（左）和参考视频（右）→ 每段动作的表 → 动作是怎么来的 → 给管线补的三件事 → 差距、没验证的、花费 */")
head += """
.viewer{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:16px;align-items:start}
#stage{position:relative;aspect-ratio:4/3;background:#14181d;border:1px solid var(--line);min-width:0;max-width:100%}
#stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab}
#stage-note{position:absolute;left:0;right:0;bottom:14px;margin:0;text-align:center;color:#c8d0da;font-size:13px}
.ctl{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}
.ctl button{font:600 14px/1 var(--body);padding:10px 14px;border:1px solid var(--line);background:var(--surface);color:var(--fg);cursor:pointer;border-radius:0}
.ctl button[aria-pressed="true"]{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.ctl button:focus-visible,.ctl select:focus-visible{outline:2px solid var(--tide);outline-offset:2px}
.ctl label{font-size:13px;color:var(--muted);display:flex;gap:6px;align-items:center}
.ctl select{font:14px var(--body);padding:8px;border:1px solid var(--line);background:var(--surface);color:var(--fg);border-radius:0}
.ctl .gap{flex:1 1 12px}
.side{display:flex;flex-direction:column;gap:12px;min-width:0}
.side h3{margin:0;font:700 15px/1.4 var(--body)}
.side p{margin:0;font-size:14px;color:var(--muted)}
#ref-wrap video{width:100%;display:block;background:#000;border:1px solid var(--line)}
#act-info{color:var(--fg);font-size:14.5px;line-height:1.7}
@media (max-width:860px){.viewer{grid-template-columns:minmax(0,1fr)} #stage{aspect-ratio:1/1}}
.demo video{width:100%;display:block;background:#000;border:1px solid var(--line)}
.keys{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px 24px;margin:16px 0 0;padding:0;list-style:none;font-size:14.5px}
.keys li{display:grid;grid-template-columns:5.6em minmax(0,1fr);gap:0 8px;align-items:baseline}\n.keys b{font:600 13px/1.6 var(--util);letter-spacing:.04em;color:var(--tide)}
html.bare .wrap>*:not(.viewer-sec),html.bare .viewer-sec>*:not(.viewer),html.bare .side,html.bare .ctl{display:none}
html.bare #stage{position:fixed;inset:0;aspect-ratio:auto;border:0;z-index:9}
.row.one{grid-template-columns:minmax(0,1fr)}
.wide img{aspect-ratio:auto}
</style>"""

def fig(img, who, cls, cap):
    return f'<figure class="wide"><img src="img/{img}" alt="{cap}" loading="lazy"><figcaption><span class="who {cls}">{who}</span>{cap}</figcaption></figure>'

rows = ""
for a in A["actions"]:
    r = rep.get(a["id"], {})
    rows += f'<tr><td><b>{a["label"]}</b></td><td>{a.get("use", "")}</td><td class="n">{r.get("成品", "").split("（")[-1].rstrip("）") if r else ""}</td><td>{a.get("how", "")}</td><td>{a.get("issue", "")}</td></tr>\n'
exam_rows = "".join(f'<tr><td>考试 {i + 1}（一段随机运动，渲染成视频再读回来）</td><td class="n">{e["detect_px_mean"]:.1f} 像素</td><td class="n">{e["joint_err_pct_mean"]:.2f}% 身高</td><td class="n">{e["bone_dir_deg_mean"]:.1f}°</td><td>{"通过" if e["passed"] else "没通过"}</td></tr>' for i, e in enumerate(exams))
figs = "".join(f'<div class="row one">{fig(f["img"], f.get("who", "现在"), f.get("cls", "ours"), f["cap"])}</div>' for f in A.get("figures", []) if os.path.exists(os.path.join(OUT, "img", f["img"])))
demo = '<video controls muted loop playsinline preload="metadata" src="vid/demo.mp4"></video>' if os.path.exists(os.path.join(OUT, "vid/demo.mp4")) else ""
def row(fs):
    fs = [f for f in fs if os.path.exists(os.path.join(OUT, "img", f["img"]))]
    return f'<div class="row{" one" if len(fs) == 1 else ""}">' + "".join(fig(f["img"], f.get("who", "现在"), f.get("cls", "ours"), f["cap"]) for f in fs) + "</div>" if fs else ""
game_figs = "".join(row(r) for r in A.get("game_figures", []))
def ul(items): return "<ul>" + "".join(f"<li>{x}</li>" for x in items) + "</ul>"

body = f'''
<script type="importmap">{{ "imports": {{ "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js", "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/" }} }}</script>
<div class="wrap">
<header>
  <p class="eyebrow">烬与潮 · 阶段 3 · 第一个英雄</p>
  <h1>岚 · 汐刃<em>能跑能打了</em></h1>
  <p class="lede">{A["lede"]}</p>
</header>

<section class="demo">
  <h2>在地图上</h2>
  <p class="note">{A["demo_note"]}</p>
  {demo}
  <ul class="keys">{"".join(f"<li><b>{k}</b><span>{v}</span></li>" for k, v in A["keys"])}</ul>
  <div style="margin-top:18px;display:flex;flex-direction:column;gap:10px">{game_figs}</div>
</section>

<section class="viewer-sec">
  <h2>动作预览</h2>
  <p class="note">点下面的按钮换动作，拖动画面可以转着看。画面和游戏里是同一套处理。右边是这段动作的来源：一段 AI 生成的双机位视频，管线从里面把每个关节读出来，放回岚自己的骨架上。</p>
  <div class="viewer">
    <div>
      <div id="stage"><canvas id="view"></canvas><p id="stage-note">正在载入模型……</p></div>
      <div class="ctl" id="acts" role="group" aria-label="动作"></div>
      <div class="ctl">
        <button type="button" data-view="close" aria-pressed="true">近看</button>
        <button type="button" data-view="game" aria-pressed="false">游戏镜头</button>
        <button type="button" data-view="side" aria-pressed="false">侧面</button>
        <button type="button" data-view="back" aria-pressed="false">背面</button>
        <span class="gap"></span>
        <label>速度 <select id="speed"><option value="1">正常</option><option value="0.5">一半</option><option value="0.25">四分之一</option></select></label>
        <label><input type="checkbox" id="repeat" checked> 重复播</label>
        <button type="button" id="pause" aria-pressed="false">暂停</button>
      </div>
    </div>
    <div class="side">
      <h3>这一段</h3>
      <p id="act-info"></p>
      <div id="ref-wrap" hidden>
        <p>来源视频（左半正面，右半侧面）</p>
        <video id="ref" muted loop playsinline preload="metadata"></video>
      </div>
    </div>
  </div>
</section>

<section>
  <h2>每段动作</h2>
  <div class="tbl"><table>
    <thead><tr><th>动作</th><th>游戏里用在哪</th><th class="n">时长</th><th>怎么处理的</th><th>我看出来的问题</th></tr></thead>
    <tbody>
{rows}    </tbody>
  </table></div>
  <div style="margin-top:18px;display:flex;flex-direction:column;gap:10px">{figs}</div>
</section>

<section>
  <h2>动作是怎么来的</h2>
  <div class="how">
    {"".join(f"<section><h3>{h}</h3><p>{p}</p></section>" for h, p in A["how"])}
  </div>
  {'<div class="tbl" style="margin-top:20px"><table class="narrow"><thead><tr><th>检查</th><th class="n">读关节的偏差</th><th class="n">关节位置的偏差</th><th class="n">骨骼朝向的偏差</th><th>结论</th></tr></thead><tbody>' + exam_rows + '</tbody></table></div>' if exam_rows else ''}
</section>

<section>
  <h2>给管线补的三件事</h2>
  <div class="how">
    {"".join(f"<section><h3>{h}</h3><p>{p}</p></section>" for h, p in A["added"])}
  </div>
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
<script>window.HERO_VIEW = {json.dumps(view, ensure_ascii=False)};</script>
<script type="module">
{open(os.path.join(ROOT, "tools/hero_viewer.js"), encoding="utf-8").read()}
</script>
'''
open(os.path.join(OUT, "index.html"), "w", encoding="utf-8").write('<meta charset="utf-8">\n' + head + body)      # 本地直接打开时也能正确显示中文
print("写好了", len(head + body), "模型", round(len(glb) / 1e6, 2), "MB", "视频", [a["id"] for a in acts if a.get("video")])
