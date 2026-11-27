#!/usr/bin/env python3
"""生成 3.1 的验收页 docs/hero/3.1/index.html。"""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, "docs/map/2.3/index.html"), encoding="utf-8").read().split("\n")
end = next(i for i, l in enumerate(src) if l.strip() == "</style>")
head = "\n".join(src[:end]).replace("<title>烬与潮 样板间</title>", "<title>烬与潮 岚的模型</title>")
i0 = head.index("/* 布局："); head = head.replace(head[i0:head.index("*/", i0) + 2], "/* 布局：3.1 验收。顶部说明 → 设计稿和模型 → 四个角度 → 游戏镜头 → 和 Dota 2 并排 → 怎么做的 → 阶段 3 接下来怎么走 → 差距、没验证的、花费 */")
head += """
.row.one{grid-template-columns:minmax(0,1fr)}
.row.three{grid-template-columns:repeat(3,minmax(0,1fr))}
.row.four{grid-template-columns:repeat(4,minmax(0,1fr))}
@media (max-width:760px){.row.three,.row.four{grid-template-columns:repeat(2,minmax(0,1fr))}}
.wide img{aspect-ratio:auto}
</style>"""
def fig(img, who, cls, cap):
    return f'<figure class="wide"><img src="img/{img}" alt="{cap}" loading="lazy"><figcaption><span class="who {cls}">{who}</span>{cap}</figcaption></figure>'
