extends RefCounted
# Gamepad prompts drawn in the shape of the control they stand for (Xbox layout):
#   A B X Y   round face buttons
#   LB RB     bumpers: a wide plate with its outer top corner clipped
#   LT RT     triggers: a tall plate that slopes away on the outer side
#   LS RS     sticks: a ring with a cap;  L3 R3 = the stick pressed in (cap filled)
#   DU DD DL DR   the d-pad cross with that arm filled;  DH / DV = left+right / up+down;  D4 = the whole pad
#   VIEW MENU     the two small pills in the middle

static func width(id: String, h: float) -> float:
	match id:
		"LB", "RB":
			return h * 1.55
		"LT", "RT":
			return h * 1.2
		"VIEW", "MENU":
			return h * 1.35
	return h


static func _label(ci: CanvasItem, font: Font, text: String, c: Vector2, sz: float, col: Color) -> void:
	ci.draw_string(font, Vector2(c.x - 60.0, c.y + sz * 0.36), text, HORIZONTAL_ALIGNMENT_CENTER, 120.0, int(round(sz)), col)


static func _plate(ci: CanvasItem, pts: PackedVector2Array, col: Color, lw: float) -> void:
	ci.draw_colored_polygon(pts, Color(col, col.a * 0.18))
	var loop := pts.duplicate()
	loop.append(pts[0])
	ci.draw_polyline(loop, Color(col, col.a * 0.95), lw, true)


