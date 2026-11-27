extends "res://scripts/unit.gd"
# Fixed installations of the gun line: the anti-orbit rail cannon (defence objective)
# and twin AA guns that hose the sky with tracers.

const Glb = preload("res://scripts/glb_kit.gd")
const MeshKit = preload("res://scripts/mesh_kit.gd")
const Tex = preload("res://scripts/tex.gd")
const Weapon = preload("res://scripts/weapon.gd")
const Defs = preload("res://scripts/defs.gd")
const U = preload("res://scripts/u.gd")

var yaw_n: Node3D
var pitch_n: Node3D
var muz: Array = []
var mi := 0
var weapon
var t_yaw := 0.0
var t_pitch := 0.4
var want_yaw := 0.0
var want_pitch := 0.4
var target = null
var think_t := 0.0
var burst_t := 0.0
var idle_t := 2.0
var meshes: Array = []
var glow: StandardMaterial3D
var charge := 0.0
var fire_t := -1.0
var beam_t := 0.0
var beam_to := Vector3.ZERO
var recoil := 0.0
var dead_t := 0.0
var fx_t := 0.0
var barrel_len := 70.0
var pitch_rest := Vector3.ZERO


func setup(g, kind_id: String, t: int, pos: Vector3, yaw: float) -> void:
	game = g
	team = t
	kind = kind_id
	collision_layer = 2
	collision_mask = 0
	glow = StandardMaterial3D.new()
	glow.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	glow.albedo_color = Color(0.3, 0.6, 1.0) * 0.6
	var am := Tex.armor
	var mats := {
		"A": {"mat": am, "params": {"tint": Color(0.28, 0.3, 0.25), "metal": 0.4}},
		"B": {"mat": Tex.concrete, "params": {"tint": Color(0.46, 0.44, 0.4), "metal": 0.0}},
		"C": {"mat": am, "params": {"tint": Color(0.6, 0.42, 0.1), "metal": 0.3}},
		"F": {"mat": am, "params": {"tint": Color(0.09, 0.095, 0.1), "metal": 0.75}},
		"W": {"mat": am, "params": {"tint": Color(0.08, 0.085, 0.09), "metal": 0.75}},
		"T": {"mat": am, "params": {"tint": Color(0.02, 0.02, 0.022), "metal": 0.6}},
		"H": {"mat": am, "params": {"tint": Color(0.7, 0.5, 0.06), "metal": 0.2, "stripes": 1.0}},
		"G": {"mat": glow},
	}
	var root := Glb.instance(kind_id)
	if root != null:
		add_child(root)
		yaw_n = Glb.find(root, kind_id + "_yaw")
		pitch_n = Glb.find(root, kind_id + "_pitch")
		for nm in ["_muzzle", "_muzzle_L", "_muzzle_R"]:
			var m := Glb.find(root, kind_id + nm)
			if m != null:
				muz.append(m)
		Glb.skin(root, mats, 2, meshes)
	if yaw_n == null or pitch_n == null or muz.is_empty():
		if root != null:
			root.queue_free()
			meshes.clear()
		muz.clear()
		_build_proc(kind_id, mats)
	pitch_rest = pitch_n.position
	var cs := CollisionShape3D.new()
	var cy := CylinderShape3D.new()
	if kind == "cannon":
		unit_name = "对轨炮"
		ap_max = 20000.0
		hit_h = 30.0
		radius = 24.0
		objective = true
		cy.radius = 23.0
		cy.height = 16.0
		t_pitch = 0.7
		want_pitch = 0.7
		barrel_len = (pitch_n.global_position - (muz[0] as Node3D).global_position).length() if is_inside_tree() else 70.0
	else:
		unit_name = "双联高炮"
		ap_max = 2400.0
		hit_h = 9.0
		radius = 5.0
		cy.radius = 5.0
		cy.height = 8.0
		weapon = Weapon.new(Defs.WEAPONS["aa_gun"], "M")
		spread_mul = 1.0
		lead_k = 1.0
	cs.shape = cy
	cs.position = Vector3(0, cy.height * 0.5, 0)
	add_child(cs)
	ap = ap_max
	global_position = pos
	t_yaw = yaw
	want_yaw = yaw
	idle_t = randf_range(0.5, 4.0)
	_apply()


