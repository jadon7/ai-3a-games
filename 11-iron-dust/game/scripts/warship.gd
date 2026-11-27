extends Node3D
# A warship with destructible parts. Main turrets, point-defence guns, engines and the bridge
# are separate units (warship_part.gd) that follow anchors on the hull; the hull itself is a
# static collider that blocks shots and takes no damage, so attackers must aim at the parts.
# Every hit on a part also drains the shared hull pool. The ship dies when the hull pool is
# empty, or when the bridge and all engines are gone.
#   cruiser    (friendly, ~300 m): boxy, grey-white, blue lights.   4 turrets, 6 PD, 3 engines
#   battleship (enemy, ~420 m):    round, spiked, red-brown, orange. 6 turrets, 8 PD, 4 engines
#   frigate    (enemy, ~190 m):    small escort of the same family.  2 turrets, 4 PD, 2 engines
# Local frame: bow = -Z, up = +Y.

const MeshKit = preload("res://scripts/mesh_kit.gd")
const Tex = preload("res://scripts/tex.gd")
const Part = preload("res://scripts/warship_part.gd")
const U = preload("res://scripts/u.gd")

const HZ := PI * 0.5

const CLASSES := {
	"cruiser": {"name": "白桦号", "style": "fed", "s": 1.0, "hull": 54000.0, "hull_frac": 0.5, "speed": 22.0, "turn": 0.075, "accel": 2.5,
		"ap": {"turret": 9000.0, "pd": 2400.0, "engine": 12000.0, "bridge": 16000.0}, "main": "cr_main", "pdw": "cr_pd"},
	"battleship": {"name": "獠牙号", "style": "foe", "s": 1.0, "hull": 60000.0, "hull_frac": 0.6, "speed": 16.0, "turn": 0.05, "accel": 1.5,
		"ap": {"turret": 8000.0, "pd": 2200.0, "engine": 11000.0, "bridge": 18000.0}, "main": "bb_main", "beam": "bb_beam", "pdw": "bb_pd"},
	"frigate": {"name": "鬣狗号", "style": "foe", "s": 0.46, "hull": 22000.0, "hull_frac": 0.6, "speed": 24.0, "turn": 0.1, "accel": 3.0,
		"ap": {"turret": 5000.0, "pd": 1800.0, "engine": 6000.0, "bridge": 8000.0}, "main": "fr_main", "pdw": "bb_pd"},
}
# enemy hull profile: [z, radius] stations from the prow to the engine bell
const BLAST_CODE := "
shader_type spatial;
render_mode unshaded, blend_add, cull_back, depth_draw_never, shadows_disabled, fog_disabled;
// Ship sized fireball: hot core, soft limb, a faint shell at the edge.
instance uniform vec4 tint : source_color = vec4(1.0, 0.6, 0.3, 1.0);
instance uniform float heat = 1.0;

void fragment() {
	float f = clamp(dot(normalize(NORMAL), normalize(VIEW)), 0.0, 1.0);
	float core = pow(f, 3.0);
	float shell = pow(f, 0.7) * (1.0 - f) * 1.4;
	ALBEDO = (tint.rgb * (core * 1.5 + shell * 0.45) + vec3(1.0, 0.92, 0.75) * pow(f, 9.0) * 1.3) * heat;
}
"
const FOE_PROFILE := [[-215.0, 9.0], [-180.0, 21.0], [-120.0, 33.0], [-50.0, 43.0], [20.0, 48.0], [90.0, 46.0], [150.0, 38.0], [185.0, 33.0], [205.0, 39.0]]

var game
var team := 0
var cls := "cruiser"
var def: Dictionary
var ship_name := ""
var alive := true
var disabled := false       # bridge destroyed: all weapons stop, the ship drifts
var hull := 1.0
var hull_max := 1.0
var hull_frac := 0.5        # share of every part hit that also comes off the hull pool
var dmg_taken := 1.0        # multiplier on all damage to this ship's parts (mission tuning)
var frame_dmg := 1.0        # extra multiplier on damage from anything that is not a warship gun
var parts: Array = []
var bodies: Array = []
var root: Node3D
var fore: Node3D
var aft: Node3D
var half := Vector3(25, 20, 150)
var length := 300.0
var glow: StandardMaterial3D
var glow_col := Color(0.3, 0.6, 1.0)
var hull_meshes: Array = []
var yaw := 0.0
var speed := 0.0
var max_speed := 20.0
var turn_rate := 0.07
var accel := 2.0
var throttle := 0.0
var dest := Vector3.ZERO
var moving := false
var arrived := false
var arrive_r := 60.0
var last_hit_by = null
var dead_t := 0.0
var boom_t := 0.0
var fx_t := 0.0
var broke := false
var final_boom := false
var drift_f := Vector3.ZERO
var drift_a := Vector3.ZERO
var spin_f := Vector3.ZERO
var spin_a := Vector3.ZERO
var _specs: Array = []
var _n := {"turret": 0, "pd": 0, "engine": 0, "bridge": 0}
var _t := 0.0
var blasts: Array = []

static var _blast_mesh: SphereMesh
static var _blast_mat: ShaderMaterial


func setup(g, t: int, pos: Vector3, yaw_v: float, cfg: Dictionary = {}) -> void:
	game = g
	team = t
	cls = str(cfg.get("cls", "cruiser"))
	if not CLASSES.has(cls):
		cls = "cruiser"
	def = CLASSES[cls]
	ship_name = str(cfg.get("name", def["name"]))
	hull_max = float(cfg.get("hull", def["hull"]))
	hull = hull_max
	hull_frac = float(def["hull_frac"])
	dmg_taken = float(cfg.get("dmg_taken", 1.0))
	frame_dmg = float(cfg.get("frame_dmg", 1.0))
	max_speed = float(def["speed"])
	turn_rate = float(def["turn"])
	accel = float(def["accel"])
	yaw = yaw_v
	global_position = pos
	rotation.y = yaw
	dest = pos
	var foe: bool = str(def["style"]) == "foe"
	glow_col = Color(1.0, 0.42, 0.1) if foe else Color(0.3, 0.62, 1.0)
	glow = StandardMaterial3D.new()
	glow.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	glow.albedo_color = glow_col * 2.4
	var mats: Dictionary = Part.make_mats(str(def["style"]), glow)
	root = Node3D.new()
	add_child(root)
	fore = Node3D.new()
	root.add_child(fore)
	aft = Node3D.new()
	root.add_child(aft)
	for hn in [fore, aft]:
		var b := StaticBody3D.new()
		b.collision_layer = 1
		b.collision_mask = 0
		hn.add_child(b)
		bodies.append(b)
	var k = MeshKit.new(17 if foe else 5)
	k.dust = 0.0
	k.jitter = 0.16
	var hf: Node3D = k.bone(fore)
	var ha: Node3D = k.bone(aft)
	if foe:
		_build_foe(k, hf, ha, float(def["s"]))
	else:
		_build_fed(k, hf, ha)
	for m in k.bake(mats):
		m.layers = 2
		var par: Node = m.get_parent()
		if par == hf or par == ha:
			hull_meshes.append(m)
	# parts become units once their meshes exist
	for sp in _specs:
		var ms: Array = []
		for bn in sp["bones"]:
			for c in (bn as Node).get_children():
				if c is MeshInstance3D:
					ms.append(c)
		sp["meshes"] = ms
		var kind_id: String = sp["kind"]
		_n[kind_id] = int(_n[kind_id]) + 1
		sp["ap"] = float(def["ap"][kind_id])
		var p = Part.new()
		game.add_unit(p)
		p.setup_part(game, self, kind_id, int(_n[kind_id]), sp)
		if sp.has("mech_k"):
			p.mech_k = float(sp["mech_k"])
		parts.append(p)
	_specs.clear()
	game._rebuild_rids()
	drift_f = Vector3(randf_range(-1.5, 1.5), randf_range(1.0, 2.6), -4.5)
	drift_a = Vector3(randf_range(-1.0, 1.0), randf_range(-2.0, -0.6), 2.0)
	spin_f = Vector3(0.035, randf_range(-0.012, 0.012), 0.02)
	spin_a = Vector3(-0.02, randf_range(-0.01, 0.01), -0.016)


