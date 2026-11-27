extends Node3D
# Particle systems driven by emit_particle(), flash lights, scorch decals, debris.

const Tex = preload("res://scripts/tex.gd")
const FLAGS := GPUParticles3D.EMIT_FLAG_POSITION | GPUParticles3D.EMIT_FLAG_VELOCITY

var sys := {}
var lights: Array = []
var li := 0
var decals: Array[Decal] = []
var di := 0
var debris: Array[RigidBody3D] = []
var dbi := 0
var beams: Array = []
const MOONS := 128
var moon_mm: MultiMesh
var moons: Array = []
var moon_i := 0
var moon_live := 0
var world
var space := false
static var vac := false       # vacuum: longer, fainter exhaust with shock diamonds

static var _pl_mesh: CylinderMesh
static var _pl_mat: ShaderMaterial


# exhaust plume mesh hanging along the parent's local -Y
static func plume(parent: Node3D, r: float, ln: float, layer: int = 1) -> MeshInstance3D:
	if _pl_mesh == null:
		_pl_mesh = CylinderMesh.new()
		_pl_mesh.top_radius = 0.5
		_pl_mesh.bottom_radius = 0.16
		_pl_mesh.height = 1.0
		_pl_mesh.radial_segments = 12
		_pl_mesh.rings = 4
		_pl_mesh.cap_top = false
		_pl_mesh.cap_bottom = false
		_pl_mat = ShaderMaterial.new()
		_pl_mat.shader = load("res://shaders/plume.gdshader")
	var pm := MeshInstance3D.new()
	pm.mesh = _pl_mesh
	pm.material_override = _pl_mat
	pm.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	pm.layers = layer
	pm.extra_cull_margin = 200.0
	pm.position = Vector3(0, -ln * 0.5, 0)
	pm.scale = Vector3(r, ln, r)
	parent.add_child(pm)
	return pm


static func set_plume(pm: MeshInstance3D, r: float, ln: float, power: float) -> void:
	if ln < 0.05 or power < 0.02:
		pm.visible = false
		return
	if vac:
		ln *= 1.9
		power *= 0.62
	pm.visible = true
	pm.position = Vector3(0, -ln * 0.5, 0)
	pm.scale = Vector3(r, ln, r)
	pm.set_instance_shader_parameter("power", power)