body = f'''
<div class="wrap">
<header>
  <p class="eyebrow">烬与潮 · 阶段 3.1 · 第一个英雄的模型和造型</p>
  <h1>岚 · 汐刃<em>站进了地图</em></h1>
  <p class="lede">阶段 3 我拆成了三步，这是第一步：只看模型和造型。岚的模型、一对钩刃、骨骼都做好了，摆了一个站姿放进地图，会呼吸，还不会走、不会打。先给你看样子，是因为后面训练动作识别、出动作视频都建在这个模型上，样子要是不对，现在改最便宜。拆分是我自己定的，你没有确认过，不合适可以改。</p>
</header>

<section>
  <h2>设计稿和模型</h2>
  <div class="row">
    {fig("concept.jpg", "设计稿", "", "阶段 1 定的岚 · 汐刃")}
    {fig("front.jpg", "现在", "ours", "游戏里的模型，近看正面。头和手比设计稿放大了一些，原因见下面")}
  </div>
</section>

<section>
  <h2>转一圈</h2>
  <div class="row four">
    {fig("a_q.jpg", "现在", "ours", "斜侧")}
    {fig("a_s.jpg", "现在", "ours", "侧面")}
    {fig("a_b.jpg", "现在", "ours", "背面")}
    {fig("a_top.jpg", "现在", "ours", "从上往下")}
  </div>
</section>

<section>
  <h2>游戏镜头下</h2>
  <p class="note">这是打游戏时的镜头高度。英雄约占屏幕高度的一成。</p>
  <div class="row one">
    {fig("game.jpg", "现在", "ours", "我方中路口子前")}
  </div>
  <p class="note" style="margin-top:18px">换六种地面看她看不看得清。</p>
  <div class="row three">
    {fig("s_pave.jpg", "现在", "ours", "我方的石板")}
    {fig("s_grass.jpg", "现在", "ours", "我方野区的土路")}
    {fig("s_river.jpg", "现在", "ours", "中路过河")}
  </div>
  <div class="row three">
    {fig("s_foe.jpg", "现在", "ours", "对方基地的深色广场")}
    {fig("s_lane.jpg", "现在", "ours", "对方的兵线")}
    {fig("s_brush.jpg", "现在", "ours", "草丛里。现在只是站进去，藏人的逻辑到 3.3 做")}
  </div>
</section>

<section>
  <h2>和 Dota 2 并排</h2>
  <div class="row">
    {fig("dota.jpg", "Dota 2", "", "游戏里的英雄（这张截图的镜头比平时近）")}
    {fig("s_pave.jpg", "现在", "ours", "岚，同样大小的一块画面")}
  </div>
  <div class="cols" style="margin-top:20px">
    <section>
      <h3>我自己看出来的差距</h3>
      <ul>
        <li>Dota 2 的英雄更粗壮、色块更大，一眼是两三块颜色。岚是瘦长的身材，细节多（腰间的网、皮带、挂钩），缩小以后偏碎。</li>
        <li>Dota 2 的英雄比地面亮。岚穿的是深色，身体的明度和地面差不多，靠蓝色和地面的色差、骨白的刀和护甲、青色的纹路来区分。</li>
        <li>贴图是生成的，近看腰间的网和皮带有些糊。</li>
        <li>头冠和设计稿一样高，但在俯视镜头下不够显眼。要不要再拉高，等你看了定。</li>
      </ul>
    </section>
    <section>
      <h3>为了看得清做了什么</h3>
      <ul>
        <li>身高定成 2.7 米（地图比例用的小人是 2 米）。</li>
        <li>头放大 18%，手和刀放大 30%。俯视镜头下头和武器是最先被认出来的。</li>
        <li>深色的衣服提亮了一些；加了一盏只照英雄的补光。</li>
        <li>背光一侧有一道冷色的亮边，把轮廓从地面上托出来。</li>
        <li>青色的纹路自己会亮，没有另外加灯。</li>
      </ul>
    </section>
    <section>
      <h3>队伍怎么分</h3>
      <ul>
        <li>脚下一个细圈、头顶一条血条：我方绿，对方红。</li>
        <li>血条现在只是占位，正式的到阶段 4 做。</li>
      </ul>
    </section>
  </div>
  <div class="row" style="margin-top:18px">
    {fig("t_pave.jpg", "现在", "ours", "在我方")}
    {fig("t_enemy.jpg", "现在", "ours", "同一个模型放到对方")}
  </div>
</section>

<section>
  <h2>怎么做的</h2>
  <div class="row one">
    {fig("rawmodel.jpg", "原始", "old", "图转 3D 直接出来的模型和钩刃")}
  </div>
  <div class="how" style="margin-top:20px">
    <section><h3>模型和骨骼</h3><p>用设计稿直接转成 3D，再自动绑上骨骼（65 根，标准的人形骨架，后面的动作管线可以直接用）。模型约 3.9 万个三角形。</p></section>
    <section><h3>钩刃</h3><p>单独转的 3D。背面多生成了一片贴着的碎块，脚本里按刀身的中线把它切掉了。两把刀挂在左右手的骨骼上，手指握拳、拇指压住。</p></section>
    <section><h3>站姿</h3><p>不是一根一根调骨骼，而是写明“脚踝在哪、手腕在哪、刀指向哪”，由脚本算出各关节的角度。带一个 3.2 秒的呼吸循环，首尾接得上。这只是临时的站姿，正式的待机动作在下一步做。</p></section>
  </div>
</section>

<section>
  <h2>阶段 3 接下来怎么走</h2>
  <div class="tbl"><table class="narrow">
    <thead><tr><th>小阶段</th><th>做什么</th><th>你看什么</th></tr></thead>
    <tbody>
      <tr><td>3.1（这一步）</td><td>模型、钩刃、骨骼、站姿，放进地图</td><td>像不像设计稿，游戏镜头下看不看得清</td></tr>
      <tr><td>3.2 动作</td><td>训练这个角色专用的动作识别（约 1 小时），做待机、跑步、普攻、两个技能、死亡六段动作</td><td>一个动作预览页</td></tr>
      <tr><td>3.3 进游戏</td><td>点地面移动和寻路、动作之间的衔接、木桩、普攻和两个技能</td><td>在地图上跑、打木桩、放技能</td></tr>
    </tbody>
  </table></div>
</section>

<section>
  <h2>没验证的，和花费</h2>
  <div class="cols">
    <section>
      <h3>没验证的</h3>
      <ul>
        <li>只在不显示窗口的浏览器里截图看过（1920×1080，60 帧），没有在你平时用的浏览器窗口里看。</li>
        <li>这个模型还没有过动作管线：训练识别、读回动作准不准，都是 3.2 的事。腰间的网和前后的布片会不会影响识别，现在不知道。</li>
        <li>跑步这类循环动作接不接得顺，计划里一直标着没验证，也要到 3.2。</li>
        <li>手机没有测。</li>
      </ul>
    </section>
    <section>
      <h3>近看的小问题</h3>
      <ul>
        <li>握刀的手指和刀柄有一点穿插。</li>
        <li>站在水里时，小腿以下没有做水花和湿边。</li>
        <li>站姿只有一个，左右手的刀一高一低是写死的。</li>
      </ul>
    </section>
    <section>
      <h3>花费</h3>
      <ul>
        <li>Tripo：模型 40、钩刃 40、绑骨 25，共 105。余额 595。</li>
        <li>按这个价钱，剩下五个英雄连武器约要 525，余量很小；后面的武器我打算自己建或交给 Codex，省下来。</li>
        <li>没有用即梦和 Codex。</li>
        <li>代码没有提交（项目不是 git 仓库）。</li>
      </ul>
    </section>
  </div>
</section>

<footer class="foot">打开方式：开发服务器起着的时候访问 <code>localhost:5183/map.html</code>，岚站在一进来看到的口子前面。滚轮拉近可以看到呼吸。</footer>
</div>
'''
out = os.path.join(ROOT, "docs/hero/3.1/index.html")
open(out, "w", encoding="utf-8").write(head + body); print("写好了", len(head + body))
