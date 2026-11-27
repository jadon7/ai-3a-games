extends Control
# Combat HUD drawn with CanvasItem primitives.

const Tex = preload("res://scripts/tex.gd")
const U = preload("res://scripts/u.gd")

const C_MAIN := Color(0.66, 0.96, 0.74)
const C_DIM := Color(0.66, 0.96, 0.74, 0.4)
const C_WARN := Color(1.0, 0.72, 0.25)
const C_ALERT := Color(1.0, 0.3, 0.2)
const C_ALLY := Color(0.45, 0.8, 1.0)
const C_BG := Color(0.02, 0.03, 0.025, 0.55)

var game
var font: Font
var radio_q: Array = []
var radio_cur = null
var radio_t := 0.0
var banner = null
var kills: Array = []
var hit_t := 0.0
var dmg_dirs: Array = []
var notice = null
var time := 0.0
var sway := Vector2.ZERO
var lock_snd_t := 0.0
var scan_t := 0.0
var cancel_t := 0.0


func setup(g) -> void:
	game = g
	font = Tex.font
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func reset() -> void:
	radio_q.clear()
	radio_cur = null
	banner = null
	kills.clear()
	dmg_dirs.clear()
	notice = null


func radio(who: String, text: String, col: Color = C_MAIN) -> void:
	radio_q.append({"who": who, "text": text, "col": col})


func show_banner(title: String, sub: String, col: Color = C_MAIN, dur: float = 4.0) -> void:
	banner = {"title": title, "sub": sub, "col": col, "t": 0.0, "dur": dur}
	game.sfx.play2d("banner", 0.7)


func kill(text: String) -> void:
	kills.append({"text": text, "t": 0.0})


func hit_marker() -> void:
	hit_t = 0.18


func damage_from(world_pos: Vector3) -> void:
	dmg_dirs.append({"pos": world_pos, "t": 0.0})
	if dmg_dirs.size() > 6:
		dmg_dirs.pop_front()


func scan_pulse() -> void:
	scan_t = 1.0
	game.sfx.play2d("lock", 0.7, 0.7)


func note(text: String, col: Color = C_WARN, dur: float = 1.6) -> void:
	notice = {"text": text, "col": col, "t": 0.0, "dur": dur}


func tick(dt: float) -> void:
	time += dt
	hit_t = maxf(0.0, hit_t - dt)
	scan_t = maxf(0.0, scan_t - dt * 1.1)
	cancel_t = maxf(0.0, cancel_t - dt)
	if radio_cur == null and not radio_q.is_empty():
		radio_cur = radio_q.pop_front()
		radio_t = 0.0
		game.sfx.play2d("radio", 0.6)
	if radio_cur != null:
		radio_t += dt
		var txt: String = radio_cur["text"]
		if radio_t > 2.2 + txt.length() * 0.085:
			radio_cur = null
	if banner != null:
		banner["t"] += dt
		if banner["t"] > banner["dur"]:
			banner = null
	if notice != null:
		notice["t"] += dt
		if notice["t"] > notice["dur"]:
			notice = null
	for k in kills:
		k["t"] += dt
	while not kills.is_empty() and kills[0]["t"] > 2.6:
		kills.pop_front()
	for d in dmg_dirs:
		d["t"] += dt
	while not dmg_dirs.is_empty() and dmg_dirs[0]["t"] > 1.2:
		dmg_dirs.pop_front()
	queue_redraw()


const Pad = preload("res://scripts/pad_glyph.gd")
const PAD_FIRE := ["RT", "LT", "RB", "DL", "DR"]


func _txt(text: String, x: float, y: float, sz: int, col: Color, align: int = 0) -> void:
	if align == 0:
		draw_string(font, Vector2(x, y), text, HORIZONTAL_ALIGNMENT_LEFT, -1, sz, col)
	elif align == 1:
		draw_string(font, Vector2(x - 500, y), text, HORIZONTAL_ALIGNMENT_CENTER, 1000, sz, col)
	else:
		draw_string(font, Vector2(x - 1000, y), text, HORIZONTAL_ALIGNMENT_RIGHT, 1000, sz, col)


func _bar(x: float, y: float, w: float, h: float, v: float, col: Color, segs: int = 0) -> void:
	draw_rect(Rect2(x - 2, y - 2, w + 4, h + 4), Color(0, 0, 0, 0.6))          # dark backing: a bar must read over anything
	draw_rect(Rect2(x, y, w, h), Color(col, 0.14))
	draw_rect(Rect2(x, y, w * clampf(v, 0.0, 1.0), h), col)
	draw_rect(Rect2(x - 1, y - 1, w + 2, h + 2), Color(col, 0.5), false, 1.0)
	if segs > 0:
		for i in range(1, segs):
			var sx := x + w * i / segs
			draw_line(Vector2(sx, y), Vector2(sx, y + h), Color(0, 0, 0, 0.7), 2.0)


func _brackets(c: Vector2, half: float, col: Color, th: float = 2.0, len_k: float = 0.3) -> void:
	var l := half * len_k
	for sx in [-1.0, 1.0]:
		for sy in [-1.0, 1.0]:
			var p := c + Vector2(sx * half, sy * half)
			draw_line(p, p - Vector2(sx * l, 0), col, th)
			draw_line(p, p - Vector2(0, sy * l), col, th)