# ------------------------------------------------------------------ public
func parts_alive(kind_id: String) -> int:
	var n := 0
	for p in parts:
		if p.alive and p.kind == kind_id:
			n += 1
	return n


func parts_total(kind_id: String) -> int:
	return int(_n.get(kind_id, 0))


func center() -> Vector3:
	return global_position


func move_to(p: Vector3) -> void:
	dest = p
	moving = true
	arrived = false


func hold() -> void:
	moving = false


# weapons free / safe
func arm(on: bool) -> void:
	for p in parts:
		p.armed = on


# hidden parts are ignored by every targeting loop and by the HUD
func set_hidden(on: bool) -> void:
	for p in parts:
		p.hidden = on


func hull_ratio() -> float:
	return clampf(hull / maxf(hull_max, 1.0), 0.0, 1.0)


func on_part_hit(_part, dmg: float, from) -> void:
	if not alive:
		return
	last_hit_by = from
	hull -= dmg * hull_frac
	if hull <= 0.0:
		destroy(from)


# capital guns pounding plain hull (only warship turrets do this; frame weapons cannot)
func on_hull_hit(dmg: float, from) -> void:
	if not alive:
		return
	last_hit_by = from
	hull -= dmg * hull_frac * dmg_taken
	if hull <= 0.0:
		destroy(from)


func on_part_dead(part, from) -> void:
	if not alive:
		return
	if part.kind == "bridge":
		disabled = true
		moving = false
		glow.albedo_color = glow_col * 0.25
	if parts_alive("bridge") == 0 and parts_alive("engine") == 0:
		destroy(from)


func destroy(from = null) -> void:
	if not alive:
		return
	alive = false
	hull = 0.0
	disabled = true
	moving = false
	last_hit_by = from
	for p in parts:
		p.scuttle()
	game._rebuild_rids()
	glow.albedo_color = glow_col * 0.05
	dead_t = 0.0
	boom_t = 0.0
	game.sfx.play2d("bigboom", 0.7, 1.1)
	game.shake(0.5, global_position)


# ------------------------------------------------------------------ tick
func tick(dt: float) -> void:
	_t += dt
	_tick_blasts(dt)
	if not alive:
		_tick_dead(dt)
		return
	var n_e := parts_alive("engine")
	var frac := float(n_e) / float(maxi(parts_total("engine"), 1))
	var want := 0.0
	var vy := 0.0
	var turn := 0.0
	if moving and not disabled:
		var to := dest - global_position
		var flat := Vector2(to.x, to.z).length()
		if flat < arrive_r:
			moving = false
			arrived = true
		elif frac > 0.0:
			var err: float = U.ang_diff(yaw, U.yaw_of(to))
			turn = clampf(err, -turn_rate * dt, turn_rate * dt) * (0.4 + 0.6 * frac)
			yaw += turn
			want = max_speed * frac * clampf(1.25 - absf(err) / 0.8, 0.3, 1.0)
			# ease off when close so the ship does not overshoot
			want = minf(want, maxf(3.0, flat * 0.12))
			vy = clampf(to.y * 0.15, -3.0, 3.0) * clampf(speed / 6.0, 0.0, 1.0)
	speed = move_toward(speed, want, (accel if want > speed else accel * 0.6) * dt)
	throttle = clampf(speed / maxf(max_speed, 1.0), 0.0, 1.0) if n_e > 0 else 0.0
	global_position += U.fwd(yaw) * (speed * dt) + Vector3(0, vy * dt, 0)
	rotation.y = yaw
	var bank := clampf(-turn / maxf(dt, 0.001) * 1.6, -0.1, 0.1)
	root.rotation.z = lerpf(root.rotation.z, bank, minf(1.0, dt * 0.8))
	# running lights breathe slowly; a disabled ship goes dark
	if not disabled:
		glow.albedo_color = glow_col * (2.1 + 0.4 * sin(_t * 1.7))


# ship sized fireball: an additive sphere that swells and burns out (fx.explosion is frame sized)
func blast(p: Vector3, r: float, dur: float = 1.0) -> void:
	if _blast_mesh == null:
		_blast_mesh = SphereMesh.new()
		_blast_mesh.radius = 1.0
		_blast_mesh.height = 2.0
		_blast_mesh.radial_segments = 20
		_blast_mesh.rings = 10
	var b: Dictionary = {}
	for o in blasts:
		if float(o["t"]) >= float(o["d"]):
			b = o
			break
	if b.is_empty():
		if blasts.size() >= 10:
			return
		var mi := MeshInstance3D.new()
		mi.mesh = _blast_mesh
		if _blast_mat == null:
			var sh := Shader.new()
			sh.code = BLAST_CODE
			_blast_mat = ShaderMaterial.new()
			_blast_mat.shader = sh
		mi.material_override = _blast_mat
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.top_level = true
		add_child(mi)
		b = {"m": mi, "t": 0.0, "d": 1.0, "r": 1.0}
		blasts.append(b)
	b["t"] = 0.0
	b["d"] = dur
	b["r"] = r
	var m: MeshInstance3D = b["m"]
	m.global_position = p
	m.visible = true
	game.fx.flash(p, minf(900.0, r * 9.0), dur * 0.8, Color(1.0, 0.72, 0.45))


