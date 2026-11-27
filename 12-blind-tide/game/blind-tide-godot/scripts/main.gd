extends Node3D
## 盲潮 / Blind Tide — Godot 4 移植，阶段一：可玩的核心循环
## 声音同时是弹药、视野、HUD 信息和敌人的感知媒介。

const WorldData := preload("res://scripts/world.gd")
const Tracer := preload("res://scripts/tracer.gd")
const SonarView := preload("res://scripts/sonar_view.gd")
const Hud := preload("res://scripts/hud.gd")
const Sfx := preload("res://scripts/sfx.gd")
const Intro := preload("res://scripts/intro.gd")
const Creature := preload("res://scripts/creature.gd")

const CS := 3.0
const HT := 3.6
const OBJ := ["[R] 舱门", "心跳", "遗迹", "共鸣", "唱诗井", "[R] 信标", "", "求生舱", ""]
const DETECT_T := 10.0           # 一只潮听者被探测到之后，在 HUD 上保留多久
const GHOST_T := 5.0             # 声呐扫到的潮听者留在原地的残影寿命：它已经走了，残影还在慢慢暗下去
const ST := {"drift": "漂游", "sus": "警觉", "hunt": "猎杀", "attack": "攻击", "stun": "震慑", "roar": "怒吼"}
const ROAR_R := 9.0              # 猎杀中的潮听者离你这么近、中间又没有墙，就会先站定怒吼
const ROAR_T := 1.9              # 一次怒吼持续多久（它这段时间不动）
const ROAR_JAM := 2.2            # 声浪打到你之后，声呐被淹没多久
const BOOT := [
	["[SUIT-AI] 冷启动……", .5, ""], ["自检 …… 生命维持 OK · 结构完整性 71%", .6, ""], ["环境检测 ……", .5, ""],
	["  视觉信息：受屏蔽", .5, "r"], ["  介质：液体环境 · 高铁含量 · 不透光", .6, ""], ["→ 启动声呐可视化模式", 1.6, "c"],
	["生存工具检测 ……", .5, ""], ["  供能线路检测 …… 失败", .6, "r"], ["  降级：电磁供能线路 …… 失败", .6, "r"],
	["  降级：光供能线路 …… 失败", .6, "r"], ["  降级：声波供能线路 …… 成功", .8, "c"], ["武器已上线。", 1.2, "c"],
]


class Player:
	var x := 0.0
	var z := 0.0
	var ey := 1.6
	var yaw := 0.0
	var pitch := 0.0
	var hp := 100.0
	var energy := 45.0
	var heat := 0.0
	var lock := 0.0
	var mode := 1
	var fire_cd := 0.0
	var whisper_cd := 0.0
	var active_cd := 0.0
	var abs_on := false         # 吸收场开着
	var abs_min := 0.0          # 轻点一下也至少开这么久
	var abs_hold := false       # 自检用：等同于一直按着 F
	var mend := 0.0             # 正在修复结构（HUD 提示计时）
	var mend_t := 0.0           # 修复低鸣的节拍
	var mend_hold := false      # 自检用：等同于一直按着 Q
	var expo := 0.0
	var hurt := 0.0
	var jam := 0.0
	var step := 0.0
	var charging := -1.0
	var mic_t := 0.0
	var hit_mark := 0.0
	var covered := ""
	var trace := 0.0
	var abs_flash := 0.0
	var pinged := 0.0
	var roar_fx := 0.0          # 被怒吼淹没的剩余时间


class Enemy:
	var id := 0
	var x := 0.0
	var z := 0.0
	var yaw := 0.0
	var hp := 100.0
	var conf := 0.0             # 对"玩家在哪"的置信度
	var bx := 0.0               # 它认为的声源位置
	var bz := 0.0
	var state := "drift"
	var last_kind := ""
	var ping_t := 0.0
	var wind := 0.0
	var stun := 0.0
	var atk := 0.0
	var struck := false
	var click_t := 0.0
	var marked := -1.0
	var strobe := 0.0           # 被标记期间的频闪节拍
	var roar := 0.0             # 这次怒吼还剩多久
	var roar_n := 0             # 已经涌出去几道声浪
	var roar_cd := 0.0          # 这个时刻之前它不会再吼
	var seen := -99.0           # 玩家最近一次探测到它的时刻
	var has_wander := false
	var wx := 0.0
	var wz := 0.0
	var df := PackedInt32Array()
	var df_t := 0.0
	var df_key := -1
	var dead := false


var world: WorldData
var tracer: Tracer
var sonar: SonarView
var sfx: Sfx
var hud: Hud
var cam: Camera3D
var post: ShaderMaterial
var ui_font: Font

var state := "menu"
var now := 0.0
var events: Array = []
var enemies: Array[Enemy] = []
var decoys: Array = []           # [x, y, z, 到期, 计时]
var arcs: Array = []
var stats := {"shots": 0, "pings": 0, "absorbed": 0, "hits": 0}
var obj := 0
var obj_text := ""
var beacon_t := -1.0
var beacon_p := 0.0
var P := Player.new()
var SPD := 1.0                   # 声速倍率
var RNG := 1.0                   # 回波量程倍率
var EXPO := 1.0                  # 暴露半径倍率
const Q_DEFAULT := 2.0            # 实测 2× 时结构明显更清楚，脉冲延迟约 40 毫秒；F2 面板可调到 4×
var Q := Q_DEFAULT               # 点云密度（射线数量）倍率
var beat := 0.0                 # 血海的心跳相位 0–1
var stage := 0                  # 流程阶段：决定哪些潮听者已经醒来
var sleepers: Array = []        # 还没醒的潮听者 {x, z, st, hint, hx, hz}
var keys_on: Array[bool] = []   # 两块耳石是否醒着
var key_t := 0.0
var door_open := false
var call_t := 0.0               # 返程时求生舱的呼叫节拍
var roar_gap := 0.0             # 这个时刻之前谁都不会吼：免得几只轮流把人吼到一直瞎着
var lore_seen: Array[bool] = []
var crystal_cd := {}
var hatch_open := false
var sonar_on := false
var fog_k := 0.0
var yaw_v := 0.0
var pitch_v := 0.0
var cx := 0.0
var cy := 1.6
var cz := 0.0
var c_yaw := 0.0
var c_pitch := 0.0
var flood := Color(0, 0, 0, 0)

var it := 0.0
var flooded := false
var boot_i := 0
var boot_ch := 0.0
var boot_wait := 0.0
var boot_lines: Array = []
var boot_a := 0.0
var boot_fade_at := -1.0
var lore_text := ""
var lore_a := 0.0
var lore_until := -1.0
var hud_alive := "0"
var hud_state := "—"
var mic_on := false
var mic_lvl := 0.0
var hb_t := 0.0
var br_t := 0.0
var gr_t := 8.0
var tout := PackedFloat32Array()
var nb_x := PackedInt32Array([1, -1, 0, 0])
var nb_z := PackedInt32Array([0, 0, 1, -1])

var menu: Control
var m_title: Label
var m_sub: Label
var m_body: Label
var b_mic: Button
var b_no: Button
var tune: PanelContainer
var t_sl: Array[HSlider] = []
var t_lb: Array[Label] = []
var perf: Label
var fms := 16.7
var fmax := 0.0
var perf_n := 0
var testing := false
var test_freeze := false         # 自检用：潮听者原地不动，保持摆好的状态
var env: Environment
var creature := Creature.new()
var intro: Intro
var hud_show := false            # 开场里面窗合上之后 HUD 才亮
var glitch_t := 0.0
var stand := 0.0                 # 声呐上线后从座椅上站起来
var intro_pause := false         # 调试：F6 冻结开场时间
# 视角输入。软捕获（默认）：用光标位置的差分转视角，光标靠近窗口边缘时拉回中心。
# 引擎自带的捕获模式依赖原始相对位移，远程桌面下收不到，所以不能作为唯一方案。F4 切换。
var look_soft := true
var last_mp := Vector2.ZERO
var mp_valid := false
var recenter_until := -1
var warp_fail := 0
var warp_n := 0
var look_events := 0
var test_look := false
var upd_ms := 0.0


static func hyp(a: float, b: float) -> float:
	return sqrt(a * a + b * b)


static func ease01(k: float) -> float:
	k = clampf(k, 0.0, 1.0)
	return k * k * (3.0 - 2.0 * k)


func _ready() -> void:
	randomize()
	tout.resize(6)
	world = WorldData.new()
	tracer = Tracer.new()
	tracer.bind_world(world)
	creature.load_model("res://models/listener.obj", 16000, tracer.sph)
	if creature.from_model:
		for nm: String in ["drift", "sus", "hunt"]:
			creature.load_pose(nm, "res://models/listener_%s.obj" % nm)
	print("[creature] 采样点 ", creature.count, "，来自模型=", creature.from_model)
	for l in world.lores:
		lore_seen.append(false)
	_setup_env()
	sonar = SonarView.new()
	add_child(sonar)
	sonar.setup(world, tracer)
	sonar.on_crystal = _on_crystal
	sfx = Sfx.new()
	add_child(sfx)
	_build_ui()
	_load_tune()
	intro = Intro.new()
	intro.g = self
	add_child(intro)
	cx = world.PX - .45
	cz = world.PZ
	c_yaw = PI / 2.0
	for a in OS.get_cmdline_user_args():
		if a == "--bt-look":
			testing = true
			_run_look_test()
		if a.begins_with("--bt-q="):
			Q = float(a.substr(7))
			_apply_q()
		if a.begins_with("--bt-test="):
			testing = true
			_run_test(a.substr(10))
		if a.begins_with("--bt-horror="):
			testing = true
			_run_horror(a.substr(12))
		if a.begins_with("--bt-props="):
			testing = true
			_run_props(a.substr(11))


func _setup_env() -> void:
	env = Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color.BLACK
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color.BLACK
	env.glow_enabled = true
	env.glow_strength = 1.0
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE
	env_sonar()
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	cam = Camera3D.new()
	cam.fov = rad_to_deg(.62) * 2.0
	cam.near = .04
	cam.far = 160.0
	add_child(cam)
	cam.current = true


## 声呐阶段的画面设置：线性色调、无环境光、较强泛光（开场的受光阶段由 intro.gd 另设）
func env_sonar() -> void:
	env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	env.tonemap_exposure = 1.0
	env.ssao_enabled = false
	env.volumetric_fog_enabled = false
	env.ambient_light_color = Color.BLACK
	env.ambient_light_energy = 1.0
	env.glow_intensity = 0.9
	env.glow_bloom = 0.15
	env.glow_hdr_threshold = 0.8


# ---------- 界面 ----------
func _label(txt: String, sz: int, col: Color) -> Label:
	var l := Label.new()
	l.text = txt
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.add_theme_font_override("font", ui_font)
	l.add_theme_font_size_override("font_size", sz)
	l.add_theme_color_override("font_color", col)
	return l


func _button(txt: String, sz: int, a: float) -> Button:
	var b := Button.new()
	b.text = txt
	b.add_theme_font_override("font", ui_font)
	b.add_theme_font_size_override("font_size", sz)
	for st in ["normal", "hover", "pressed", "focus"]:
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color(.24, 1, 1, .14 if st != "normal" else 0.0)
		sb.border_color = Color(.24, 1, 1, a)
		sb.set_border_width_all(1)
		sb.set_content_margin_all(12)
		sb.content_margin_left = 26
		sb.content_margin_right = 26
		b.add_theme_stylebox_override(st, sb)
	for c in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
		b.add_theme_color_override(c, Color(.24, 1, 1, a))
	return b