func setup(w) -> void:
	world = w
	var dc := Color(0.58, 0.48, 0.35)
	sys["dust"] = _sys(900, 2.8, false, [[0.0, Color(dc, 0.0)], [0.12, Color(dc, 0.42)], [1.0, Color(dc, 0.0)]], Vector2(5, 10), Vector2(0.35, 1.6), Vector3(0, 0.3, 0), 1.5, 0)
	sys["haze"] = _sys(400, 7.0, false, [[0.0, Color(dc, 0.0)], [0.2, Color(dc, 0.13)], [1.0, Color(dc, 0.0)]], Vector2(40, 70), Vector2(0.6, 1.2), Vector3.ZERO, 0.0, 0)
	sys["smoke"] = _sys(900, 4.2, false, [[0.0, Color(0.05, 0.047, 0.044, 0.0)], [0.08, Color(0.075, 0.07, 0.065, 0.62)], [0.6, Color(0.18, 0.17, 0.16, 0.36)], [1.0, Color(0.24, 0.23, 0.22, 0.0)]], Vector2(8, 16), Vector2(0.4, 1.7), Vector3(0, 0.8, 0), 0.8, 0)
	sys["trail"] = _sys(900, 1.3, false, [[0.0, Color(0.7, 0.68, 0.65, 0.0)], [0.1, Color(0.7, 0.68, 0.65, 0.5)], [1.0, Color(0.5, 0.48, 0.46, 0.0)]], Vector2(1.5, 3.2), Vector2(0.4, 1.6), Vector3.ZERO, 0.8, 0)
	sys["fire"] = _sys(500, 0.5, true, [[0.0, Color(3.0, 1.9, 0.7, 1.0)], [0.4, Color(1.8, 0.6, 0.12, 0.9)], [1.0, Color(0.25, 0.04, 0.0, 0.0)]], Vector2(7, 15), Vector2(0.5, 1.4), Vector3.ZERO, 2.0, 1)
	sys["flame"] = _sys(900, 0.14, true, [[0.0, Color(1.5, 1.7, 2.6, 0.9)], [0.5, Color(2.0, 0.75, 0.15, 0.8)], [1.0, Color(0.5, 0.08, 0.0, 0.0)]], Vector2(1.2, 2.2), Vector2(1.0, 0.25), Vector3.ZERO, 1.0, 1)
	sys["muzzle"] = _sys(300, 0.07, true, [[0.0, Color(3.0, 2.1, 0.9, 1.0)], [1.0, Color(1.2, 0.4, 0.08, 0.0)]], Vector2(2.0, 3.8), Vector2(1.0, 0.5), Vector3.ZERO, 2.0, 1)
	sys["spark"] = _sys(900, 0.7, true, [[0.0, Color(4.0, 2.4, 0.9, 1.0)], [0.6, Color(2.0, 0.6, 0.1, 1.0)], [1.0, Color(0.5, 0.1, 0.0, 0.0)]], Vector2(0.45, 1.0), Vector2(1.0, 0.2), Vector3(0, -30, 0), 1.0, 1)
	for i in 4:
		var l := OmniLight3D.new()
		l.light_color = Color(1.0, 0.62, 0.3)
		l.omni_range = 110.0
		l.light_energy = 0.0
		l.shadow_enabled = false
		add_child(l)
		lights.append({"l": l, "t": 0.0, "d": 1.0, "e": 0.0})
	for i in 24:
		var d := Decal.new()
		d.texture_albedo = Tex.scorch
		d.size = Vector3(12, 10, 12)
		d.cull_mask = 1
		d.visible = false
		d.upper_fade = 0.3
		d.lower_fade = 0.3
		add_child(d)
		decals.append(d)
	var cm := CylinderMesh.new()
	cm.top_radius = 1.0
	cm.bottom_radius = 1.0
	cm.height = 1.0
	cm.radial_segments = 10
	cm.rings = 1
	cm.cap_top = false
	cm.cap_bottom = false
	var bmat := ShaderMaterial.new()
	bmat.shader = load("res://shaders/beam.gdshader")
	for i in 14:
		var b := MeshInstance3D.new()
		b.mesh = cm
		b.material_override = bmat
		b.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		b.visible = false
		b.extra_cull_margin = 2000.0
		add_child(b)
		beams.append({"m": b, "used": false})
	# anti-air bursts: discs that wane into crescents (shaders/moon.gdshader)
	moon_mm = MultiMesh.new()
	moon_mm.transform_format = MultiMesh.TRANSFORM_3D
	moon_mm.use_colors = true
	moon_mm.use_custom_data = true
	var qm := QuadMesh.new()
	qm.size = Vector2(2, 2)
	var mmat := ShaderMaterial.new()
	mmat.shader = load("res://shaders/moon.gdshader")
	qm.material = mmat
	moon_mm.mesh = qm
	moon_mm.instance_count = MOONS
	var hide := Transform3D(Basis().scaled(Vector3.ZERO), Vector3(0, -900, 0))
	for i in MOONS:
		moon_mm.set_instance_transform(i, hide)
		moons.append({"on": false, "t": 0.0, "dur": 1.0, "seed": 0.0, "pos": Vector3.ZERO, "size": 1.0, "vel": Vector3.ZERO})
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = moon_mm
	mmi.extra_cull_margin = 16000.0
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mmi)
	var bm := BoxMesh.new()
	for i in 36:
		var rb := RigidBody3D.new()
		rb.collision_layer = 4
		rb.collision_mask = 1
		rb.mass = 50.0
		var mi := MeshInstance3D.new()
		mi.mesh = bm
		mi.material_override = Tex.armor
		mi.set_instance_shader_parameter("tint", Color(0.08, 0.075, 0.07))
		mi.set_instance_shader_parameter("wreck", 0.7)
		rb.add_child(mi)
		var cs := CollisionShape3D.new()
		cs.shape = BoxShape3D.new()
		rb.add_child(cs)
		rb.freeze = true
		rb.visible = false
		rb.position = Vector3(0, -500, 0)
		add_child(rb)
		debris.append(rb)


