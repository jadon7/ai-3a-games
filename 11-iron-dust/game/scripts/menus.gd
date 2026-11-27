extends Control
# Title / hangar / briefing / pause / debrief screens, custom drawn.

const Tex = preload("res://scripts/tex.gd")
const Defs = preload("res://scripts/defs.gd")
const World = preload("res://scripts/world.gd")

const C_MAIN := Color(0.66, 0.96, 0.74)
const C_DIM := Color(0.66, 0.96, 0.74, 0.45)
const C_TXT := Color(0.86, 0.87, 0.82)
const C_SUB := Color(0.86, 0.87, 0.82, 0.55)
const C_WARN := Color(1.0, 0.72, 0.25)
const C_ALERT := Color(1.0, 0.3, 0.2)
const C_PANEL := Color(0.035, 0.04, 0.038, 0.86)
const C_HAZ := Color(0.82, 0.6, 0.1)

const CONTROLS := [
	["W A S D", "移动"], ["鼠标", "瞄准 / 视角"], ["左键", "右手武器（蓄力/照射：按住）"], ["右键", "重武器 / 左手副炮"],
	["E", "肩部挂架（导弹需锁定）"], ["G / B", "左臂装备 / 下挂武器"], ["F / 中键", "格斗（可连击，按住蓄力）"], ["X / 滚轮", "切换手持武器"], ["V", "技能核心（蓄满后）"],
	["空格", "持续推进 / 平飞（冲刺）"], ["Q / 双击方向", "快速推进"], ["SHIFT", "跳跃 / 按住升空；宇宙：上升"], ["C / CTRL", "急降；宇宙：下降"],
	["R / T / Z", "维修套件 / 切换锁定 / 解除锁定"], ["Q（后摇中）", "喷射取消格斗与射击后摇"], ["TAB / ALT", "驾驶舱视角 / 按住自由观察"], ["M / F11", "静音 / 全屏"],
]
# the same list for a gamepad: [prompt parts ("@" = a button glyph, see pad_glyph.gd), what it does]
const PAD_CONTROLS := [
	[["@LS"], "移动"], [["@RS"], "瞄准 / 视角"], [["@RT"], "右手武器（蓄力/照射：按住）"], [["@LT"], "重武器 / 左手副炮"],
	[["@RB"], "肩部挂架（导弹需锁定）"], [["@DL", " / ", "@DR"], "左臂装备 / 下挂武器"], [["@X"], "格斗（可连击，按住蓄力）"], [["@Y"], "切换手持武器"], [["@DU"], "技能核心（蓄满后）"],
	[["@LB"], "持续推进 / 平飞（冲刺）"], [["@B"], "快速推进"], [["@A"], "跳跃 / 按住升空；宇宙：上升"], [["@L3"], "按下左摇杆：急降；宇宙：下降"],
	[["@DD", " / ", "@R3"], "维修套件 / 按下右摇杆切换锁定（按住：解除）"], [["@B", " 后摇中"], "喷射取消格斗与射击后摇"], [["@VIEW"], "点按：驾驶舱视角 / 按住：自由观察"], [["@MENU"], "暂停"],
]
const PAD_SLOT_KEYS := {"LMB": "RT", "X 切换": "Y", "RMB": "LT", "E": "RB", "F": "X", "V": "DU", "G": "DL"}
const Pad = preload("res://scripts/pad_glyph.gd")

var game
var font: Font
var screen := "none"
var buttons: Array = []
var hover := ""
var result := {}


func setup(g) -> void:
	game = g
	font = Tex.font
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP


func show_screen(s: String) -> void:
	screen = s
	visible = s != "none"
	hover = ""
	queue_redraw()


func _process(_dt: float) -> void:
	if visible:
		# on the pause and result screens the pad (or the arrow keys) moves a focus over the buttons
		if game.focus_on and game.FOCUS_IDS.has(screen):
			var ids: Array = game.FOCUS_IDS[screen]
			hover = ids[clampi(game.focus_i, 0, ids.size() - 1)]
		queue_redraw()


func _gui_input(ev: InputEvent) -> void:
	if ev is InputEventMouseMotion:
		if ev.relative.length() > 3.0:
			game.focus_on = false
		var h := ""
		for b in buttons:
			var r: Rect2 = b["rect"]
			if r.has_point(ev.position):
				h = b["id"]
		if h != hover:
			hover = h
			if h != "":
				game.sfx.play2d("click", 0.4)
	elif ev is InputEventMouseButton and ev.pressed and ev.button_index == MOUSE_BUTTON_LEFT:
		for i in range(buttons.size() - 1, -1, -1):
			var r: Rect2 = buttons[i]["rect"]
			if r.has_point(ev.position):
				game.menu_action(buttons[i]["id"])
				return
		if screen == "title":
			game.menu_action("start")


func _txt(text: String, x: float, y: float, sz: int, col: Color, align: int = 0) -> void:
	if align == 0:
		draw_string(font, Vector2(x, y), text, HORIZONTAL_ALIGNMENT_LEFT, -1, sz, col)
	elif align == 1:
		draw_string(font, Vector2(x - 600, y), text, HORIZONTAL_ALIGNMENT_CENTER, 1200, sz, col)
	else:
		draw_string(font, Vector2(x - 1200, y), text, HORIZONTAL_ALIGNMENT_RIGHT, 1200, sz, col)


