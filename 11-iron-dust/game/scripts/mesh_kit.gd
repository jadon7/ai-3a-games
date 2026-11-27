extends RefCounted
# Collects primitive parts per bone and bakes one mesh per (bone, material key).
# Vertex colour: R = per-part shade, G = dust amount (by rest height).

class Surf:
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	var c := PackedColorArray()

var bones: Array[Node3D] = []
var dust := 0.55
var dust_top := 8.0
var jitter := 0.2
var _rng := RandomNumberGenerator.new()


func _init(seed_v: int = 1) -> void:
	_rng.seed = seed_v


func bone(parent: Node3D, pos: Vector3 = Vector3.ZERO) -> Node3D:
	var n := Node3D.new()
	n.position = pos
	parent.add_child(n)
	var py: float = parent.get_meta("rest_y", 0.0)
	n.set_meta("rest_y", py + pos.y)
	n.set_meta("surf", {})
	bones.append(n)
	return n


func _surf(b: Node3D, key: String) -> Surf:
	var d: Dictionary = b.get_meta("surf")
	if not d.has(key):
		d[key] = Surf.new()
	return d[key]


func _xf(pos: Vector3, rot: Vector3) -> Transform3D:
	return Transform3D(Basis.from_euler(rot), pos)


func _col(shade: float, wy: float) -> Color:
	var d := clampf((dust_top - wy) / (dust_top - 0.3), 0.0, 1.0)
	d = d * d * (3.0 - 2.0 * d) * dust
	return Color(shade, d, 0.0)


# a,b,c with per-vertex outward normals; emits with Godot's clockwise front winding
func _tri(s: Surf, xf: Transform3D, ry: float, shade: float, a: Vector3, b: Vector3, c: Vector3, na: Vector3, nb: Vector3, nc: Vector3) -> void:
	var g := (b - a).cross(c - a)
	if g.dot(na + nb + nc) > 0.0:
		var t := b
		b = c
		c = t
		var tn := nb
		nb = nc
		nc = tn
	var pa := xf * a
	var pb := xf * b
	var pc := xf * c
	s.v.append(pa)
	s.v.append(pb)
	s.v.append(pc)
	s.n.append(xf.basis * na)
	s.n.append(xf.basis * nb)
	s.n.append(xf.basis * nc)
	s.c.append(_col(shade, ry + pa.y))
	s.c.append(_col(shade, ry + pb.y))
	s.c.append(_col(shade, ry + pc.y))


func _quad(s: Surf, xf: Transform3D, ry: float, shade: float, a: Vector3, b: Vector3, c: Vector3, d: Vector3, center: Vector3) -> void:
	var n := (b - a).cross(c - a)
	if n.length_squared() < 1e-9:
		n = (c - a).cross(d - a)
	if n.length_squared() < 1e-9:
		return
	n = n.normalized()
	if n.dot((a + b + c + d) * 0.25 - center) < 0.0:
		n = -n
	_tri(s, xf, ry, shade, a, b, c, n, n, n)
	_tri(s, xf, ry, shade, a, c, d, n, n, n)


func _shade(shade: float) -> float:
	if shade >= 0.0:
		return shade
	return 1.0 - jitter * 0.5 + _rng.randf() * jitter


