extends RefCounted
# Building kit in a Metabolist / brutalist megastructure language. Everything is written into
# the caller's MeshKit bone (which must sit at the origin, like the bones world.gd makes);
# collision goes through the caller's add_box(cx, cz, size_x, size_z, y0, y1, list).
# No nodes, lights or particles are created.
#
#   tower()      one building in one of four styles: dressed-stone block, core and slab,
#                capsule tower, perforated megaslab; any of them intact or ruined
#   megablock()  a megastructure: big round cores linked by bars at different heights
#   megahall()   a colossal assembly hall with cranes, silos, ribbed pipe runs, yards
#   skyframe()   a platform city on pylons for the far skyline (no collision)
#   mats()       the material entries all of the above need (keys B??)
#   hall_pad()   the flat ground a megahall needs
#   last         box / triangle / collider counts and top height of what was just made
#   direct       false = every part goes through plain k.box / k.cyl (about 6x slower)
#
#   var mats := _mats()
#   mats.merge(Buildings.mats())
#   Buildings.tower(k, g, _add_box, x, z, w, d, h, height(x, z), _rng, 0.4)
#   Buildings.megahall(k, g, _add_box, x, z, 300.0, 150.0, 120.0, pad_y, 0.0, _rng)
#   k.bake(mats)
#
# Windows, fins, trays and portholes are geometry, not texture: a 30 x 30 x 40 tower is
# 100 to 250 parts and builds in well under a millisecond. tower() and megablock() append
# their footprint AABB to the bone's "bld" meta so other code can find the building again.

const Tex = preload("res://scripts/tex.gd")

# face bits of an axis-aligned box
const PX := 1
const NX := 2
const PZ := 4
const NZ := 8
const TOP := 16
const BOT := 32
const SIDES := 15
const SHELL := 31
const ALL := 63
const FH := 4.0            # storey height
const HP := PI * 0.5

# true: axis-aligned boxes are appended straight into the kit's surfaces and faces that can
# never be seen are left out (about 8x faster than k.box, half the triangles).
# false: every part is a plain k.box call.
static var direct := true
# numbers of the most recent tower() / megahall() call; "top" is the world height of its
# highest solid point (e.g. to put smoke on a ruin)
static var last := {"boxes": 0, "tris": 0, "colliders": 0, "top": 0.0}


class Ctx:
	var k
	var g: Node3D
	var add: Callable
	var rng: RandomNumberGenerator
	var o := Vector3.ZERO     # origin: footprint centre at base height
	var q := 0                # quarter turns about Y
	var fast := false
	var rest_y := 0.0
	var dtop := 0.0
	var surfs := {}
	var boxes := 0
	var tris := 0
	var cols := 0
	var top := -1e9

	func _init(kit, bone: Node3D, add_box: Callable, r: RandomNumberGenerator, origin: Vector3, quarter: int, use_direct: bool) -> void:
		k = kit
		g = bone
		add = add_box
		rng = r
		o = origin
		q = posmod(quarter, 4)
		fast = use_direct and kit.has_method("_surf") and kit.has_method("_col") and "dust_top" in kit
		rest_y = bone.get_meta("rest_y", 0.0)
		if fast:
			dtop = kit.dust_top

	# local point -> world
	func pt(p: Vector3) -> Vector3:
		if q == 1:
			return Vector3(o.x + p.z, o.y + p.y, o.z - p.x)
		if q == 2:
			return Vector3(o.x - p.x, o.y + p.y, o.z - p.z)
		if q == 3:
			return Vector3(o.x - p.z, o.y + p.y, o.z + p.x)
		return o + p

	# axis-aligned box given by centre and size (local space); mask = faces worth drawing
	func box(key: String, cx: float, cy: float, cz: float, sx: float, sy: float, sz: float, shade: float = 1.0, mask: int = 31) -> void:
		if sx < 0.02 or sy < 0.02 or sz < 0.02:
			return
		var x := cx
		var z := cz
		if q == 1:
			x = cz
			z = -cx
			var t := sx
			sx = sz
			sz = t
			mask = (mask & 48) | ((mask & 1) << 3) | ((mask & 2) << 1) | ((mask & 12) >> 2)
		elif q == 2:
			x = -cx
			z = -cz
			mask = (mask & 48) | ((mask & 5) << 1) | ((mask & 10) >> 1)
		elif q == 3:
			x = -cz
			z = cx
			var t := sx
			sx = sz
			sz = t
			mask = (mask & 48) | ((mask & 3) << 2) | ((mask & 4) >> 1) | ((mask & 8) >> 3)
		x += o.x
		z += o.z
		var y := cy + o.y
		boxes += 1
		if not fast:
			k.box(g, key, Vector3(sx, sy, sz), Vector3(x, y, z), Vector3.ZERO, {}, shade)
			tris += 12
			return
		var s = surfs.get(key)
		if s == null:
			s = k._surf(g, key)
			surfs[key] = s
		var v: PackedVector3Array = s.v
		var n: PackedVector3Array = s.n
		var c: PackedColorArray = s.c
		var x0 := x - sx * 0.5
		var x1 := x + sx * 0.5
		var y0 := y - sy * 0.5
		var y1 := y + sy * 0.5
		var z0 := z - sz * 0.5
		var z1 := z + sz * 0.5
		var c0 := Color(shade, 0.0, 0.0)
		var c1 := c0
		if rest_y + y0 < dtop:
			c0 = k._col(shade, rest_y + y0)
			c1 = k._col(shade, rest_y + y1)
		if mask & 1:
			var a := Vector3(x1, y0, z0)
			var e := Vector3(x1, y1, z1)
			v.append(a)
			v.append(Vector3(x1, y0, z1))
			v.append(e)
			v.append(a)
			v.append(e)
			v.append(Vector3(x1, y1, z0))
			var nn := Vector3(1, 0, 0)
			n.append(nn)
			n.append(nn)
			n.append(nn)
			n.append(nn)
			n.append(nn)
			n.append(nn)
			c.append(c0)
			c.append(c0)
			c.append(c1)
			c.append(c0)
			c.append(c1)
			c.append(c1)
			tris += 2
		if mask & 2:
			var a := Vector3(x0, y0, z1)
			var e := Vector3(x0, y1, z0)
			v.append(a)
			v.append(Vector3(x0, y0, z0))
			v.append(e)
			v.append(a)
			v.append(e)
			v.append(Vector3(x0, y1, z1))
			var nn := Vector3(-1, 0, 0)
			n.append(nn)
			n.append(nn)
			n.append(nn)
			n.append(nn)
			n.append(nn)
			n.append(nn)
			c.append(c0)
			c.append(c0)
			c.append(c1)
			c.append(c0)
			c.append(c1)
			c.append(c1)
			tris += 2
		if mask & 4:
			var a := Vector3(x1, y0, z1)
			var e := Vector3(x0, y1, z1)
			v.append(a)
			v.append(Vector3(x0, y0, z1))
			v.append(e)
			v.append(a)
			v.append(e)
			v.append(Vector3(x1, y1, z1))
			var nn := Vector3(0, 0, 1)
			n.append(nn)
			n.append(nn)
			n.append(nn)
			n.append(nn)
			n.append(nn)
			n.append(nn)
			c.append(c0)
			c.append(c0)
			c.append(c1)
			c.append(c0)
			c.append(c1)
			c.append(c1)
			tris += 2
		if mask & 8:
			var a := Vector3(x0, y0, z0)
			var e := Vector3(x1, y1, z0)
			v.append(a)
			v.append(Vector3(x1, y0, z0))
			v.append(e)
			v.append(a)
			v.append(e)
			v.append(Vector3(x0, y1, z0))
			var nn := Vector3(0, 0, -1)
			n.append(nn)
			n.append(nn)
			n.append(nn)
			n.append(nn)
			n.append(nn)
			n.append(nn)
			c.append(c0)
			c.append(c0)
			c.append(c1)
			c.append(c0)
			c.append(c1)
			c.append(c1)
			tris += 2
		if mask & 16:
			var a := Vector3(x0, y1, z0)
			var e := Vector3(x1, y1, z1)
			v.append(a)
			v.append(Vector3(x1, y1, z0))
			v.append(e)
			v.append(a)
			v.append(e)
			v.append(Vector3(x0, y1, z1))
			var nn := Vector3(0, 1, 0)
			n.append(nn)
			n.append(nn)
			n.append(nn)
			n.append(nn)
			n.append(nn)
			n.append(nn)
			c.append(c1)
			c.append(c1)
			c.append(c1)
			c.append(c1)
			c.append(c1)
			c.append(c1)
			tris += 2
		if mask & 32:
			var a := Vector3(x0, y0, z1)
			var e := Vector3(x1, y0, z0)
			v.append(a)
			v.append(Vector3(x1, y0, z1))
			v.append(e)
			v.append(a)
			v.append(e)
			v.append(Vector3(x0, y0, z0))
			var nn := Vector3(0, -1, 0)
			n.append(nn)
			n.append(nn)
			n.append(nn)
			n.append(nn)
			n.append(nn)
			n.append(nn)
			c.append(c0)
			c.append(c0)
			c.append(c0)
			c.append(c0)
			c.append(c0)
			c.append(c0)
			tris += 2

	# box given by its y range instead of centre / height
	func slab(key: String, cx: float, cz: float, sx: float, sz: float, y0: float, y1: float, shade: float = 1.0, mask: int = 31) -> void:
		box(key, cx, (y0 + y1) * 0.5, cz, sx, y1 - y0, sz, shade, mask)

	# box of w (sideways) x d (upward) running from a to b
	func beam(key: String, a: Vector3, b: Vector3, w: float, d: float, shade: float = 1.0) -> void:
		var pa := pt(a)
		var pb := pt(b)
		var dir := pb - pa
		var ln := dir.length()
		if ln < 0.05:
			return
		var yv := dir / ln
		var xv := yv.cross(Vector3.UP)
		if xv.length_squared() < 1e-4:
			xv = Vector3.RIGHT
		xv = xv.normalized()
		k.box(g, key, Vector3(w, ln, d), (pa + pb) * 0.5, Basis(xv, yv, xv.cross(yv)).get_euler(), {}, shade)
		boxes += 1
		tris += 12

	# freely rotated / tapered box (rubble, leaning slabs)
	func tilt(key: String, size: Vector3, p: Vector3, rot: Vector3, shade: float = 1.0, t: Dictionary = {}) -> void:
		k.box(g, key, size, pt(p), Vector3(rot.x, rot.y + q * PI * 0.5, rot.z), t, shade)
		boxes += 1
		tris += 12

	func cyl(key: String, rt: float, rb: float, h: float, p: Vector3, seg: int = 10, shade: float = 1.0, rot: Vector3 = Vector3.ZERO) -> void:
		k.cyl(g, key, rt, rb, h, pt(p), Vector3(rot.x, rot.y + q * PI * 0.5, rot.z), seg, shade)
		boxes += 1
		tris += seg * 4

	# a local direction after the quarter turns
	func dir(p: Vector3) -> Vector3:
		if q == 1:
			return Vector3(p.z, p.y, -p.x)
		if q == 2:
			return Vector3(-p.x, p.y, -p.z)
		if q == 3:
			return Vector3(-p.z, p.y, p.x)
		return p

	# round prism or cone along a local axis (0 X, 1 Y, 2 Z) centred on (cx, cy, cz):
	# radius r0 at the low end, r1 at the high end; parts: 1 wall, 2 high cap, 4 low cap
	func tube(key: String, cx: float, cy: float, cz: float, r0: float, r1: float, ln: float, seg: int = 12, shade: float = 1.0, axis: int = 1, parts: int = 7) -> void:
		if ln < 0.02 or (r0 < 0.02 and r1 < 0.02):
			return
		boxes += 1
		var o3 := pt(Vector3(cx, cy, cz))
		if not fast:
			var rot := Vector3(0, q * PI * 0.5, 0)
			if axis == 0:
				rot.z = -PI * 0.5
			elif axis == 2:
				rot.x = PI * 0.5
			k.cyl(g, key, r1, r0, ln, o3, rot, seg, shade)
			tris += seg * 4
			return
		var wv := Vector3.UP
		var uv := dir(Vector3(1, 0, 0))
		var vv := dir(Vector3(0, 0, 1))
		if axis == 0:
			wv = uv
			uv = vv
			vv = Vector3.UP
		elif axis == 2:
			wv = vv
			vv = uv
			uv = Vector3.UP
		var s = surfs.get(key)
		if s == null:
			s = k._surf(g, key)
			surfs[key] = s
		var v: PackedVector3Array = s.v
		var n: PackedVector3Array = s.n
		var c: PackedColorArray = s.c
		var lo := o3 - wv * (ln * 0.5)
		var hi := o3 + wv * (ln * 0.5)
		var slope := (r0 - r1) / ln
		var col := Color(shade, 0.0, 0.0)
		var dusty := rest_y + o3.y - (ln * 0.5 if axis == 1 else maxf(r0, r1)) < dtop
		var d0 := uv
		var st := TAU / seg
		for i in seg:
			var a := st * (i + 1)
			var d1 := uv * cos(a) + vv * sin(a)
			var b0 := lo + d0 * r0
			var b1 := lo + d1 * r0
			var t0 := hi + d0 * r1
			var t1 := hi + d1 * r1
			if parts & 1:
				var n0 := (d0 + wv * slope).normalized()
				var n1 := (d1 + wv * slope).normalized()
				v.append(b0)
				v.append(b1)
				v.append(t1)
				v.append(b0)
				v.append(t1)
				v.append(t0)
				n.append(n0)
				n.append(n1)
				n.append(n1)
				n.append(n0)
				n.append(n1)
				n.append(n0)
				if dusty:
					var cb0: Color = k._col(shade, rest_y + b0.y)
					var cb1: Color = k._col(shade, rest_y + b1.y)
					var ct0: Color = k._col(shade, rest_y + t0.y)
					var ct1: Color = k._col(shade, rest_y + t1.y)
					c.append(cb0)
					c.append(cb1)
					c.append(ct1)
					c.append(cb0)
					c.append(ct1)
					c.append(ct0)
				else:
					c.append(col)
					c.append(col)
					c.append(col)
					c.append(col)
					c.append(col)
					c.append(col)
				tris += 2
			if (parts & 2) and r1 > 0.02:
				v.append(hi)
				v.append(t0)
				v.append(t1)
				n.append(wv)
				n.append(wv)
				n.append(wv)
				c.append(col)
				c.append(col)
				c.append(col)
				tris += 1
			if (parts & 4) and r0 > 0.02:
				v.append(lo)
				v.append(b1)
				v.append(b0)
				n.append(-wv)
				n.append(-wv)
				n.append(-wv)
				c.append(col)
				c.append(col)
				c.append(col)
				tris += 1
			d0 = d1

	# flat round plate on a vertical face (0 +X, 1 -X, 2 +Z, 3 -Z), e.g. a porthole
	func disc(key: String, x: float, y: float, z: float, f: int, r: float, shade: float = 1.0, seg: int = 10) -> void:
		if f == 0:
			tube(key, x - 0.05, y, z, r, r, 0.1, seg, shade, 0, 2)
		elif f == 1:
			tube(key, x + 0.05, y, z, r, r, 0.1, seg, shade, 0, 4)
		elif f == 2:
			tube(key, x, y, z - 0.05, r, r, 0.1, seg, shade, 2, 2)
		else:
			tube(key, x, y, z + 0.05, r, r, 0.1, seg, shade, 2, 4)

	# collision box (local space)
	func solid(cx: float, cz: float, sx: float, sz: float, y0: float, y1: float, list: bool = false) -> void:
		if sx < 0.3 or sz < 0.3 or y1 - y0 < 0.3:
			return
		var p := pt(Vector3(cx, 0, cz))
		if q % 2 == 1:
			add.call(p.x, p.z, sz, sx, o.y + y0, o.y + y1, list)
		else:
			add.call(p.x, p.z, sx, sz, o.y + y0, o.y + y1, list)
		cols += 1
		top = maxf(top, o.y + y1)

static func _done(c: Ctx) -> void:
	last = {"boxes": c.boxes, "tris": c.tris, "colliders": c.cols, "top": c.top}


# material entries to merge into the dictionary handed to MeshKit.bake()
static func mats() -> Dictionary:
	return {
		# tower blocks: three stone colours, window glass
		"BS1": {"mat": Tex.concrete, "params": {"tint": Color(0.66, 0.53, 0.37), "metal": 0.0, "wear": 0.7}},
		"BS2": {"mat": Tex.concrete, "params": {"tint": Color(0.68, 0.61, 0.48), "metal": 0.0, "wear": 0.7}},
		"BS3": {"mat": Tex.concrete, "params": {"tint": Color(0.6, 0.43, 0.31), "metal": 0.0, "wear": 0.8}},
		"BGL": {"mat": Tex.armor, "params": {"tint": Color(0.03, 0.042, 0.06), "metal": 0.75, "wear": 0.0}},
		# assembly hall
		"BHW": {"mat": Tex.corrugated, "params": {"tint": Color(0.62, 0.64, 0.65), "metal": 0.25, "wear": 0.45}},
		"BHB": {"mat": Tex.plating, "params": {"tint": Color(0.3, 0.34, 0.38), "metal": 0.4, "wear": 0.8}},
		"BHL": {"mat": Tex.plating, "params": {"tint": Color(0.7, 0.72, 0.7), "metal": 0.05, "wear": 0.35}},
		"BCG": {"mat": Tex.concrete, "params": {"tint": Color(0.52, 0.51, 0.49), "metal": 0.0}},
		"BST": {"mat": Tex.armor, "params": {"tint": Color(0.2, 0.21, 0.23), "metal": 0.6, "wear": 0.9}},
		"BRD": {"mat": Tex.armor, "params": {"tint": Color(0.56, 0.09, 0.05), "metal": 0.3, "wear": 0.9}},
		"BYL": {"mat": Tex.armor, "params": {"tint": Color(0.82, 0.58, 0.06), "metal": 0.25, "wear": 0.9}},
		"BHZ": {"mat": Tex.armor, "params": {"tint": Color(0.7, 0.5, 0.06), "metal": 0.2, "wear": 1.1, "stripes": 1.0}},
		"BK1": {"mat": Tex.corrugated, "params": {"tint": Color(0.46, 0.15, 0.09), "metal": 0.35}},
		"BK2": {"mat": Tex.corrugated, "params": {"tint": Color(0.14, 0.27, 0.4), "metal": 0.35}},
		"BK3": {"mat": Tex.corrugated, "params": {"tint": Color(0.62, 0.6, 0.54), "metal": 0.35}},
		# megastructure language: pale precast (plug-in modules, spheres), rusted plant steel
		"BCW": {"mat": Tex.concrete, "params": {"tint": Color(0.76, 0.74, 0.7), "metal": 0.0, "wear": 0.6}},
		"BRS": {"mat": Tex.plating, "params": {"tint": Color(0.36, 0.2, 0.12), "metal": 0.35, "wear": 1.2}},
		# far skyline: near-black mass and lit windows
		"BSK": {"mat": Tex.concrete, "params": {"tint": Color(0.1, 0.095, 0.105), "metal": 0.0, "wear": 0.3}},
		"BLT": {"mat": Tex.glow_mat(Color(1.0, 0.58, 0.28), 3.0)},
	}


# ------------------------------------------------------------------ tower blocks
# splits one face into corner piers, bays, pilasters and window columns
static func _layout(ln: float, sc: float, bay_t: float, col_t: float) -> Dictionary:
	var cw := clampf(ln * 0.12, 1.8 * sc, 6.5 * sc)
	var lb := maxf(ln - 2.0 * cw, 1.0)
	var nb := maxi(1, int(roundf(lb / bay_t)))
	var bw := lb / nb
	var pw := clampf(bw * 0.22, 0.9, 2.4 * sc)
	var pil := PackedFloat32Array()
	var mul := PackedFloat32Array()
	var mw := 1.0
	for i in nb:
		var l := -lb * 0.5 + i * bw + (pw * 0.5 if i > 0 else 0.0)
		var r := -lb * 0.5 + (i + 1) * bw - (pw * 0.5 if i < nb - 1 else 0.0)
		if i > 0:
			pil.append(-lb * 0.5 + i * bw)
		var nc := maxi(1, int(roundf((r - l) / col_t)))
		var cwid := (r - l) / nc
		mw = cwid * 0.34
		for j in range(1, nc):
			mul.append(l + j * cwid)
	return {"cw": cw, "pw": pw, "pil": pil, "mul": mul, "mw": mw, "nb": nb, "bw": bw, "lb": lb}


# the numbers every facade is built from
# o: key sc sh | rp rg (pilaster relief, glass recess) | bay col (target bay / window pitch)
#    base band corn (base course, frieze, cornice overhang) | fh spf (storey, spandrel share)
#    span mull caps major (spandrels / mullions / capitals on-off, every n-th pilaster heavier)
static func _spec(sw: float, sd: float, y0: float, y1: float, o: Dictionary) -> Dictionary:
	var sc: float = o["sc"]
	var co: float = o.get("corn", 0.7 * sc)
	var ch := 0.0 if co <= 0.0 else clampf(0.9 * sc, 0.8, 2.0)
	var ytop := y1 - ch
	var base: float = o.get("base", 0.0)
	var band: float = o.get("band", 0.55 * FH)
	var ys := y0 + base
	var ye := ytop - band
	var fh: float = o.get("fh", FH)
	var nf := maxi(1, int(roundf((ye - ys) / fh)))
	fh = (ye - ys) / nf
	return {
		"key": o["key"], "sc": sc, "sh": o.get("sh", 1.0), "rp": o.get("rp", 1.0 * sc), "rg": o.get("rg", 0.5 * sc),
		"base": base, "co": co, "ch": ch, "ytop": ytop, "ys": ys, "ye": ye, "fh": fh, "nf": nf, "sp": fh * float(o.get("spf", 0.42)),
		"lx": _layout(sw, sc, o.get("bay", 7.2), o.get("col", 2.7)), "lz": _layout(sd, sc, o.get("bay", 7.2), o.get("col", 2.7)),
		"span": o.get("span", true), "mull": o.get("mull", true), "caps": o.get("caps", true), "major": o.get("major", 0), "gsh": o.get("gsh", 1.0),
	}