# a key prompt: plain text for the keyboard, text and button glyphs for a gamepad
func _keys(kb: String, pad: Array, x: float, y: float, sz: int, col: Color, align: int = 0) -> void:
	if game.pad_mode:
		Pad.line(self, font, pad, x, y, sz, col, align, C_MAIN)
	else:
		_txt(kb, x, y, sz, col, align)


func _hazard(x: float, y: float, w: float, h: float, a: float = 1.0) -> void:
	draw_rect(Rect2(x, y, w, h), Color(0.05, 0.05, 0.05, a))
	var sw := h * 1.2
	var px := x
	while px < x + w - sw - h:
		draw_colored_polygon(PackedVector2Array([Vector2(px, y + h), Vector2(px + sw, y + h), Vector2(px + sw + h, y), Vector2(px + h, y)]), Color(C_HAZ, a))
		px += sw * 2.0


func _panel(r: Rect2, title: String = "") -> void:
	var c := 18.0
	var pts := PackedVector2Array([r.position + Vector2(c, 0), r.position + Vector2(r.size.x, 0), r.position + Vector2(r.size.x, r.size.y - c), r.position + r.size - Vector2(c, 0), r.position + Vector2(0, r.size.y), r.position + Vector2(0, c)])
	draw_colored_polygon(pts, C_PANEL)
	var line := pts.duplicate()
	line.append(pts[0])
	draw_polyline(line, Color(C_MAIN, 0.35), 1.5)
	if title != "":
		draw_rect(Rect2(r.position.x + c, r.position.y, 5, 30), C_MAIN)
		_txt(title, r.position.x + c + 16, r.position.y + 23, 17, C_MAIN)
		draw_line(r.position + Vector2(c, 36), r.position + Vector2(r.size.x - 14, 36), Color(C_MAIN, 0.25), 1.0)


func _button(r: Rect2, label: String, id: String, primary: bool = false) -> void:
	var hot := hover == id
	var col := C_WARN if primary else C_MAIN
	draw_rect(r, Color(col, 0.3 if hot else 0.1))
	draw_rect(r, Color(col, 1.0 if hot else 0.6), false, 2.0)
	draw_rect(Rect2(r.position.x, r.position.y, 6, r.size.y), col)
	_txt(label, r.position.x + r.size.x * 0.5, r.position.y + r.size.y * 0.5 + 9, 24, Color(1, 1, 1) if hot else col, 1)
	buttons.append({"rect": r, "id": id})


func _draw() -> void:
	buttons.clear()
	var w := size.x
	var h := size.y
	match screen:
		"title":
			_draw_title(w, h)
		"missions":
			_draw_missions(w, h)
		"hangar":
			_draw_hangar(w, h)
		"briefing":
			_draw_briefing(w, h)
		"pause":
			_draw_pause(w, h)
		"options":
			_draw_options(w, h)
		"result":
			_draw_result(w, h)


func _draw_title(w: float, h: float) -> void:
	draw_rect(Rect2(0, 0, w, h), Color(0, 0, 0, 0.35))
	draw_rect(Rect2(0, h * 0.5 - 190, w, 380), Color(0.02, 0.022, 0.02, 0.72))
	_hazard(0, h * 0.5 - 190, w, 14)
	_hazard(0, h * 0.5 + 176, w, 14)
	_txt("铁 尘", 150, h * 0.5 + 10, 170, C_TXT)
	_txt("IRON DUST", 160, h * 0.5 + 92, 64, C_MAIN)
	_txt("TACTICAL FRAME OPERATIONS  //  战术机架作战", 164, h * 0.5 + 132, 20, C_SUB)
	var blink := fmod(Time.get_ticks_msec() / 1000.0, 1.2) < 0.75
	if blink:
		_keys("按 ENTER 或 点击鼠标 开始", ["按 ", "@A", " 开始"], w - 160, h * 0.5 + 60, 28, C_WARN, 2)
	_txt("SYS BOOT OK  ·  FCS ONLINE  ·  REACTOR NOMINAL", w - 160, h * 0.5 + 100, 15, C_DIM, 2)
	_txt("BUILD 0.3  //  GODOT 4.7", 40, h - 30, 14, C_DIM)
	_button(Rect2(w - 420, h * 0.5 + 216, 260, 48), "设 置  [O]", "options")