func _tick_blasts(dt: float) -> void:
	for b in blasts:
		var t: float = b["t"]
		var d: float = b["d"]
		if t >= d:
			continue
		t += dt
		b["t"] = t
		var m: MeshInstance3D = b["m"]
		if t >= d:
			m.visible = false
			continue
		var k := t / d
		var grow := 1.0 - pow(1.0 - k, 3.0)
		m.scale = Vector3.ONE * (float(b["r"]) * (0.2 + 0.8 * grow))
		var heat := pow(1.0 - k, 1.6)
		var col := Color(1.0, 0.86, 0.6).lerp(Color(1.0, 0.3, 0.06), clampf(k * 1.6, 0.0, 1.0))
		m.set_instance_shader_parameter("tint", col)
		m.set_instance_shader_parameter("heat", heat * 1.6)


func _rand_hull() -> Vector3:
	var l := Vector3(randf_range(-half.x, half.x), randf_range(-half.y, half.y), randf_range(-half.z, half.z))
	var n: Node3D = fore if l.z < 0.0 else aft
	return n.global_transform * l


func _wreck(v: float) -> void:
	for m in hull_meshes:
		if is_instance_valid(m):
			if m.get_meta("key", "") == "G":
				m.visible = v < 0.5
			else:
				m.set_instance_shader_parameter("wreck", v)


func _tick_dead(dt: float) -> void:
	dead_t += dt
	speed = move_toward(speed, 0.0, 0.8 * dt)
	global_position += U.fwd(yaw) * (speed * dt)
	var c := global_position
	if dead_t < 8.0:
		# staged break-up: secondary explosions walk along the hull, the keel snaps at 3 s,
		# the reactor goes at 7.2 s
		boom_t -= dt
		if boom_t <= 0.0:
			boom_t = randf_range(0.1, 0.26) * (1.7 if dead_t < 1.5 else 1.0)
			var p := _rand_hull()
			game.fx.explosion(p, randf_range(2.0, 3.0))
			if randf() < 0.45:
				blast(p, randf_range(16.0, 34.0), randf_range(0.5, 0.9))
			if randf() < 0.35:
				game.sfx.play("explosion", p, randf_range(0.8, 1.3), randf_range(0.5, 0.85))
				game.shake(0.2, p)
		if not broke and dead_t >= 3.0:
			broke = true
			_wreck(0.6)
			blast(c, length * 0.3, 1.5)
			blast(_rand_hull(), length * 0.16, 1.1)
			for i in 9:
				game.fx.explosion(c + root.global_transform.basis * Vector3(randf_range(-half.x, half.x), randf_range(-half.y, half.y), randf_range(-24.0, 24.0)), 3.0)
			game.fx.chunks(c, 16, 3.0)
			game.sfx.play2d("bigboom", 1.0, 0.85)
			game.shake(0.8, c)
		if not final_boom and dead_t >= 7.2:
			final_boom = true
			_wreck(0.85)
			var ec: Vector3 = aft.global_transform * Vector3(0, 0, half.z * 0.75)
			blast(ec, length * 0.42, 2.2)
			blast(c, length * 0.24, 1.6)
			blast(_rand_hull(), length * 0.2, 1.3)
			for i in 12:
				game.fx.explosion(ec + Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * half.x * 1.6, 3.0)
			for i in 6:
				game.fx.explosion(_rand_hull(), 2.6)
			game.fx.chunks(ec, 18, 3.2)
			game.sfx.play2d("bigboom", 1.0, 0.6)
			game.shake(1.0, c)
	if broke and dead_t < 60.0:
		# the two halves drift and tumble apart, then settle into a wreck
		var k := exp(-0.07 * maxf(dead_t - 8.0, 0.0)) * dt
		fore.position += drift_f * k
		fore.rotation += spin_f * k
		aft.position += drift_a * k
		aft.rotation += spin_a * k
	if dead_t < 70.0:
		fx_t -= dt
		if fx_t <= 0.0:
			fx_t = 0.07 if dead_t < 20.0 else 0.2
			var cam = game.get("cam")
			if cam == null or (cam.global_position as Vector3).distance_squared_to(c) < 1500.0 * 1500.0:
				var p := _rand_hull()
				game.fx.emit("smoke", p, Vector3(randf_range(-4, 4), randf_range(-4, 4), randf_range(-4, 4)))
				if dead_t < 30.0 and randf() < 0.5:
					game.fx.emit("fire", p, Vector3(randf_range(-5, 5), randf_range(-5, 5), randf_range(-5, 5)))


# ------------------------------------------------------------------ building helpers
func _mount(parent: Node3D, pos: Vector3, roll: float = 0.0) -> Node3D:
	var m := Node3D.new()
	m.position = pos
	m.rotation.z = roll
	parent.add_child(m)
	return m


func _cbox(hn: Node3D, size: Vector3, pos: Vector3) -> void:
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = size
	cs.shape = bs
	cs.position = pos
	(bodies[0 if hn == fore else 1] as StaticBody3D).add_child(cs)


# tapered round hull section between two stations
func _cfrustum(hn: Node3D, z0: float, r0: float, z1: float, r1: float) -> void:
	var pts := PackedVector3Array()
	for i in 12:
		var a := float(i) * TAU / 12.0
		pts.append(Vector3(cos(a) * r0, sin(a) * r0, z0))
		pts.append(Vector3(cos(a) * r1, sin(a) * r1, z1))
	var cs := CollisionShape3D.new()
	var sh := ConvexPolygonShape3D.new()
	sh.points = pts
	cs.shape = sh
	(bodies[0 if hn == fore else 1] as StaticBody3D).add_child(cs)


func _turret(k, parent: Node3D, pos: Vector3, roll: float, barrels: int, sc: float, wpn: String, mech_k: float) -> void:
	var m := _mount(parent, pos, roll)
	var style: String = def["style"]
	var beam: bool = str(Part.WEAPONS[wpn]["kind"]) == "beam"
	var r: Dictionary = Part.build_turret(k, m, style, barrels, sc, beam)
	_specs.append({"kind": "turret", "anchor": m, "off": Vector3(0, 4.4 * sc, 0), "r": 9.5 * sc, "yaw": r["yaw"], "pitch": r["pitch"], "muz": r["muz"], "pivot": r["pivot"], "wpn": wpn, "bones": [r["yaw"], r["pitch"]], "mech_k": mech_k})