# One block with a modelled facade on all four sides. sw x sd is the plane of the pilaster
# faces; from the outside in: cornice, corner piers, pilasters, mullions, spandrels, glass.
# Pilasters, mullions and spandrels run right through the block, so one box serves two faces.
static func _stage(c: Ctx, cx: float, cz: float, sw: float, sd: float, y0: float, y1: float, o: Dictionary) -> void:
	var p := _spec(sw, sd, y0, y1, o)
	var key: String = p["key"]
	var sc: float = p["sc"]
	var sh: float = p["sh"]
	var rp: float = p["rp"]
	var rg: float = p["rg"]
	var ytop: float = p["ytop"]
	var ys: float = p["ys"]
	var ye: float = p["ye"]
	var fh: float = p["fh"]
	var sp: float = p["sp"]
	var co: float = p["co"]
	var lx: Dictionary = p["lx"]
	var lz: Dictionary = p["lz"]
	# dark core: the glass plane of every window
	c.slab("BGL", cx, cz, sw - 2.0 * (rp + rg), sd - 2.0 * (rp + rg), y0, ytop, p["gsh"], SIDES)
	if p["base"] > 0.0:
		c.slab(key, cx, cz, sw + 0.5 * sc, sd + 0.5 * sc, y0, ys, sh * 0.9, SHELL)
	if p["span"]:
		for i in range(1, int(p["nf"])):
			c.slab(key, cx, cz, sw - 2.0 * rp, sd - 2.0 * rp, ys + i * fh - sp, ys + i * fh, sh * 0.92, ALL)
			# sill
			c.slab(key, cx, cz, sw - 2.0 * rp + 0.4, sd - 2.0 * rp + 0.4, ys + i * fh - 0.05, ys + i * fh + 0.22, sh * 1.03, ALL)
	# frieze under the cornice
	c.slab(key, cx, cz, sw - 2.0 * rp, sd - 2.0 * rp, ye - sp, ytop, sh * 0.96, SIDES | BOT)
	if p["mull"]:
		for zp in lz["mul"]:
			c.slab(key, cx, cz + zp, sw - 2.0 * rp + 0.3, float(lz["mw"]), ys, ye - sp, sh * 0.98, SIDES)
		for xp in lx["mul"]:
			c.slab(key, cx + xp, cz, float(lx["mw"]), sd - 2.0 * rp + 0.3, ys, ye - sp, sh * 0.98, SIDES)
	var caps: bool = p["caps"]
	var major: int = p["major"]
	var cs := 0.5 * sc
	var idx := 0
	for zp in lz["pil"]:
		idx += 1
		var pw: float = lz["pw"]
		var ex := 0.0
		if major > 0 and idx % major == 0:
			pw *= 1.5
			ex = 0.5 * sc
		c.slab(key, cx, cz + zp, sw + 2.0 * ex, pw, y0, ytop, sh * 1.03, SIDES)
		if caps:
			c.slab(key, cx, cz + zp, sw + 2.0 * ex + cs, pw + cs, ytop - 1.3 * sc, ytop, sh * 1.06, SIDES | BOT)
			c.slab(key, cx, cz + zp, sw + 2.0 * ex + cs, pw + cs, ys, ys + 0.9 * sc, sh * 1.0, SIDES | TOP)
			c.slab(key, cx, cz + zp, sw + 2.0 * ex + 0.44 * sc, pw * 0.46, ys + 0.9 * sc, ytop - 1.3 * sc, sh * 1.05, SIDES)
		if co > 0.0:
			for s: float in [-1.0, 1.0]:
				c.slab(key, cx + s * (sw * 0.5 + co - 0.4 * sc), cz + zp, 0.8 * sc, pw * 0.8, y1, y1 + 1.7 * sc, sh * 1.05, SHELL)
	idx = 0
	for xp in lx["pil"]:
		idx += 1
		var pw: float = lx["pw"]
		var ex := 0.0
		if major > 0 and idx % major == 0:
			pw *= 1.5
			ex = 0.5 * sc
		c.slab(key, cx + xp, cz, pw, sd + 2.0 * ex, y0, ytop, sh * 1.03, SIDES)
		if caps:
			c.slab(key, cx + xp, cz, pw + cs, sd + 2.0 * ex + cs, ytop - 1.3 * sc, ytop, sh * 1.06, SIDES | BOT)
			c.slab(key, cx + xp, cz, pw + cs, sd + 2.0 * ex + cs, ys, ys + 0.9 * sc, sh * 1.0, SIDES | TOP)
			c.slab(key, cx + xp, cz, pw * 0.46, sd + 2.0 * ex + 0.44 * sc, ys + 0.9 * sc, ytop - 1.3 * sc, sh * 1.05, SIDES)
		if co > 0.0:
			for s: float in [-1.0, 1.0]:
				c.slab(key, cx + xp, cz + s * (sd * 0.5 + co - 0.4 * sc), pw * 0.8, 0.8 * sc, y1, y1 + 1.7 * sc, sh * 1.05, SHELL)
	# corner piers stand a little proud of the pilasters
	var e := 0.35 * sc
	var cwx: float = lx["cw"]
	var cwz: float = lz["cw"]
	for sx: float in [-1.0, 1.0]:
		for sz: float in [-1.0, 1.0]:
			c.slab(key, cx + sx * (sw * 0.5 - cwx * 0.5 + e * 0.5), cz + sz * (sd * 0.5 - cwz * 0.5 + e * 0.5), cwx + e, cwz + e, y0, ytop, sh * 1.04, SIDES)
			var e2 := e + 0.26 * sc
			var qw := cwx * 0.58 + e2
			var qd := cwz * 0.58 + e2
			c.slab(key, cx + sx * (sw * 0.5 + e2 - qw * 0.5), cz + sz * (sd * 0.5 + e2 - qd * 0.5), qw, qd, y0, ytop - 0.55 * sc, sh * 1.06, SIDES | TOP)
	if co > 0.0:
		c.slab(key, cx, cz, sw + 2.0 * co, sd + 2.0 * co, ytop, y1, sh * 1.07, ALL)
		c.slab(key, cx, cz, sw + co, sd + co, ytop - 0.55 * sc, ytop, sh, SIDES | BOT)


# height the building still stands to at a point (local to its centre)
static func _cut(cp: Dictionary, px: float, pz: float) -> float:
	var t := clampf(((px * float(cp["dx"]) + pz * float(cp["dz"])) / float(cp["ext"]) + 1.0) * 0.5, 0.0, 1.0)
	var t0: float = cp["t0"]
	t = clampf((t - t0) / (1.0 - t0), 0.0, 1.0)
	return float(cp["ht"]) - float(cp["dd"]) * pow(t, float(cp["pw"]))


# box on face f (0 +X, 1 -X, 2 +Z, 3 -Z) of a block: u along the face, n0..n1 inward from it
static func _fb(c: Ctx, key: String, f: int, cx: float, cz: float, hx: float, hz: float, u: float, wu: float, n0: float, n1: float, y0: float, y1: float, shade: float) -> void:
	if y1 - y0 < 0.05:
		return
	var nc := (n0 + n1) * 0.5
	if f == 0:
		c.slab(key, cx + hx - nc, cz + u, n1 - n0, wu, y0, y1, shade, ALL)
	elif f == 1:
		c.slab(key, cx - hx + nc, cz + u, n1 - n0, wu, y0, y1, shade, ALL)
	elif f == 2:
		c.slab(key, cx + u, cz + hz - nc, wu, n1 - n0, y0, y1, shade, ALL)
	else:
		c.slab(key, cx + u, cz - hz + nc, wu, n1 - n0, y0, y1, shade, ALL)


# The same block after the cut: every pier, pilaster and bay stands only as high as the
# cut leaves it, the inside is open floor by floor.
static func _stage_ruin(c: Ctx, cx: float, cz: float, sw: float, sd: float, y0: float, y1: float, o: Dictionary, cp: Dictionary) -> void:
	var p := _spec(sw, sd, y0, y1, o)
	var r := c.rng
	var key: String = p["key"]
	var sc: float = p["sc"]
	var sh: float = float(p["sh"]) * 0.96
	var rp: float = p["rp"]
	var rg: float = p["rg"]
	var ytop: float = p["ytop"]
	var ys: float = p["ys"]
	var ye: float = p["ye"]
	var fh: float = p["fh"]
	var sp: float = p["sp"]
	var co: float = p["co"]
	var nf: int = p["nf"]
	var jit: float = cp["jit"]
	var hx := sw * 0.5
	var hz := sd * 0.5
	var inn := rp + rg
	if p["base"] > 0.0:
		c.slab(key, cx, cz, sw + 0.5 * sc, sd + 0.5 * sc, y0, ys, sh * 0.9, SHELL)
	# inside: columns of gutted floors, each as high as the cut allows
	var nx := clampi(int(roundf(sw / 10.0)), 2, 6)
	var nz := clampi(int(roundf(sd / 10.0)), 2, 6)
	var iw := (sw - 2.0 * inn) / nx
	var id := (sd - 2.0 * inn) / nz
	for i in nx:
		for j in nz:
			var px := cx - hx + inn + (i + 0.5) * iw
			var pz := cz - hz + inn + (j + 0.5) * id
			var top := _cut(cp, px, pz) + r.randf_range(-0.6, 0.6) * jit
			top = minf(y0 + floorf((top - y0) / fh) * fh, ytop)
			if top - y0 < 1.0:
				continue
			# gutted floors: a dark void, floor plates and posts
			c.slab("BGL", px, pz, iw - 1.4, id - 1.4, y0, top, 0.45, ALL)
			var lv := int(roundf((top - y0) / fh))
			for q in range(1, lv):
				c.slab(key, px, pz, iw + 0.2, id + 0.2, y0 + q * fh - 0.4, y0 + q * fh, sh * 0.86, SIDES)
			for ax: float in [-0.5, 0.5]:
				for az: float in [-0.5, 0.5]:
					c.slab(key, px + ax * (iw - 0.9), pz + az * (id - 0.9), 0.9, 0.9, y0, top, sh * 0.8, SIDES)
			if top >= ytop - 0.1:
				c.slab(key, px, pz, iw + 0.1, id + 0.1, ytop - 0.3, y1 - 0.05, sh * 1.0, ALL)
			else:
				c.slab(key, px + r.randf_range(-0.6, 0.6), pz + r.randf_range(-0.6, 0.6), iw + 0.9, id + 0.9, top, top + 0.45, sh * 0.82, ALL)
				if r.randf() < 0.45:
					var bx := px + (0.5 if r.randf() < 0.5 else -0.5) * (iw - 0.8)
					var bz := pz + (0.5 if r.randf() < 0.5 else -0.5) * (id - 0.8)
					c.slab(key, bx, bz, 0.7, 0.7, top, top + r.randf_range(1.5, 5.5), sh * 0.5, SHELL)
	# the four faces
	for f in 4:
		var lay: Dictionary = p["lz"] if f < 2 else p["lx"]
		var sgx := 0.0
		var sgz := 0.0
		if f < 2:
			sgx = hx if f == 0 else -hx
		else:
			sgz = hz if f == 2 else -hz
		var pw: float = lay["pw"]
		for u in lay["pil"]:
			var top := minf(_cut(cp, cx + sgx + (u if f >= 2 else 0.0), cz + sgz + (u if f < 2 else 0.0)) + r.randf_range(-0.3, 1.0) * jit, ytop)
			if top - y0 > 1.5:
				_fb(c, key, f, cx, cz, hx, hz, u, pw, 0.0, inn + 0.3, y0, top, sh * 1.03)
				if top >= ytop:
					_fb(c, key, f, cx, cz, hx, hz, u, pw + 0.5 * sc, -0.25 * sc, inn, ytop - 1.3 * sc, ytop, sh * 1.06)
		if p["mull"]:
			for u in lay["mul"]:
				var top := minf(_cut(cp, cx + sgx + (u if f >= 2 else 0.0), cz + sgz + (u if f < 2 else 0.0)) + r.randf_range(-1.0, 0.4) * jit, ye - sp)
				if top - ys > 1.0:
					_fb(c, key, f, cx, cz, hx, hz, u, float(lay["mw"]), rp - 0.15, inn + 0.2, ys, top, sh * 0.98)
		var lb: float = lay["lb"]
		var bw: float = lay["bw"]
		for b in int(lay["nb"]):
			var u := -lb * 0.5 + (b + 0.5) * bw
			var top := _cut(cp, cx + sgx + (u if f >= 2 else 0.0), cz + sgz + (u if f < 2 else 0.0)) + r.randf_range(-0.7, 0.7) * jit
			if p["span"]:
				for i in range(1, nf):
					var yt := ys + i * fh
					if yt > top:
						break
					if r.randf() < float(cp["hole"]):
						continue
					_fb(c, key, f, cx, cz, hx, hz, u, bw, rp, inn + 0.25, yt - sp, yt, sh * 0.92)
			if top >= ytop - 0.5:
				_fb(c, key, f, cx, cz, hx, hz, u, bw, rp, inn + 0.25, ye - sp, ytop, sh * 0.96)
				if co > 0.0:
					_fb(c, key, f, cx, cz, hx, hz, u, bw, -co, inn + 0.4, ytop, y1, sh * 1.07)
					_fb(c, key, f, cx, cz, hx, hz, u, bw, -co * 0.5, inn, ytop - 0.55 * sc, ytop, sh)
	# corner piers
	var e := 0.35 * sc
	var cwx: float = p["lx"]["cw"]
	var cwz: float = p["lz"]["cw"]
	for sx: float in [-1.0, 1.0]:
		for sz: float in [-1.0, 1.0]:
			var qx := cx + sx * (hx - cwx * 0.5 + e * 0.5)
			var qz := cz + sz * (hz - cwz * 0.5 + e * 0.5)
			var top := minf(_cut(cp, qx, qz) + r.randf_range(-0.2, 1.2) * jit, ytop)
			if top - y0 < 1.5:
				continue
			c.slab(key, qx, qz, cwx + e, cwz + e, y0, top, sh * 1.04, SHELL)
			if top >= ytop and co > 0.0:
				c.slab(key, qx + sx * co * 0.5, qz + sz * co * 0.5, cwx + e + co, cwz + e + co, ytop, y1, sh * 1.07, ALL)
	# coarse collision: a few columns following the cut
	var gn := 2 if minf(sw, sd) < 44.0 else 3
	for i in gn:
		for j in gn:
			var px := cx - hx + (i + 0.5) * sw / gn
			var pz := cz - hz + (j + 0.5) * sd / gn
			var top := minf(y0 + floorf((_cut(cp, px, pz) - y0) / fh) * fh, y1)
			if top - y0 > 1.5:
				c.solid(px, pz, sw / gn, sd / gn, y0, top)


# broken masonry heaped around a point on the ground
static func _rubble(c: Ctx, key: String, px: float, pz: float, rad: float, n: int, s: float, sh: float) -> void:
	var r := c.rng
	for i in n:
		var a := r.randf() * TAU
		var d := sqrt(r.randf()) * rad
		var sz := Vector3(r.randf_range(1.5, 6.0), r.randf_range(1.0, 3.2), r.randf_range(1.5, 6.5)) * s
		var up := maxf(0.0, 1.0 - d / rad) * rad * 0.22
		c.tilt(key, sz, Vector3(px + cos(a) * d, sz.y * 0.25 + up * r.randf(), pz + sin(a) * d), Vector3(r.randf_range(-0.5, 0.5), r.randf() * TAU, r.randf_range(-0.5, 0.5)), sh * r.randf_range(0.7, 1.0), {"tx": r.randf_range(0.6, 1.0), "tz": r.randf_range(0.6, 1.0)})


# parapet and corner blocks around a terrace or roof of tw x td at height y
static func _parapet(c: Ctx, key: String, cx: float, cz: float, tw: float, td: float, y: float, sc: float, sh: float) -> void:
	var t := 0.5 * sc
	var ph := 1.2
	c.slab(key, cx, cz + td * 0.5 - t * 0.5, tw, t, y, y + ph, sh, SHELL)
	c.slab(key, cx, cz - td * 0.5 + t * 0.5, tw, t, y, y + ph, sh, SHELL)
	c.slab(key, cx + tw * 0.5 - t * 0.5, cz, t, td - 2.0 * t, y, y + ph, sh, SHELL)
	c.slab(key, cx - tw * 0.5 + t * 0.5, cz, t, td - 2.0 * t, y, y + ph, sh, SHELL)
	var b := 1.5 * sc
	for sx: float in [-1.0, 1.0]:
		for sz: float in [-1.0, 1.0]:
			c.slab(key, cx + sx * (tw - b) * 0.5, cz + sz * (td - b) * 0.5, b, b, y, y + 2.2 * sc, sh * 1.05, SHELL)
			c.slab(key, cx + sx * (tw - b) * 0.5, cz + sz * (td - b) * 0.5, b * 0.55, b * 0.55, y + 2.2 * sc, y + 3.1 * sc, sh * 1.07, SHELL)


# small things that give a roof its scale: stair hut, plant, tank, masts
static func _roof_kit(c: Ctx, key: String, cx: float, cz: float, rw: float, rd: float, y: float, sh: float, n: int) -> void:
	var r := c.rng
	for i in n:
		var px := cx + r.randf_range(-0.36, 0.36) * rw
		var pz := cz + r.randf_range(-0.36, 0.36) * rd
		var kind := r.randi() % 4
		if kind == 0:
			# stair hut with a door
			var hw := r.randf_range(3.0, 5.0)
			c.slab(key, px, pz, hw, hw * 1.3, y, y + 3.2, sh * 0.96, SHELL)
			c.slab(key, px, pz, hw + 0.6, hw * 1.3 + 0.6, y + 3.2, y + 3.5, sh * 1.04, ALL)
			c.slab("BGL", px, pz + hw * 0.65 + 0.06, 1.1, 0.12, y, y + 2.2, 0.8, PZ | PX | NX | TOP)
		elif kind == 1:
			# plant on a plinth
			c.slab(key, px, pz, 3.6, 2.6, y, y + 0.4, sh * 0.9, SHELL)
			c.slab("BGL", px, pz, 3.0, 2.0, y + 0.4, y + 2.4, 2.4, SHELL)
		elif kind == 2:
			c.slab(key, px, pz, 0.35, 0.35, y, y + r.randf_range(6.0, 12.0), sh * 0.6, SHELL)
		else:
			c.slab(key, px, pz, r.randf_range(4.0, 8.0), r.randf_range(2.0, 3.0), y, y + 1.3, sh * 0.95, SHELL)


# stepped cap, optionally over an open loggia
static func _crown(c: Ctx, key: String, cx: float, cz: float, tw: float, td: float, y: float, hc: float, kind: int, sc: float, sh: float) -> void:
	var lw := tw
	var ld := td
	var yy := y
	if kind >= 2:
		# open loggia: slender columns in front of a deep void
		lw = maxf(tw * 0.8, 7.0)
		ld = maxf(td * 0.8, 7.0)
		var hl := hc * 0.46
		_stage(c, cx, cz, lw, ld, yy, yy + hl, {"key": key, "sc": sc * 0.9, "sh": sh * 1.02, "span": false, "mull": false, "bay": 4.4, "col": 99.0,
			"rp": 0.8 * sc, "rg": 1.7 * sc, "base": 0.7, "band": maxf(1.6, hl * 0.2), "corn": 0.6 * sc, "gsh": 0.5})
		c.solid(cx, cz, lw, ld, yy, yy + hl)
		yy += hl
		hc -= hl
	# stepped cap with a fin on every face
	var steps := 3 if hc > 9.0 else 2
	var fr := [0.42, 0.33, 0.25] if steps == 3 else [0.58, 0.42]
	for i in steps:
		var f: float = [0.74, 0.5, 0.28][i]
		var bw := maxf(lw * f, 3.0)
		var bd := maxf(ld * f, 3.0)
		var bh: float = hc * float(fr[i])
		c.slab(key, cx, cz, bw, bd, yy, yy + bh, sh * (1.0 + 0.02 * i), SHELL)
		c.slab(key, cx, cz, bw + 0.5 * sc, bd + 0.5 * sc, yy + bh - 0.5 * sc, yy + bh, sh * 1.06, ALL)
		var fw := maxf(bw * 0.16, 0.8)
		c.slab(key, cx, cz, bw + 0.7 * sc, fw, yy, yy + bh - 0.5 * sc, sh * 1.04, SIDES)
		c.slab(key, cx, cz, fw, bd + 0.7 * sc, yy, yy + bh - 0.5 * sc, sh * 1.04, SIDES)
		if bw > 8.0:
			for s: float in [-1.0, 1.0]:
				c.slab("BGL", cx + s * bw * 0.27, cz, bw * 0.14, bd + 0.16, yy + bh * 0.2, yy + bh * 0.72, 1.0, PZ | NZ)
				c.slab("BGL", cx, cz + s * bd * 0.27, bw + 0.16, bd * 0.14, yy + bh * 0.2, yy + bh * 0.72, 1.0, PX | NX)
		c.solid(cx, cz, bw, bd, yy, yy + bh)
		yy += bh
	# finial
	var mh := clampf(hc * 0.9, 4.0, 26.0)
	c.slab(key, cx, cz, 0.9 * sc, 0.9 * sc, yy, yy + mh * 0.5, sh * 0.9, SHELL)
	c.slab(key, cx, cz, 0.4 * sc, 0.4 * sc, yy + mh * 0.5, yy + mh, sh * 0.7, SHELL)


# entrance on face f (0 +X, 1 -X, 2 +Z, 3 -Z) of the ground block: pylons, canopy, steps
static func _portal(c: Ctx, key: String, f: int, cx: float, cz: float, sw: float, sd: float, sc: float, sh: float, hmax: float) -> void:
	var hx := sw * 0.5
	var hz := sd * 0.5
	var pw := 6.5 * sc
	var ph := minf(7.5 * sc, hmax)
	var dep := 2.6 * sc
	for s: float in [-1.0, 1.0]:
		_fb(c, key, f, cx, cz, hx, hz, s * pw * 0.5, 1.5 * sc, -dep, 0.0, 0.0, ph, sh * 1.05)
		_fb(c, key, f, cx, cz, hx, hz, s * pw * 0.5, 1.5 * sc + 0.5, -dep - 0.25, 0.0, ph, ph + 0.6 * sc, sh * 1.08)
	var cw := pw - 1.5 * sc
	_fb(c, key, f, cx, cz, hx, hz, 0.0, cw, -dep * 1.15, 0.0, ph * 0.62, ph * 0.62 + 0.5 * sc, sh * 1.02)
	_fb(c, key, f, cx, cz, hx, hz, 0.0, cw + 2.0, -dep * 0.9, 0.0, -1.0, 0.8, sh * 0.92)
	_fb(c, key, f, cx, cz, hx, hz, 0.0, cw + 3.0, -dep * 1.4, 0.0, -1.0, 0.4, sh * 0.9)
	_fb(c, "BGL", f, cx, cz, hx, hz, 0.0, cw * 0.7, -0.14, 0.0, 0.8, ph * 0.6, 0.6)