func _draw_missions(w: float, h: float) -> void:
	draw_rect(Rect2(0, 0, w, h), Color(0.012, 0.014, 0.013, 0.78))
	_hazard(0, 0, w, 12, 0.9)
	_txt("OPERATIONS  //  作战选择", 80, 76, 30, C_TXT)
	_txt("选择要执行的作战", 82, 106, 16, C_SUB)
	var n: int = Defs.MISSIONS.size()
	var gap := 40.0
	var cw := minf(700.0, (w - 120.0 - gap * (n - 1)) / n)
	var x0 := (w - (cw * n + gap * (n - 1))) * 0.5
	for i in n:
		var md: Dictionary = Defs.MISSIONS[i]
		var r := Rect2(x0 + i * (cw + gap), 180, cw, 520)
		var on: bool = i == game.mission_idx
		var hot: bool = hover == "msel%d" % i
		_panel(r)
		draw_rect(r, Color(C_WARN if on else C_MAIN, 1.0 if on else (0.7 if hot else 0.25)), false, 2.5 if on else 1.5)
		if on:
			draw_rect(Rect2(r.position.x, r.position.y, 10, r.size.y), C_WARN)
			_hazard(r.position.x + 18, r.position.y + r.size.y - 24, r.size.x - 36, 10)
		_txt("0%d" % (i + 1), r.position.x + 40, r.position.y + 92, 64, C_WARN if on else C_DIM)
		_txt(str(md["name"]), r.position.x + 150, r.position.y + 76, 48, C_TXT if on else C_SUB)
		_txt(str(md["en"]), r.position.x + 152, r.position.y + 108, 19, C_MAIN if on else C_DIM)
		draw_line(r.position + Vector2(40, 136), r.position + Vector2(cw - 40, 136), Color(C_MAIN, 0.25), 1.0)
		_txt(str(md["scale"]), r.position.x + 40, r.position.y + 174, 18, C_WARN if on else C_SUB)
		draw_multiline_string(font, Vector2(r.position.x + 40, r.position.y + 222), str(md["brief"]), HORIZONTAL_ALIGNMENT_LEFT, cw - 80, 21, 5, C_TXT if on else C_SUB)
		var objs: Array = md["objs"]
		for q in objs.size():
			_txt(str(objs[q]), r.position.x + 40, r.position.y + 340 + q * 30.0, 17, C_SUB)
		if on:
			_txt("SELECTED", r.position.x + cw - 40, r.position.y + 470, 18, C_WARN, 2)
		buttons.append({"rect": r, "id": "msel%d" % i})
	_button(Rect2(w * 0.5 - 300, h - 190, 600, 66), "确 认  ·  进入机库", "mok", true)
	_keys("A / D 切换    ENTER 确认    O 设置    ESC 返回", ["@D4", " / ", "@LS", " 切换      ", "@A", " 确认      ", "@Y", " 设置      ", "@B", " 返回"], w * 0.5, h - 88, 17, C_SUB, 1)
	_button(Rect2(w - 320, 46, 240, 48), "设 置  [O]", "options")


func _item_stats(id: String) -> String:
	if id == "":
		return "该挂点不安装装备，减轻载荷。"
	if Defs.WEAPONS.has(id):
		var d: Dictionary = Defs.WEAPONS[id]
		var out := ""
		if d["kind"] == "hook":
			return "伤害 %d  ·  射程 %dm  ·  冷却 %.1fs  ·  命中硬直" % [int(d["dmg"]), int(d["range"]), float(d["reload"])]
		if d["kind"] == "beam":
			out = "每秒伤害 %d  ·  射程 %dm  ·  可持续 %.1fs" % [int(d["dmg"]), int(d["range"]), float(d["heat"])]
		else:
			var n: int = d.get("pellets", 1)
			out = "伤害 %d%s  ·  射速 %.1f/s  ·  射程 %dm  ·  弹匣 %d" % [int(d["dmg"]), (" x%d" % n) if n > 1 else "", float(d["rof"]), int(d["range"]), int(d["mag"])]
			if d.has("charge"):
				out += "  ·  满蓄 x%.1f / %.1fs" % [float(d["charge"]["mul"]), float(d["charge"]["t"])]
		if d.has("brace"):
			out += "  ·  站定 %.2fs" % float(d["brace"])
		return out
	if Defs.SHIELDS.has(id):
		var sd: Dictionary = Defs.SHIELDS[id]
		return "耐久 %d  ·  覆盖左前方 ±%d°  ·  可被击碎" % [int(sd["hp"]), int(sd["arc"])]
	if Defs.MELEE.has(id):
		var md: Dictionary = Defs.MELEE[id]
		var en: String = {"heat": "热能", "plasma": "等离子", "solid": "实体"}.get(str(md.get("energy", "solid")), "实体")
		return "%s  ·  伤害 %d  ·  %d 连击  ·  突进 %dm  ·  攻击距离 %dm" % [en, int(md["dmg"]), int(md["combo"]), int(md["lunge"]), int(md["reach"])]
	if Defs.SYSTEMS.has(id):
		var yd: Dictionary = Defs.SYSTEMS[id]
		if str(yd.get("kind", "od")) == "od":
			return "超频  ·  持续 %ds  ·  结束后推进器强制冷却" % int(yd["dur"])
		return "技能  ·  持续 %.1fs  ·  约 %ds 蓄满（战斗中更快）" % [float(yd["dur"]), int(yd["cd"])]
	return ""


