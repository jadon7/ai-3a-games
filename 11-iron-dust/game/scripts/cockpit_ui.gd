extends Control
# Live content of the cockpit's instruments, drawn into one off-screen atlas and mapped
# onto the display faces of the cockpit model:
#   radar CRT (0, 0, 384, 384) · status CRT (384, 0, 256, 384) · sight (640, 0, 128, 128)
#   four round warning displays (i * 128, 384, 128, 128)
#   two touch panels: arms (0, 512, 384, 256) · systems (384, 512, 384, 256)
# The touch panels stand in for banks of switches: every control is a flat key that lights
# while its function is live and ripples when the pilot uses it.

const Tex = preload("res://scripts/tex.gd")

const ATLAS := Vector2(768, 768)
const R_TOUCH_L := Rect2(0, 512, 384, 256)
const R_TOUCH_R := Rect2(384, 512, 384, 256)
const T_BG := Color(0.012, 0.03, 0.05)
const T_LINE := Color(0.4, 0.82, 1.0)
const T_TXT := Color(0.86, 0.95, 1.0)
const T_WARN := Color(1.0, 0.72, 0.2)
const R_RADAR := Rect2(0, 0, 384, 384)
const R_STATUS := Rect2(384, 0, 256, 384)
const R_SCOPE := Rect2(640, 0, 128, 128)
const G := Color(0.35, 1.0, 0.45)
const G_DIM := Color(0.35, 1.0, 0.45, 0.35)
const RED := Color(1.0, 0.22, 0.12)

var game
var m
var pc
var t := 0.0
var noise := 0.0          # 0..1: picture breaking up after a hit
var warn := [false, false, false, false]
var _prev := {}           # last seen values, to notice a control being used
var _ripples: Array = []  # [centre, birth time]
var _sb: StyleBoxFlat


static func warn_rect(i: int) -> Rect2:
	return Rect2(i * 128.0, 384.0, 128.0, 128.0)


func _txt(text: String, x: float, y: float, sz: int, col: Color, align: int = 0) -> void:
	if align == 0:
		draw_string(Tex.font, Vector2(x, y), text, HORIZONTAL_ALIGNMENT_LEFT, -1, sz, col)
	elif align == 1:
		draw_string(Tex.font, Vector2(x - 300, y), text, HORIZONTAL_ALIGNMENT_CENTER, 600, sz, col)
	else:
		draw_string(Tex.font, Vector2(x - 600, y), text, HORIZONTAL_ALIGNMENT_RIGHT, 600, sz, col)


func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, ATLAS), Color(0, 0, 0))
	if m == null or game == null or pc == null:
		return
	_radar()
	_status()
	_scope()
	_warns()
	_touch_arms()
	_touch_systems()
	for rp in _ripples:
		var age: float = t - float(rp[1])
		draw_arc(rp[0], 8.0 + age * 110.0, 0, TAU, 28, Color(T_TXT, clampf(1.0 - age / 0.45, 0.0, 1.0) * 0.9), 2.5, true)
	_ripples = _ripples.filter(func(r): return t - float(r[1]) < 0.45)
	# CRT scan lines over the tubes (the touch panels are flat glass), hit noise over everything
	var y := 0.0
	while y < 512.0:
		draw_line(Vector2(0, y), Vector2(ATLAS.x, y), Color(0, 0, 0, 0.28), 1.0)
		y += 3.0
	if noise > 0.02:
		for i in int(noise * 70.0):
			var yy := randf() * ATLAS.y
			draw_rect(Rect2(randf() * ATLAS.x, yy, randf_range(30, 260), randf_range(1, 5)), Color(1, 1, 1, randf() * 0.5 * noise))


