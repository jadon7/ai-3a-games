extends Node3D
# ANCHOR 07: the ground anchor tower of an abandoned orbital cable. About 550 m tall on a
# 240 m footprint, built from code as nine stacked sections so that it can come down:
# collapse() runs a scripted demolition (charges climb the core, the upper half leans,
# shears off and breaks up in the air, the lower half pancakes into a rubble mound).
#
#   var m = Mega.new()
#   game.add_extra(m)                      # ticks it every frame, frees it with the mission
#   m.setup(game, Vector3(x, game.world.height(x, z), z))
#   ...
#   m.collapse()                           # state: "intact" -> "collapsing" -> "ruin"
#
# No physics bodies are simulated: every section follows a small hand-written rigid motion
# (hinge -> ballistic -> settle), so the sequence costs a few transforms per frame.
# Uses from game: world.height(), world.sun_dir, cam, units, fx, sfx.play(), shake(); and, to
# clear / crush the town under it, the world's building nodes, body shapes and emitters.

const MeshKit = preload("res://scripts/mesh_kit.gd")
const Tex = preload("res://scripts/tex.gd")

signal stage_changed(id: String)      # cut, snap, drop, impact, down, ruin

# section boundaries, metres above the deck; section 0 is the stump that stays
const CUTS: Array[float] = [0.0, 60.0, 125.0, 190.0, 255.0, 315.0, 375.0, 430.0, 486.0, 548.0]
const NSEC := 9
const CORE_TOP := 430.0
const BUT_TOP := 235.0
const HEIGHT := 548.0
const CORE_R0 := 21.0        # shaft radius at the top, flaring to 44 at the deck
const HEAD_R := 33.0
const HZ := PI * 0.5
const G := 9.8

# collapse clock (seconds after collapse())
const T_CHARGE := 1.0        # first ring of cutting charges, one ring every CHARGE_DT
const CHARGE_DT := 0.42
const T_CUT := 4.6           # felling cut at the shoulder, the upper half starts to lean
const T_SNAP := 10.2         # head and mast whip off the leaning shaft
const T_DROP := 11.2         # hinge gives way, lower half starts to pancake
const HINGE_SEC := 4
const HINGE_K2 := 0.105
const HINGE_A0 := 0.035
const HINGE_W0 := 0.012
const STACK_G := 7.9
const SINK := 0.5            # how deep a fallen section beds into the ground (fraction of radius)
const MOUND_R := 124.0
const SITE_R := 134.0
const MOUND_TOP_R := 38.0

const B_HINGE := 1
const B_FREE := 2
const B_SETTLE := 3
const B_REST := 4

const RED := Color(1.0, 0.1, 0.05)
const WHITE := Color(0.85, 0.92, 1.0)
const AMBER := Color(1.0, 0.6, 0.22)
const DUST := Color(0.62, 0.53, 0.45, 0.9)
const GREY := Color(0.5, 0.47, 0.45, 0.75)
const SMOKE := Color(0.12, 0.11, 0.11, 0.8)

const PFLAGS := GPUParticles3D.EMIT_FLAG_POSITION | GPUParticles3D.EMIT_FLAG_VELOCITY | GPUParticles3D.EMIT_FLAG_COLOR | GPUParticles3D.EMIT_FLAG_CUSTOM
const CFLAGS := PFLAGS | GPUParticles3D.EMIT_FLAG_ROTATION_SCALE


class Sec:
	var i := 0
	var node: Node3D
	var y0 := 0.0             # extent above the deck
	var y1 := 0.0
	var r0 := 10.0            # hull radius at both ends
	var r1 := 10.0
	var rest := Vector3.ZERO  # node rest position
	var meshes: Array = []
	var body: StaticBody3D
	var crushed := false


class Body:
	var secs: Array = []
	var mode := 0
	var ref := Vector3.ZERO   # pivot in the rest pose
	var pos := Vector3.ZERO   # pivot now
	var rot := Basis.IDENTITY
	var vel := Vector3.ZERO
	var w := Vector3.ZERO
	var ang := 0.0
	var ang_v := 0.0
	var k2 := 0.1
	var y0 := 0.0
	var y1 := 0.0
	var r0 := 10.0
	var r1 := 10.0
	var t := 0.0
	var dur := 1.0
	var p0 := Vector3.ZERO
	var p1 := Vector3.ZERO
	var q0 := Quaternion.IDENTITY
	var q1 := Quaternion.IDENTITY
	var trail := 0.0


# ---- tunables: set before setup()
var fall_dir := Vector3(1, 0, 0)    # horizontal direction the upper half falls
var crush_damage := 7000.0          # damage to a unit directly under a landing section
var seed_v := 7
var label := "A7"
var clear_site := true              # hide the town buildings that stand inside the footprint
var flatten_town := true            # buildings under a falling section are crushed flat

var state := "intact"
var t_collapse := 0.0               # seconds since collapse()
var game
var deck := 8.0                     # deck height above the origin
var secs: Array = []
var bodies: Array = []

var _org := Vector3.ZERO
var _gmin := 0.0
var _k
var _rng := RandomNumberGenerator.new()
var _rub: Node3D
var _rub_h := 40.0
var _rub_meshes: Array = []
var _mound_k := 0.0
var _mound_cs: CollisionShape3D
var _ruin_body: StaticBody3D
var _axis := Vector3(0, 0, -1)
var _time := 0.0
var _cam := Vector3.ZERO
var _events: Array = []
var _ev_i := 0
var _halos: Array = []
var _halo: MeshInstance3D
var _halo_mat: ShaderMaterial
var _halo_pw := 1.0
var _lamps: Array = []
var _puffs: GPUParticles3D
var _fires: GPUParticles3D
var _chunks: GPUParticles3D
var _flashes: Array = []
var _fl_i := 0
var _snd_q: Array = []
var _hot: Array = []
var _stk_on := false
var _stk_v := 0.0
var _stk_d := 0.0
var _stk_total := 0.0
var _acc := {"hinge": 0.0, "hsmoke": 0.0, "hchunk": 0.0, "surge": 0.0, "col": 0.0, "sdust": 0.0, "sshake": 0.0, "srumble": 0.0, "schunk": 0.0, "ruin": 0.0, "rsmoke": 0.0}
var _rest_t := -1.0
var _did := {}
var _hit_p := Vector3.ZERO
var _town: Array = []


# ------------------------------------------------------------------ public API
func setup(g, origin: Vector3) -> void:
	if not secs.is_empty():
		return
	game = g
	_org = origin
	if is_inside_tree():
		global_transform = Transform3D(Basis.IDENTITY, origin)
	else:
		transform = Transform3D(Basis.IDENTITY, origin)
	fall_dir.y = 0.0
	fall_dir = fall_dir.normalized() if fall_dir.length() > 0.01 else Vector3.RIGHT
	_axis = Vector3.UP.cross(fall_dir).normalized()
	_rng.seed = seed_v
	_measure_ground()
	_scan_town()
	_k = MeshKit.new(seed_v)
	_k.dust = 0.5
	_k.dust_top = deck + 22.0
	_k.jitter = 0.14
	for i in NSEC:
		var s := Sec.new()
		s.i = i
		s.y0 = CUTS[i]
		s.y1 = CUTS[i + 1]
		s.r0 = _hull_r(s.y0 + 0.1)
		s.r1 = _hull_r(s.y1 - 0.1)
		s.rest = Vector3(0, deck + s.y0, 0)
		s.node = _k.bone(self, s.rest)
		s.node.name = "sec%d" % i
		s.body = StaticBody3D.new()
		s.body.collision_layer = 1
		s.body.collision_mask = 0
		add_child(s.body)
		secs.append(s)
	_build_base()
	_build_core()
	_build_buttresses()
	_build_rings()
	_build_pipes()
	_build_exo()
	_build_head()
	_build_mast()
	_build_fringes()
	_build_rubble()
	var out: Array = _k.bake(_mats())
	for mi in out:
		var m: MeshInstance3D = mi
		m.extra_cull_margin = 40.0
		var p := m.get_parent()
		if p == _rub:
			_rub_meshes.append(m)
			m.set_instance_shader_parameter("wreck", 0.22)
		else:
			for s in secs:
				if s.node == p:
					s.meshes.append(m)
	_k = null
	_rub.visible = false
	_rub.scale = Vector3(1, 0.03, 1)
	_build_ruin_colliders()
	_build_halos()
	_build_fx()


func collapse() -> void:
	if state != "intact" or secs.is_empty():
		return
	state = "collapsing"
	t_collapse = 0.0
	_events.clear()
	_ev_i = 0
	var levels := [60.0, 125.0, 190.0, 255.0, 315.0, 375.0, 430.0]
	for i in levels.size():
		_at(T_CHARGE + i * CHARGE_DT, _charge.bind(float(levels[i]), 1.0))
	_at(T_CUT, _cut)
	_at(T_CUT + 1.4, _groan.bind(0.3))
	_at(T_CUT + 2.2, _charge.bind(345.0, 0.8))
	_at(T_CUT + 3.3, _groan.bind(0.26))
	_at(T_CUT + 3.9, _charge.bind(402.0, 0.8))
	_at(T_CUT + 5.0, _groan.bind(0.22))
	_at(T_CUT + 5.3, _charge.bind(288.0, 0.9))
	_at(T_SNAP, _break_at.bind(7, 9.0, -3.0, 0.05))
	_at(T_SNAP + 1.1, _break_at.bind(8, -4.0, 4.0, 0.03))
	for q in 4:
		_at(T_DROP - 1.25 + q * 0.3, _foot_charge.bind(q))
	_at(T_DROP, _drop)
	_at(T_DROP + 0.6, _break_at.bind(6, 1.5, 3.0, 0.035))
	_at(T_DROP + 1.3, _break_at.bind(5, 2.0, -3.0, -0.03))
	_events.sort_custom(func(a, b): return a[0] < b[0])


func tick(dt: float) -> void:
	if game == null:
		return
	dt = minf(dt, 0.05)
	_time += dt
	_cam = game.cam.global_position if game.cam != null else _org
	_tick_lights()
	_tick_sounds()
	for f in _flashes:
		if f["t"] > 0.0:
			f["t"] -= dt
			f["l"].light_energy = maxf(0.0, float(f["e"]) * float(f["t"]) / float(f["d"]))
			if f["t"] <= 0.0:
				f["l"].visible = false
	if state == "collapsing":
		_tick_collapse(dt)
	elif state == "ruin":
		_tick_ruin(dt)


# world position of the current highest point
func top() -> Vector3:
	if state == "intact":
		return _org + Vector3(0, deck + HEIGHT, 0)
	var best := Vector3(0, deck + 40.0, 0)
	for s in secs:
		if not s.node.visible:
			continue
		for e in 2:
			var p: Vector3 = s.node.transform * Vector3(0, 0.0 if e == 0 else s.y1 - s.y0, 0)
			if p.y > best.y:
				best = p
	return _org + best


# a point worth looking at: half way up whatever is still standing
func focus() -> Vector3:
	var tp := top()
	return Vector3(lerpf(_org.x, tp.x, 0.5), lerpf(_org.y, tp.y, 0.55), lerpf(_org.z, tp.z, 0.5))


func _exit_tree() -> void:
	_restore_town()


# ------------------------------------------------------------------ town around the tower
# The world keeps its buildings between missions, so everything done to them here is undone
# again when this node leaves the tree.
func _scan_town() -> void:
	var w = game.world
	if not (w is Node3D) or not w.is_inside_tree():
		return
	var shapes: Array = []
	var holders: Array = []
	if "bodies" in w:
		holders = w.bodies
	elif "body" in w and w.body is Node:
		holders = [w.body]
	for hb in holders:
		for c in hb.get_children():
				if c is CollisionShape3D and c.shape is BoxShape3D:
					shapes.append(c)
	var ems: Array = []
	if "emitters" in w and w.emitters is Array:
		ems = w.emitters
	for n in w.get_children():
		if not (n is Node3D) or n is VisualInstance3D or n is CollisionObject3D:
			continue
		var box := AABB()
		var found := false
		for c in n.get_children():
			if c is MeshInstance3D and str(c.get_meta("key", "")) in ["FAC", "BS1", "BS2", "BS3", "BCG"]:
				box = c.global_transform * c.get_aabb()
				found = true
		if not found or box.size.x > 130.0 or box.size.z > 130.0:
			continue
		var ctr := box.get_center()
		if Vector2(ctr.x - _org.x, ctr.z - _org.z).length() > 720.0:
			continue
		var e := {"n": n, "xf": n.transform, "box": box, "cs": [], "em": [], "st": 0, "k": 1.0, "to": 1.0}
		for cs in shapes:
			var p: Vector3 = cs.global_position
			if p.x > box.position.x - 1.0 and p.x < box.end.x + 1.0 and p.z > box.position.z - 1.0 and p.z < box.end.z + 1.0:
				e["cs"].append([cs, cs.position, cs.shape.size, cs.disabled])
		for em in ems:
			if em is Dictionary and em.get("pos") is Vector3:
				var p: Vector3 = em["pos"]
				if p.x > box.position.x and p.x < box.end.x and p.z > box.position.z and p.z < box.end.z:
					e["em"].append([em, p])
		_town.append(e)
		if clear_site:
			var dx := maxf(maxf(box.position.x - _org.x, _org.x - box.end.x), 0.0)
			var dz := maxf(maxf(box.position.z - _org.z, _org.z - box.end.z), 0.0)
			if Vector2(dx, dz).length() < SITE_R:
				e["st"] = 1
				n.visible = false
				for c in e["cs"]:
					c[0].set_deferred("disabled", true)
				for m in e["em"]:
					m[0]["pos"] = m[1] - Vector3(0, 9000, 0)


func _restore_town() -> void:
	for e in _town:
		if e["st"] == 0:
			continue
		if is_instance_valid(e["n"]):
			e["n"].visible = true
			e["n"].transform = e["xf"]
		for c in e["cs"]:
			if is_instance_valid(c[0]):
				c[0].position = c[1]
				c[0].shape.size = c[2]
				c[0].disabled = c[3]
		for m in e["em"]:
			m[0]["pos"] = m[1]
	_town.clear()


