#!/usr/bin/env python3
"""生成 2.6 的验收页 docs/map/2.6/index.html。"""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, "docs/map/2.3/index.html"), encoding="utf-8").read().split("\n")
end = next(i for i, l in enumerate(src) if l.strip() == "</style>")
head = "\n".join(src[:end]).replace("<title>烬与潮 样板间</title>", "<title>烬与潮 植被和枯木</title>")
i0 = head.index("/* 布局："); head = head.replace(head[i0:head.index("*/", i0) + 2], "/* 布局：2.6 验收。顶部说明 → 全图前后 → 草丛 → 树 → 枯木 → 水边 → 规矩对照 → 还差在哪、没验证的、花费 */")
head += "\n.row.one{grid-template-columns:minmax(0,1fr)}\n.wide img{aspect-ratio:auto}\n</style>"

def fig(img, who, cls, cap, extra=""):
    return f'<figure{extra}><img src="img/{img}" alt="{cap}" loading="lazy"><figcaption><span class="who {cls}">{who}</span>{cap}</figcaption></figure>'

body = f'''
<div class="wrap">
<header>
  <p class="eyebrow">烬与潮 · 阶段 2.6 · 植被和枯木</p>
  <h1>草丛、树、枯木，<em>长出来了</em></h1>
  <p class="lede">这一关给整张图种上了植被：能藏人的草丛铺到全图 48 块；城墙外面一圈树；墙脚的倒木、营地和河岸边的树桩；岸边的水草和睡莲。规矩没变：看起来能藏人的只有草丛，树只在城墙外面。塔、水晶、出生点还是白色占位（2.7）。这一关没有花积分。</p>
</header>

<section>
  <h2>全图，前后对比</h2>
  <div class="row">
    {fig("before_persp.jpg", "2.5", "old", "上一关：有地面，没有植被", ' class="wide"')}
    {fig("persp.jpg", "现在", "ours", "这一关：草丛、树、枯木、水草都有了", ' class="wide"')}
  </div>
  <div class="row">
    {fig("before_top.jpg", "2.5", "old", "上一关，正俯视", ' class="wide"')}
    {fig("top.jpg", "现在", "ours", "这一关，正俯视：我方的树是绿的夹几棵粉花，对方是红枫夹枯树", ' class="wide"')}
  </div>
</section>

<section>
  <h2>逐项看</h2>
  <div class="pairs">

    <div class="pair">
      <h3>一、草丛</h3>
      <ul>
        <li>长法就是样板间里你验收过的那一套，一行没改，铺到了全图 48 块（每方 24 块，其中 10 块是蹲伏位），一共约 11 万片叶子。</li>
        <li>对方的草丛是第一次完整出现。我照对方野区的设计稿把颜色压深了：根是暗红褐，中段锈红，只有叶尖橙黄。</li>
        <li>布局同步了：画面上草丛是长到墙脚的，现在布局里能藏人的范围也算到墙脚。之前差不到一米。</li>
        <li>和设计稿的差别：设计稿里草丛是贴着弧形墙的外侧绕一圈的；我们的草丛位置是 2.1 灰盒定的，有几块在墙头外面，像一个单独的小岛（下面第二行右图）。要不要挪是布局的事，我没有动。</li>
      </ul>
      <div class="row">
        {fig("c_me.jpg", "设计稿", "", "2.2 定的我方环境：草丛贴着墙")}
        {fig("wall_brush.jpg", "现在", "ours", "中路河道口：草丛一直长到墙脚")}
      </div>
      <div class="row">
        {fig("c_jungle.jpg", "设计稿", "", "2.2 定的我方野区")}
        {fig("camp.jpg", "现在", "ours", "我方增益怪凹口旁，游戏镜头")}
      </div>
      <div class="row three">
        {fig("c_jungle_foe.jpg", "设计稿", "", "2.2 定的对方野区")}
        {fig("foe_camp.jpg", "现在", "ours", "对方增益怪凹口旁")}
        {fig("foe_brush.jpg", "现在", "ours", "对方中路河道口的草丛")}
      </div>
    </div>

    <div class="pair">
      <h3>二、城墙外面的树</h3>
      <ul>
        <li>一圈 139 棵，都在城墙外面，够不着。一棵树是一根树干加几团大叶团，叶团上有一块深一块浅的叶斑，朝光的一面亮、背光的一面暗。</li>
        <li>我方：圆冠的绿树为主，夹着深色的尖冠树和少数开粉花的树。对方：红枫和暗红的树，三成是光秃的枯树。离城墙越远越暗，融进背景。</li>
        <li>北边、西边的树和山石会把影子投进地图里（太阳在左后方）。</li>
        <li>和设计稿的差别很明显：设计稿的树是一层层的叶簇，看得出叶子的形状；我们的是圆鼓鼓的叶团，拉近看像捏出来的。游戏镜头下树在画面边上，问题不大，但这是这一关最弱的一项。</li>
      </ul>
      <div class="row three">
        {fig("c_trees.jpg", "设计稿", "", "设计稿里的树（高地口子那张的左上角）")}
        {fig("trees_me.jpg", "现在", "ours", "我方西边的城墙外，转过镜头看")}
        {fig("trees_foe.jpg", "现在", "ours", "对方北边的城墙外")}
      </div>
      <div class="row">
        {fig("west.jpg", "现在", "ours", "我方上路，游戏镜头：墙后露出树和山石")}
        {fig("north.jpg", "现在", "ours", "对方上路，游戏镜头")}
      </div>
    </div>

    <div class="pair">
      <h3>三、枯木</h3>
      <ul>
        <li>倒木 14 根：贴着野区的墙脚、顺着墙躺着，带一两根断枝，一头是锯口。我方的长苔，对方的焦褐。</li>
        <li>树桩 28 个：在营地外沿、河岸、墙头旁边，离兵线和土路都远。</li>
        <li>都不在路上。它们在布局里不挡路（英雄会从上面走过去），要不要挡等阶段 4 再定。</li>
      </ul>
      <div class="row three">
        {fig("log.jpg", "现在", "ours", "我方墙脚的倒木")}
        {fig("foe_log.jpg", "现在", "ours", "对方墙脚的倒木")}
        {fig("stump.jpg", "现在", "ours", "树桩，旁边是小石子")}
      </div>
    </div>

    <div class="pair">
      <h3>四、水边</h3>
      <ul>
        <li>岸边一丛丛的水草，故意做得矮（一米以内）、稀，一眼看得出藏不了人。水面上有几片睡莲。</li>
        <li>过河的路、河道两头的石阶、Boss 的石台附近不长。</li>
      </ul>
      <div class="row">
        {fig("bank.jpg", "现在", "ours", "河岸近看：水草和睡莲")}
        {fig("boss.jpg", "现在", "ours", "Boss 潭：岸上有草丛、树桩，水里有睡莲")}
      </div>
    </div>

  </div>
</section>

<section>
  <h2>规矩逐条对照</h2>
  <div class="tbl"><table>
    <thead><tr><th>规矩（2.2 定的）或你的原话</th><th>现在</th><th>情况</th></tr></thead>
    <tbody>
      <tr><td>看起来能藏人的植被，就必须真的能藏人。能藏人的只有草丛</td><td>比人高的植被只有草丛；水草在一米以内；布局里草丛的范围和画面一致</td><td class="st ok">做到</td></tr>
      <tr><td>草丛比人高、成丛、形状整，颜色比地面深一档</td><td>沿用样板间验收过的那套</td><td class="st ok">做到</td></tr>
      <tr><td>树只在城墙外面和够不着的地方，大叶团、两个面，不做碎叶</td><td>139 棵都在墙外；是大叶团</td><td class="st ok">做到</td></tr>
      <tr><td>我方植被青绿，对方红褐</td><td>草丛、树、水草、枯木两方各一套颜色</td><td class="st ok">做到</td></tr>
      <tr><td>蕨、小花只在石头和建筑脚下点几处</td><td>墙顶有阔叶草；石头脚下的蕨和小花没做</td><td class="st miss">没做</td></tr>
      <tr><td>有枯木、有显著的阴影（你对比 Dota 时说的）</td><td>枯木有了。影子：墙、山石、草丛的影子清楚；树影只在北边和西边的边路上有一点</td><td class="st part">部分</td></tr>
      <tr><td>和山体、道路要有呼应</td><td>草丛贴墙、倒木贴墙脚、树和山石在墙外交错、水草沿岸</td><td class="st ok">做到</td></tr>
    </tbody>
  </table></div>
</section>

<section>
  <h2>还差在哪，没验证的</h2>
  <div class="cols">
    <section>
      <h3>还差的</h3>
      <ul>
        <li>树太简单：圆鼓鼓的叶团，没有设计稿那种一层层的叶簇。</li>
        <li>地图里面没有大块的树影（规矩不让在里面种树），设计稿里草地上那种大片的树影做不出来。</li>
        <li>有几块草丛像单独的小岛，没有像设计稿那样绕着墙。</li>
        <li>草丛的叶子还是比设计稿散（样板间时就有的差距，这次没动）。</li>
        <li>石头脚下的蕨和小花没做。枯木只有倒木和树桩两种。</li>
      </ul>
    </section>
    <section>
      <h3>没验证的</h3>
      <ul>
        <li>帧率：应用内浏览器默认镜头实测 60 帧，当时面板较小（1320×628），约 56 万三角形。无界面 Chrome 1600×900 各机位 60 帧；拉远看全图 60 帧，约 170 到 190 万三角形。手机没测。</li>
        <li>草丛“能藏人”只是布局数据对上了，没有英雄进去试过。</li>
        <li>树只从城墙里面和上面看过，没有绕到外面逐棵检查。</li>
      </ul>
    </section>
    <section>
      <h3>花费</h3>
      <ul>
        <li>即梦、Tripo、Codex 这一关都没有用。即梦余额还是 15682。</li>
        <li>代码没有提交（项目不是 git 仓库）。</li>
      </ul>
    </section>
  </div>
</section>

<footer class="foot">打开方式：开发服务器起着的时候访问 <code>localhost:5183/map.html</code>。拖动或 WASD 平移，滚轮缩放，Q / E 转镜头。</footer>
</div>
'''
open(os.path.join(ROOT, "docs/map/2.6/index.html"), "w", encoding="utf-8").write(head + body)
print("写好了", len(head + body))
