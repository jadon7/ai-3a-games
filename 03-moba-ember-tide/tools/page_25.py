#!/usr/bin/env python3
"""生成 2.5 的验收页 docs/map/2.5/index.html。Codex 那一节的内容从 docs/map/2.5/codex_section.html 读（没有就写“还在跑”）。"""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, "docs/map/2.3/index.html"), encoding="utf-8").read().split("\n")
end = next(i for i, l in enumerate(src) if l.strip() == "</style>")
head = "\n".join(src[:end]).replace("<title>烬与潮 样板间</title>", "<title>烬与潮 全图地表</title>")
i0 = head.index("/* 布局："); head = head.replace(head[i0:head.index("*/", i0) + 2], "/* 布局：2.5 验收。顶部说明 → 全图前后 → 对着样板间和设计稿 → 各处 → 近看的小细节 → 怎么画的 → 规矩对照 → Codex xhigh → 还差在哪、没验证的、花费 */")
head += "\n.row.one{grid-template-columns:minmax(0,1fr)}\n.wide img{aspect-ratio:auto}\n</style>"

def fig(img, who, cls, cap, extra=""):
    return f'<figure{extra}><img src="img/{img}" alt="{cap}" loading="lazy"><figcaption><span class="who {cls}">{who}</span>{cap}</figcaption></figure>'

cx = os.path.join(ROOT, "docs/map/2.5/codex_section.html")
codex = open(cx, encoding="utf-8").read() if os.path.exists(cx) else '<p class="note">你让我把 Codex 的推理强度换成 xhigh 再跑一次。同一份任务说明、同一张设计图，只改了推理强度。写这一页的时候它还在跑，跑完我把对比补在这里。</p>'