func _pd(k, parent: Node3D, pos: Vector3, roll: float, sc: float) -> void:
	var m := _mount(parent, pos, roll)
	var r: Dictionary = Part.build_pd(k, m, str(def["style"]), sc)
	_specs.append({"kind": "pd", "anchor": m, "off": Vector3(0, 2.2 * sc, 0), "r": 4.6 * sc, "yaw": r["yaw"], "pitch": r["pitch"], "muz": r["muz"], "pivot": r["pivot"], "wpn": str(def["pdw"]), "bones": [r["pitch"]]})


func _engine(k, pos: Vector3, r: float, ln: float) -> void:
	var e: Node3D = k.bone(aft, pos)
	k.cyl(e, "F", r, r * 0.74, r * 1.7, Vector3(0, 0, r * 0.85), Vector3(HZ, 0, 0), 14)
	k.cyl(e, "F", r * 1.06, r * 1.06, r * 0.22, Vector3(0, 0, r * 1.6), Vector3(HZ, 0, 0), 14, 0.7)
	k.cyl(e, "C", r * 0.8, r * 0.8, r * 0.3, Vector3(0, 0, r * 0.1), Vector3(HZ, 0, 0), 14)
	k.cyl(e, "G", r * 0.62, r * 0.62, 0.5, Vector3(0, 0, r * 1.2), Vector3(HZ, 0, 0), 12)
	var noz := Node3D.new()
	noz.position = Vector3(0, 0, r * 1.5)
	noz.rotation.x = -HZ
	e.add_child(noz)
	_specs.append({"kind": "engine", "anchor": e, "off": Vector3(0, 0, r * 0.9), "r": r * 1.2, "noz": noz, "plume": [r * 0.86, ln], "bones": [e]})


# cone from base to tip
func _spike(k, b: Node3D, key: String, base: Vector3, tip: Vector3, r: float, seg: int = 8, r_tip: float = 0.0) -> void:
	var d := tip - base
	var ln := d.length()
	if ln < 0.01:
		return
	var y := d / ln
	var x := y.cross(Vector3.FORWARD if absf(y.z) < 0.9 else Vector3.RIGHT).normalized()
	var bas := Basis(x, y, x.cross(y).normalized())
	k.cyl(b, key, r_tip, r, ln, (base + tip) * 0.5, bas.get_euler(), seg)


# ------------------------------------------------------------------ friendly cruiser
# "Birch" class: a lofted eight-sided hull with a twin-prong bow and a recessed catapult between the
# prongs, faired sponsons with light strips, a two-tier bridge tower and an engine drum.
# station of a hull table at z (interpolated between its neighbours), grown outward by g
func _sec(tbl: Array, z: float, g: float = 0.0) -> Array:
	var a: Array = tbl[0]
	var b: Array = tbl[tbl.size() - 1]
	for i in tbl.size() - 1:
		if z <= float(tbl[i + 1][0]):
			a = tbl[i]
			b = tbl[i + 1]
			break
	var t := clampf(inverse_lerp(float(a[0]), float(b[0]), z), 0.0, 1.0)
	var o: Array = [z]
	for q in range(1, 8):
		o.append(lerpf(float(a[q]), float(b[q]), t))
	o[1] = float(o[1]) + g
	o[2] = float(o[2]) + g
	return o