func _sys(amount: int, life: float, additive: bool, grad: Array, scale: Vector2, curve: Vector2, grav: Vector3, damp: float, prio: int) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.amount = amount
	p.lifetime = life
	p.emitting = false
	p.local_coords = false
	p.visibility_aabb = AABB(Vector3(-3000, -600, -3000), Vector3(6000, 2000, 6000))
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var pm := ParticleProcessMaterial.new()
	pm.gravity = grav
	pm.damping_min = damp
	pm.damping_max = damp
	pm.scale_min = scale.x
	pm.scale_max = scale.y
	pm.angle_min = -180.0
	pm.angle_max = 180.0
	pm.lifetime_randomness = 0.35
	pm.direction = Vector3.UP
	pm.spread = 180.0
	pm.initial_velocity_min = 0.0
	pm.initial_velocity_max = 0.0
	var cv := Curve.new()
	cv.add_point(Vector2(0.0, curve.x))
	cv.add_point(Vector2(1.0, curve.y))
	var ct := CurveTexture.new()
	ct.curve = cv
	pm.scale_curve = ct
	var g := Gradient.new()
	var cols := PackedColorArray()
	var offs := PackedFloat32Array()
	for e in grad:
		offs.append(e[0])
		cols.append(e[1])
	g.offsets = offs
	g.colors = cols
	var gt := GradientTexture1D.new()
	gt.gradient = g
	gt.use_hdr = true
	pm.color_ramp = gt
	p.process_material = pm
	var q := QuadMesh.new()
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.billboard_keep_scale = true
	m.vertex_color_use_as_albedo = true
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_texture = Tex.glow if additive else Tex.puff
	if additive:
		m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.proximity_fade_enabled = true
	m.proximity_fade_distance = 2.5
	m.render_priority = prio
	q.material = m
	p.draw_pass_1 = q
	add_child(p)
	return p


# Vacuum: nothing falls, nothing is slowed down, and there is no air to carry smoke or dust.
func set_space(on: bool) -> void:
	space = on
	vac = on
	for k in sys:
		var pm: ParticleProcessMaterial = (sys[k] as GPUParticles3D).process_material
		if not pm.has_meta("g0"):
			pm.set_meta("g0", pm.gravity)
			pm.set_meta("d0", pm.damping_min)
		pm.gravity = Vector3.ZERO if on else pm.get_meta("g0")
		pm.damping_min = 0.0 if on else float(pm.get_meta("d0"))
		pm.damping_max = pm.damping_min
	for rb in debris:
		rb.gravity_scale = 0.0 if on else 1.0
		rb.linear_damp = 0.0
	if _pl_mat != null:
		_pl_mat.set_shader_parameter("vacuum", 1.0 if on else 0.0)


func emit(kind: String, pos: Vector3, vel: Vector3) -> void:
	if space:
		# no smoke, haze or dust in a vacuum: gas and grit just fly off as sparks
		if kind == "haze":
			return
		if kind == "smoke" or kind == "dust":
			if randf() < 0.6:
				return
			kind = "spark"
			vel *= 2.5
	var p: GPUParticles3D = sys[kind]
	p.emit_particle(Transform3D(Basis.IDENTITY, pos), vel, Color.WHITE, Color.WHITE, FLAGS)


func flash(pos: Vector3, energy: float, dur: float, col: Color = Color(1.0, 0.62, 0.3)) -> void:
	var o: Dictionary = lights[li]
	li = (li + 1) % lights.size()
	o["l"].global_position = pos
	o["l"].light_color = col
	o["l"].light_energy = energy
	o["t"] = dur
	o["d"] = dur
	o["e"] = energy