# taper keys: tx,tz (top scale) bx,bz (bottom scale) sx,sz (top shift)
func box(b: Node3D, key: String, size: Vector3, pos: Vector3 = Vector3.ZERO, rot: Vector3 = Vector3.ZERO, t: Dictionary = {}, shade: float = -1.0) -> void:
	var s := _surf(b, key)
	var xf := _xf(pos, rot)
	var ry: float = b.get_meta("rest_y", 0.0)
	var sh := _shade(shade)
	var hx := size.x * 0.5
	var hy := size.y * 0.5
	var hz := size.z * 0.5
	var tx: float = t.get("tx", 1.0)
	var tz: float = t.get("tz", 1.0)
	var bx: float = t.get("bx", 1.0)
	var bz: float = t.get("bz", 1.0)
	var sx: float = t.get("sx", 0.0)
	var sz: float = t.get("sz", 0.0)
	var p: Array[Vector3] = [
		Vector3(-hx * bx, -hy, -hz * bz), Vector3(hx * bx, -hy, -hz * bz), Vector3(hx * bx, -hy, hz * bz), Vector3(-hx * bx, -hy, hz * bz),
		Vector3(-hx * tx + sx, hy, -hz * tz + sz), Vector3(hx * tx + sx, hy, -hz * tz + sz), Vector3(hx * tx + sx, hy, hz * tz + sz), Vector3(-hx * tx + sx, hy, hz * tz + sz)]
	var c := Vector3(sx * 0.5, 0, sz * 0.5)
	_quad(s, xf, ry, sh, p[0], p[1], p[2], p[3], c)
	_quad(s, xf, ry, sh, p[4], p[5], p[6], p[7], c)
	_quad(s, xf, ry, sh, p[0], p[1], p[5], p[4], c)
	_quad(s, xf, ry, sh, p[1], p[2], p[6], p[5], c)
	_quad(s, xf, ry, sh, p[2], p[3], p[7], p[6], c)
	_quad(s, xf, ry, sh, p[3], p[0], p[4], p[7], c)


# Hull lofted along local Z through stations [[z, half width, half height, deck k, keel k, upper k, lower k, y], ...]
# (z ascending). Each station is an eight-sided cut of a box: a flat deck (half width * deck k) and keel
# (* keel k), full width between y + hh * upper k and y - hh * lower k, canted faces between them.
func hull(b: Node3D, key: String, st: Array, pos: Vector3 = Vector3.ZERO, shade: float = -1.0, caps: bool = true) -> void:
	var s := _surf(b, key)
	var xf := _xf(pos, Vector3.ZERO)
	var ry: float = b.get_meta("rest_y", 0.0)
	var rings: Array = []
	for e in st:
		var z: float = e[0]
		var hw: float = e[1]
		var hh: float = e[2]
		var yo: float = e[7]
		var wt: float = hw * float(e[3])
		var wb: float = hw * float(e[4])
		var yu: float = yo + hh * float(e[5])
		var yl: float = yo - hh * float(e[6])
		rings.append([Vector3(wt, yo + hh, z), Vector3(hw, yu, z), Vector3(hw, yl, z), Vector3(wb, yo - hh, z),
			Vector3(-wb, yo - hh, z), Vector3(-hw, yl, z), Vector3(-hw, yu, z), Vector3(-wt, yo + hh, z)])
	for i in rings.size() - 1:
		var r0: Array = rings[i]
		var r1: Array = rings[i + 1]
		var c := Vector3(0, (float(st[i][7]) + float(st[i + 1][7])) * 0.5, (float(st[i][0]) + float(st[i + 1][0])) * 0.5)
		var sh := _shade(shade)
		for j in 8:
			var j1 := (j + 1) % 8
			_quad(s, xf, ry, sh * (1.0 if j % 2 == 0 else 0.93), r0[j], r0[j1], r1[j1], r1[j], c)
	if caps:
		for q in 2:
			var r: Array = rings[0] if q == 0 else rings[rings.size() - 1]
			var n := Vector3(0, 0, -1.0 if q == 0 else 1.0)
			var sh2 := _shade(shade)
			for j in range(1, 7):
				_tri(s, xf, ry, sh2, r[0], r[j], r[j + 1], n, n, n)