# draws the glyph with its box centred on c; h = its height in pixels
static func draw(ci: CanvasItem, font: Font, id: String, c: Vector2, h: float, col: Color) -> void:
	var lw := maxf(1.2, h * 0.07)
	var r := h * 0.5
	match id:
		"A", "B", "X", "Y":
			ci.draw_circle(c, r, Color(col, col.a * 0.18))
			ci.draw_arc(c, r - lw * 0.5, 0.0, TAU, 28, Color(col, col.a * 0.95), lw, true)
			_label(ci, font, id, c, h * 0.62, col)
		"LB", "RB":
			var w := width(id, h)
			var hh := h * 0.8
			var x0 := c.x - w * 0.5
			var x1 := c.x + w * 0.5
			var y0 := c.y - hh * 0.5
			var y1 := c.y + hh * 0.5
			var k := hh * 0.48
			var pts: PackedVector2Array
			if id == "LB":
				pts = PackedVector2Array([Vector2(x0 + k, y0), Vector2(x1, y0), Vector2(x1, y1), Vector2(x0, y1), Vector2(x0, y0 + k)])
			else:
				pts = PackedVector2Array([Vector2(x0, y0), Vector2(x1 - k, y0), Vector2(x1, y0 + k), Vector2(x1, y1), Vector2(x0, y1)])
			_plate(ci, pts, col, lw)
			_label(ci, font, id, c + Vector2(k * (0.14 if id == "LB" else -0.14), 0.0), h * 0.5, col)
		"LT", "RT":
			var w := width(id, h)
			var x0 := c.x - w * 0.5
			var x1 := c.x + w * 0.5
			var y0 := c.y - r
			var y1 := c.y + r
			# inner side straight, outer side leaning away: the trigger seen from behind
			var pts := PackedVector2Array([Vector2(x0, y1), Vector2(x0, y0 + h * 0.16), Vector2(x0 + w * 0.2, y0), Vector2(x1 - w * 0.4, y0),
				Vector2(x1 - w * 0.12, y0 + h * 0.3), Vector2(x1, y1 - h * 0.12), Vector2(x1 - w * 0.1, y1)])
			if id == "LT":
				var mir := PackedVector2Array()
				for i in range(pts.size() - 1, -1, -1):
					mir.append(Vector2(2.0 * c.x - pts[i].x, pts[i].y))
				pts = mir
			_plate(ci, pts, col, lw)
			_label(ci, font, id, c + Vector2(w * (0.06 if id == "LT" else -0.06), h * 0.08), h * 0.46, col)
		"LS", "RS", "L3", "R3":
			var press := id.ends_with("3")
			ci.draw_arc(c, r - lw * 0.5, 0.0, TAU, 28, Color(col, col.a * 0.95), lw, true)
			ci.draw_circle(c, r * 0.64, Color(col, col.a * (0.92 if press else 0.22)))
			if not press:
				ci.draw_arc(c, r * 0.64, 0.0, TAU, 24, Color(col, col.a * 0.6), maxf(1.0, lw * 0.7), true)
			_label(ci, font, id.left(1), c, h * 0.46, Color(0.03, 0.04, 0.04, col.a) if press else col)
		"DU", "DD", "DL", "DR", "DH", "DV", "D4":
			var a := h * 0.36          # arm thickness
			var e := r
			var q := a * 0.5
			var cross := PackedVector2Array([Vector2(-q, -e), Vector2(q, -e), Vector2(q, -q), Vector2(e, -q), Vector2(e, q), Vector2(q, q),
				Vector2(q, e), Vector2(-q, e), Vector2(-q, q), Vector2(-e, q), Vector2(-e, -q), Vector2(-q, -q)])
			var pts := PackedVector2Array()
			for p in cross:
				pts.append(c + p)
			# a concave outline: fill it as three rectangles, stroke it as one loop
			ci.draw_rect(Rect2(c.x - q, c.y - e, a, h), Color(col, col.a * 0.16))
			ci.draw_rect(Rect2(c.x - e, c.y - q, e - q, a), Color(col, col.a * 0.16))
			ci.draw_rect(Rect2(c.x + q, c.y - q, e - q, a), Color(col, col.a * 0.16))
			# the outline stays faint so the arm that is meant stands out solid
			var loop := pts.duplicate()
			loop.append(pts[0])
			ci.draw_polyline(loop, Color(col, col.a * 0.55), maxf(1.0, lw * 0.75), true)
			var on := Color(col, col.a)
			var g := lw * 0.4          # the solid arm overlaps the outline a little
			if id == "DU" or id == "DV" or id == "D4":
				ci.draw_rect(Rect2(c.x - q - g, c.y - e - g, a + g * 2.0, e - q + g), on)
			if id == "DD" or id == "DV" or id == "D4":
				ci.draw_rect(Rect2(c.x - q - g, c.y + q, a + g * 2.0, e - q + g), on)
			if id == "DL" or id == "DH" or id == "D4":
				ci.draw_rect(Rect2(c.x - e - g, c.y - q - g, e - q + g, a + g * 2.0), on)
			if id == "DR" or id == "DH" or id == "D4":
				ci.draw_rect(Rect2(c.x + q, c.y - q - g, e - q + g, a + g * 2.0), on)
		"VIEW", "MENU":
			var w := width(id, h)
			var hh := h * 0.66
			var rr := hh * 0.5
			var pts := PackedVector2Array()
			for i in 9:
				var ang := -PI * 0.5 + PI * float(i) / 8.0
				pts.append(Vector2(c.x + w * 0.5 - rr + cos(ang) * rr, c.y + sin(ang) * rr))
			for i in 9:
				var ang := PI * 0.5 + PI * float(i) / 8.0
				pts.append(Vector2(c.x - w * 0.5 + rr + cos(ang) * rr, c.y + sin(ang) * rr))
			_plate(ci, pts, col, lw)
			var ic := Color(col, col.a * 0.95)
			var s := hh * 0.2
			if id == "MENU":
				for j in 3:
					var yy := c.y + (float(j) - 1.0) * s * 1.05
					ci.draw_line(Vector2(c.x - s * 1.5, yy), Vector2(c.x + s * 1.5, yy), ic, maxf(1.0, lw * 0.8))
			else:
				ci.draw_rect(Rect2(c.x - s * 1.5, c.y - s * 1.3, s * 2.0, s * 1.7), ic, false, maxf(1.0, lw * 0.8))
				ci.draw_rect(Rect2(c.x - s * 0.5, c.y - s * 0.4, s * 2.0, s * 1.7), ic, false, maxf(1.0, lw * 0.8))
		_:
			_label(ci, font, id, c, h * 0.6, col)


# A prompt line of text and glyphs: parts are strings, a part that starts with "@" is a glyph id.
# align 0 = from x, 1 = centred on x, 2 = ending at x. y is the text baseline. Returns the width.
static func line(ci: CanvasItem, font: Font, parts: Array, x: float, y: float, sz: int, col: Color, align: int = 0, gcol = null) -> float:
	var gh := float(sz) * 1.4
	var total := 0.0
	var ws: Array = []
	for p in parts:
		var s := str(p)
		var wv: float = width(s.substr(1), gh) + 2.0 if s.begins_with("@") else font.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, sz).x
		ws.append(wv)
		total += wv
	var px := x
	if align == 1:
		px = x - total * 0.5
	elif align == 2:
		px = x - total
	var gc: Color = col if gcol == null else gcol
	for i in parts.size():
		var s := str(parts[i])
		if s.begins_with("@"):
			draw(ci, font, s.substr(1), Vector2(px + float(ws[i]) * 0.5, y - float(sz) * 0.36), gh, gc)
		else:
			ci.draw_string(font, Vector2(px, y), s, HORIZONTAL_ALIGNMENT_LEFT, -1, sz, col)
		px += float(ws[i])
	return total