# The HUD is a helmet display: everything is drawn inside one visor outline, on two tinted bands (brow and
# chin), so it reads as a layer in front of the cabin rather than as more cabin instruments.
#   brow:   mission and timer (left), heading (middle), locked target (right)
#   sight:  armour arc on its left, thruster arc on its right, speed and height at the heads of the arcs,
#           the two hand weapons' rounds beside it
#   chin:   armour figure, shield, stability, repairs (left); weapons (right); the middle is cut out
const VM := 18.0            # visor margin
const BROW := 96.0
const CHIN := 112.0


func _draw() -> void:
	if game == null or game.player == null or game.state != "play":
		return
	var p = game.player
	var pc = game.pc
	var cam: Camera3D = game.cam
	var w := size.x
	var h := size.y
	var cx := w * 0.5
	var cy := h * 0.5
	var blink := fmod(time, 0.5) < 0.25
	var o := sway
	_draw_visor(w, h, pc.cockpit)
	if scan_t > 0.0:
		# expanding sweep rings of a weak-point scan
		var sk := 1.0 - scan_t
		for q in 3:
			var rr := (sk + q * 0.12) * maxf(w, h) * 0.75
			draw_arc(Vector2(cx, cy), rr, 0, TAU, 96, Color(1.0, 0.85, 0.3, scan_t * (0.55 - q * 0.15)), 3.0 - q * 0.8, true)
	_draw_markers(p, pc, cam, w, h)
	_draw_reticle(p, pc, cx + o.x, cy + o.y, blink)
	_draw_compass(pc, cx, VM + 22.0)
	_draw_mission(VM + 58.0, VM + 26.0)
	_draw_radio(cx, VM + BROW + 40.0)
	_draw_target(pc, w - VM - 58.0, VM + 30.0)
	var yb := h - VM - CHIN
	if not pc.cockpit:
		# in the cockpit the radar is the instrument panel's own tube
		_draw_radar(p, pc, VM + 116.0, yb - 104.0, 90.0)
	_draw_vitals(p, VM + 30.0, yb, blink)
	_draw_weapons(p, w - VM - 30.0, yb)
	_draw_alerts(p, cx, cy, blink)
	_draw_stance(p, cx + o.x, cy + o.y)


# the visor: outline with cut corners and a notch over the nose, dark outside it, tinted bands inside
func _draw_visor(w: float, h: float, pit: bool) -> void:
	var m := VM
	var k := 54.0
	var cx := w * 0.5
	var nw := 190.0           # half width of the notch at the rim
	var nh := 40.0
	var tint := Color(0.0, 0.022, 0.02, 0.92 if pit else 0.62)
	# outside the visor
	var dark := Color(0, 0, 0, 0.62)
	draw_rect(Rect2(0, 0, w, m), dark)
	draw_rect(Rect2(0, h - m, w, m), dark)
	draw_rect(Rect2(0, m, m, h - 2 * m), dark)
	draw_rect(Rect2(w - m, m, m, h - 2 * m), dark)
	for sx in [0.0, 1.0]:
		for sy in [0.0, 1.0]:
			var c := Vector2(m + sx * (w - 2 * m), m + sy * (h - 2 * m))
			var dx: float = k * (1.0 - 2.0 * sx)
			var dy: float = k * (1.0 - 2.0 * sy)
			draw_colored_polygon(PackedVector2Array([c, c + Vector2(dx, 0), c + Vector2(0, dy)]), dark)
	draw_colored_polygon(PackedVector2Array([Vector2(cx - nw, h - m), Vector2(cx - nw + nh, h - m - nh), Vector2(cx + nw - nh, h - m - nh), Vector2(cx + nw, h - m)]), Color(0, 0, 0, 0.3))
	# brow band
	draw_colored_polygon(PackedVector2Array([Vector2(m + k, m), Vector2(w - m - k, m), Vector2(w - m, m + k), Vector2(w - m, m + BROW),
		Vector2(cx + 300, m + BROW), Vector2(cx + 270, m + BROW - 22), Vector2(cx - 270, m + BROW - 22), Vector2(cx - 300, m + BROW),
		Vector2(m, m + BROW), Vector2(m, m + k)]), tint)
	# chin bands either side of the notch
	var yb := h - m - CHIN
	draw_colored_polygon(PackedVector2Array([Vector2(m, yb), Vector2(cx - nw - 150, yb), Vector2(cx - nw - 60, h - m), Vector2(m + k, h - m), Vector2(m, h - m - k)]), tint)
	draw_colored_polygon(PackedVector2Array([Vector2(w - m, yb), Vector2(w - m, h - m - k), Vector2(w - m - k, h - m), Vector2(cx + nw + 60, h - m), Vector2(cx + nw + 150, yb)]), tint)
	# rim
	var rim := PackedVector2Array([Vector2(m + k, m), Vector2(w - m - k, m), Vector2(w - m, m + k), Vector2(w - m, h - m - k), Vector2(w - m - k, h - m),
		Vector2(cx + nw, h - m), Vector2(cx + nw - nh, h - m - nh), Vector2(cx - nw + nh, h - m - nh), Vector2(cx - nw, h - m),
		Vector2(m + k, h - m), Vector2(m, h - m - k), Vector2(m, m + k), Vector2(m + k, m)])
	draw_polyline(rim, Color(C_MAIN, 0.6), 2.0, true)
	# inner edges of the bands
	var edge := Color(C_MAIN, 0.28)
	draw_polyline(PackedVector2Array([Vector2(m, m + BROW), Vector2(cx - 300, m + BROW), Vector2(cx - 270, m + BROW - 22), Vector2(cx + 270, m + BROW - 22),
		Vector2(cx + 300, m + BROW), Vector2(w - m, m + BROW)]), edge, 1.0, true)
	draw_polyline(PackedVector2Array([Vector2(m, yb), Vector2(cx - nw - 150, yb), Vector2(cx - nw - 60, h - m)]), edge, 1.0, true)
	draw_polyline(PackedVector2Array([Vector2(w - m, yb), Vector2(cx + nw + 150, yb), Vector2(cx + nw + 60, h - m)]), edge, 1.0, true)
	# graduations down both sides, between the bands
	var gy := m + BROW + 30.0
	while gy < yb - 20.0:
		draw_line(Vector2(m, gy), Vector2(m + 7.0, gy), edge, 1.0)
		draw_line(Vector2(w - m, gy), Vector2(w - m - 7.0, gy), edge, 1.0)
		gy += 36.0
	_txt("HMD  //  TF-LINK", cx, h - m - nh - 8.0, 12, C_DIM, 1)