# squash one building down to a fraction k of its height (it keeps its footprint as a low ruin)
func _flatten(e: Dictionary, k: float) -> void:
	if e["st"] != 0:
		return
	e["st"] = 2
	e["to"] = k
	var box: AABB = e["box"]
	var base := box.position.y + 3.0
	var top := base + (box.end.y - base) * k
	var main = null
	var area := 0.0
	for c in e["cs"]:
		if is_instance_valid(c[0]) and c[2].x * c[2].z > area:
			area = c[2].x * c[2].z
			main = c[0]
	for c in e["cs"]:
		if not is_instance_valid(c[0]):
			continue
		if c[0] == main:
			c[0].shape.size = Vector3(c[2].x, top - base + 5.0, c[2].z)
			c[0].position = Vector3(c[1].x, (top + base - 5.0) * 0.5, c[1].z)
		else:
			c[0].set_deferred("disabled", true)
	for m in e["em"]:
		m[0]["pos"] = Vector3(m[1].x, top + 2.0, m[1].z)
	var c := box.get_center()
	var w := maxf(box.size.x, box.size.z)
	for i in 3:
		var a := randf() * TAU
		_puff(Vector3(c.x, base + 8.0, c.z), Vector3(cos(a), 0.15, sin(a)) * randf_range(14.0, 30.0), w * 0.6, w * randf_range(1.6, 2.4), randf_range(8.0, 12.0), DUST)
	if _cam.distance_to(c) < 700.0:
		game.fx.dust(Vector3(c.x, base, c.z), 10, w * 0.5, 26.0, 8.0)
	_hot.append(Vector3(c.x, top + 3.0, c.z))


func _tick_town(dt: float) -> void:
	for e in _town:
		if e["st"] != 2 or e["k"] <= e["to"]:
			continue
		e["k"] = maxf(e["to"], e["k"] - dt * 3.0)
		var n: Node3D = e["n"]
		if not is_instance_valid(n):
			continue
		var k: float = e["k"]
		var base: float = e["box"].position.y + 3.0
		n.scale = Vector3(1, k, 1)
		n.position = Vector3(0, base * (1.0 - k), 0)


# anything a moving section reaches before it reaches the ground
func _sweep_town(b: Body) -> void:
	if not flatten_town or _town.is_empty():
		return
	var a := _org + _end(b, 0)
	var z := _org + _end(b, 1)
	# ring decks stick out past the hull, the head carries its tensioner ring
	var rr: float = (b.r0 + b.r1) * 0.5 + (24.0 if b.secs.has(secs[7]) else 8.0)
	if minf(a.y, z.y) - rr > _org.y + 120.0:
		return
	for e in _town:
		if e["st"] != 0:
			continue
		var box: AABB = e["box"]
		var c := box.get_center()
		var q := _seg_closest(Vector3(c.x, box.end.y, c.z), a, z)
		if Vector2(q.x - c.x, q.z - c.z).length() < rr + maxf(box.size.x, box.size.z) * 0.5 and q.y - rr < box.end.y:
			_flatten(e, randf_range(0.07, 0.2))


# ------------------------------------------------------------------ profile
func _core_r(y: float) -> float:
	var u := clampf(1.0 - y / CORE_TOP, 0.0, 1.0)
	return CORE_R0 + 23.0 * pow(u, 1.6)


func _but_c(y: float) -> float:
	var u := clampf(1.0 - y / BUT_TOP, 0.0, 1.0)
	return _core_r(y) + 8.0 + 40.0 * u * u


func _but_d(y: float) -> float:
	return lerpf(30.0, 11.0, clampf(y / BUT_TOP, 0.0, 1.0))


func _but_w(y: float) -> float:
	return lerpf(22.0, 10.0, clampf(y / BUT_TOP, 0.0, 1.0))


func _hull_r(y: float) -> float:
	if y >= 486.0:
		return 8.0
	if y >= 430.0:
		return HEAD_R
	if y >= 255.0:
		return _core_r(y) + 8.0
	return _core_r(y) + 2.0


func _sec_at(y: float) -> int:
	for i in range(NSEC - 1, 0, -1):
		if y >= CUTS[i]:
			return i
	return 0


func _pol(r: float, a: float, y: float) -> Vector3:
	return Vector3(cos(a) * r, y, sin(a) * r)


func _tan(a: float) -> Vector3:
	return Vector3(-sin(a), 0, cos(a))


# terrain height relative to the origin / to the deck
func _gl0(x: float, z: float) -> float:
	return game.world.height(_org.x + x, _org.z + z) - _org.y


func _gt(p: Vector3) -> float:
	return _gl0(p.x, p.z) - deck


func _measure_ground() -> void:
	var hi := -1e9
	var lo := 1e9
	for i in 24:
		var a := i * TAU / 24.0
		for r: float in [30.0, 78.0, 114.0]:
			var h := _gl0(cos(a) * r, sin(a) * r)
			lo = minf(lo, h)
			if r < 80.0:
				hi = maxf(hi, h)
	deck = clampf(hi + 2.5, 6.0, 24.0)
	_gmin = lo


# ------------------------------------------------------------------ primitives (tower space: y = 0 is the deck)
func _bas(dir: Vector3, hint: Vector3 = Vector3.ZERO) -> Basis:
	var y := dir.normalized()
	var x := hint - y * hint.dot(y)
	if x.length_squared() < 1e-4:
		x = y.cross(Vector3.UP)
		if x.length_squared() < 1e-4:
			x = Vector3.RIGHT
	x = x.normalized()
	return Basis(x, y, x.cross(y))


func _bx(key: String, size: Vector3, c: Vector3, rot: Vector3 = Vector3.ZERO, t: Dictionary = {}, shade: float = -1.0, si: int = -1) -> void:
	if si < 0:
		si = _sec_at(c.y)
	_k.box(secs[si].node, key, size, c - Vector3(0, CUTS[si], 0), rot, t, shade)


func _cy(key: String, rt: float, rb: float, h: float, c: Vector3, rot: Vector3 = Vector3.ZERO, seg: int = 12, shade: float = -1.0, si: int = -1) -> void:
	if si < 0:
		si = _sec_at(c.y)
	_k.cyl(secs[si].node, key, rt, rb, h, c - Vector3(0, CUTS[si], 0), rot, seg, shade)


# box of w (sideways) x d (upward) running from a to b
func _beam(key: String, a: Vector3, b: Vector3, w: float, d: float, shade: float = -1.0, si: int = -1, hint: Vector3 = Vector3.ZERO) -> void:
	if si < 0:
		si = _sec_at(minf(a.y, b.y) + 0.01)
	_bx(key, Vector3(w, a.distance_to(b), d), (a + b) * 0.5, _bas(b - a, hint).get_euler(), {}, shade, si)


func _pipe(key: String, a: Vector3, b: Vector3, r: float, seg: int = 8, shade: float = -1.0, si: int = -1) -> void:
	if si < 0:
		si = _sec_at(minf(a.y, b.y) + 0.01)
	_cy(key, r, r, a.distance_to(b), (a + b) * 0.5, _bas(b - a).get_euler(), seg, shade, si)


func _lamp(p: Vector3, size: float, col: Color, type: int, _si: int = -1) -> void:
	_halos.append([p + Vector3(0, deck, 0), size, col, type, _rng.randf()])


func _cbox(si: int, size: Vector3, bas: Basis, c: Vector3) -> void:
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = size
	cs.shape = bs
	cs.transform = Transform3D(bas, c + Vector3(0, deck, 0))
	secs[si].body.add_child(cs)


func _ccyl(si: int, r: float, y0: float, y1: float, x: float = 0.0, z: float = 0.0) -> void:
	var cs := CollisionShape3D.new()
	var sh := CylinderShape3D.new()
	sh.radius = r
	sh.height = y1 - y0
	cs.shape = sh
	cs.position = Vector3(x, deck + (y0 + y1) * 0.5, z)
	secs[si].body.add_child(cs)


func _mats() -> Dictionary:
	# object-space copies of the shared world-space materials, so the pattern rides with a falling section
	var con := Tex.concrete.duplicate() as ShaderMaterial
	con.set_shader_parameter("world_space", false)
	con.set_shader_parameter("tile", 22.0)
	var fac := Tex.facade.duplicate() as ShaderMaterial
	fac.set_shader_parameter("world_space", false)
	var cor := Tex.corrugated.duplicate() as ShaderMaterial
	cor.set_shader_parameter("world_space", false)
	return {
		"CON": {"mat": con, "params": {"tint": Color(0.47, 0.45, 0.41), "metal": 0.0}},
		"FAC": {"mat": fac, "params": {"tint": Color(0.4, 0.38, 0.35), "metal": 0.0}},
		"COR": {"mat": cor, "params": {"tint": Color(0.33, 0.35, 0.33), "metal": 0.35}},
		"STL": {"mat": Tex.armor, "params": {"tint": Color(0.15, 0.155, 0.16), "metal": 0.55, "wear": 1.2}},
		"HAZ": {"mat": Tex.armor, "params": {"tint": Color(0.7, 0.5, 0.06), "metal": 0.2, "wear": 1.2, "stripes": 1.0}},
	}


# ------------------------------------------------------------------ geometry
func _build_base() -> void:
	var lo := _gmin - deck - 8.0
	# podium drum, inner ring wall
	_cy("CON", 80.0, 83.0, -lo, Vector3(0, lo * 0.5, 0), Vector3.ZERO, 40, 0.95, 0)
	_cy("HAZ", 80.6, 80.6, 1.6, Vector3(0, -1.3, 0), Vector3.ZERO, 40, 1.0, 0)
	_cy("CON", 56.0, 58.0, 9.0, Vector3(0, 4.5, 0), Vector3.ZERO, 40, 0.84, 0)
	_cy("STL", 58.3, 58.3, 0.9, Vector3(0, 7.9, 0), Vector3.ZERO, 40, 0.6, 0)
	_ccyl(0, 81.5, lo, 0.0)
	_ccyl(0, 57.0, 0.0, 9.0)
	_ccyl(0, _core_r(30.0) + 1.0, 9.0, 60.0)
	for q in 4:
		var a := q * HZ
		var tn := _tan(a)
		var ry := Vector3(0, -a, 0)
		# gate house with a frame-sized door
		_bx("CON", Vector3(9, 27, 40), _pol(60.5, a, 13.5), ry, {"tx": 0.75, "tz": 0.9}, 0.9, 0)
		_bx("STL", Vector3(1.2, 20, 24), _pol(64.6, a, 10.0), ry, {}, 0.06, 0)
		_bx("HAZ", Vector3(1.8, 2.4, 29), _pol(64.7, a, 21.2), ry, {}, 1.0, 0)
		for s: float in [-1.0, 1.0]:
			_bx("HAZ", Vector3(1.8, 20, 2.2), _pol(64.7, a, 10.0) + tn * s * 13.2, ry, {}, 1.0, 0)
			_lamp(_pol(66.2, a, 23.5) + tn * s * 10.0, 5.0, AMBER, 0, 0)
		_cbox(0, Vector3(9, 27, 40), Basis.from_euler(ry), _pol(60.5, a, 13.5))
		# ramp from the ground up to the deck
		var p0 := _pol(134.0, a, _gt(_pol(134.0, a, 0)) - 1.5)
		var p1 := _pol(78.0, a, -0.2)
		var rb := _bas(p1 - p0)
		var rc := (p0 + p1) * 0.5 - rb.z * 2.5
		_bx("CON", Vector3(34, p0.distance_to(p1), 5), rc, rb.get_euler(), {}, 0.88, 0)
		for s: float in [-1.0, 1.0]:
			_bx("HAZ", Vector3(1.2, p0.distance_to(p1), 1.6), rc + rb.x * s * 16.6 + rb.z * 3.0, rb.get_euler(), {}, 1.0, 0)
		_cbox(0, Vector3(34, p0.distance_to(p1), 5), rb, rc)
		# buttress foot on the diagonal
		var fa := a + PI * 0.25
		var fg := _gt(_pol(96.0, fa, 0))
		var fl := minf(fg, lo + 8.0) - 8.0
		var fr := Vector3(0, -fa, 0)
		_bx("CON", Vector3(52, 16.0 - fl, 44), _pol(95.0, fa, (16.0 + fl) * 0.5), fr, {"tx": 0.82, "tz": 0.8}, 0.93, 0)
		_bx("HAZ", Vector3(43.4, 1.6, 35.8), _pol(95.0, fa, 16.5), fr, {}, 1.0, 0)
		_cbox(0, Vector3(47, 17.0 - fl, 39), Basis.from_euler(fr), _pol(95.0, fa, (17.0 + fl) * 0.5))
		for s: float in [-1.0, 1.0]:
			# anchor bolts and a human-sized door for scale
			for j in 3:
				_cy("STL", 1.5, 1.5, 3.2, _pol(80.0 + j * 14.0, fa, 17.8) + _tan(fa) * s * 14.5, Vector3.ZERO, 8, 0.7, 0)
			_bx("STL", Vector3(0.5, 2.6, 1.5), _pol(119.9, fa, fg + 1.6) + _tan(fa) * s * 7.0, fr, {}, 0.08, 0)
			_lamp(_pol(121.4, fa, fg + 4.4) + _tan(fa) * s * 7.0, 2.4, AMBER, 0, 0)
		_lamp(_pol(117.5, fa, 19.5), 7.0, RED, 1, 0)
	# deck clutter at human scale: containers, sheds, tanks, plant
	for i in 54:
		var a := _rng.randf() * TAU
		if absf(fposmod(a + PI * 0.25, HZ) - PI * 0.25) < 0.34:
			continue
		var r := _rng.randf_range(62.0, 76.0)
		var yaw := _rng.randf() * TAU
		var kind := _rng.randi() % 5
		if kind <= 1:
			var ln := 12.2 if _rng.randf() < 0.6 else 6.1
			for q in 1 + _rng.randi() % 3:
				_bx("COR", Vector3(ln, 2.6, 2.44), _pol(r, a, 1.3 + q * 2.6), Vector3(0, yaw + _rng.randf_range(-0.05, 0.05), 0), {}, _rng.randf_range(0.6, 1.25), 0)
		elif kind == 2:
			_bx("COR", Vector3(7, 3.4, 5), _pol(r, a, 1.7), Vector3(0, yaw, 0), {}, _rng.randf_range(0.7, 1.1), 0)
			_bx("STL", Vector3(7.6, 0.3, 5.6), _pol(r, a, 3.5), Vector3(0, yaw, 0), {}, 0.8, 0)
		elif kind == 3:
			_cy("COR", 2.2, 2.2, 7.0, _pol(r, a, 3.9), Vector3.ZERO, 10, _rng.randf_range(0.8, 1.2), 0)
			_cy("STL", 0.4, 2.2, 0.8, _pol(r, a, 7.8), Vector3.ZERO, 10, 0.8, 0)
		else:
			_bx("STL", Vector3(4.2, 2.4, 3), _pol(r, a, 1.2), Vector3(0, yaw, 0), {}, 0.9, 0)
			_cy("STL", 0.35, 0.35, 4.0, _pol(r, a, 4.2), Vector3.ZERO, 6, 0.7, 0)
	# deck edge rail and lamp posts
	for i in 72:
		var a0 := i * TAU / 72.0
		var a1 := a0 + TAU / 72.0
		if absf(fposmod(a0 + TAU / 144.0 + PI * 0.25, HZ) - PI * 0.25) < 0.27:
			continue
		_beam("STL", _pol(79.4, a0, 1.3), _pol(79.4, a1, 1.3), 0.22, 0.22, 0.9, 0)
		_bx("STL", Vector3(0.22, 1.3, 0.22), _pol(79.4, a0, 0.65), Vector3.ZERO, {}, 0.9, 0)
		if i % 4 == 1:
			_bx("STL", Vector3(0.45, 10, 0.45), _pol(78.4, a0, 5.0), Vector3.ZERO, {}, 0.8, 0)
			_bx("STL", Vector3(2.6, 0.3, 0.5), _pol(77.3, a0, 9.9), Vector3(0, -a0, 0), {}, 0.8, 0)
			_lamp(_pol(76.2, a0, 9.4), 2.6, AMBER, 0, 0)
	# name plates on the podium wall
	for a: float in [HZ - 0.5, HZ + 0.5, -0.5, 0.5]:
		var lb := Label3D.new()
		lb.text = "ORBITAL TETHER  //  ANCHOR 07"
		lb.font = Tex.font
		lb.font_size = 160
		lb.pixel_size = 0.024
		lb.modulate = Color(0.82, 0.78, 0.68, 0.9)
		lb.outline_size = 0
		lb.shaded = true
		lb.alpha_cut = Label3D.ALPHA_CUT_DISCARD
		lb.position = _pol(81.9, a, -3.2)
		lb.rotation.y = HZ - a
		secs[0].node.add_child(lb)