func _build_fed(k, hf: Node3D, ha: Node3D) -> void:
	length = 312.0
	half = Vector3(22, 17, 150)
	var rng := RandomNumberGenerator.new()
	rng.seed = 12
	# Hull: lofted sections (MeshKit.hull), every one an eight-sided cut of a box with a flat deck and keel
	# and canted flanks, swelling from the bow to the waist and drawing in again at the stern. No face of it
	# is square to its neighbour. station = [z, half width, half height, deck k, keel k, upper k, lower k, y]
	var H := [
		[-94.0, 14.0, 10.5, 0.5, 0.42, 0.42, 0.3, 0.0],
		[-82.0, 19.0, 14.5, 0.6, 0.46, 0.46, 0.36, 0.0],
		[-58.0, 21.5, 16.0, 0.63, 0.48, 0.5, 0.4, 0.0],
		[10.0, 22.0, 16.5, 0.63, 0.48, 0.5, 0.4, 0.0],
		[96.0, 21.5, 16.0, 0.63, 0.48, 0.5, 0.4, 0.0],
		[128.0, 19.5, 15.0, 0.62, 0.5, 0.5, 0.42, 0.0]]
	k.hull(hf, "A", [H[0], H[1], H[2], _sec(H, -24.0), H[3]])
	k.hull(ha, "A", [H[3], _sec(H, 52.0), H[4], H[5]])
	# frame rings round the hull, an armour belt along each flank with the ship's blue line on it
	for z: float in [-70.0, -46.0, -22.0, 2.0, 26.0, 50.0, 74.0, 98.0, 120.0]:
		k.hull(hf if z < 10.0 else ha, "B", [_sec(H, z - 0.9, 0.7), _sec(H, z + 0.9, 0.7)], Vector3.ZERO, 0.9)
	var belt := [[-86.0, 18.6, 3.6, 0.9, 0.9, 0.5, 0.5, 5.5], [-60.0, 22.9, 4.6, 0.93, 0.93, 0.5, 0.5, 5.5], [10.0, 23.4, 4.6, 0.93, 0.93, 0.5, 0.5, 5.5],
		[100.0, 22.9, 4.6, 0.93, 0.93, 0.5, 0.5, 5.5], [124.0, 20.4, 4.0, 0.9, 0.9, 0.5, 0.5, 5.5]]
	k.hull(hf, "A", [belt[0], belt[1], belt[2]], Vector3.ZERO, 1.05)
	k.hull(ha, "A", [belt[2], belt[3], belt[4]], Vector3.ZERO, 1.05)
	for sx: float in [-1.0, 1.0]:
		# twin prongs: long wedges, each with a blue band and a probe at its point
		k.hull(hf, "A", [[-176.0, 1.6, 2.2, 0.6, 0.6, 0.5, 0.5, 1.0], [-150.0, 5.0, 6.5, 0.6, 0.5, 0.5, 0.4, 0.5],
			[-112.0, 7.2, 10.5, 0.62, 0.5, 0.5, 0.4, 0.0], [-86.0, 7.6, 12.5, 0.62, 0.5, 0.5, 0.4, 0.0]], Vector3(sx * 13.2, 0, 0))
		k.hull(hf, "C", [[-102.0, 7.75, 11.5, 0.62, 0.5, 0.5, 0.4, 0.0], [-98.5, 7.85, 11.9, 0.62, 0.5, 0.5, 0.4, 0.0]], Vector3(sx * 13.2, 0, 0))
		k.hull(hf, "B", [[-141.0, 6.0, 7.9, 0.6, 0.5, 0.5, 0.4, 0.4], [-139.0, 6.2, 8.2, 0.6, 0.5, 0.5, 0.4, 0.4]], Vector3(sx * 13.2, 0, 0), 0.9)
		k.box(hf, "G", Vector3(0.5, 0.9, 36), Vector3(sx * 5.2, -1, -112))
		_beam(k, hf, "F", Vector3(sx * 13.2, 1, -172), Vector3(sx * 14.0, 1.5, -190), 0.5)
		# sponsons: faired pods along the flanks, a light strip down each
		k.hull(hf, "B", [[-78.0, 2.0, 2.5, 0.7, 0.7, 0.5, 0.5, -3.0], [-64.0, 5.6, 6.6, 0.6, 0.6, 0.45, 0.45, -3.0], [10.0, 5.6, 6.6, 0.6, 0.6, 0.45, 0.45, -3.0]],
			Vector3(sx * 25.5, 0, 0))
		k.hull(ha, "B", [[10.0, 5.6, 6.6, 0.6, 0.6, 0.45, 0.45, -3.0], [94.0, 5.6, 6.6, 0.6, 0.6, 0.45, 0.45, -3.0], [110.0, 2.2, 2.8, 0.7, 0.7, 0.5, 0.5, -3.0]],
			Vector3(sx * 25.5, 0, 0))
		k.box(hf, "G", Vector3(0.5, 1.0, 66), Vector3(sx * 31.2, -3, -28))
		k.box(ha, "G", Vector3(0.5, 1.0, 76), Vector3(sx * 31.2, -3, 54))
		k.box(hf, "C", Vector3(0.6, 4.0, 44), Vector3(sx * 23.5, 5.5, -30))
		k.box(ha, "C", Vector3(0.6, 4.0, 60), Vector3(sx * 23.5, 5.5, 60))
		k.box(ha, "G", Vector3(0.5, 0.8, 40), Vector3(sx * 12.0, -29.2, 50))
		# canted radiator fins either side of the aft turret
		k.box(ha, "T", Vector3(1.4, 30, 30), Vector3(sx * 20.0, 30, 126), Vector3(0, 0, -sx * 0.5), {"tz": 0.6, "sz": 6.0})
		k.box(ha, "C", Vector3(1.6, 3, 18), Vector3(sx * 26.6, 42, 130), Vector3(0, 0, -sx * 0.5))
		# running lights at the waist
		k.box(hf if sx < 0.0 else ha, "G", Vector3(0.8, 0.8, 0.8), Vector3(sx * 23.9, 10.4, 0.0))
	# catapult trough between the prongs, deck and keel plates, barbettes
	k.box(hf, "F", Vector3(11, 14, 44), Vector3(0, -1, -110), Vector3.ZERO, {"tx": 0.8, "bx": 0.8})
	k.box(hf, "B", Vector3(8, 2, 52), Vector3(0, -9, -112))
	k.box(hf, "H", Vector3(8.2, 0.4, 3.0), Vector3(0, -7.9, -134))
	k.box(hf, "B", Vector3(26.5, 2.4, 96), Vector3(0, 16.6, -40), Vector3.ZERO, {"tx": 0.94})
	k.box(ha, "B", Vector3(26.5, 2.4, 110), Vector3(0, 16.6, 66), Vector3.ZERO, {"tx": 0.94})
	k.box(hf, "B", Vector3(18, 9, 92), Vector3(0, -19.5, -42), Vector3.ZERO, {"bx": 0.6, "bz": 0.9})
	k.box(ha, "B", Vector3(18, 9, 30), Vector3(0, -19.5, 100), Vector3.ZERO, {"bx": 0.6, "bz": 0.8})
	k.box(hf, "C", Vector3(20, 0.5, 20), Vector3(0, 18.0, -78), Vector3.ZERO, {"tx": 0.9})
	k.cyl(hf, "B", 11.0, 12.2, 3.0, Vector3(0, 18.5, -70), Vector3.ZERO, 16)
	k.cyl(hf, "B", 11.4, 12.8, 10.0, Vector3(0, 22.0, -30), Vector3.ZERO, 16)
	k.cyl(hf, "B", 11.0, 12.2, 3.0, Vector3(0, -24.5, -40), Vector3(PI, 0, 0), 16)
	k.cyl(ha, "B", 11.0, 12.2, 3.0, Vector3(0, 18.5, 108), Vector3.ZERO, 16)
	_cbox(fore, Vector3(40, 32, 100), Vector3(0, 0, -40))
	_cbox(fore, Vector3(36, 20, 60), Vector3(0, 0, -118))
	_cbox(fore, Vector3(62, 13, 84), Vector3(0, -3, -30))
	_cbox(fore, Vector3(18, 9, 92), Vector3(0, -19.5, -42))
	# hangar pod under the waist, its door forward
	k.hull(ha, "B", [[15.0, 10.5, 4.6, 0.8, 0.6, 0.5, 0.5, -22.0], [24.0, 15.0, 6.5, 0.8, 0.6, 0.5, 0.5, -22.5], [74.0, 15.0, 6.5, 0.8, 0.6, 0.5, 0.5, -22.5],
		[86.0, 10.0, 4.2, 0.8, 0.6, 0.5, 0.5, -21.5]])
	k.box(ha, "F", Vector3(17, 6.4, 0.8), Vector3(0, -22.2, 14.8))
	k.box(ha, "H", Vector3(18.5, 1.0, 1.0), Vector3(0, -18.0, 14.9))
	k.box(ha, "G", Vector3(13, 0.5, 0.6), Vector3(0, -25.8, 14.6))
	# superstructure: a long deckhouse, the mast and its dish behind the bridge
	k.hull(ha, "A", [[38.0, 8.0, 2.6, 0.7, 1.0, 0.3, 1.0, 19.8], [46.0, 12.5, 4.2, 0.72, 1.0, 0.35, 1.0, 21.5], [82.0, 12.5, 4.2, 0.72, 1.0, 0.35, 1.0, 21.5],
		[92.0, 8.0, 2.8, 0.7, 1.0, 0.3, 1.0, 20.0]])
	k.hull(ha, "B", [[75.0, 4.5, 6.5, 0.6, 1.0, 0.3, 1.0, 31.5], [82.0, 6.0, 6.5, 0.6, 1.0, 0.3, 1.0, 31.5], [89.0, 4.0, 5.5, 0.6, 1.0, 0.3, 1.0, 30.5]])
	_beam(k, ha, "F", Vector3(0, 37, 82), Vector3(0, 62, 86), 0.9)
	_beam(k, ha, "F", Vector3(-8, 50, 84), Vector3(8, 50, 84), 0.5)
	_beam(k, ha, "F", Vector3(-5, 56, 85), Vector3(5, 56, 85), 0.4)
	k.cyl(ha, "T", 5.5, 0.8, 2.8, Vector3(8, 39, 88), Vector3(0.7, 0.4, 0), 12)
	k.box(ha, "G", Vector3(0.9, 0.9, 0.9), Vector3(0, 62.6, 86))
	# engine block: a wider eight-sided drum behind a stepped collar, a dark plate round the nozzles
	var E := [[126.0, 20.0, 15.5, 0.62, 0.5, 0.5, 0.42, 0.0], [133.0, 25.0, 19.0, 0.62, 0.55, 0.5, 0.45, 0.0], [151.0, 25.0, 19.0, 0.62, 0.55, 0.5, 0.45, 0.0],
		[156.0, 22.5, 17.0, 0.62, 0.55, 0.5, 0.45, 0.0]]
	k.hull(ha, "B", E)
	k.hull(ha, "H", [_sec(E, 134.0, 0.4), _sec(E, 136.4, 0.4)])
	k.hull(ha, "A", [_sec(E, 141.0, 0.6), _sec(E, 147.0, 0.6)], Vector3.ZERO, 0.95)
	k.hull(ha, "F", [[155.6, 20.6, 15.2, 0.62, 0.55, 0.5, 0.45, 0.0], [156.8, 20.2, 14.8, 0.62, 0.55, 0.5, 0.45, 0.0]])
	# deck clutter
	for i in 18:
		var z := rng.randf_range(-58.0, 100.0)
		var sx := 1.0 if rng.randf() < 0.5 else -1.0
		var sz := Vector3(rng.randf_range(1.6, 3.6), rng.randf_range(1.0, 2.6), rng.randf_range(3.0, 8.0))
		k.box(hf if z < 10.0 else ha, "B" if rng.randf() < 0.6 else "A", sz, Vector3(sx * rng.randf_range(8.5, 11.5), 17.8 + sz.y * 0.5, z), Vector3.ZERO, {"tx": 0.8, "tz": 0.9})
	_cbox(aft, Vector3(40, 32, 120), Vector3(0, 0, 70))
	_cbox(aft, Vector3(62, 13, 92), Vector3(0, -3, 60))
	_cbox(aft, Vector3(22, 8, 46), Vector3(0, 21.5, 64))
	_cbox(aft, Vector3(48, 38, 28), Vector3(0, 0, 141))
	_cbox(aft, Vector3(26, 13, 64), Vector3(0, -22.5, 50))
	# bridge tower: a faired base, the bridge proper with a window band round its front, wings, roof and aerials
	var br: Node3D = k.bone(aft, Vector3(0, 25.5, 58))
	k.hull(br, "A", [[-12.0, 6.5, 4.6, 0.7, 1.0, 0.3, 1.0, 4.6], [-7.0, 10.0, 5.5, 0.72, 1.0, 0.35, 1.0, 5.5], [9.0, 10.0, 5.5, 0.72, 1.0, 0.35, 1.0, 5.5],
		[13.0, 7.0, 4.4, 0.7, 1.0, 0.3, 1.0, 4.4]])
	k.hull(br, "A", [[-10.0, 5.6, 3.0, 0.7, 1.0, 0.3, 0.9, 13.6], [-5.0, 8.0, 3.4, 0.7, 1.0, 0.3, 0.9, 14.2], [7.0, 8.0, 3.4, 0.7, 1.0, 0.3, 0.9, 14.2],
		[10.5, 5.8, 3.0, 0.7, 1.0, 0.3, 0.9, 13.8]])
	k.hull(br, "G", [[-10.3, 5.5, 0.75, 1.0, 1.0, 0.5, 0.5, 14.3], [-5.1, 8.15, 0.75, 1.0, 1.0, 0.5, 0.5, 14.5], [2.0, 8.15, 0.75, 1.0, 1.0, 0.5, 0.5, 14.5]])
	k.box(br, "B", Vector3(12.5, 1.2, 12), Vector3(0, 18.2, 1.0), Vector3.ZERO, {"tx": 0.8, "tz": 0.8})
	k.box(br, "A", Vector3(27, 1.0, 4.5), Vector3(0, 11.0, -3.0), Vector3.ZERO, {"tx": 0.92}, 0.85)
	k.box(br, "B", Vector3(3.0, 2.4, 3.0), Vector3(-12.5, 12.4, -3.0), Vector3.ZERO, {"tx": 0.7, "tz": 0.7})
	k.box(br, "B", Vector3(3.0, 2.4, 3.0), Vector3(12.5, 12.4, -3.0), Vector3.ZERO, {"tx": 0.7, "tz": 0.7})
	_beam(k, br, "F", Vector3(-4, 18.6, 4), Vector3(-4.6, 29, 6), 0.35)
	_beam(k, br, "F", Vector3(4, 18.6, 4), Vector3(4.4, 26, 5.5), 0.3)
	_specs.append({"kind": "bridge", "anchor": br, "off": Vector3(0, 9, 0), "r": 14.0, "bones": [br]})
	# main battery: two superfiring forward, one aft, one ventral
	var main: String = def["main"]
	_turret(k, fore, Vector3(0, 20, -70), 0.0, 2, 1.3, main, 4.0)
	_turret(k, fore, Vector3(0, 27, -30), 0.0, 2, 1.3, main, 1.4)
	_turret(k, aft, Vector3(0, 20, 108), 0.0, 2, 1.3, main, 4.0)
	_turret(k, fore, Vector3(0, -26, -40), PI, 2, 1.3, main, 1.4)
	# point defence on the sponsons, canted outward
	for sx: float in [-1.0, 1.0]:
		_pd(k, fore, Vector3(sx * 30.0, 4.0, -60), -sx * 0.9, 1.3)
		_pd(k, fore, Vector3(sx * 30.0, 4.0, -4), -sx * 0.9, 1.3)
		_pd(k, aft, Vector3(sx * 30.0, 4.0, 82), -sx * 0.9, 1.3)
	_engine(k, Vector3(-14.0, -7, 155), 9.5, 56.0)
	_engine(k, Vector3(14.0, -7, 155), 9.5, 56.0)
	_engine(k, Vector3(0, 9.5, 155), 9.5, 56.0)


