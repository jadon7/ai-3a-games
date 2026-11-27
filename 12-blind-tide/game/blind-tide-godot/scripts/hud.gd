extends Control
## 头盔内侧 HUD。整层画在后期着色器之下，所以会跟世界一起被面罩的曲面畸变。

const CY := Color(.24, 1, 1)
const RD := Color(1, .19, .28)
const YL := Color(1, .84, .42)
const GUN := [6, 22, 124, 22, 134, 14, 174, 14, 174, 28, 194, 28, 194, 38, 136, 38, 128, 48, 102, 48, 96, 60, 76, 60, 80, 48, 6, 48, 6, 22]

var g                       # main.gd 实例
var font: Font
var on := 0.0
var hx := 0.0
var hy := 0.0
var _s := 1.0
var _fs := 14
var _a := 1.0


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)


func _process(_dt: float) -> void:
	queue_redraw()


func _c(c: Color, a := 1.0) -> Color:
	return Color(c.r, c.g, c.b, a * _a)


func _panel(x: float, y: float, w: float, h: float) -> void:
	draw_rect(Rect2(x, y, w, h), _c(Color(.08, .32, .36), .07))
	draw_rect(Rect2(x, y, w, h), _c(CY, .22), false, 1.0)


func _row(x: float, y: float, w: float, l: String, r: String, col: Color, a := 1.0) -> void:
	draw_string(font, Vector2(x, y + _fs), l, HORIZONTAL_ALIGNMENT_LEFT, -1, _fs, _c(col, a))
	if r != "":
		draw_string(font, Vector2(x, y + _fs), r, HORIZONTAL_ALIGNMENT_RIGHT, w, _fs, _c(col, a))


func _bar(x: float, y: float, w: float, k: float, col: Color) -> void:
	draw_rect(Rect2(x, y, w, 4.0 * _s), _c(col, .12))
	draw_rect(Rect2(x, y, w * clampf(k, 0.0, 1.0), 4.0 * _s), _c(col, .95))


var draw_us := 0