func _build_core() -> void:
	for si in 7:
		var ya: float = CUTS[si]
		var yb: float = CUTS[si + 1]
		var n := int(round((yb - ya) / 13.0))
		var th := (yb - ya) / n
		for j in n:
			var y0 := ya + j * th
			var y1 := y0 + th
			var r0 := _core_r(y0)
			var r1 := _core_r(y1)
			var rm := (r0 + r1) * 0.5
			_cy("CON", r1 - 1.7, r0 - 1.7, th, Vector3(0, (y0 + y1) * 0.5, 0), Vector3.ZERO, 16, 0.5, si)
			var slope := atan((r0 - r1) / th)
			var band := j == 1
			var wide := 2.0 * rm * tan(PI / 8.0) * 0.9
			var sh := _rng.randf_range(0.84, 1.0)
			for q in 8:
				var a := q * PI / 4.0
				if band:
					_bx("FAC", Vector3(3.4, th - 0.9, wide), _pol(rm - 1.4, a, (y0 + y1) * 0.5), Vector3(0, -a, slope), {"tz": r1 / r0}, 0.95, si)
				else:
					_bx("CON", Vector3(2.6, th - 0.9, wide), _pol(rm - 1.3, a, (y0 + y1) * 0.5), Vector3(0, -a, slope), {"tz": r1 / r0}, sh + _rng.randf_range(-0.05, 0.05), si)
		# pilasters on the eight corners
		for q in 8:
			var a := PI / 8.0 + q * PI / 4.0
			_beam("STL", _pol(_core_r(ya) * 1.05, a, ya), _pol(_core_r(yb) * 1.05, a, yb), 2.4, 2.4, 0.8, si)
		if si > 0:
			_ccyl(si, (_hull_r(ya + 0.1) + _hull_r(yb - 0.1)) * 0.5, ya, yb)
	# shoulder collar where the buttresses run into the shaft
	var cr := _core_r(245.0)
	_cy("CON", cr + 4.5, cr + 0.6, 8.0, Vector3(0, 232.0, 0), Vector3.ZERO, 16, 0.85, 3)
	_cy("CON", cr + 7.0, cr + 4.5, 19.0, Vector3(0, 245.5, 0), Vector3.ZERO, 16, 0.6, 3)
	for q in 16:
		var a := q * TAU / 16.0
		_bx("FAC", Vector3(1.6, 16.0, (cr + 5.6) * 0.375), _pol(cr + 5.6, a, 245.5), Vector3(0, -a, 0), {}, 0.95, 3)
	# the number, painted on the east and west faces
	for a: float in [0.0, PI]:
		var lb := Label3D.new()
		lb.text = "\n".join(label.split(""))
		lb.font = Tex.font
		lb.font_size = 200
		lb.pixel_size = 0.105
		lb.line_spacing = -40.0
		lb.modulate = Color(0.8, 0.76, 0.68, 0.85)
		lb.outline_size = 0
		lb.shaded = true
		lb.alpha_cut = Label3D.ALPHA_CUT_DISCARD
		var y := 99.0
		lb.position = _pol(_core_r(y) + 0.25, a, y - CUTS[1])
		lb.rotation = Vector3(0, HZ - a, 0)
		lb.rotate_object_local(Vector3.RIGHT, -atan((_core_r(y - 6.0) - _core_r(y + 6.0)) / 12.0))
		secs[1].node.add_child(lb)


func _build_buttresses() -> void:
	var steps := [0.0, 15.0, 30.0, 45.0, 60.0, 76.25, 92.5, 108.75, 125.0, 141.25, 157.5, 173.75, 190.0, 205.0, 220.0, 235.0]
	for q in 4:
		var a := PI * 0.25 + q * HZ
		var tn := _tan(a)
		var ry := Vector3(0, -a, 0)
		for i in steps.size() - 1:
			var y0: float = steps[i]
			var y1: float = steps[i + 1]
			var h := y1 - y0
			var ym := (y0 + y1) * 0.5
			var si := _sec_at(y0 + 0.1)
			var c0 := _but_c(y0)
			var c1 := _but_c(y1)
			var d0 := _but_d(y0)
			var d1 := _but_d(y1)
			var w0 := _but_w(y0)
			var w1 := _but_w(y1)
			_bx("CON", Vector3(d0, h, w0), _pol(c0, a, ym), ry, {"tx": d1 / d0, "tz": w1 / w0, "sx": c1 - c0}, _rng.randf_range(0.86, 1.0), si)
			# steel spine on the outer edge, belt line, gallery windows on both flanks
			_bx("STL", Vector3(1.4, h, w0 * 0.5), _pol(c0 + d0 * 0.5 + 0.4, a, ym), ry, {"tz": w1 / w0, "sx": c1 + d1 * 0.5 - c0 - d0 * 0.5}, 0.9, si)
			_bx("STL", Vector3(d1 + 1.0, 1.1, w1 + 1.0), _pol(c1, a, y1 - 0.6), ry, {}, 0.6, si)
			for s: float in [-1.0, 1.0]:
				_bx("FAC", Vector3(d0 * 0.46, h - 3.4, 0.7), _pol(c0, a, ym - 0.4) + tn * s * (w0 * 0.5 + 0.1), ry, {"tx": d1 / d0, "sx": c1 - c0, "sz": -s * (w0 - w1) * 0.5}, 0.95, si)
			# web back to the shaft
			var gap := c1 - d1 * 0.5 - _core_r(y1)
			if gap > 5.0 and y1 < 230.0:
				var pc := _pol(_core_r(y1 - 2.0) - 1.0, a, y1 - 2.0)
				var pb := _pol(c1 - d1 * 0.5 + 1.0, a, y1 - 2.0)
				for s: float in [-1.0, 1.0]:
					_beam("STL", pc + tn * s * w1 * 0.3, pb + tn * s * w1 * 0.3, 2.2, 2.4, 0.85, si)
				_beam("STL", pc, _pol(c0 - d0 * 0.5 + 1.0, a, y0 + 1.5), 2.0, 2.0, 0.8, si)
			# collider: one tilted box per step
			var bb := _bas(Vector3(cos(a) * (c1 - c0), h, sin(a) * (c1 - c0)), Vector3(cos(a), 0, sin(a)))
			_cbox(si, Vector3((d0 + d1) * 0.5, Vector2(c1 - c0, h).length(), (w0 + w1) * 0.5), bb, _pol((c0 + c1) * 0.5, a, ym))
		# knuckle into the collar, beacons on the shoulder
		_bx("CON", Vector3(12, 20, 11), _pol(_core_r(245.0) + 8.5, a, 245.0), ry, {"tx": 0.7, "tz": 0.8}, 0.9, 3)
		_lamp(_pol(_but_c(125.0) + _but_d(125.0) * 0.5 + 1.6, a, 126.0), 6.0, RED, 1, 2)
		_lamp(_pol(_but_c(60.0) + _but_d(60.0) * 0.5 + 1.6, a, 61.0), 6.0, RED, 1, 1)


func _ring(si: int, y: float, ro: float) -> void:
	var rc := _core_r(y)
	_cy("CON", ro, ro - 1.2, 2.4, Vector3(0, y - 1.2, 0), Vector3.ZERO, 24, 0.8, si)
	_cy("HAZ", ro + 0.35, ro + 0.35, 1.3, Vector3(0, y - 0.8, 0), Vector3.ZERO, 24, 1.0, si)
	_ccyl(si, ro, y - 2.4, y)
	var ln := ro - rc - 0.5
	for q in 16:
		var a := q * TAU / 16.0 + 0.2
		_bx("STL", Vector3(ln, 7.0, 1.3), _pol(rc + ln * 0.06, a, y - 5.9), Vector3(0, -a, 0), {"bx": 0.12, "sx": ln * 0.44}, 0.8, si)
	for q in 24:
		var a0 := q * TAU / 24.0
		var a1 := a0 + TAU / 24.0
		_beam("STL", _pol(ro - 0.6, a0, y + 1.4), _pol(ro - 0.6, a1, y + 1.4), 0.25, 0.25, 0.9, si)
		_bx("STL", Vector3(0.25, 1.4, 0.25), _pol(ro - 0.6, a0, y + 0.7), Vector3.ZERO, {}, 0.9, si)
		if q % 3 == 0:
			_lamp(_pol(ro + 0.8, a0, y + 1.4), 3.0, RED, 0, si)
	if ro - rc > 9.0:
		for q in 7:
			var a := _rng.randf() * TAU
			var r := _rng.randf_range(rc + 4.5, ro - 4.0)
			var kind := _rng.randi() % 4
			if kind == 0:
				_bx("COR", Vector3(6, 3.2, 4), _pol(r, a, y + 1.6), Vector3(0, -a, 0), {}, _rng.randf_range(0.7, 1.1), si)
			elif kind == 1:
				_cy("COR", 1.8, 1.8, 5.0, _pol(r, a, y + 2.5), Vector3.ZERO, 8, _rng.randf_range(0.8, 1.2), si)
			elif kind == 2:
				_bx("STL", Vector3(0.5, 14, 0.5), _pol(r, a, y + 7.0), Vector3.ZERO, {}, 0.8, si)
				_cy("STL", 2.2, 0.4, 1.0, _pol(r, a, y + 12.0), Vector3(1.1, -a, 0), 10, 0.9, si)
			else:
				_bx("STL", Vector3(3.5, 2.2, 2.6), _pol(r, a, y + 1.1), Vector3(0, a, 0), {}, 0.9, si)


# octagonal lattice ring girder tying the buttresses together
func _truss(si: int, y: float, r: float) -> void:
	var dp := Vector3(0, 9.0, 0)
	for q in 8:
		var a0 := q * PI / 4.0
		var p0 := _pol(r, a0, y + 1.0)
		var p1 := _pol(r, a0 + PI / 4.0, y + 1.0)
		_beam("STL", p0, p1, 2.4, 2.4, 0.85, si)
		_beam("STL", p0 + dp, p1 + dp, 2.4, 2.4, 0.9, si)
		_beam("COR", p0 + dp + Vector3(0, 1.4, 0), p1 + dp + Vector3(0, 1.4, 0), 4.6, 0.5, 0.9, si)
		var n := maxi(3, int(round(p0.distance_to(p1) / 9.0)))
		for j in n:
			var u0 := p0.lerp(p1, float(j) / n)
			var u1 := p0.lerp(p1, float(j + 1) / n)
			if j % 2 == 0:
				_beam("STL", u0, u1 + dp, 1.5, 1.5, 0.8, si)
			else:
				_beam("STL", u0 + dp, u1, 1.5, 1.5, 0.8, si)
			_beam("STL", u0, u0 + dp, 1.2, 1.2, 0.8, si)
		var gb := _bas(p1 - p0)
		_cbox(si, Vector3(4.6, p0.distance_to(p1), 11.5), gb, (p0 + p1) * 0.5 + dp * 0.5)
		if q % 2 == 0:
			_beam("STL", _pol(_core_r(y + 10.0) - 1.0, a0, y + 10.0), p0 + dp, 2.2, 2.2, 0.85, si)
			_beam("STL", _pol(_core_r(y + 34.0) - 1.0, a0, y + 34.0), p0 + dp, 1.6, 1.6, 0.8, si)
			_lamp(p0 + dp + Vector3(0, 2.6, 0), 3.6, RED, 0, si)