func _build_ui() -> void:
	var f := SystemFont.new()
	f.font_names = PackedStringArray(["Cascadia Mono", "Consolas", "Microsoft YaHei UI", "Microsoft YaHei"])
	var fb := SystemFont.new()
	fb.font_names = PackedStringArray(["Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "SimHei"])
	f.fallbacks = [fb]
	ui_font = f

	var l1 := CanvasLayer.new()
	l1.layer = 1
	add_child(l1)
	hud = Hud.new()
	hud.g = self
	hud.font = f
	l1.add_child(hud)

	var l2 := CanvasLayer.new()
	l2.layer = 2
	add_child(l2)
	var cr := ColorRect.new()
	cr.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	cr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	post = ShaderMaterial.new()
	post.shader = load("res://shaders/post.gdshader")
	cr.material = post
	l2.add_child(cr)

	var l3 := CanvasLayer.new()
	l3.layer = 3
	add_child(l3)
	menu = ColorRect.new()
	(menu as ColorRect).color = Color(0, 0, 0, 1)
	menu.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	l3.add_child(menu)
	var cc := CenterContainer.new()
	cc.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	menu.add_child(cc)
	var vb := VBoxContainer.new()
	vb.add_theme_constant_override("separation", 14)
	cc.add_child(vb)
	m_title = _label("盲 潮", 64, Color(.56, .06, .12))
	vb.add_child(m_title)
	m_sub = _label("B L I N D   T I D E  ·  Godot 移植 v0.3", 14, Color(.24, 1, 1, .5))
	vb.add_child(m_sub)
	m_body = _label("血色海洋不透光，但传声。你和它们都没有眼睛。\n声音是你的弹药、你的视野，也是你的位置广播。\n建议佩戴耳机并打开麦克风——你发出的任何声音都等同于声呐。", 15, Color(.24, 1, 1, .75))
	vb.add_child(m_body)
	vb.add_child(_label("WASD 移动 · Shift 潜行 · 空格 低语声呐 · E 主动声呐 · 左键 开火 · 1/2/3 模式 · 按住 F 吸收 · 按住 Q 修复 · G 假声源 · R 交互\n方向键 也可转视角 · F4 切换视角模式 · F2 调参 · F3 性能 · F11 全屏 · Esc 释放鼠标", 12, Color(.24, 1, 1, .4)))
	var hb := HBoxContainer.new()
	hb.alignment = BoxContainer.ALIGNMENT_CENTER
	hb.add_theme_constant_override("separation", 16)
	vb.add_child(hb)
	b_mic = _button("开启麦克风并启动", 16, 1.0)
	b_mic.pressed.connect(begin.bind(true))
	hb.add_child(b_mic)
	b_no = _button("无麦克风启动（键盘声呐）", 13, .55)
	b_no.pressed.connect(begin.bind(false))
	hb.add_child(b_no)

	# F2 调参面板
	tune = PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0, .05, .06, .92)
	sb.border_color = Color(.24, 1, 1, .4)
	sb.set_border_width_all(1)
	sb.set_content_margin_all(12)
	tune.add_theme_stylebox_override("panel", sb)
	tune.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	tune.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	tune.position = Vector2(-12, 12)
	tune.visible = false
	l3.add_child(tune)
	var tv := VBoxContainer.new()
	tune.add_child(tv)
	var rows := [["声速", .25, 1.5], ["回波量程", .4, 1.5], ["暴露半径", .5, 1.5], ["点云密度", .5, 4.0]]
	for r: Array in rows:
		var h := HBoxContainer.new()
		h.add_theme_constant_override("separation", 10)
		tv.add_child(h)
		var nm := _label(r[0], 14, Color(.6, .93, 1))
		nm.custom_minimum_size = Vector2(80, 0)
		nm.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
		h.add_child(nm)
		var sl := HSlider.new()
		sl.min_value = r[1]
		sl.max_value = r[2]
		sl.step = .05
		sl.value = 1.0
		sl.custom_minimum_size = Vector2(200, 20)
		sl.value_changed.connect(_tune_changed)
		h.add_child(sl)
		t_sl.append(sl)
		var vl := _label("", 14, Color(.6, .93, 1))
		vl.custom_minimum_size = Vector2(230, 0)
		vl.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
		h.add_child(vl)
		t_lb.append(vl)
	var rb := _button("复位", 12, .8)
	rb.pressed.connect(func(): _tune_set(1.0, 1.0, 1.0, Q_DEFAULT))
	tv.add_child(rb)

	perf = _label("", 12, Color(.6, 1, .6))
	perf.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
	perf.position = Vector2(8, 6)
	perf.visible = false
	l3.add_child(perf)


func _tune_show() -> void:
	t_lb[0].text = "%d m/s" % int(24.0 * SPD)
	t_lb[1].text = "主动 %d m · 低语 %.1f m" % [int(42.0 * RNG), 7.5 * RNG]
	t_lb[2].text = "主动 %d m" % int(75.0 * EXPO)
	t_lb[3].text = "%.2f× · 主动声呐约 %d 千点" % [Q, int(18.0 * Q)]


func _tune_changed(_v: float) -> void:
	_tune_set(t_sl[0].value, t_sl[1].value, t_sl[2].value, t_sl[3].value)


func _tune_set(a: float, b: float, c: float, d := -1.0) -> void:
	SPD = clampf(a, .25, 1.5)
	RNG = clampf(b, .4, 1.5)
	EXPO = clampf(c, .5, 1.5)
	if d > 0.0:
		Q = clampf(d, .5, 4.0)
		t_sl[3].set_value_no_signal(Q)
		_apply_q()
	t_sl[0].set_value_no_signal(SPD)
	t_sl[1].set_value_no_signal(RNG)
	t_sl[2].set_value_no_signal(EXPO)
	_tune_show()
	_save_cfg()


func _save_cfg() -> void:
	if testing:
		return                       # 自动测试不改动玩家保存的设置
	var cf := ConfigFile.new()
	cf.set_value("tune", "v", [SPD, RNG, EXPO])
	cf.set_value("tune", "q", Q)
	cf.set_value("look", "soft", look_soft)
	cf.save("user://tune.cfg")


func _load_tune() -> void:
	var cf := ConfigFile.new()
	if cf.load("user://tune.cfg") == OK:
		var v: Array = cf.get_value("tune", "v", [1.0, 1.0, 1.0])
		look_soft = cf.get_value("look", "soft", true)
		Q = clampf(cf.get_value("tune", "q", Q_DEFAULT), .5, 4.0)
		if v.size() == 3:
			SPD = clampf(v[0], .25, 1.5)
			RNG = clampf(v[1], .4, 1.5)
			EXPO = clampf(v[2], .5, 1.5)
	t_sl[0].set_value_no_signal(SPD)
	t_sl[1].set_value_no_signal(RNG)
	t_sl[2].set_value_no_signal(EXPO)
	t_sl[3].set_value_no_signal(Q)
	_apply_q()
	_tune_show()


## 点云密度变了：同步调整单点亮度和大小，让整体亮度大致不变
func _apply_q() -> void:
	sonar.mat.set_shader_parameter("u_gain", pow(Q, -.45))
	sonar.mat.set_shader_parameter("u_psize", pow(Q, -.2))


# ---------- 主循环 ----------
func _process(delta: float) -> void:
	var dt := minf(.05, delta)
	var raw := delta * 1000.0
	if raw < 250.0:
		fms += (raw - fms) * .05
		fmax = maxf(fmax, raw)
	if state == "play" or state == "intro":
		now += dt
		var i := events.size() - 1
		while i >= 0:
			if i < events.size() and events[i][0] <= now:
				var fn: Callable = events[i][1]
				events.remove_at(i)
				fn.call()
			i -= 1
		var _u0 := Time.get_ticks_usec()
		if state == "intro":
			upd_intro(dt)
		elif state == "play":
			update(dt)
		sonar.poll(now)
		sonar.mat.set_shader_parameter("u_beat", beat)
		upd_ms = (Time.get_ticks_usec() - _u0) / 1000.0
	if boot_fade_at >= 0.0 and now > boot_fade_at:
		boot_a = maxf(0.0, boot_a - dt * .5)
	lore_a = move_toward(lore_a, .9 if now < lore_until else 0.0, dt * .8)
	hud.on = move_toward(hud.on, 1.0 if (state == "play" or (state == "intro" and hud_show)) else 0.0, dt * 3.0)
	glitch_t -= dt
	sonar.visible = not (state == "intro" and intro.lit)
	cam.position = Vector3(cx, cy, cz)
	cam.rotation = Vector3(c_pitch, -c_yaw, 0.0)
	var playing := state == "play"
	post.set_shader_parameter("u_t", fmod(now, 100.0))
	post.set_shader_parameter("u_jam", 1.0 if (playing and P.jam > 0.0) or glitch_t > 0.0 else 0.0)
	post.set_shader_parameter("u_vis", intro.u_vis if state == "intro" else 1.0)
	post.set_shader_parameter("u_fog", fog_k if playing else 0.0)
	post.set_shader_parameter("u_press", 0.0 if state == "menu" else maxf(P.trace, clampf(P.roar_fx, 0.0, 1.0) * 2.4))
	post.set_shader_parameter("u_over", 1.0 if playing and P.lock > 0.0 else 0.0)
	post.set_shader_parameter("u_flood", flood)
	if perf.visible:
		perf_n += 1
		if perf_n % 30 == 0:
			perf.text = "%d fps · 帧 %.1f / 峰 %.0f ms · 点 %dk · 脉冲 %d · 待算 %d · 上次脉冲 %.1f ms / %d 点 · 线程 %d · 视角 %s · 鼠标事件 %d · 回中 %d 失败 %d" % [
				int(1000.0 / fms), fms, fmax, sonar.points_alive() / 1000, sonar.live.size(), sonar.pending.size(),
				sonar.last_ms, sonar.last_pts, OS.get_processor_count(), "软捕获" if look_soft else "原始", look_events, warp_n, warp_fail]
			fmax = 0.0


func at(t: float, fn: Callable) -> void:
	events.append([t, fn])


func mouse_grabbed() -> bool:
	if test_look:
		return true
	return Input.mouse_mode == (Input.MOUSE_MODE_CONFINED_HIDDEN if look_soft else Input.MOUSE_MODE_CAPTURED)


func grab_mouse() -> void:
	mp_valid = false
	recenter_until = -1
	warp_fail = 0
	Input.mouse_mode = Input.MOUSE_MODE_CONFINED_HIDDEN if look_soft else Input.MOUSE_MODE_CAPTURED


func _warp(c: Vector2) -> void:
	warp_n += 1
	if not test_look:
		Input.warp_mouse(c)


func _look(d: Vector2) -> void:
	# 同一帧内的多个鼠标事件会被引擎合并成一个，所以单次位移可以很大；限幅只用来挡极端异常值
	var dx := clampf(d.x * .0022, -1.2, 1.2)
	var dy := clampf(d.y * .0022, -1.2, 1.2)
	P.yaw += dx * (.5 + .5 * cos(P.pitch))
	P.pitch = clampf(P.pitch - dy, -1.2, 1.2)
	yaw_v += dx * .02
	pitch_v += dy * .02


func _input(ev: InputEvent) -> void:
	if not (ev is InputEventMouseMotion) or state != "play" or not mouse_grabbed():
		return
	if test_look and ev.device != 77:
		return
	look_events += 1
	if not look_soft:
		_look(ev.screen_relative)
		return
	var p: Vector2 = ev.position
	if recenter_until > 0:
		# 刚请求把光标拉回中心：等它真的到了中心附近再恢复，期间的位移一律不算，避免视角跳变
		var c := get_viewport().get_visible_rect().size * .5
		if absf(p.x - c.x) < c.x * .5 and absf(p.y - c.y) < c.y * .5:
			recenter_until = -1
			warp_fail = 0
		last_mp = p
		mp_valid = true
		return
	if mp_valid:
		_look(p - last_mp)
	last_mp = p
	mp_valid = true


func _soft_tick(dt: float) -> void:
	if not look_soft or not mouse_grabbed() or not mp_valid:
		return
	var c := get_viewport().get_visible_rect().size * .5
	var nx := (last_mp.x - c.x) / c.x
	var ny := (last_mp.y - c.y) / c.y
	var ms := Time.get_ticks_msec()
	if recenter_until > 0:
		if ms > recenter_until:
			recenter_until = -1
			warp_fail += 1
		return
	if absf(nx) > .76 or absf(ny) > .76:
		if warp_fail < 3:
			_warp(c)
			recenter_until = ms + 300
		else:
			# 光标拉不回中心（远程客户端不接受）：贴边时按固定角速度继续转
			if absf(nx) > .76:
				P.yaw += signf(nx) * 1.8 * dt
			if absf(ny) > .76:
				P.pitch = clampf(P.pitch - signf(ny) * 1.2 * dt, -1.2, 1.2)


func _unhandled_input(ev: InputEvent) -> void:
	if ev is InputEventKey and ev.pressed and not ev.echo:
		var k: int = ev.physical_keycode
		if k == KEY_F2:
			tune.visible = not tune.visible
			if tune.visible:
				Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
			return
		if k == KEY_F3:
			perf.visible = not perf.visible
			return
		if k == KEY_F4:
			var was := mouse_grabbed()
			look_soft = not look_soft
			if was:
				grab_mouse()
			_save_cfg()
			toast("视角模式：" + ("软捕获（远程桌面可用）" if look_soft else "原始输入（本机直连手感更好）"))
			return
		if k == KEY_F11:
			var fs := DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_FULLSCREEN
			DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED if fs else DisplayServer.WINDOW_MODE_FULLSCREEN)
			return
		if k == KEY_ESCAPE:
			Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
			return
		if state == "menu" and (k == KEY_ENTER or k == KEY_KP_ENTER):
			begin(false)
			return
		if state == "intro":
			if k == KEY_ENTER or k == KEY_KP_ENTER:
				finish_intro(true)
			elif k == KEY_F6:
				intro_pause = not intro_pause
			elif k == KEY_PAGEDOWN or k == KEY_PAGEUP:
				it = maxf(0.0, it + (1.0 if k == KEY_PAGEDOWN else -1.0))
				intro.seek(it)
			elif k >= KEY_0 and k <= KEY_9:
				# 调试：直接跳到开场的关键时间点
				it = [1.5, 3.7, 4.7, 5.4, 7.0, 8.1, 9.15, 12.7, 13.6, 14.6][k - KEY_0]
				intro.seek(it)
			return
		if state != "play":
			return
		if k == KEY_F7:
			# 调试：传送到一只潮听者面前 4.5 米处，它被震慑住不动，便于检查模型
			for e in enemies:
				if not e.dead and world.walk(world.cell_of(e.x - 4.5), world.cell_of(e.z)):
					P.x = e.x - 4.5
					P.z = e.z
					P.yaw = PI / 2.0
					P.pitch = 0.0
					e.stun = 30.0
					e.yaw = -PI / 2.0 + .5
					break
			return
		if k == KEY_E:
			active_sonar()
		elif k == KEY_F:
			try_absorb()
		elif k == KEY_G:
			throw_decoy()
		elif k == KEY_R:
			interact()
		elif k == KEY_1:
			P.mode = 0
		elif k == KEY_2:
			P.mode = 1
		elif k == KEY_3:
			P.mode = 2
	elif ev is InputEventMouseButton and state == "play":
		if ev.pressed:
			if ev.button_index == MOUSE_BUTTON_LEFT:
				if not mouse_grabbed():
					if not tune.visible:
						grab_mouse()
					return
				if P.mode == 2 and P.energy >= 30.0 and P.lock <= 0.0:
					P.charging = 0.0
					sfx.play("charge")
				else:
					fire(0.0)
			elif ev.button_index == MOUSE_BUTTON_WHEEL_DOWN:
				P.mode = (P.mode + 1) % 3
			elif ev.button_index == MOUSE_BUTTON_WHEEL_UP:
				P.mode = (P.mode + 2) % 3
		elif ev.button_index == MOUSE_BUTTON_LEFT and P.charging >= 0.0:
			var c := P.charging / 1.4
			P.charging = -1.0
			fire(c)