func _radar() -> void:
	var c := R_RADAR.position + R_RADAR.size * 0.5
	var r := 176.0
	draw_circle(c, 190.0, Color(0.01, 0.07, 0.03))
	for k in [0.25, 0.5, 0.75, 1.0]:
		draw_arc(c, r * k, 0, TAU, 64, G_DIM, 1.5, true)
	for i in 12:
		var a := TAU * i / 12.0
		draw_line(c + Vector2(cos(a), sin(a)) * (r * 0.25), c + Vector2(cos(a), sin(a)) * r, Color(G, 0.12), 1.0)
	draw_line(c - Vector2(r, 0), c + Vector2(r, 0), G_DIM, 1.0)
	draw_line(c - Vector2(0, r), c + Vector2(0, r), G_DIM, 1.0)
	var sw := t * 2.4
	for i in 22:
		draw_line(c, c + Vector2(cos(sw - i * 0.03), sin(sw - i * 0.03)) * r, Color(G, 0.3 * (1.0 - i / 22.0)), 3.0)
	var rng: float = game.world.radar
	var yaw: float = pc.yaw
	var pp: Vector3 = m.global_position
	for u in game.units:
		if not u.alive or u == m or u.hidden:
			continue
		var d: Vector3 = u.global_position - pp
		var v := Vector2(d.x * cos(yaw) - d.z * sin(yaw), d.x * sin(yaw) + d.z * cos(yaw)) / rng * r
		var far := v.length() > r - 8.0
		if far:
			v = v.normalized() * (r - 8.0)
		var p := c + v
		var foe: bool = u.team != m.team
		var a := 0.5 if far else 1.0
		if u.objective:
			draw_colored_polygon(PackedVector2Array([p + Vector2(0, -8), p + Vector2(8, 0), p + Vector2(0, 8), p + Vector2(-8, 0)]), Color(G, a) if not foe else Color(1.0, 1.0, 0.6, a))
		elif foe:
			# hostile: solid; above or below the frame: a tick shows which
			draw_rect(Rect2(p - Vector2(5, 5), Vector2(10, 10)), Color(0.85, 1.0, 0.7, a))
			if absf(d.y) > 25.0:
				draw_line(p, p + Vector2(0, -11.0 * signf(d.y)), Color(0.85, 1.0, 0.7, a), 2.0)
		else:
			draw_arc(p, 5.0, 0, TAU, 10, Color(G, a * 0.8), 2.0, true)
		if u == pc.lock:
			draw_arc(p, 12.0, 0, TAU, 16, Color(1, 1, 1), 2.0, true)
	draw_colored_polygon(PackedVector2Array([c + Vector2(0, -11), c + Vector2(8, 9), c + Vector2(-8, 9)]), G)
	_txt("%dm" % int(rng), c.x, c.y + r - 6.0, 15, G_DIM, 1)
	var hdg := int(fposmod(-rad_to_deg(yaw), 360.0))
	_txt("%03d" % hdg, c.x, c.y - r + 22.0, 18, G, 1)


func _bar(x: float, y: float, w: float, h: float, v: float, col: Color) -> void:
	draw_rect(Rect2(x, y, w, h), Color(col, 0.16))
	draw_rect(Rect2(x, y, w * clampf(v, 0.0, 1.0), h), col)


func _status() -> void:
	var o := R_STATUS.position
	draw_rect(R_STATUS, Color(0.01, 0.06, 0.025))
	var hp: float = clampf(m.ap / m.ap_max, 0.0, 1.0)
	var blink := fmod(t, 0.5) < 0.25
	_txt(str(m.def["en"]), o.x + 128, o.y + 26, 20, G, 1)
	# frame silhouette: parts go from outline to hatched to blinking as the frame is hurt
	var cx := o.x + 128.0
	var parts := [
		[Rect2(cx - 13, o.y + 40, 26, 22), 0.9], [Rect2(cx - 36, o.y + 66, 72, 62), 0.3], [Rect2(cx - 62, o.y + 68, 22, 74), 0.7],
		[Rect2(cx + 40, o.y + 68, 22, 74), 0.55], [Rect2(cx - 30, o.y + 132, 60, 26), 0.45], [Rect2(cx - 34, o.y + 162, 28, 84), 0.8], [Rect2(cx + 6, o.y + 162, 28, 84), 0.65],
	]
	for pt in parts:
		var rc: Rect2 = pt[0]
		var hurt: bool = hp < float(pt[1])
		var col := G
		if hurt:
			col = Color(1.0, 1.0, 0.5) if (hp > float(pt[1]) * 0.5 or blink) else Color(G, 0.2)
			draw_rect(rc, Color(col, 0.3))
		draw_rect(rc, col, false, 2.0)
	if m.shield_max > 0.0:
		var sr := Rect2(cx - 84, o.y + 74, 14, 62)
		draw_rect(sr, G if m.shield_hp > 0.0 else Color(G, 0.2), false, 2.0)
		draw_rect(Rect2(sr.position.x, sr.end.y - sr.size.y * (m.shield_hp / m.shield_max), 14, sr.size.y * (m.shield_hp / m.shield_max)), Color(G, 0.5))
	var y := o.y + 262.0
	_txt("AP", o.x + 14, y + 12, 15, G_DIM)
	_bar(o.x + 46, y, 150, 12, hp, G if hp > 0.25 or blink else Color(G, 0.3))
	_txt("%d" % int(m.ap), o.x + 246, y + 13, 15, G, 2)
	y += 20.0
	_txt("THR", o.x + 14, y + 12, 15, G_DIM)
	_bar(o.x + 46, y, 150, 12, m.thrust, G if m.overheat_t <= 0.0 else Color(1, 1, 0.5))
	if m.overheat_t > 0.0 and blink:
		_txt("HEAT", o.x + 246, y + 13, 15, Color(1, 1, 0.5), 2)
	y += 22.0
	var keys := ["L", "R", "E", "G", "B"]
	for i in m.weapons.size():
		var w = m.weapons[i]
		if w == null or y > o.y + 372.0:
			continue
		_txt("%s %s" % [keys[i], str(w.d["tag"])], o.x + 14, y + 12, 14, G)
		var s := ""
		if w.is_beam:
			s = "OVHT" if w.overheated else "%d%%" % int(w.heat * 100.0)
		elif w.reload_t > 0.0:
			s = "RLD"
		else:
			s = "%d" % w.ammo
		_txt(s, o.x + 246, y + 12, 14, G if s != "RLD" and s != "OVHT" else Color(1, 1, 0.5), 2)
		y += 17.0