func _build_rings() -> void:
	_ring(1, 60.0, 49.0)
	_ring(2, 125.0, 44.0)
	_ring(3, 190.0, 40.0)
	_ring(4, 255.0, 43.0)
	_ring(5, 315.0, 36.0)
	_ring(6, 375.0, 33.5)
	_ring(7, 430.0, 35.0)
	_truss(1, 60.0, _but_c(60.0) + 2.0)
	_truss(2, 125.0, _but_c(125.0) + 2.0)


func _build_pipes() -> void:
	for si in 7:
		var ya: float = CUTS[si] + (9.0 if si == 0 else 0.0)
		var yb: float = CUTS[si + 1]
		var ra := _core_r(ya)
		var rb := _core_r(yb)
		for q: int in [0, 2, 3]:
			if q != 3 and si < 2:
				continue
			var a := q * HZ
			var tn := _tan(a)
			for j in 3:
				var off := (j - 1) * 4.2
				var pr := 1.7 if j == 1 else 1.1
				_pipe("COR" if j == 1 else "STL", _pol(ra + pr + 0.7, a, ya) + tn * off, _pol(rb + pr + 0.7, a, yb) + tn * off * (rb / ra), pr, 8, 1.1 if j == 1 else 0.9, si)
			for j in 4:
				var y := lerpf(ya, yb, (j + 0.5) / 4.0)
				_bx("STL", Vector3(1.6, 1.0, 12.5 * _core_r(y) / ra), _pol(_core_r(y) + 1.6, a, y), Vector3(0, -a, 0), {}, 0.7, si)
		# elevator spine on the south face, a lit landing every tier
		var ea := HZ
		_beam("COR", _pol(ra + 2.4, ea, ya), _pol(rb + 2.4, ea, yb), 8.0, 4.8, 0.95, si)
		for s: float in [-1.0, 1.0]:
			_beam("STL", _pol(ra + 5.0, ea, ya) + _tan(ea) * s * 2.6, _pol(rb + 5.0, ea, yb) + _tan(ea) * s * 2.6, 0.5, 0.5, 0.6, si)
		for j in 3:
			var y := lerpf(ya, yb, (j + 0.5) / 3.0)
			_bx("STL", Vector3(6.5, 0.5, 11), _pol(_core_r(y) + 5.4, ea, y), Vector3(0, -ea, 0), {}, 0.8, si)
			_lamp(_pol(_core_r(y) + 8.6, ea, y + 2.2), 2.6, AMBER if j != 1 else WHITE, 0, si)
	for y: float in [88.0, 301.0]:
		_bx("COR", Vector3(5, 7, 5.6), _pol(_core_r(y) + 7.6, HZ, y), Vector3(0, -HZ, 0), {}, 1.2)
		_lamp(_pol(_core_r(y) + 11.0, HZ, y), 4.0, WHITE, 0)


# lattice cage around the upper shaft
func _build_exo() -> void:
	for si: int in [4, 5, 6]:
		var ya: float = CUTS[si]
		var yb: float = CUTS[si + 1]
		var n := 4
		var th := (yb - ya) / n
		for q in 8:
			var a := PI / 8.0 + q * PI / 4.0
			_beam("STL", _pol(_core_r(ya) + 8.0, a, ya), _pol(_core_r(yb) + 8.0, a, yb), 2.6, 2.6, 0.9, si)
		for j in n:
			var y0 := ya + j * th
			var y1 := y0 + th
			var r0 := _core_r(y0) + 8.0
			var r1 := _core_r(y1) + 8.0
			for q in 8:
				var a0 := PI / 8.0 + q * PI / 4.0
				var a1 := a0 + PI / 4.0
				_beam("STL", _pol(r1, a0, y1 - 0.9), _pol(r1, a1, y1 - 0.9), 1.8, 1.8, 0.85, si)
				_beam("STL", _pol(r0, a0, y0), _pol(r1, a1, y1), 1.4, 1.4, 0.8, si)
				_beam("STL", _pol(r0, a1, y0), _pol(r1, a0, y1), 1.4, 1.4, 0.8, si)
				if j % 2 == 1:
					_beam("STL", _pol(_core_r(y1) - 1.0, a0, y1 - 0.9), _pol(r1, a0, y1 - 0.9), 1.4, 1.4, 0.8, si)


func _jib(a: float, ln: float, y: float) -> void:
	var tn := _tan(a)
	var up := Vector3(0, 1, 0)
	var root := _pol(HEAD_R - 2.0, a, y)
	var tip := _pol(HEAD_R - 2.0 + ln, a, y + ln * 0.07)
	var n := int(round(ln / 7.5))
	for j in n:
		var u0 := float(j) / n
		var u1 := float(j + 1) / n
		var wd0 := lerpf(3.4, 1.4, u0)
		var wd1 := lerpf(3.4, 1.4, u1)
		var h0 := lerpf(8.0, 2.6, u0)
		var h1 := lerpf(8.0, 2.6, u1)
		var b0 := root.lerp(tip, u0)
		var b1 := root.lerp(tip, u1)
		for s: float in [-1.0, 1.0]:
			_beam("STL", b0 + tn * s * wd0, b1 + tn * s * wd1, 1.4, 1.4, 0.9, 7)
			if j % 2 == 0:
				_beam("STL", b0 + tn * s * wd0, b1 + up * h1, 1.0, 1.0, 0.8, 7)
			else:
				_beam("STL", b0 + up * h0, b1 + tn * s * wd1, 1.0, 1.0, 0.8, 7)
		_beam("STL", b0 + up * h0, b1 + up * h1, 1.4, 1.4, 0.9, 7)
		_beam("STL", b1 - tn * wd1, b1 + tn * wd1, 1.0, 1.0, 0.8, 7)
	var king := _pol(HEAD_R - 3.0, a, 484.0)
	_beam("STL", _pol(HEAD_R - 3.0, a, y + 6.0), king, 2.2, 2.2, 0.85, 7)
	_beam("STL", king, root.lerp(tip, 0.55) + up * 5.0, 0.7, 0.7, 0.6, 7)
	_beam("STL", king, tip + up * 2.6, 0.7, 0.7, 0.6, 7)
	var hook := tip - up * (ln * 0.75)
	_pipe("STL", tip, hook, 0.45, 6, 0.5, 7)
	_bx("HAZ", Vector3(3.6, 5.0, 3.6), hook - up * 2.2, Vector3(0, -a, 0), {"bx": 0.5, "bz": 0.5}, 1.0, 7)
	_lamp(tip + up * 4.0, 6.0, RED, 1, 7)
	_cbox(7, Vector3(7, ln, 8), _bas(tip - root), (root + tip) * 0.5 + up * 3.0)


# clamp head: control drum, cable clamp, tensioner ring, crane jibs
func _build_head() -> void:
	var hr := HEAD_R
	_cy("CON", hr, CORE_R0 + 1.0, 10.0, Vector3(0, 437.0, 0), Vector3.ZERO, 16, 0.86, 7)
	_cy("CON", hr - 1.0, hr - 1.0, 26.0, Vector3(0, 455.0, 0), Vector3.ZERO, 16, 0.55, 7)
	for q in 16:
		var a := q * TAU / 16.0
		_bx("FAC", Vector3(1.8, 22.5, hr * 0.37), _pol(hr - 0.8, a, 455.0), Vector3(0, -a, 0), {}, 0.95, 7)
		_bx("STL", Vector3(2.4, 26.0, 1.4), _pol(hr - 0.4, a + TAU / 32.0, 455.0), Vector3(0, -a - TAU / 32.0, 0), {}, 0.8, 7)
	_cy("CON", hr + 6.0, hr + 5.0, 2.6, Vector3(0, 469.3, 0), Vector3.ZERO, 24, 0.82, 7)
	_cy("HAZ", hr + 6.3, hr + 6.3, 1.3, Vector3(0, 469.8, 0), Vector3.ZERO, 24, 1.0, 7)
	_ccyl(7, hr, 432.0, 468.0)
	_ccyl(7, hr + 6.0, 468.0, 470.6)
	_ccyl(7, 14.0, 470.6, 486.0)
	for q in 24:
		var a0 := q * TAU / 24.0
		_beam("STL", _pol(hr + 5.4, a0, 472.0), _pol(hr + 5.4, a0 + TAU / 24.0, 472.0), 0.25, 0.25, 0.9, 7)
		_bx("STL", Vector3(0.25, 1.4, 0.25), _pol(hr + 5.4, a0, 471.3), Vector3.ZERO, {}, 0.9, 7)
	# cable clamp
	for q in 4:
		var a := PI * 0.25 + q * HZ
		_bx("STL", Vector3(11, 15, 15), _pol(13.0, a, 478.0), Vector3(0, -a, 0), {"tx": 0.55, "tz": 0.7}, 0.9, 7)
		_bx("HAZ", Vector3(1.0, 6, 12), _pol(18.6, a, 474.0), Vector3(0, -a, 0), {}, 1.0, 7)
	_cy("STL", 7.0, 8.0, 15.4, Vector3(0, 478.3, 0), Vector3.ZERO, 12, 0.45, 7)
	for a: float in [0.6, 0.6 + PI]:
		_pipe("COR", _pol(27.0, a, 480.0) - _tan(a) * 2.8, _pol(27.0, a, 480.0) + _tan(a) * 2.8, 9.0, 16, 1.0, 7)
		_bx("STL", Vector3(8, 9, 9), _pol(27.0, a, 475.0), Vector3(0, -a, 0), {"tx": 0.5}, 0.8, 7)
	# tensioner ring carried on spokes
	var rr := hr + 21.0
	for q in 16:
		var a0 := q * TAU / 16.0
		var a1 := a0 + TAU / 16.0
		var p0 := _pol(rr, a0, 476.0)
		var p1 := _pol(rr, a1, 476.0)
		_beam("STL", p0, p1, 5.5, 4.4, 0.9, 7)
		_beam("HAZ", p0 + Vector3(0, 2.5, 0), p1 + Vector3(0, 2.5, 0), 5.9, 0.7, 1.0, 7)
		_cbox(7, Vector3(5.5, p0.distance_to(p1), 5.0), _bas(p1 - p0), (p0 + p1) * 0.5)
		if q % 2 == 0:
			_beam("STL", _pol(hr - 1.0, a0, 466.0), _pol(rr - 1.5, a0, 475.0), 2.6, 2.6, 0.85, 7)
			_beam("STL", _pol(hr - 1.0, a0, 446.0), _pol(rr - 1.5, a0, 474.0), 1.8, 1.8, 0.8, 7)
			_lamp(p0 + Vector3(cos(a0) * 3.8, 0.5, sin(a0) * 3.8), 3.6, RED, 0, 7)
	_jib(2.6, 66.0, 461.0)
	_jib(2.6 + PI, 42.0, 461.0)
	for j in 3:
		_bx("CON", Vector3(7, 5, 9), _pol(hr + 33.0 + j * 2.0, 2.6 + PI, 459.0 - j * 5.2), Vector3(0, -2.6 - PI, 0), {}, 0.8, 7)


func _build_mast() -> void:
	_bx("STL", Vector3(20, 4, 20), Vector3(0, 488.0, 0), Vector3.ZERO, {"tx": 0.85, "tz": 0.85}, 0.8, 8)
	var lv := 6
	for q in 4:
		var a := PI * 0.25 + q * HZ
		_beam("STL", _pol(11.0, a, 490.0), _pol(3.2, a, 538.0), 1.8, 1.8, 0.9, 8)
		for j in lv:
			var u0 := float(j) / lv
			var u1 := float(j + 1) / lv
			var y0 := lerpf(490.0, 538.0, u0)
			var y1 := lerpf(490.0, 538.0, u1)
			var r0 := lerpf(11.0, 3.2, u0)
			var r1 := lerpf(11.0, 3.2, u1)
			_beam("STL", _pol(r1, a, y1), _pol(r1, a + HZ, y1), 1.1, 1.1, 0.85, 8)
			_beam("STL", _pol(r0, a, y0), _pol(r1, a + HZ, y1), 1.0, 1.0, 0.8, 8)
			_beam("STL", _pol(r0, a + HZ, y0), _pol(r1, a, y1), 1.0, 1.0, 0.8, 8)
	# what is left of the cable
	_cy("STL", 3.4, 4.2, 34.0, Vector3(0, 503.0, 0), Vector3.ZERO, 10, 0.3, 8)
	for j in 5:
		var a := j * 1.3 + 0.4
		_pipe("STL", Vector3(0, 518.0, 0), Vector3(cos(a) * (5.0 + j * 1.6), 529.0 - j * 2.2, sin(a) * (5.0 + j * 1.6)), 0.55, 6, 0.3, 8)
	_bx("STL", Vector3(0.9, 10, 0.9), Vector3(0, 543.0, 0), Vector3.ZERO, {}, 0.8, 8)
	_bx("STL", Vector3(7, 0.6, 7), Vector3(0, 538.3, 0), Vector3.ZERO, {}, 0.8, 8)
	_ccyl(8, 9.0, 486.0, 538.0)
	_lamp(Vector3(0, 548.6, 0), 12.0, WHITE, 2, 8)
	for q in 4:
		_lamp(_pol(4.6, q * HZ, 539.4), 8.0, RED, 1, 8)
		_lamp(_pol(8.4, PI * 0.25 + q * HZ, 514.0), 3.6, RED, 0, 8)