func _draw_hangar(w: float, h: float) -> void:
	_hazard(0, 0, w, 12, 0.9)
	var md: Dictionary = Defs.MISSIONS[game.mission_idx]
	_txt("HANGAR  //  机库 · 机体与装备", 60, 64, 30, C_TXT)
	_txt("出击任务：%s  %s" % [md["name"], md["en"]], 62, 92, 16, C_WARN)
	var sel: int = game.sel
	var nf := Defs.PLAYER_FRAMES.size()
	var compact := nf > 6
	var rh := 56.0 if compact else 84.0
	var y := 116.0 if compact else 130.0
	for i in nf:
		var fd: Dictionary = Defs.FRAMES[Defs.PLAYER_FRAMES[i]]
		# captured machines (they fly another frame's model) sit under their own heading
		if fd.has("model") and (i == 0 or not (Defs.FRAMES[Defs.PLAYER_FRAMES[i - 1]] as Dictionary).has("model")):
			_txt("CAPTURED  //  缴获机 · 配装受限", 62, y + 15, 13, C_WARN)
			y += 22.0
		var r := Rect2(60, y, 380, rh)
		var on := i == sel
		var hot: bool = hover == "sel%d" % i
		draw_rect(r, Color(0.035, 0.04, 0.038, 0.9))
		draw_rect(r, Color(C_WARN if on else C_MAIN, 1.0 if on else (0.7 if hot else 0.3)), false, 2.0)
		if on:
			draw_rect(Rect2(60, y, 8, rh), C_WARN)
		if compact:
			_txt("%02d" % (i + 1), 80, y + 36, 22, C_WARN if on else C_DIM)
			_txt(str(fd["name"]), 128, y + 26, 20, C_TXT if on else C_SUB)
			_txt(str(fd["en"]), 130, y + 45, 12, C_MAIN if on else C_DIM)
			_txt(str(fd["role"]).get_slice(" / ", 0), 430, y + 45, 12, C_SUB, 2)
		else:
			_txt("%02d" % (i + 1), 84, y + 40, 28, C_WARN if on else C_DIM)
			_txt(str(fd["name"]), 138, y + 36, 26, C_TXT if on else C_SUB)
			_txt(str(fd["en"]), 140, y + 60, 16, C_MAIN if on else C_DIM)
			_txt(str(fd["role"]), 140, y + 76, 13, C_SUB)
		buttons.append({"rect": r, "id": "sel%d" % i})
		y += rh + 6.0
	_keys("Q / E  切换机体", ["@LB", " / ", "@RB", "  切换机体"], 62, y + 18, 16, C_SUB)
	_keys("W / S  选择挂点      A / D  更换装备", ["@DV", " / ", "@LS", "  选择挂点      ", "@DH", "  更换装备"], 62, h - 84, 17, C_SUB)
	_keys("ENTER  出击      O  设置      ESC  返回作战选择", ["@A", "  出击      ", "@Y", "  设置      ", "@B", "  返回作战选择"], 62, h - 52, 17, C_SUB)

	var id: String = Defs.PLAYER_FRAMES[sel]
	var d: Dictionary = Defs.FRAMES[id]
	var lo: Dictionary = game.loadouts[id]
	var px := w - 720.0
	var pr := Rect2(px, 96, 660, h - 150)
	_panel(pr, "FRAME DATA  //  机体诸元")
	_txt(str(d["name"]).get_slice("〔", 0), px + 30, 178, 40, C_TXT)
	_txt(str(d["en"]), px + 330, 162, 20, C_MAIN)
	_txt(str(d["role"]), px + 330, 184, 14, C_WARN)
	draw_multiline_string(font, Vector2(px + 32, 214), str(d["desc"]), HORIZONTAL_ALIGNMENT_LEFT, 596, 16, 3, C_SUB)
	var sy := 296.0
	var stats: Dictionary = d["stats"]
	var col_i := 0
	for k in stats:
		var sx := px + 32 + (col_i % 2) * 304.0
		_txt(str(k), sx, sy + 5, 16, C_TXT)
		for q in 10:
			var filled: bool = q < int(stats[k])
			draw_rect(Rect2(sx + 58 + q * 22.0, sy - 9, 19, 13), Color(C_MAIN, 0.9 if filled else 0.12))
		if col_i % 2 == 1:
			sy += 26.0
		col_i += 1
	if col_i % 2 == 1:
		sy += 26.0
	var mob: float = Defs.mobility(lo, float(d["cap"]))
	var wt: float = Defs.load_weight(lo)
	var cap: float = d["cap"]
	sy += 14.0
	_txt("AP %d    步行 %d km/h    推进 %d km/h" % [int(d["ap"]), int(float(d["walk"]) * mob * 3.6), int(float(d["boost"]) * mob * 3.6)], px + 32, sy, 16, C_SUB)
	sy += 30.0
	# loadout
	draw_rect(Rect2(px + 18, sy - 18, 5, 26), C_MAIN)
	_txt("LOADOUT  //  装备配置", px + 34, sy + 2, 16, C_MAIN)
	var over: bool = wt > cap
	var lc := C_ALERT if over else (C_WARN if wt > cap * 0.85 else C_MAIN)
	_txt("载荷 %d / %d    机动 %d%%" % [int(wt), int(cap), int(round(mob * 100.0))], px + 628, sy + 2, 15, lc, 2)
	sy += 14.0
	draw_rect(Rect2(px + 32, sy, 596, 6), Color(lc, 0.14))
	draw_rect(Rect2(px + 32, sy, 596 * clampf(wt / (cap * 1.3), 0.0, 1.0), 6), lc)
	draw_line(Vector2(px + 32 + 596 / 1.3, sy - 3), Vector2(px + 32 + 596 / 1.3, sy + 9), C_TXT, 2.0)
	sy += 22.0
	var slots: Dictionary = d["slots"]
	for i in Defs.SLOT_ORDER.size():
		var sl: String = Defs.SLOT_ORDER[i]
		var item: String = lo.get(sl, "")
		var it: Dictionary = Defs.item(item)
		var opts: Array = slots[sl]
		var on: bool = i == game.slot_i
		var row := Rect2(px + 24, sy, 612, 37)
		var hot: bool = hover == "slot%d" % i
		draw_rect(row, Color(C_WARN, 0.14) if on else Color(C_MAIN, 0.07 if hot else 0.035))
		if on:
			draw_rect(Rect2(row.position.x, row.position.y, 5, 40), C_WARN)
			draw_rect(row, Color(C_WARN, 0.7), false, 1.5)
		_txt(str(Defs.SLOT_NAMES[sl]), px + 40, sy + 26, 16, C_TXT if on else C_SUB)
		var key: String = Defs.SLOT_KEYS[sl]
		if sl == "S1" and not Defs.WEAPONS.has(str(lo.get("S1", ""))):
			key = ""
		if sl == "L" and Defs.WEAPONS.has(item):
			key = "G" if Defs.WEAPONS.has(str(lo.get("S1", ""))) else "RMB"
		if game.pad_mode and PAD_SLOT_KEYS.has(key):
			Pad.draw(self, font, str(PAD_SLOT_KEYS[key]), Vector2(px + 196, sy + 20), 21.0, C_MAIN if on else C_DIM)
		elif key != "":
			_txt(key, px + 196, sy + 25, 12, C_DIM, 1)
		buttons.append({"rect": Rect2(px + 236, sy, 400, 40), "id": "slot%d" % i})
		buttons.append({"rect": Rect2(px + 24, sy, 212, 40), "id": "slot%d" % i})
		var multi: bool = opts.size() > 1
		if multi:
			var la := Rect2(px + 236, sy + 4, 32, 32)
			var ra := Rect2(px + 600, sy + 4, 32, 32)
			for ar in [[la, "optm%d" % i, "<"], [ra, "optp%d" % i, ">"]]:
				var rr: Rect2 = ar[0]
				var ah: bool = hover == ar[1]
				draw_rect(rr, Color(C_MAIN, 0.35 if ah else 0.12))
				_txt(ar[2], rr.position.x + 16, rr.position.y + 23, 20, Color(1, 1, 1) if ah else C_MAIN, 1)
				buttons.append({"rect": rr, "id": ar[1]})
		if it.is_empty():
			_txt("——  空  ——", px + 418, sy + 26, 16, C_DIM, 1)
		else:
			_txt(str(it["tag"]), px + 282, sy + 26, 16, C_MAIN if on else C_DIM)
			_txt(str(it["name"]), px + 590, sy + 26, 18, C_TXT if on else C_SUB, 2)
		sy += 40.0
	# selected item details
	var ssl: String = Defs.SLOT_ORDER[game.slot_i]
	var sid: String = lo.get(ssl, "")
	var sit: Dictionary = Defs.item(sid)
	sy += 6.0
	draw_rect(Rect2(px + 24, sy - 4, 612, 62), Color(0.02, 0.025, 0.022, 0.7))
	_txt(_item_stats(sid), px + 36, sy + 20, 15, C_MAIN)
	_txt(str(sit.get("info", "")) + ("    重量 %d" % int(sit.get("wt", 0.0)) if not sit.is_empty() else ""), px + 36, sy + 44, 15, C_SUB)
	if over:
		_txt("超载：机动性大幅下降", px + 628, sy + 44, 15, C_ALERT, 2)
	_button(Rect2(px + 30, pr.position.y + pr.size.y - 78, 600, 58), "出 击   SORTIE", "sortie", true)