func _build_proc(kind_id: String, mats: Dictionary) -> void:
	var k := MeshKit.new(3)
	k.dust = 0.6
	k.dust_top = 6.0
	var hz := PI * 0.5
	var base := k.bone(self)
	if kind_id == "cannon":
		k.cyl(base, "B", 21.0, 23.0, 11.0, Vector3(0, 5.5, 0), Vector3(0, PI / 8.0, 0), 8)
		k.cyl(base, "H", 21.4, 21.4, 0.6, Vector3(0, 10.9, 0), Vector3(0, PI / 8.0, 0), 8)
		yaw_n = k.bone(base, Vector3(0, 11.2, 0))
		k.cyl(yaw_n, "F", 14.0, 15.0, 3.0, Vector3(0, 1.5, 0), Vector3.ZERO, 16)
		for s in [-1.0, 1.0]:
			k.box(yaw_n, "A", Vector3(4, 16, 18), Vector3(s * 9.0, 10, 2), Vector3.ZERO, {"tz": 0.6})
		pitch_n = k.bone(yaw_n, Vector3(0, 15, 0))
		k.box(pitch_n, "A", Vector3(12, 9, 26), Vector3(0, 0, 4), Vector3.ZERO, {"tx": 0.8})
		for s in [-1.0, 1.0]:
			k.box(pitch_n, "W", Vector3(1.6, 3.0, 72), Vector3(s * 2.2, 0, -36))
			k.cyl(pitch_n, "F", 1.0, 1.0, 20.0, Vector3(s * 4.5, -1.0, -14), Vector3(hz, 0, 0), 8)
		for i in 8:
			k.box(pitch_n, "G", Vector3(7.4, 4.6, 1.0), Vector3(0, 0, -10.0 - i * 7.6))
			k.box(pitch_n, "F", Vector3(8.0, 5.2, 2.4), Vector3(0, 0, -11.8 - i * 7.6))
		muz.append(_marker(pitch_n, Vector3(0, 0, -73)))
	else:
		k.cyl(base, "F", 3.4, 4.0, 1.6, Vector3(0, 0.8, 0), Vector3.ZERO, 12)
		yaw_n = k.bone(base, Vector3(0, 1.6, 0))
		k.box(yaw_n, "A", Vector3(4.6, 3.0, 5.0), Vector3(0, 1.6, 0.6), Vector3.ZERO, {"tx": 0.8, "tz": 0.8})
		k.cyl(yaw_n, "F", 0.9, 0.2, 0.5, Vector3(1.6, 4.4, 1.2), Vector3(0.6, 0, 0), 10)
		pitch_n = k.bone(yaw_n, Vector3(0, 2.6, -1.0))
		for s in [-1.0, 1.0]:
			k.cyl(pitch_n, "W", 0.22, 0.26, 8.0, Vector3(s * 0.8, 0, -4.4), Vector3(hz, 0, 0), 8)
			k.box(pitch_n, "F", Vector3(1.0, 1.2, 2.6), Vector3(s * 0.8, 0, -0.6))
			k.cyl(pitch_n, "A", 0.9, 0.9, 1.0, Vector3(s * 2.0, 0, 0.2), Vector3(0, 0, hz), 10)
			muz.append(_marker(pitch_n, Vector3(s * 0.8, 0, -8.6)))
	for m in k.bake(mats):
		m.layers = 2
		meshes.append(m)


func _marker(parent: Node3D, pos: Vector3) -> Node3D:
	var m := Node3D.new()
	m.position = pos
	parent.add_child(m)
	return m


func _apply() -> void:
	yaw_n.rotation.y = t_yaw
	pitch_n.rotation.x = t_pitch
	pitch_n.position = pitch_rest + pitch_n.basis.z * (recoil * (5.0 if kind == "cannon" else 0.7))


func center() -> Vector3:
	return global_position + Vector3(0, hit_h * 0.5, 0)


func muzzle(_mount: String) -> Vector3:
	return (muz[mi % muz.size()] as Node3D).global_position


func aim_dir() -> Vector3:
	return -(muz[0] as Node3D).global_transform.basis.z.normalized()


func on_fired(_d: Dictionary, _mount: String = "M", _power: float = 1.0) -> void:
	recoil = 1.0
	mi += 1


# cannon: point the barrel somewhere (mission drives this)
func aim_at(p: Vector3) -> void:
	var dd := p - pitch_n.global_position
	want_yaw = atan2(-dd.x, -dd.z)
	want_pitch = clampf(atan2(dd.y, Vector2(dd.x, dd.z).length()), 0.05, 1.4)


# cannon: start the firing sequence; the shot lands after `lead` seconds
func fire_at(p: Vector3, lead: float = 1.3) -> void:
	if not alive:
		return
	aim_at(p)
	fire_t = lead
	beam_to = p
	game.sfx.play("charge", muzzle("M"), 1.6, 1.5 / lead * 0.9)