func _gauge(c: Vector2, r: float, a_from: float, a_to: float, v: float, col: Color, th: float) -> void:
	# an arc from a_from to a_to, lit from a_from as far as v
	draw_arc(c, r, minf(a_from, a_to), maxf(a_from, a_to), 28, Color(col, 0.16), th, true)
	var a := lerpf(a_from, a_to, clampf(v, 0.0, 1.0))
	if absf(a - a_from) > 0.01:
		draw_arc(c, r, minf(a_from, a), maxf(a_from, a), 28, col, th, true)


func _draw_reticle(p, pc, x: float, y: float, blink: bool) -> void:
	var c := Vector2(x, y)
	var col := C_MAIN
	if pc.lock != null:
		col = C_ALERT
	for a in [0.0, 0.5, 1.0, 1.5]:
		draw_arc(c, 34.0, a * PI + 0.25, a * PI + PI * 0.5 - 0.25, 12, col, 1.6, true)
	for d in [Vector2(1, 0), Vector2(-1, 0), Vector2(0, 1), Vector2(0, -1)]:
		draw_line(c + d * 8.0, c + d * 20.0, col, 1.6, true)
	draw_circle(c, 1.6, col)
	if hit_t > 0.0:
		for d in [Vector2(1, 1), Vector2(-1, 1), Vector2(1, -1), Vector2(-1, -1)]:
			draw_line(c + d * 10.0, c + d * 19.0, Color(1, 1, 1, hit_t / 0.18), 2.5, true)
	var spd := Vector2(p.velocity.x, p.velocity.z).length() * 3.6
	var alt: float = p.global_position.y - (0.0 if game.world.space else game.world.height(p.global_position.x, p.global_position.z))
	var R := 132.0
	var sp := 0.62
	# left: armour, with the shield as a thin arc outside it
	var frac: float = p.ap / p.ap_max
	var acol := C_MAIN
	if frac < 0.25:
		acol = C_ALERT if blink else Color(C_ALERT, 0.45)
	elif frac < 0.5:
		acol = C_WARN
	_gauge(c, R, PI - sp, PI + sp, frac, acol, 6.0)
	if p.shield_max > 0.0 and p.shield_hp > 0.0:
		_gauge(c, R + 9.0, PI - sp, PI + sp, p.shield_hp / p.shield_max, C_ALLY, 2.5)
	_txt("%d" % int(ceil(p.ap)), x - 96.0, y + 106.0, 20, acol, 2)
	_txt("AP", x - 154.0, y + 104.0, 13, C_DIM, 2)
	_txt("%d" % int(spd), x - 96.0, y - 88.0, 16, C_MAIN, 2)
	_txt("SPD", x - 138.0, y - 88.0, 13, C_DIM, 2)
	# right: thrusters
	var th: float = p.thrust
	var tcol := C_MAIN
	if p.overheat_t > 0.0:
		tcol = C_ALERT if blink else Color(C_ALERT, 0.35)
		th = 1.0 - p.overheat_t / float(p.def["overheat"])
	elif th < 0.25:
		tcol = C_WARN
	_gauge(c, R, sp, -sp, th, tcol, 6.0)
	_txt("HEAT" if p.overheat_t > 0.0 else "%d" % int(th * 100.0), x + 96.0, y + 106.0, 20, tcol)
	_txt("EN", x + 150.0, y + 104.0, 13, C_DIM)
	_txt("%d" % int(alt), x + 96.0, y - 88.0, 16, C_MAIN)
	_txt("ALT", x + 138.0, y - 88.0, 13, C_DIM)
	# the two hand weapons' rounds beside the sight
	for i in 2:
		if i >= p.weapons.size() or p.weapons[i] == null:
			continue
		var wq = p.weapons[i]
		var s := -1.0 if i == 0 else 1.0
		var ok: bool = wq.reload_t <= 0.0 and not wq.overheated
		var t := "%d" % wq.ammo
		if wq.is_beam:
			t = "HOT" if wq.overheated else "%d" % int((1.0 - wq.heat) * 100.0)
		elif not ok:
			t = "RLD"
		_txt(t, x + s * 50.0, y + 34.0, 15, C_MAIN if ok else C_WARN, 2 if s < 0.0 else 0)
	for wp in p.weapons:
		if wp == null:
			continue
		if wp.is_charge and wp.charging:
			var full: bool = wp.charge >= 1.0
			var cc := Color(0.6, 0.9, 1.0)
			if full and blink:
				cc = Color(1, 1, 1)
			draw_arc(c, 52.0, 0, TAU, 48, Color(cc, 0.15), 4.0, true)
			draw_arc(c, 52.0, -PI * 0.5, -PI * 0.5 + TAU * wp.charge, 48, cc, 4.0, true)
			_txt("FULL CHARGE" if full else "CHARGE %d%%" % int(wp.charge * 100.0), x, y - 66, 15, cc, 1)
		elif wp.is_beam and (wp.heat > 0.02 or wp.overheated):
			var hc := Color(1.0, 0.8, 0.5)
			if wp.overheated:
				hc = C_ALERT if blink else Color(C_ALERT, 0.4)
			elif wp.heat > 0.7:
				hc = C_WARN
			draw_arc(c, 60.0, PI - 0.9, PI + 0.9, 24, Color(hc, 0.15), 5.0, true)
			draw_arc(c, 60.0, PI - 0.9, PI - 0.9 + 1.8 * wp.heat, 24, hc, 5.0, true)
	if p.od_on:
		for a in [0.0, 0.5, 1.0, 1.5]:
			draw_arc(c, 42.0, a * PI + 0.5 + time * 2.0, a * PI + PI * 0.5 - 0.5 + time * 2.0, 10, Color(1.0, 0.5, 0.2, 0.8), 2.0, true)