body = f'''
<div class="wrap">
<header>
  <p class="eyebrow">烬与潮 · 阶段 2.5 · 地表</p>
  <h1>整张图的地面，<em>画完了</em></h1>
  <p class="lede">2.4 里地面是一张平涂的占位图。这一关把整张 156 米的地面按样板间的画法画了出来：地砖、草、土长在一起，两方各一种颜色，基地广场、营地、河床、Boss 的石台都是画的。又加了近看才有的短草和小石子。草丛和树还没有（2.6），塔、水晶、出生点还是白色占位（2.7）。最后一节是 Codex 换成 xhigh 再跑一次的对比。</p>
</header>

<section>
  <h2>全图，前后对比</h2>
  <div class="row">
    {fig("before_persp.jpg", "2.4", "old", "上一关：地面是平涂的布局图", ' class="wide"')}
    {fig("persp.jpg", "现在", "ours", "这一关：整张地面都是手绘的", ' class="wide"')}
  </div>
  <div class="row">
    {fig("before_top.jpg", "2.4", "old", "上一关，正俯视", ' class="wide"')}
    {fig("top.jpg", "现在", "ours", "这一关，正俯视。九个区拼起来，俯视看不到接缝", ' class="wide"')}
  </div>
</section>

<section>
  <h2>先对一遍已经验收的样板间</h2>
  <p class="note">整张图是重新画的，没有把样板间那一块贴进来，所以同一个位置要和样板间比一比。第一遍画出来比样板间亮、偏绿，塔脚那圈石板盖的苔也太多。我量了样板间同一位置的颜色，把我方一侧整体对齐过去，又把“布局上是干净石板”的地方的苔色收掉一部分。现在是一家的，但不是同一张画：石板的排法不一样，石板面比样板间略暗。</p>
  <div class="row three">
    {fig("c_me.jpg", "设计稿", "", "2.2 定的我方环境")}
    {fig("slice_main.jpg", "样板间", "old", "2.3 验收的那一块（有塔和草丛）")}
    {fig("mid.jpg", "现在", "ours", "全图里的同一个位置（塔是占位，草丛还没有）")}
  </div>
</section>

<section>
  <h2>各处</h2>
  <div class="pairs">
    <div class="pair">
      <h3>基地广场</h3>
      <p>围着水晶一圈圈铺开的弧形大石板，每隔几圈嵌一圈颜色不同的：我方是浅灰白石嵌青灰，对方是深灰玄武岩嵌赤陶。颜色是照出生点设计稿量的。设计稿里的水槽、徽记是 2.7 的建筑，这里只铺了石板。</p>
      <div class="row">
        {fig("c_plaza_me.jpg", "设计稿", "", "我方出生点设计稿里的广场")}
        {fig("base.jpg", "现在", "ours", "我方广场，游戏镜头")}
      </div>
      <div class="row">
        {fig("c_plaza_foe.jpg", "设计稿", "", "对方出生点设计稿里的广场")}
        {fig("foe_base.jpg", "现在", "ours", "对方广场，游戏镜头")}
      </div>
    </div>
    <div class="pair">
      <h3>对方一侧的地面</h3>
      <p>样板间只带到对方的一个角，这是对方地面第一次完整出现：赭红的干土、暗红褐的枯草、偏暖的石板，缝里是土不是草。</p>
      <div class="row">
        {fig("c_foe.jpg", "设计稿", "", "2.2 定的对方环境")}
        {fig("foe_lane.jpg", "现在", "ours", "对方中路外塔，游戏镜头")}
      </div>
    </div>
    <div class="pair">
      <h3>河道</h3>
      <p>河床是画的大扁石，水下的颜色和晃动沿用样板间。中路过河的地方，石板沉在水下照样铺过去，水面连续。Boss 的石台是一整块带裂纹和青苔的岩石。</p>
      <div class="row three">
        {fig("c_river.jpg", "设计稿", "", "2.2 定的河道")}
        {fig("river.jpg", "现在", "ours", "中路过河，两方的地面隔着河相接")}
        {fig("boss.jpg", "现在", "ours", "Boss 的石台")}
      </div>
    </div>
    <div class="pair">
      <h3>野区和营地</h3>
      <p>营地是画出来的一块踩秃的土，边是虚的。墙脚和营地边上散着小石子。野区踩出来的土路还是用颜色染的，没有单独画。</p>
      <div class="row">
        {fig("camp.jpg", "现在", "ours", "我方增益怪的凹口")}
        {fig("foe_camp.jpg", "现在", "ours", "对方增益怪的凹口")}
      </div>
    </div>
    <div class="pair">
      <h3>口子和边路</h3>
      <div class="row">
        {fig("gate.jpg", "现在", "ours", "我方中路口子：广场的石板接台阶，台阶下面接兵线")}
        {fig("side.jpg", "现在", "ours", "我方上路，靠着城墙")}
      </div>
    </div>
  </div>
</section>

<section>
  <h2>近看才有的小细节</h2>
  <p class="note">你之前说过：远看是整的，近看要有东西；杂物要融进环境里。这一关加了三样，都跟着地面走。</p>
  <div class="row">
    {fig("close.jpg", "现在", "ours", "我方塔脚近看：石板有凹凸，缝里和路边长着短草，零星的小石子")}
    {fig("foe_close.jpg", "现在", "ours", "对方塔脚近看：红褐的枯草、小石子")}
  </div>
  <div class="how" style="margin-top:22px">
    <section><h3>短草</h3><p>按画好的地面来长：画的是草或土的地方才长。石板缝里、路边、广场的缝里密而矮，空地上稀而高。只生成镜头附近的。</p></section>
    <section><h3>小石子</h3><p>只放在墙脚、河岸、路边、营地边上，不撒在空地中间。用的就是墙边大石头那种石头，颜色和地面接近。</p></section>
    <section><h3>石板的凹凸</h3><p>不另存一张图，直接拿画的明暗当高低，斜光下石板面和缝有起伏。草地上几乎不用，不然一地碎影。</p></section>
  </div>
</section>

<section>
  <h2>怎么画的</h2>
  <p class="note">样板间 60 米是一张图一次画出来的。整张地图 156 米，一张不够细，所以分成 3×3 个区，每个区还是 60 米、还是一张，相邻重叠 8 米。</p>
  <div class="row">
    {fig("m_guide.jpg", "布局图", "", "九个区的布局图：程序算出来的，重叠处是同一份", ' class="wide"')}
    {fig("m_paint.jpg", "重绘", "ours", "九个区各画一张。每张约 48 像素/米", ' class="wide"')}
  </div>
  <div class="how" style="margin-top:22px">
    <section><h3>为什么分开画也接得上</h3><ul>
      <li>每个区的输入是同一套程序算出来的布局图，石板、河床、广场的位置在重叠处本来就一样。</li>
      <li>画完把两米半以上的大色块拉回布局图的颜色，各区色调就一致。</li>
      <li>重叠的 8 米里羽化，接的是笔触，不是结构。</li>
    </ul></section>
    <section><h3>游戏里怎么用</h3><ul>
      <li>切成 64 块，每块 25 米、一张 1024 像素的图。只加载镜头附近的十来块，走远了释放。</li>
      <li>另有一张整图的小图一直在：拉远看全图、或者近处的图还没到的时候用它。</li>
      <li>全部地面贴图约 11MB。</li>
    </ul></section>
    <section><h3>接缝在哪</h3><p>下面这张的正中，就是两个区重叠的地方。</p>{fig("seam.jpg", "现在", "ours", "两个区的重叠处，游戏镜头")}</section>
  </div>
</section>

<section>
  <h2>规矩逐条对照</h2>
  <div class="tbl"><table>
    <thead><tr><th>规矩（2.2 定的）或你的原话</th><th>现在</th><th>情况</th></tr></thead>
    <tbody>
      <tr><td>全图一张地面，草或土是底，石板从底里长出来，边缘碎开</td><td>整张图都是画的；路边的石板半埋在草里或土里</td><td class="st ok">做到</td></tr>
      <tr><td>兵线过河的地方，路沉到浅水下面继续</td><td>中路这样做了；两条边路不过河</td><td class="st ok">做到</td></tr>
      <tr><td>地面上要有近看才有的小细节，远看是整的</td><td>短草、小石子、石板的凹凸</td><td class="st ok">做到</td></tr>
      <tr><td>杂物和地面同色系，只放在墙脚、路边、建筑脚下</td><td>只有小石子一种；枯木、碎石板这类还没有</td><td class="st part">部分</td></tr>
      <tr><td>建筑和地面要有对应关系（塔脚的同心圆、水晶下的放射铺地）</td><td>塔脚的同心圆、广场围着水晶的同心圈都画进了地面；出生点的水槽没有</td><td class="st part">部分，余下在 2.7</td></tr>
      <tr><td>重点位置有一块整的装饰铺地（徽记），只有一块</td><td>没有</td><td class="st miss">留到 2.7</td></tr>
      <tr><td>我方绿、对方红，一眼能分</td><td>隔着河道换色</td><td class="st ok">做到</td></tr>
      <tr><td>地面保持中间调，英雄站上去能看清</td><td>没有英雄，没法验证；对方广场是深灰，可能偏暗</td><td class="st part">没验证</td></tr>
    </tbody>
  </table></div>
</section>

<section>
  <h2>Codex 换成 xhigh 再跑一次</h2>
  {codex}
</section>

<section>
  <h2>还差在哪，没验证的</h2>
  <div class="cols">
    <section>
      <h3>还差的</h3>
      <ul>
        <li>清晰度比样板间低一档：样板间多画过一遍细节，这里是用锐化补的。镜头拉到最近时石板的边偏软。</li>
        <li>对方红土地各个区画的枯草疏密不完全一样，北边那一块更素。</li>
        <li>野区的土路是染出来的，不是画的；墙外的荒地画得简单。</li>
        <li>杂物只有小石子。</li>
        <li>草丛那些位置现在是空的短草地，等 2.6。</li>
        <li>口子的台阶下面没有设计稿里那块半圆的落地石。</li>
      </ul>
    </section>
    <section>
      <h3>没验证的</h3>
      <ul>
        <li>帧率：应用内浏览器实测 60 帧，但当时面板比较小（1320×628）。无界面 Chrome 1600×900 各机位 60 帧，默认镜头约 25 到 50 万三角形。手机没测。</li>
        <li>边走边加载：镜头移到新的地方，近处的图是现加载再淡入的。我没有测过快速拖动时会不会先看到一下模糊的底图。</li>
        <li>内存占用没有量。</li>
        <li>对方的地面你是第一次看到，颜色是我照设计稿定的。</li>
      </ul>
    </section>
    <section>
      <h3>花费</h3>
      <ul>
        <li>即梦 234 积分（九个区各一张，每张 26），余额 15682。</li>
        <li>Tripo 没有用。</li>
        <li>Codex：xhigh 建模一次，仍是按你 Codex 的默认权限（完全访问）跑的。</li>
        <li>代码没有提交（项目不是 git 仓库）。</li>
      </ul>
    </section>
  </div>
</section>

<footer class="foot">打开方式：开发服务器起着的时候访问 <code>localhost:5183/map.html</code>。拖动或 WASD 平移，滚轮缩放，Q / E 转镜头。</footer>
</div>
'''
open(os.path.join(ROOT, "docs/map/2.5/index.html"), "w", encoding="utf-8").write(head + body)
print("写好了", len(head + body))
