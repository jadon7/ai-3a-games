# 宣传片剪辑表（第三版：结尾换成带爆炸的推塔和水晶）。每一行一个镜头：src 素材（docs/trailer/raw 下）、at 入点秒、dur 时长、x 和下一个镜头之间叠化几秒（0 = 硬切）、
# ov 叠层（docs/trailer/raw/cards 下的 png）、dim 压暗、seq 图片序列（英雄立绘卡）。note 是分镜说明。
HERO_D = 1.15
EDL = [
    # —— 起：地图空镜 ——
    dict(src="e_aerial.mp4", at=0.4, dur=3.0, x=0.5, note="大远景：一条河把绿岸（沉月会）和红岸（烬誓庭）分开，镜头匀速转"),
    dict(src="e_tide.mp4", at=0.3, dur=2.4, ov=[dict(png="cap_tide", t0=0.3, fade=0.4)], note="沉月会一侧：青色防御塔、绿草、石墙，镜头匀速横移"),
    dict(src="e_ember.mp4", at=0.3, dur=2.4, x=0.5, ov=[dict(png="cap_ember", t0=0.3, fade=0.4)], note="烬誓庭一侧：橙色防御塔、红草，镜头匀速横移"),
    dict(src="e_river.mp4", at=0.5, dur=3.6, dim=0.7, vig=1, ov=[dict(png="title", t0=0.5, t1=3.3, fade=0.6)], note="标题：压暗的河道低机位，‘烬与潮’淡入"),
    # —— 承：六位英雄 ——
    dict(seq="hero_0_lan", dur=HERO_D, note="岚·汐刃 立绘"),
    dict(seq="hero_1_torg", dur=HERO_D, note="托尔格·沉钟 立绘"),
    dict(seq="hero_2_moko", dur=HERO_D, note="摩珂·引潮人 立绘"),
    dict(seq="hero_3_gorran", dur=HERO_D, note="葛隆·砧卫 立绘"),
    dict(seq="hero_4_vero", dur=HERO_D, note="薇萝·烬弩 立绘"),
    dict(seq="hero_5_osen", dur=HERO_D, note="奥森·烛语者 立绘"),
    # —— 对线、打野 ——
    dict(src="h0.mp4", at=0.6, dur=3.6, note="对线：烬誓庭塔下二打二，击杀慢放"),
    dict(src="j_boar.mp4", at=1.0, dur=2.6, note="打野：葛隆打烬鬃野猪，余烬地+砧撞"),
    # —— 技能特写 ——
    dict(src="s_torg.mp4", at=1.1, dur=1.8, ov=[dict(png="lt_torg", fade=0)], note="托尔格 R 沉没（漩涡）"),
    dict(src="s_lan.mp4", at=1.7, dur=1.6, ov=[dict(png="lt_lan", fade=0)], note="岚 R 涨潮"),
    dict(src="s_gorran.mp4", at=0.9, dur=1.7, ov=[dict(png="lt_gorran", fade=0)], note="葛隆 R 开闸"),
    dict(src="s_moko.mp4", at=0.6, dur=1.8, ov=[dict(png="lt_moko", fade=0)], note="摩珂 R 月潮"),
    dict(src="s_vero2.mp4", at=0.9, dur=1.7, ov=[dict(png="lt_vero", fade=0)], note="薇萝 E 火油罐"),
    dict(src="s_osen.mp4", at=1.0, dur=2.0, ov=[dict(png="lt_osen", fade=0)], note="奥森 R 千烛祷"),
    # —— 转：Boss 和团战 ——
    dict(src="b_beast.mp4", at=2.6, dur=2.8, ov=[dict(png="cap_beast", t0=0.2, fade=0.3)], note="岩甲巨兽在下河道追着奥森"),
    dict(src="h2.mp4", at=37.0, dur=3.2, ov=[dict(png="cap_troll", t0=0.2, fade=0.3)], note="岩石巨魔：上河道 Boss 潭里和两个英雄打"),
    dict(src="h1.mp4", at=139.9, dur=6.6, note="团战：五个英雄在烬誓庭外塔下混战，几个大招叠在一起，击杀慢放"),
    dict(src="h2.mp4", at=97.2, dur=3.2, note="奥森千烛祷落在敌方塔下，击杀"),
    # —— 合：推塔、水晶 ——
    dict(src="t_tower2.mp4", at=0.9, dur=2.6, note="推塔：烬誓庭的塔挨打到倒下炸开（0.6 倍速逐帧录，游戏 2026-11-19 加的拆塔爆炸）"),
    dict(src="h_end9.mp4", at=0.0, dur=4.8, x=0.4, note="水晶爆掉（全片最高点）：烬誓庭水晶碎开，亮光、两圈冲击波、碎晶、往上翻的烟尘、地裂，接着再炸两下（半速逐帧录）"),
    dict(src="m_phone.mp4", at=1.2, dur=3.8, phone=1, ov=[dict(png="cap_mobile", t0=0.4, fade=0.4)], x=0.6, note="手机横屏：触屏布局（摇杆、技能键）的真实对局画面，套手机外框"),
    dict(src="e_aerial.mp4", at=0.2, dur=4.6, dim=0.86, vig=1, ov=[dict(png="end", t0=0.5, fade=0.7)], note="落版：压得很暗的地图大远景（河在中间），标题+副标题"),
]