# under the reticle: recovery after a shot, braced stance, dash-cancel flash
func _draw_stance(p, x: float, y: float) -> void:
	var yy := y + 96.0
	if p.recover_t > 0.0:
		_bar(x - 60, yy, 120, 5, clampf(p.recover_t / 0.9, 0.0, 1.0), C_WARN)
		_txt("RECOVERY  ·  推进取消", x, yy + 22, 13, C_WARN, 1)
	elif p.bracing:
		var need := 0.01
		for wp in p.weapons:
			if wp != null and wp.d.has("brace"):
				need = maxf(need, float(wp.d["brace"]))
		var k := clampf(p.brace_t / need, 0.0, 1.0)
		_bar(x - 60, yy, 120, 5, k, C_MAIN if k >= 1.0 else C_DIM)
		_txt("BRACED  站定" if k >= 1.0 else "BRACING…", x, yy + 22, 13, C_MAIN, 1)
	elif p.brace_fail > 0.0:
		_txt("需落地站定  GROUND TO FIRE", x, yy + 22, 14, C_ALERT, 1)
	if p.state == "melee":
		var cn: int = (p.melee.get("moves", []) as Array).size()
		if cn > 1:
			for q in cn:
				var on: bool = q < p.melee_combo
				draw_rect(Rect2(x - cn * 9.0 + q * 18.0, y + 78.0, 14, 5), Color(C_WARN, 1.0 if on else 0.25))
	if p.state == "melee" and p.melee_charge > 0.02:
		var full: bool = p.melee_charge >= 1.0
		_bar(x - 60, yy, 120, 6, p.melee_charge, Color(1, 1, 1) if full else C_WARN)
		_txt("蓄力斩  FULL" if full else "蓄力中…", x, yy + 22, 13, C_WARN, 1)
	if cancel_t > 0.0:
		_txt("CANCEL", x, y - 62, 16, Color(1, 1, 1, cancel_t / 0.5), 1)
	if not p.hook.is_empty():
		_txt("ANCHOR  ·  SHIFT / Q 脱钩", x, yy + 40, 13, C_ALLY, 1)


func _draw_compass(pc, cx: float, y: float) -> void:
	var hdg := fposmod(-rad_to_deg(pc.yaw), 360.0)
	var half := 300.0
	draw_line(Vector2(cx - half, y + 16), Vector2(cx + half, y + 16), C_DIM, 1.5)
	var names := {0: "N", 90: "E", 180: "S", 270: "W"}
	var start := int(floor((hdg - 50.0) / 5.0)) * 5
	for d in range(start, start + 105, 5):
		var off := (d - hdg) * 6.0
		if absf(off) > half:
			continue
		var dd := posmod(d, 360)
		var big := dd % 30 == 0
		draw_line(Vector2(cx + off, y + 16), Vector2(cx + off, y + (2 if big else 9)), C_MAIN if big else C_DIM, 1.5)
		if big:
			var label: String = names[dd] if names.has(dd) else "%03d" % dd
			_txt(label, cx + off, y - 4, 16, C_MAIN, 1)
	draw_colored_polygon(PackedVector2Array([Vector2(cx, y + 20), Vector2(cx - 7, y + 32), Vector2(cx + 7, y + 32)]), C_MAIN)
	_txt("%03d" % int(hdg), cx, y + 52, 18, C_MAIN, 1)