func _beam(k, b: Node3D, key: String, a: Vector3, c: Vector3, w: float) -> void:
	var d := c - a
	var ln := d.length()
	if ln < 0.01:
		return
	var up := Vector3.UP if absf(d.y / ln) < 0.95 else Vector3.RIGHT
	k.box(b, key, Vector3(w, w, ln), (a + c) * 0.5, Basis.looking_at(d / ln, up).get_euler())


# ------------------------------------------------------------------ enemy battleship / frigate
# "Fang" family: a segmented carapace hull with a gun maw in the prow, a dorsal hump carrying
# the bridge, mandible tusks sweeping forward from the flanks and bladed tail fins.
func _rad(z: float, s: float) -> float:
	var zz := z / s
	if zz <= float(FOE_PROFILE[0][0]):
		return float(FOE_PROFILE[0][1]) * s
	for i in FOE_PROFILE.size() - 1:
		var a: Array = FOE_PROFILE[i]
		var b: Array = FOE_PROFILE[i + 1]
		if zz <= float(b[0]):
			return lerpf(float(a[1]), float(b[1]), clampf((zz - float(a[0])) / (float(b[0]) - float(a[0])), 0.0, 1.0)) * s
	return float(FOE_PROFILE[FOE_PROFILE.size() - 1][1]) * s