# One building on a plot of w x d, h high (the highest roof; masts and finials rise above
# it), standing on ground level y. ruined 0..1 breaks it open toward one corner: 0.2 a
# nibbled corner, 0.5 a deep bite, 0.9 little more than a stump.
# style -1 picks one from rng (and hands plots of 50 m and more that rise 150 m or higher
# to megablock()):
#   0 dressed-stone block: podium colonnade, pilasters, recessed window bays, stepped crown
#   1 core and slab: round concrete cores, floor boxes bridging between them, voids below
#   2 capsule tower: a shaft carrying stacks of plug-in modules with portholes
#   3 megaslab: slab volumes behind deep perforated screens, each cantilevered past the last
static func tower(k, g: Node3D, add_box: Callable, x: float, z: float, w: float, d: float, h: float, y: float, rng: RandomNumberGenerator, ruined: float = 0.0, style: int = -1) -> void:
	w = maxf(w, 10.0)
	d = maxf(d, 10.0)
	h = maxf(h, 8.0)
	ruined = clampf(ruined, 0.0, 1.0)
	if style < 0:
		if h >= 150.0 and minf(w, d) >= 50.0:
			megablock(k, g, add_box, x, z, w, d, h, y, rng, ruined)
			return
		var roll := rng.randf()
		style = 0 if roll < 0.2 else (1 if roll < 0.5 else (2 if roll < 0.7 else 3))
	# styles 1..3 are built with their long side along local X
	var q := 0
	if style > 0:
		q = (1 if d > w else 0) + 2 * (rng.randi() % 2)
	var c := Ctx.new(k, g, add_box, rng, Vector3(x, y, z), q, direct)
	if style == 1:
		_t_cores(c, maxf(w, d), minf(w, d), h, ruined)
	elif style == 2:
		_t_capsule(c, maxf(w, d), minf(w, d), h, ruined)
	elif style == 3:
		_t_slab(c, maxf(w, d), minf(w, d), h, ruined)
	else:
		_t_block(c, w, d, h, ruined)
	_mark(g, x, y, z, w, d, c.top)
	_done(c)


# the footprint, for anything that wants to find this building again on its bone
static func _mark(g: Node3D, x: float, y: float, z: float, w: float, d: float, top: float) -> void:
	var seen: Array = g.get_meta("bld", [])
	seen.append(AABB(Vector3(x - w * 0.5, y, z - d * 0.5), Vector3(w, maxf(top - y, 1.0), d)))
	g.set_meta("bld", seen)


# style 0: a tower block in dressed stone: a podium with a colonnade of deep-set openings, a
# shaft in set-back tiers with pilasters, corner piers and recessed window bays, a stepped
# crown over an open loggia
static func _t_block(c: Ctx, w: float, d: float, h: float, ruined: float) -> void:
	var rng := c.rng
	var m := minf(w, d)
	var sc := clampf(sqrt(m / 30.0), 0.85, 2.0)
	var big := h > 110.0 or m > 64.0
	var key: String = ["BS1", "BS1", "BS1", "BS2", "BS3"][rng.randi() % 5]
	var sh := rng.randf_range(0.94, 1.05)
	var has_pod := h >= 30.0 and m >= 24.0
	var hp := 0.0
	if has_pod:
		hp = clampf(roundf(h * 0.16 / FH), 2.0, 7.0) * FH
	var kind := 0
	var hc := 0.0
	if h >= 44.0 and m >= 18.0:
		kind = 2
		hc = clampf(h * 0.2, 10.0, 46.0)
	elif h >= 24.0:
		kind = 1
		hc = clampf(h * 0.14, 4.0, 10.0)
	var hs := h - hp - hc
	var nt := 1 if hs < 28.0 else (2 if hs < 64.0 else (3 if hs < 120.0 else 4))
	# footprint of the shaft: on a podium it stands to one side, leaving a wing
	var sw := w
	var sd := d
	var scx := 0.0
	var scz := 0.0
	var wing := rng.randi() % 4
	if has_pod:
		var e := (1.6 if not big else 5.0) * sc
		var f := rng.randf_range(0.6, 0.72)
		if w > d * 1.25:
			wing = wing % 2
		elif d > w * 1.25:
			wing = 2 + wing % 2
		if wing < 2:
			sw = w * f
			sd = d - 2.0 * e
			scx = (-1.0 if wing == 0 else 1.0) * ((w - sw) * 0.5 - e)
		else:
			sd = d * f
			sw = w - 2.0 * e
			scz = (-1.0 if wing == 2 else 1.0) * ((d - sd) * 0.5 - e)
	# the blocks, bottom up: [cx, cz, sw, sd, y0, y1, options]
	var stages: Array = []
	if has_pod:
		stages.append([0.0, 0.0, w, d, 0.0, hp, {"key": key, "sc": sc, "sh": sh * 0.98, "span": hp > 13.0, "fh": 8.0, "spf": 0.16, "mull": false, "bay": 6.0 * sqrt(sc), "col": 99.0,
			"rp": 1.1 * sc, "rg": 1.8 * sc, "base": 1.4, "band": maxf(2.4, hp * 0.2), "corn": 0.8 * sc, "gsh": 0.55}])
	var fr: Array = [[1.0], [0.62, 0.38], [0.5, 0.3, 0.2], [0.4, 0.27, 0.19, 0.14]][nt - 1]
	var sb := clampf(minf(sw, sd) * 0.065, 1.4 * sc, 7.0)
	var yy := hp
	for i in nt:
		var th: float = hs * float(fr[i])
		if i < nt - 1:
			th = maxf(roundf(th / FH), 2.0) * FH
		else:
			th = h - hc - yy
		stages.append([scx, scz, sw - 2.0 * sb * i, sd - 2.0 * sb * i, yy, yy + th, {"key": key, "sc": sc, "sh": sh, "base": (0.6 * FH if yy == 0.0 else 0.9), "major": (3 if big else 0)}])
		yy += th
	var tw: float = sw - 2.0 * sb * (nt - 1)
	var td: float = sd - 2.0 * sb * (nt - 1)
	# the cut
	var cp := {}
	if ruined > 0.02:
		var a := rng.randf() * TAU
		var ht := (h - hc) - hs * 0.55 * smoothstep(0.3, 1.0, ruined) + 2.0
		cp = {"dx": cos(a), "dz": sin(a), "ext": (absf(cos(a)) * w + absf(sin(a)) * d) * 0.5, "ht": ht,
			"dd": ht * clampf(0.12 + ruined * 1.05, 0.0, 0.96) * rng.randf_range(0.75, 1.0), "pw": lerpf(2.4, 1.3, ruined), "jit": FH * (0.6 + ruined), "hole": 0.06 + ruined * 0.2,
			"t0": lerpf(0.7, 0.0, smoothstep(0.08, 0.5, ruined))}
	# foundation, so a slope never shows a gap
	c.slab(key, 0.0, 0.0, w + 0.5 * sc, d + 0.5 * sc, -6.0, 0.0, sh * 0.85, SIDES)
	var whole := true
	var n := 0
	for st in stages:
		var cx: float = st[0]
		var cz: float = st[1]
		var bw: float = st[2]
		var bd: float = st[3]
		var y0: float = st[4]
		var y1: float = st[5]
		var first := n == 0
		n += 1
		var lo := 1e9
		var hi := 1e9
		if not cp.is_empty():
			hi = -1e9
			for sx: float in [-0.5, 0.5]:
				for sz: float in [-0.5, 0.5]:
					var v := _cut(cp, cx + sx * bw, cz + sz * bd)
					lo = minf(lo, v)
					hi = maxf(hi, v)
		if hi < y0 + 2.0:
			whole = false
			n -= 1
			break
		if lo < y1 - 1.0:
			whole = false
			_stage_ruin(c, cx, cz, bw, bd, y0, y1, st[6], cp)
			if first:
				c.solid(cx, cz, bw, bd, -5.0, y0 + 0.4, true)
			continue
		_stage(c, cx, cz, bw, bd, y0, y1, st[6])
		c.solid(cx, cz, bw, bd, y0 - (5.0 if first else 0.0), y1, first)
		_parapet(c, key, cx, cz, bw + 1.0 * sc, bd + 1.0 * sc, y1, sc, sh)
		if sc > 1.25 and n < stages.size() and not (first and has_pod):
			# corner pavilions where the next tier steps back
			var pv := sb * 1.5
			var pt := 2.0 * FH
			for sx: float in [-1.0, 1.0]:
				for sz: float in [-1.0, 1.0]:
					var qx := cx + sx * (bw - pv) * 0.5
					var qz := cz + sz * (bd - pv) * 0.5
					c.slab(key, qx, qz, pv, pv, y1, y1 + pt, sh * 1.02, SHELL)
					c.slab(key, qx, qz, pv + 0.8, pv + 0.8, y1 + pt - 0.7, y1 + pt, sh * 1.07, ALL)
					c.slab(key, qx, qz, pv * 0.6, pv * 0.6, y1 + pt, y1 + pt + 2.4, sh * 1.04, SHELL)
					c.slab("BGL", qx + sx * (pv * 0.5 + 0.06), qz, 0.12, pv * 0.3, y1 + 1.6, y1 + pt - 1.8, 1.0, SIDES)
					c.slab("BGL", qx, qz + sz * (pv * 0.5 + 0.06), pv * 0.3, 0.12, y1 + 1.6, y1 + pt - 1.8, 1.0, SIDES)
					c.solid(qx, qz, pv, pv, y1, y1 + pt)
		if first:
			_portal(c, key, (wing ^ 1) if has_pod else rng.randi() % 4, cx, cz, bw, bd, sc, sh, (y1 - y0) * 0.7)
		if first and has_pod:
			# things on the wing terrace
			if wing < 2:
				_roof_kit(c, key, (1.0 if wing == 0 else -1.0) * sw * 0.5, 0.0, (w - sw) * 0.8, d * 0.8, hp, sh, 2 + int(m / 16.0))
			else:
				_roof_kit(c, key, 0.0, (1.0 if wing == 2 else -1.0) * sd * 0.5, w * 0.8, (d - sd) * 0.8, hp, sh, 2 + int(m / 16.0))
	var crown := whole
	if not whole and ruined < 0.3 and n == stages.size():
		crown = true
		for sx: float in [-0.42, 0.42]:
			for sz: float in [-0.42, 0.42]:
				if _cut(cp, scx + sx * tw, scz + sz * td) < yy - 0.5:
					crown = false
	if crown:
		if kind == 0:
			_roof_kit(c, key, scx, scz, tw * 0.8, td * 0.8, yy, sh, 2 + int(m / 12.0))
		else:
			_crown(c, key, scx, scz, tw, td, yy, hc, kind, sc, sh)
	if not cp.is_empty():
		# what came down lies under the broken corner and around the walls
		var qx := signf(float(cp["dx"])) * w * 0.5
		var qz := signf(float(cp["dz"])) * d * 0.5
		_rubble(c, key, qx * 1.05, qz * 1.05, m * (0.3 + 0.3 * ruined), 5 + int(14.0 * ruined), sc, sh)
		_rubble(c, key, 0.0, 0.0, maxf(w, d) * 0.75, 3 + int(5.0 * ruined), sc * 0.8, sh)


# ------------------------------------------------------------------ megastructure language
# Shared parts of the core-and-slab, capsule and megaslab styles and of the megablocks:
# round service cores, floor boxes bridging between them, deep perforated screens,
# plug-in modules, lattice masts, geodesic spheres.

# unit geodesic sphere: 80 flat faces, three vertices each, clockwise seen from outside
static var _ico := PackedVector3Array()


static func _ico_table() -> PackedVector3Array:
	if not _ico.is_empty():
		return _ico
	var t := (1.0 + sqrt(5.0)) * 0.5
	var p: Array[Vector3] = []
	for v in [[-1.0, t, 0.0], [1.0, t, 0.0], [-1.0, -t, 0.0], [1.0, -t, 0.0], [0.0, -1.0, t], [0.0, 1.0, t], [0.0, -1.0, -t], [0.0, 1.0, -t], [t, 0.0, -1.0], [t, 0.0, 1.0], [-t, 0.0, -1.0], [-t, 0.0, 1.0]]:
		p.append(Vector3(v[0], v[1], v[2]).normalized())
	var out := PackedVector3Array()
	for f in [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]:
		var a: Vector3 = p[f[0]]
		var b: Vector3 = p[f[1]]
		var d: Vector3 = p[f[2]]
		var ab := (a + b).normalized()
		var bd := (b + d).normalized()
		var da := (d + a).normalized()
		for tr in [[a, ab, da], [b, bd, ab], [d, da, bd], [ab, bd, da]]:
			var p0: Vector3 = tr[0]
			var p1: Vector3 = tr[1]
			var p2: Vector3 = tr[2]
			if (p1 - p0).cross(p2 - p0).dot(p0 + p1 + p2) > 0.0:
				var sw := p1
				p1 = p2
				p2 = sw
			out.append(p0)
			out.append(p1)
			out.append(p2)
	_ico = out
	return out


# faceted sphere of radius r
static func _geo(c: Ctx, key: String, cx: float, cy: float, cz: float, r: float, shade: float = 1.0) -> void:
	c.boxes += 1
	var o3 := c.pt(Vector3(cx, cy, cz))
	if not c.fast:
		c.k.ball(c.g, key, Vector3(r, r, r), o3, Vector3.ZERO, shade)
		c.tris += 120
		return
	var tab := _ico_table()
	var s = c.surfs.get(key)
	if s == null:
		s = c.k._surf(c.g, key)
		c.surfs[key] = s
	var v: PackedVector3Array = s.v
	var n: PackedVector3Array = s.n
	var cl: PackedColorArray = s.c
	var col := Color(shade, 0.0, 0.0)
	for i in range(0, tab.size(), 3):
		var p0 := tab[i]
		var p1 := tab[i + 1]
		var p2 := tab[i + 2]
		var nn := (p0 + p1 + p2).normalized()
		v.append(o3 + p0 * r)
		v.append(o3 + p1 * r)
		v.append(o3 + p2 * r)
		n.append(nn)
		n.append(nn)
		n.append(nn)
		cl.append(col)
		cl.append(col)
		cl.append(col)
	c.tris += 80


# (u, v) -> (x, z) for parts that can run along either axis: ax 0 = u along X, 1 = u along Z
static func _sw(c: Ctx, ax: int, key: String, u: float, v: float, su: float, sv: float, y0: float, y1: float, shade: float = 1.0, mask: int = 31) -> void:
	if ax == 0:
		c.slab(key, u, v, su, sv, y0, y1, shade, mask)
	else:
		c.slab(key, v, u, sv, su, y0, y1, shade, (mask & 48) | ((mask & 3) << 2) | ((mask & 12) >> 2))


# the cut plane a ruined building is broken along (see _cut)
static func _mkcut(rng: RandomNumberGenerator, w: float, d: float, top: float, ruined: float) -> Dictionary:
	if ruined <= 0.02:
		return {}
	var a := rng.randf() * TAU
	var ht := top * (1.0 - 0.5 * smoothstep(0.3, 1.0, ruined)) + 2.0
	return {"dx": cos(a), "dz": sin(a), "ext": (absf(cos(a)) * w + absf(sin(a)) * d) * 0.5, "ht": ht,
		"dd": ht * clampf(0.12 + ruined * 1.05, 0.0, 0.96) * rng.randf_range(0.75, 1.0), "pw": lerpf(2.4, 1.3, ruined), "jit": FH * (0.6 + ruined), "hole": 0.06 + ruined * 0.2,
		"t0": lerpf(0.7, 0.0, smoothstep(0.08, 0.5, ruined))}


# how far a floor box reaches past its cores: often barely, sometimes to the edge of the plot
static func _ext(r: RandomNumberGenerator) -> float:
	return 0.0 if r.randf() < 0.42 else r.randf_range(0.35, 1.0)


# A floor box: storey after storey of projecting trays (floor edge and parapet in one) over
# a recessed band of glass with fins, or over a wall with small deep windows; girders below.
static func _deck(c: Ctx, key: String, x0: float, x1: float, z0: float, z1: float, y0: float, y1: float, sc: float, sh: float, punched: bool = false, open_top: bool = false) -> void:
	var cx := (x0 + x1) * 0.5
	var cz := (z0 + z1) * 0.5
	var lx := x1 - x0
	var lz := z1 - z0
	var pj := minf(1.1 * sc, minf(lx, lz) * 0.16)
	var n := maxi(1, int(roundf((y1 - y0) / FH)))
	var fh := (y1 - y0) / n
	var th := fh * 0.4
	var ytop := y1 - (0.0 if open_top else 0.55)
	if punched:
		c.slab(key, cx, cz, lx - 2.0 * pj, lz - 2.0 * pj, y0 + th, ytop, sh * 0.93, SIDES)
	else:
		c.slab("BGL", cx, cz, lx - 2.0 * pj, lz - 2.0 * pj, y0 + th, ytop, 1.0, SIDES)
	for i in n:
		c.slab(key, cx, cz, lx, lz, y0 + i * fh, y0 + i * fh + th, sh * (1.0 + 0.035 * (i % 2)), ALL)
	if not open_top:
		c.slab(key, cx, cz, lx, lz, y1 - 0.55, y1, sh * 1.05, ALL)
	var nfx := maxi(1, int(roundf(lx / (5.0 * sc))))
	var nfz := maxi(1, int(roundf(lz / (5.0 * sc))))
	var bx := lx / nfx
	var bz := lz / nfz
	if punched:
		for i in n:
			var wy := y0 + i * fh + th + (fh - th) * 0.22
			for j in nfx:
				c.slab("BGL", x0 + (j + 0.5) * bx, cz, bx * 0.4, lz - 2.0 * pj + 0.24, wy, wy + (fh - th) * 0.56, 1.0, PZ | NZ)
			for j in nfz:
				c.slab("BGL", cx, z0 + (j + 0.5) * bz, lx - 2.0 * pj + 0.24, bz * 0.4, wy, wy + (fh - th) * 0.56, 1.0, PX | NX)
	else:
		for j in range(1, nfx):
			c.slab(key, x0 + j * bx, cz, 0.45 * sc, lz - 2.0 * pj + 0.7, y0 + th, ytop, sh * 0.96, SIDES)
		for j in range(1, nfz):
			c.slab(key, cx, z0 + j * bz, lx - 2.0 * pj + 0.7, 0.45 * sc, y0 + th, ytop, sh * 0.96, SIDES)
	var gd := 1.3 * sc
	if lx >= lz:
		for s: float in [-1.0, 1.0]:
			c.slab(key, cx, cz + s * (lz * 0.5 - pj - 0.7 * sc), lx - 2.0 * pj, 1.1 * sc, y0 - gd, y0, sh * 0.9, SIDES | BOT)
	else:
		for s: float in [-1.0, 1.0]:
			c.slab(key, cx + s * (lx * 0.5 - pj - 0.7 * sc), cz, 1.1 * sc, lz - 2.0 * pj, y0 - gd, y0, sh * 0.9, SIDES | BOT)


# A slab volume behind a deep perforated screen: floor plates and fins make the grid, solid
# panels close part of it in a pattern that shifts from storey to storey; blank end walls.
static func _screen(c: Ctx, key: String, ax: int, u0: float, u1: float, v0: float, v1: float, y0: float, y1: float, sc: float, sh: float, e0: bool = true, e1: bool = true, open_top: bool = false) -> void:
	var r := c.rng
	var cu := (u0 + u1) * 0.5
	var cv := (v0 + v1) * 0.5
	var lu := u1 - u0
	var lv := v1 - v0
	var dp := minf(1.7 * sc, lv * 0.2)
	var n := maxi(1, int(roundf((y1 - y0) / FH)))
	var fh := (y1 - y0) / n
	var nb := maxi(2, int(roundf(lu / (3.6 * sc))))
	var bay := lu / nb
	_sw(c, ax, "BGL", cu, cv, lu - 0.5, lv - 2.0 * dp, y0 + 0.3, y1 - (0.0 if open_top else 0.3), 1.0, SIDES)
	for i in n + 1:
		var yy := y0 + i * fh
		if i == n:
			if not open_top:
				_sw(c, ax, key, cu, cv, lu + 0.5 * sc, lv + 0.5 * sc, y1 - 0.6, y1, sh * 1.05, ALL)
		else:
			_sw(c, ax, key, cu, cv, lu, lv, yy, yy + 0.4, sh * 1.02, ALL)
			_sw(c, ax, key, cu, cv, lu - 0.3, lv - 0.5, yy + 0.4, yy + 1.4, sh * 0.92, PZ | NZ)
	for j in nb + 1:
		_sw(c, ax, key, u0 + j * bay, cv, 0.42 * sc, lv, y0, y1 - (0.0 if open_top else 0.6), sh, SIDES)
	for i in n:
		var j := r.randi() % 3
		while j < nb:
			var run := mini(1 + r.randi() % 2, nb - j)
			_sw(c, ax, key, u0 + (j + run * 0.5) * bay, cv, run * bay, lv - 0.9 * sc, y0 + i * fh + 0.4, y0 + (i + 1) * fh, sh * r.randf_range(0.86, 0.96), PZ | NZ)
			j += run + 1 + r.randi() % 3
	var et := 1.3 * sc
	if e0:
		_sw(c, ax, key, u0 + et * 0.5 - 0.3, cv, et, lv + 0.5, y0, y1, sh * 1.03, SHELL | BOT)
		_sw(c, ax, "BGL", u0 - 0.36, cv, 0.12, lv * 0.14, y0 + 1.6, y1 - 1.6, 1.0, NX)
	if e1:
		_sw(c, ax, key, u1 - et * 0.5 + 0.3, cv, et, lv + 0.5, y0, y1, sh * 1.03, SHELL | BOT)
		_sw(c, ax, "BGL", u1 + 0.36, cv, 0.12, lv * 0.14, y0 + 1.6, y1 - 1.6, 1.0, PX)
	for s: float in [-1.0, 1.0]:
		_sw(c, ax, key, cu, cv + s * (lv * 0.5 - dp - 0.5 * sc), lu - 1.0, 1.0 * sc, y0 - 1.2 * sc, y0, sh * 0.9, SIDES | BOT)