func _draw_mission(x: float, y: float) -> void:
	var ms = game.mission
	if ms == null:
		return
	_txt("%s // PHASE %02d" % [str(ms.title), ms.phase], x, y, 13, C_DIM)
	var tl: float = maxf(ms.time_left, 0.0)
	var tcol := C_MAIN if tl > 120.0 else C_WARN
	_txt("%02d:%02d:%02d" % [int(tl / 60.0), int(tl) % 60, int(fmod(tl, 1.0) * 100.0)], x, y + 34.0, 28, tcol)
	draw_line(Vector2(x + 148.0, y + 8.0), Vector2(x + 148.0, y + 52.0), C_DIM, 1.0)
	var ly := y + 22.0
	var n := 0
	for ln in ms.objective_lines():
		var done: bool = ln[1]
		_txt(("■ " if done else "□ ") + str(ln[0]), x + 160.0, ly, 17, C_DIM if done else C_MAIN)
		ly += 24.0
		n += 1
		if n >= 2:
			break


func _draw_radio(cx: float, y: float) -> void:
	if radio_cur == null:
		return
	var who: String = radio_cur["who"]
	var text: String = radio_cur["text"]
	var n := int(radio_t * 38.0)
	var shown := text.substr(0, n)
	var a := clampf(radio_t * 6.0, 0.0, 1.0)
	var tw := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, 24).x
	var ww := font.get_string_size(who, HORIZONTAL_ALIGNMENT_LEFT, -1, 20).x
	var total := tw + ww + 70.0
	var x := cx - total * 0.5
	draw_rect(Rect2(x - 16, y - 28, total + 32, 42), Color(0.02, 0.03, 0.025, 0.6 * a))
	draw_rect(Rect2(x - 16, y - 28, 4, 42), radio_cur["col"])
	_txt(who, x, y, 20, radio_cur["col"])
	_txt("<<  " + shown + ("  >>" if n >= text.length() else ""), x + ww + 14, y + 1, 24, Color(0.93, 0.95, 0.9, a))


func _draw_target(pc, x: float, y: float) -> void:
	var t = pc.lock
	if t == null:
		return
	var bw := 300.0
	var bx := x - bw
	draw_rect(Rect2(bx - 12.0, y - 16.0, 3.0, 62.0), C_ALERT)
	_txt(t.unit_name, bx, y + 4.0, 20, C_ALERT)
	var dist: float = t.global_position.distance_to(game.player.global_position)
	_txt("%d m" % int(dist), x, y + 4.0, 18, C_MAIN, 2)
	_bar(bx, y + 16.0, bw - 64.0, 8.0, t.ap / t.ap_max, C_ALERT)
	_txt("%d" % int(t.ap), x, y + 26.0, 14, C_MAIN, 2)
	if t.kind == "mech" and t.shield_hp > 0.0:
		_bar(bx, y + 28.0, (bw - 64.0) * 0.5, 3.0, t.shield_hp / t.shield_max, C_ALLY)
	if t.kind == "mech":
		var sv: float = 1.0 - t.impact / t.poise
		var st: String = t.state
		if st == "stagger" or st == "down":
			sv = 0.0
		_bar(bx, y + 37.0, bw - 64.0, 4.0, sv, C_WARN)
		if st == "stagger":
			_txt("STAGGER", x, y + 44.0, 13, C_WARN, 2)
		elif st == "down":
			_txt("DOWN", x, y + 44.0, 13, C_WARN, 2)