# ---------- 声脉冲（视野）与噪声（暴露） ----------
## o: x,y,z, rng(量程), rays, col, 可选 life, speed, cone(Vector3)+ang, mark, loud, src
func pulse(o: Dictionary) -> void:
	var J := Tracer.Job.new()
	J.x = o.x
	J.y = o.y
	J.z = o.z
	J.rng = o.rng * RNG
	var rays := maxi(40, int(o.rays * Q))
	J.rays = rays
	J.n = rays + mini(int(1500.0 * Q), int(rays * .07))
	var fl: float = o.get("flood", 0.0)
	if fl > 0.0:
		# 声浪：除了打在表面上的回波，水体本身也被填满
		J.n = rays + int(rays * fl)
		J.snow_b = .5
	J.sp = o.get("speed", 24.0) * SPD
	J.life = o.get("life", 4.0)
	var col: Color = o.col
	J.cr = col.r
	J.cg = col.g
	J.cb = col.b
	var src: String = o.get("src", "env")
	J.player = src == "player"
	J.loud = o.get("loud", false)
	J.t0 = now
	if o.get("mark", false):
		for e in enemies:
			if e.dead:
				continue
			var d := hyp(e.x - J.x, e.z - J.z)
			if d < J.rng and world.los(J.x, J.z, e.x, e.z):
				at(now + d / J.sp, func(): e.marked = now + 3.5)
	if not world.in_b(world.cell_of(J.x), world.cell_of(J.z)):
		return
	if o.has("cone"):
		var c: Vector3 = o.cone
		J.cone = true
		J.ang = o.ang
		J.cdx = c.x
		J.cdy = c.y
		J.cdz = c.z
		var up := Vector3(1, 0, 0) if absf(c.y) > .9 else Vector3(0, 1, 0)
		var u := c.cross(up).normalized()
		var v := c.cross(u)
		J.ux = u.x
		J.uy = u.y
		J.uz = u.z
		J.vx = v.x
		J.vy = v.y
		J.vz = v.z
	if src != "enemy":
		for e in enemies:
			if e.dead:
				continue
			var d := hyp(e.x - J.x, e.z - J.z)
			if d >= J.rng + 1.5:
				continue
			J.en.append(e.x)
			J.en.append(e.z)
			J.en.append(e.yaw)
			# 声波扫到它：从模型表面取朝向声源的点，按到达时间显形
			if d < J.rng and world.los(J.x, J.z, e.x, e.z):
				# 离得越远身体的回波越稀：20 米外只剩零星几点，先读到的是墙上被它挡出来的那块黑和黑的亮边
				var n := clampi(int(rays * 5.0 / (d * d + 4.0) * far_k(d)), 24, 2800)
				if J.cone:
					var to := Vector3(e.x - J.x, 1.2 - J.y, e.z - J.z).normalized()
					if to.dot(Vector3(J.cdx, J.cdy, J.cdz)) < cos(minf(PI, J.ang + atan2(.8, d))):
						continue
					n = clampi(int(rays * .9), 300, 2400)
				reveal_enemy(e, J.x, J.y, J.z, J.sp, n, GHOST_T)
				e.seen = now + d / J.sp
		if not J.cone:
			@warning_ignore("integer_division")
			J.rim = (J.en.size() / 3) * 4 * int(110.0 * Q)
			J.n += J.rim
	sonar.submit(J)


func _on_crystal(kx: int, kz: int, t_at: float) -> void:
	var key := kx + kz * WorldData.MW
	if crystal_cd.get(key, 0.0) < now:
		crystal_cd[key] = now + 4.0
		at(t_at, resonate.bind(kx, kz))


## 共鸣水晶被大声激发：自己发一圈黄色脉冲，震慑附近的潮听者，同时也是一次很响的噪声
func resonate(kx: int, kz: int) -> void:
	var x := (kx + .5) * CS
	var z := (kz + .5) * CS
	pulse({x = x, y = 1.8, z = z, rng = 15.0, rays = 2500, col = Color(1, .95, .6), life = 3.5})
	sfx.play_at("resonate", Vector3(x, 1.8, z))
	noise(x, z, 30.0, "crystal")
	for e in enemies:
		if not e.dead and hyp(e.x - x, e.z - z) < 6.5:
			e.stun = 1.8
			e.marked = now + 2.5
	for i in world.keys.size():
		if world.keys[i] == Vector2i(kx, kz) and not keys_on[i]:
			wake_key(i)


## 耳石被喊醒：从此一直鸣响。两块都醒着，井门的声锁就开
func wake_key(i: int) -> void:
	keys_on[i] = true
	var f := world.key_face[i]
	if keys_on.has(false):
		wake(3, f.x, f.z)
	else:
		wake(4, f.x, f.z)
		at(now + 1.4, open_door)


func set_door(open: bool) -> void:
	door_open = open
	var k := world.door_k
	world.wall_m[k] = 0 if open else 3
	world.floor_t[k] = 2 if open else 0
	world.ceil_t[k] = 1 if open else 0
	sonar.set_door(open)


func open_door() -> void:
	if door_open or state != "play":
		return
	set_door(true)
	var d := world.door_p
	sfx.play_at("hatch", Vector3(d.x, 1.5, d.y))
	pulse({x = d.x, y = 1.6, z = d.y, rng = 24.0, rays = 5000, col = Color(1, .95, .6), life = 4.0, speed = 16.0})
	noise(d.x, d.y, 45.0, "crystal")
	if obj < 4:
		set_obj(4)


## 推进流程阶段：阶段不高于 n 的潮听者开始苏醒。给了 x,z 的话，它们醒来时就朝那里摸过去
func wake(n: int, x := 0.0, z := 0.0, hint := true) -> void:
	if n <= stage:
		return
	stage = n
	for s: Dictionary in sleepers:
		if s.st <= n and not s.hint and hint and (x != 0.0 or z != 0.0):
			s.hint = true
			s.hx = x
			s.hz = z


func spawn_enemy(sx: float, sz: float) -> Enemy:
	var e := Enemy.new()
	e.id = enemies.size()
	e.x = sx
	e.z = sz
	e.yaw = randf() * 6.0
	e.ping_t = 5.0 + randf() * 7.0
	e.click_t = randf() * 2.0
	enemies.append(e)
	return e