# what is left on top of a volume the cut went through: a bare floor, posts, a loose slab
static func _stubs(c: Ctx, key: String, px: float, pz: float, sx: float, sz: float, y: float, sh: float) -> void:
	var r := c.rng
	c.slab(key, px, pz, sx * 0.9, sz * 0.9, y - 0.1, y + 0.35, sh * 0.8, ALL)
	for i in 3 + r.randi() % 3:
		c.slab(key, px + r.randf_range(-0.42, 0.42) * sx, pz + r.randf_range(-0.42, 0.42) * sz, 0.8, 0.8, y, y + r.randf_range(1.5, 5.0), sh * 0.6, SHELL)
	c.tilt(key, Vector3(minf(sx, 9.0) * r.randf_range(0.5, 0.9), 0.5, minf(sz, 9.0) * r.randf_range(0.5, 0.9)), Vector3(px + r.randf_range(-0.2, 0.2) * sx, y + 1.2, pz + r.randf_range(-0.2, 0.2) * sz), Vector3(r.randf_range(-0.5, 0.5), r.randf() * TAU, r.randf_range(-0.5, 0.5)), sh * 0.85)


# One bridging volume with its collider: kind 0 trays over glass, 1 trays over a punched
# wall, 2 perforated screen. With a cut plane it is built in pieces along its length, each
# only as high as the cut leaves it.
static func _vol(c: Ctx, kind: int, key: String, ax: int, u0: float, u1: float, v0: float, v1: float, y0: float, y1: float, sc: float, sh: float, cp: Dictionary) -> void:
	var ns := 1
	if not cp.is_empty():
		ns = clampi(int(roundf((u1 - u0) / maxf(9.0 * sc, 8.0))), 1, 6)
	for i in ns:
		var a := u0 + (u1 - u0) * i / ns
		var b := u0 + (u1 - u0) * (i + 1) / ns
		var px := (a + b) * 0.5 if ax == 0 else (v0 + v1) * 0.5
		var pz := (v0 + v1) * 0.5 if ax == 0 else (a + b) * 0.5
		var top := y1
		if not cp.is_empty():
			top = minf(y1, _cut(cp, px, pz) + c.rng.randf_range(-0.5, 0.5) * float(cp["jit"]))
		var open := top < y1 - 0.5
		if open:
			top = y0 + floorf((top - y0) / FH) * FH
			if top - y0 < FH * 0.9:
				continue
		if kind == 2:
			_screen(c, key, ax, a, b, v0, v1, y0, top, sc, sh, i == 0, i == ns - 1, open)
		elif ax == 0:
			_deck(c, key, a, b, v0, v1, y0, top, sc, sh, kind == 1, open)
		else:
			_deck(c, key, v0, v1, a, b, y0, top, sc, sh, kind == 1, open)
		var sx := (b - a) if ax == 0 else (v1 - v0)
		var sz := (v1 - v0) if ax == 0 else (b - a)
		c.solid(px, pz, sx, sz, y0, top)
		if open:
			_stubs(c, key, px, pz, sx, sz, top, sh)


# round service core from below the ground to y1: ring joints, a glazed stair slot between
# two jambs on face `slot` (0 +X, 1 -X, 2 +Z, 3 -Z), a collar at the top
static func _core(c: Ctx, key: String, px: float, pz: float, rc: float, y1: float, sc: float, sh: float, slot: int, broken: bool = false) -> void:
	var seg := 12 if rc < 4.0 else (16 if rc < 10.0 else 20)
	c.tube(key, px, y1 * 0.5 - 3.0, pz, rc, rc, y1 + 6.0, seg, sh, 1, 3)
	var step := FH * (3.0 if rc < 6.0 else 4.0)
	var yy := step
	while yy < y1 - 2.0:
		c.tube(key, px, yy, pz, rc + 0.12 * sc, rc + 0.12 * sc, 0.5, seg, sh * 0.9, 1, 7)
		yy += step
	var sw := rc * 0.3
	var fx := 1.0 if slot == 0 else (-1.0 if slot == 1 else 0.0)
	var fz := 1.0 if slot == 2 else (-1.0 if slot == 3 else 0.0)
	if y1 > 9.0:
		c.slab("BGL", px + fx * (rc - 0.1), pz + fz * (rc - 0.1), absf(fx) * 0.6 + absf(fz) * sw, absf(fz) * 0.6 + absf(fx) * sw, 3.0, y1 - 2.5, 1.0, SIDES)
		for s: float in [-1.0, 1.0]:
			c.slab(key, px + fx * (rc - 0.05) + absf(fz) * s * sw * 0.62, pz + fz * (rc - 0.05) + absf(fx) * s * sw * 0.62, absf(fx) * 0.9 + absf(fz) * 0.45 * sc, absf(fz) * 0.9 + absf(fx) * 0.45 * sc, 0.0, y1 - 1.0, sh * 1.03, SIDES)
	if broken:
		for i in 5:
			var a := c.rng.randf() * TAU
			c.slab(key, px + cos(a) * rc * 0.7, pz + sin(a) * rc * 0.7, 0.9, 0.9, y1 - 0.5, y1 + c.rng.randf_range(1.0, 5.0), sh * 0.6, SHELL)
	else:
		c.tube(key, px, y1 - 0.7 * sc, pz, rc + 0.35 * sc, rc + 0.35 * sc, 1.4 * sc, seg, sh * 1.05, 1, 7)


# colliders that stay inside a round core: one square, or a square and two bars for big ones
static func _core_solid(c: Ctx, px: float, pz: float, rc: float, y0: float, y1: float, list: bool = false) -> void:
	if rc < 6.0:
		c.solid(px, pz, rc * 1.5, rc * 1.5, y0, y1, list)
	else:
		c.solid(px, pz, rc * 1.4, rc * 1.4, y0, y1, list)
		c.solid(px, pz, rc * 1.9, rc * 0.7, y0, y1)
		c.solid(px, pz, rc * 0.7, rc * 1.9, y0, y1)


# slender mast with cross arms and a dish
static func _mast(c: Ctx, px: float, pz: float, y: float, hgt: float, sc: float, key: String = "BGL", dish: String = "BGL") -> void:
	var ms := 4.0 if key == "BGL" else 0.9
	c.slab(key, px, pz, 0.8 * sc, 0.8 * sc, y, y + hgt * 0.5, ms, SHELL)
	c.slab(key, px, pz, 0.45 * sc, 0.45 * sc, y + hgt * 0.5, y + hgt * 0.85, ms, SHELL)
	c.slab(key, px, pz, 0.2 * sc, 0.2 * sc, y + hgt * 0.85, y + hgt, ms, SHELL)
	for i in 3:
		var yy := y + hgt * (0.3 + 0.17 * i)
		c.slab(key, px, pz, (3.4 - i * 0.8) * sc, 0.2 * sc, yy, yy + 0.2 * sc, ms, ALL)
		c.slab(key, px, pz, 0.2 * sc, (3.4 - i * 0.8) * sc, yy + 0.5 * sc, yy + 0.7 * sc, ms, ALL)
	c.tube(dish, px + 1.0 * sc, y + hgt * 0.42, pz, 1.5 * sc, 1.5 * sc, 0.35 * sc, 10, 1.1, 0, 7)


# four-legged lattice tower tapering from half-width a0 to a1
static func _lattice(c: Ctx, px: float, pz: float, y0: float, hgt: float, a0: float, a1: float, key: String = "BST") -> void:
	var lv := maxi(3, int(roundf(hgt / maxf(a0 * 2.2, 5.0))))
	var th := clampf(a0 * 0.12, 0.35, 1.4)
	for sx: float in [-1.0, 1.0]:
		for sz: float in [-1.0, 1.0]:
			c.beam(key, Vector3(px + sx * a0, y0, pz + sz * a0), Vector3(px + sx * a1, y0 + hgt, pz + sz * a1), th, th, 0.9)
	for i in lv:
		var h0 := lerpf(a0, a1, float(i) / lv)
		var h1 := lerpf(a0, a1, float(i + 1) / lv)
		var ya := y0 + hgt * float(i) / lv
		var yb := y0 + hgt * float(i + 1) / lv
		c.slab(key, px, pz + h1, 2.0 * h1, th * 0.7, yb - th * 0.7, yb, 0.85, ALL)
		c.slab(key, px, pz - h1, 2.0 * h1, th * 0.7, yb - th * 0.7, yb, 0.85, ALL)
		c.slab(key, px + h1, pz, th * 0.7, 2.0 * h1, yb - th * 0.7, yb, 0.85, ALL)
		c.slab(key, px - h1, pz, th * 0.7, 2.0 * h1, yb - th * 0.7, yb, 0.85, ALL)
		var s := 1.0 if i % 2 == 0 else -1.0
		c.beam(key, Vector3(px - s * h0, ya, pz + h0), Vector3(px + s * h1, yb, pz + h1), th * 0.6, th * 0.6, 0.8)
		c.beam(key, Vector3(px + s * h0, ya, pz - h0), Vector3(px - s * h1, yb, pz - h1), th * 0.6, th * 0.6, 0.8)
		c.beam(key, Vector3(px + h0, ya, pz - s * h0), Vector3(px + h1, yb, pz + s * h1), th * 0.6, th * 0.6, 0.8)
		c.beam(key, Vector3(px - h0, ya, pz + s * h0), Vector3(px - h1, yb, pz - s * h1), th * 0.6, th * 0.6, 0.8)


# Plug-in modules stacked on the four faces of a shaft of half-width hs (square) between
# y0 and y1, each with a porthole; the cut drops the ones above it. One collider per face.
static func _pods(c: Ctx, key: String, rim: String, cx: float, cz: float, hs: float, emb: float, y0: float, y1: float, mh: float, reach: float, sh: float, cp: Dictionary) -> void:
	var r := c.rng
	var nl := int((y1 - y0) / mh)
	var mw := hs
	for f in 4:
		var fx := 1.0 if f == 0 else (-1.0 if f == 1 else 0.0)
		var fz := 1.0 if f == 2 else (-1.0 if f == 3 else 0.0)
		var st_top := y0
		var st_d := 0.0
		for l in nl:
			var ylo := y0 + l * mh
			var wide := (l + f) % 3 == 2
			for j in (1 if wide else 2):
				if r.randf() < 0.07:
					continue
				var u := (0.0 if wide else (j - 0.5) * mw) + r.randf_range(-0.07, 0.07) * mw
				var wu := hs * 2.0 * r.randf_range(0.8, 0.94) if wide else mw * r.randf_range(0.84, 0.96)
				var dpt := reach * r.randf_range(0.6, 1.0)
				var mx := cx + fx * (hs + dpt * 0.5) + absf(fz) * u
				var mz := cz + fz * (hs + dpt * 0.5) + absf(fx) * u
				if not cp.is_empty() and _cut(cp, mx, mz) < ylo + mh:
					continue
				_fb(c, key, f, cx, cz, hs, hs, u, wu, -dpt, emb, ylo + 0.12, ylo + mh - 0.12, sh * r.randf_range(0.94, 1.04))
				var pr := minf(wu, mh) * 0.3
				var qx := cx + fx * (hs + dpt + 0.05) + absf(fz) * u
				var qz := cz + fz * (hs + dpt + 0.05) + absf(fx) * u
				c.disc(rim, qx, ylo + mh * 0.5, qz, f, pr, sh * 0.78)
				c.disc("BGL", qx + fx * 0.06, ylo + mh * 0.5, qz + fz * 0.06, f, pr * 0.76, 1.0)
				st_top = maxf(st_top, ylo + mh)
				st_d = maxf(st_d, dpt)
		if st_top > y0 + 1.0:
			var dd := st_d * 0.9
			c.solid(cx + fx * (hs + dd * 0.5), cz + fz * (hs + dd * 0.5), absf(fx) * dd + absf(fz) * hs * 2.0, absf(fz) * dd + absf(fx) * hs * 2.0, y0, st_top)


# rubble under the low corner of the cut and around the plot
static func _fallen(c: Ctx, key: String, cp: Dictionary, lw: float, ld: float, ruined: float, sc: float, sh: float) -> void:
	if cp.is_empty():
		return
	_rubble(c, key, signf(float(cp["dx"])) * lw * 0.52, signf(float(cp["dz"])) * ld * 0.52, minf(lw, ld) * (0.3 + 0.3 * ruined), 5 + int(14.0 * ruined), sc, sh)
	_rubble(c, key, 0.0, 0.0, maxf(lw, ld) * 0.7, 3 + int(5.0 * ruined), sc * 0.8, sh)


# style 1: round cores with floor boxes bridging between them at different levels
static func _t_cores(c: Ctx, lw: float, ld: float, h: float, ruined: float) -> void:
	var r := c.rng
	var key: String = ["BCG", "BCG", "BS2", "BS1"][r.randi() % 4]
	var sh := r.randf_range(0.95, 1.05)
	var sc := clampf(sqrt(ld / 30.0), 0.85, 1.8)
	var cp := _mkcut(r, lw, ld, h, ruined)
	var hx := lw * 0.5
	var hz := ld * 0.5
	var rc := clampf(ld * 0.12, 2.4, 9.0)
	var pj := 1.1 * sc
	var ax := maxf(hx - rc - lw * r.randf_range(0.1, 0.2), rc * 1.2)
	var az := hz - rc - pj - 0.5
	var nodes: Array[Vector2] = []
	if az < rc * 1.15:
		nodes.append(Vector2(-ax, 0))
		nodes.append(Vector2(ax, 0))
		if lw > 46.0:
			nodes.append(Vector2(r.randf_range(-0.1, 0.1) * lw, 0))
	else:
		nodes.append(Vector2(-ax, -az))
		nodes.append(Vector2(ax, az))
		nodes.append(Vector2(ax, -az))
		nodes.append(Vector2(-ax, az))
		if ld < 30.0 and r.randf() < 0.6:
			nodes.remove_at(2 + r.randi() % 2)
	var nn := nodes.size()
	var king := r.randi() % nn
	var ch := PackedFloat32Array()
	var ct := PackedFloat32Array()
	for i in nn:
		ch.append(h if i == king else maxf(roundf(h * r.randf_range(0.55, 0.92) / FH) * FH, 8.0))
		ct.append(ch[i])
		if not cp.is_empty():
			ct[i] = minf(ch[i], maxf(_cut(cp, nodes[i].x, nodes[i].y) + r.randf_range(-0.3, 1.0) * float(cp["jit"]), 2.0))
	c.slab(key, 0.0, 0.0, lw, ld, -6.0, 0.15, sh * 0.85, SIDES | TOP)
	c.solid(0.0, 0.0, lw, ld, -5.0, 0.15, true)
	# floor boxes, bottom up; each ties together the cores that still stand that high
	var cl := clampf(roundf(h * 0.17 / FH), 1.0, 6.0) * FH
	var lim := h * 0.9
	var yy := cl
	var kk := 0
	var top_y := 0.0
	var top_r := Rect2()
	while yy < lim - FH * 1.5 and kk < 14:
		var vh := minf(FH * (1 + r.randi() % (2 + int(h > 36.0) + int(h > 80.0))), floorf((lim - yy) / FH) * FH)
		if vh < FH:
			break
		var up: Array[int] = []
		for i in nn:
			if ch[i] >= yy + vh - 0.1:
				up.append(i)
		if up.is_empty():
			break
		var sel: Array[int] = up.duplicate()
		var roll := r.randf()
		if kk > 0 and up.size() > 2 and roll < 0.7:
			var a: int = up[r.randi() % up.size()]
			sel = [a]
			var best := -1
			for b in up:
				if b != a and (absf(nodes[b].x - nodes[a].x) < 0.1 or absf(nodes[b].y - nodes[a].y) < 0.1):
					if best < 0 or r.randf() < 0.5:
						best = b
			if best >= 0:
				sel.append(best)
		elif kk > 0 and roll > 0.92:
			sel = [up[r.randi() % up.size()]]
		var x0 := 1e9
		var x1 := -1e9
		var z0 := 1e9
		var z1 := -1e9
		for i in sel:
			x0 = minf(x0, nodes[i].x)
			x1 = maxf(x1, nodes[i].x)
			z0 = minf(z0, nodes[i].y)
			z1 = maxf(z1, nodes[i].y)
		x0 = maxf(x0 - rc - pj - maxf(x0 + hx - rc - pj, 0.0) * _ext(r), -hx)
		x1 = minf(x1 + rc + pj + maxf(hx - x1 - rc - pj, 0.0) * _ext(r), hx)
		z0 = maxf(z0 - rc * r.randf_range(0.3, 1.0) - pj - maxf(z0 + hz - rc - pj, 0.0) * _ext(r), -hz)
		z1 = minf(z1 + rc * r.randf_range(0.3, 1.0) + pj + maxf(hz - z1 - rc - pj, 0.0) * _ext(r), hz)
		_vol(c, 0 if r.randf() < 0.7 else 1, key, 0, x0, x1, z0, z1, yy, yy + vh, sc, sh, cp)
		for i in sel:
			if ct[i] < yy - 1.0:
				continue
			c.slab(key, nodes[i].x, nodes[i].y, rc * 2.0 + 2.4 * sc, 1.1 * sc, yy - 2.5 * sc, yy - 1.3 * sc, sh * 0.92, ALL)
			c.slab(key, nodes[i].x, nodes[i].y, 1.1 * sc, rc * 2.0 + 2.4 * sc, yy - 2.5 * sc, yy - 1.3 * sc, sh * 0.92, ALL)
		if yy + vh > top_y:
			top_y = yy + vh
			top_r = Rect2(x0, z0, x1 - x0, z1 - z0)
		yy += vh + FH * float([0, 0, 1, 1, 2][r.randi() % 5])
		kk += 1
	for i in nn:
		var p := nodes[i]
		var top: float = ct[i]
		var broken := top < ch[i] - 0.01
		_core(c, key, p.x, p.y, rc, top, sc, sh, 0 if p.x >= 0.0 else 1, broken)
		_core_solid(c, p.x, p.y, rc, -5.0, top)
		if broken:
			continue
		if i == king:
			_mast(c, p.x, p.y, top, clampf(h * 0.22, 5.0, 30.0), sc, "BGL", key)
		else:
			c.slab(key, p.x, p.y, rc * 1.15, rc * 1.15, top, top + 2.4 * sc, sh * 0.95, SHELL)
			c.slab("BGL", p.x, p.y, rc * 1.4, rc * 1.4, top + 2.4 * sc, top + 2.8 * sc, 3.0, ALL)
	if cl >= FH * 2.0:
		# glazed lobby under the lowest box
		_deck(c, key, -lw * 0.2, lw * 0.2, -ld * 0.22, ld * 0.22, 0.15, 0.15 + FH, sc, sh)
		c.solid(0.0, 0.0, lw * 0.4, ld * 0.44, 0.15, 0.15 + FH)
	if cp.is_empty() and top_y > 0.0:
		_roof_kit(c, key, top_r.get_center().x, top_r.get_center().y, top_r.size.x * 0.8, top_r.size.y * 0.8, top_y, sh, 2 + int(ld / 14.0))
	_fallen(c, key, cp, lw, ld, ruined, sc, sh)


# style 2: a shaft (two on a long plot) carrying stacks of plug-in modules with portholes
static func _t_capsule(c: Ctx, lw: float, ld: float, h: float, ruined: float) -> void:
	var r := c.rng
	var key: String = ["BCG", "BCG", "BS2"][r.randi() % 3]
	var sh := r.randf_range(0.95, 1.04)
	var sc := clampf(sqrt(ld / 30.0), 0.85, 1.8)
	var cp := _mkcut(r, lw, ld, h, ruined)
	var twin := lw > ld * 1.5 and lw >= 30.0
	var px: Array[float] = [0.0]
	if twin:
		px = [-lw * 0.25, lw * 0.25]
	var half := minf(lw * (0.25 if twin else 0.5), ld * 0.5)
	var cs := clampf(half * 0.62, 4.0, 18.0)
	var reach := half - cs * 0.5 - 0.3
	c.slab(key, 0.0, 0.0, lw, ld, -6.0, 0.15, sh * 0.85, SIDES | TOP)
	c.solid(0.0, 0.0, lw, ld, -5.0, 0.15, true)
	var hp := FH * (1.0 if h < 30.0 else 2.0)
	_deck(c, key, -lw * 0.5 + reach * 0.35, lw * 0.5 - reach * 0.35, -ld * 0.5 + reach * 0.35, ld * 0.5 - reach * 0.35, 0.15, hp, sc, sh)
	c.solid(0.0, 0.0, lw - reach * 0.7, ld - reach * 0.7, 0.15, hp)
	var king := r.randi() % px.size()
	for t in px.size():
		var cx: float = px[t]
		var ht := h if t == king else roundf(h * r.randf_range(0.7, 0.9) / FH) * FH
		var top := ht
		var broken := false
		if not cp.is_empty():
			var l2 := _cut(cp, cx, 0.0) + r.randf_range(-0.3, 1.0) * float(cp["jit"])
			if l2 < top:
				top = maxf(l2, hp + 1.0)
				broken = true
		c.slab(key, cx, 0.0, cs, cs, hp - 0.2, top, sh, SHELL)
		c.solid(cx, 0.0, cs, cs, hp, top)
		c.slab("BGL", cx, 0.0, cs + 0.16, cs * 0.14, hp + 2.0, top - 2.0, 1.0, PX | NX)
		c.slab("BGL", cx, 0.0, cs * 0.14, cs + 0.16, hp + 2.0, top - 2.0, 1.0, PZ | NZ)
		_pods(c, "BCW", key, cx, 0.0, cs * 0.5, 0.25, hp + 0.5, ht * 0.87, clampf(ht / 11.0, 3.4, 8.0), reach, sh, cp)
		if broken:
			_stubs(c, key, cx, 0.0, cs, cs, top, sh)
			continue
		c.slab(key, cx, 0.0, cs + 0.8 * sc, cs + 0.8 * sc, top - 1.2 * sc, top, sh * 1.05, ALL)
		c.tilt("BGL", Vector3(cs * 0.9, cs * 0.5, cs * 0.9), Vector3(cx, top + cs * 0.25, 0.0), Vector3.ZERO, 3.0, {"tx": 0.35, "tz": 0.35})
		if t == king:
			_mast(c, cx, 0.0, top + cs * 0.5, clampf(h * 0.16, 5.0, 22.0), sc, "BGL", key)
	_fallen(c, "BCW", cp, lw, ld, ruined, sc, sh)