func _draw_markers(p, pc, cam: Camera3D, w: float, h: float) -> void:
	var f := h / (2.0 * tan(deg_to_rad(cam.fov) * 0.5))
	for u in game.units:
		if not u.alive or u == p:
			continue
		var c: Vector3 = u.center()
		var dist := c.distance_to(cam.global_position)
		var marked: bool = u.mark_t > 0.0 and u.team != p.team
		if dist > (2600.0 if (u.objective or marked) else 1100.0) or u.hidden:
			continue
		var enemy: bool = u.team != p.team
		var locked: bool = u == pc.lock
		if cam.is_position_behind(c):
			continue
		var sp := cam.unproject_position(c)
		if sp.x < -50 or sp.x > w + 50 or sp.y < -50 or sp.y > h + 50:
			if locked:
				var dir := (sp - Vector2(w * 0.5, h * 0.5)).normalized()
				var ep := Vector2(w * 0.5, h * 0.5) + dir * minf(w, h) * 0.42
				draw_colored_polygon(PackedVector2Array([ep + dir * 16.0, ep + dir.orthogonal() * 9.0, ep - dir.orthogonal() * 9.0]), C_ALERT)
			continue
		var half := clampf(u.hit_h * f / dist * 0.55, 14.0, 150.0)
		if not enemy:
			if u.objective:
				var dc := C_ALLY
				if u.ap / u.ap_max < 0.35:
					dc = C_ALERT if fmod(time, 0.5) < 0.25 else C_WARN
				_brackets(sp, half, Color(dc, 0.8), 2.0, 0.2)
				_txt("DEFEND  " + u.unit_name, sp.x, sp.y - half - 8, 15, dc, 1)
				_bar(sp.x - 50, sp.y + half + 8, 100, 5, u.ap / u.ap_max, dc)
			elif dist < 700.0:
				_brackets(sp, half * 0.8, Color(C_ALLY, 0.7), 1.5, 0.22)
				_txt(u.callsign, sp.x, sp.y - half * 0.8 - 8, 15, C_ALLY, 1)
			continue
		var col := C_ALERT if locked else Color(C_MAIN, 0.85)
		_brackets(sp, half, col, 2.5 if locked else 1.6)
		if marked:
			# weak point exposed: yellow diamond + remaining time
			var mc := Color(1.0, 0.85, 0.3)
			var dr := half * 0.5 + 5.0 + sin(time * 9.0) * 2.0
			draw_polyline(PackedVector2Array([sp + Vector2(0, -dr), sp + Vector2(dr, 0), sp + Vector2(0, dr), sp + Vector2(-dr, 0), sp + Vector2(0, -dr)]), mc, 2.0, true)
			_txt("WEAK +%d%%  %ds" % [int(round((u.mark_mul - 1.0) * 100.0)), int(ceil(u.mark_t))], sp.x - half - 6, sp.y + half, 14, mc, 2)
		if u.objective:
			_txt("TGT", sp.x, sp.y - half - 8, 16, C_WARN, 1)
		_txt("%d" % int(dist), sp.x + half + 6, sp.y + half, 15, col)
		if locked:
			var r := half * 1.25 + 6.0
			var rot := time * 1.5
			var pts := PackedVector2Array()
			for i in 5:
				pts.append(sp + Vector2(cos(rot + i * PI * 0.5), sin(rot + i * PI * 0.5)) * r)
			draw_polyline(pts, C_ALERT, 1.6, true)
			_txt(u.unit_name, sp.x, sp.y + half + 24, 16, C_ALERT, 1)
			# AP pip bar under target
			_bar(sp.x - 40, sp.y + half + 30, 80, 4, u.ap / u.ap_max, C_ALERT)
			# missile lock ring
			var need := 0.0
			for wp in p.weapons:
				if wp != null:
					need = maxf(need, float(wp.d.get("lock", 0.0)))
			if need > 0.0:
				var k := clampf(p.c_lock_t / need, 0.0, 1.0)
				if k < 1.0:
					draw_arc(sp, r + 14.0 + (1.0 - k) * 40.0, 0, TAU, 40, Color(C_WARN, 0.8), 1.5, true)
				else:
					draw_arc(sp, r + 12.0, 0, TAU, 40, C_ALERT, 2.5, true)
					_txt("MSL LOCK", sp.x, sp.y - half - (30 if u.objective else 12), 15, C_ALERT, 1)


func _draw_radar(p, pc, x: float, y: float, r: float) -> void:
	var c := Vector2(x, y)
	draw_circle(c, r, Color(0.02, 0.04, 0.03, 0.55))
	draw_arc(c, r, 0, TAU, 48, C_MAIN, 1.6, true)
	draw_arc(c, r * 0.66, 0, TAU, 40, C_DIM, 1.0, true)
	draw_arc(c, r * 0.33, 0, TAU, 32, C_DIM, 1.0, true)
	draw_line(c - Vector2(r, 0), c + Vector2(r, 0), Color(C_MAIN, 0.2), 1.0)
	draw_line(c - Vector2(0, r), c + Vector2(0, r), Color(C_MAIN, 0.2), 1.0)
	var sw := time * 2.2
	for i in 14:
		draw_line(c, c + Vector2(cos(sw - i * 0.035), sin(sw - i * 0.035)) * r, Color(C_MAIN, 0.22 * (1.0 - i / 14.0)), 2.0)
	var rng: float = game.world.radar
	var yaw: float = pc.yaw
	var pp: Vector3 = p.global_position
	for u in game.units:
		if not u.alive or u == p:
			continue
		var d: Vector3 = u.global_position - pp
		# rotate into view space: forward (-Z at yaw 0) points up on the scope
		var rx := d.x * cos(yaw) - d.z * sin(yaw)
		var rz := d.x * sin(yaw) + d.z * cos(yaw)
		var v := Vector2(rx, rz) / rng * r
		var far := false
		if v.length() > r - 5.0:
			v = v.normalized() * (r - 5.0)
			far = true
		var col := C_ALLY if u.team == p.team else C_ALERT
		if far:
			col.a = 0.45
		if u.hidden:
			continue
		if u.objective:
			var oc := C_WARN if u.team != p.team else C_ALLY
			draw_colored_polygon(PackedVector2Array([c + v + Vector2(0, -6), c + v + Vector2(6, 0), c + v + Vector2(0, 6), c + v + Vector2(-6, 0)]), oc if not far else Color(oc, 0.5))
		elif u.airborne:
			draw_colored_polygon(PackedVector2Array([c + v + Vector2(0, -6), c + v + Vector2(5, 5), c + v + Vector2(-5, 5)]), col)
		elif u.kind == "mech":
			draw_circle(c + v, 4.0, col)
		else:
			draw_rect(Rect2(c + v - Vector2(3, 3), Vector2(6, 6)), col)
		if u == pc.lock:
			draw_arc(c + v, 8.0, 0, TAU, 12, C_ALERT, 1.5, true)
	draw_colored_polygon(PackedVector2Array([c + Vector2(0, -9), c + Vector2(6, 7), c + Vector2(-6, 7)]), C_MAIN)
	_txt("RADAR %dm" % int(rng), x - r, y - r - 10, 13, C_DIM)