## 声音就是路标：没醒的耳石低声滴答，醒着的长鸣；门开之后井自己在嗡鸣；返程时求生舱在呼叫
func landmarks(dt: float) -> void:
	key_t -= dt
	if key_t <= 0.0 and obj >= 3:
		key_t = 2.6
		for i in world.keys.size():
			var f := world.key_face[i]
			if hyp(f.x - P.x, f.z - P.z) > 50.0:
				continue
			if keys_on[i]:
				pulse({x = f.x, y = f.y, z = f.z, rng = 13.0, rays = 1300, col = Color(1, .95, .6), life = 3.0})
				sfx.play_at("key_ring", f)
			elif obj == 3:
				pulse({x = f.x, y = f.y, z = f.z, rng = 4.5, rays = 260, col = Color(1, .95, .6), life = 2.2, speed = 8.0})
				sfx.play_at("key_idle", f)
		if obj == 4 or obj == 5:
			var c := world.core_p
			pulse({x = c.x - 1.4, y = 1.8, z = c.y, rng = 6.5, rays = 600, col = Color(1, .85, .45), life = 2.4, speed = 8.0})
			sfx.play_at("key_idle", Vector3(c.x, 1.8, c.y), 1.0, .5)
	if obj == 7:
		call_t -= dt
		if call_t <= 0.0:
			call_t = 3.0
			pulse({x = world.PX, y = 1.5, z = world.PZ, rng = 16.0, rays = 1500, col = Color(1, .85, .45), life = 3.0})
			noise(world.PX + 3.0, world.PZ, 40.0, "beacon")
			sfx.play_at("beacon", Vector3(world.PX + 3.0, 1.6, world.PZ), .5, 1.5)


func noise(x: float, z: float, r: float, kind: String) -> void:
	r *= EXPO
	if kind == "player":
		if world.floor_at(P.x, P.z) == 4:
			r *= .25
		elif P.covered == "环境声":
			r *= .45
		P.expo = maxf(P.expo, r)
	var lured := 0
	for e in enemies:
		if e.dead:
			continue
		var d := hyp(e.x - x, e.z - z)
		var rr := r if world.los(x, z, e.x, e.z) else r * .6
		if d >= rr:
			continue
		var g := (1.0 - d / rr) * .9 + .1
		if g > e.conf * .5 or kind == e.last_kind:
			var er := (1.0 - g) * 4.5
			var bx := x + (randf() - .5) * 2.0 * er
			var bz := z + (randf() - .5) * 2.0 * er
			if not world.walk(world.cell_of(bx), world.cell_of(bz)):
				bx = x
				bz = z
			if kind == "decoy" and e.last_kind == "player" and e.conf > .2:
				lured += 1
			e.bx = bx
			e.bz = bz
			e.last_kind = kind
		e.conf = minf(1.0, e.conf + g * .75)
	if lured > 0:
		sfx.play("lured")


func fwd() -> Vector3:
	var cp := cos(P.pitch)
	return Vector3(sin(P.yaw) * cp, sin(P.pitch), -cos(P.yaw) * cp)


func whisper_sonar() -> void:
	if P.whisper_cd > 0.0 or P.jam > 0.0:
		return
	# 一声之后要黑下来：点只活 1.3 秒，下一声在 1.2 秒后。按住空格看到的是"亮—暗—亮"，不是一盏长明灯。
	# 以前靠好几声叠在一起才看得清，现在每一声都得自己把房间画完整，所以射线数是原来的四倍多
	P.whisper_cd = 1.2
	pulse({x = P.x, y = P.ey, z = P.z, rng = 7.5, rays = 6000, col = Color(.25, 1, 1), life = 1.3, src = "player"})
	noise(P.x, P.z, 7.0, "player")
	gain(3.0)
	sfx.play("whisper")


func active_sonar() -> void:
	if P.active_cd > 0.0 or P.jam > 0.0:
		return
	P.active_cd = 1.3
	stats.pings += 1
	pulse({x = P.x, y = P.ey, z = P.z, rng = 42.0, rays = 20000, col = Color(.25, 1, 1), life = 4.2, mark = true, loud = true, src = "player"})
	noise(P.x, P.z, 75.0, "player")
	gain(14.0)
	sfx.play("active")


func mic_sonar(l: float, dt: float) -> void:
	gain(l * 16.0 * dt)
	P.mic_t -= dt
	if P.mic_t > 0.0 or P.jam > 0.0:
		return
	P.mic_t = .6
	var loud := l > .5
	if loud:
		stats.pings += 1
	pulse({x = P.x, y = P.ey, z = P.z, rng = 5.0 + l * 38.0, rays = int(500.0 + l * 11000.0), col = Color(.25, 1, 1), life = 1.2 + l * 3.0, mark = loud, loud = loud, src = "player"})
	noise(P.x, P.z, 4.0 + l * 72.0, "player")


## 声能是唯一的池子：开火、吸收场、修复结构都从这里扣
const ABS_OPEN := 8.0       # 声能低于这个数，吸收场打不开
const ABS_DRAIN := 20.0     # 吸收场开着时每秒烧掉的声能
const MEND_COST := 12.0     # 修复时每秒烧掉的声能
const MEND_RATE := 10.0     # 修复时每秒恢复的结构完整性


func gain(e: float) -> void:
	P.energy = minf(100.0, P.energy + e)


## 按下 F：打开吸收场。按住维持，松手关闭；开着就一直烧声能
func try_absorb() -> void:
	if P.abs_on:
		return
	if P.energy < ABS_OPEN:
		sfx.play("dry")
		return
	P.abs_on = true
	P.abs_min = .3
	sfx.play("absorb")


func throw_decoy() -> void:
	if P.energy < 15.0:
		sfx.play("dry")
		return
	P.energy -= 15.0
	var f := fwd()
	var m := world.trace(P.x, P.ey, P.z, f.x, f.y, f.z, 15.0, tout)
	var t := (tout[0] if m > 0 else 15.0) - .5
	decoys.append([P.x + f.x * t, clampf(P.ey + f.y * t, .3, HT - .3), P.z + f.z * t, now + 5.5, .5])
	sfx.play("decoy_throw")


func fire(charge: float) -> void:
	var mode := P.mode
	var cost := 5.0 if mode == 0 else (12.0 if mode == 1 else 30.0)
	if P.lock > 0.0 or P.fire_cd > 0.0:
		return
	if P.energy < cost:
		sfx.play("dry")
		P.fire_cd = .25
		return
	P.energy -= cost
	stats.shots += 1
	P.fire_cd = .22 if mode == 0 else .32
	P.heat += 9.0 if mode == 0 else (20.0 if mode == 1 else 48.0)
	var f := fwd()
	var sp := .012 if mode == 1 else .004
	var d := Vector3(f.x + (randf() - .5) * sp, f.y + (randf() - .5) * sp, f.z + (randf() - .5) * sp).normalized()
	var ox := P.x + cos(P.yaw) * .18 + d.x * .4
	var oy := P.ey - .14
	var oz := P.z + sin(P.yaw) * .18 + d.z * .4
	if mode < 2:
		var m := world.trace(P.x, P.ey, P.z, d.x, d.y, d.z, 60.0, tout)
		var t := tout[0] if m > 0 else 60.0
		var he: Enemy = null
		for e in enemies:
			if e.dead:
				continue
			var te := tracer.ray_sph(e.x, e.z, e.yaw, P.x, P.ey, P.z, d.x, d.y, d.z)
			if te < t:
				t = te
				he = e
		var s := .6
		while s < t:
			sonar.add_point(ox + d.x * s + (randf() - .5) * .03, oy + d.y * s + .14 * s / t + (randf() - .5) * .03, oz + d.z * s + (randf() - .5) * .03,
				now + s / 90.0, .35 + randf() * .4, .6, 1.0, 1.0, .04)
			s += .22
		if he != null:
			var dmg := 22.0 if mode == 0 else 45.0
			if mode == 0 and he.conf < .25:
				dmg *= 2.6                       # 没被察觉时的低语射击：伏击加成
			damage(he, dmg, .35 if mode == 1 else .1)
		pulse({x = ox, y = oy, z = oz, cone = d, ang = .05 if mode == 0 else .11, rng = 16.0 if mode == 0 else 44.0, rays = 260 if mode == 0 else 1500,
			col = Color(.45, 1, 1), life = 2.0 if mode == 0 else 3.2, speed = 70.0, loud = mode == 1, src = "player"})
		if mode == 0:
			noise(P.x, P.z, 11.0, "player")
			sfx.play("shot0")
		else:
			noise(P.x, P.z, 32.0, "player")
			sfx.play("shot1")
		P.pitch += .004 if mode == 0 else .014
	else:
		var c := clampf(charge, 0.0, 1.0)
		pulse({x = ox, y = oy, z = oz, cone = d, ang = .42, rng = 34.0, rays = 6000, col = Color(.6, 1, 1), life = 4.5, speed = 45.0, mark = true, loud = true, src = "player"})
		for e in enemies:
			if e.dead:
				continue
			var vx := e.x - P.x
			var vz := e.z - P.z
			var dd := hyp(vx, vz)
			if dd > 17.0 or not world.los(P.x, P.z, e.x, e.z):
				continue
			if (vx * f.x + vz * f.z) / (dd + .01) > cos(.5) or dd < 2.0:
				damage(e, (60.0 + 75.0 * c) * (1.0 - dd / 40.0), 1.3)
		noise(P.x, P.z, 100.0, "player")
		sfx.play("shot2")
		P.pitch += .04
	P.pitch = clampf(P.pitch, -1.2, 1.2)
	if P.heat >= 100.0:
		# 啸叫：连发过热，武器锁死，同时全图暴露
		P.heat = 100.0
		P.lock = 2.4
		noise(P.x, P.z, 100.0, "player")
		sfx.play("overload")


## 远处的潮听者身体回波打几折：10 米内不打折，22 米外只剩一成
func far_k(d: float) -> float:
	return clampf(1.0 - (d - 10.0) / 12.0, .1, 1.0)


## 这一刻它摆着什么姿势：漂游时垂着，警觉时歪头侧听，猎杀和攻击时前倾张臂；被震慑或死了就垮下来
func pose_of(e: Enemy) -> PackedFloat32Array:
	if e.dead or e.stun > 0.0:
		return creature.pose("drift")
	return creature.pose("hunt" if e.state == "attack" or e.state == "roar" else e.state)


## 怪物全身的轮廓点（被标记、受击、死亡、攻击时）
func body_burst(e: Enemy, n: int, life: float, br: float, delay := 0.0) -> void:
	var c := sin(e.yaw)
	var s := -cos(e.yaw)
	var p := pose_of(e)
	var cnt := creature.count
	for i in n:
		var j := (randi() % cnt) * 6
		sonar.add_point(e.x + c * p[j] - s * p[j + 2], p[j + 1], e.z + s * p[j] + c * p[j + 2], now + delay, life, br, br * .1, br * .16, .028)


## 声波从 (ox,oy,oz) 扫到怪物：只显出朝向声源的那一面，每个点按声波到达它的时间出现
func reveal_enemy(e: Enemy, ox: float, oy: float, oz: float, sp: float, n: int, life: float) -> void:
	var c := sin(e.yaw)
	var s := -cos(e.yaw)
	var p := pose_of(e)
	var cnt := creature.count
	var placed := 0
	var tries := 0
	while placed < n and tries < n * 3:
		tries += 1
		var j := (randi() % cnt) * 6
		var wx := e.x + c * p[j] - s * p[j + 2]
		var wy := p[j + 1]
		var wz := e.z + s * p[j] + c * p[j + 2]
		var dx := ox - wx
		var dy := oy - wy
		var dz := oz - wz
		if dx * (c * p[j + 3] - s * p[j + 5]) + dy * p[j + 4] + dz * (s * p[j + 3] + c * p[j + 5]) <= 0.0:
			continue
		sonar.add_point(wx, wy, wz, now + sqrt(dx * dx + dy * dy + dz * dz) / sp, life, 1.1, .09, .15, .028)
		placed += 1