func _draw_briefing(w: float, h: float) -> void:
	draw_rect(Rect2(0, 0, w, h), Color(0.012, 0.014, 0.013, 0.93))
	_hazard(0, 0, w, 12, 0.9)
	var md: Dictionary = Defs.MISSIONS[game.mission_idx]
	_txt("BRIEFING  //  任务简报", 80, 76, 30, C_TXT)
	_txt("%s  ·  %s" % [md["en"], md["name"]], 82, 112, 20, C_MAIN)
	var tx := 80.0
	draw_multiline_string(font, Vector2(tx, 170), str(md["body"]), HORIZONTAL_ALIGNMENT_LEFT, 760, 20, 14, C_TXT)
	var oy := 500.0
	_txt("OBJECTIVES  //  作战目标", tx, oy, 15, C_DIM)
	var objs: Array = md["objs"]
	for i in objs.size():
		_txt(objs[i], tx, oy + 36 + i * 32.0, 21, C_WARN)
	var ty := oy + 160.0
	_txt("TACTICS  //  战术要点", tx, ty, 15, C_DIM)
	var tips: Array = md["tips"]
	for i in tips.size():
		_txt(tips[i], tx, ty + 34 + i * 30.0, 18, C_SUB)
	# tactical map
	var mr := Rect2(w - 700, 150, 560, 560)
	_panel(Rect2(mr.position.x - 20, mr.position.y - 50, mr.size.x + 40, mr.size.y + 70), "TACTICAL MAP  //  战术地图")
	var world = game.world
	var ext: float = world.bound * 0.9
	var sc := mr.size.x / (ext * 2.0)
	var mc := mr.position + mr.size * 0.5
	var blue := Color(0.45, 0.8, 1.0)
	var gs := 100.0 if ext < 800.0 else 200.0
	var gq: float = -floor(ext / gs) * gs
	while gq <= ext:
		draw_line(mc + Vector2(gq, -ext) * sc, mc + Vector2(gq, ext) * sc, Color(C_MAIN, 0.07), 1.0)
		draw_line(mc + Vector2(-ext, gq) * sc, mc + Vector2(ext, gq) * sc, Color(C_MAIN, 0.07), 1.0)
		gq += gs
	for c in world.cols:
		if absf(float(c["x"])) > ext or absf(float(c["z"])) > ext:
			continue
		var cp := mc + Vector2(c["x"], c["z"]) * sc
		if c.has("r"):
			draw_circle(cp, maxf(float(c["r"]) * sc, 1.5), Color(C_MAIN, 0.4))
		else:
			var sz := Vector2(maxf(float(c["w"]) * sc, 1.5), maxf(float(c["d"]) * sc, 1.5))
			draw_rect(Rect2(cp - sz * 0.5, sz), Color(C_MAIN, 0.4))
	var pts: Dictionary = world.points
	var spv: Vector2 = pts["spawn"]
	var sp := mc + spv * sc
	if pts.has("battery"):
		var bi := 0
		for bp in pts["battery"]:
			bi += 1
			var cp := mc + Vector2(bp.x, bp.y) * sc
			draw_colored_polygon(PackedVector2Array([cp + Vector2(0, -9), cp + Vector2(9, 0), cp + Vector2(0, 9), cp + Vector2(-9, 0)]), C_ALERT)
			_txt("TGT-%d" % bi, cp.x + 14, cp.y + 6, 15, C_ALERT)
		draw_dashed_line(sp + Vector2(0, -16), mc + Vector2(0, 160) * sc, Color(blue, 0.6), 2.0, 8.0)
	if pts.has("ally_ship"):
		var av: Vector3 = pts["ally_ship"]
		var ap2 := mc + Vector2(av.x, av.z) * sc
		draw_rect(Rect2(ap2 - Vector2(5, 12), Vector2(10, 24)), blue)
		_txt("白桦号", ap2.x + 12, ap2.y + 5, 14, blue)
		for ev in pts.get("enemy_ships", []):
			var ep := mc + Vector2(ev.x, ev.z) * sc
			draw_rect(Rect2(ep - Vector2(6, 15), Vector2(12, 30)), C_ALERT)
			_txt("敌战列舰", ep.x + 12, ep.y + 5, 14, C_ALERT)
		var prev := ap2
		for lv in pts.get("lane", []):
			var lp2 := mc + Vector2(lv.x, lv.z) * sc
			draw_dashed_line(prev, lp2, Color(blue, 0.6), 2.0, 8.0)
			prev = lp2
	if pts.has("cannons"):
		var ci := 0
		for cpv in pts["cannons"]:
			ci += 1
			var cp := mc + Vector2(cpv.x, cpv.y) * sc
			draw_colored_polygon(PackedVector2Array([cp + Vector2(0, -10), cp + Vector2(10, 0), cp + Vector2(0, 10), cp + Vector2(-10, 0)]), blue)
			_txt("AO-%d 对轨炮" % ci, cp.x + 14, cp.y + 6, 14, blue)
		for ap in pts["aa"]:
			draw_rect(Rect2(mc + Vector2(ap.x, ap.y) * sc - Vector2(3, 3), Vector2(6, 6)), Color(blue, 0.8))
		for lz in pts["lz"]:
			var lp := mc + Vector2(lz.x, lz.y) * sc
			draw_arc(lp, 16.0, 0, TAU, 20, Color(C_ALERT, 0.8), 1.5, true)
			draw_colored_polygon(PackedVector2Array([lp + Vector2(0, 7), lp + Vector2(6, -5), lp + Vector2(-6, -5)]), C_ALERT)
		var ch: Vector3 = pts["carrier"]
		var cc := mc + Vector2(ch.x, ch.z) * sc
		draw_rect(Rect2(cc - Vector2(85, 230) * sc, Vector2(170, 460) * sc), Color(C_ALERT, 0.16))
		draw_rect(Rect2(cc - Vector2(85, 230) * sc, Vector2(170, 460) * sc), C_ALERT, false, 1.5)
		_txt("登陆舰 预计降下点", cc.x + 85 * sc + 10, cc.y, 14, C_ALERT)
		_txt("敌空降区 LZ", mc.x - ext * sc + 10, mc.y - 500 * sc, 14, C_ALERT)
		for i in 5:
			var ax := mc.x + (i - 2) * 90.0 * sc * 2.0
			draw_dashed_line(Vector2(ax, mr.position.y + 8), Vector2(ax, mc.y - 640 * sc), Color(C_ALERT, 0.45), 1.5, 6.0)
	draw_colored_polygon(PackedVector2Array([sp + Vector2(0, -12), sp + Vector2(9, 8), sp + Vector2(-9, 8)]), blue)
	_txt("砂砾小队", sp.x + 16, sp.y + 6, 15, blue)
	_txt("N", mr.position.x + mr.size.x - 16, mr.position.y + 22, 18, C_MAIN, 1)
	draw_line(Vector2(mr.position.x + mr.size.x - 16, mr.position.y + 28), Vector2(mr.position.x + mr.size.x - 16, mr.position.y + 54), C_MAIN, 2.0)
	_button(Rect2(w - 700, h - 150, 560, 64), "开 始 作 战   ENGAGE", "engage", true)
	_button(Rect2(80, h - 150, 260, 64), "返回机库", "hangar")
	_keys("操作说明见暂停菜单 (ESC)", ["@A", " 开始作战      ", "@B", " 返回机库      操作说明见暂停菜单 ", "@MENU"], 370, h - 108, 16, C_SUB)