# cylinder / cone along local Y
func cyl(b: Node3D, key: String, rt: float, rb: float, h: float, pos: Vector3 = Vector3.ZERO, rot: Vector3 = Vector3.ZERO, seg: int = 12, shade: float = -1.0) -> void:
	var s := _surf(b, key)
	var xf := _xf(pos, rot)
	var ry: float = b.get_meta("rest_y", 0.0)
	var sh := _shade(shade)
	var hy := h * 0.5
	var slope := (rb - rt) / h
	for i in seg:
		var a0 := TAU * i / seg
		var a1 := TAU * (i + 1) / seg
		var c0 := Vector3(cos(a0), 0, sin(a0))
		var c1 := Vector3(cos(a1), 0, sin(a1))
		var n0 := Vector3(c0.x, slope, c0.z).normalized()
		var n1 := Vector3(c1.x, slope, c1.z).normalized()
		var b0 := c0 * rb + Vector3(0, -hy, 0)
		var b1 := c1 * rb + Vector3(0, -hy, 0)
		var t0 := c0 * rt + Vector3(0, hy, 0)
		var t1 := c1 * rt + Vector3(0, hy, 0)
		if rb > 0.001:
			_tri(s, xf, ry, sh, b0, b1, t1, n0, n1, n1)
			_tri(s, xf, ry, sh, Vector3(0, -hy, 0), b0, b1, Vector3.DOWN, Vector3.DOWN, Vector3.DOWN)
		if rt > 0.001:
			_tri(s, xf, ry, sh, b0, t1, t0, n0, n1, n0)
			_tri(s, xf, ry, sh, Vector3(0, hy, 0), t0, t1, Vector3.UP, Vector3.UP, Vector3.UP)


func ball(b: Node3D, key: String, r: Vector3, pos: Vector3 = Vector3.ZERO, rot: Vector3 = Vector3.ZERO, shade: float = -1.0) -> void:
	var s := _surf(b, key)
	var xf := _xf(pos, rot)
	var ry: float = b.get_meta("rest_y", 0.0)
	var sh := _shade(shade)
	var lat := 6
	var lon := 12
	for i in lat:
		var v0 := PI * i / lat
		var v1 := PI * (i + 1) / lat
		for j in lon:
			var u0 := TAU * j / lon
			var u1 := TAU * (j + 1) / lon
			var n00 := Vector3(sin(v0) * cos(u0), cos(v0), sin(v0) * sin(u0))
			var n01 := Vector3(sin(v0) * cos(u1), cos(v0), sin(v0) * sin(u1))
			var n10 := Vector3(sin(v1) * cos(u0), cos(v1), sin(v1) * sin(u0))
			var n11 := Vector3(sin(v1) * cos(u1), cos(v1), sin(v1) * sin(u1))
			if i > 0:
				_tri(s, xf, ry, sh, n00 * r, n01 * r, n11 * r, n00, n01, n11)
			if i < lat - 1:
				_tri(s, xf, ry, sh, n00 * r, n11 * r, n10 * r, n00, n11, n10)


# mats: key -> {"mat": Material, "params": {instance uniform: value}}
func bake(mats: Dictionary, shadows: bool = true) -> Array[MeshInstance3D]:
	var out: Array[MeshInstance3D] = []
	for b in bones:
		var d: Dictionary = b.get_meta("surf")
		for key in d:
			var s: Surf = d[key]
			if s.v.is_empty():
				continue
			var arr := []
			arr.resize(Mesh.ARRAY_MAX)
			arr[Mesh.ARRAY_VERTEX] = s.v
			arr[Mesh.ARRAY_NORMAL] = s.n
			arr[Mesh.ARRAY_COLOR] = s.c
			var m := ArrayMesh.new()
			m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
			var mi := MeshInstance3D.new()
			mi.mesh = m
			var spec: Dictionary = mats[key]
			mi.material_override = spec["mat"]
			var params: Dictionary = spec.get("params", {})
			for k in params:
				mi.set_instance_shader_parameter(k, params[k])
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			mi.set_meta("key", key)
			b.add_child(mi)
			out.append(mi)
		b.remove_meta("surf")
	bones.clear()
	return out