func dust(pos: Vector3, n: int, radius: float, spread: float, up: float) -> void:
	for i in n:
		var a := randf() * TAU
		var sp := randf_range(spread * 0.3, spread)
		emit("dust", pos + Vector3(cos(a) * radius, randf_range(0.3, 1.5), sin(a) * radius), Vector3(cos(a) * sp, randf_range(up * 0.4, up), sin(a) * sp))


func sparks(pos: Vector3, n: int, speed: float, dir: Vector3 = Vector3.ZERO) -> void:
	for i in n:
		var v := Vector3(randf_range(-1, 1), randf_range(-0.4, 1), randf_range(-1, 1)) + dir * 1.2
		emit("spark", pos, v * randf_range(speed * 0.3, speed))


func muzzle(pos: Vector3, dir: Vector3, s: float) -> void:
	for i in 4:
		emit("muzzle", pos + dir * (i * 0.7 * s), dir * randf_range(6, 30) * s)
	if s > 1.2:
		for i in 5:
			emit("trail", pos, dir * randf_range(4, 18) + Vector3(randf_range(-3, 3), randf_range(0, 3), randf_range(-3, 3)))
	flash(pos, 6.0 * s, 0.07)


func thruster(pos: Vector3, dir: Vector3) -> void:
	emit("flame", pos, dir * randf_range(30, 46))


func explosion(pos: Vector3, s: float) -> void:
	if space:
		# a hard white flash, then a shell of sparks and fragments leaving at constant speed
		flash(pos, 70.0 * s, 0.16, Color(1.0, 0.95, 0.85))
		for i in int(round(5 * minf(s, 2.5))):
			emit("fire", pos + Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * s, Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)).normalized() * randf_range(10, 30) * s)
		var ns := int(round(46 * minf(s, 2.5)))
		for i in ns:
			var dv := Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)).normalized()
			emit("spark", pos + dv * s, dv * randf_range(40.0, 120.0) * sqrt(s))
		if s > 1.2:
			chunks(pos, int(s * 2.0), s * 0.5)
		return
	var n := int(round(8 * minf(s, 2.5)))
	for i in n:
		emit("fire", pos + Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * 1.5 * s, Vector3(randf_range(-9, 9), randf_range(-2, 13), randf_range(-9, 9)) * s)
	sparks(pos, int(round(16 * minf(s, 2.5))), 55.0 * sqrt(s))
	for i in n + 3:
		var a := randf() * TAU
		var sp := randf_range(3, 13) * s
		emit("smoke", pos + Vector3(cos(a), 0.5, sin(a)) * s, Vector3(cos(a) * sp, randf_range(4, 13) * s, sin(a) * sp))
	var gy: float = world.height(pos.x, pos.z)
	if pos.y - gy < 10.0 * s:
		dust(Vector3(pos.x, gy, pos.z), 9, 2.0 * s, 20.0 * s, 6.0 * s)
		var d := decals[di]
		di = (di + 1) % decals.size()
		var r := randf_range(5, 8) * s
		d.size = Vector3(r * 2.0, 12.0, r * 2.0)
		d.global_position = Vector3(pos.x, gy, pos.z)
		d.rotation.y = randf() * TAU
		d.visible = true
	flash(pos + Vector3(0, 2, 0), 40.0 * s, 0.3)


func chunks(pos: Vector3, n: int, s: float) -> void:
	for i in n:
		var rb := debris[dbi]
		dbi = (dbi + 1) % debris.size()
		var sz := Vector3(randf_range(0.5, 2.4), randf_range(0.3, 1.4), randf_range(0.5, 2.8)) * s
		(rb.get_child(0) as MeshInstance3D).scale = sz
		var bs := BoxShape3D.new()
		bs.size = sz
		(rb.get_child(1) as CollisionShape3D).shape = bs
		rb.freeze = false
		rb.visible = true
		rb.global_position = pos + Vector3(randf_range(-2, 2), randf_range(-2, 3), randf_range(-2, 2))
		rb.linear_velocity = Vector3(randf_range(-22, 22), randf_range(-22, 22) if space else randf_range(8, 34), randf_range(-22, 22)) * sqrt(s)
		rb.angular_velocity = Vector3(randf_range(-6, 6), randf_range(-6, 6), randf_range(-6, 6))