func _draw_controls(x: float, y: float) -> void:
	_txt("CONTROLS  //  操作", x, y, 15, C_DIM)
	var list: Array = PAD_CONTROLS if game.pad_mode else CONTROLS
	for i in list.size():
		var cx := x + (i % 2) * 420.0
		var cy := y + 36.0 + int(i / 2.0) * 36.0
		draw_rect(Rect2(cx, cy - 19, 150, 26), Color(C_MAIN, 0.1))
		if list[i][0] is Array:
			Pad.line(self, font, list[i][0], cx + 75, cy, 17, C_MAIN, 1)
		else:
			_txt(str(list[i][0]), cx + 75, cy, 15, C_MAIN, 1)
		_txt(str(list[i][1]), cx + 164, cy, 17 if str(list[i][1]).length() < 15 else 15, C_TXT)


func _draw_pause(w: float, h: float) -> void:
	draw_rect(Rect2(0, 0, w, h), Color(0.012, 0.014, 0.013, 0.8))
	var r := Rect2(w * 0.5 - 460, h * 0.5 - 370, 920, 740)
	_panel(r, "SYSTEM HOLD  //  暂停")
	_txt("PAUSED", w * 0.5, r.position.y + 100, 52, C_TXT, 1)
	_draw_controls(r.position.x + 44, r.position.y + 150)
	var by := r.position.y + r.size.y - 100
	_button(Rect2(r.position.x + 44, by, 196, 60), "继续作战", "resume", true)
	_button(Rect2(r.position.x + 256, by, 196, 60), "重新出击", "retry")
	_button(Rect2(r.position.x + 468, by, 196, 60), "返回机库", "hangar")
	_button(Rect2(r.position.x + 680, by, 196, 60), game.kh("设置 [O]", "设置    "), "options")
	if game.pad_mode:
		Pad.draw(self, font, "Y", Vector2(r.position.x + 680 + 146, by + 30), 26.0, C_MAIN)
		Pad.line(self, font, ["@DH", " 选择      ", "@A", " 确认      ", "@B", " / ", "@MENU", " 继续作战"], w * 0.5, by + 90, 15, C_SUB, 1, C_MAIN)


