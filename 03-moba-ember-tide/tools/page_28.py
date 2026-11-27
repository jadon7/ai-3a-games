#!/usr/bin/env python3
"""生成 2.8 的验收页 docs/map/2.8/index.html。"""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, "docs/map/2.3/index.html"), encoding="utf-8").read().split("\n")
end = next(i for i, l in enumerate(src) if l.strip() == "</style>")
head = "\n".join(src[:end]).replace("<title>烬与潮 样板间</title>", "<title>烬与潮 地图收尾</title>")
i0 = head.index("/* 布局："); head = head.replace(head[i0:head.index("*/", i0) + 2], "/* 布局：2.8 验收。顶部说明 → 旗和火盆 → 水面 → 发光预算 → 帧率 → 巡检 → 整个阶段 2 留下的问题 → 没验证的、花费 */")
head += "\n.row.one{grid-template-columns:minmax(0,1fr)}\n.wide img{aspect-ratio:auto}\n</style>"
def fig(img, who, cls, cap, extra=' class="wide"'):
    return f'<figure{extra}><img src="img/{img}" alt="{cap}" loading="lazy"><figcaption><span class="who {cls}">{who}</span>{cap}</figcaption></figure>'
body = f'''
<div class="wrap">
<header>
  <p class="eyebrow">烬与潮 · 阶段 2.8 · 水面、光影和收尾</p>
  <h1>旗和火盆加上了，地图<em>收尾</em></h1>
  <p class="lede">先做了你要的旗帜和火盆，然后是 2.8 的收尾：粼光铺到了所有水面，查了一遍发光的东西，把绘制次数降下来，全图巡检了十二个位置并修了查出来的两处问题。这是地图阶段的最后一关。手机只在电脑上模拟了屏幕尺寸，没有上真机。</p>
</header>

<section>
  <h2>全图</h2>
  <div class="row">
    {fig("top.jpg", "现在", "ours", "正俯视")}
    {fig("persp.jpg", "现在", "ours", "斜看全图")}
  </div>
</section>

<section>
  <h2>旗帜和火盆</h2>
  <p class="note">六个口子，每个口子两面旗、两个火盆。旗立在两根门墩的顶上，随风轻轻摆；火盆坐在台阶底下两侧护墙的方墩上。</p>
  <div class="how">
    <section><h3>我方</h3><p>深青底、金边、一弯新月的燕尾旗。火盆是青铜盆里几颗小晶体，是灯不是火（发光只用阵营色，我方是青色）。</p></section>
    <section><h3>对方</h3><p>暗红底、铁边、一团火的燕尾旗。火盆是铁盆里一堆余烬加一小簇火苗，火苗会忽大忽小。</p></section>
    <section><h3>发光</h3><p>只有盆里那一点亮，外面一圈很小的光晕，没有加照亮周围的灯。</p></section>
  </div>
  <div class="row" style="margin-top:18px">
    {fig("c_gate.jpg", "设计稿", "", "2.2 定的高地口子：门墩旁有一面旗")}
    {fig("gate_me.jpg", "现在", "ours", "我方中路口子，从外面正对着看")}
  </div>
  <div class="row">
    {fig("gate_foe.jpg", "现在", "ours", "对方中路口子，游戏镜头")}
    {fig("gate_side.jpg", "现在", "ours", "我方下路口子，游戏镜头")}
  </div>
</section>

<section>
  <h2>粼光铺到所有水面</h2>
  <p class="note">你最早说过河面上细碎的反光好，希望更多水面有。河道和两个 Boss 潭本来就是这一套；这一关把出生点的水池、流下台阶的水道、水晶脚下那圈水槽也换成了同一套。对方那边是余烬槽，不是水，没有粼光。</p>
  <div class="row">
    {fig("pool.jpg", "现在", "ours", "我方出生点的水池和水道")}
    {fig("ring.jpg", "现在", "ours", "我方水晶脚下的一圈水槽")}
  </div>
  <div class="row">
    {fig("river.jpg", "现在", "ours", "中路过河")}
    {fig("boss.jpg", "现在", "ours", "Boss 潭")}
  </div>
</section>

<section>
  <h2>发光预算</h2>
  <p class="note">你说过光污染严重。现在整张图会发光的东西只有下面这些，都只用阵营色（我方青、对方橙红），没有全屏的辉光。</p>
  <div class="tbl"><table class="narrow">
    <thead><tr><th>发光的东西</th><th class="n">数量</th><th>怎么亮</th></tr></thead>
    <tbody>
      <tr><td>防御塔顶的晶体和塔身缝里的芯</td><td class="n">18 座</td><td>晶体自己亮，外面一个小光晕</td></tr>
      <tr><td>水晶，和它四角的小灯柱</td><td class="n">2 座</td><td>同上，光晕大一号</td></tr>
      <tr><td>出生点（我方是拱门上的晶体，对方是火盆坑）</td><td class="n">2 处</td><td>一小块</td></tr>
      <tr><td>口子上的火盆</td><td class="n">12 个</td><td>盆里一点亮，对方有火苗</td></tr>
      <tr><td>真正照亮周围的灯</td><td class="n">4 盏</td><td>每一帧分给离镜头最近的四处，其余不照亮周围</td></tr>
    </tbody>
  </table></div>
  <p class="note" style="margin-top:14px">地面、植物、墙、杂物都不发光。水面的粼光是反光，不是发光。</p>
</section>

<section>
  <h2>帧率和绘制次数</h2>
  <div class="tbl"><table class="narrow">
    <thead><tr><th>看哪里</th><th class="n">三角形</th><th class="n">绘制次数</th><th class="n">帧率</th></tr></thead>
    <tbody>
      <tr><td>游戏镜头，十五个位置</td><td class="n">29 万到 58 万</td><td class="n">39 到 70</td><td class="n">60</td></tr>
      <tr><td>我方基地全景</td><td class="n">89 万</td><td class="n">132（原来 204）</td><td class="n">60</td></tr>
      <tr><td>斜看全图</td><td class="n">232 万</td><td class="n">538（原来 881）</td><td class="n">60</td></tr>
      <tr><td>手机尺寸（电脑上模拟），竖屏 375×812 和横屏 812×375</td><td class="n">34 万到 69 万</td><td class="n">43 到 83</td><td class="n">60</td></tr>
    </tbody>
  </table></div>
  <p class="note" style="margin-top:14px">前三行是在这台电脑上用不显示窗口的浏览器量的，画面 1280×720。个别截图的那一瞬间读到过 54 到 59，停稳三秒再读都是 60。</p>
  <div class="how" style="margin-top:20px">
    <section><h3>做了什么</h3><ul>
      <li>每件建筑原来是几十个小网格，现在不转的部分按材质并成几个，全图的绘制次数少了四成。</li>
      <li>给水面算水深的那张图换了一种存法：原来的存法在不少手机上不能用。</li>
      <li>触屏可以两指捏合缩放。</li>
      <li>页面一打开先显示“正在搭地图”，不再是一两秒的黑屏。</li>
    </ul></section>
    <section><h3>手机</h3><p>下图是把窗口缩成手机横屏大小截的。能正常显示，60 帧，但这是电脑的显卡在跑，不代表真手机的帧率。真机没有测。</p>{fig("phone.jpg", "模拟", "old", "手机横屏尺寸（812×375）", "")}</section>
  </div>
</section>

<section>
  <h2>全图巡检</h2>
  <p class="note">用游戏镜头在十二个位置各看了一遍：三条路的塔位、河道两头、两个 Boss 潭、两方野区。查出两处问题，都修了。</p>
  <div class="row">
    {fig("bot.jpg", "修好后", "ours", "下路贴着南墙：原来墙外的树会伸进画面底部挡住路。镜头是朝北看的，所以南墙外不再种贴墙的树，山石也压矮了")}
    {fig("corner.jpg", "修好后", "ours", "河道尽头的蹲伏草丛：原来两方的草在河道中线上混在一起，红里夹绿。现在各长各的一侧")}
  </div>
</section>

<section>
  <h2>整个地图阶段留下的问题</h2>
  <p class="note">这是地图的最后一关，把 2.3 到 2.7 各关我自己列过、到现在还没解决的问题汇总在这里。</p>
  <div class="cols">
    <section>
      <h3>画面上的</h3>
      <ul>
        <li>对方的三档塔不够厚重，对方水晶的铁爪偏瘦。</li>
        <li>晶体是纯色的切面体，没有内部的层次。</li>
        <li>城墙外的树是圆鼓鼓的叶团，比设计稿简单。</li>
        <li>地面的清晰度比样板间低一档；野区的土路是染的，不是画的。</li>
        <li>地图里没有大块的树影。</li>
        <li>广场上的徽记铺地没做；石头脚下的蕨和小花没做。</li>
        <li>没有昼夜。</li>
      </ul>
    </section>
    <section>
      <h3>要等后面阶段的</h3>
      <ul>
        <li>挡路的范围：台阶两侧的护墙、塔的台基、水晶的灯柱、出生点的石像、倒木和树桩，都没有和布局逐个核对。阶段 4 做寻路前要同步。</li>
        <li>没有英雄和小兵：台阶怎么走、草丛能不能藏人、对方深色广场上角色看不看得清，都要到阶段 3 才能验证。</li>
        <li>旧的两版地图代码（<code>src/world/</code>）还在项目里，没有删。</li>
      </ul>
    </section>
    <section>
      <h3>没验证的，和花费</h3>
      <ul>
        <li>真手机没有测，只模拟了屏幕尺寸。</li>
        <li>快速拖动镜头时，近处的地面细图来不来得及加载，没有测。</li>
        <li>内存占用没有量。</li>
        <li>真实浏览器只在较小的面板里测过（1320×628，60 帧）。</li>
        <li>这一关没有用即梦、Tripo、Codex。</li>
        <li>代码没有提交（项目不是 git 仓库）。</li>
      </ul>
    </section>
  </div>
</section>

<footer class="foot">打开方式：开发服务器起着的时候访问 <code>localhost:5183/map.html</code>。拖动或 WASD 平移，滚轮（触屏用两指）缩放，Q / E 转镜头。</footer>
</div>
'''
open(os.path.join(ROOT, "docs/map/2.8/index.html"), "w", encoding="utf-8").write(head + body)
print("写好了", len(head + body))