# broken edges: shards and rebar hidden inside the neighbouring section until the two part
func _build_fringes() -> void:
	for si in NSEC - 2:
		var y: float = CUTS[si + 1]
		var rr := _core_r(y) - 4.6
		var tall := 26.0 if si == 0 else 13.0
		for q in 11:
			var a := q * TAU / 11.0 + _rng.randf_range(-0.2, 0.2)
			var r := rr * _rng.randf_range(0.6, 0.86)
			var h := _rng.randf_range(tall * 0.35, tall)
			var sz := Vector3(_rng.randf_range(2.5, 5.0), h, _rng.randf_range(4.0, 7.5))
			var tilt := Vector3(_rng.randf_range(-0.1, 0.1), -a, _rng.randf_range(-0.1, 0.1))
			# up from the lower section, down from the upper one
			_bx("CON", sz, _pol(r, a, y + h * 0.5 - 1.0), tilt, {"tx": 0.25, "tz": _rng.randf_range(0.2, 0.7)}, 0.5, si)
			if q % 2 == 0:
				_bx("CON", sz * Vector3(1, 0.6, 1), _pol(r, a + 0.3, y - h * 0.3 + 1.0), tilt, {"bx": 0.25, "bz": _rng.randf_range(0.2, 0.7)}, 0.5, si + 1)
		for q in 9:
			var a := _rng.randf() * TAU
			var p := _pol(rr * _rng.randf_range(0.2, 0.72), a, y - 1.0)
			var lean := Vector3(_rng.randf_range(-0.2, 0.2), 1.0, _rng.randf_range(-0.2, 0.2))
			_beam("STL", p, p + lean * _rng.randf_range(tall * 0.4, tall * 1.05), 0.7, 0.7, 0.45, si)
	# buttress stubs
	for q in 4:
		var a := PI * 0.25 + q * HZ
		for j in 5:
			var h := _rng.randf_range(4.0, 12.0)
			var p := _pol(_but_c(60.0) + _rng.randf_range(-7.0, 7.0), a, 60.0 + h * 0.5 - 1.0) + _tan(a) * _rng.randf_range(-5.5, 5.5)
			_bx("CON", Vector3(_rng.randf_range(3.0, 6.0), h, _rng.randf_range(3.0, 6.0)), p, Vector3(_rng.randf_range(-0.15, 0.15), _rng.randf() * 3.0, _rng.randf_range(-0.15, 0.15)), {"tx": 0.3, "tz": 0.4}, 0.5, 0)
		for j in 3:
			var p := _pol(_but_c(60.0) + _rng.randf_range(-6.0, 6.0), a, 59.0) + _tan(a) * _rng.randf_range(-5.0, 5.0)
			_beam("STL", p, p + Vector3(_rng.randf_range(-0.4, 0.4), 1.0, _rng.randf_range(-0.4, 0.4)) * _rng.randf_range(5.0, 11.0), 0.7, 0.7, 0.45, 0)


# rubble mound that rises out of the dust while the lower half pancakes
func _build_rubble() -> void:
	var base := _gmin - 3.0
	_rub_h = deck + 44.0 - base
	_k.dust = 0.8
	_k.dust_top = base + _rub_h * 1.2
	_rub = _k.bone(self, Vector3(0, base, 0))
	_rub.name = "rubble"
	var r := _rng
	_k.cyl(_rub, "CON", MOUND_TOP_R, MOUND_R, _rub_h, Vector3(0, _rub_h * 0.5, 0), Vector3.ZERO, 28, 0.6)
	var fa := atan2(fall_dir.z, fall_dir.x)
	for i in 270:
		var rr := sqrt(r.randf()) * (MOUND_R + 8.0)
		var a := r.randf() * TAU
		if i >= 225:
			# spill toward the fall side
			rr = r.randf_range(MOUND_R - 10.0, MOUND_R + 70.0)
			a = fa + r.randf_range(-0.9, 0.9)
		var sy := _mound_y(rr, 1.0) - base
		if rr > MOUND_R:
			sy = _gl0(cos(a) * rr, sin(a) * rr) - base
		var big := r.randf() < 0.2
		var sz := Vector3(r.randf_range(7.0, 22.0), r.randf_range(1.5, 5.0), r.randf_range(6.0, 18.0)) * (1.6 if big else 1.0)
		var rot := Vector3(r.randf_range(-0.55, 0.55), r.randf() * TAU, r.randf_range(-0.55, 0.55))
		var roll := r.randf()
		var key := "CON" if roll < 0.62 else ("FAC" if roll < 0.78 else ("COR" if roll < 0.9 else "STL"))
		_k.box(_rub, key, sz, Vector3(cos(a) * rr, sy + sz.y * 0.3, sin(a) * rr), rot, {"tx": r.randf_range(0.6, 1.0), "tz": r.randf_range(0.6, 1.0)}, r.randf_range(0.5, 0.95))
	# wall slabs leaning on the stump, twisted steel
	for i in 16:
		var a := r.randf() * TAU
		var rr := r.randf_range(42.0, 70.0)
		var sy := _mound_y(rr, 1.0) - base
		var h := r.randf_range(16.0, 36.0)
		_k.box(_rub, "CON" if i % 3 > 0 else "FAC", Vector3(r.randf_range(10.0, 24.0), h, r.randf_range(3.0, 6.0)), Vector3(cos(a) * rr, sy + h * 0.25, sin(a) * rr), Vector3(r.randf_range(-0.2, 0.2), -a + HZ, r.randf_range(0.35, 0.9)), {"tx": r.randf_range(0.3, 0.9)}, r.randf_range(0.55, 0.9))
	for i in 70:
		var a := r.randf() * TAU
		var rr := sqrt(r.randf()) * (MOUND_R + 10.0)
		var sy := _mound_y(rr, 1.0) - base
		var ln := r.randf_range(18.0, 58.0)
		var th := r.randf_range(1.0, 2.4)
		_k.box(_rub, "STL", Vector3(th, ln, th), Vector3(cos(a) * rr, sy + ln * 0.18, sin(a) * rr), Vector3(r.randf_range(0.5, 1.45), r.randf() * TAU, r.randf_range(-0.4, 0.4)), {}, r.randf_range(0.5, 0.9))
	# pieces of ring deck
	for i in 6:
		var a := r.randf() * TAU
		var rr := r.randf_range(55.0, 112.0)
		var sy := _mound_y(rr, 1.0) - base
		_k.cyl(_rub, "CON", 16.0, 15.0, 2.4, Vector3(cos(a) * rr, sy + 3.0, sin(a) * rr), Vector3(r.randf_range(-0.7, 0.7), r.randf() * TAU, r.randf_range(-0.7, 0.7)), 10, 0.7)
	_k.dust = 0.5


# mound surface height (origin space) at radius r for growth k
func _mound_y(r: float, k: float) -> float:
	var base := _gmin - 3.0
	return base + _rub_h * k * clampf((MOUND_R - r) / (MOUND_R - MOUND_TOP_R), 0.0, 1.0)


func _build_ruin_colliders() -> void:
	_ruin_body = StaticBody3D.new()
	_ruin_body.collision_layer = 1
	_ruin_body.collision_mask = 0
	add_child(_ruin_body)
	var pts := PackedVector3Array()
	var base := _gmin - 5.0
	for i in 14:
		var a := i * TAU / 14.0
		pts.append(Vector3(cos(a) * MOUND_R, base, sin(a) * MOUND_R))
		pts.append(Vector3(cos(a) * MOUND_TOP_R, _gmin - 3.0 + _rub_h, sin(a) * MOUND_TOP_R))
	var hull := ConvexPolygonShape3D.new()
	hull.points = pts
	_mound_cs = CollisionShape3D.new()
	_mound_cs.shape = hull
	_mound_cs.disabled = true
	_ruin_body.add_child(_mound_cs)


func _build_halos() -> void:
	var v := PackedVector3Array()
	var uv := PackedVector2Array()
	var uv2 := PackedVector2Array()
	var col := PackedColorArray()
	var idx := PackedInt32Array()
	for h in _halos:
		var b := v.size()
		var c: Color = h[2]
		for q in 4:
			v.append(h[0])
			uv.append(Vector2(float(q == 1 or q == 2), float(q >= 2)))
			uv2.append(Vector2(float(h[1]), float(h[4])))
			col.append(Color(c.r, c.g, c.b, 0.05 + 0.4 * int(h[3])))
		idx.append_array(PackedInt32Array([b, b + 1, b + 2, b, b + 2, b + 3]))
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = v
	arr[Mesh.ARRAY_TEX_UV] = uv
	arr[Mesh.ARRAY_TEX_UV2] = uv2
	arr[Mesh.ARRAY_COLOR] = col
	arr[Mesh.ARRAY_INDEX] = idx
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	var sh := Shader.new()
	sh.code = HALO_SHADER
	_halo_mat = ShaderMaterial.new()
	_halo_mat.shader = sh
	_halo_mat.set_shader_parameter("tex", Tex.glow)
	_halo = MeshInstance3D.new()
	_halo.mesh = m
	_halo.material_override = _halo_mat
	_halo.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_halo.custom_aabb = AABB(Vector3(-140, -40, -140), Vector3(280, HEIGHT + 100.0, 280))
	add_child(_halo)
	_halos.clear()
	# real light near the ground where frames walk
	for q in 4:
		var a := PI * 0.25 + q * HZ
		var l := OmniLight3D.new()
		l.light_color = RED
		l.omni_range = 90.0
		l.omni_attenuation = 1.2
		l.shadow_enabled = false
		l.position = _pol(120.0, a, deck + 22.0)
		add_child(l)
		_lamps.append(l)


func _particles(amount: int, life: float, proc: Shader, mesh: Mesh) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.amount = amount
	p.lifetime = life
	p.emitting = false
	p.local_coords = false
	p.visibility_aabb = AABB(Vector3(-4000, -800, -4000), Vector3(8000, 3000, 8000))
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var pm := ShaderMaterial.new()
	pm.shader = proc
	p.process_material = pm
	p.draw_pass_1 = mesh
	add_child(p)
	return p


# own particle pools: the shared fx puffs top out at 16 m, a 500 m collapse needs 100 m ones
func _build_fx() -> void:
	var sun := Vector3(-0.92, 0.26, 0.33)
	if game.world != null and "sun_dir" in game.world:
		sun = game.world.sun_dir
	var proc := Shader.new()
	proc.code = PUFF_PROC
	var draw := Shader.new()
	draw.code = PUFF_DRAW % ["blend_mix", "0"]
	var q := QuadMesh.new()
	var dm := ShaderMaterial.new()
	dm.shader = draw
	dm.render_priority = -1
	dm.set_shader_parameter("tex", Tex.puff)
	dm.set_shader_parameter("sun_dir", sun)
	q.material = dm
	_puffs = _particles(640, 22.0, proc, q)
	_puffs.draw_order = GPUParticles3D.DRAW_ORDER_VIEW_DEPTH
	var fdraw := Shader.new()
	fdraw.code = PUFF_DRAW % ["blend_add", "1"]
	var fq := QuadMesh.new()
	var fm := ShaderMaterial.new()
	fm.shader = fdraw
	fm.set_shader_parameter("tex", Tex.puff)
	fq.material = fm
	_fires = _particles(96, 3.0, proc, fq)
	(_fires.process_material as ShaderMaterial).set_shader_parameter("wind", Vector3.ZERO)
	(_fires.process_material as ShaderMaterial).set_shader_parameter("rise", 7.0)
	(_fires.process_material as ShaderMaterial).set_shader_parameter("drag", 1.6)
	var cproc := Shader.new()
	cproc.code = CHUNK_PROC
	var bm := BoxMesh.new()
	bm.material = Tex.armor
	_chunks = _particles(360, 45.0, cproc, bm)
	_chunks.set_instance_shader_parameter("tint", Color(0.17, 0.16, 0.15))
	_chunks.set_instance_shader_parameter("metal", 0.15)
	_chunks.set_instance_shader_parameter("wear", 1.3)
	for i in 2:
		var l := OmniLight3D.new()
		l.light_color = Color(1.0, 0.6, 0.3)
		l.omni_range = 620.0
		l.omni_attenuation = 0.45
		l.shadow_enabled = false
		l.light_energy = 0.0
		l.visible = false
		add_child(l)
		_flashes.append({"l": l, "t": 0.0, "d": 1.0, "e": 0.0})
	# one invisible particle each so the pipelines are built at load, not at the first blast
	_puff(_org, Vector3.ZERO, 1.0, 1.0, 0.3, Color(0, 0, 0, 0))
	_fire(_org, Vector3.ZERO, 1.0, 1.0, 0.3, 0.0)
	_chunk(_org - Vector3(0, 60, 0), Vector3.ZERO, 0.01, 0.3)


# ------------------------------------------------------------------ effects
func _puff(p: Vector3, v: Vector3, s0: float, s1: float, life: float, col: Color) -> void:
	_puffs.emit_particle(Transform3D(Basis.IDENTITY, p), v, col, Color(0.0, life, s0, s1), PFLAGS)


func _fire(p: Vector3, v: Vector3, s0: float, s1: float, life: float, power: float = 1.0) -> void:
	_fires.emit_particle(Transform3D(Basis.IDENTITY, p), v, Color(power, power, power, 1.0), Color(0.0, life, s0, s1), PFLAGS)


# tumbling slab that falls to the ground and stays there for a while
func _chunk(p: Vector3, v: Vector3, s: float, life: float = 36.0) -> void:
	var tf := (v.y + sqrt(maxf(v.y * v.y + 2.0 * G * maxf(p.y - _org.y, 0.0), 0.0))) / G
	var fx := p.x + v.x * tf
	var fz := p.z + v.z * tf
	var floor_y: float = game.world.height(fx, fz) + s * 0.2
	var d := Vector2(fx - _org.x, fz - _org.z).length()
	floor_y = maxf(floor_y, _org.y + _mound_y(d, _mound_k))
	var b := Basis.from_euler(Vector3(randf() * TAU, randf() * TAU, randf() * TAU)).scaled(Vector3(randf_range(0.6, 1.6), randf_range(0.25, 0.7), randf_range(0.6, 1.4)) * s)
	_chunks.emit_particle(Transform3D(b, p), v, Color(randf_range(0.5, 1.0), randf_range(0.2, 0.7), 0, 1), Color(0.0, life, floor_y, randf_range(1.0, 4.0)), CFLAGS)