func _draw() -> void:
	if g == null or on <= .01:
		return
	var _t0 := Time.get_ticks_usec()
	var W := size.x
	var H := size.y
	_s = H / 900.0
	var s := _s
	_fs = int(15.0 * s)
	_a = on * .85
	var P = g.P
	var st: String = g.state
	if st == "play" and P.roar_fx > 0.0:
		# 声呐被怒吼淹没：整块面罩投影跟着断断续续
		_a *= .25 + .75 * float(randf() > .4)
	var now: float = g.now
	hx = lerpf(hx, clampf(-g.yaw_v * 900.0, -40.0, 40.0), .12)
	hy = lerpf(hy, clampf(g.pitch_v * 900.0, -30.0, 30.0), .12)
	draw_set_transform(Vector2(hx, hy) * s)
	var pw := 292.0 * s
	var pad := 12.0 * s
	var lh := 25.0 * s
	var iw := pw - pad * 2.0

	# 左上：供能与生命
	var x := W * .06
	var y := H * .10
	_panel(x, y, pw, lh * 4.0 + 34.0 * s)
	x += pad
	y += pad * .6
	_row(x, y, iw, "光供能 PHOTON", "✕", RD, .7)
	y += lh
	_row(x, y, iw, "电磁供能 EM", "✕", RD, .7)
	y += lh
	_row(x, y, iw, "声能 ACOUSTIC ⚠", str(int(P.energy)), YL)
	y += lh
	_bar(x, y, iw, P.energy / 100.0, YL)
	y += 9.0 * s
	# 正在把声能灌进结构时，这一行提亮并带一个上升标记
	var mending: bool = P.mend > 0.0
	var hc := Color(.75, 1, 1) if mending else CY
	_row(x, y, iw, "结构完整性", ("▲ " if mending else "") + str(int(maxf(0.0, P.hp))), hc)
	y += lh
	_bar(x, y, iw, P.hp / 100.0, hc)

	# 右上：威胁
	x = W * .94 - pw
	y = H * .10
	_panel(x, y, pw, lh * 4.0 + 34.0 * s)
	x += pad
	y += pad * .6
	_row(x, y, iw, "已探测声源", g.hud_alive, RD)
	y += lh
	_row(x, y, iw, "被定位置信 TRACE", "%d%%" % int(P.trace * 100.0), RD)
	y += lh
	_bar(x, y, iw, P.trace, RD)
	y += 9.0 * s
	_row(x, y, iw, "最近威胁状态", g.hud_state, RD)
	y += lh
	_row(x, y, iw, "暴露半径", "%dm" % int(P.expo), CY)
	y += lh
	_bar(x, y, iw, P.expo / 100.0, CY)

	# 左下：麦克风与掩护
	x = W * .07
	y = H * .89 - (lh * 5.0 + 30.0 * s)
	_panel(x, y, pw, lh * 5.0 + 30.0 * s)
	x += pad
	y += pad * .6
	_row(x, y, iw, "麦克风 MIC", ("%d%%" % int(g.mic_lvl * 100.0)) if g.mic_on else "离线", CY)
	y += lh
	_bar(x, y, iw, g.mic_lvl, CY)
	y += 9.0 * s
	_row(x, y, iw, "声学掩护", P.covered if P.covered != "" else "无", YL)
	y += lh
	# 吸收场、修复、假声源都从同一条声能里扣：这里只标各自的价钱，开着的那一项变白，声能不够的变红
	_row(x, y, iw, "吸收场 [F]", "◉ −20/s" if P.abs_on else "−20/s", Color.WHITE if P.abs_on else (RD if P.energy < g.ABS_OPEN else CY))
	y += lh
	_row(x, y, iw, "修复 [Q]", "▲ −12/s" if mending else "−12/s", Color.WHITE if mending else (RD if P.energy < 1.0 else CY), 1.0 if P.hp < 100.0 else .35)
	y += lh
	_row(x, y, iw, "假声源 [G]", "−15", RD if P.energy < 15.0 else CY)

	# 右下：武器（黑暗中看不见实体，只有这块投影）
	var ph := 68.0 * s + lh * 4.0 + 30.0 * s
	x = W * .93 - pw
	y = H * .89 - ph
	_panel(x, y, pw, ph)
	x += pad
	y += pad * .6
	var gs := iw / 200.0
	var flash: bool = P.fire_cd > .2
	var pts := PackedVector2Array()
	for i in range(0, GUN.size(), 2):
		pts.append(Vector2(x + GUN[i] * gs, y + GUN[i + 1] * gs))
	draw_polyline(pts, _c(Color.WHITE if flash else CY, 1.0), 1.6 * s, true)
	draw_rect(Rect2(x + 20.0 * gs, y + 27.0 * gs, 96.0 * gs, 6.0 * gs), _c(CY, .9), false, 1.0)
	draw_rect(Rect2(x + 20.0 * gs, y + 27.0 * gs, P.energy * .96 * gs, 6.0 * gs), _c(Color.WHITE if flash else CY, .9))
	y += 66.0 * s
	var modes := ["1 低语射击 −5", "2 标准 −12", "3 轰鸣蓄力 −30"]
	for i in 3:
		var act: bool = P.mode == i
		_row(x, y, iw, ("▶ " if act else "") + modes[i], "", CY, 1.0 if act else .3)
		y += lh
	_row(x, y, iw, "啸叫负载", "过载锁定" if P.lock > 0.0 else "%d%%" % int(P.heat), YL)
	y += lh
	_bar(x, y, iw, P.heat / 100.0, YL)

	# 准星、目标、日志
	draw_arc(Vector2(W / 2.0, H / 2.0), 3.5 * s, 0.0, TAU, 16, _c(CY, .7), 1.0, true)
	if g.obj_text != "":
		draw_string(font, Vector2(0, H * .07 + _fs), g.obj_text, HORIZONTAL_ALIGNMENT_CENTER, W, int(16 * s), _c(YL, .9))
	if g.lore_a > .01:
		var lw := minf(620.0 * s, W * .6)
		draw_multiline_string(font, Vector2(W / 2.0 - lw / 2.0, H * .13 + _fs), g.lore_text, HORIZONTAL_ALIGNMENT_CENTER, lw, int(16 * s), -1, _c(Color(.82, .94, .88), g.lore_a))
	if st == "play" and not g.mouse_grabbed():
		draw_string(font, Vector2(0, H * .40), "▣", HORIZONTAL_ALIGNMENT_CENTER, W, int(20 * s), _c(YL, 1.0))

	# 启动自检文字
	if g.boot_a > .01:
		var by := H * .27
		var bfs := int(17 * s)
		for l: Array in g.boot_lines:
			var col := CY
			if l[1] == "r":
				col = RD
			elif l[1] == "c":
				col = Color(.67, 1, 1)
			draw_string(font, Vector2(W * .24, by + bfs), l[0], HORIZONTAL_ALIGNMENT_LEFT, -1, bfs, _c(col, g.boot_a))
			by += 32.0 * s

	# 深度色标：回波延迟 → 颜色
	var dw := 240.0 * s
	var dx := W / 2.0 - dw / 2.0
	var dy := H * .94
	for i in 48:
		var t := (i + .5) / 48.0 * 45.0
		var c: Color = g.world.depth_col(t)
		draw_rect(Rect2(dx + dw * i / 48.0, dy, dw / 48.0 + 1.0, 3.0 * s), _c(c, .6))
	var k := 0
	for lab: String in ["0", "8", "16", "28", "45m"]:
		var lx: float = [0.0, 8.0, 16.0, 28.0, 45.0][k] / 45.0
		draw_string(font, Vector2(dx + dw * lx - 20.0 * s, dy + 18.0 * s), lab, HORIZONTAL_ALIGNMENT_CENTER, 40.0 * s, int(11 * s), _c(CY, .55))
		k += 1

	draw_set_transform(Vector2.ZERO)
	if st == "play":
		_draw_fx(W, H, s, P, now)
	draw_us = Time.get_ticks_usec() - _t0