func _scope() -> void:
	var c := R_SCOPE.position + R_SCOPE.size * 0.5
	draw_rect(R_SCOPE, Color(0.01, 0.06, 0.03))
	draw_arc(c, 40.0, 0, TAU, 32, G, 2.0, true)
	draw_arc(c, 14.0, 0, TAU, 20, G_DIM, 1.5, true)
	for d in [Vector2(1, 0), Vector2(-1, 0), Vector2(0, 1), Vector2(0, -1)]:
		draw_line(c + d * 18.0, c + d * 58.0, G, 2.0)
	var lk = pc.lock
	if lk != null:
		var dist: float = lk.global_position.distance_to(m.global_position)
		_txt("%d" % int(dist), c.x, c.y + 58.0, 16, G, 1)
		var a := t * 3.0
		for i in 4:
			draw_arc(c, 48.0, a + i * PI * 0.5, a + i * PI * 0.5 + 0.6, 6, Color(1, 1, 1), 3.0, true)
	var w0 = m.weapons[0]
	if w0 != null and w0.charge > 0.01:
		draw_arc(c, 54.0, -PI * 0.5, -PI * 0.5 + TAU * w0.charge, 32, Color(1, 1, 0.6), 4.0, true)
	elif m.bracing:
		draw_arc(c, 54.0, -PI * 0.5, -PI * 0.5 + TAU * clampf(m.brace_t / 0.4, 0.0, 1.0), 32, G, 4.0, true)


func _warns() -> void:
	var labels := ["MSL", "HEAT", "DMG", "LOCK"]
	var blink := fmod(t, 0.4) < 0.2
	for i in 4:
		var rc := warn_rect(i)
		var c := rc.position + rc.size * 0.5
		var on: bool = warn[i]
		var lit: bool = on and (blink or i == 3)
		draw_circle(c, 64.0, Color(0.5, 0.05, 0.03) if lit else Color(0.09, 0.012, 0.01))
		var col := Color(1.0, 0.85, 0.75) if lit else Color(RED, 0.55 if on else 0.3)
		draw_arc(c, 50.0, 0, TAU, 40, col, 4.0, true)
		if i == 0:
			draw_colored_polygon(PackedVector2Array([c + Vector2(0, -34), c + Vector2(12, -6), c + Vector2(-12, -6)]), col)
			draw_rect(Rect2(c.x - 6, c.y - 6, 12, 22), col)
		elif i == 1:
			for q in 3:
				draw_arc(c + Vector2(-16 + q * 16, -8), 9.0, PI * 0.5, PI * 1.5, 8, col, 3.0)
				draw_arc(c + Vector2(-16 + q * 16, -26), 9.0, -PI * 0.5, PI * 0.5, 8, col, 3.0)
		elif i == 2:
			draw_line(c + Vector2(-22, -30), c + Vector2(22, 6), col, 5.0)
			draw_line(c + Vector2(22, -30), c + Vector2(-22, 6), col, 5.0)
		else:
			draw_arc(c + Vector2(0, -12), 18.0, 0, TAU, 20, col, 3.0, true)
			draw_line(c + Vector2(-28, -12), c + Vector2(28, -12), col, 2.0)
			draw_line(c + Vector2(0, -40), c + Vector2(0, 16), col, 2.0)
		_txt(labels[i], c.x, c.y + 40.0, 20, col, 1)