# chin, left: the frame's own state. x = left edge, yb = top of the chin band
func _draw_vitals(p, x: float, yb: float, blink: bool) -> void:
	var frac: float = p.ap / p.ap_max
	var col := C_MAIN
	if frac < 0.25:
		col = C_ALERT
	elif frac < 0.5:
		col = C_WARN
	var bx := x + 118.0
	var bw := 250.0
	_txt("AP", x, yb + 24.0, 14, C_MAIN)
	_txt("%d" % int(ceil(p.ap)), x, yb + 66.0, 42, col)
	_bar(bx, yb + 34.0, bw, 20.0, frac, col, 20)
	var sv: float = 1.0 - p.impact / p.poise
	if p.state == "stagger" or p.state == "down":
		sv = 0.0
	_bar(bx, yb + 62.0, bw, 6.0, sv, C_WARN if sv > 0.3 else C_ALERT)
	_txt("STB", bx + bw + 8.0, yb + 70.0, 12, C_DIM)
	if p.shield_max > 0.0:
		var sf: float = p.shield_hp / p.shield_max
		var sc := C_ALERT if sf <= 0.0 else (C_ALLY if sf > 0.3 else C_WARN)
		_bar(bx, yb + 16.0, 118.0, 7.0, sf, sc, 4)
		_txt("SHD" if sf > 0.0 else "SHD BROKEN", bx + bw + 8.0, yb + 24.0, 12, sc)
	if not p.sys.is_empty():
		var oc := Color(C_WARN, 0.75)
		var label := str(p.sys["tag"])
		if p.od_on:
			oc = Color(1.0, 0.45, 0.15) if blink else Color(1.0, 0.7, 0.3)
			label = "%s  %.1fs" % [str(p.sys["tag"]), maxf(p.od_t, 0.0)]
		elif p.od >= 1.0:
			oc = Color(1, 1, 1) if blink else C_WARN
			label = "%s  READY [V]" % str(p.sys["tag"])
		_bar(bx + 132.0, yb + 16.0, 118.0, 7.0, p.od, oc)
		if game.pad_mode and p.od >= 1.0 and not p.od_on:
			Pad.line(self, font, ["%s  READY  " % str(p.sys["tag"]), "@DU"], bx + bw, yb + 96.0, 14, oc, 2)
		else:
			_txt(label, bx + bw, yb + 96.0, 14, oc, 2)
	var kc := C_MAIN if p.repair_kits > 0 else C_DIM
	if game.pad_mode:
		Pad.line(self, font, ["REPAIR ", "@DD", " x%d" % p.repair_kits], bx, yb + 96.0, 14, kc)
	else:
		_txt("REPAIR [R] x%d" % p.repair_kits, bx, yb + 96.0, 14, kc)


# chin, right: one line per weapon. x = right edge, yb = top of the chin band
func _draw_weapons(p, x: float, yb: float) -> void:
	var keys := ["LMB", "RMB", "E", "G", "B"]
	var bw := 300.0
	var ni: int = p.next_r(p.r_idx, 1)
	var other = p.w_r[ni] if ni != p.r_idx else null
	if other != null:
		var sc := C_WARN if p.swap_t > 0.0 else C_DIM
		if game.pad_mode:
			Pad.line(self, font, ["@Y", " >> %s" % str(other.d["tag"])], x, yb - 8.0, 12, sc, 2)
		else:
			_txt("[X] >> %s" % str(other.d["tag"]), x, yb - 8.0, 12, sc, 2)
	var ry := yb + 26.0
	for i in p.weapons.size():
		var wp = p.weapons[i]
		if wp == null:
			continue
		var d: Dictionary = wp.d
		var ready: bool = wp.reload_t <= 0.0 and not wp.overheated
		var col := C_MAIN if ready else C_WARN
		if game.pad_mode:
			Pad.draw(self, font, PAD_FIRE[i], Vector2(x - bw + 18.0, ry - 6.0), 22.0, col)
		else:
			draw_rect(Rect2(x - bw, ry - 15.0, 36.0, 18.0), Color(col, 0.16))
			draw_rect(Rect2(x - bw, ry - 15.0, 36.0, 18.0), Color(col, 0.6), false, 1.0)
			_txt(keys[i], x - bw + 18.0, ry - 1.0, 12, col, 1)
		_txt(str(d["tag"]), x - bw + 46.0, ry, 16, col)
		if wp.no_lock_hint > 0.0:
			_txt("NO LOCK", x - 96.0, ry, 12, C_ALERT, 2)
		if wp.is_beam:
			var hc := C_ALERT if wp.overheated else (C_WARN if wp.heat > 0.7 else C_MAIN)
			_bar(x - 90.0, ry - 10.0, 90.0, 7.0, wp.heat, hc)
		elif ready:
			_txt("%d" % wp.ammo, x - 34.0, ry + 1.0, 20, col, 2)
			_txt("/%d" % int(d["mag"]), x, ry, 12, C_DIM, 2)
			if wp.is_charge and wp.charge > 0.0:
				_bar(x - 150.0, ry - 9.0, 60.0, 5.0, wp.charge, Color(1, 1, 1) if wp.charge >= 1.0 else C_WARN)
		else:
			_txt("COOL" if d.has("cool") else "RLD", x - 98.0, ry, 12, C_WARN, 2)
			_bar(x - 90.0, ry - 9.0, 90.0, 6.0, 1.0 - wp.reload_t / float(d["reload"]), C_WARN)
		ry += 23.0
	var m: Dictionary = p.melee
	var mready: bool = p.melee_cd <= 0.0 and p.overheat_t <= 0.0
	var mcol := C_MAIN if mready else C_DIM
	if game.pad_mode:
		Pad.draw(self, font, "X", Vector2(x - bw + 18.0, ry - 6.0), 22.0, mcol)
	else:
		draw_rect(Rect2(x - bw, ry - 15.0, 36.0, 18.0), Color(mcol, 0.16))
		draw_rect(Rect2(x - bw, ry - 15.0, 36.0, 18.0), Color(mcol, 0.6), false, 1.0)
		_txt("F", x - bw + 18.0, ry - 1.0, 12, mcol, 1)
	_txt(str(m["tag"]), x - bw + 46.0, ry, 16, mcol)
	_txt("READY" if mready else "----", x, ry, 12, mcol, 2)