func damage(e: Enemy, dmg: float, stun: float) -> void:
	e.hp -= dmg
	e.seen = now
	stats.hits += 1
	P.hit_mark = .25
	body_burst(e, 1600, .7, 1.8)
	e.stun = maxf(e.stun, stun)
	e.conf = 1.0
	e.bx = P.x
	e.bz = P.z
	e.last_kind = "player"
	sfx.play("hit")
	if e.hp <= 0.0:
		e.dead = true
		body_burst(e, 3500, 2.6, 1.3)
		sfx.play_at("e_die", Vector3(e.x, 1.4, e.z))
		gain(10.0)
	else:
		sfx.play_at("e_hurt", Vector3(e.x, 1.4, e.z))


# ---------- 敌人：潮听者 ----------
func bfs(e: Enemy, tx: int, tz: int) -> void:
	var nc := world.NC
	if e.df.size() != nc:
		e.df.resize(nc)
	e.df.fill(-1)
	var q := PackedInt32Array([tx + tz * WorldData.MW])
	e.df[q[0]] = 0
	var i := 0
	while i < q.size():
		var c := q[i]
		i += 1
		var x := c % WorldData.MW
		@warning_ignore("integer_division")
		var z := c / WorldData.MW
		for k in 4:
			var nx := x + nb_x[k]
			var nz := z + nb_z[k]
			if not world.walk(nx, nz):
				continue
			var kk: int = nx + nz * WorldData.MW
			if e.df[kk] < 0:
				e.df[kk] = e.df[c] + 1
				q.append(kk)


func move_to(e: Enemy, tx: float, tz: float, speed: float, dt: float) -> void:
	var ecx := world.cell_of(e.x)
	var ecz := world.cell_of(e.z)
	var tcx := clampi(world.cell_of(tx), 0, WorldData.MW - 1)
	var tcz := clampi(world.cell_of(tz), 0, world.MH - 1)
	var gx := tx
	var gz := tz
	if ecx != tcx or ecz != tcz:
		var key := tcx + tcz * WorldData.MW
		e.df_t -= dt
		if e.df_key != key or e.df_t <= 0.0:
			bfs(e, tcx, tcz)
			e.df_key = key
			e.df_t = .5
		var best := 1000000
		for k in 4:
			var nx := ecx + nb_x[k]
			var nz := ecz + nb_z[k]
			if not world.walk(nx, nz) and not (nx == tcx and nz == tcz):
				continue
			if not world.in_b(nx, nz):
				continue
			var v := e.df[nx + nz * WorldData.MW]
			if v >= 0 and v < best:
				best = v
				gx = (nx + .5) * CS
				gz = (nz + .5) * CS
		if best == 1000000:
			return
		if best == 0 and not world.walk(tcx, tcz):
			return
	var dx := gx - e.x
	var dz := gz - e.z
	var d := hyp(dx, dz)
	if d < .05:
		return
	var s := minf(d, speed * dt)
	var nx2 := e.x + dx / d * s
	var nz2 := e.z + dz / d * s
	if world.walk(world.cell_of(nx2), world.cell_of(nz2)):
		e.x = nx2
		e.z = nz2
	var dy := wrapf(atan2(dx, -dz) - e.yaw, -PI, PI)
	e.yaw += dy * minf(1.0, dt * 8.0)


func enemy_ping(e: Enemy) -> void:
	var ox := e.x
	var oz := e.z
	pulse({x = ox, y = 1.4, z = oz, rng = 23.0, rays = 1200, col = Color(1, .12, .18), life = 2.4, src = "enemy"})
	body_burst(e, 1200, 1.2, 1.3)
	sfx.play_at("e_ping", Vector3(ox, 1.4, oz))
	arcs.append({x = ox, z = oz, t = now, dur = 1.6, k = 1, e = null})
	var d := hyp(P.x - ox, P.z - oz)
	if d > 23.0 * RNG:
		return
	at(now + d / (24.0 * SPD), _ping_arrive.bind(e, ox, oz))


## 敌人的 ping 到达玩家：可见的红环 + 干扰；这一刻吸收场开着则转成能量，否则被精确定位
func _ping_arrive(e: Enemy, ox: float, oz: float) -> void:
	if state != "play":
		return
	P.jam = .45
	e.seen = now                # 它这一声你听见了
	if not world.los(ox, oz, P.x, P.z):
		return
	if P.abs_on:
		# 吸收场开着：这一声被吃掉，转成声能；掐得准（开场时间短）就是净赚
		gain(25.0)
		stats.absorbed += 1
		P.abs_flash = .5
		sfx.play("absorbed")
		return
	if world.floor_at(P.x, P.z) == 4:
		sfx.play("slime_miss")
		return
	e.conf = 1.0
	e.bx = P.x
	e.bz = P.z
	e.last_kind = "player"
	P.pinged = .7
	sfx.play("located")


func upd_enemy(e: Enemy, dt: float) -> void:
	if e.dead:
		return
	var pos := Vector3(e.x, 1.4, e.z)
	e.conf = maxf(0.0, e.conf - dt * .035)
	if e.marked > now:
		# 被标记不等于被盯住：每半秒定格一次，定格之间它在黑暗里走
		e.seen = now
		e.strobe -= dt
		if e.strobe <= 0.0:
			e.strobe = .5
			body_burst(e, int(1500.0 * far_k(hyp(P.x - e.x, P.z - e.z))), 1.5, .9)
	else:
		e.strobe = 0.0
	if e.stun > 0.0:
		e.stun -= dt
		e.wind = 0.0
		if e.state == "attack" or e.state == "roar":
			e.state = "hunt"
		return
	var dp := hyp(P.x - e.x, P.z - e.z)
	if e.state == "attack":
		e.atk -= dt
		e.seen = now
		body_burst(e, int(3000.0 * dt) + 1, .3, 1.2)
		if e.atk <= 0.0:
			if not e.struck:
				e.struck = true
				e.atk = .8
				if dp < 2.9:
					P.hp -= 34.0
					P.hurt = .9
					sfx.play("hurt")
					if P.hp <= 0.0:
						end_game(false)
			else:
				e.state = "hunt"
		return
	if e.state == "roar":
		# 怒吼：站定，听盘转过来对着你，三道红色的声浪一道接一道涌出来
		e.roar -= dt
		e.seen = now
		e.yaw += wrapf(atan2(P.x - e.x, -(P.z - e.z)) - e.yaw, -PI, PI) * minf(1.0, dt * 10.0)
		body_burst(e, int(8000.0 * dt) + 1, .3, 1.7)
		if e.roar_n < 3 and ROAR_T - e.roar >= .45 + e.roar_n * .42:
			e.roar_n += 1
			roar_wave(e, e.roar_n)
		if e.roar <= 0.0:
			e.state = "hunt"
		return
	if dp < 1.4:
		e.conf = 1.0
		e.bx = P.x
		e.bz = P.z
		e.last_kind = "player"
	var st := "hunt" if e.conf > .6 else ("sus" if e.conf > .2 else "drift")
	if st != e.state:
		if st == "hunt":
			sfx.play_at("e_hunt", pos)
		e.state = st
	var tx := 0.0
	var tz := 0.0
	var sp := 1.3
	if st == "drift":
		if not e.has_wander or hyp(e.wx - e.x, e.wz - e.z) < 1.0:
			e.has_wander = true
			e.wx = e.x
			e.wz = e.z
			for i in 30:
				var x := world.cell_of(e.x) + randi_range(-6, 6)
				var z := world.cell_of(e.z) + randi_range(-6, 6)
				if world.walk(x, z) and not (x == world.pod_c.x and z == world.pod_c.y):
					e.wx = (x + .5) * CS
					e.wz = (z + .5) * CS
					break
		tx = e.wx
		tz = e.wz
	else:
		tx = e.bx
		tz = e.bz
		sp = 4.7 if st == "hunt" else 2.5
		if st == "hunt" and dp < 2.5 and world.los(e.x, e.z, P.x, P.z):
			e.state = "attack"
			e.atk = .65
			e.struck = false
			e.wind = 0.0
			sfx.play_at("e_attack", pos)
			arcs.append({x = e.x, z = e.z, t = now, dur = .65, k = 2, e = null})
			return
		if st == "hunt" and dp < ROAR_R and now > e.roar_cd and now > roar_gap and world.los(e.x, e.z, P.x, P.z):
			# 它确信你就在跟前：先吼。吼的这两秒它不动，但你的声呐会被淹掉
			e.state = "roar"
			e.roar = ROAR_T
			e.roar_n = 0
			e.roar_cd = now + 16.0 + randf() * 6.0
			roar_gap = now + 7.0
			e.wind = 0.0
			sfx.play_at("e_roar", pos, 1.0)
			arcs.append({x = e.x, z = e.z, t = now, dur = ROAR_T, k = 3, e = e})
			return
		if hyp(tx - e.x, tz - e.z) < 1.3:
			e.conf *= .45 if st == "hunt" else .3
			e.ping_t = minf(e.ping_t, .15)
	e.ping_t -= dt
	if e.ping_t <= 0.0 and e.wind <= 0.0:
		e.wind = 1.0
		e.ping_t = 99.0
		arcs.append({x = e.x, z = e.z, t = now, dur = 1.0, k = 0, e = e})
		sfx.play_at("e_wind", pos)
	if e.wind > 0.0:
		e.wind -= dt
		sp *= .25
		if e.wind <= 0.0:
			enemy_ping(e)
			e.ping_t = 3.2 if e.state == "hunt" else (4.6 if e.state == "sus" else 8.0 + randf() * 5.0)
	move_to(e, tx, tz, sp, dt)
	e.click_t -= dt
	if e.click_t <= 0.0:
		e.click_t = .3 if st == "hunt" else (.85 if st == "sus" else 2.4 + randf() * 2.0)
		sfx.play_at("click_" + st, pos)


## 怒吼的一道声浪：红色，从它身上涌出来，连水里的悬浮物都被打亮——整片视野被填满
func roar_wave(e: Enemy, i: int) -> void:
	pulse({x = e.x, y = 1.55, z = e.z, rng = 17.0, rays = 7000, col = Color(1, .1, .15), life = 2.6 - i * .3, speed = 20.0, src = "enemy", flood = 1.5})
	if i > 1:
		return
	# 第一道声浪：同类听得见，会朝这边聚过来；它自己不该被自己的吼声带偏
	var kc := e.conf
	var kx := e.bx
	var kz := e.bz
	var kk := e.last_kind
	noise(e.x, e.z, 24.0, "roar")
	e.conf = kc
	e.bx = kx
	e.bz = kz
	e.last_kind = kk
	at(now + hyp(P.x - e.x, P.z - e.z) / (20.0 * SPD), _roar_arrive.bind(e.x, e.z))


## 声浪打到玩家：声呐被淹没（发不出去，面罩撕裂、投影断续、镜头发抖）；吸收场开着就整口吃下去
func _roar_arrive(ox: float, oz: float) -> void:
	if state != "play" or hyp(P.x - ox, P.z - oz) > 17.0 * RNG:
		return
	P.pinged = .7
	if P.abs_on and world.los(ox, oz, P.x, P.z):
		gain(35.0)
		stats.absorbed += 1
		P.abs_flash = .7
		sfx.play("absorbed")
		return
	P.jam = maxf(P.jam, ROAR_JAM)
	P.roar_fx = ROAR_JAM
	sfx.play("located")


# ---------- 交互与剧情 ----------
func set_obj(i: int) -> void:
	obj = i
	obj_text = ("◇ " + OBJ[i]) if OBJ[i] != "" else ""