# ------------------------------------------------------------------ touch panels
# a control was used when its watched value moved the way `rising` says
func _used(id: String, v: float, rising: bool = true) -> bool:
	var had: bool = _prev.has(id)
	var old: float = _prev.get(id, v)
	_prev[id] = v
	return had and ((v > old + 0.0001) if rising else (v < old - 0.0001))


func _key(rc: Rect2, lit: float, col: Color = T_LINE, tap: bool = false, snd: bool = true) -> void:
	if _sb == null:
		_sb = StyleBoxFlat.new()
		_sb.set_corner_radius_all(7)
		_sb.set_border_width_all(2)
		_sb.anti_aliasing = true
	_sb.bg_color = Color(col, 0.07 + 0.3 * clampf(lit, 0.0, 1.0))
	_sb.border_color = Color(col, 0.45 + 0.55 * clampf(lit, 0.0, 1.0))
	draw_style_box(_sb, rc)
	if tap:
		_ripples.append([rc.position + rc.size * 0.5, t])
		if snd and game != null:
			game.sfx.play2d("touch", 0.5, randf_range(0.95, 1.05))


func _touch_arms() -> void:
	var o := R_TOUCH_L.position
	draw_rect(R_TOUCH_L, T_BG)
	_txt("ARMS", o.x + 12, o.y + 24, 16, Color(T_LINE, 0.7))
	# hand-weapon tabs: the one in the hand is lit, a swap ripples on the new tab
	var swapped := _used("ridx", float(m.r_idx), true)
	swapped = _used("ridx2", float(m.r_idx), false) or swapped
	var tx := o.x + 78.0
	for i in m.w_r.size():
		var w = m.w_r[i]
		if w == null:
			continue
		var cur: bool = i == m.r_idx
		_key(Rect2(tx, o.y + 6, 96, 26), 1.0 if cur else 0.0, T_LINE, cur and swapped)
		_txt(str(w.d["tag"]), tx + 48, o.y + 25, 14, T_TXT if cur else Color(T_TXT, 0.5), 1)
		tx += 101.0
	var keys := ["L", "R", "E", "G", "B"]
	var y := o.y + 40.0
	for i in m.weapons.size():
		var w = m.weapons[i]
		if w == null:
			continue
		var busy: bool = w.reload_t > 0.0 or w.overheated
		var col := T_WARN if busy else T_LINE
		var fired := false
		if w.is_beam:
			fired = _used("heat%d" % i, w.heat, true)
		else:
			fired = _used("ammo%d" % i, float(w.ammo), false)
		_key(Rect2(o.x + 8, y, 368, 32), 0.6 if fired else (0.15 if not busy else 0.0), col, fired and not w.is_beam, false)
		_txt(keys[i], o.x + 24, y + 22, 15, Color(col, 0.8), 1)
		_txt(str(w.d["tag"]), o.x + 44, y + 22, 16, T_TXT)
		var v := 0.0
		var lab := ""
		if w.is_beam:
			v = 1.0 - w.heat
			lab = "OVHT" if w.overheated else "%d%%" % int(w.heat * 100.0)
		elif w.reload_t > 0.0:
			v = 1.0 - w.reload_t / maxf(float(w.d["reload"]), 0.01)
			lab = "RLD"
		else:
			v = float(w.ammo) / maxf(float(w.d["mag"]), 1.0)
			lab = "%d" % w.ammo
		draw_rect(Rect2(o.x + 170, y + 12, 140, 8), Color(col, 0.16))
		draw_rect(Rect2(o.x + 170, y + 12, 140.0 * clampf(v, 0.0, 1.0), 8), col)
		_txt(lab, o.x + 368, y + 22, 16, col, 2)
		y += 36.0
	if y < o.y + 224.0:
		var ready: bool = m.melee_cd <= 0.0 and m.overheat_t <= 0.0
		var swung := _used("mcd", m.melee_cd, true)
		_key(Rect2(o.x + 8, y, 368, 32), 0.6 if swung else (0.15 if ready else 0.0), T_LINE if ready else T_WARN, swung, false)
		_txt("F", o.x + 24, y + 22, 15, Color(T_LINE, 0.8), 1)
		_txt(str(m.melee["tag"]), o.x + 44, y + 22, 16, T_TXT)
		_txt("READY" if ready else "----", o.x + 368, y + 22, 15, T_LINE if ready else Color(T_WARN, 0.7), 2)