# ring of ground-hugging dust rolling outward from c
func _surge(c: Vector3, radius: float, n: int, v0: float, v1: float, s0: float, s1: float, col: Color) -> void:
	for i in n:
		var a := randf() * TAU
		var dir := Vector3(cos(a), 0, sin(a))
		var p := c + dir * radius * randf_range(0.55, 1.0)
		p.y = game.world.height(p.x, p.z) + s0 * 0.3
		_puff(p, dir * randf_range(v0, v1) + Vector3(0, randf_range(0.5, 5.0), 0), s0 * randf_range(0.8, 1.2), s1 * randf_range(0.8, 1.25), randf_range(12.0, 18.0), col)
		if i % 3 == 0:
			_puff(p + Vector3(0, s0 * 0.5, 0), dir * randf_range(v0, v1) * 0.45 + Vector3(0, randf_range(14.0, 30.0), 0), s0, s1 * randf_range(0.7, 1.0), randf_range(12.0, 17.0), col)


# the shared fx explosion is built for 10 m puffs: only worth its pool slots up close
func _boom(p: Vector3, s: float = 2.5) -> void:
	if _cam.distance_squared_to(p) < 520.0 * 520.0:
		game.fx.explosion(p, s)


func _flash(p: Vector3, energy: float, dur: float) -> void:
	var f: Dictionary = _flashes[_fl_i]
	_fl_i = (_fl_i + 1) % _flashes.size()
	f["l"].global_position = p
	f["l"].light_energy = energy
	f["l"].visible = true
	f["t"] = dur
	f["d"] = dur
	f["e"] = energy


# sound arrives late over distance and is re-played near the listener so it carries
func _snd(id: String, p: Vector3, vol: float, pitch: float) -> void:
	if _snd_q.size() < 40:
		_snd_q.append([_time + minf(_cam.distance_to(p) / 343.0, 3.5), id, p, vol, pitch])


func _tick_sounds() -> void:
	var i := 0
	while i < _snd_q.size():
		var e: Array = _snd_q[i]
		if float(e[0]) > _time:
			i += 1
			continue
		var p: Vector3 = e[2]
		var d := _cam.distance_to(p)
		game.sfx.play(e[1], _cam + (p - _cam) / maxf(d, 1.0) * 30.0, float(e[3]) * clampf(520.0 / (d + 260.0), 0.2, 1.5), e[4])
		_snd_q.remove_at(i)


func _shake(amount: float, p: Vector3, reach: float = 1700.0) -> void:
	var k := clampf(1.0 - _cam.distance_to(p) / reach, 0.0, 1.0)
	if k > 0.0:
		game.shake(amount * k)


func _stage(id: String) -> void:
	stage_changed.emit(id)


func _seg_closest(p: Vector3, a: Vector3, b: Vector3) -> Vector3:
	var ab := b - a
	var l2 := ab.length_squared()
	if l2 < 0.01:
		return a
	return a + ab * clampf((p - a).dot(ab) / l2, 0.0, 1.0)


# damage every unit near the segment a-b: full inside r_full, fading to nothing at r_zero
func _hurt(a: Vector3, b: Vector3, r_full: float, r_zero: float, dmg: float) -> void:
	if dmg <= 0.0 or not ("units" in game):
		return
	for u in game.units.duplicate():
		if not is_instance_valid(u) or not u.alive:
			continue
		var p: Vector3 = u.global_position + Vector3(0, 8, 0)
		var c := _seg_closest(p, a, b)
		var d := p.distance_to(c)
		if d >= r_zero:
			continue
		var k := 1.0 if d <= r_full else 1.0 - (d - r_full) / (r_zero - r_full)
		u.take_damage(dmg * k, 400.0 * k, null, "splash", c)


func _tick_lights() -> void:
	var pw := 1.0
	if state != "intact":
		if _halo_pw == 0.0 and t_collapse >= 1.6:
			return
		# power fails: stutter, then dark
		pw = 0.0
		if t_collapse < 1.6 and randf() < 0.85 - t_collapse * 0.5:
			pw = randf_range(0.3, 1.0)
	_halo_mat.set_shader_parameter("t", _time)
	if pw != _halo_pw:
		_halo_pw = pw
		_halo_mat.set_shader_parameter("power", pw)
		_halo.visible = pw > 0.0
	var x := fposmod(_time / 1.7, 1.0)
	var bk := smoothstep(0.0, 0.12, x) * (1.0 - smoothstep(0.35, 0.6, x))
	for l in _lamps:
		l.light_energy = (0.3 + 5.0 * bk) * pw
		l.visible = pw > 0.0


# ------------------------------------------------------------------ collapse events
func _at(t: float, c: Callable) -> void:
	_events.append([t, c])


func _sec_xf(si: int) -> Transform3D:
	var n: Node3D = secs[si].node
	return Transform3D(n.transform.basis, _org + n.transform.origin)


func _body_of(si: int) -> Body:
	for b in bodies:
		if b.secs.has(secs[si]):
			return b
	return null


# ring of cutting charges around the shaft at tower height ty
func _charge(ty: float, power: float) -> void:
	var si := _sec_at(ty + 0.1)
	var xf := _sec_xf(si)
	var c: Vector3 = xf * Vector3(0, ty - CUTS[si], 0)
	var rr := _hull_r(ty) + 2.0
	var a0 := randf() * TAU
	var near := _cam.distance_to(c) < 900.0
	for i in 4:
		var a := a0 + i * HZ + randf_range(-0.3, 0.3)
		var dir: Vector3 = (xf.basis * Vector3(cos(a), 0, sin(a))).normalized()
		var p := c + dir * rr
		if i % 2 == 0:
			_boom(p)
		_fire(p + dir * 6.0, dir * 16.0, 24.0 * power, 64.0 * power, 0.8)
		_puff(p + dir * 8.0, dir * randf_range(20.0, 36.0) + Vector3(0, randf_range(2.0, 9.0), 0), 16.0, 60.0 * power, randf_range(7.0, 10.0), SMOKE)
		for j in 3:
			_chunk(p, dir * randf_range(14.0, 44.0) + Vector3(randf_range(-9, 9), randf_range(-4, 18), randf_range(-9, 9)), randf_range(2.0, 6.0))
		if near and i == 0:
			game.fx.chunks(p, 2, 2.0)
	_flash(c + Vector3(0, 6, 0), 16.0 * power, 0.5)
	_snd("explosion", c, 1.1, randf_range(0.5, 0.62))
	_shake(0.2 * power, c)
	for m in secs[si].meshes:
		m.set_instance_shader_parameter("wreck", 0.12)


func _groan(pitch: float) -> void:
	var c := _org + Vector3(0, deck + CUTS[HINGE_SEC], 0)
	_snd("clang", c, 1.3, pitch)
	_snd("land", c, 1.2, pitch * 1.2)
	_shake(0.12, c)


# the felling cut: the fall side of the shaft is blown out and the upper half starts to lean
func _cut() -> void:
	var hy: float = CUTS[HINGE_SEC]
	var c := _org + Vector3(0, deck + hy, 0)
	var rr := _core_r(hy)
	var fa := atan2(fall_dir.z, fall_dir.x)
	for i in 9:
		var a := fa + randf_range(-1.4, 1.4)
		var dir := Vector3(cos(a), 0, sin(a))
		var p := c + dir * (rr + 4.0) + Vector3(0, randf_range(-8.0, 8.0), 0)
		if i % 3 == 0:
			_boom(p)
		_fire(p + dir * 8.0, dir * 22.0, 34.0, 96.0, 1.0)
		_puff(p + dir * 10.0, dir * randf_range(24.0, 46.0) + Vector3(0, randf_range(2.0, 10.0), 0), 20.0, 80.0, randf_range(8.0, 11.0), SMOKE)
		for j in 4:
			_chunk(p, dir * randf_range(16.0, 55.0) + Vector3(randf_range(-10, 10), randf_range(-6, 22), randf_range(-10, 10)), randf_range(2.5, 8.0))
	_flash(c + fall_dir * 40.0, 34.0, 0.9)
	_snd("bigboom", c, 1.4, 0.85)
	_snd("explosion", c, 1.3, 0.42)
	_snd("collapse", c, 1.6, 0.9)
	_shake(0.5, c)
	var b := Body.new()
	for i in range(HINGE_SEC, NSEC):
		b.secs.append(secs[i])
		secs[i].body.collision_layer = 0
	b.mode = B_HINGE
	b.ref = Vector3(0, deck + hy, 0) + fall_dir * rr * 0.3
	b.pos = b.ref
	b.ang_v = HINGE_W0
	_fit(b)
	bodies.append(b)
	_stage("cut")


func _foot_charge(q: int) -> void:
	var a := PI * 0.25 + q * HZ
	var y := 34.0
	var p := _org + _pol(_but_c(y), a, deck + y)
	for i in 3:
		var o := Vector3(randf_range(-10, 10), randf_range(-12, 12), randf_range(-10, 10))
		if i == 0:
			_boom(p + o)
		_fire(p + o, Vector3(cos(a), 0.3, sin(a)) * 14.0, 28.0, 74.0, 0.9)
		for j in 3:
			_chunk(p + o, Vector3(cos(a), 0, sin(a)) * randf_range(10.0, 40.0) + Vector3(randf_range(-12, 12), randf_range(4, 30), randf_range(-12, 12)), randf_range(2.5, 7.0))
	_puff(p, Vector3(cos(a), 0.2, sin(a)) * 30.0, 20.0, 76.0, 9.0, SMOKE)
	if _cam.distance_to(p) < 700.0:
		game.fx.chunks(p, 4, 2.2)
	_flash(p, 18.0, 0.5)
	_snd("explosion", p, 1.2, randf_range(0.45, 0.55))
	_shake(0.3, p)


# hinge gives way: the leaning shaft goes ballistic and the lower half starts to pancake
func _drop() -> void:
	var b := _body_of(HINGE_SEC)
	if b != null and b.mode == B_HINGE:
		_release(b)
	for i in range(1, HINGE_SEC):
		secs[i].body.collision_layer = 0
	_stk_on = true
	_stk_v = 0.0
	_stk_d = 0.0
	_stk_total = CUTS[HINGE_SEC] - CUTS[1]
	_rub.visible = true
	var c := _org + Vector3(0, deck + 10.0, 0)
	_surge(c, 62.0, 18, 30.0, 56.0, 30.0, 110.0, DUST)
	_flash(c + Vector3(0, 30, 0), 22.0, 0.8)
	_snd("bigboom", c, 1.5, 0.6)
	_shake(0.7, c)
	_stage("drop")


# split the body holding section si between si-1 and si; the upper part flies off
func _break_at(si: int, fwd: float, side: float, spin: float) -> void:
	var b := _body_of(si)
	if b == null or b.mode == B_SETTLE or b.mode == B_REST:
		return
	var n := b.secs.find(secs[si])
	if n <= 0:
		return
	var up := _split(b, n)
	var ax: Vector3 = up.rot.y
	up.vel += ax * fwd + fall_dir * fwd * 0.6 + _axis * side
	up.w += _axis * spin + Vector3(randf_range(-0.02, 0.02), randf_range(-0.03, 0.03), randf_range(-0.02, 0.02))
	if b.mode == B_FREE:
		b.vel -= ax * fwd * 0.3 + _axis * side * 0.3
		b.w -= _axis * spin * 0.4
	# torn joint
	var c: Vector3 = _org + up.pos + up.rot * (Vector3(0, up.y0, 0) - up.ref)
	for i in 5:
		var o := Vector3(randf_range(-1, 1), randf_range(-0.3, 0.3), randf_range(-1, 1)) * up.r0
		if i % 2 == 0:
			_boom(c + o)
		_fire(c + o, up.vel * 0.5, 22.0, 60.0, 0.8)
		for j in 3:
			_chunk(c + o, up.vel * 0.6 + Vector3(randf_range(-22, 22), randf_range(-8, 16), randf_range(-22, 22)), randf_range(2.0, 7.0))
	_puff(c, up.vel * 0.4, 20.0, 70.0, 9.0, SMOKE)
	_flash(c, 14.0, 0.5)
	_snd("clang", c, 1.4, 0.3)
	_snd("explosion", c, 1.1, 0.5)
	_shake(0.3, c)
	if si == 7:
		_stage("snap")


func _fit(b: Body) -> void:
	var lo: Sec = b.secs[0]
	var hi: Sec = b.secs[b.secs.size() - 1]
	b.y0 = deck + lo.y0
	b.y1 = deck + hi.y1
	b.r0 = lo.r0
	b.r1 = hi.r1
	b.k2 = HINGE_K2 * 290.0 / maxf(b.y1 - b.y0, 60.0)


func _com(list: Array) -> Vector3:
	var m := 0.0
	var acc := 0.0
	for s in list:
		var w: float = (s.y1 - s.y0) * (s.r0 + s.r1) * (s.r0 + s.r1)
		m += w
		acc += w * (s.y0 + s.y1) * 0.5
	return Vector3(0, deck + acc / maxf(m, 0.001), 0)


func _repivot(b: Body, nr: Vector3) -> void:
	var np: Vector3 = b.pos + b.rot * (nr - b.ref)
	b.vel += b.w.cross(np - b.pos)
	b.pos = np
	b.ref = nr


func _release(b: Body) -> void:
	b.w = _axis * b.ang_v
	b.vel = Vector3.ZERO
	_repivot(b, _com(b.secs))
	b.mode = B_FREE