# style 3: slab volumes behind perforated screens, stacked with a shift so each one
# cantilevers past the one below; a blank service core at one end
static func _t_slab(c: Ctx, lw: float, ld: float, h: float, ruined: float) -> void:
	var r := c.rng
	var key: String = ["BS2", "BCG", "BCG", "BS1"][r.randi() % 4]
	var sh := r.randf_range(0.95, 1.05)
	var sc := clampf(sqrt(ld / 30.0), 0.85, 1.8)
	var cp := _mkcut(r, lw, ld, h, ruined)
	var hx := lw * 0.5
	var hz := ld * 0.5
	c.slab(key, 0.0, 0.0, lw, ld, -6.0, 0.15, sh * 0.85, SIDES | TOP)
	c.solid(0.0, 0.0, lw, ld, -5.0, 0.15, true)
	var xs := 1.0 if r.randf() < 0.5 else -1.0
	var zs := 1.0 if r.randf() < 0.5 else -1.0
	var cw := clampf(lw * 0.17, 4.5, 24.0)
	var cd := clampf(ld * 0.44, 4.5, 30.0)
	var ccx := xs * (hx - cw * 0.5 - lw * r.randf_range(0.03, 0.1))
	var ccz := zs * (hz - cd * 0.5 - 0.4)
	var ns := 1 if h < 22.0 else (2 if h < 52.0 else (3 if h < 110.0 else 4))
	var cl := clampf(roundf(h * 0.14 / FH), 1.0, 5.0) * FH
	var gap := FH if h >= 30.0 else FH * 0.5
	var vh := maxf(floorf(((h * 0.88 - cl) - gap * (ns - 1)) / ns / FH) * FH, FH)
	var yy := cl
	var ph := r.randi() % 2
	var prev := Rect2()
	var top_r := Rect2()
	for i in ns:
		var ln := lw * r.randf_range(0.64, 0.84)
		var td := ld * r.randf_range(0.5, 0.7)
		var u0 := -hx + (lw - ln) * (0.03 if (i + ph) % 2 == 0 else 0.97)
		var v0 := -hz + (ld - td) * r.randf_range(0.1, 0.9)
		_vol(c, 2, key, 0, u0, u0 + ln, v0, v0 + td, yy, yy + vh, sc, sh, cp)
		if i == 0:
			# fin walls carry the first slab over an open ground floor
			var nf := maxi(2, int(roundf(ln / (11.0 * sc))))
			for j in nf + 1:
				var fx := u0 + 1.0 * sc + (ln - 2.0 * sc) * j / nf
				c.slab(key, fx, v0 + td * 0.5, 1.2 * sc, td * 0.8, 0.0, cl, sh * 0.97, SIDES)
				c.solid(fx, v0 + td * 0.5, 1.2 * sc, td * 0.8, 0.0, cl)
			if cl >= FH * 2.0:
				_deck(c, key, u0 + ln * 0.3, u0 + ln * 0.62, v0 + td * 0.18, v0 + td * 0.82, 0.15, 0.15 + FH, sc, sh)
				c.solid(u0 + ln * 0.46, v0 + td * 0.5, ln * 0.32, td * 0.64, 0.15, 0.15 + FH)
		else:
			# recessed transfer storey where the two slabs overlap
			var ov := prev.intersection(Rect2(u0, v0, ln, td))
			if ov.size.x > 4.0 and ov.size.y > 4.0 and (cp.is_empty() or _cut(cp, ov.get_center().x, ov.get_center().y) > yy + FH):
				var oc := ov.get_center()
				c.slab("BGL", oc.x, oc.y, ov.size.x - 2.4 * sc, ov.size.y - 2.4 * sc, yy - gap, yy, 1.0, SIDES)
				c.solid(oc.x, oc.y, ov.size.x - 2.4 * sc, ov.size.y - 2.4 * sc, yy - gap, yy)
				for sx: float in [-1.0, 1.0]:
					for sz: float in [-1.0, 1.0]:
						c.slab(key, oc.x + sx * (ov.size.x * 0.5 - 1.6 * sc), oc.y + sz * (ov.size.y * 0.5 - 1.6 * sc), 1.0 * sc, 1.0 * sc, yy - gap, yy, sh * 0.95, SIDES)
		prev = Rect2(u0, v0, ln, td)
		top_r = prev
		yy += vh + gap
	var top := h
	var broken := false
	if not cp.is_empty():
		var l2 := _cut(cp, ccx, ccz) + r.randf_range(-0.3, 1.0) * float(cp["jit"])
		if l2 < top:
			top = maxf(l2, 3.0)
			broken = true
	c.slab(key, ccx, ccz, cw, cd, 0.0, top, sh * 1.02, SHELL)
	c.solid(ccx, ccz, cw, cd, 0.0, top)
	var yb := FH * 3.0
	while yb < top - 2.0:
		c.slab(key, ccx, ccz, cw + 0.3, cd + 0.3, yb, yb + 0.5, sh * 0.92, SIDES)
		yb += FH * 3.0
	if top > 9.0:
		c.slab("BGL", ccx + xs * (cw * 0.5 + 0.06), ccz, 0.12, cd * 0.22, 3.0, top - 3.0, 1.0, PX if xs > 0.0 else NX)
	if broken:
		_stubs(c, key, ccx, ccz, cw, cd, top, sh)
	else:
		c.slab("BGL", ccx, ccz, cw * 0.7, cd * 0.7, top, top + 2.6 * sc, 3.0, SHELL)
		if h >= 36.0:
			_mast(c, ccx, ccz, top + 2.6 * sc, clampf(h * 0.18, 5.0, 26.0), sc, "BGL", key)
	if cp.is_empty():
		_roof_kit(c, key, top_r.get_center().x, top_r.get_center().y, top_r.size.x * 0.8, top_r.size.y * 0.8, yy - gap, sh, 2 + int(ld / 14.0))
	_fallen(c, key, cp, lw, ld, ruined, sc, sh)


# A megastructure: big round cores on a loose grid, linked at different heights by bars
# several storeys deep that cantilever out to the edge of the plot; a lattice mast with a
# cluster of geodesic spheres on the tallest core, a ribbed disc on another, plug-in modules
# on a third, a viaduct running through underneath. The ground between the cores stays open
# (24 m and more under the lowest bar). w x d is the plot, h the top of the tallest core.
static func megablock(k, g: Node3D, add_box: Callable, x: float, z: float, w: float, d: float, h: float, y: float, rng: RandomNumberGenerator, ruined: float = 0.0) -> void:
	w = maxf(w, 60.0)
	d = maxf(d, 50.0)
	h = maxf(h, 90.0)
	ruined = clampf(ruined, 0.0, 1.0)
	var c := Ctx.new(k, g, add_box, rng, Vector3(x, y, z), (1 if d > w else 0) + 2 * (rng.randi() % 2), direct)
	var r := rng
	var ll := maxf(w, d)
	var dd := minf(w, d)
	var hx := ll * 0.5
	var hz := dd * 0.5
	var key: String = ["BCG", "BCG", "BS2"][r.randi() % 3]
	var sh := r.randf_range(0.95, 1.04)
	var sc := 1.4
	var cp := _mkcut(r, ll, dd, h, ruined)
	var gx: Array[float] = [-ll * 0.33, ll * r.randf_range(-0.07, 0.07), ll * 0.33]
	var gz: Array[float] = [-dd * 0.24, dd * 0.24]
	var has: Array[bool] = [true, true, true, true, true, true]
	has[2 + r.randi() % 2] = false
	var rcm := dd * 0.1
	var rcs := PackedFloat32Array()
	var need := PackedFloat32Array()
	for i in 6:
		rcs.append(dd * r.randf_range(0.085, 0.115))
		need.append(0.0)
	# plan the bars first; every core then rises past what it carries
	var vols: Array = []
	var cl := FH * r.randi_range(7, 9)
	var yy := cl
	var lvl := 0
	while yy < h * 0.78 and lvl < 9:
		var bh := FH * r.randi_range(3, 7)
		if yy + bh > h * 0.84:
			bh = floorf((h * 0.84 - yy) / FH) * FH
		if bh < FH * 2.0:
			break
		var nsp := 2 if (yy < h * 0.42 and r.randf() < 0.8) else 1
		var row := r.randi() % 2
		for s in nsp:
			var roll := r.randf()
			if s == 1:
				row = 1 - row
			var sup: Array[int] = []
			if roll < (0.62 if lvl == 0 else 0.3):
				# megabar: one row of cores, end to end
				for col in 3:
					if has[col * 2 + row]:
						sup.append(col * 2 + row)
				if sup.size() >= 2:
					var wv := rcm * r.randf_range(2.3, 3.1)
					var v0 := clampf(gz[row] - wv * 0.5 + r.randf_range(-0.3, 0.3) * rcm, -hz, hz - wv)
					vols.append([2, 0, -hx + ll * r.randf_range(0.0, 0.07), hx - ll * r.randf_range(0.0, 0.07), v0, v0 + wv, yy, yy + bh, sup])
			elif roll < 0.72:
				# two neighbouring columns, cantilevered past the outer one
				var c0 := r.randi() % 2
				for col in [c0, c0 + 1]:
					if has[col * 2 + row]:
						sup.append(col * 2 + row)
				if sup.size() >= 1:
					var u0: float = gx[c0] - rcm * 1.3
					var u1: float = gx[c0 + 1] + rcm * 1.3
					if c0 == 0:
						u0 -= (gx[0] + hx - rcm * 1.3) * r.randf_range(0.3, 1.0)
						u1 += ll * 0.12 * _ext(r)
					else:
						u1 += (hx - gx[2] - rcm * 1.3) * r.randf_range(0.3, 1.0)
						u0 -= ll * 0.12 * _ext(r)
					var wv := rcm * r.randf_range(2.0, 2.8)
					var v0 := clampf(gz[row] - wv * 0.5, -hz, hz - wv)
					vols.append([2 if r.randf() < 0.6 else 0, 0, u0, u1, v0, v0 + wv, yy, yy + bh, sup])
			elif roll < 0.92:
				# across: both rows of one column, out to the long edges of the plot
				var col := r.randi() % 3
				for rw in 2:
					if has[col * 2 + rw]:
						sup.append(col * 2 + rw)
				if sup.size() >= 1:
					var wu := rcm * r.randf_range(2.1, 2.9)
					var u0 := clampf(gx[col] - wu * 0.5, -hx, hx - wu)
					vols.append([0 if r.randf() < 0.5 else 2, 1, -hz + dd * r.randf_range(0.0, 0.08), hz - dd * r.randf_range(0.0, 0.08), u0, u0 + wu, yy, yy + bh, sup])
			else:
				# a thin plate over two columns and both rows
				var c0 := r.randi() % 2
				for col in [c0, c0 + 1]:
					for rw in 2:
						if has[col * 2 + rw]:
							sup.append(col * 2 + rw)
				if sup.size() >= 2:
					vols.append([1, 0, gx[c0] - rcm * 2.2, gx[c0 + 1] + rcm * 2.2, -hz + dd * 0.04, hz - dd * 0.04, yy, yy + FH * 2.0, sup])
			for i in sup:
				need[i] = maxf(need[i], yy + bh)
		yy += bh + FH * r.randi_range(1, 4)
		lvl += 1
	# cores
	var king := -1
	var ch := PackedFloat32Array()
	for i in 6:
		ch.append(0.0)
		if not has[i]:
			continue
		if need[i] <= 0.0:
			has[i] = false
			continue
		ch[i] = minf(need[i] + FH * r.randi_range(2, 9), h * 0.94)
		if king < 0 or need[i] > need[king]:
			king = i
	if king < 0:
		king = 0
		has[0] = true
	ch[king] = h
	var tops: Array[int] = []
	for i in 6:
		if not has[i]:
			continue
		var px: float = gx[i / 2]
		var pz: float = gz[i % 2]
		var rc: float = rcs[i]
		var top: float = ch[i]
		var broken := false
		if not cp.is_empty():
			var l2 := _cut(cp, px, pz) + r.randf_range(-0.3, 1.0) * float(cp["jit"])
			if l2 < top:
				top = maxf(l2, 6.0)
				broken = true
		_core(c, key, px, pz, rc, top, sc, sh, 2 if i % 2 == 1 else 3, broken)
		_core_solid(c, px, pz, rc, -14.0, top, true)
		# footing, deep enough for a sloping plot
		c.tube(key, px, -6.9, pz, rc * 1.35, rc * 1.35, 18.2, 20, sh * 0.9, 1, 3)
		ch[i] = top
		if not broken:
			tops.append(i)
	# bars
	for vv in vols:
		var kind: int = vv[0]
		var ax: int = vv[1]
		var u0: float = vv[2]
		var u1: float = vv[3]
		var v0: float = vv[4]
		var v1: float = vv[5]
		var y0: float = vv[6]
		var y1: float = vv[7]
		_vol(c, kind, key, ax, u0, u1, v0, v1, y0, y1, sc, sh, cp)
		var sup: Array = vv[8]
		for i in sup:
			# haunch under the bar at every core it rests on
			var px: float = gx[int(i) / 2]
			var pz: float = gz[int(i) % 2]
			var rc: float = rcs[i]
			if ch[i] < y0:
				continue
			c.slab(key, px, pz, rc * 2.0 + 5.0, 2.2, y0 - 4.2, y0 - 1.7, sh * 0.92, ALL)
			c.slab(key, px, pz, 2.2, rc * 2.0 + 5.0, y0 - 4.2, y0 - 1.7, sh * 0.92, ALL)
			c.tube(key, px, y0 - 5.0, pz, rc + 0.2, rc + 1.0, 1.6, 20, sh * 0.95, 1, 1)
		if not cp.is_empty():
			continue
		var mx := (u0 + u1) * 0.5 if ax == 0 else (v0 + v1) * 0.5
		var mz := (v0 + v1) * 0.5 if ax == 0 else (u0 + u1) * 0.5
		var sx := (u1 - u0) if ax == 0 else (v1 - v0)
		var sz := (v1 - v0) if ax == 0 else (u1 - u0)
		_roof_kit(c, key, mx, mz, sx * 0.84, sz * 0.7, y1, sh, 4 + int(sx * sz / 500.0))
		if ax == 0:
			# struts under long cantilevers, a pod slung under the middle of some bars
			for e in 2:
				var ue := u0 if e == 0 else u1
				var best := -1
				for i in sup:
					if best < 0 or absf(gx[int(i) / 2] - ue) < absf(gx[best / 2] - ue):
						best = int(i)
				if best < 0:
					continue
				var cant := absf(gx[best / 2] - ue) - rcs[best]
				if cant > 15.0 and ch[best] >= y0:
					var sg := -1.0 if e == 0 else 1.0
					for s: float in [-1.0, 1.0]:
						c.beam(key, Vector3(gx[best / 2] + sg * rcs[best] * 0.9, y0 - cant * 0.5, mz + s * sz * 0.3), Vector3(ue - sg * 3.0, y0 - 1.6, mz + s * sz * 0.3), 1.7, 1.7, sh * 0.9)
			if r.randf() < 0.4 and y0 - FH * 3.0 > cl - 1.0:
				var pw := minf(sx * 0.22, 26.0)
				var pxx := mx + r.randf_range(-0.2, 0.2) * sx
				_deck(c, key, pxx - pw * 0.5, pxx + pw * 0.5, mz - sz * 0.3, mz + sz * 0.3, y0 - 1.6 - FH * 2.0, y0 - 1.6, sc, sh * 0.96, true)
				c.solid(pxx, mz, pw, sz * 0.6, y0 - 1.6 - FH * 2.0, y0 - 1.6)
	# what stands on the cores
	var extras: Array[int] = [1, 2, 3]
	if r.randf() < 0.5:
		extras = [2, 1, 3]
	var ei := 0
	for i in tops:
		var px: float = gx[i / 2]
		var pz: float = gz[i % 2]
		var rc: float = rcs[i]
		var top: float = ch[i]
		if i == king:
			# lattice mast carrying a cluster of geodesic spheres
			var mh := clampf(h * 0.24, 30.0, 72.0)
			_lattice(c, px, pz, top, mh, rc * 0.5, 1.0)
			c.slab("BST", px, pz, 0.5, 0.5, top + mh, top + mh * 1.3, 0.8, SHELL)
			var sr := rc * 0.58
			for q in 3 + r.randi() % 2:
				var a := q * TAU / 3.0 + r.randf_range(-0.3, 0.3)
				var sy := top + mh * (0.22 + 0.16 * q)
				var off := rc * 0.5 * (1.0 - (sy - top) / mh) + sr * 0.8
				_geo(c, "BCW", px + cos(a) * off, sy, pz + sin(a) * off, sr * r.randf_range(0.8, 1.05), 1.0)
				c.slab("BST", px + cos(a) * off * 0.5, pz + sin(a) * off * 0.5, absf(cos(a)) * off + 0.5, absf(sin(a)) * off + 0.5, sy - sr - 0.5, sy - sr, 0.8, ALL)
			continue
		var what: int = extras[ei % 3]
		ei += 1
		if what == 1:
			# ribbed disc
			var dr := rc * 2.7
			var th := rc * 0.34
			c.tube(key, px, top + 2.0, pz, rc * 0.9, rc * 0.9, 4.0, 20, sh, 1, 1)
			c.tube(key, px, top + 4.0 + th * 0.5, pz, dr * 0.8, dr, th, 32, sh * 1.03, 1, 7)
			c.tube("BCW", px, top + 4.0 + th + th * 0.3, pz, dr * 0.62, dr * 0.3, th * 0.6, 32, 1.0, 1, 3)
			for q in 20:
				var a := q * TAU / 20.0
				c.tilt(key, Vector3(dr * 0.82 - rc * 0.8, th * 1.3, 0.6), Vector3(px + cos(a) * (dr * 0.82 + rc * 0.8) * 0.5, top + 4.0 - th * 0.1, pz + sin(a) * (dr * 0.82 + rc * 0.8) * 0.5), Vector3(0, -a, 0), sh * 0.88, {"bx": 0.92})
			c.solid(px, pz, dr * 1.42, dr * 1.42, top + 4.0, top + 4.0 + th)
		elif what == 2 and top - need[i] > FH * 4.0:
			# plug-in modules round the bare top of the shaft
			_pods(c, "BCW", key, px, pz, rc * 0.92, rc * 0.5, need[i] + FH, top - FH, 6.0, rc * 1.3, sh, cp)
			c.slab("BHB", px, pz, rc * 1.3, rc * 1.3, top, top + 3.4, 0.9, SHELL)
			_mast(c, px, pz, top + 3.4, 20.0, 1.6, "BST", "BCW")
		else:
			c.slab(key, px, pz, rc * 1.2, rc * 1.2, top, top + 4.0, sh * 0.95, SHELL)
			c.slab("BHB", px, pz, rc * 1.5, rc * 1.5, top + 4.0, top + 4.6, 0.9, ALL)
			_mast(c, px, pz, top + 4.6, 16.0, 1.6, "BST", "BCW")
	# viaduct through the open ground between the two rows, service blocks at two cores
	var yv := cl - 7.0
	c.slab(key, 0.0, 0.0, ll + 10.0, 7.0, yv, yv + 1.5, sh * 0.95, ALL)
	c.solid(0.0, 0.0, ll + 10.0, 7.0, yv, yv + 1.5)
	for s: float in [-1.0, 1.0]:
		c.slab(key, 0.0, s * 3.2, ll + 10.0, 0.5, yv + 1.5, yv + 2.6, sh, SHELL)
		c.slab("BST", 0.0, s * 1.3, ll + 10.0, 0.3, yv + 1.5, yv + 1.75, 0.7, SHELL)
	var np := maxi(3, int(roundf(ll / 30.0)))
	for i in np + 1:
		var ux := -hx + ll * i / np
		c.slab(key, ux, 0.0, 2.4, 4.6, -16.0, yv, sh * 0.93, SIDES)
		c.slab(key, ux, 0.0, 3.4, 7.0, yv - 1.6, yv, sh * 0.97, ALL)
		c.solid(ux, 0.0, 2.4, 4.6, -14.0, yv)
	var tx := r.randf_range(-0.3, 0.2) * ll
	for i in 4:
		c.slab("BK2" if i % 2 == 0 else "BK3", tx + i * 19.0, 0.0, 18.0, 3.2, yv + 1.9, yv + 5.4, r.randf_range(0.85, 1.1), ALL)
	for i in 2:
		var col := i * 2
		if not has[col * 2] and not has[col * 2 + 1]:
			continue
		var bx: float = gx[col] + (rcm * 3.2 if i == 0 else -rcm * 3.2)
		var bz: float = gz[r.randi() % 2] * 1.5
		bz = clampf(bz, -hz + 9.0, hz - 9.0)
		_deck(c, key, bx - 11.0, bx + 11.0, bz - 7.0, bz + 7.0, 0.1, 0.1 + FH * 2.0, 1.0, sh)
		c.slab(key, bx, bz, 20.0, 12.0, -14.0, 0.1, sh * 0.85, SIDES)
		c.solid(bx, bz, 22.0, 14.0, -14.0, 0.1 + FH * 2.0)
	_fallen(c, key, cp, ll, dd, ruined, 2.0, sh)
	_mark(g, x, y, z, w, d, c.top)
	_done(c)


# ------------------------------------------------------------------ assembly hall
# box on wall f of the hall (0 +Z door side, 1 -Z, 2 +X, 3 -X): u along the wall, n0..n1 outward
static func _hb(c: Ctx, key: String, f: int, hx: float, hz: float, u: float, wu: float, n0: float, n1: float, y0: float, y1: float, shade: float = 1.0) -> void:
	if y1 - y0 < 0.05 or wu < 0.05:
		return
	var nc := (n0 + n1) * 0.5
	if f == 0:
		c.slab(key, u, hz + nc, wu, n1 - n0, y0, y1, shade, ALL & ~NZ)
	elif f == 1:
		c.slab(key, u, -hz - nc, wu, n1 - n0, y0, y1, shade, ALL & ~PZ)
	elif f == 2:
		c.slab(key, hx + nc, u, n1 - n0, wu, y0, y1, shade, ALL & ~NX)
	else:
		c.slab(key, -hx - nc, u, n1 - n0, wu, y0, y1, shade, ALL & ~PX)