func _draw_result(w: float, h: float) -> void:
	draw_rect(Rect2(0, 0, w, h), Color(0.012, 0.014, 0.013, 0.82))
	var r := Rect2(w * 0.5 - 460, h * 0.5 - 350, 920, 700)
	_panel(r, "DEBRIEFING  //  战果报告")
	var win: bool = result.get("win", false)
	var col := C_MAIN if win else C_ALERT
	_hazard(r.position.x + 18, r.position.y + 50, r.size.x - 36, 10)
	_txt("MISSION ACCOMPLISHED" if win else "MISSION FAILED", r.position.x + 44, r.position.y + 124, 46, col)
	_txt("作战目标达成" if win else str(result.get("reason", "")), r.position.x + 46, r.position.y + 160, 22, C_SUB)
	var rows: Array = result.get("rows", [])
	var y := r.position.y + 230.0
	for row in rows:
		_txt(str(row[0]), r.position.x + 46, y, 22, C_SUB)
		_txt(str(row[1]), r.position.x + 520, y, 26, C_TXT, 2)
		draw_line(Vector2(r.position.x + 46, y + 12), Vector2(r.position.x + 520, y + 12), Color(C_MAIN, 0.15), 1.0)
		y += 42.0
	_txt("RANK", r.position.x + 720, r.position.y + 230, 18, C_DIM, 1)
	_txt(str(result.get("rank", "-")), r.position.x + 720, r.position.y + 400, 190, C_WARN if win else C_DIM, 1)
	var by := r.position.y + r.size.y - 100
	_button(Rect2(r.position.x + 44, by, 400, 60), "再次出击   RETRY", "retry", true)
	_button(Rect2(r.position.x + 476, by, 400, 60), "返回机库   HANGAR", "hangar")
	if game.pad_mode:
		Pad.line(self, font, ["@DH", " 选择      ", "@A", " 确认      ", "@B", " 返回机库"], w * 0.5, by + 90, 15, C_SUB, 1, C_MAIN)