## 方向性提示：敌人蓄力/ping 的红弧、吸收窗口、被定位、蓄力环、命中标记、受击
func _draw_fx(W: float, H: float, s: float, P, now: float) -> void:
	var c := Vector2(W / 2.0, H / 2.0)
	for a: Dictionary in g.arcs:
		var k: float = (now - a.t) / a.dur
		if k > 1.0 or k < 0.0:
			continue
		var sx: float = a.x
		var sz: float = a.z
		if a.e != null and not a.e.dead:
			sx = a.e.x
			sz = a.e.z
		var ang: float = atan2(sx - P.x, -(sz - P.z)) - P.yaw - PI / 2.0
		var d: float = Vector2(sx - P.x, sz - P.z).length()
		var nk := clampf(1.3 - d / 30.0, .25, 1.0)
		if a.k == 0:
			draw_arc(c, (130.0 - k * 14.0) * s, ang - .12 - k * .2, ang + .12 + k * .2, 16, Color(1, .19, .28, (.35 + .4 * sin(now * 40.0)) * nk), 2.0 * s, true)
		elif a.k == 1:
			draw_arc(c, (116.0 + k * 30.0) * s, ang - .42, ang + .42, 24, Color(1, .19, .28, (1.0 - k) * nk), (3.0 + 7.0 * nk) * s, true)
		elif a.k == 3:
			# 怒吼：一道又宽又厚的红弧，压在它所在的方向上
			draw_arc(c, (104.0 + k * 22.0) * s, ang - .85, ang + .85, 36, Color(1, .12, .2, .55 + .45 * sin(now * 46.0)), 13.0 * s, true)
		else:
			draw_arc(c, 96.0 * s, ang - .55, ang + .55, 24, Color(1, .92, .47, .6 + .4 * sin(now * 60.0)), 9.0 * s, true)
	if P.abs_on:
		# 吸收场开着：准星外一圈就是声能，随消耗一点点缩短
		var k: float = P.energy / 100.0
		draw_arc(c, 46.0 * s, 0.0, TAU, 48, Color(.24, 1, 1, .18), 1.0, true)
		draw_arc(c, 46.0 * s, -PI / 2.0, -PI / 2.0 + k * TAU, 48, Color(.24, 1, 1, .7 + .2 * sin(now * 30.0)), 3.0 * s, true)
	if P.abs_flash > 0.0:
		draw_arc(c, 34.0 * s, 0.0, TAU, 48, Color(.47, 1, 1, minf(1.0, P.abs_flash * 2.0)), 14.0 * P.abs_flash * s, true)
	if P.pinged > 0.0:
		var k: float = 1.0 - P.pinged / .7
		draw_arc(c, maxf(W, H) * (.75 - k * .6), 0.0, TAU, 96, Color(1, .19, .28, (1.0 - k) * .8), 6.0 * s, true)
	if P.charging >= 0.0:
		var k: float = clampf(P.charging / 1.4, 0.0, 1.0)
		draw_arc(c, 24.0 * s, -PI / 2.0, -PI / 2.0 + k * TAU, 40, Color(1, .84, .42, .9), 4.0 * s, true)
	if P.hit_mark > 0.0:
		for q: Vector2 in [Vector2(1, 1), Vector2(1, -1), Vector2(-1, 1), Vector2(-1, -1)]:
			draw_line(c + q * 8.0 * s, c + q * 16.0 * s, Color(1, 1, 1, .9), 2.0 * s, true)
	if P.hurt > 0.0:
		for i in int(400.0 * P.hurt):
			draw_rect(Rect2(randf() * W, randf() * H, (2.0 + randf() * 26.0) * s, (1.0 + randf() * 3.0) * s), Color(1, randf() * .16, randf() * .2, randf() * .7))
		draw_rect(Rect2(0, 0, W, H), Color(.63, 0, .04, P.hurt * .25))