static func _hp(f: int, hx: float, hz: float, u: float, n: float, y: float) -> Vector3:
	if f == 0:
		return Vector3(u, y, hz + n)
	if f == 1:
		return Vector3(u, y, -hz - n)
	if f == 2:
		return Vector3(hx + n, y, u)
	return Vector3(-hx - n, y, u)


# red service stair in a cage standing against a wall at (bx, bz); (nx, nz) points away from it
static func _stair(c: Ctx, bx: float, bz: float, nx: float, nz: float, y0: float, y1: float) -> void:
	var tx := -nz
	var tz := nx
	var dep := 4.6
	var wid := 9.0
	var mx := bx + nx * dep * 0.5
	var mz := bz + nz * dep * 0.5
	for a: float in [-0.5, 0.5]:
		for b: float in [0.04, 1.0]:
			c.slab("BRD", bx + nx * dep * b + tx * wid * a, bz + nz * dep * b + tz * wid * a, 0.36, 0.36, y0, y1, 1.0, SIDES)
	var lv := int((y1 - y0) / FH)
	for i in lv:
		var ya := y0 + i * FH
		var s := 1.0 if i % 2 == 0 else -1.0
		# landing at one end, flight up to the other
		c.slab("BRD", mx + tx * wid * 0.39 * s, mz + tz * wid * 0.39 * s, absf(tx) * 2.0 + absf(nx) * dep, absf(tz) * 2.0 + absf(nz) * dep, ya - 0.2, ya, 0.9, ALL)
		if i < lv - 1:
			c.beam("BRD", Vector3(mx + tx * wid * 0.3 * s, ya - 0.1, mz + tz * wid * 0.3 * s), Vector3(mx - tx * wid * 0.3 * s, ya + FH - 0.1, mz - tz * wid * 0.3 * s), 1.7, 0.24, 0.95)
		if i % 2 == 0:
			# cage ring
			c.slab("BRD", mx + nx * dep * 0.5, mz + nz * dep * 0.5, absf(tx) * wid + 0.3, absf(tz) * wid + 0.3, ya + 1.1, ya + 1.35, 1.0, ALL)
			for a: float in [-0.5, 0.5]:
				c.slab("BRD", mx + tx * wid * a, mz + tz * wid * a, absf(nx) * dep + 0.3, absf(nz) * dep + 0.3, ya + 1.1, ya + 1.35, 1.0, ALL)
	c.solid(mx, mz, absf(tx) * wid + absf(nx) * dep, absf(tz) * wid + absf(nz) * dep, y0, y1)


# yellow tower crane: lattice mast, jib along (jx, jz), counter-jib, cab and hook
static func _tower_crane(c: Ctx, px: float, pz: float, y0: float, mh: float, jl: float, jx: float, jz: float) -> void:
	var hw := 1.3
	c.slab("BCG", px, pz, 8.0, 8.0, y0, y0 + 1.4, 0.9, SHELL)
	var yb := y0 + 1.4
	for sx: float in [-1.0, 1.0]:
		for sz: float in [-1.0, 1.0]:
			c.slab("BYL", px + sx * hw, pz + sz * hw, 0.36, 0.36, yb, yb + mh, 1.0, SIDES)
	var n := maxi(3, int(roundf(mh / 3.2)))
	var seg := mh / n
	for i in n:
		var ya := yb + i * seg
		c.slab("BYL", px, pz + hw, 2.0 * hw, 0.2, ya + seg - 0.2, ya + seg, 0.95, ALL)
		c.slab("BYL", px, pz - hw, 2.0 * hw, 0.2, ya + seg - 0.2, ya + seg, 0.95, ALL)
		c.slab("BYL", px + hw, pz, 0.2, 2.0 * hw, ya + seg - 0.2, ya + seg, 0.95, ALL)
		c.slab("BYL", px - hw, pz, 0.2, 2.0 * hw, ya + seg - 0.2, ya + seg, 0.95, ALL)
		var s := 1.0 if i % 2 == 0 else -1.0
		c.beam("BYL", Vector3(px - hw * s, ya, pz + hw), Vector3(px + hw * s, ya + seg, pz + hw), 0.18, 0.18, 0.9)
		c.beam("BYL", Vector3(px + hw * s, ya, pz - hw), Vector3(px - hw * s, ya + seg, pz - hw), 0.18, 0.18, 0.9)
		c.beam("BYL", Vector3(px + hw, ya, pz - hw * s), Vector3(px + hw, ya + seg, pz + hw * s), 0.18, 0.18, 0.9)
		c.beam("BYL", Vector3(px - hw, ya, pz + hw * s), Vector3(px - hw, ya + seg, pz - hw * s), 0.18, 0.18, 0.9)
	var yt := yb + mh
	# slewing unit, cab, cat head
	c.slab("BYL", px, pz, 3.4, 3.4, yt, yt + 2.2, 1.0, ALL)
	c.slab("BGL", px + jx * 2.6 + jz * 2.0, pz + jz * 2.6 + jx * 2.0, 2.2, 2.2, yt - 0.6, yt + 1.8, 2.0, ALL)
	c.slab("BYL", px, pz, 0.5, 0.5, yt + 2.2, yt + 10.0, 1.0, SIDES | TOP)
	var top := Vector3(px, yt + 10.0, pz)
	# jib: two bottom chords, one top chord, posts and diagonals
	var ja := Vector3(px + jx * 1.8, yt + 2.4, pz + jz * 1.8)
	var jb := Vector3(px + jx * jl, yt + 2.4, pz + jz * jl)
	var mid := (ja + jb) * 0.5
	var sdx := absf(jz)
	var sdz := absf(jx)
	for s: float in [-1.0, 1.0]:
		c.slab("BYL", mid.x + sdx * s * 0.9, mid.z + sdz * s * 0.9, absf(jx) * (jl - 1.8) + 0.26, absf(jz) * (jl - 1.8) + 0.26, yt + 2.3, yt + 2.56, 1.0, ALL)
	c.slab("BYL", mid.x, mid.z, absf(jx) * (jl - 1.8) + 0.26, absf(jz) * (jl - 1.8) + 0.26, yt + 4.2, yt + 4.46, 1.0, ALL)
	var jn := maxi(4, int(roundf(jl / 3.4)))
	for i in jn:
		var u0 := 1.8 + (jl - 1.8) * float(i) / jn
		var u1 := 1.8 + (jl - 1.8) * float(i + 1) / jn
		var p0 := Vector3(px + jx * u0, yt + 2.4, pz + jz * u0)
		var p1 := Vector3(px + jx * u1, yt + 2.4, pz + jz * u1)
		c.slab("BYL", p1.x, p1.z, sdx * 1.8 + 0.2, sdz * 1.8 + 0.2, yt + 2.3, yt + 2.5, 0.95, ALL)
		if i % 2 == 0:
			c.beam("BYL", p0 + Vector3(sdx * 0.9, 0, sdz * 0.9), p1 + Vector3(0, 1.9, 0), 0.16, 0.16, 0.9)
			c.beam("BYL", p0 - Vector3(sdx * 0.9, 0, sdz * 0.9), p1 + Vector3(0, 1.9, 0), 0.16, 0.16, 0.9)
		else:
			c.beam("BYL", p0 + Vector3(0, 1.9, 0), p1 + Vector3(sdx * 0.9, 0, sdz * 0.9), 0.16, 0.16, 0.9)
			c.beam("BYL", p0 + Vector3(0, 1.9, 0), p1 - Vector3(sdx * 0.9, 0, sdz * 0.9), 0.16, 0.16, 0.9)
	c.beam("BYL", top, jb + Vector3(-jx * jl * 0.12, 2.0, -jz * jl * 0.12), 0.2, 0.2, 0.8)
	c.beam("BYL", top, mid + Vector3(0, 2.0, 0), 0.2, 0.2, 0.8)
	# counter-jib with ballast
	var cl := jl * 0.32
	var cm := Vector3(px - jx * (cl * 0.5 + 0.9), 0, pz - jz * (cl * 0.5 + 0.9))
	c.slab("BYL", cm.x, cm.z, absf(jx) * cl + sdx * 2.0, absf(jz) * cl + sdz * 2.0, yt + 2.2, yt + 2.7, 1.0, ALL)
	c.slab("BCG", px - jx * (cl + 0.2), pz - jz * (cl + 0.2), absf(jx) * 3.0 + sdx * 2.2, absf(jz) * 3.0 + sdz * 2.2, yt + 0.2, yt + 2.2, 0.8, ALL)
	c.beam("BYL", top, Vector3(px - jx * cl, yt + 2.8, pz - jz * cl), 0.2, 0.2, 0.8)
	# trolley, cable, hook block
	var tu := jl * c.rng.randf_range(0.45, 0.8)
	var hk := c.rng.randf_range(8.0, mh * 0.7)
	c.slab("BST", px + jx * tu, pz + jz * tu, 1.8, 1.8, yt + 1.7, yt + 2.3, 0.9, ALL)
	c.slab("BST", px + jx * tu, pz + jz * tu, 0.14, 0.14, yt + 1.7 - hk, yt + 1.7, 0.6, SIDES)
	c.slab("BHZ", px + jx * tu, pz + jz * tu, 1.3, 1.3, yt + 0.3 - hk, yt + 1.7 - hk, 1.0, ALL)
	c.solid(px, pz, 3.2, 3.2, y0, yt + 2.2)


# a block of stacked shipping containers; lanes run along X or Z
static func _yard(c: Ctx, cx: float, cz: float, nrow: int, ncol: int, along_x: bool, maxh: int) -> void:
	var r := c.rng
	var cl := 12.2
	var cw := 2.44
	var chh := 2.6
	var keys := ["BK1", "BK2", "BK3", "BK1", "BK2"]
	for j in ncol:
		var top := 0
		var v := (j - (ncol - 1) * 0.5) * (cw + 0.4)
		for i in nrow:
			var u := (i - (nrow - 1) * 0.5) * (cl + 0.7)
			var n := r.randi() % (maxh + 1)
			top = maxi(top, n)
			for q in n:
				var px := cx + (u if along_x else v)
				var pz := cz + (v if along_x else u)
				c.slab(keys[r.randi() % 5], px, pz, cl if along_x else cw, cw if along_x else cl, 0.1 + q * chh, 0.1 + (q + 1) * chh - 0.08, r.randf_range(0.75, 1.15), SHELL)
		if top > 0:
			var ln := nrow * (cl + 0.7)
			c.solid(cx + (0.0 if along_x else v), cz + (v if along_x else 0.0), ln if along_x else cw, cw if along_x else ln, 0.0, top * chh)


# low service building beside the hall; f = side its doors face (0 +Z, 1 -Z, 2 +X, 3 -X)
static func _annex(c: Ctx, cx: float, cz: float, aw: float, ad: float, ah: float, f: int) -> void:
	var r := c.rng
	var key := "BCG" if r.randf() < 0.6 else "BHW"
	var sh := r.randf_range(0.9, 1.05)
	c.slab(key, cx, cz, aw, ad, -6.0, ah, sh, SIDES)
	c.slab("BHB", cx, cz, aw + 1.2, ad + 1.2, ah, ah + 0.8, 0.9, ALL)
	c.slab("BHB", cx, cz, aw + 0.3, ad + 0.3, 0.0, 1.2, 0.8, SIDES)
	c.solid(cx, cz, aw, ad, -5.0, ah + 0.8)
	var hx := aw * 0.5
	var hz := ad * 0.5
	var ln := aw if f < 2 else ad
	var nd := maxi(2, int(ln / 7.0))
	for i in nd:
		var u := (i + 0.5 - nd * 0.5) * ln / nd
		if i % 3 == 0:
			# roller door with a canopy
			_hb_at(c, "BHB", f, cx, cz, hx, hz, u, 4.6, 0.0, 0.25, 0.1, 5.0, 0.7)
			_hb_at(c, "BST", f, cx, cz, hx, hz, u, 5.6, 0.0, 1.8, 5.3, 5.55, 0.9)
		else:
			_hb_at(c, "BGL", f, cx, cz, hx, hz, u, 1.3, 0.0, 0.16, 0.1, 2.5, 0.7)
		if ah > 8.0:
			_hb_at(c, "BGL", f, cx, cz, hx, hz, u, ln / nd - 2.0, 0.0, 0.16, ah - 4.0, ah - 2.2, 1.0)
	# plant on the roof
	for i in 2 + r.randi() % 3:
		var px := cx + r.randf_range(-0.35, 0.35) * aw
		var pz := cz + r.randf_range(-0.35, 0.35) * ad
		if r.randf() < 0.3:
			c.cyl("BST", 0.9, 0.9, r.randf_range(5.0, 11.0), Vector3(px, ah + 4.0, pz), 8, 0.9)
		else:
			c.slab("BST", px, pz, r.randf_range(3.0, 6.0), r.randf_range(2.4, 4.0), ah + 0.8, ah + 0.8 + r.randf_range(1.6, 3.0), r.randf_range(0.8, 1.2), SHELL)


# _hb for a block that is not centred on the origin
static func _hb_at(c: Ctx, key: String, f: int, cx: float, cz: float, hx: float, hz: float, u: float, wu: float, n0: float, n1: float, y0: float, y1: float, shade: float = 1.0) -> void:
	var nc := (n0 + n1) * 0.5
	if f == 0:
		c.slab(key, cx + u, cz + hz + nc, wu, n1 - n0, y0, y1, shade, ALL & ~NZ)
	elif f == 1:
		c.slab(key, cx + u, cz - hz - nc, wu, n1 - n0, y0, y1, shade, ALL & ~PZ)
	elif f == 2:
		c.slab(key, cx + hx + nc, cz + u, n1 - n0, wu, y0, y1, shade, ALL & ~NX)
	else:
		c.slab(key, cx - hx - nc, cz + u, n1 - n0, wu, y0, y1, shade, ALL & ~PX)


# scaffold tower: posts and a deck every storey
static func _scaffold(c: Ctx, px: float, pz: float, hgt: float) -> void:
	for sx: float in [-1.0, 1.0]:
		for sz: float in [-1.0, 1.0]:
			c.slab("BST", px + sx * 2.6, pz + sz * 2.6, 0.24, 0.24, 0.0, hgt, 0.9, SIDES)
	var n := int(hgt / FH)
	for i in n:
		c.slab("BYL", px, pz, 5.6, 5.6, (i + 1) * FH - 0.2, (i + 1) * FH, 0.9, ALL)
		c.slab("BST", px + 2.6, pz, 0.12, 5.2, (i + 1) * FH + 1.0, (i + 1) * FH + 1.12, 0.9, ALL)
		c.slab("BST", px - 2.6, pz, 0.12, 5.2, (i + 1) * FH + 1.0, (i + 1) * FH + 1.12, 0.9, ALL)
	c.solid(px, pz, 5.6, 5.6, 0.0, n * FH)


# ribbed main of radius rp along a local axis (0 X, 1 Y, 2 Z), centred on (cx, cy, cz)
static func _pipe(c: Ctx, key: String, axis: int, cx: float, cy: float, cz: float, ln: float, rp: float, sh: float = 1.0) -> void:
	if ln < 0.5:
		return
	c.tube(key, cx, cy, cz, rp, rp, ln, 14, sh, axis, 1)
	var n := maxi(1, int(ln / (rp * 1.5)))
	for i in n:
		var t := ((i + 0.5) / n - 0.5) * ln
		c.tube(key, cx + (t if axis == 0 else 0.0), cy + (t if axis == 1 else 0.0), cz + (t if axis == 2 else 0.0), rp * 1.14, rp * 1.14, rp * 0.36, 14, sh * 0.74, axis, 7)


# silo on a concrete skirt: ringed shell, cone, vent, shoulder gallery, caged ladder
static func _silo(c: Ctx, key: String, px: float, pz: float, rs: float, hs: float, sh: float) -> void:
	c.tube("BCG", px, -1.5, pz, rs * 0.94, rs * 0.94, 9.0, 18, 0.9, 1, 1)
	c.tube(key, px, 3.0 + hs * 0.5, pz, rs, rs, hs, 18, sh, 1, 1)
	var nr := maxi(3, int(hs / 7.0))
	for i in nr + 1:
		c.tube("BST", px, 3.0 + hs * i / nr, pz, rs + 0.28, rs + 0.28, 0.45, 18, 0.85, 1, 7)
	c.tube(key, px, 3.0 + hs + rs * 0.16, pz, rs, rs * 0.3, rs * 0.32, 18, sh * 1.05, 1, 3)
	c.tube("BST", px, 3.0 + hs + rs * 0.32 + 0.9, pz, rs * 0.3, rs * 0.3, 1.8, 10, 0.8, 1, 3)
	c.tube("BST", px, 3.0 + hs - 0.15, pz, rs + 1.9, rs + 1.9, 0.3, 18, 0.9, 1, 7)
	c.tube("BYL", px, 3.0 + hs + 1.1, pz, rs + 1.85, rs + 1.85, 0.14, 18, 1.0, 1, 1)
	c.slab("BST", px + rs + 0.5, pz, 0.9, 1.1, 0.0, 3.0 + hs, 0.8, SIDES)
	c.solid(px, pz, rs * 1.5, rs * 1.5, -5.0, 3.0 + hs)
	c.solid(px, pz, (rs + 1.9) * 1.45, (rs + 1.9) * 1.45, 3.0 + hs - 0.4, 3.0 + hs)


# ground the hall and its yards need, relative to its centre before the yaw: flat at height y
static func hall_pad(w: float, d: float, h: float) -> Rect2:
	w = maxf(w, 70.0)
	d = maxf(d, 50.0)
	h = maxf(h, 28.0)
	var ap := clampf(clampf(h * 0.62, 23.0, 84.0) * 1.3, 50.0, 110.0)
	return Rect2(-w * 0.5 - 76.0, -d * 0.5 - 62.0, w + 152.0, d + 62.0 + maxf(ap + 10.0, 74.0))