func _draw_alerts(p, cx: float, cy: float, blink: bool) -> void:
	# damage direction arcs
	var yaw: float = game.pc.yaw
	for d in dmg_dirs:
		var dp: Vector3 = d["pos"]
		var v: Vector3 = dp - p.global_position
		var rx := v.x * cos(yaw) - v.z * sin(yaw)
		var rz := v.x * sin(yaw) + v.z * cos(yaw)
		var ang := atan2(rz, rx)
		var a := 1.0 - float(d["t"]) / 1.2
		draw_arc(Vector2(cx, cy), 190.0, ang - 0.28, ang + 0.28, 14, Color(C_ALERT, a * 0.9), 9.0, true)
	var inc: int = game.proj.incoming(p)
	if inc > 0:
		if blink:
			draw_rect(Rect2(cx - 190, cy - 262, 380, 44), Color(C_ALERT, 0.2))
			draw_rect(Rect2(cx - 190, cy - 262, 380, 44), C_ALERT, false, 2.0)
			_txt("WARNING  //  MISSILE", cx, cy - 232, 24, C_ALERT, 1)
		lock_snd_t -= get_process_delta_time()
		if lock_snd_t <= 0.0:
			lock_snd_t = 0.5
			game.sfx.play2d("warn", 0.5)
	# armour alarm: a banner over the sight and hazard chevrons running down both edges
	if p.alive and p.ap / p.ap_max < 0.25:
		var a_pulse := 0.5 + 0.5 * sin(time * 8.4)
		if blink:
			draw_rect(Rect2(cx - 235, cy - 206, 470, 40), Color(C_ALERT, 0.18))
			draw_rect(Rect2(cx - 235, cy - 206, 470, 40), C_ALERT, false, 2.0)
			_txt("WARNING  //  ARMOR CRITICAL  装甲临界", cx, cy - 178, 20, C_ALERT, 1)
		for a_x in [0.0, size.x - 14.0]:
			var a_y := fmod(time * 60.0, 44.0) - 44.0
			while a_y < size.y:
				draw_colored_polygon(PackedVector2Array([Vector2(a_x, a_y + 22.0), Vector2(a_x + 14.0, a_y), Vector2(a_x + 14.0, a_y + 22.0), Vector2(a_x, a_y + 44.0)]), Color(C_ALERT, 0.22 + 0.4 * a_pulse))
				a_y += 44.0
	if p.state == "stagger" or p.state == "down":
		_txt("硬直 STAGGER" if p.state == "stagger" else "倒地 DOWN", cx, cy - 180, 30, C_WARN if blink else Color(C_WARN, 0.5), 1)
	if notice != null:
		var a2 := clampf((float(notice["dur"]) - float(notice["t"])) * 3.0, 0.0, 1.0)
		_txt(notice["text"], cx, cy + 210, 24, Color(notice["col"], a2), 1)
	var ky := cy + 250.0
	for k in kills:
		var a3 := clampf(2.6 - float(k["t"]), 0.0, 1.0)
		_txt("DESTROYED", cx, ky, 26, Color(C_MAIN, a3), 1)
		_txt(k["text"], cx, ky + 24, 18, Color(0.9, 0.95, 0.9, a3), 1)
		ky += 56.0
	if banner != null:
		var t: float = banner["t"]
		var dur: float = banner["dur"]
		var a4 := clampf(t * 4.0, 0.0, 1.0) * clampf((dur - t) * 2.0, 0.0, 1.0)
		var bc: Color = banner["col"]
		var wd := 760.0 * clampf(t * 5.0, 0.0, 1.0)
		draw_rect(Rect2(cx - wd * 0.5, cy - 330, wd, 92), Color(0.02, 0.03, 0.025, 0.72 * a4))
		draw_rect(Rect2(cx - wd * 0.5, cy - 330, wd, 3), Color(bc, a4))
		draw_rect(Rect2(cx - wd * 0.5, cy - 241, wd, 3), Color(bc, a4))
		_txt(banner["title"], cx, cy - 288, 38, Color(bc, a4), 1)
		_txt(banner["sub"], cx, cy - 254, 22, Color(0.92, 0.94, 0.9, a4), 1)