func set_hatch(open: bool) -> void:
	hatch_open = open
	var k := world.hatch_k
	world.wall_m[k] = 0 if open else 7
	world.floor_t[k] = 5 if open else 0
	world.ceil_t[k] = 3 if open else 0
	sonar.set_hatch(open)


func toast(s: String) -> void:
	lore_text = s
	lore_until = now + 3.0


func show_lore(s: String) -> void:
	lore_text = s
	lore_until = now + 9.0
	sfx.play("lore")


func interact() -> void:
	if obj == 0:
		set_hatch(true)
		set_obj(1)
		sfx.play("hatch")
		P.hurt = .15
		noise(world.PX + 3.0, world.PZ, 34.0, "player")
		pulse({x = world.PX + 1.2, y = 1.5, z = world.PZ, cone = Vector3(1, 0, 0), ang = .9, rng = 26.0, rays = 9000, col = Color(.25, 1, 1), life = 5.0, speed = 20.0, src = "player"})
		return
	if obj == 5 and hyp(P.x - world.core_p.x, P.z - world.core_p.y) < 5.0:
		set_obj(6)
		beacon_t = 40.0
		beacon_p = 0.0
		wake(5)


func story(dt: float) -> void:
	for i in world.lores.size():
		var l: Array = world.lores[i]
		if not lore_seen[i] and hyp(l[0] - P.x, l[1] - P.z) < 2.6:
			lore_seen[i] = true
			show_lore(l[2])
			pulse({x = l[0], y = .4, z = l[1], rng = 4.0, rays = 500, col = Color(1, .9, .6), life = 3.0, speed = 6.0})
	var a0 := world.ambients[0]
	if obj == 1 and hyp(P.x - a0.x, P.z - a0.y) < 5.0:
		set_obj(2)
		wake(1)
	if (obj == 1 or obj == 2) and hyp(P.x - world.gate_p.x, P.z - world.gate_p.y) < 4.5:
		set_obj(3)
		wake(2)
	if obj == 3:
		obj_text = "◇ 共鸣 %d/%d" % [keys_on.count(true), keys_on.size()]
	if obj == 4 and hyp(P.x - world.core_p.x, P.z - world.core_p.y) < 4.5:
		set_obj(5)
	landmarks(dt)
	if obj == 7 and world.cell_of(P.x) == world.pod_c.x and world.cell_of(P.z) == world.pod_c.y:
		end_game(true)
		return
	if obj == 6:
		# 信标：每 2.6 秒向全图喊一声，撑 40 秒；之后上浮缆锁定求生舱，得活着回去
		beacon_t -= dt
		beacon_p -= dt
		obj_text = "◇ %d" % ceili(beacon_t)
		if beacon_p <= 0.0:
			beacon_p = 2.6
			pulse({x = world.core_p.x, y = 1.8, z = world.core_p.y, rng = 40.0, rays = 5000, col = Color(1, .85, .45), life = 3.0})
			noise(world.core_p.x, world.core_p.y, 140.0, "beacon")
			sfx.play_at("beacon", Vector3(world.core_p.x, 1.8, world.core_p.y))
		if beacon_t <= 0.0:
			set_obj(7)
			call_t = 0.0
			wake(6)


# ---------- 主更新 ----------
func _ok(x: float, z: float) -> bool:
	var r := .38
	return world.walk(world.cell_of(x - r), world.cell_of(z - r)) and world.walk(world.cell_of(x + r), world.cell_of(z - r)) \
		and world.walk(world.cell_of(x - r), world.cell_of(z + r)) and world.walk(world.cell_of(x + r), world.cell_of(z + r)) and not world.solid_at(x, z)


func update(dt: float) -> void:
	P.abs_flash -= dt
	P.pinged -= dt
	P.roar_fx -= dt
	P.whisper_cd -= dt
	P.active_cd -= dt
	P.fire_cd -= dt
	P.mend -= dt
	P.abs_min -= dt
	if P.abs_on:
		# 吸收场开着就一直烧声能；烧空，或松手且过了最短时长，就关
		P.energy -= ABS_DRAIN * dt
		if P.energy <= 0.0:
			P.energy = 0.0
			P.abs_on = false
		elif P.abs_min <= 0.0 and not (P.abs_hold or (not testing and Input.is_physical_key_pressed(KEY_F))):
			P.abs_on = false
	# 按住 Q：把声能灌进结构。修复本身在低鸣——每一拍都是一小圈回波，也是一次暴露
	P.mend_t -= dt
	if (P.mend_hold or (not testing and Input.is_physical_key_pressed(KEY_Q))) and P.hp < 100.0 and P.energy > 0.0:
		var use := minf(P.energy, MEND_COST * dt)
		P.energy -= use
		P.hp = minf(100.0, P.hp + use * MEND_RATE / MEND_COST)
		P.mend = .25
		if P.mend_t <= 0.0:
			P.mend_t = .5
			noise(P.x, P.z, 9.0, "player")
			sfx.play("mend")
			pulse({x = P.x, y = 1.0, z = P.z, rng = 3.4, rays = 220, col = Color(.2, .8, .8), life = 1.6, src = "player"})
	P.jam -= dt
	P.hurt -= dt
	P.hit_mark -= dt
	P.lock -= dt
	P.heat = maxf(0.0, P.heat - dt * 15.0)
	P.expo = maxf(0.0, P.expo - dt * maxf(6.0, P.expo * .9))
	var sneak := Input.is_physical_key_pressed(KEY_SHIFT)
	var spd := 1.6 if sneak else 3.4
	var mx := 0.0
	var mz := 0.0
	var fx := sin(P.yaw)
	var fz := -cos(P.yaw)
	if not testing:
		if Input.is_physical_key_pressed(KEY_W):
			mx += fx
			mz += fz
		if Input.is_physical_key_pressed(KEY_S):
			mx -= fx
			mz -= fz
		if Input.is_physical_key_pressed(KEY_D):
			mx -= fz
			mz += fx
		if Input.is_physical_key_pressed(KEY_A):
			mx += fz
			mz -= fx
		# 方向键也能转视角（任何输入环境下都可用的兜底）
		var kx := float(Input.is_physical_key_pressed(KEY_RIGHT)) - float(Input.is_physical_key_pressed(KEY_LEFT))
		var ky := float(Input.is_physical_key_pressed(KEY_UP)) - float(Input.is_physical_key_pressed(KEY_DOWN))
		P.yaw += kx * 2.0 * dt
		P.pitch = clampf(P.pitch + ky * 1.3 * dt, -1.2, 1.2)
	_soft_tick(dt)
	var ml := hyp(mx, mz)
	if ml > 0.0:
		mx = mx / ml * spd * dt
		mz = mz / ml * spd * dt
		if _ok(P.x + mx, P.z):
			P.x += mx
		if _ok(P.x, P.z + mz):
			P.z += mz
		if not sneak:
			P.step += spd * dt
			if P.step > 1.9:
				# 脚步：很小的一圈回波，也是很小的一次暴露
				P.step = 0.0
				noise(P.x, P.z, 4.5, "player")
				sfx.play("step")
				pulse({x = P.x, y = .25, z = P.z, rng = 2.6, rays = 120, col = Color(.2, .8, .8), life = 1.0, src = "player"})
	var here := world.floor_at(P.x, P.z)
	P.ey = lerpf(P.ey, 1.6 + (WorldData.th(P.x, P.z) if here == 1 else 0.0), 1.0 - exp(-dt * 6.0))
	P.covered = "黏液吸音" if here == 4 else ""
	# 心跳相位跟着心囊的声音走（没在响时按游戏时间），画面里的鼓动和听到的"咚"是同一拍
	var bp := sfx.beat_phase()
	if bp < 0.0:
		bp = fposmod(now / Sfx.BEAT, 1.0)
	var new_beat := bp < beat - .5
	beat = bp
	for i in world.ambients.size():
		var a := world.ambients[i]
		var d := hyp(a.x - P.x, a.y - P.z)
		if d < 5.0:
			# 心囊：心跳声掩护 + 安全回能
			gain(5.0 * dt)
			if P.covered == "":
				P.covered = "环境声"
		# 每一拍，心囊自己的声音把自己和周围照亮。声源放在心脏外侧三个方向、朝着它打——
		# 放在心室里面的话，射线全从内部穿出去，表面反而一个点都没有
		if new_beat and d < 40.0:
			for j in 3:
				var ha := j * TAU / 3.0 + i * 1.3 + .5
				var hx := a.x + cos(ha) * 1.9
				var hz := a.y + sin(ha) * 1.9
				if not world.walk(world.cell_of(hx), world.cell_of(hz)):
					continue
				pulse({x = hx, y = 1.5, z = hz, cone = Vector3(-cos(ha), .05, -sin(ha)).normalized(), ang = .8, rng = 5.0, rays = 420,
					col = Color(1, .85, .45), life = 2.2, speed = 12.0})
				if j == 0:
					pulse({x = hx, y = 1.0, z = hz, rng = 7.0, rays = 320, col = Color(1, .85, .45), life = 2.2, speed = 12.0})
	if Input.is_physical_key_pressed(KEY_SPACE) and not testing:
		whisper_sonar()
	if mic_on:
		mic_lvl = sfx.read_mic(dt)
		if mic_lvl > .07:
			mic_sonar(mic_lvl, dt)
	if P.charging >= 0.0:
		P.charging += dt
		if P.mode != 2:
			P.charging = -1.0
	for i in range(decoys.size() - 1, -1, -1):
		var dc: Array = decoys[i]
		dc[4] -= dt
		if dc[4] <= 0.0:
			dc[4] = .6
			pulse({x = dc[0], y = dc[1], z = dc[2], rng = 9.0, rays = 700, col = Color(1, .85, .4), life = 2.0})
			noise(dc[0], dc[2], 36.0, "decoy")
			sfx.play_at("decoy_beep", Vector3(dc[0], dc[1], dc[2]))
		if now > dc[3]:
			decoys.remove_at(i)
	# 潮听者按阶段苏醒：只在玩家够不着、看不到的地方醒
	for i in range(sleepers.size() - 1, -1, -1):
		var sl: Dictionary = sleepers[i]
		if sl.st > stage:
			continue
		var sd := hyp(sl.x - P.x, sl.z - P.z)
		if sd < 8.0 or (sd < 16.0 and world.los(sl.x, sl.z, P.x, P.z)):
			continue
		sleepers.remove_at(i)
		var ne := spawn_enemy(sl.x, sl.z)
		if sl.hint:
			ne.conf = .5
			ne.bx = sl.hx
			ne.bz = sl.hz
			ne.last_kind = "crystal"
		if sl.st > 0:
			sfx.play_at("e_hunt", Vector3(sl.x, 1.4, sl.z), .6, .6)
	for e in enemies:
		if test_freeze:
			break
		upd_enemy(e, dt)
		if state != "play":
			return
	story(dt)
	if state != "play":
		return
	for i in range(arcs.size() - 1, -1, -1):
		if now - arcs[i].t > arcs[i].dur:
			arcs.remove_at(i)
	# 被怒吼淹没的头一秒，整个人被声浪推得发抖
	var shk := clampf(P.roar_fx - (ROAR_JAM - 1.1), 0.0, 1.1) * .045
	cx = P.x + (randf() - .5) * shk
	cy = P.ey + ((randf() - .5) * .05 if P.hurt > 0.0 else 0.0) + (randf() - .5) * shk
	cz = P.z + (randf() - .5) * shk
	c_yaw = P.yaw + (randf() - .5) * shk * .5
	c_pitch = P.pitch + (randf() - .5) * shk * .5
	upd_hud(dt)