# The assembly hall: a hollow shed w (long side) x d x h with corner towers, a door a frame can
# walk through in the middle of one long side, braced wall bays, cranes on the roof and over
# the apron, annexes and container yards around it, and a process plant on its -X side:
# silos under ribbed headers, a pipe rack along the back with risers over the roof, service
# galleries, a conveyor. At yaw 0 the door faces +Z; yaw must be a multiple of 90 degrees
# (PI/2 turns the door to +X, PI to -Z). y is the floor level.
static func megahall(k, g: Node3D, add_box: Callable, x: float, z: float, w: float, d: float, h: float, y: float, yaw: float, rng: RandomNumberGenerator) -> void:
	var c := Ctx.new(k, g, add_box, rng, Vector3(x, y, z), int(roundf(yaw / HP)), direct)
	w = maxf(w, 70.0)
	d = maxf(d, 50.0)
	h = maxf(h, 28.0)
	var hx := w * 0.5
	var hz := d * 0.5
	var wt := clampf(h * 0.04, 2.5, 5.0)
	var ct := clampf(minf(w, d) * 0.16, 11.0, 26.0)
	var th := h + clampf(h * 0.15, 6.0, 18.0)
	var dw := clampf(w * 0.4, 30.0, 140.0)
	var dh := clampf(h * 0.62, 23.0, 84.0)
	var hw := h - wt
	var ap := clampf(dh * 1.3, 50.0, 110.0)
	var r := rng
	# floor and apron lie just above the pad; the terrain carries the frames
	c.slab("BCG", 0.0, 0.0, w + 6.0, d + 6.0, -6.0, 0.12, 0.9, SIDES | TOP)
	c.slab("BCG", 0.0, hz + 3.0 + ap * 0.5, dw + 90.0, ap, -6.0, 0.08, 0.82, SIDES | TOP)
	c.slab("BHZ", 0.0, hz + 1.6, dw, 3.0, 0.12, 0.2, 1.0, SIDES | TOP)
	for s: float in [-1.0, 1.0]:
		c.slab("BHZ", s * (dw * 0.5 - 1.0), hz + 3.0 + ap * 0.5, 1.6, ap - 6.0, 0.08, 0.16, 1.0, SIDES | TOP)
	# shell: back, sides, door cheeks, lintel, roof
	c.slab("BHW", 0.0, -hz + wt * 0.5, w, wt, 0.0, hw, 1.0, SIDES)
	c.solid(0.0, -hz + wt * 0.5, w, wt, -5.0, hw)
	for s: float in [-1.0, 1.0]:
		c.slab("BHW", s * (hx - wt * 0.5), 0.0, wt, d - 2.0 * wt, 0.0, hw, 1.0, SIDES)
		c.solid(s * (hx - wt * 0.5), 0.0, wt, d - 2.0 * wt, -5.0, hw)
		var fw := (w - dw) * 0.5
		c.slab("BHW", s * (dw * 0.5 + fw * 0.5), hz - wt * 0.5, fw, wt, 0.0, hw, 1.0, SIDES)
		c.solid(s * (dw * 0.5 + fw * 0.5), hz - wt * 0.5, fw, wt, -5.0, hw)
		# door frame
		c.slab("BHZ", s * (dw * 0.5 + 1.2), hz - wt * 0.5, 2.4, wt + 0.8, 0.0, dh + 2.6, 1.0, SIDES)
	c.slab("BHW", 0.0, hz - wt * 0.5, dw, wt, dh, hw, 0.97, SIDES | BOT)
	c.solid(0.0, hz - wt * 0.5, dw, wt, dh, hw)
	c.slab("BHZ", 0.0, hz - wt * 0.5, dw + 4.8, wt + 0.8, dh, dh + 2.6, 1.0, ALL)
	c.slab("BHB", 0.0, 0.0, w + 1.6, d + 1.6, hw, h, 0.95, ALL)
	c.solid(0.0, 0.0, w, d, hw, h, true)
	# door leaves, lifted and stacked under the lintel
	var lh := clampf((dh - 21.0) / 3.0, 0.4, dh * 0.09)
	for i in 3:
		c.slab("BHB", 0.0, hz - wt * 0.5 + (i - 1) * 1.1, dw - 0.6, 0.9, dh - (i + 1) * lh, dh - i * lh + 0.4, 0.8 + 0.1 * i, ALL)
		c.slab("BST", 0.0, hz - wt * 0.5 + (i - 1) * 1.1, dw - 0.2, 1.3, dh - (i + 1) * lh, dh - (i + 1) * lh + 0.7, 0.9, ALL)
	c.solid(0.0, hz - wt * 0.5, dw, 3.4, dh - 3.0 * lh, dh)
	# wall bays: columns, girts, colour bands, ribbon windows, bracing, doors
	var tin := ct * 0.7
	var nl := clampi(int(roundf(hw / 15.0)), 2, 9)
	var gh := hw / nl
	for f in 4:
		var half := hz if f < 2 else hx
		var ln := (w if f < 2 else d) - 2.0 * tin
		var nb := maxi(2, int(roundf(ln / 13.0)))
		var pb := ln / nb
		var door := f == 0
		for i in nb + 1:
			var u := -ln * 0.5 + i * pb
			var yb := 0.0
			if door and absf(u) < dw * 0.5 + 3.4:
				yb = dh + 2.6
			_hb(c, "BST", f, hx, hz, u, 1.7, 0.0, 1.3, yb, hw, 0.95)
		for j in range(1, nl):
			var yg := j * gh
			if door and yg < dh + 3.0:
				var sl := (ln - dw) * 0.5 - 3.4
				for s: float in [-1.0, 1.0]:
					_hb(c, "BST", f, hx, hz, s * (dw * 0.5 + 3.4 + sl * 0.5), sl, 0.0, 0.8, yg - 0.6, yg + 0.6, 0.9)
			else:
				_hb(c, "BST", f, hx, hz, 0.0, ln, 0.0, 0.8, yg - 0.6, yg + 0.6, 0.9)
		# dark base band, accent stripe, top band
		var segs: Array = [[0.0, ln]]
		if door:
			var sl := (ln - dw) * 0.5 - 2.4
			segs = [[-(dw * 0.5 + 2.4 + sl * 0.5), sl], [dw * 0.5 + 2.4 + sl * 0.5, sl]]
		for sg in segs:
			_hb(c, "BHB", f, hx, hz, sg[0], sg[1], 0.0, 0.3, 0.3, gh - 0.6, 0.9)
			_hb(c, "BRD", f, hx, hz, sg[0], sg[1], 0.0, 0.34, gh * 0.55, gh * 0.55 + 1.2, 1.0)
		_hb(c, "BHB", f, hx, hz, 0.0, ln, 0.0, 0.3, hw - 5.0, hw, 0.9)
		_hb(c, "BRD", f, hx, hz, 0.0, ln, 0.0, 0.34, hw - 6.6, hw - 5.4, 1.0)
		for i in nb:
			var uc := -ln * 0.5 + (i + 0.5) * pb
			var in_door := door and absf(uc) < dw * 0.5 + pb * 0.5
			# clerestory and one ribbon of windows lower down
			_hb(c, "BGL", f, hx, hz, uc, pb - 3.4, 0.0, 0.36, hw - 11.0, hw - 7.6, 1.0)
			if not in_door:
				_hb(c, "BGL", f, hx, hz, uc, pb - 3.4, 0.0, 0.36, gh * 1.3, gh * 1.3 + 2.8, 1.0)
				if i % 2 == 0:
					_hb(c, "BGL", f, hx, hz, uc, 2.4, 0.0, 0.32, 0.12, 3.6, 0.6)
					_hb(c, "BST", f, hx, hz, uc, 3.8, 0.0, 1.5, 3.8, 4.05, 0.9)
				elif i % 5 == 1:
					_hb(c, "BHB", f, hx, hz, uc, 8.4, 0.0, 0.5, 0.12, 9.0, 0.7)
					_hb(c, "BHZ", f, hx, hz, uc, 9.6, 0.0, 0.7, 9.0, 9.9, 1.0)
			if i % 3 == 1:
				# X bracing over two levels
				for j in range(1, nl - 1, 2):
					var ya := j * gh + 0.6
					var yb := minf((j + 2) * gh, hw - 5.0) - 0.6
					if in_door and ya < dh + 3.0:
						continue
					c.beam("BST", _hp(f, hx, hz, uc - pb * 0.5 + 0.9, 0.7, ya), _hp(f, hx, hz, uc + pb * 0.5 - 0.9, 0.7, yb), 0.8, 0.5, 0.85)
					c.beam("BST", _hp(f, hx, hz, uc + pb * 0.5 - 0.9, 0.7, ya), _hp(f, hx, hz, uc - pb * 0.5 + 0.9, 0.7, yb), 0.8, 0.5, 0.85)
	# corner towers: lift and stair cores, with a red escape stair and pipe risers outside
	for sx: float in [-1.0, 1.0]:
		for sz: float in [-1.0, 1.0]:
			var tx := sx * (hx - ct * 0.5 + ct * 0.3)
			var tz := sz * (hz - ct * 0.5 + ct * 0.3)
			c.slab("BCG", tx, tz, ct, ct, -6.0, th, 0.96, SIDES)
			c.slab("BCG", tx, tz, ct + 1.6, ct + 1.6, th, th + 1.4, 1.04, ALL)
			c.slab("BHB", tx, tz, ct * 0.55, ct * 0.55, th + 1.4, th + 7.0, 0.9, SHELL)
			c.slab("BST", tx, tz, 0.5, 0.5, th + 7.0, th + 22.0, 0.8, SHELL)
			c.solid(tx, tz, ct, ct, -5.0, th + 1.4)
			c.solid(tx, tz, ct * 0.55, ct * 0.55, th + 1.4, th + 7.0)
			# a slit of glass and a line for every storey on the two outer faces
			c.slab("BGL", tx + sx * (ct * 0.5 + 0.08), tz, 0.16, ct * 0.24, 4.0, th - 3.0, 1.0, SIDES)
			c.slab("BGL", tx, tz + sz * (ct * 0.5 + 0.08), ct * 0.24, 0.16, 4.0, th - 3.0, 1.0, SIDES)
			var ns := int((th - 4.0) / FH)
			for i in ns:
				var ya := 4.0 + i * FH
				c.slab("BCG", tx + sx * (ct * 0.5 + 0.2), tz, 0.4, ct * 0.34, ya, ya + 0.6, 1.02, ALL)
				c.slab("BCG", tx, tz + sz * (ct * 0.5 + 0.2), ct * 0.34, 0.4, ya, ya + 0.6, 1.02, ALL)
			_stair(c, tx + sx * ct * 0.5, tz - sz * ct * 0.18, sx, 0.0, 0.12, th - 2.0)
			# risers on the end wall next to the tower
			for j in 3:
				var rr := 1.2 if j == 1 else 0.8
				var px := tx - sx * (ct * 0.5 + 2.4 + j * 3.2)
				var pz := sz * (hz + rr + 0.9)
				c.cyl("BRD" if j == 1 else "BST", rr, rr, hw * 0.9, Vector3(px, hw * 0.45, pz), 8, 1.0)
				c.slab("BST", px, sz * (hz + 0.5), 0.8, 1.0, hw * 0.9 - 1.0, hw * 0.9, 0.8, ALL)
				for q in int(hw / 14.0):
					c.slab("BST", px, sz * (hz + 0.45), rr * 2.0 + 0.8, 0.9, 6.0 + q * 14.0, 6.5 + q * 14.0, 0.8, ALL)
	# roof: parapet, monitors, door hoist housing, vents, plant, tower cranes
	for s: float in [-1.0, 1.0]:
		c.slab("BHB", 0.0, s * (hz + 0.3), w + 1.6, 1.0, h, h + 1.6, 0.9, SHELL)
		c.slab("BHB", s * (hx + 0.3), 0.0, 1.0, d - 0.4, h, h + 1.6, 0.9, SHELL)
	var nm := maxi(2, int(roundf(d / 42.0)))
	var mlen := w - 2.0 * ct - 18.0
	for i in nm:
		var mz := (i + 0.5 - nm * 0.5) * (d - 30.0) / nm - 6.0
		c.slab("BHW", 0.0, mz, mlen, 10.0, h, h + 4.4, 1.0, SHELL)
		c.slab("BHB", 0.0, mz, mlen + 1.0, 11.0, h + 4.4, h + 5.0, 0.9, ALL)
		for s: float in [-1.0, 1.0]:
			c.slab("BGL", 0.0, mz + s * 5.06, mlen - 4.0, 0.16, h + 1.4, h + 3.6, 1.2, SIDES)
		c.solid(0.0, mz, mlen, 10.0, h, h + 5.0)
	c.slab("BHB", 0.0, hz - 8.0, dw + 14.0, 9.0, h, h + 7.0, 0.85, SHELL)
	c.solid(0.0, hz - 8.0, dw + 14.0, 9.0, h, h + 7.0)
	for i in 5:
		c.slab("BST", (i - 2) * dw * 0.24, hz - 8.0, 3.0, 10.0, h + 7.0, h + 9.4, 0.9, SHELL)
	for i in 10:
		var px := r.randf_range(-0.42, 0.42) * w
		var pz := r.randf_range(-0.4, 0.3) * d
		if i % 3 == 0:
			c.cyl("BST", 1.6, 1.9, 7.0, Vector3(px, h + 3.5, pz), 10, 0.9)
		else:
			c.slab("BST", px, pz, r.randf_range(4.0, 8.0), r.randf_range(3.0, 5.0), h, h + r.randf_range(2.0, 3.6), r.randf_range(0.8, 1.2), SHELL)
	var cm := clampf(h * 0.36, 13.0, 46.0)
	_tower_crane(c, -w * 0.3, -hz + 14.0, h, cm, clampf(d * 0.36, 18.0, 60.0), 0.0, 1.0)
	_tower_crane(c, w * 0.31, -hz + 16.0, h, cm * 0.8, clampf(w * 0.16, 16.0, 56.0), -1.0, 0.0)
	if w >= 110.0:
		_tower_crane(c, hx - ct - 16.0, hz - 26.0, h, cm * 1.1, clampf(w * 0.17, 18.0, 58.0), -1.0, 0.0)
	# goliath crane straddling the apron in front of the door
	var gz := hz + ap * 0.58
	var gy := dh * 0.82
	var gx := dw * 0.5 + 15.0
	for s: float in [-1.0, 1.0]:
		for t: float in [-1.0, 1.0]:
			c.beam("BYL", Vector3(s * gx, 2.4, gz + t * 10.0), Vector3(s * gx, gy, gz + t * 2.6), 2.4, 2.4, 1.0)
			c.slab("BST", s * gx, gz + t * 10.0, 4.4, 6.5, 0.1, 2.6, 0.8, SHELL)
		c.slab("BYL", s * gx, gz, 2.0, 21.0, 2.4, 3.6, 0.95, ALL)
		c.solid(s * gx, gz, 4.4, 26.0, 0.0, gy)
		c.slab("BST", s * gx, hz + 3.0 + ap * 0.5, 0.9, ap - 4.0, 0.08, 0.4, 0.8, SIDES | TOP)
	for t: float in [-1.0, 1.0]:
		c.slab("BYL", 0.0, gz + t * 3.2, 2.0 * gx + 16.0, 2.2, gy, gy + 6.0, 1.0, ALL)
	c.slab("BST", 0.0, gz, 2.0 * gx + 12.0, 4.2, gy + 6.0, gy + 6.3, 0.9, ALL)
	c.slab("BHB", gx * 0.7, gz, 9.0, 8.0, gy + 6.3, gy + 10.5, 0.9, SHELL)
	c.solid(0.0, gz, 2.0 * gx + 16.0, 8.6, gy, gy + 6.3)
	var gt := -gx * 0.35
	c.slab("BST", gt, gz, 8.0, 9.4, gy - 2.6, gy + 0.2, 0.9, ALL)
	c.slab("BST", gt, gz, 0.3, 0.3, gy - 2.6 - dh * 0.3, gy - 2.6, 0.6, SIDES)
	c.slab("BHZ", gt, gz, 2.6, 2.6, gy - 5.4 - dh * 0.3, gy - 2.6 - dh * 0.3, 1.0, ALL)
	# inside: a pale liner so the hall reads without lamps, a gallery along the back wall
	c.slab("BHL", 0.0, -hz + wt + 0.15, w - 2.0 * wt, 0.3, 0.12, hw, 1.0, PZ)
	for s: float in [-1.0, 1.0]:
		c.slab("BHL", s * (hx - wt - 0.15), 0.0, 0.3, d - 2.0 * wt, 0.12, hw, 0.96, NX if s > 0.0 else PX)
		c.slab("BHL", s * (dw * 0.5 + (w - dw) * 0.25 - wt * 0.5), hz - wt - 0.15, (w - dw) * 0.5 - wt, 0.3, 0.12, hw, 0.92, NZ)
	c.slab("BHL", 0.0, 0.0, w - 2.0 * wt, d - 2.0 * wt, hw - 0.3, hw, 0.85, BOT)
	var gy0 := 12.0
	c.slab("BST", 0.0, -hz + wt + 3.0, w - 2.0 * wt - 2.0, 6.0, gy0 - 0.5, gy0, 0.9, ALL)
	c.slab("BYL", 0.0, -hz + wt + 5.9, w - 2.0 * wt - 2.0, 0.14, gy0 + 1.1, gy0 + 1.24, 1.0, ALL)
	var ng := maxi(4, int((w - 2.0 * wt) / 13.0))
	for i in ng + 1:
		var u := -(w - 2.0 * wt - 4.0) * 0.5 + i * (w - 2.0 * wt - 4.0) / ng
		c.slab("BST", u, -hz + wt + 5.7, 0.5, 0.5, 0.12, gy0 - 0.5, 0.85, SIDES)
		c.slab("BYL", u, -hz + wt + 5.9, 0.12, 0.12, gy0, gy0 + 1.2, 1.0, SIDES)
	c.solid(0.0, -hz + wt + 3.0, w - 2.0 * wt - 2.0, 6.0, gy0 - 0.5, gy0)
	# site cabins stacked beside the door, crates along the side walls
	for s: float in [-1.0, 1.0]:
		var qx := s * (dw * 0.5 + 16.0)
		for i in 3:
			for j in 2:
				c.slab("BK3", qx + j * s * 12.6, hz - wt - 4.0, 12.2, 2.9, 0.12 + i * 2.8, 0.12 + (i + 1) * 2.8 - 0.1, 1.0 + 0.06 * i, SHELL)
				c.slab("BGL", qx + j * s * 12.6, hz - wt - 5.5, 8.0, 0.12, 0.12 + i * 2.8 + 1.0, 0.12 + i * 2.8 + 2.0, 1.4, NZ)
		c.solid(qx + s * 6.3, hz - wt - 4.0, 25.0, 2.9, 0.0, 8.5)
		for i in 5:
			var cz2 := -hz * 0.6 + i * hz * 0.26
			var n := 1 + r.randi() % 3
			for q2 in n:
				c.slab(["BK1", "BK2", "BK3"][r.randi() % 3], s * (hx - wt - 4.0), cz2, 2.44, 12.2, 0.12 + q2 * 2.6, 0.12 + (q2 + 1) * 2.6 - 0.08, r.randf_range(0.8, 1.1), SHELL)
			c.solid(s * (hx - wt - 4.0), cz2, 2.44, 12.2, 0.0, n * 2.6)
	# crane rails on brackets, two bridge cranes, a hull on the stocks
	var ry := hw * 0.84
	for s: float in [-1.0, 1.0]:
		c.slab("BST", 0.0, s * (hz - wt - 1.3), w - 2.0 * wt, 2.6, ry - 2.2, ry, 0.8, ALL)
		var nbr := maxi(2, int(roundf((w - 2.0 * tin) / 13.0)))
		for i in nbr + 1:
			var u := -(w - 2.0 * tin) * 0.5 + i * (w - 2.0 * tin) / nbr
			if s > 0.0 and absf(u) < dw * 0.5 + 2.0:
				continue
			c.slab("BST", u, s * (hz - wt - 0.8), 1.6, 1.6, 0.12, ry - 2.2, 0.85, ALL)
	for bx: float in [-w * 0.24, w * 0.2]:
		c.slab("BYL", bx - 2.2, 0.0, 1.8, d - 2.0 * wt - 1.0, ry, ry + 4.6, 1.0, ALL)
		c.slab("BYL", bx + 2.2, 0.0, 1.8, d - 2.0 * wt - 1.0, ry, ry + 4.6, 1.0, ALL)
		for s: float in [-1.0, 1.0]:
			c.slab("BST", bx, s * (hz - wt - 1.3), 9.0, 2.8, ry, ry + 2.4, 0.8, ALL)
		var tz := r.randf_range(-0.25, 0.25) * d
		var cl := r.randf_range(0.2, 0.45) * ry
		c.slab("BST", bx, tz, 6.4, 7.0, ry + 4.6, ry + 6.6, 0.9, ALL)
		c.slab("BST", bx, tz, 0.3, 0.3, ry - cl, ry + 4.6, 0.6, SIDES)
		c.slab("BHZ", bx, tz, 2.4, 2.4, ry - cl - 3.0, ry - cl, 1.0, ALL)
	var hl := w * 0.46
	var hb := minf(d * 0.3, 46.0)
	var hh := minf(h * 0.3, 36.0)
	var kx := -w * 0.08
	var kz := -d * 0.1
	var nk := maxi(4, int(hl / 12.0))
	for i in nk:
		var u := kx + (i + 0.5 - nk * 0.5) * hl / nk
		# keel block, floor beam and a pair of frames
		c.slab("BCG", u, kz, 4.0, hb * 0.5, 0.12, 3.0, 0.9, SHELL)
		c.slab("BRD", u, kz, 1.4, hb, 5.0, 6.6, 0.95, ALL)
		var fh := hh * (0.55 + 0.45 * sin(PI * (i + 0.5) / nk))
		for s: float in [-1.0, 1.0]:
			c.slab("BRD", u, kz + s * hb * 0.5, 1.4, 1.6, 5.0, 5.0 + fh, 0.95, ALL)
		if i % 2 == 0:
			c.slab("BRD", u, kz, 1.2, hb, 5.0 + fh * 0.55, 5.0 + fh * 0.55 + 1.2, 0.9, ALL)
	c.slab("BST", kx, kz, hl, hb * 0.34, 3.0, 5.0, 0.8, ALL)
	for s: float in [-1.0, 1.0]:
		c.slab("BRD", kx - hl * 0.06, kz + s * (hb * 0.5 + 0.5), hl * 0.82, 0.5, 5.0, 5.0 + hh * 0.3, 0.85, ALL)
		c.slab("BRD", kx - hl * 0.14, kz + s * (hb * 0.5 + 0.5), hl * 0.56, 0.5, 5.0 + hh * 0.3, 5.0 + hh * 0.5, 0.92, ALL)
		c.slab("BRD", kx - hl * 0.2, kz + s * (hb * 0.5 + 0.5), hl * 0.3, 0.5, 5.0 + hh * 0.5, 5.0 + hh * 0.68, 0.8, ALL)
		c.slab("BST", kx - hl * 0.06, kz + s * (hb * 0.5 + 0.9), hl * 0.82, 0.5, 5.0 + hh * 0.3 - 0.4, 5.0 + hh * 0.3, 0.8, ALL)
		c.solid(kx - hl * 0.06, kz + s * hb * 0.5, hl * 0.82, 1.8, 0.0, 5.0 + hh * 0.3)
		_scaffold(c, kx + hl * 0.3, kz + s * (hb * 0.5 + 6.0), hh * 0.9)
		_scaffold(c, kx - hl * 0.42, kz + s * (hb * 0.5 + 6.0), hh * 0.6)
	c.slab("BST", kx - hl * 0.16, kz, hl * 0.4, hb, 5.0 + hh * 0.52, 5.0 + hh * 0.52 + 0.6, 0.75, ALL)
	c.solid(kx - hl * 0.16, kz, hl * 0.4, hb, 5.0 + hh * 0.52 - 0.6, 5.0 + hh * 0.52 + 0.6)
	c.solid(kx, kz, hl, hb * 0.5, 0.0, 5.0)
	# annexes behind and beside the hall
	var nax := maxi(2, int(w / 62.0))
	for i in nax:
		var aw := r.randf_range(30.0, 46.0)
		var ad := r.randf_range(14.0, 21.0)
		_annex(c, (i + 0.5 - nax * 0.5) * (w - 2.0 * ct - 20.0) / nax, -hz - 9.0 - ad * 0.5, aw, ad, r.randf_range(9.0, 17.0), 1)
	for az: float in [-0.24, 0.02, 0.26]:
		var aw := r.randf_range(18.0, 28.0)
		var ad := r.randf_range(24.0, minf(34.0, d * 0.22))
		_annex(c, hx + 12.0 + aw * 0.5, az * d, aw, ad, r.randf_range(9.0, 18.0), 2)
	# process plant on the -X side: a battery of silos under ribbed headers, a catwalk between the rows
	var rp := clampf(h * 0.04, 2.0, 4.6)
	var rs := clampf(h * 0.085, 5.0, 10.0)
	var sz0 := -hz + rs + 6.0
	var sn := clampi(int((d * 0.2 - 20.0 - rs - sz0) / (rs * 2.5)) + 1, 2, 4)
	var sx0 := -hx - 11.0 - rs
	var sx1 := sx0 - rs * 2.35
	var zr := -hz - 37.0                       # pipe rack behind the annexes
	var ry0 := clampf(h * 0.22, 14.0, 22.0)
	var top0 := 0.0
	var top1 := 0.0
	var low0 := 1e9
	for row in 2:
		for i in sn:
			var hs := h * (r.randf_range(0.42, 0.66) if row == 0 else r.randf_range(0.3, 0.5))
			_silo(c, ["BHW", "BHW", "BRS", "BHB"][r.randi() % 4], sx0 if row == 0 else sx1, sz0 + i * rs * 2.5, rs, hs, r.randf_range(0.92, 1.05))
			if row == 0:
				top0 = maxf(top0, 3.0 + hs)
				low0 = minf(low0, 3.0 + hs)
			else:
				top1 = maxf(top1, 3.0 + hs)
	var z_a := sz0 - 2.0
	var z_b := sz0 + (sn - 1) * rs * 2.5 + rs + rp * 1.6
	var hy := minf(top0 + rs * 0.32 + 2.6 + rp, hw - rp * 1.8)
	_pipe(c, "BHB", 2, sx0, hy, (z_a + z_b) * 0.5, z_b - z_a, rp)
	for i in sn:
		c.tube("BHB", sx0, hy - rp * 0.5, sz0 + i * rs * 2.5, rp * 0.42, rp * 0.42, rp + 8.0, 10, 0.85, 1, 1)
	_geo(c, "BHB", sx0, hy, z_b, rp * 1.3, 0.9)
	_pipe(c, "BHB", 0, (sx0 - hx) * 0.5, hy, z_b, -hx - sx0, rp)
	c.tube("BST", -hx - 0.9, hy, z_b, rp * 1.5, rp * 1.5, 1.8, 14, 0.8, 0, 7)
	# the far row feeds the rack: header, drop, joint
	var hy2 := top1 + rs * 0.32 + 2.2 + rp * 0.8
	var rk := ry0 + 1.2 + rp * 0.8
	_pipe(c, "BRS", 2, sx1, hy2, (zr + z_b - rs) * 0.5, z_b - rs - zr, rp * 0.8)
	for i in sn:
		c.tube("BRS", sx1, hy2 - rp * 0.4, sz0 + i * rs * 2.5, rp * 0.36, rp * 0.36, rp + 7.0, 10, 0.85, 1, 1)
	_geo(c, "BRS", sx1, hy2, zr, rp * 1.05, 0.9)
	_pipe(c, "BRS", 1, sx1, (hy2 + rk) * 0.5, zr, hy2 - rk, rp * 0.8)
	_geo(c, "BRS", sx1, rk, zr, rp * 1.05, 0.9)
	# catwalk between the rows at shoulder height, stair up from the ground
	var cy := minf(low0, top1) if top1 > 0.0 else low0
	var cwx := (sx0 + sx1) * 0.5
	c.slab("BST", cwx, (z_a + z_b - rs) * 0.5, 2.4, z_b - rs - z_a + 6.0, cy - 0.3, cy, 0.9, ALL)
	for s: float in [-1.0, 1.0]:
		c.slab("BYL", cwx + s * 1.15, (z_a + z_b - rs) * 0.5, 0.12, z_b - rs - z_a + 6.0, cy + 1.05, cy + 1.17, 1.0, ALL)
	c.solid(cwx, (z_a + z_b - rs) * 0.5, 2.4, z_b - rs - z_a + 6.0, cy - 0.3, cy)
	_stair(c, cwx - 1.2, z_a - 3.0, 0.0, -1.0, 0.12, cy)
	# pipe rack along the back, clear of the annex roofs
	var rx0 := sx1
	var rx1 := hx + 6.0
	var rl := rx1 - rx0
	var rxm := (rx0 + rx1) * 0.5
	var nbt := maxi(3, int(roundf(rl / 22.0)))
	for i in nbt + 1:
		var ux := rx0 + 3.0 + (rl - 6.0) * i / nbt
		for s: float in [-1.0, 1.0]:
			c.slab("BST", ux, zr + s * 4.6, 0.9, 0.9, 0.0, ry0, 0.9, SIDES)
			c.beam("BST", Vector3(ux, ry0 - 5.0, zr + s * 4.6), Vector3(ux, ry0 - 0.4, zr + s * 1.4), 0.5, 0.5, 0.85)
		c.slab("BST", ux, zr, 1.0, 10.6, ry0 - 0.2, ry0 + 1.0, 0.9, ALL)
	for s: float in [-1.0, 1.0]:
		c.slab("BST", rxm, zr + s * 4.6, rl, 0.7, ry0 + 0.2, ry0 + 1.2, 0.85, ALL)
	c.slab("BST", rxm, zr + 3.4, rl, 2.2, ry0 + 1.0, ry0 + 1.2, 0.7, ALL)
	c.slab("BYL", rxm, zr + 4.5, rl, 0.12, ry0 + 2.25, ry0 + 2.37, 1.0, ALL)
	_pipe(c, "BRS", 0, rxm, rk, zr - 1.2, rl, rp * 0.8)
	c.tube("BST", rxm, ry0 + 1.2 + 0.9, zr + 1.8, 0.9, 0.9, rl, 10, 0.9, 0, 1)
	c.tube("BRD", rxm, ry0 + 1.2 + 0.7, zr + 0.2, 0.7, 0.7, rl, 10, 1.0, 0, 1)
	c.solid(rxm, zr, rl, 10.6, ry0, ry0 + 1.2)
	# two risers leave the rack between annexes, climb the back wall and bend over the parapet
	var rp2 := rp * 0.7
	var apit := (w - 2.0 * ct - 20.0) / nax
	for j in [1, nax - 1]:
		var xb: float = (j - nax * 0.5) * apit
		var zw := -hz - rp2 - 1.6
		_pipe(c, "BHB", 2, xb, rk, (zr - 1.2 + zw) * 0.5, zw - zr + 1.2, rp2)
		_geo(c, "BHB", xb, rk, zw, rp2 * 1.3, 0.9)
		_pipe(c, "BHB", 1, xb, (rk + h + 4.0) * 0.5, zw, h + 4.0 - rk, rp2)
		_geo(c, "BHB", xb, h + 4.0, zw, rp2 * 1.3, 0.9)
		_pipe(c, "BHB", 2, xb, h + 4.0, (zw - hz + 9.0) * 0.5, -hz + 9.0 - zw, rp2)
		c.slab("BST", xb, -hz + 12.0, 7.0, 6.0, h, h + 6.5, 0.9, SHELL)
		c.solid(xb, -hz + 12.0, 7.0, 6.0, h, h + 6.5)
		var yq := rk + 8.0
		while yq < hw - 2.0:
			c.slab("BST", xb, -hz - 0.9, rp2 * 2.8, 1.8, yq, yq + 0.6, 0.8, ALL)
			yq += 13.0
		if nax <= 2:
			break
	# service gallery along the back wall and the +X wall
	var gyc := hw * 0.52
	var gln := w - 2.0 * tin - 4.0
	_hb(c, "BST", 1, hx, hz, 0.0, gln, 1.4, 4.6, gyc - 0.3, gyc, 0.9)
	_hb(c, "BYL", 1, hx, hz, 0.0, gln, 4.5, 4.62, gyc + 1.08, gyc + 1.2, 1.0)
	c.solid(0.0, -hz - 3.0, gln, 3.2, gyc - 0.3, gyc)
	var gnb := maxi(2, int(roundf(gln / 13.0)))
	for i in gnb + 1:
		var u := -gln * 0.5 + gln * i / gnb
		c.beam("BST", _hp(1, hx, hz, u, 1.3, gyc - 4.2), _hp(1, hx, hz, u, 4.5, gyc - 0.3), 0.45, 0.45, 0.85)
		_hb(c, "BYL", 1, hx, hz, u, 0.12, 4.5, 4.62, gyc, gyc + 1.2, 1.0)
	var gy2 := hw * 0.34
	var gl2 := d - 2.0 * tin - 4.0
	_hb(c, "BST", 2, hx, hz, 0.0, gl2, 1.4, 4.6, gy2 - 0.3, gy2, 0.9)
	_hb(c, "BYL", 2, hx, hz, 0.0, gl2, 4.5, 4.62, gy2 + 1.08, gy2 + 1.2, 1.0)
	c.solid(hx + 3.0, 0.0, 3.2, gl2, gy2 - 0.3, gy2)
	var gn2 := maxi(2, int(roundf(gl2 / 13.0)))
	for i in gn2 + 1:
		var u := -gl2 * 0.5 + gl2 * i / gn2
		c.beam("BST", _hp(2, hx, hz, u, 1.3, gy2 - 4.2), _hp(2, hx, hz, u, 4.5, gy2 - 0.3), 0.45, 0.45, 0.85)
	# conveyor gallery climbing from a hopper house to the -X wall
	var cvz := d * 0.22
	var ca := Vector3(-hx - 62.0, 7.0, cvz)
	var cb := Vector3(-hx + 0.5, h * 0.42, cvz)
	c.beam("BHW", ca, cb, 4.6, 4.2, 0.95)
	c.beam("BHB", ca + Vector3(0, 2.3, 0), cb + Vector3(0, 2.3, 0), 5.2, 0.5, 0.9)
	for t: float in [0.3, 0.64]:
		var tp := ca.lerp(cb, t)
		for s: float in [-1.0, 1.0]:
			c.slab("BST", tp.x, tp.z + s * 2.6, 0.7, 0.7, 0.0, tp.y - 2.0, 0.9, SIDES)
		c.slab("BST", tp.x, tp.z, 0.7, 5.9, tp.y - 2.8, tp.y - 2.1, 0.9, ALL)
		c.beam("BST", Vector3(tp.x, 1.0, tp.z - 2.6), Vector3(tp.x, tp.y - 3.0, tp.z + 2.6), 0.4, 0.4, 0.85)
	for i in 4:
		var tp := ca.lerp(cb, (i + 0.5) / 4.0)
		c.solid(tp.x, tp.z, (cb.x - ca.x) / 4.0, 4.6, tp.y - 2.1, tp.y + 2.1 + (cb.y - ca.y) / 8.0)
	c.slab("BHW", ca.x - 3.0, cvz, 13.0, 12.0, 0.0, 10.0, 1.0, SHELL)
	c.slab("BHB", ca.x - 3.0, cvz, 14.0, 13.0, 10.0, 10.7, 0.9, ALL)
	c.tilt("BHB", Vector3(9.0, 5.0, 9.0), Vector3(ca.x - 3.0, 13.2, cvz), Vector3.ZERO, 0.85, {"bx": 0.35, "bz": 0.35})
	c.solid(ca.x - 3.0, cvz, 13.0, 12.0, -5.0, 10.7)
	# inside: two ribbed mains high on the back wall, pressure vessels in the back corners
	var ri := rp * 0.75
	var piz := -hz + wt + ri + 1.5
	for iy in 2:
		var py := hw * (0.5 + 0.17 * iy)
		_pipe(c, "BHB" if iy == 0 else "BRS", 0, 0.0, py, piz, w - 2.0 * wt - 1.0, ri, 0.95)
		for i in ng + 1:
			if i % 2 == 0:
				var u := -(w - 2.0 * wt - 4.0) * 0.5 + i * (w - 2.0 * wt - 4.0) / ng
				c.slab("BST", u, piz - 0.4, 0.9, ri * 2.0 + 1.6, py - ri - 0.7, py - ri, 0.8, ALL)
	var rv := clampf(h * 0.06, 3.5, 7.0)
	var vz := -hz + wt + 8.0 + rv
	for vx: float in [-hx + wt + rv + 9.0, -hx + wt + rv * 3.4 + 10.0, hx - wt - rv - 9.0]:
		var hv := hw * r.randf_range(0.36, 0.56)
		c.tube("BCG", vx, 1.0, vz, rv * 0.9, rv * 0.9, 2.0, 16, 0.9, 1, 1)
		c.tube("BHB" if vx < 0.0 else "BRS", vx, 2.0 + hv * 0.5, vz, rv, rv, hv, 16, 1.0, 1, 1)
		for i in 4:
			c.tube("BST", vx, 2.0 + hv * (i + 0.5) / 4.0, vz, rv + 0.25, rv + 0.25, 0.4, 16, 0.85, 1, 7)
		c.tube("BHB" if vx < 0.0 else "BRS", vx, 2.0 + hv + rv * 0.2, vz, rv, rv * 0.35, rv * 0.4, 16, 1.03, 1, 3)
		c.tube("BST", vx, (2.0 + hv + rv * 0.4 + hw * 0.5) * 0.5, vz, rv * 0.3, rv * 0.3, maxf(hw * 0.5 - (2.0 + hv + rv * 0.4), 0.5), 10, 0.85, 1, 1)
		c.solid(vx, vz, rv * 1.5, rv * 1.5, 0.0, 2.0 + hv)
	# container yards on both sides of the apron and behind the hall, one with a gantry
	var yx := dw * 0.5 + 45.0 + 20.0
	_yard(c, yx, hz + 30.0, 3, 6, true, 5)
	_yard(c, yx, hz + 60.0, 3, 8, true, 4)
	_yard(c, -yx - 4.0, hz + 36.0, 3, 9, false, 5)
	_yard(c, -yx - 44.0, hz + 36.0, 3, 6, false, 3)
	_yard(c, hx + 52.0, -hz * 0.5 - 30.0, 3, 6, false, 4)
	_yard(c, -hx * 0.5, -hz - 52.0, 4, 5, true, 4)
	for s: float in [-1.0, 1.0]:
		for t: float in [-1.0, 1.0]:
			c.slab("BYL", yx + t * 17.0, hz + 30.0 + s * 10.6, 1.0, 1.0, 0.1, 19.0, 1.0, SIDES)
		c.slab("BYL", yx, hz + 30.0 + s * 10.6, 36.0, 1.2, 0.1, 1.4, 0.9, ALL)
		c.solid(yx, hz + 30.0 + s * 10.6, 36.0, 1.4, 0.0, 19.0)
	for t: float in [-1.0, 1.0]:
		c.slab("BYL", yx + t * 17.0, hz + 30.0, 1.6, 23.0, 19.0, 21.4, 1.0, ALL)
	c.slab("BST", yx, hz + 30.0, 36.0, 3.0, 21.4, 21.8, 0.9, ALL)
	c.slab("BHB", yx + 6.0, hz + 30.0, 4.0, 4.0, 18.0, 21.0, 0.9, ALL)
	# flood-light masts at the corners of the apron
	for s: float in [-1.0, 1.0]:
		var px := s * (dw * 0.5 + 42.0)
		var pz := hz + ap - 4.0
		c.slab("BST", px, pz, 0.7, 0.7, 0.0, 34.0, 0.8, SIDES)
		c.slab("BST", px, pz, 6.0, 0.6, 34.0, 36.2, 0.8, ALL)
		c.slab("BGL", px, pz - 0.36, 5.4, 0.12, 34.3, 35.9, 3.0, NZ)
	_done(c)