func _split(b: Body, n_low: int) -> Body:
	var up := Body.new()
	up.secs = b.secs.slice(n_low)
	b.secs = b.secs.slice(0, n_low)
	if b.mode == B_HINGE:
		b.w = _axis * b.ang_v
		b.vel = Vector3.ZERO
	up.ref = b.ref
	up.pos = b.pos
	up.rot = b.rot
	up.vel = b.vel
	up.w = b.w
	_repivot(up, _com(up.secs))
	up.mode = B_FREE
	_fit(up)
	if b.mode == B_FREE:
		_repivot(b, _com(b.secs))
	_fit(b)
	bodies.append(up)
	return up


# ------------------------------------------------------------------ collapse simulation
# ground under a point (origin space), including the rubble mound once it exists
func _gl(p: Vector3) -> float:
	var h := _gl0(p.x, p.z)
	if _mound_k > 0.0:
		h = maxf(h, _mound_y(Vector2(p.x, p.z).length(), _mound_k))
	return h


func _end(b: Body, e: int) -> Vector3:
	return b.pos + b.rot * (Vector3(0, b.y0 if e == 0 else b.y1, 0) - b.ref)


func _contact(b: Body) -> bool:
	var ax: Vector3 = b.rot.y
	var dn := Vector3.DOWN - ax * Vector3.DOWN.dot(ax)
	dn = dn.normalized() if dn.length_squared() > 1e-4 else Vector3.ZERO
	for e in 2:
		var p := _end(b, e) + dn * (b.r0 if e == 0 else b.r1)
		if p.y <= _gl(p):
			_hit_p = p
			return true
	var m := (_end(b, 0) + _end(b, 1)) * 0.5 + dn * (b.r0 + b.r1) * 0.5
	if m.y <= _gl(m):
		_hit_p = m
		return true
	return false


func _size_of(b: Body) -> float:
	return clampf((b.y1 - b.y0) * (b.r0 + b.r1) / 2400.0, 0.4, 1.6)


# first touch: one end digs in
func _impact(b: Body) -> void:
	var wp := _org + _hit_p
	var big := _size_of(b)
	var near := _cam.distance_squared_to(wp) < 700.0 * 700.0
	for i in 3:
		_boom(wp + Vector3(randf_range(-14, 14), randf_range(2, 14), randf_range(-14, 14)))
	if near:
		game.fx.dust(wp, 14, 12.0, 34.0, 12.0)
	_surge(wp, 14.0 * big, int(10.0 * big) + 5, 24.0, 46.0, 22.0 + 8.0 * big, 80.0 + 40.0 * big, DUST)
	_fire(wp + Vector3(0, 10, 0), Vector3(0, 8, 0), 30.0 * big, 80.0 * big, 0.9)
	for i in int(12.0 * big) + 4:
		_chunk(wp + Vector3(randf_range(-10, 10), 4.0, randf_range(-10, 10)), Vector3(randf_range(-34, 34), randf_range(14, 56), randf_range(-34, 34)), randf_range(2.0, 7.0))
	if near:
		game.fx.chunks(wp + Vector3(0, 4, 0), 5, 2.2)
	_flash(wp + Vector3(0, 24, 0), 18.0 * big, 0.7)
	_snd("bigboom", wp, clampf(1.2 * big, 0.8, 1.6), randf_range(0.7, 0.95))
	_snd("land", wp, 1.3, 0.45)
	_shake(0.7 * big, wp)
	var rr: float = (b.r0 + b.r1) * 0.5
	_hurt(wp, wp, rr + 10.0, rr + 55.0, crush_damage)
	if not _did.has("impact"):
		_did["impact"] = true
		_stage("impact")
	# lie down along the direction it was already leaning
	var ax: Vector3 = b.rot.y
	var h := Vector3(ax.x, 0, ax.z)
	h = h.normalized() if h.length() > 0.2 else fall_dir
	var half: float = (b.y1 - b.y0) * 0.5
	_repivot(b, Vector3(0, (b.y0 + b.y1) * 0.5, 0))
	var c1: Vector3 = b.pos + Vector3(b.vel.x, 0, b.vel.z) * 0.4
	var ga := _gl(c1 - h * half)
	var gb := _gl(c1 + h * half)
	var a1 := (h * half * 2.0 + Vector3.UP * (gb - ga + (b.r1 - b.r0) * SINK)).normalized()
	c1.y = (ga + gb) * 0.5 + rr * SINK
	b.q0 = b.rot.get_rotation_quaternion()
	b.q1 = (Quaternion(ax, a1) * b.q0).normalized()
	b.p0 = b.pos
	b.p1 = c1
	b.dur = clampf(ax.angle_to(a1) / 0.7, 0.8, 2.6)
	b.t = 0.0
	b.mode = B_SETTLE


# the whole length slams flat and stays
func _slam(b: Body) -> void:
	var a := _org + _end(b, 0)
	var e := _org + _end(b, 1)
	var mid := (a + e) * 0.5
	var big := _size_of(b)
	var rr: float = (b.r0 + b.r1) * 0.5
	var ax := (e - a).normalized()
	var sd := ax.cross(Vector3.UP).normalized()
	var n := int(8.0 * big) + 4
	for i in n:
		var p := a.lerp(e, (i + randf()) / n)
		var s := 1.0 if i % 2 == 0 else -1.0
		p.y = game.world.height(p.x, p.z) + 8.0
		_puff(p + sd * s * rr, sd * s * randf_range(22.0, 44.0) + Vector3(0, randf_range(1.0, 7.0), 0), 22.0, randf_range(70.0, 110.0), randf_range(11.0, 15.0), DUST)
		if i % 3 == 0 and _cam.distance_squared_to(p) < 700.0 * 700.0:
			_boom(p + Vector3(0, rr * 0.5, 0))
			game.fx.dust(p, 8, rr, 30.0, 10.0)
		_chunk(p + Vector3(0, rr, 0), sd * s * randf_range(8.0, 30.0) + Vector3(0, randf_range(10, 34), 0), randf_range(2.0, 6.0))
	_flash(mid + Vector3(0, 30, 0), 12.0 * big, 0.6)
	_snd("bigboom", mid, clampf(1.1 * big, 0.7, 1.5), randf_range(0.55, 0.75))
	_shake(0.6 * big, mid)
	_hurt(a, e, rr + 4.0, rr + 40.0, crush_damage)
	for s in b.secs:
		for m in s.meshes:
			m.set_instance_shader_parameter("wreck", randf_range(0.4, 0.55))
	# a box to stand on
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = Vector3(rr * 1.5, b.y1 - b.y0, rr * 1.5)
	cs.shape = bs
	cs.transform = Transform3D(b.rot, b.pos)
	_ruin_body.add_child(cs)
	_hot.append(mid + Vector3(0, rr * 0.6, 0))
	_hot.append(a.lerp(e, 0.15) + Vector3(0, rr * 0.5, 0))
	b.mode = B_REST
	_rest_t = t_collapse


func _apply(b: Body) -> void:
	for s in b.secs:
		s.node.transform = Transform3D(b.rot, b.pos + b.rot * (s.rest - b.ref))


func _tick_collapse(dt: float) -> void:
	t_collapse += dt
	while _ev_i < _events.size() and float(_events[_ev_i][0]) <= t_collapse:
		var c: Callable = _events[_ev_i][1]
		_ev_i += 1
		c.call()
	var moving := 0
	for b in bodies:
		if b.mode == B_HINGE:
			b.ang_v += b.k2 * sin(b.ang + HINGE_A0) * dt
			b.ang += b.ang_v * dt
			b.rot = Basis(_axis, b.ang)
			_tick_hinge_fx(b, dt)
			moving += 1
		elif b.mode == B_FREE:
			b.vel.y -= G * dt
			b.pos += b.vel * dt
			var wl: float = b.w.length()
			if wl > 1e-5:
				b.rot = (Basis(b.w / wl, wl * dt) * b.rot).orthonormalized()
			_tick_trail(b, dt)
			_sweep_town(b)
			if _contact(b):
				_impact(b)
			moving += 1
		elif b.mode == B_SETTLE:
			b.t += dt
			var u := clampf(b.t / b.dur, 0.0, 1.0)
			b.rot = Basis(b.q0.slerp(b.q1, u * u))
			var e := 1.0 - (1.0 - u) * (1.0 - u)
			b.pos = Vector3(lerpf(b.p0.x, b.p1.x, e), lerpf(b.p0.y, b.p1.y, u * u), lerpf(b.p0.z, b.p1.z, e))
			b.trail -= dt
			if b.trail <= 0.0:
				b.trail = 0.12
				var p := _org + _end(b, randi() % 2).lerp(b.pos, randf())
				p.y = game.world.height(p.x, p.z) + 6.0
				_puff(p, Vector3(randf_range(-16, 16), randf_range(2, 8), randf_range(-16, 16)), 18.0, 60.0, 10.0, DUST)
			moving += 1
			_sweep_town(b)
			if u >= 1.0:
				_slam(b)
		if b.mode != B_REST:
			_apply(b)
	_tick_stack(dt)
	_tick_town(dt)
	if _ev_i >= _events.size() and moving == 0 and not _stk_on and _rest_t >= 0.0:
		if not _did.has("down"):
			_did["down"] = true
			_stage("down")
			_finish_ruin()
		_tick_ruin(dt)
		if t_collapse > _rest_t + 9.0:
			state = "ruin"
			_stage("ruin")


func _tick_hinge_fx(b: Body, dt: float) -> void:
	var c := _org + b.pos
	_acc["hinge"] += dt
	if _acc["hinge"] > 0.12:
		_acc["hinge"] = 0.0
		var p := c + fall_dir * randf_range(-4.0, 16.0) + _axis * randf_range(-18.0, 18.0) + Vector3(0, randf_range(-5, 5), 0)
		if _cam.distance_squared_to(c) < 520.0 * 520.0:
			game.fx.emit("fire", p, Vector3(randf_range(-4, 4), randf_range(2, 9), randf_range(-4, 4)))
			game.fx.emit("smoke", p, fall_dir * randf_range(2, 8) + Vector3(0, randf_range(3, 9), 0))
		elif randf() < 0.35:
			_fire(p, Vector3(0, 4, 0), 10.0, 26.0, 0.6, 0.6)
	_acc["hsmoke"] += dt
	if _acc["hsmoke"] > 0.5:
		_acc["hsmoke"] = 0.0
		_puff(c + fall_dir * 10.0 + _axis * randf_range(-14.0, 14.0), fall_dir * 5.0 + Vector3(0, 4, 0), 14.0, 50.0, 7.0, SMOKE)
	_acc["hchunk"] += dt
	if _acc["hchunk"] > 0.22:
		_acc["hchunk"] = 0.0
		_chunk(c + fall_dir * randf_range(6.0, 22.0) + _axis * randf_range(-16.0, 16.0), fall_dir * randf_range(2.0, 14.0) + Vector3(randf_range(-4, 4), randf_range(-6, 4), randf_range(-4, 4)), randf_range(1.5, 5.0))


func _tick_trail(b: Body, dt: float) -> void:
	b.trail -= dt
	if b.trail > 0.0:
		return
	b.trail = 0.22
	var p := _org + _end(b, 0)
	_puff(p, b.vel * 0.35, 14.0, 52.0, 7.0, Color(GREY.r, GREY.g, GREY.b, 0.3))
	_chunk(p + Vector3(randf_range(-8, 8), 0, randf_range(-8, 8)), b.vel * 0.7 + Vector3(randf_range(-10, 10), randf_range(-4, 8), randf_range(-10, 10)), randf_range(1.5, 4.5))
	if _cam.distance_squared_to(p) < 520.0 * 520.0:
		game.fx.emit("fire", p, b.vel * 0.5)
		game.fx.emit("smoke", p, b.vel * 0.3)


# lower half: crushes from the bottom up, each section squashed against the stump
func _tick_stack(dt: float) -> void:
	if not _stk_on:
		return
	_stk_v = minf(_stk_v + STACK_G * dt, 66.0)
	_stk_d += _stk_v * dt
	var p := clampf(_stk_d / _stk_total, 0.0, 1.0)
	_mound_k = p * p * (3.0 - 2.0 * p)
	_rub.scale = Vector3(1, maxf(_mound_k, 0.03), 1)
	for m in secs[0].meshes:
		m.set_instance_shader_parameter("wreck", 0.12 + 0.22 * p)
	var rem := _stk_d
	var base: float = deck + CUTS[1] - 14.0 * p
	var lean := -fall_dir * 9.0 * p
	var all := true
	for i in range(1, HINGE_SEC):
		var s: Sec = secs[i]
		var hh := s.y1 - s.y0
		var hmin := hh * 0.07
		var h := clampf(hh - rem, hmin, hh)
		rem = maxf(0.0, rem - (hh - hmin))
		var k := h / hh
		var wob := 0.035 * p * sin(t_collapse * 2.3 + i * 1.9)
		var rb := Basis(_axis, -0.05 * p + wob)
		var sx := 1.0 + (1.0 - k) * 0.12
		s.node.transform = Transform3D(Basis(rb.x * sx, rb.y * k, rb.z * sx), Vector3(lean.x * (i - 1) * 0.4, base, lean.z * (i - 1) * 0.4))
		base += h
		if k <= 0.0701:
			if not s.crushed:
				s.crushed = true
				_crush(i)
		else:
			all = false
	var c := _org + Vector3(0, deck, 0)
	var top_y: float = base
	_acc["surge"] += dt * 13.0
	while _acc["surge"] >= 1.0:
		_acc["surge"] -= 1.0
		_surge(c, 72.0, 1, 26.0 + 30.0 * p, 44.0 + 34.0 * p, 34.0, 150.0, DUST)
	_acc["col"] += dt * 6.0
	while _acc["col"] >= 1.0:
		_acc["col"] -= 1.0
		var a := randf() * TAU
		_puff(_org + Vector3(cos(a) * 28.0, randf_range(deck + 30.0, maxf(top_y, deck + 40.0)), sin(a) * 28.0), Vector3(cos(a) * 11.0, randf_range(-10.0, 4.0), sin(a) * 11.0), 30.0, randf_range(90.0, 125.0), randf_range(12.0, 17.0), GREY)
	_acc["schunk"] += dt * 6.0
	while _acc["schunk"] >= 1.0:
		_acc["schunk"] -= 1.0
		var a := randf() * TAU
		_chunk(_org + Vector3(cos(a) * 34.0, deck + 62.0, sin(a) * 34.0), Vector3(cos(a) * randf_range(12, 46), randf_range(4, 30), sin(a) * randf_range(12, 46)), randf_range(2.0, 7.0))
	_acc["sdust"] += dt
	if _acc["sdust"] > 0.1:
		_acc["sdust"] = 0.0
		if _cam.distance_to(c) < 800.0:
			game.fx.dust(c + Vector3(0, -deck, 0), 5, 78.0, 44.0, 9.0)
	_acc["sshake"] += dt
	if _acc["sshake"] > 0.3:
		_acc["sshake"] = 0.0
		_shake(0.16, c)
	_acc["srumble"] += dt
	if _acc["srumble"] > 1.7:
		_acc["srumble"] = 0.0
		_snd("bigboom", c, 1.0, randf_range(0.5, 0.68))
	if all:
		_stk_on = false
		_mound_k = 1.0
		_rub.scale = Vector3.ONE
		_rest_t = maxf(_rest_t, t_collapse)