func ambience(dt: float, tr: float) -> void:
	hb_t -= dt
	if hb_t <= 0.0 and tr > .12:
		hb_t = lerpf(1.1, .42, tr)
		sfx.play("heart", (.25 + tr * .4) / .65)
	br_t -= dt
	if br_t <= 0.0:
		var per := lerpf(4.4, 1.5, tr)
		br_t = per
		sfx.play("breath", (.035 + tr * .07) / .07, 3.0 / per)
	gr_t -= dt
	if gr_t <= 0.0:
		# 远处不明来源的低吟
		gr_t = 14.0 + randf() * 22.0
		var a := randf() * TAU
		var pos := Vector3(cx + cos(a) * 30.0, 6.0, cz + sin(a) * 30.0)
		if randf() < .5:
			sfx.play_at("groan_a", pos, 1.0, randf_range(.8, 1.2))
		else:
			sfx.play_at("groan_b", pos)


func upd_hud(dt: float) -> void:
	var tr := 0.0
	var top: Enemy = null
	var known: Enemy = null         # 已探测到的里面最近的一只
	var nd := 1e9
	var det := 0
	for e in enemies:
		if e.dead:
			continue
		if e.last_kind == "player" and e.conf > tr:
			tr = e.conf
			top = e
		if now - e.seen < DETECT_T:
			det += 1
			var d := hyp(e.x - P.x, e.z - P.z)
			if d < nd:
				nd = d
				known = e
	P.trace = tr
	var per := lerpf(4.4, 1.5, tr)
	var br := maxf(0.0, sin(now * TAU / per))
	fog_k = clampf(.04 + br * (.1 + tr * .2) + mic_lvl * .6, 0.0, .9)
	ambience(dt, tr)
	yaw_v *= .6
	pitch_v *= .6
	# 只报探测到的：海里一共有多少，没人知道
	hud_alive = str(det) if det > 0 else "—"
	var se := top if top != null and now - top.seen < DETECT_T else known
	hud_state = "—" if se == null else (ST["stun"] if se.stun > 0.0 else ST[se.state])


# ---------- 开场：实机动画（intro.gd）→ 全黑 → 自检文字 → 声呐上线 ----------
func reset_game() -> void:
	now = 0.0
	events.clear()
	decoys.clear()
	arcs.clear()
	crystal_cd.clear()
	beacon_t = -1.0
	sonar.reset()
	set_hatch(false)
	for i in lore_seen.size():
		lore_seen[i] = false
	P = Player.new()
	P.x = world.PX - .45
	P.z = world.PZ
	P.yaw = PI / 2.0
	enemies.clear()
	sleepers.clear()
	for sp: Array in WorldData.SPAWN:
		sleepers.append({x = (sp[0] + .5) * CS, z = (sp[1] + .5) * CS, st = sp[2], hint = false, hx = 0.0, hz = 0.0})
	stage = 0
	keys_on.clear()
	for kc in world.keys:
		keys_on.append(false)
	key_t = 0.0
	call_t = 0.0
	roar_gap = 0.0
	set_door(false)
	stats = {"shots": 0, "pings": 0, "absorbed": 0, "hits": 0}
	lore_until = -1.0
	hb_t = 0.0
	br_t = 0.0
	gr_t = 8.0
	cx = P.x
	cy = 1.6
	cz = P.z
	c_yaw = P.yaw
	c_pitch = 0.0


func begin(mic: bool) -> void:
	if mic:
		sfx.start_mic()
		mic_on = sfx.mic_on
	if state == "end":
		menu.visible = false
		reset_game()
		sonar_on = false
		finish_intro(true)
		return
	start_intro()


func start_intro() -> void:
	reset_game()
	state = "intro"
	it = 0.0
	flooded = false
	sonar_on = false
	boot_i = 0
	boot_ch = 0.0
	boot_wait = 0.0
	boot_lines = []
	boot_a = 1.0
	boot_fade_at = -1.0
	menu.visible = false
	set_obj(8)
	hud_show = false
	stand = 0.0
	intro_pause = false
	sfx.set_muffle(9000.0)
	var t0 := Time.get_ticks_msec()
	intro.build(world)
	print("[intro] 建模耗时 ", Time.get_ticks_msec() - t0, " ms")
	intro.start()


func upd_intro(dt: float) -> void:
	if not intro_pause:
		it += dt
	if sonar_on:
		stand = minf(1.0, stand + dt * .8)
	intro.update(it, dt)
	if it > Intro.END_T:
		P.trace = .35
		ambience(dt, .35)
	else:
		P.trace = 0.0
	if it > 16.4 and not intro_pause:
		boot_step(dt)


func boot_step(dt: float) -> void:
	if boot_i >= BOOT.size():
		finish_intro(false)
		return
	if boot_wait > 0.0:
		boot_wait -= dt
		if boot_wait <= 0.0:
			boot_i += 1
			boot_ch = 0.0
		return
	var b: Array = BOOT[boot_i]
	var txt: String = b[0]
	if boot_lines.size() <= boot_i:
		boot_lines.append(["", b[2]])
	var pc := int(boot_ch)
	boot_ch += dt * 46.0
	boot_lines[boot_i][0] = txt.substr(0, int(boot_ch))
	if int(boot_ch) > pc and (pc & 1) == 0:
		sfx.play("boot_tick")
	if boot_ch >= txt.length():
		boot_wait = b[1]
		if b[2] == "r":
			sfx.play("boot_fail")
		if b[2] == "c":
			sfx.play("boot_ok")
		if boot_i == 5:
			sonar_wake()


func sonar_wake() -> void:
	if sonar_on:
		return
	sonar_on = true
	pulse({x = cx, y = cy, z = cz, rng = 9.0, rays = 6000, col = Color(.25, 1, 1), life = 6.0, src = "player"})
	sfx.play("wake")


func finish_intro(skipped: bool) -> void:
	flood = Color(0, 0, 0, 0)
	intro.finish()
	hud_show = true
	stand = 1.0
	sfx.set_muffle(3600.0)
	if skipped:
		boot_lines = []
		boot_a = 0.0
		sfx.start_drone()
	boot_fade_at = now + 2.5
	P.x = world.PX - .45
	P.z = world.PZ
	P.ey = 1.6
	P.yaw = PI / 2.0
	P.pitch = 0.0
	cx = P.x
	cy = 1.6
	cz = P.z
	c_yaw = P.yaw
	c_pitch = 0.0
	state = "play"
	set_obj(0)
	sonar_wake()
	sfx.start_hearts(world.ambients)
	if not testing:
		grab_mouse()


func end_game(win: bool) -> void:
	state = "end"
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	m_title.text = "潮 息" if win else "静 默"
	m_sub.text = "上浮缆已锁定 · 你喊出了最后一声" if win else "你的最后一声被听见了"
	m_body.text = "存活 %ds　开火 %d　命中 %d　大声呐 %d　吸收ping %d" % [int(now), stats.shots, stats.hits, stats.pings, stats.absorbed]
	b_mic.text = "再次下潜"
	b_no.visible = false
	(menu as ColorRect).color = Color(0, 0, 0, .86)
	menu.visible = true


# ---------- 自动验证（命令行加 -- --bt-test=<截图目录>） ----------
func _wait(t: float) -> void:
	await get_tree().create_timer(t).timeout


func _shot(dir: String, nm: String) -> void:
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	img.save_png(dir.path_join(nm + ".png"))
	var vp := get_viewport().get_viewport_rid()
	RenderingServer.viewport_set_measure_render_time(vp, true)
	print("   proc=%.2fms hud=%.2fms cpu=%.2fms gpu=%.2fms upd=%.2fms" % [Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0, hud.draw_us / 1000.0, RenderingServer.viewport_get_measured_render_time_cpu(vp), RenderingServer.viewport_get_measured_render_time_gpu(vp), upd_ms])
	print("[shot] ", nm, "  fps=", int(1000.0 / fms), " 峰=", int(fmax), "ms 点=", sonar.points_alive(), " 脉冲=", sonar.live.size(), " 上次脉冲=", "%.1f" % sonar.last_ms, "ms/", sonar.last_pts)
	fmax = 0.0


func _run_test(dir: String) -> void:
	await _wait(.5)
	await _shot(dir, "00_menu")
	begin(false)
	await _wait(4.2)
	await _shot(dir, "01_boot")
	finish_intro(true)
	await _wait(1.2)
	await _shot(dir, "02_pod")
	print("[test] 开局: 醒着=", enemies.size(), " 沉睡=", sleepers.size(), " HUD=", hud_alive, " 最近一只距离=", int(hyp(enemies[0].x - P.x, enemies[0].z - P.z)) if enemies.size() > 0 else -1)
	interact()
	await _wait(1.6)
	await _shot(dir, "03_hatch")
	P.x = 10.5
	P.z = 16.5
	P.yaw = PI / 2.0
	active_sonar()
	await _wait(1.3)
	await _shot(dir, "04_active_outdoor")
	P.x = 27.0 * CS + 1.5
	P.z = 10.0 * CS + 1.5
	P.yaw = PI / 2.0
	P.active_cd = 0.0
	active_sonar()
	await _wait(1.3)
	await _shot(dir, "05_active_ruin")
	print("[test] 进遗迹: obj=", obj, " ", obj_text, " stage=", stage, " 醒着=", enemies.size())
	P.yaw = 0.0
	P.fire_cd = 0.0
	fire(0.0)
	await _wait(.5)
	await _shot(dir, "06_fire")
	_wake_all()
	for q in enemies:
		q.stun = 120.0
	var e := enemies[1]
	P.x = e.x - 5.0
	P.z = e.z
	P.yaw = PI / 2.0
	P.active_cd = 0.0
	e.stun = 9.0
	active_sonar()
	await _wait(.9)
	await _shot(dir, "07_enemy_marked")
	print("[test] enemy0 conf=", "%.2f" % enemies[0].conf, " state=", enemies[0].state, "  energy=", int(P.energy), " expo=", int(P.expo), " stats=", stats)
	# 第二段：把其余玩法路径都走一遍，确认没有运行时错误
	throw_decoy()
	P.hp = 60.0
	P.abs_hold = true
	try_absorb()
	P.mode = 2
	P.fire_cd = 0.0
	fire(1.0)
	P.mode = 0
	P.fire_cd = 0.0
	fire(0.0)
	whisper_sonar()
	resonate(27, 8)
	show_lore(world.lores[0][2])
	e.stun = 0.0
	enemy_ping(e)
	_tune_set(.75, .7, 1.0)
	_tune_set(1.0, 1.0, 1.0)
	await _wait(.6)
	await _shot(dir, "08a_absorb")
	print("[test] 吸收场: on=", P.abs_on, " hp=", int(P.hp), " energy=", int(P.energy), " absorbed=", stats.absorbed)
	P.abs_hold = false
	P.mend_hold = true
	await _wait(.9)
	await _shot(dir, "08b_mend")
	print("[test] 松手后: on=", P.abs_on, "  修复 0.9s: hp=", int(P.hp), " energy=", int(P.energy), " expo=", int(P.expo))
	P.mend_hold = false
	var keep := P.energy
	P.energy = 5.0
	try_absorb()
	print("[test] 声能不足: on=", P.abs_on)
	P.energy = keep
	await _shot(dir, "08_combat")
	# 第三段：耳石 → 井门 → 信标 → 返回求生舱
	e.stun = 120.0
	P.hp = 100.0
	print("[test] HUD 已探测=", hud_alive, " 威胁=", hud_state)
	resonate(world.keys[0].x, world.keys[0].y)
	await _wait(.3)
	print("[test] 第一块耳石: ", keys_on, " ", obj_text, " stage=", stage, " 门开=", door_open)
	resonate(world.keys[1].x, world.keys[1].y)
	await _wait(1.8)
	print("[test] 第二块耳石: ", keys_on, " obj=", obj, " stage=", stage, " 门开=", door_open)
	P.x = world.door_p.x - 5.0
	P.z = world.door_p.y
	P.yaw = PI / 2.0
	P.active_cd = 0.0
	P.jam = 0.0
	active_sonar()
	await _wait(1.2)
	await _shot(dir, "08c_door")
	P.x = world.core_p.x - 2.5
	P.z = world.core_p.y
	await _wait(.2)
	print("[test] 到井: obj=", obj)
	interact()
	await _wait(1.2)
	await _shot(dir, "09_beacon")
	print("[test] obj=", obj, " beacon_t=", "%.1f" % beacon_t, " decoys=", decoys.size(), " heat=", int(P.heat), " hp=", int(P.hp), " stats=", stats)
	beacon_t = .05
	await _wait(.4)
	print("[test] 信标结束: obj=", obj, " ", obj_text, " stage=", stage)
	P.x = world.PX + 4.5
	P.z = world.PZ
	P.yaw = -PI / 2.0
	await _wait(1.0)
	await _shot(dir, "09b_return")
	P.x = world.PX - .45
	await _wait(.3)
	print("[test] 回到舱内: state=", state)
	await _wait(.4)
	await _shot(dir, "10_end")
	begin(false)
	await _wait(1.0)
	print("[test] restart state=", state, " now=", "%.1f" % now, " enemies=", enemies.size())
	get_tree().quit()


