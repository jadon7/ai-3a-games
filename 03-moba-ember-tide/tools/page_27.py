#!/usr/bin/env python3
"""生成 2.7 的验收页 docs/map/2.7/index.html。"""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, "docs/map/2.3/index.html"), encoding="utf-8").read().split("\n")
end = next(i for i, l in enumerate(src) if l.strip() == "</style>")
head = "\n".join(src[:end]).replace("<title>烬与潮 样板间</title>", "<title>烬与潮 关键建筑</title>")
i0 = head.index("/* 布局："); head = head.replace(head[i0:head.index("*/", i0) + 2], "/* 布局：2.7 验收。顶部说明 → 基地前后 → 防御塔 → 水晶 → 出生点 → 怎么做的 → 规矩对照 → 还差在哪、没验证的、花费 */")
head += "\n.row.one{grid-template-columns:minmax(0,1fr)}\n.wide img{aspect-ratio:auto}\n</style>"
def fig(img, who, cls, cap, extra=' class="wide"'):
    return f'<figure{extra}><img src="img/{img}" alt="{cap}" loading="lazy"><figcaption><span class="who {cls}">{who}</span>{cap}</figcaption></figure>'
body = f'''
<div class="wrap">
<header>
  <p class="eyebrow">烬与潮 · 阶段 2.7 · 关键建筑</p>
  <h1>塔、水晶、出生点，<em>换成正式的了</em></h1>
  <p class="lede">地图上的白色占位全部换成了正式的建筑：两方各三档防御塔、一座水晶、一个出生点，一共十件。这一关的做法和前面不一样：形状是 Codex（GPT 6.2 Astra，xhigh）照设计图建的，材质是我们自己的那一套。我方的几件我认为合格；对方的塔和水晶返工过一轮，仍然是整套里最弱的。</p>
</header>

<section>
  <h2>两方的基地</h2>
  <div class="row">
    {fig("me_base.jpg", "现在", "ours", "我方基地：水晶在广场正中，三座高地塔守着三个口子，出生点在左下角")}
    {fig("foe_base.jpg", "现在", "ours", "对方基地")}
  </div>
  <div class="row">
    {fig("before_persp.jpg", "2.6", "old", "上一关：建筑都是白色占位")}
    {fig("persp.jpg", "现在", "ours", "这一关：全图")}
  </div>
</section>

<section>
  <h2>逐项看</h2>
  <div class="pairs">

    <div class="pair">
      <h3>一、我方的三档防御塔</h3>
      <ul>
        <li>三档俯视一眼分得出：外塔最矮，两支高钩；内塔多一圈出檐，檐上嵌一圈小晶体；高地塔最高，四片大新月刃，三级台基。</li>
        <li>石芯是一块块砌的，有雕出来的凹槽和窗洞；青铜肋有厚度、有金边，缝里嵌着发青光的条。</li>
        <li>样板间里那座用代码拼的塔，你说“少点结构感、设计感”。下面第三行是它和新外塔在同一个位置的对比。</li>
      </ul>
      <div class="row">
        {fig("c_tower_me.jpg", "设计稿", "", "2.2 定的三档塔：外塔、内塔、高地塔")}
        {fig("k_tower_me.jpg", "现在", "ours", "三座排在一起（预览页，游戏的光和材质）")}
      </div>
      <div class="row">
        {fig("t1.jpg", "现在", "ours", "我方中路外塔，游戏镜头")}
        {fig("t3.jpg", "现在", "ours", "我方中路口子上的高地塔")}
      </div>
      <div class="row">
        {fig("old_tower.jpg", "2.3", "old", "样板间里用代码拼的外塔")}
        {fig("t1_close.jpg", "现在", "ours", "新的外塔，近看")}
      </div>
    </div>

    <div class="pair">
      <h3>二、对方的三档防御塔</h3>
      <ul>
        <li>玄武岩的塔身一层层往上收，每层一圈铁箍和扶壁；下部有赤陶的拱形饰板；塔顶是铁爪托着余烬晶体。三档靠高度、铁带的圈数和台基的级数区分。</li>
        <li>第一轮交来的太瘦太素、在游戏里发黑，我让它返工了一轮：加粗、加扶壁、放大塔顶。</li>
        <li>返工后好了一些，但和设计图比仍然差一截：设计图是粗壮的、一块块凸出来的堡垒，现在还是偏圆柱。这是整套里最弱的一组。</li>
      </ul>
      <div class="row">
        {fig("c_tower_foe.jpg", "设计稿", "", "2.2 定的对方三档塔")}
        {fig("k_tower_foe.jpg", "现在", "ours", "返工后的三座（预览页）")}
      </div>
      <div class="row three">
        {fig("ft1.jpg", "现在", "ours", "对方中路外塔，游戏镜头", "")}
        {fig("ft1_close.jpg", "现在", "ours", "对方外塔，近看", "")}
        {fig("ft3.jpg", "现在", "ours", "对方中路口子上的高地塔", "")}
      </div>
    </div>

    <div class="pair">
      <h3>三、水晶</h3>
      <ul>
        <li>我方：三级台基、雕花的石茎、八片青铜肋像花苞一样合拢，包着中间的大晶体；周围悬着一圈断开的石环，四根小灯柱。这是十件里最接近设计图的。</li>
        <li>对方：台基、带赤陶饰板的铁座、铁爪合抱着余烬晶体、悬着的铁环、四个火盆柱。第一轮铁爪太厚，把晶体包住了；返工后又偏瘦，晶体显得过大。介于两者之间才对，我没有再让它改第三轮。</li>
        <li>水晶脚下有一圈水槽，通向出生点的台阶（对方是余烬槽）。</li>
        <li>晶体的质感还不够：现在是一块纯色的切面体，没有设计图里从暗到亮的内部层次。这是我的材质的问题。</li>
      </ul>
      <div class="row">
        {fig("c_core_me.jpg", "设计稿", "", "我方水晶（你选的左边方案）")}
        {fig("k_core_me.jpg", "现在", "ours", "我方水晶（预览页）")}
      </div>
      <div class="row">
        {fig("c_core_foe.jpg", "设计稿", "", "对方水晶（你选的左边方案）")}
        {fig("k_core_foe.jpg", "现在", "ours", "对方水晶，返工后（预览页）")}
      </div>
    </div>

    <div class="pair">
      <h3>四、出生点</h3>
      <ul>
        <li>你说过出生点要跟地图深度结合。台子紧贴地图的角，背后没有空地，所以建筑是压在城墙的角上、把那个直角吞进去的。</li>
        <li>我方：背后一座拱门，顶着新月形的青铜冠；两尊持矛的石像；台面正中一个浅水池；水从台子前沿流下台阶。</li>
        <li>对方：铁栅闸门的门楼；两尊披甲的石像；嵌着赤陶饰板的靠背墙；台面正中一个火盆坑。</li>
        <li>和设计图的差别：设计图里出生点背靠的是一道弧形的高墙，我们是直角的城墙；石像做的是概括的大形，没有设计图那么细；从台子流下来的水道是一条平的色带，比较粗糙。</li>
      </ul>
      <div class="row">
        {fig("c_spawn_me.jpg", "设计稿", "", "我方出生点（方案一）")}
        {fig("me_spawn.jpg", "现在", "ours", "我方出生点，从广场一侧看")}
      </div>
      <div class="row">
        {fig("c_spawn_foe.jpg", "设计稿", "", "对方出生点（方案一）")}
        {fig("foe_spawn.jpg", "现在", "ours", "对方出生点，从广场一侧看")}
      </div>
    </div>

  </div>
</section>

<section>
  <h2>这一关是怎么做的</h2>
  <div class="how">
    <section><h3>分工</h3><p>形状交给 Codex：六个任务并行（两方的三档塔、水晶、出生点），每个三四十分钟（返工的两个二十多分钟）。材质用我们自己的：模型只带形状和明暗，载入后统一换成墙上那套手绘石材和青铜，所以建筑和周围的墙、地面是一家的。</p></section>
    <section><h3>针对前两轮的坑</h3><ul>
      <li>搭了一个预览页，用的就是游戏的光和材质，要求它用这个页面自查。上一轮青铜在游戏里发黑，就是因为它只看了自己的渲染。</li>
      <li>石头必须一块块分开建：我们的石材贴图上没有画石缝。</li>
      <li>面数写死：塔 4 万、水晶 9 万、出生点 11 万。上一轮一座塔 12.7 万，18 座放不进地图。</li>
    </ul></section>
    <section><h3>我做的部分</h3><ul>
      <li>材质：第一轮回来后，对方的铁黑成一团、晶体发白、水池是一块亮色板，这些都是我的材质的问题，改了几轮。</li>
      <li>接进地图：摆放、晶体转动、水晶脚下的水槽。</li>
      <li>发光预算：真正照亮周围的灯只有四盏，分给离镜头最近的四处；其余只有晶体自己亮。</li>
      <li>验收和返工意见。</li>
    </ul></section>
  </div>
</section>

<section>
  <h2>规矩逐条对照</h2>
  <div class="tbl"><table>
    <thead><tr><th>规矩（2.2 定的）或你的原话</th><th>现在</th><th>情况</th></tr></thead>
    <tbody>
      <tr><td>每个建筑是一个大形加一个发光的重点</td><td>塔和水晶都是：晶体是唯一的亮点</td><td class="st ok">做到</td></tr>
      <tr><td>要有层次：座、身、颈、冠；外壳包着石芯，缝里透出核的颜色</td><td>我方做到；对方的塔层次有了，但不够厚重</td><td class="st part">我方做到，对方部分</td></tr>
      <tr><td>材质不超过三种</td><td>每方石头、金属、点缀色，加晶体</td><td class="st ok">做到</td></tr>
      <tr><td>三档塔是一家的，由矮到高、由简到繁，俯视一眼分得出</td><td>两方都分得出</td><td class="st ok">做到</td></tr>
      <tr><td>水晶比塔隆重得多：约 13 米高，多级台基、托座、悬浮物、四角的小灯柱</td><td>两方都有；高 12.5 到 12.8 米</td><td class="st ok">做到</td></tr>
      <tr><td>出生点背靠地图角上的大型建筑，用台阶、水槽和铺地跟广场连成一体</td><td>建筑、台阶有了；水槽只有一小段加水晶脚下的一圈，没有设计图里那种铺地上的图案</td><td class="st part">部分</td></tr>
      <tr><td>建筑和地面要有对应关系</td><td>塔脚的同心圆、广场围着水晶的同心圈是 2.5 画的，建筑正好落在上面</td><td class="st ok">做到</td></tr>
      <tr><td>发光有预算，只用阵营色，不把周围染一大片</td><td>只有晶体、灯柱、水池或火盆发光；点光四盏</td><td class="st ok">做到</td></tr>
      <tr><td>重要的口子上放旗或火盆</td><td>没有</td><td class="st miss">没做</td></tr>
    </tbody>
  </table></div>
</section>

<section>
  <h2>还差在哪，没验证的</h2>
  <div class="cols">
    <section>
      <h3>还差的</h3>
      <ul>
        <li>对方的三档塔不够像设计图：偏瘦、偏圆，没有那种一块块凸出来的厚重感。</li>
        <li>对方水晶的铁爪偏瘦、晶体过大。</li>
        <li>晶体都是纯色的切面体，没有内部的层次。</li>
        <li>出生点的石像是概括的大形；流下台阶的水道粗糙。</li>
        <li>口子上的旗、广场上的徽记铺地没做。</li>
        <li>我方的建筑比设计图的颜色深一些（石头带苔、青铜偏深）。</li>
      </ul>
    </section>
    <section>
      <h3>没验证的</h3>
      <ul>
        <li>帧率：应用内浏览器看我方基地全景实测 60 帧（面板较小，1320×628，约 99 万三角形）。无界面 Chrome 1600×900 各机位 60 帧。手机没测。</li>
        <li>绘制次数偏多：每件建筑由几十个小网格组成，我方基地全景 204 次，拉远看全图 881 次（约 233 万三角形）。现在仍是 60 帧，但 2.8 应该按材质合并。</li>
        <li>建筑的挡路范围没有核对：塔的台基、水晶的灯柱、出生点的石像，和布局里“走不过去”的范围有没有出入，没有逐个量。</li>
        <li>十个模型我只看了预览页和地图里的几个角度，没有逐个绕一圈检查背面。</li>
      </ul>
    </section>
    <section>
      <h3>花费</h3>
      <ul>
        <li>Codex：八次建模任务（六件加两件返工），每次二十多到四十分钟，都是 xhigh。按你 Codex 的默认权限（完全访问）跑的，各自限定只写自己的文件夹；事后我查过八份日志，没有发现删除、移动文件或结束进程的命令。</li>
        <li>这一关是我按之前的建议直接派给 Codex 的，没有再单独问你。</li>
        <li>即梦、Tripo 没有用。即梦余额还是 15682。</li>
        <li>代码没有提交（项目不是 git 仓库）。</li>
      </ul>
    </section>
  </div>
</section>

<footer class="foot">打开方式：开发服务器起着的时候访问 <code>localhost:5183/map.html</code>。单看一件建筑：<code>localhost:5183/kit.html?model=/assets/kit/core_me.glb&amp;team=0</code>（对方的把 team 改成 1）。模型和建模脚本在项目的 <code>lab/kit/</code>。</footer>
</div>
'''
open(os.path.join(ROOT, "docs/map/2.7/index.html"), "w", encoding="utf-8").write(head + body)
print("写好了", len(head + body))