func _crush(i: int) -> void:
	secs[i].node.visible = false
	var c := _org + Vector3(0, deck, 0)
	var last := i == HINGE_SEC - 1
	_surge(c, 64.0, 22 if last else 12, 40.0, 72.0 if last else 60.0, 36.0, 150.0, DUST)
	for q in (14 if last else 8):
		var a := randf() * TAU
		var sp := randf_range(4.0, 26.0)
		_puff(c + Vector3(cos(a) * 30.0, randf_range(10.0, 50.0), sin(a) * 30.0), Vector3(cos(a) * sp, randf_range(26.0, 58.0), sin(a) * sp), 40.0, randf_range(120.0, 170.0), randf_range(14.0, 19.0), GREY)
	for q in 3:
		var a := randf() * TAU
		_boom(c + Vector3(cos(a) * 66.0, randf_range(4, 30), sin(a) * 66.0))
		_fire(c + Vector3(cos(a) * 50.0, randf_range(10, 40), sin(a) * 50.0), Vector3(cos(a) * 10.0, 6.0, sin(a) * 10.0), 26.0, 70.0, 0.9, 0.7)
	for q in 14:
		var a := randf() * TAU
		_chunk(c + Vector3(cos(a) * 40.0, 50.0, sin(a) * 40.0), Vector3(cos(a) * randf_range(16, 60), randf_range(10, 44), sin(a) * randf_range(16, 60)), randf_range(2.5, 8.0))
	if _cam.distance_to(c) < 700.0:
		game.fx.chunks(c + Vector3(80, 6, 0).rotated(Vector3.UP, randf() * TAU), 5, 2.4)
	_flash(c + Vector3(0, 50, 0), 14.0, 0.7)
	_snd("bigboom", c, 1.5, 0.62 - i * 0.04)
	_shake(1.0 if last else 0.75, c)
	_hurt(c - Vector3(0, 20, 0), c + Vector3(0, 50, 0), 76.0, 125.0, crush_damage)


# everything is down: swap the tall colliders for the ruin
func _finish_ruin() -> void:
	for i in range(1, NSEC):
		secs[i].body.queue_free()
		secs[i].body = null
	_mound_cs.disabled = false
	_hot.append(_org + Vector3(0, deck + 66.0, 0))
	for q in 3:
		var a := randf() * TAU
		_hot.append(_org + Vector3(cos(a) * 70.0, _mound_y(70.0, 1.0) + 4.0, sin(a) * 70.0))


# lingering smoke and fires over the wreck
func _tick_ruin(dt: float) -> void:
	if _hot.is_empty():
		return
	_acc["rsmoke"] += dt
	if _acc["rsmoke"] > 0.45:
		_acc["rsmoke"] = 0.0
		var i := randi() % mini(_hot.size(), 4)
		var p: Vector3 = _hot[_hot.size() - 1 - i] if randf() < 0.5 else _hot[randi() % _hot.size()]
		if _cam.distance_to(p) < 2200.0:
			_puff(p + Vector3(randf_range(-8, 8), 0, randf_range(-8, 8)), Vector3(randf_range(-2, 2), randf_range(9, 15), randf_range(-2, 2)), 14.0, randf_range(46.0, 70.0), randf_range(11.0, 15.0), Color(SMOKE.r, SMOKE.g, SMOKE.b, 0.42))
	_acc["ruin"] += dt
	if _acc["ruin"] > 0.16:
		_acc["ruin"] = 0.0
		var p: Vector3 = _hot[randi() % _hot.size()]
		var d := _cam.distance_to(p)
		if d < 700.0:
			var o := Vector3(randf_range(-9, 9), randf_range(-3, 3), randf_range(-9, 9))
			game.fx.emit("smoke", p + o, Vector3(randf_range(2, 5), randf_range(6, 10), randf_range(-1, 2)))
			if d < 500.0 and randf() < 0.6:
				game.fx.emit("fire", p + o + Vector3(0, -2, 0), Vector3(0, randf_range(2, 6), 0))


# ------------------------------------------------------------------ shaders
const HALO_SHADER := """shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, shadows_disabled, fog_disabled, skip_vertex_transform;
// Warning-light glow: every lamp is a camera-facing quad, blink pattern picked by COLOR.a.
uniform sampler2D tex : repeat_disable;
uniform float t = 0.0;
uniform float power = 1.0;
varying float glow;

void vertex() {
	vec3 c = (MODELVIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
	float dist = length(c);
	float sz = UV2.x * clamp(dist / 420.0, 0.6, 1.5);
	float ph = UV2.y;
	float g = 0.85 + 0.15 * sin(t * 7.0 + ph * 40.0);
	if (COLOR.a > 0.7) {
		float x = fract(t / 2.3 + ph * 0.02);
		g = (step(x, 0.035) + step(0.1, x) * step(x, 0.135)) * 2.6 + 0.02;
	} else if (COLOR.a > 0.3) {
		float x = fract(t / 1.7);
		g = smoothstep(0.0, 0.12, x) * (1.0 - smoothstep(0.35, 0.6, x)) * 1.6 + 0.05;
	}
	glow = g * power;
	c.xy += (UV - 0.5) * sz;
	c.z += min(4.0, dist * 0.02);
	VERTEX = c;
}

void fragment() {
	float a = texture(tex, UV).a;
	ALBEDO = COLOR.rgb * (a * 0.8 + a * a * a * 3.0) * glow;
}
"""

const PUFF_PROC := """shader_type particles;
// CUSTOM: x age 0..1, y life in seconds, z start size, w end size. Velocity relaxes to the wind.
uniform vec3 wind = vec3(4.0, 0.0, 1.0);
uniform float rise = 3.0;
uniform float drag = 0.55;

float hash(float n) {
	return fract(sin(n * 12.9898) * 43758.5453);
}

void start() {
	if (RESTART_ROT_SCALE) {
		TRANSFORM[0].xyz = vec3(1.0, 0.0, 0.0);
		TRANSFORM[1].xyz = vec3(0.0, 1.0, 0.0);
		TRANSFORM[2].xyz = vec3(0.0, 0.0, 1.0);
	}
	if (RESTART_POSITION) {
		TRANSFORM[3].xyz = EMISSION_TRANSFORM[3].xyz;
	}
	if (RESTART_VELOCITY) {
		VELOCITY = vec3(0.0);
	}
	if (RESTART_COLOR) {
		COLOR = vec4(1.0);
	}
	if (RESTART_CUSTOM) {
		CUSTOM = vec4(0.0, 1.0, 1.0, 1.0);
	}
}

void process() {
	CUSTOM.x += DELTA / max(CUSTOM.y, 0.05);
	if (CUSTOM.x >= 1.0) {
		ACTIVE = false;
	}
	float h = hash(float(INDEX));
	vec3 target = wind * (0.6 + 0.8 * h) + vec3(0.0, rise * (0.4 + 1.2 * hash(float(INDEX) + 3.1)), 0.0);
	VELOCITY = mix(VELOCITY, target, 1.0 - exp(-drag * (0.75 + 0.5 * h) * DELTA));
}
"""

const PUFF_DRAW := """shader_type spatial;
render_mode unshaded, %s, depth_draw_never, cull_disabled, shadows_disabled, skip_vertex_transform;
// Big soft billboard with a fake sun side, sized and aged from the particle's CUSTOM data.
#define FIRE %s
uniform sampler2D tex : repeat_disable, filter_linear_mipmap;
uniform sampler2D depth_tex : hint_depth_texture, repeat_disable, filter_nearest;
uniform vec3 sun_dir = vec3(-0.92, 0.26, 0.33);
uniform vec3 lit_col = vec3(1.0, 0.56, 0.3);
uniform vec3 dark_col = vec3(0.3, 0.17, 0.13);
varying vec4 pc;
varying vec3 lv;
varying vec2 disc;
varying float fade;
varying float soft;
varying float age;

float hash(float n) {
	return fract(sin(n * 12.9898) * 43758.5453);
}

void vertex() {
	age = clamp(INSTANCE_CUSTOM.x, 0.0, 1.0);
	float e = 1.0 - pow(1.0 - age, 2.5);
	float size = mix(INSTANCE_CUSTOM.z, INSTANCE_CUSTOM.w, e);
	float seed = fract(INSTANCE_CUSTOM.y * 7.31 + INSTANCE_CUSTOM.w * 1.37);
	float rot = hash(seed) * 6.2832 + (hash(seed + 0.7) - 0.5) * age * 1.4;
	vec2 c = VERTEX.xy * 2.0;
	vec2 off = vec2(c.x * cos(rot) - c.y * sin(rot), c.x * sin(rot) + c.y * cos(rot));
	vec3 centre = (VIEW_MATRIX * vec4(MODEL_MATRIX[3].xyz, 1.0)).xyz;
	VERTEX = centre + vec3(off * size * 0.5, 0.0);
	NORMAL = vec3(0.0, 0.0, 1.0);
	disc = off;
	lv = normalize((VIEW_MATRIX * vec4(sun_dir, 0.0)).xyz);
	pc = COLOR;
	fade = smoothstep(0.0, 0.06, age) * (1.0 - smoothstep(0.5, 1.0, age));
	fade *= smoothstep(size * 0.12, size * 0.7, -centre.z);
	soft = size * 0.22;
}

void fragment() {
	vec4 t = texture(tex, UV);
	float depth = textureLod(depth_tex, SCREEN_UV, 0.0).r;
	vec4 up = INV_PROJECTION_MATRIX * vec4(SCREEN_UV * 2.0 - 1.0, depth, 1.0);
	float a = pc.a * fade * clamp((VERTEX.z - up.z / up.w) / soft, 0.0, 1.0);
#if FIRE
	float core = clamp(1.0 - dot(disc, disc), 0.0, 1.0);
	vec3 ramp = mix(vec3(4.2, 2.7, 1.2), vec3(2.6, 0.72, 0.12), smoothstep(0.0, 0.35, age));
	ramp = mix(ramp, vec3(0.35, 0.05, 0.0), smoothstep(0.35, 1.0, age));
	ALBEDO = ramp * pc.rgb * (0.45 + 0.8 * t.r) * (0.25 + core * core);
	a *= t.a * core;
#else
	vec3 n = normalize(vec3(disc, sqrt(max(0.0, 1.0 - dot(disc, disc))) + 0.3));
	float l = clamp(dot(n, lv) * 0.55 + 0.5, 0.0, 1.0);
	l = l * l * (3.0 - 2.0 * l);
	ALBEDO = pc.rgb * mix(dark_col, lit_col, l) * (0.72 + 0.4 * t.r);
	a *= clamp(t.a * 1.6, 0.0, 1.0);
#endif
	ALPHA = a;
}
"""

const CHUNK_PROC := """shader_type particles;
// Tumbling debris: CUSTOM x age, y life, z floor height, w spin (0 once landed).
void start() {
	if (RESTART_ROT_SCALE) {
		TRANSFORM[0].xyz = vec3(1.0, 0.0, 0.0);
		TRANSFORM[1].xyz = vec3(0.0, 1.0, 0.0);
		TRANSFORM[2].xyz = vec3(0.0, 0.0, 1.0);
	}
	if (RESTART_POSITION) {
		TRANSFORM[3].xyz = EMISSION_TRANSFORM[3].xyz;
	}
	if (RESTART_VELOCITY) {
		VELOCITY = vec3(0.0);
	}
	if (RESTART_COLOR) {
		COLOR = vec4(0.8, 0.4, 0.0, 1.0);
	}
	if (RESTART_CUSTOM) {
		CUSTOM = vec4(0.0, 1.0, -10000.0, 0.0);
	}
}

void process() {
	CUSTOM.x += DELTA / max(CUSTOM.y, 0.05);
	if (CUSTOM.x >= 1.0) {
		ACTIVE = false;
	}
	if (CUSTOM.w != 0.0) {
		VELOCITY.y -= 9.8 * DELTA;
		VELOCITY *= 1.0 - 0.06 * DELTA;
		float id = float(INDEX);
		vec3 ax = normalize(vec3(sin(id * 1.7), cos(id * 2.3), sin(id * 0.9 + 1.0)) + vec3(0.001, 0.002, 0.003));
		float a = CUSTOM.w * DELTA;
		float c = cos(a);
		float s = sin(a);
		for (int i = 0; i < 3; i++) {
			vec3 v = TRANSFORM[i].xyz;
			TRANSFORM[i].xyz = v * c + cross(ax, v) * s + ax * dot(ax, v) * (1.0 - c);
		}
		if (TRANSFORM[3].y < CUSTOM.z) {
			TRANSFORM[3].y = CUSTOM.z;
			VELOCITY = vec3(0.0);
			CUSTOM.w = 0.0;
		}
	} else {
		VELOCITY = vec3(0.0);
	}
}
"""