func _build_foe(k, hf: Node3D, ha: Node3D, s: float) -> void:
	var big := s > 0.8
	length = 430.0 * s
	half = Vector3(38, 38, 205) * s
	var split := -15.0 * s
	# overlapping carapace rings: each one flares over the start of the next
	var zs := [-215.0, -182.0, -150.0, -118.0, -84.0, -50.0, -15.0, 20.0, 55.0, 90.0, 120.0, 150.0, 185.0, 205.0]
	var keys := ["A", "A", "B", "A", "A", "B", "A", "A", "B", "A", "A", "B", "B"]
	for i in zs.size() - 1:
		var z0: float = float(zs[i]) * s
		var z1: float = float(zs[i + 1]) * s
		var r0 := _rad(z0, s)
		var r1 := _rad(z1, s)
		var hn: Node3D = hf if (z0 + z1) * 0.5 < split else ha
		var flare := 2.8 * s if i < zs.size() - 3 else 0.0
		k.cyl(hn, keys[i], r1 + flare, r0, z1 - z0, Vector3(0, 0, (z0 + z1) * 0.5), Vector3(HZ, 0, 0), 22)
		if i % 3 == 1:
			k.cyl(hn, "C", r1 + flare + 0.5 * s, r1 + flare + 0.5 * s, 1.6 * s, Vector3(0, 0, z1 - 0.8 * s), Vector3(HZ, 0, 0), 22, 0.9)
	for i in FOE_PROFILE.size() - 1:
		var z0: float = float(FOE_PROFILE[i][0]) * s
		var z1: float = float(FOE_PROFILE[i + 1][0]) * s
		_cfrustum(fore if (z0 + z1) * 0.5 < split else aft, z0, float(FOE_PROFILE[i][1]) * s * 0.97, z1, float(FOE_PROFILE[i + 1][1]) * s * 0.97)
	# Ribs run the length of the carapace, standing proud of every ring, and each ring between them carries
	# armour scutes: the hull reads as plated and segmented, not as a row of smooth drums.
	for q in 8:
		var qa := TAU * (float(q) + 0.5) / 8.0
		var qc := Vector3(cos(qa), sin(qa), 0)
		for i in zs.size() - 3:
			var z0: float = float(zs[i]) * s
			var z1: float = float(zs[i + 1]) * s
			var hn: Node3D = hf if (z0 + z1) * 0.5 < split else ha
			_spike(k, hn, "B", qc * (_rad(z0, s) + 1.0 * s) + Vector3(0, 0, z0), qc * (_rad(z1, s) + 3.6 * s) + Vector3(0, 0, z1 + 1.5 * s), 2.3 * s, 5, 1.5 * s)
			if (i + q) % 2 == 0 and i > 0:
				var sa := TAU * float(q) / 8.0
				var sc2 := Vector3(cos(sa), sin(sa), 0)
				var rm := maxf(_rad(z0, s), _rad(z1, s)) + 2.2 * s
				k.box(hn, "T" if q % 2 == 0 else "A", Vector3(rm * 0.46, 1.6 * s, (z1 - z0) * 0.62), sc2 * rm + Vector3(0, 0, (z0 + z1) * 0.5 + 2.0 * s), Vector3(0, 0, sa - HZ),
					{"tx": 0.82, "tz": 0.8})
	# a spine of low blades down the back, vents glowing between the aft rings
	for i in 5:
		var vz := (104.0 + i * 16.0) * s
		k.cyl(ha, "G", _rad(vz, s) + 1.2 * s, _rad(vz, s) + 1.2 * s, 0.9 * s, Vector3(0, 0, vz), Vector3(HZ, 0, 0), 22)
	# gun maw in the prow, ringed by three fangs
	k.cyl(hf, "F", 8.0 * s, 8.6 * s, 7.0 * s, Vector3(0, 0, -216.5) * s, Vector3(HZ, 0, 0), 14)
	k.cyl(hf, "G", 5.6 * s, 5.6 * s, 0.6 * s, Vector3(0, 0, -220.4) * s, Vector3(HZ, 0, 0), 14)
	k.cyl(hf, "C", 10.4 * s, 10.4 * s, 2.4 * s, Vector3(0, 0, -212.0) * s, Vector3(HZ, 0, 0), 14)
	for i in 3:
		var a := HZ + float(i) * TAU / 3.0
		var c := Vector3(cos(a), sin(a), 0)
		_spike(k, hf, "C", c * (13.0 * s) + Vector3(0, 0, -196.0 * s), c * (10.0 * s) + Vector3(0, 0, -262.0 * s), 4.2 * s, 8)
	# dorsal hump
	k.ball(ha, "A", Vector3(25, 18, 66) * s, Vector3(0, 35, 38) * s)
	k.ball(ha, "B", Vector3(27, 10, 30) * s, Vector3(0, 34, 84) * s)
	var cs0 := CollisionShape3D.new()
	var bs0 := BoxShape3D.new()
	bs0.size = Vector3(36, 26, 104) * s
	cs0.shape = bs0
	cs0.position = Vector3(0, 38, 40) * s
	(bodies[1] as StaticBody3D).add_child(cs0)
	for sx: float in [-1.0, 1.0]:
		k.box(hf, "G", Vector3(1.0, 2.4, 18) * s, Vector3(sx * 17.0, 8.0, -178) * s, Vector3(0, -sx * 0.36, 0))
		k.box(hf, "G", Vector3(0.9, 1.3, 50) * s, Vector3(sx * (_rad(-70.0 * s, s) / s + 0.6), 0, -70) * s, Vector3(0, -sx * 0.16, 0))
		k.box(ha, "G", Vector3(0.9, 1.3, 26) * s, Vector3(sx * 49.6, -6.0, 38) * s)
		k.box(ha, "G", Vector3(0.9, 1.3, 26) * s, Vector3(sx * 49.4, 8.0, 72) * s)
		k.box(ha, "G", Vector3(0.9, 1.3, 20) * s, Vector3(sx * 43.6, 0.0, 134) * s, Vector3(0, sx * 0.13, 0))
		# mandible tusks sweeping forward from the lower flanks
		var base := Vector3(sx * 40.0, -26.0, 86.0) * s
		var elbow := Vector3(sx * 74.0, -46.0, 44.0) * s
		var tip := Vector3(sx * 62.0, -38.0, -160.0) * s
		_spike(k, ha, "B", base, elbow, 11.0 * s, 8, 9.0 * s)
		k.ball(ha, "B", Vector3(11, 11, 13) * s, elbow)
		_spike(k, ha, "C", elbow, tip, 9.0 * s, 8)
		var cs := CollisionShape3D.new()
		var bs := BoxShape3D.new()
		bs.size = Vector3(11, 11, 120) * s
		cs.shape = bs
		cs.transform = Transform3D(Basis.looking_at((tip - elbow).normalized(), Vector3.UP), elbow.lerp(tip, 0.36))
		(bodies[1] as StaticBody3D).add_child(cs)
	# crest blades on the fore hull, ventral keel blade, bladed tail fins
	for i in 3:
		var z := (-150.0 + i * 34.0) * s
		var h := (14.0 + i * 5.0) * s
		k.box(hf, "A" if i % 2 == 0 else "B", Vector3(2.8 * s, h, 22.0 * s), Vector3(0, _rad(z, s) + h * 0.5 - 1.0 * s, z), Vector3.ZERO, {"tx": 0.3, "tz": 0.2, "sz": 10.0 * s})
	k.box(ha, "B", Vector3(4.5, 46.0, 84.0) * s, Vector3(0, -64.0, 108.0) * s, Vector3.ZERO, {"bx": 0.3, "bz": 0.25})
	k.box(ha, "C", Vector3(1.4, 4.0, 22.0) * s, Vector3(0, -88.5, 108.0) * s)
	for i in 4:
		var a := HZ * 0.5 + float(i) * HZ
		var c := Vector3(cos(a), sin(a), 0)
		k.box(ha, "A", Vector3(3.2, 46.0, 62.0) * s, c * (54.0 * s) + Vector3(0, 0, 172.0 * s), Vector3(0, 0, a - HZ), {"tx": 0.3, "tz": 0.3, "sz": 18.0 * s})
		_spike(k, ha, "C", c * (75.0 * s) + Vector3(0, 0, 190.0 * s), c * (82.0 * s) + Vector3(0, 0, 232.0 * s), 1.8 * s, 6)
	# bridge: a visored dome on a conical tower, crowned with spikes
	var bz := 56.0 * s
	var bs2 := maxf(s, 0.7)
	var br: Node3D = k.bone(aft, Vector3(0, 48.0 * s, bz))
	k.cyl(br, "A", 9.5 * bs2, 15.0 * bs2, 14.0 * bs2, Vector3(0, 7, 0) * bs2, Vector3.ZERO, 14)
	k.ball(br, "B", Vector3(12.0, 8.5, 15.0) * bs2, Vector3(0, 18, 0) * bs2)
	k.box(br, "G", Vector3(13.6, 1.8, 1.0) * bs2, Vector3(0, 18.5, -13.9) * bs2)
	k.box(br, "G", Vector3(1.0, 1.6, 9.0) * bs2, Vector3(11.0, 18.5, -6.2) * bs2, Vector3(0, -0.45, 0))
	k.box(br, "G", Vector3(1.0, 1.6, 9.0) * bs2, Vector3(-11.0, 18.5, -6.2) * bs2, Vector3(0, 0.45, 0))
	for sx: float in [-1.0, 0.0, 1.0]:
		_spike(k, br, "C", Vector3(sx * 6.0, 24.0, 5.0) * bs2, Vector3(sx * 10.0, 42.0 - absf(sx) * 7.0, 15.0) * bs2, 1.6 * bs2, 6)
	_specs.append({"kind": "bridge", "anchor": br, "off": Vector3(0, 17, 0) * bs2, "r": 15.0 * bs2, "bones": [br]})
	var main: String = def["main"]
	if big:
		# main battery: three dorsal triples, one ventral triple, a beam lance on each flank
		_turret(k, fore, Vector3(0, _rad(-96.0, s) - 1.5, -96), 0.0, 3, 1.5, main, 4.0)
		k.cyl(hf, "B", 13.0, 14.0, 10.0, Vector3(0, _rad(-48.0, s) + 3.0, -48), Vector3.ZERO, 14)
		_turret(k, fore, Vector3(0, _rad(-48.0, s) + 8.0, -48), 0.0, 3, 1.5, main, 1.4)
		_turret(k, aft, Vector3(0, _rad(132.0, s) - 0.5, 132), 0.0, 3, 1.5, main, 4.0)
		_turret(k, fore, Vector3(0, -_rad(-60.0, s) + 1.0, -60), PI, 3, 1.5, main, 1.4)
		_turret(k, aft, Vector3(_rad(6.0, s) - 0.5, 6.0, 6), -HZ, 1, 1.5, str(def["beam"]), 9.0)
		_turret(k, aft, Vector3(-_rad(6.0, s) + 0.5, 6.0, 6), HZ, 1, 1.5, str(def["beam"]), 9.0)
		for z: float in [-104.0, 104.0]:
			for i in 4:
				var a := HZ * 0.5 + float(i) * HZ
				var c := Vector3(cos(a), sin(a), 0)
				_pd(k, fore if z < split else aft, c * (_rad(z, s) + 0.6) + Vector3(0, 0, z), atan2(-c.x, c.y), 1.3)
		for sx: float in [-1.0, 1.0]:
			for sy: float in [-1.0, 1.0]:
				_engine(k, Vector3(sx * 18.5, sy * 18.5, 198.0), 12.5, 76.0)
	else:
		_turret(k, fore, Vector3(0, _rad(-80.0 * s, s) - 0.6, -80.0 * s), 0.0, 2, 0.9, main, 1.4)
		_turret(k, fore, Vector3(0, -_rad(-50.0 * s, s) + 0.5, -50.0 * s), PI, 2, 0.9, main, 4.0)
		for i in 4:
			var a := HZ * 0.5 + float(i) * HZ
			var c := Vector3(cos(a), sin(a), 0)
			var z := -20.0 * s if i % 2 == 0 else 118.0 * s
			_pd(k, fore if z < split else aft, c * (_rad(z, s) + 0.4) + Vector3(0, 0, z), atan2(-c.x, c.y), 1.0)
		for sx: float in [-1.0, 1.0]:
			_engine(k, Vector3(sx * 19.0 * s, 0, 198.0 * s), 7.0, 42.0)