func tick(dt: float) -> void:
	if not alive:
		dead_t += dt
		if dead_t < 60.0:
			fx_t -= dt
			if fx_t <= 0.0:
				fx_t = 0.16
				game.fx.emit("smoke", global_position + Vector3(randf_range(-6, 6), hit_h * 0.4, randf_range(-6, 6)), Vector3(randf_range(2, 5), randf_range(6, 11), randf_range(-1, 1)))
				if dead_t < 20.0 and randf() < 0.6:
					game.fx.emit("fire", global_position + Vector3(randf_range(-6, 6), hit_h * 0.3, randf_range(-6, 6)), Vector3(0, randf_range(2, 6), 0))
		return
	alert_t -= dt
	recoil = maxf(0.0, recoil - dt * (0.7 if kind == "cannon" else 6.0))
	if kind == "cannon":
		_tick_cannon(dt)
	else:
		_tick_aa(dt)
	_apply()


func _tick_cannon(dt: float) -> void:
	t_yaw = U.turn_to(t_yaw, want_yaw, 0.35 * dt)
	t_pitch = U.turn_to(t_pitch, want_pitch, 0.3 * dt)
	var flick := 0.0
	if fire_t >= 0.0:
		fire_t -= dt
		flick = 2.5 + sin(fire_t * 60.0)
		if fire_t < 0.0:
			beam_t = 0.45
			recoil = 1.0
			var o := muzzle("M")
			game.fx.flash(o, 160.0, 0.5, Color(0.6, 0.8, 1.0))
			game.fx.muzzle(o, aim_dir(), 6.0)
			game.fx.dust(global_position, 16, 26.0, 40.0, 6.0)
			game.sfx.play("cannon_big", o, 2.2)
			game.sfx.play2d("cannon_big", 0.35)
			game.shake(0.7, global_position)
	if beam_t > 0.0:
		beam_t -= dt
		var o := muzzle("M")
		var k := beam_t / 0.45
		game.fx.beam(o, beam_to, 1.0 + 5.0 * k, Color(0.55, 0.8, 1.0), 0.0, 0.5 + k * 1.5)
		flick = 4.0 * k
	glow.albedo_color = Color(0.3, 0.62, 1.0) * (0.3 + charge * 2.4 + flick)


func _tick_aa(dt: float) -> void:
	think_t -= dt
	if think_t <= 0.0:
		think_t = randf_range(0.4, 0.7)
		target = null
		var best := 720.0
		for u in game.units:
			if not u.alive or u.team == team or u.hidden or u.kind == "engine":
				continue
			var d: float = u.center().distance_to(global_position)
			if not u.airborne:
				if d > 240.0:
					continue
				d += 500.0
			if d < best:
				best = d
				target = u
	weapon.tick(dt, self)
	var firing := false
	if target != null and target.alive:
		var tc: Vector3 = target.center()
		var o := pitch_n.global_position
		var tt := o.distance_to(tc) / float(weapon.d["speed"])
		var aim: Vector3 = tc + target.velocity * tt
		var dd := aim - o
		want_yaw = atan2(-dd.x, -dd.z)
		want_pitch = clampf(atan2(dd.y, Vector2(dd.x, dd.z).length()), -0.1, 1.45)
		c_lock = target
		c_aim_point = aim
		firing = absf(U.ang_diff(t_yaw, want_yaw)) < 0.12 and absf(want_pitch - t_pitch) < 0.12
	else:
		# nothing in range: sweep the sky and throw up harassing fire
		c_lock = null
		idle_t -= dt
		if idle_t <= 0.0:
			idle_t = randf_range(3.0, 7.0)
			burst_t = randf_range(0.8, 1.6)
			want_yaw = randf_range(-1.1, 1.1)
			want_pitch = randf_range(0.5, 1.1)
		if burst_t > 0.0:
			burst_t -= dt
			var f := aim_dir()
			c_aim_point = muzzle("M") + f * 800.0
			firing = absf(U.ang_diff(t_yaw, want_yaw)) < 0.2
	t_yaw = U.turn_to(t_yaw, want_yaw, 1.5 * dt)
	t_pitch = U.turn_to(t_pitch, want_pitch, 1.2 * dt)
	if firing:
		weapon.trigger(self)


func take_damage(dmg: float, _imp: float, from, how: String, pos: Vector3) -> void:
	if not alive:
		return
	dmg *= vuln()
	if kind == "cannon" and how == "melee":
		dmg *= 0.6
	ap -= dmg
	last_hit_by = from
	alert_t = 15.0
	game.on_damage(self, dmg, from, how, pos)
	if ap <= 0.0:
		ap = 0.0
		alive = false
		state = "dead"
		collision_layer = 1
		for m in meshes:
			if m.get_meta("key", "") == "G":
				m.visible = false
			else:
				m.set_instance_shader_parameter("wreck", 1.0)
		pitch_n.rotation.x = -0.08
		game.on_unit_killed(self, from)