## 自检用：不管阶段，把所有潮听者都叫醒
func _wake_all() -> void:
	for sl: Dictionary in sleepers:
		spawn_enemy(sl.x, sl.z)
	sleepers.clear()


## 画面恐怖感巡检（命令行加 -- --bt-horror=<截图目录>）：三种姿态、声影、定格残影、低语声呐的明暗节奏
func _run_horror(dir: String) -> void:
	await _wait(.5)
	begin(false)
	await _wait(.6)
	finish_intro(true)
	await _wait(.8)
	test_freeze = true
	enemies.clear()
	sleepers.clear()
	var px := 26.0 * CS + .8
	var pz := 10.0 * CS + 1.5
	P.x = px
	P.z = pz
	P.yaw = PI / 2.0
	P.pitch = 0.0
	# 1. 三种姿态并排，面朝玩家
	var k := 0
	for st: String in ["drift", "sus", "hunt"]:
		var e := spawn_enemy(px + 4.6, pz + (k - 1) * 2.3)
		e.state = st
		e.yaw = -PI / 2.0
		k += 1
	sonar.reset()
	await _wait(.2)
	P.active_cd = 0.0
	active_sonar()
	await _wait(.7)
	await _shot(dir, "h1_poses")
	# 2. 声影：一只在 11 米外，身后 13 米是井门；再一只在 19 米外
	enemies.clear()
	var e1 := spawn_enemy(px + 11.0, pz - .6)
	e1.state = "hunt"
	e1.yaw = -PI / 2.0
	var e2 := spawn_enemy(px + 19.0, pz + 1.6)
	e2.state = "sus"
	e2.yaw = -PI / 2.0
	sonar.reset()
	await _wait(5.2)
	P.active_cd = 0.0
	active_sonar()
	await _wait(1.5)
	await _shot(dir, "h2_shadow")
	# 不带标记的一声（相当于对着麦克风正常说话）：远处那只应该只剩声影
	sonar.reset()
	await _wait(5.2)
	P.mic_t = 0.0
	mic_sonar(.48, .1)
	await _wait(1.3)
	await _shot(dir, "h2b_shadow_voice")
	# 3. 定格残影：它在黑暗里一步步靠近，每一声低语留下一个定格
	enemies.clear()
	var e3 := spawn_enemy(px + 6.8, pz + 2.6)
	e3.state = "hunt"
	e3.yaw = -PI / 2.0
	sonar.reset()
	await _wait(5.2)
	for i in 3:
		P.whisper_cd = 0.0
		P.jam = 0.0
		whisper_sonar()
		await _wait(1.2)
		e3.x -= .9
		e3.z -= 1.7
	await _wait(.1)
	await _shot(dir, "h3_ghosts")
	# 4. 低语声呐的明暗：一声之后 0.35 / 0.9 / 1.15 秒
	enemies.clear()
	sonar.reset()
	await _wait(5.2)
	P.whisper_cd = 0.0
	whisper_sonar()
	await _wait(.35)
	await _shot(dir, "h4_dark_035")
	await _wait(.55)
	await _shot(dir, "h4_dark_090")
	await _wait(.25)
	await _shot(dir, "h4_dark_115")
	# 4b. 怒吼：一只确信你在跟前的潮听者，6 米外
	sonar.reset()
	await _wait(5.2)
	var e4 := spawn_enemy(px + 6.0, pz + .5)
	e4.conf = 1.0
	e4.bx = P.x
	e4.bz = P.z
	e4.last_kind = "player"
	e4.yaw = -PI / 2.0
	e4.ping_t = 99.0
	test_freeze = false
	await _wait(.75)
	await _shot(dir, "h6_roar_075")
	await _wait(.6)
	await _shot(dir, "h6_roar_135")
	await _wait(.7)
	await _shot(dir, "h6_roar_205")
	print("[test] 怒吼: state=", e4.state, " jam=%.2f roar_fx=%.2f 距离=%.1f hp=%d" % [P.jam, P.roar_fx, hyp(P.x - e4.x, P.z - e4.z), int(P.hp)])
	test_freeze = true
	enemies.clear()
	P.jam = 0.0
	P.roar_fx = 0.0
	# 5. 新色阶下的远景：站在桥头朝遗迹喊一声
	sonar.reset()
	P.x = 17.0 * CS + 1.6
	P.z = 10.0 * CS + 1.5
	await _wait(.2)
	P.active_cd = 0.0
	active_sonar()
	await _wait(1.8)
	await _shot(dir, "h5_far")
	get_tree().quit()


## 场景物件巡检（命令行加 -- --bt-props=<截图目录>）：依次站到心囊、肋骨桥、颅骨、齿列、脉管林、巢室前各打一次声呐
func _run_props(dir: String) -> void:
	await _wait(.5)
	begin(false)
	await _wait(.6)
	finish_intro(true)
	await _wait(.8)
	for e in enemies:
		e.stun = 999.0
	var views: Array = []
	var a0 := world.ambients[0]
	views.append(["heart", a0.x - 4.2, a0.y, PI / 2.0, -.05])
	views.append(["ribs_bridge", 17.0 * CS + 1.6, 10.0 * CS + 1.5, PI / 2.0, .12])
	views.append(["ribs_side", 12.0 * CS + .6, 4.0 * CS + 1.5, PI / 2.0, .15])
	var pr := world.prim
	var got := {}
	@warning_ignore("integer_division")
	for i in pr.size() / WorldData.PST:
		var b := i * WorldData.PST
		if pr[b] == 4.0 and pr[b + 1] == 5.0 and pr[b + 9] >= 50.0 and got.size() < 2:
			var yw := pr[b + 9] - 100.0
			var sx := pr[b + 2] + cos(yw) * 3.2
			var sz := pr[b + 4] + sin(yw) * 3.2
			if world.walk(world.cell_of(sx), world.cell_of(sz)) and world.los(sx, sz, pr[b + 2], pr[b + 4]):
				got[i] = true
				views.append(["skull%d" % got.size(), sx, sz, atan2(-cos(yw), sin(yw)), -.12])
	views.append(["vessels", 10.5, 16.5, PI / 2.0, .15])
	views.append(["nest", 29.0 * CS + 1.5, 6.0 * CS + 2.2, 0.0, .3])
	views.append(["nave", 26.0 * CS + 1.5, 10.0 * CS + 1.5, PI / 2.0, .05])
	views.append(["archive", 29.0 * CS + 1.5, 14.0 * CS + 1.5, PI, .05])
	for v: Array in views:
		sonar.reset()
		P.x = v[1]
		P.z = v[2]
		P.yaw = v[3]
		P.pitch = v[4]
		P.active_cd = 0.0
		P.jam = 0.0
		P.energy = 100.0
		await _wait(.15)
		active_sonar()
		await _wait(1.1)
		await _shot(dir, "p_" + v[0])
	# 再从远处看一眼心囊：只靠它自己的心跳把自己照亮
	sonar.reset()
	P.x = a0.x - 6.5
	P.z = a0.y + 1.0
	P.yaw = PI / 2.0
	P.pitch = 0.0
	await _wait(2.6)
	await _shot(dir, "p_heart_selflit")
	get_tree().quit()


func _feed(p: Vector2) -> void:
	var ev := InputEventMouseMotion.new()
	ev.device = 77
	ev.position = p
	ev.global_position = p
	Input.parse_input_event(ev)


## 视角逻辑自测（命令行加 -- --bt-look）：用合成的鼠标事件，不碰真实光标
func _run_look_test() -> void:
	await _wait(.4)
	begin(false)
	finish_intro(true)
	test_look = true
	look_soft = true
	mp_valid = false
	warp_n = 0
	await get_tree().process_frame
	var c := get_viewport().get_visible_rect().size * .5
	_feed(c)
	await get_tree().process_frame
	var y0 := P.yaw
	_feed(c + Vector2(200, 0))
	await get_tree().process_frame
	await get_tree().process_frame
	print("[look] 右移 200 像素: yaw 变化 %.3f (应为 0.440)" % (P.yaw - y0))
	for i in 5:
		_feed(c + Vector2(200.0 + 100.0 * (i + 1), 0))
		await get_tree().process_frame
	await get_tree().process_frame
	await get_tree().process_frame
	var y1 := P.yaw
	print("[look] 推到右侧边缘: 累计 yaw %.3f (应为 1.540), 请求回中 %d 次, 等待中=%s" % [y1 - y0, warp_n, recenter_until > 0])
	_feed(c + Vector2(690, 0))
	_feed(c)
	await get_tree().process_frame
	await get_tree().process_frame
	print("[look] 回中后: yaw 跳变 %.4f (应为 0), 等待中=%s" % [P.yaw - y1, recenter_until > 0])
	_feed(c + Vector2(50, 0))
	await get_tree().process_frame
	await get_tree().process_frame
	print("[look] 回中后再右移 50: yaw 变化 %.3f (应为 0.110)" % (P.yaw - y1))
	for i in 300:
		_look(Vector2(0, -40))
	print("[look] 持续上抬: pitch %.3f (上限 1.200)" % P.pitch)
	for i in 600:
		_look(Vector2(0, 40))
	print("[look] 持续下压: pitch %.3f (下限 -1.200)" % P.pitch)
	# 回中失败路径：光标停在边缘、始终等不到回到中心的事件
	P.pitch = 0.0
	warp_n = 0
	_feed(c + Vector2(700, 0))
	await _wait(1.6)
	var y2 := P.yaw
	await _wait(.5)
	print("[look] 回中始终不生效: 请求 %d 次后放弃, 失败计数 %d, 贴边持续转向 0.5 秒 yaw +%.3f (应约 0.9)" % [warp_n, warp_fail, P.yaw - y2])
	get_tree().quit()