# ------------------------------------------------------------------ skyline
# A platform city on giant pylons, far out on the horizon: a deck `span` long with a jagged
# skyline on top (highest point h above y), blocks hanging underneath, rail lines running
# off both ends on slender piers, cables, a scatter of lit windows. Meant to be seen from
# 1.5 km and more as a silhouette: no collision, about 130 boxes. Its long side turns to
# face the map origin unless a yaw is given.
static func skyframe(k, g: Node3D, x: float, z: float, span: float, h: float, y: float, rng: RandomNumberGenerator, yaw: float = INF) -> void:
	var r := rng
	if is_inf(yaw):
		yaw = atan2(x, z)
	var bs := Basis(Vector3.UP, yaw)
	var o := Vector3(x, y, z)
	var rot := Vector3(0, yaw, 0)
	var ss := maxf(span, 200.0)
	h = maxf(h, 120.0)
	var n := [0]
	# box in the frame of the deck: X along the span, -Z toward the viewer
	var put := func(key: String, sz: Vector3, lp: Vector3, t: Dictionary = {}, sh: float = 1.0) -> void:
		k.box(g, key, sz, o + bs * lp, rot, t, sh)
		n[0] += 1
	var rod := func(key: String, a: Vector3, b: Vector3, th: float, sh: float = 1.0) -> void:
		var pa: Vector3 = o + bs * a
		var pb: Vector3 = o + bs * b
		var yv := (pb - pa).normalized()
		var xv := yv.cross(Vector3.UP)
		if xv.length_squared() < 1e-4:
			xv = Vector3.RIGHT
		xv = xv.normalized()
		k.box(g, key, Vector3(th, pa.distance_to(pb), th), (pa + pb) * 0.5, Basis(xv, yv, xv.cross(yv)).get_euler(), {}, sh)
		n[0] += 1
	var yd := h * r.randf_range(0.44, 0.54)
	var td := h * 0.1
	var dz := ss * 0.14
	var ytop := yd + td
	# pylons: two splayed legs, a tie and a head each
	var np := 3 if ss < 700.0 else 4
	for i in np:
		var px := lerpf(-ss * 0.36, ss * 0.36, float(i) / (np - 1)) + r.randf_range(-0.02, 0.02) * ss
		var pw := ss * 0.034
		for s: float in [-1.0, 1.0]:
			put.call("BSK", Vector3(pw, yd + 90.0, pw * 1.2), Vector3(px, (yd - 90.0) * 0.5, s * dz * 0.34), {"bx": 1.5, "bz": 1.7}, 1.0)
		put.call("BSK", Vector3(pw * 0.6, pw * 0.7, dz * 0.8), Vector3(px, yd * 0.52, 0), {}, 0.9)
		put.call("BSK", Vector3(pw * 2.3, td * 0.8, dz * 1.04), Vector3(px, yd - td * 0.4, 0), {"bx": 0.6}, 0.95)
	# deck and keel
	put.call("BSK", Vector3(ss, td, dz), Vector3(0, yd + td * 0.5, 0), {}, 1.0)
	put.call("BSK", Vector3(ss * 0.86, td * 0.7, dz * 0.55), Vector3(0, yd - td * 0.35, 0), {"bx": 0.9, "bz": 0.55}, 0.9)
	# the city on top
	var nb := 16 + r.randi() % 6
	var tall := r.randi() % nb
	var peak := Vector3(0, h, 0)
	var room := h - ytop
	for i in nb:
		var bx := r.randf_range(-0.47, 0.47) * ss
		var bw := ss * r.randf_range(0.02, 0.08)
		var bd := bw * r.randf_range(0.7, 1.5)
		var bh := room * (0.08 + 0.72 * pow(r.randf(), 1.8))
		if i == tall:
			bh = room
			peak = Vector3(bx, h, 0)
		var bz := r.randf_range(-0.3, 0.3) * dz
		if i % 5 == 3:
			k.cyl(g, "BSK", bw * 0.5, bw * 0.5, bh, o + bs * Vector3(bx, ytop + bh * 0.5, bz), Vector3.ZERO, 8, 0.95)
			n[0] += 1
		else:
			put.call("BSK", Vector3(bw, bh, bd), Vector3(bx, ytop + bh * 0.5, bz), {"tx": 0.8} if r.randf() < 0.3 else {}, r.randf_range(0.85, 1.0))
		if bh > room * 0.45:
			put.call("BSK", Vector3(bw * 0.1, bh * 0.3, bw * 0.1), Vector3(bx, ytop + bh * 1.15, bz), {}, 0.9)
		for q in 1 + r.randi() % 3:
			put.call("BLT", Vector3(bw * r.randf_range(0.2, 0.6), maxf(room * 0.012, 2.5), 1.0), Vector3(bx + r.randf_range(-0.2, 0.2) * bw, ytop + bh * r.randf_range(0.15, 0.9), bz - bd * 0.5 - 0.8), {}, 1.0)
	for i in 2:
		var bx := r.randf_range(-0.3, 0.3) * ss
		put.call("BSK", Vector3(ss * r.randf_range(0.12, 0.2), room * 0.1, dz * 0.3), Vector3(bx, ytop + room * r.randf_range(0.3, 0.62), r.randf_range(-0.2, 0.2) * dz), {}, 0.95)
	# a second, shorter tier above the deck on four legs
	var t2x := r.randf_range(-0.2, 0.2) * ss
	var t2y := ytop + room * r.randf_range(0.32, 0.44)
	var t2l := ss * r.randf_range(0.34, 0.46)
	put.call("BSK", Vector3(t2l, td * 0.6, dz * 0.8), Vector3(t2x, t2y, 0), {"bx": 0.92}, 1.0)
	for s: float in [-1.0, 1.0]:
		for t: float in [-1.0, 1.0]:
			put.call("BSK", Vector3(ss * 0.016, t2y - ytop, ss * 0.016), Vector3(t2x + s * t2l * 0.42, (t2y + ytop) * 0.5, t * dz * 0.3), {}, 0.95)
	for i in 5:
		var bw := ss * r.randf_range(0.02, 0.05)
		var bh := (h - t2y) * r.randf_range(0.25, 0.8)
		put.call("BSK", Vector3(bw, bh, bw), Vector3(t2x + r.randf_range(-0.45, 0.45) * t2l, t2y + td * 0.3 + bh * 0.5, r.randf_range(-0.25, 0.25) * dz), {}, 0.9)
	# hanging under the deck
	for i in 10 + r.randi() % 5:
		var hh := h * r.randf_range(0.04, 0.26) * (0.5 + 0.5 * r.randf())
		var bw := ss * r.randf_range(0.025, 0.1)
		put.call("BSK", Vector3(bw, hh, bw * r.randf_range(0.6, 1.2)), Vector3(r.randf_range(-0.44, 0.44) * ss, yd - td * 0.6 - hh * 0.5, r.randf_range(-0.25, 0.25) * dz), {"bx": 0.6, "bz": 0.6}, 0.9)
	# rail lines running off both ends, one of them coming down to the ground
	for s: float in [-1.0, 1.0]:
		var ln := ss * r.randf_range(1.3, 1.9)
		put.call("BSK", Vector3(ln, td * 0.24, dz * 0.1), Vector3(s * (ss * 0.5 + ln * 0.5), yd + td * 0.5, -dz * 0.2), {}, 1.0)
		var npr := maxi(2, int(ln / (ss * 0.5)))
		for j in npr:
			var ux := s * (ss * 0.5 + (j + 0.7) * ln / npr)
			put.call("BSK", Vector3(ss * 0.012, yd + 80.0, ss * 0.016), Vector3(ux, (yd - 80.0) * 0.5, -dz * 0.2), {"bx": 1.8, "bz": 1.4}, 0.95)
		var e0 := Vector3(s * ss * 0.5, yd + td * 0.3, dz * 0.25)
		var e1 := Vector3(s * (ss * 0.5 + ln * 0.8), yd * 0.3, dz * 0.25)
		rod.call("BSK", e0, e1, td * 0.22, 1.0)
		for t: float in [0.3, 0.62]:
			var pp := e0.lerp(e1, t)
			put.call("BSK", Vector3(ss * 0.011, pp.y + 80.0, ss * 0.014), Vector3(pp.x, (pp.y - 80.0) * 0.5, pp.z), {"bx": 1.6}, 0.95)
		# cables from the highest tower
		rod.call("BSK", peak, Vector3(s * ss * 0.5, ytop + 4.0, 0), maxf(h * 0.006, 2.2), 0.9)
		rod.call("BSK", peak + Vector3(0, -room * 0.2, 0), Vector3(s * (ss * 0.5 + ln * 0.55), yd + td, -dz * 0.2), maxf(h * 0.005, 2.0), 0.9)
	for i in 10:
		put.call("BLT", Vector3(ss * r.randf_range(0.006, 0.014), td * 0.12, 1.0), Vector3(r.randf_range(-0.48, 0.48) * ss, yd + td * r.randf_range(0.2, 0.85), -dz * 0.5 - 0.8), {}, 1.0)
	last = {"boxes": n[0], "tris": n[0] * 12, "colliders": 0, "top": y + h * 1.15}