func _draw_options(w: float, h: float) -> void:
	draw_rect(Rect2(0, 0, w, h), Color(0.012, 0.014, 0.013, 0.88))
	_hazard(0, 0, w, 12, 0.9)
	var cfg = game.cfg
	var n: int = cfg.items.size()
	var r := Rect2(w * 0.5 - 520, h * 0.5 - 480, 1040, 950)
	_panel(r, "OPTIONS  //  设置")
	var windowed: bool = int(cfg.val("mode")) == 0
	var y := r.position.y + 62.0
	var rh := 58.0 if n <= 10 else 48.0
	var o := rh - 58.0
	for i in n:
		var it: Dictionary = cfg.items[i]
		var id: String = it["id"]
		var on: bool = i == game.opt_i
		var row := Rect2(r.position.x + 30, y, r.size.x - 60, rh)
		var hot: bool = hover == "cfgrow%d" % i
		# rows that cannot take effect right now are dimmed
		var off: bool = (id == "res" and not windowed) or (cfg.embedded and (id == "res" or id == "mode"))
		draw_rect(row, Color(C_WARN, 0.14) if on else Color(C_MAIN, 0.07 if hot else 0.035))
		if on:
			draw_rect(Rect2(row.position.x, row.position.y, 5, row.size.y), C_WARN)
			draw_rect(row, Color(C_WARN, 0.7), false, 1.5)
		buttons.append({"rect": row, "id": "cfgrow%d" % i})
		_txt(str(it["name"]), row.position.x + 26, y + 30 + o * 0.6, 22 if o == 0.0 else 19, C_SUB if off else (C_TXT if on else C_SUB))
		_txt(str(it["en"]), row.position.x + 26, y + 50 + o, 12 if o == 0.0 else 10, C_DIM)
		var ax := row.position.x + row.size.x - 470.0
		var bx := row.position.x + row.size.x - 60.0
		var idx: int = cfg.v[id]
		for ar in [[Rect2(ax, y + 9 + o * 0.5, 40, 40 + o * 0.6), "cfgm%d" % i, "<", idx > 0], [Rect2(bx, y + 9 + o * 0.5, 40, 40 + o * 0.6), "cfgp%d" % i, ">", idx < it["opts"].size() - 1]]:
			var rr: Rect2 = ar[0]
			var ah: bool = hover == ar[1]
			var live: bool = ar[3]
			draw_rect(rr, Color(C_MAIN, (0.35 if ah else 0.12) if live else 0.04))
			_txt(ar[2], rr.position.x + 20, rr.position.y + 28 + o * 0.3, 22, (Color(1, 1, 1) if ah else C_MAIN) if live else C_DIM, 1)
			buttons.append({"rect": rr, "id": ar[1]})
		_txt(cfg.label(id), (ax + 40 + bx) * 0.5, y + 38 + o * 0.7, 22 if o == 0.0 else 20, C_DIM if off else (C_WARN if on else C_TXT), 1)
		# position pips
		var cnt: int = it["opts"].size()
		var pw := minf(14.0, 300.0 / cnt)
		for q in cnt:
			draw_rect(Rect2((ax + 40 + bx) * 0.5 - cnt * pw * 0.5 + q * pw, y + 50 + o, pw - 3.0, 3), Color(C_MAIN, 0.9 if q == idx else 0.18))
		if id == "res" and not windowed:
			_txt("全屏时使用显示器分辨率，可用「渲染精度」降低负载", row.position.x + 190, y + 50 + o, 12, C_DIM)
		y += rh + 5.0
	y += 14.0
	var win: Window = get_window()
	_txt("显示器 %d × %d @ %d Hz      窗口 %d × %d      当前帧率 %d FPS" % [cfg.screen_size.x, cfg.screen_size.y, int(round(cfg.screen_hz)), win.size.x, win.size.y, int(Engine.get_frames_per_second())], r.position.x + 44, y + 12, 16, C_MAIN)
	if cfg.screen_hz < 50.0:
		_txt("这台显示器上报的刷新率只有 %d Hz（远程桌面 / 虚拟显示器常见）。开启垂直同步会把帧率锁在这个数值，" % int(round(cfg.screen_hz)), r.position.x + 44, y + 40, 14, C_WARN)
		_txt("因此默认关闭垂直同步并限制帧率。远程画面本身的刷新率不受游戏控制。", r.position.x + 44, y + 60, 14, C_WARN)
	if cfg.embedded:
		_txt("游戏正嵌入在编辑器窗口内运行：显示模式和分辨率由编辑器面板决定。", r.position.x + 44, y + 84, 14, C_WARN)
	_button(Rect2(w * 0.5 - 200, r.position.y + r.size.y - 82, 400, 56), "返 回   BACK", "cfgback", true)
	_keys("W / S 选择      A / D 调整      F11 切换全屏      ESC 返回", ["@DV", " / ", "@LS", " 选择      ", "@DH", " 调整      ", "@B", " 返回"], w * 0.5, r.position.y + r.size.y + 30, 16, C_SUB, 1)