# call every frame while the beam should exist; unused beams hide themselves
func beam(from: Vector3, to: Vector3, width: float, col: Color, soft: float = 0.0, power: float = 1.0) -> void:
	for b in beams:
		if b["used"]:
			continue
		b["used"] = true
		var m: MeshInstance3D = b["m"]
		var d := to - from
		var ln := d.length()
		if ln < 0.1:
			return
		var y := d / ln
		var x := y.cross(Vector3.UP if absf(y.y) < 0.99 else Vector3.RIGHT).normalized()
		var z := x.cross(y)
		m.global_transform = Transform3D(Basis(x * width, y * ln, z * width), (from + to) * 0.5)
		m.set_instance_shader_parameter("tint", col)
		m.set_instance_shader_parameter("soft", soft)
		m.set_instance_shader_parameter("power", power)
		m.visible = true
		return


# one anti-air burst disc; lives dur seconds while it wanes from full to crescent
func moon(pos: Vector3, size: float, dur: float, col: Color = Color(1.0, 0.3, 0.6), vel: Vector3 = Vector3.ZERO) -> void:
	var m: Dictionary = moons[moon_i]
	if not m["on"]:
		moon_live += 1
	m["on"] = true
	m["t"] = 0.0
	m["dur"] = dur
	m["seed"] = randf()
	m["pos"] = pos
	m["size"] = size
	m["vel"] = vel
	moon_mm.set_instance_color(moon_i, col)
	moon_mm.set_instance_custom_data(moon_i, Color(0.0, float(m["seed"]), 0.0, 0.0))
	moon_mm.set_instance_transform(moon_i, Transform3D(Basis().scaled(Vector3.ONE * size), pos))
	moon_i = (moon_i + 1) % MOONS


func flak(pos: Vector3, s: float = 1.0) -> void:
	moon(pos, randf_range(9.0, 15.0) * s, randf_range(1.5, 2.6), Color(1.0, 0.3, 0.6), Vector3(randf_range(-2, 2), -2.0, randf_range(-2, 2)))
	for i in 5:
		emit("smoke", pos + Vector3(randf_range(-2, 2), randf_range(-2, 2), randf_range(-2, 2)) * s, Vector3(randf_range(-6, 6), randf_range(-3, 6), randf_range(-6, 6)) * s)
	emit("fire", pos, Vector3.ZERO)
	sparks(pos, 6, 40.0)
	flash(pos, 18.0 * s, 0.12)


func tick(dt: float) -> void:
	if moon_live > 0:
		for i in MOONS:
			var m: Dictionary = moons[i]
			if not m["on"]:
				continue
			var t: float = float(m["t"]) + dt
			m["t"] = t
			if t >= float(m["dur"]):
				m["on"] = false
				moon_live -= 1
				moon_mm.set_instance_transform(i, Transform3D(Basis().scaled(Vector3.ZERO), Vector3(0, -900, 0)))
				continue
			var p: Vector3 = m["pos"] + m["vel"] * dt
			m["pos"] = p
			moon_mm.set_instance_custom_data(i, Color(t / float(m["dur"]), float(m["seed"]), 0.0, 0.0))
			moon_mm.set_instance_transform(i, Transform3D(Basis().scaled(Vector3.ONE * float(m["size"])), p))
	for b in beams:
		if b["used"]:
			b["used"] = false
		else:
			b["m"].visible = false
	for o in lights:
		if o["t"] > 0.0:
			o["t"] -= dt
			o["l"].light_energy = maxf(0.0, o["e"] * o["t"] / o["d"])