func _touch_systems() -> void:
	var o := R_TOUCH_R.position
	draw_rect(R_TOUCH_R, T_BG)
	_txt("SYSTEMS", o.x + 12, o.y + 24, 16, Color(T_LINE, 0.7))
	var blink := fmod(t, 0.5) < 0.25
	# the frame's special system: a ring that fills, one big key
	var has_sys: bool = not m.sys.is_empty()
	var c := o + Vector2(92, 132)
	var went := _used("od_on", 1.0 if m.od_on else 0.0, true)
	var full: bool = has_sys and m.od >= 1.0
	var scol := T_LINE
	if m.od_on:
		scol = Color(1.0, 0.5, 0.15)
	elif full and blink:
		scol = T_TXT
	_key(Rect2(o.x + 8, o.y + 40, 168, 184), 1.0 if m.od_on else (0.3 if full else 0.0), scol, went)
	draw_arc(c, 58.0, 0, TAU, 48, Color(scol, 0.2), 9.0, true)
	if has_sys:
		draw_arc(c, 58.0, -PI * 0.5, -PI * 0.5 + TAU * clampf(m.od, 0.0, 1.0), 48, scol, 9.0, true)
		_txt(str(m.sys["tag"]), c.x, c.y - 2, 15, T_TXT, 1)
		var st := "%d%%" % int(m.od * 100.0)
		if m.od_on:
			st = "%.1fs" % maxf(m.od_t, 0.0)
		elif full:
			st = "READY"
		_txt(st, c.x, c.y + 20, 17, scol, 1)
	else:
		_txt("NO SYSTEM", c.x, c.y + 6, 15, Color(T_TXT, 0.4), 1)
	# repair kits: one pip each
	var x := o.x + 186.0
	var mended := _used("kits", float(m.repair_kits), false)
	_key(Rect2(x, o.y + 40, 190, 44), 0.5 if mended else (0.15 if m.repair_kits > 0 else 0.0), T_LINE if m.repair_kits > 0 else T_WARN, mended)
	_txt("REPAIR", x + 12, o.y + 68, 15, T_TXT)
	for i in 4:
		var on: bool = i < int(m.repair_kits)
		draw_rect(Rect2(x + 96 + i * 22, o.y + 54, 16, 16), Color(T_LINE, 0.9 if on else 0.15))
	# armour, shield and thrust
	var y := o.y + 96.0
	var hp: float = clampf(m.ap / m.ap_max, 0.0, 1.0)
	var red := Color(1.0, 0.25, 0.15)
	var rows := [["AP", hp, red if hp < 0.25 else (T_WARN if hp < 0.5 else T_LINE)], ["THR", m.thrust, T_WARN if m.overheat_t > 0.0 else T_LINE]]
	if m.shield_max > 0.0:
		rows.insert(1, ["SHD", m.shield_hp / m.shield_max, T_LINE if m.shield_hp > 0.0 else red])
	for rw in rows:
		var col: Color = rw[2]
		_txt(str(rw[0]), x + 2, y + 12, 14, Color(T_TXT, 0.7))
		draw_rect(Rect2(x + 44, y + 2, 146, 10), Color(col, 0.16))
		draw_rect(Rect2(x + 44, y + 2, 146.0 * clampf(float(rw[1]), 0.0, 1.0), 10), col)
		y += 22.0
	# state keys along the bottom: lit while the state holds
	var states := [["BRACE", m.bracing], ["LOCK", pc.lock != null], ["BOOST", m.boosting]]
	for i in states.size():
		var on: bool = states[i][1]
		var rc := Rect2(x + i * 64.0, o.y + 190, 60, 34)
		_key(rc, 1.0 if on else 0.0, T_LINE, _used("st%d" % i, 1.0 if on else 0.0, true), false)
		_txt(str(states[i][0]), rc.position.x + 30, rc.position.y + 23, 13, T_TXT if on else Color(T_TXT, 0.45), 1)
	_txt(str(m.def["en"]), o.x + 372, o.y + 24, 14, Color(T_TXT, 0.5), 2)
