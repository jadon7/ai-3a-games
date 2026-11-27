extends "res://scripts/unit.gd"
# Howitzer emplacement (static) and tank (mobile).

const MeshKit = preload("res://scripts/mesh_kit.gd")
const Tex = preload("res://scripts/tex.gd")
const Weapon = preload("res://scripts/weapon.gd")
const Defs = preload("res://scripts/defs.gd")
const U = preload("res://scripts/u.gd")

var mobile := false
var turret: Node3D
var gun: Node3D
var muz: Node3D
var weapon
var t_yaw := 0.0
var t_pitch := 0.0
var think_t := 0.0
var target = null
var los_ok := false
var sense := 600.0
var meshes: Array[MeshInstance3D] = []
var dead_t := 0.0
var fx_t := 0.0
var strafe := 1.0
var strafe_t := 0.0
var body_yaw := 0.0
var hull: Node3D
var recoil := 0.0


func setup(g, kind_id: String, t: int, pos: Vector3, yaw: float) -> void:
	game = g
	team = t
	kind = kind_id
	mobile = kind_id == "tank"
	collision_layer = 2
	collision_mask = 3
	var k := MeshKit.new(int(pos.x * 7.0 + pos.z))
	k.dust = 0.7
	k.dust_top = 5.0
	var hz := PI * 0.5
	hull = k.bone(self)
	var cs := CollisionShape3D.new()
	if mobile:
		unit_name = "T-4 坦克"
		ap_max = 750.0
		hit_h = 5.0
		sense = 420.0
		weapon = Weapon.new(Defs.WEAPONS["t_gun"])
		k.box(hull, "A", Vector3(6.4, 1.8, 10.5), Vector3(0, 1.9, 0), Vector3.ZERO, {"tx": 0.85, "tz": 0.8})
		for s in [-1.0, 1.0]:
			k.box(hull, "F", Vector3(1.6, 1.9, 11.0), Vector3(s * 3.1, 1.0, 0), Vector3.ZERO, {"bz": 0.85})
			k.box(hull, "B", Vector3(1.9, 0.3, 11.2), Vector3(s * 3.1, 2.05, 0))
		turret = k.bone(hull, Vector3(0, 2.8, 0.5))
		k.box(turret, "A", Vector3(4.2, 1.5, 5.2), Vector3(0, 0.75, 0), Vector3.ZERO, {"tx": 0.7, "tz": 0.75})
		k.box(turret, "B", Vector3(1.2, 0.6, 1.2), Vector3(1.0, 1.7, 0.8))
		gun = k.bone(turret, Vector3(0, 0.8, -2.2))
		k.cyl(gun, "W", 0.26, 0.3, 6.0, Vector3(0, 0, -3.0), Vector3(hz, 0, 0), 8)
		k.cyl(gun, "T", 0.4, 0.4, 0.8, Vector3(0, 0, -5.8), Vector3(hz, 0, 0), 8)
		muz = Node3D.new()
		muz.position = Vector3(0, 0, -6.4)
		gun.add_child(muz)
		var bs := BoxShape3D.new()
		bs.size = Vector3(7, 4.4, 10.5)
		cs.shape = bs
		cs.position = Vector3(0, 2.2, 0)
	else:
		unit_name = "榴弹炮台"
		ap_max = 2400.0
		hit_h = 9.0
		sense = 640.0
		objective = true
		weapon = Weapon.new(Defs.WEAPONS["t_how"])
		k.cyl(hull, "F", 4.6, 5.4, 2.2, Vector3(0, 1.1, 0), Vector3.ZERO, 14)
		k.box(hull, "H", Vector3(9.6, 0.5, 9.6), Vector3(0, 0.3, 0))
		turret = k.bone(hull, Vector3(0, 2.2, 0))
		k.box(turret, "A", Vector3(6.4, 3.6, 7.6), Vector3(0, 2.0, 0.4), Vector3.ZERO, {"tx": 0.75, "tz": 0.7})
		k.box(turret, "B", Vector3(6.8, 1.0, 3.0), Vector3(0, 0.6, 2.6))
		k.box(turret, "T", Vector3(1.4, 1.0, 0.3), Vector3(-1.6, 2.6, -3.2))
		k.box(turret, "F", Vector3(0.12, 3.2, 0.12), Vector3(2.6, 5.2, 2.4))
		gun = k.bone(turret, Vector3(0, 2.3, -2.6))
		k.cyl(gun, "W", 0.5, 0.66, 10.0, Vector3(0, 0, -4.8), Vector3(hz, 0, 0), 12)
		k.cyl(gun, "F", 0.95, 0.95, 2.6, Vector3(0, 0, -0.8), Vector3(hz, 0, 0), 12)
		k.box(gun, "T", Vector3(1.6, 1.1, 1.4), Vector3(0, 0, -9.6))
		muz = Node3D.new()
		muz.position = Vector3(0, 0, -10.6)
		gun.add_child(muz)
		var cy := CylinderShape3D.new()
		cy.radius = 5.0
		cy.height = 8.0
		cs.shape = cy
		cs.position = Vector3(0, 4.0, 0)
	add_child(cs)
	ap = ap_max
	var am := Tex.armor
	var mats := {
		"A": {"mat": am, "params": {"tint": Color(0.3, 0.22, 0.14), "metal": 0.4}},
		"B": {"mat": am, "params": {"tint": Color(0.13, 0.12, 0.11), "metal": 0.45}},
		"F": {"mat": am, "params": {"tint": Color(0.07, 0.07, 0.075), "metal": 0.7}},
		"W": {"mat": am, "params": {"tint": Color(0.08, 0.085, 0.09), "metal": 0.75}},
		"T": {"mat": am, "params": {"tint": Color(0.02, 0.02, 0.022), "metal": 0.6}},
		"H": {"mat": am, "params": {"tint": Color(0.7, 0.5, 0.06), "metal": 0.2, "stripes": 1.0}},
	}
	meshes = k.bake(mats)
	for mi in meshes:
		mi.layers = 2
	global_position = pos
	body_yaw = yaw
	t_yaw = yaw
	hull.rotation.y = yaw
	spread_mul = 1.0
	lead_k = 0.85


func muzzle(_mount: String) -> Vector3:
	return muz.global_position


func aim_dir() -> Vector3:
	return -muz.global_transform.basis.z


func on_fired(_d: Dictionary, _mount: String = "M", _power: float = 1.0) -> void:
	recoil = 1.0


func tick(dt: float) -> void:
	if not alive:
		dead_t += dt
		if dead_t < 40.0:
			fx_t -= dt
			if fx_t <= 0.0:
				fx_t = 0.2
				game.fx.emit("smoke", global_position + Vector3(randf_range(-2, 2), 3, randf_range(-2, 2)), Vector3(randf_range(2, 4), randf_range(5, 9), randf_range(-1, 1)))
		return
	alert_t -= dt
	think_t -= dt
	if think_t <= 0.0:
		think_t = randf_range(0.5, 0.9)
		target = null
		var best := sense * (1.5 if alert_t > 0.0 else 1.0)
		for u in game.units:
			if not u.alive or u.team == team or u.hidden or u.airborne:
				continue
			var d: float = u.global_position.distance_to(global_position)
			if d < best:
				best = d
				target = u
		los_ok = target != null and game.los(muz.global_position, target.center())
	weapon.tick(dt, self)
	recoil = maxf(0.0, recoil - dt * 2.5)
	gun.position.z = -2.2 + recoil * 1.2 if mobile else -2.6 + recoil * 1.6
	var hv := Vector2.ZERO
	if target != null and target.alive:
		var tc: Vector3 = target.center()
		var o := muz.global_position
		var dist := o.distance_to(tc)
		var tt := dist / float(weapon.d["speed"])
		var aim: Vector3 = tc + target.velocity * tt * lead_k
		aim.y += 0.5 * float(weapon.d.get("grav", 0.0)) * tt * tt
		var dd := aim - turret.global_position
		var want_yaw := atan2(-dd.x, -dd.z)
		var want_pitch := clampf(atan2(dd.y, Vector2(dd.x, dd.z).length()), -0.2, 0.9)
		t_yaw = U.turn_to(t_yaw, want_yaw, (0.9 if mobile else 0.6) * dt)
		t_pitch = U.turn_to(t_pitch, want_pitch, 0.5 * dt)
		c_lock = target
		c_aim_point = aim
		if los_ok and dist < float(weapon.d["range"]) and absf(U.ang_diff(t_yaw, want_yaw)) < 0.06:
			weapon.trigger(self)
		if mobile:
			var to := Vector2(tc.x - global_position.x, tc.z - global_position.z)
			var dl := to.length()
			var dirn := to / maxf(dl, 0.1)
			strafe_t -= dt
			if strafe_t <= 0.0:
				strafe_t = randf_range(3.0, 6.0)
				strafe = -strafe
			var rad := 0.0
			if dl > 260.0:
				rad = 1.0
			elif dl < 130.0:
				rad = -1.0
			var wish := (dirn * rad + Vector2(dirn.y, -dirn.x) * strafe * 0.7)
			if wish.length() > 0.1:
				wish = wish.normalized()
				body_yaw = U.turn_to(body_yaw, atan2(-wish.x, -wish.y), 0.8 * dt)
				var f := U.fwd(body_yaw)
				hv = Vector2(f.x, f.z) * 9.0 * maxf(0.0, Vector2(f.x, f.z).dot(wish))
	if mobile:
		var cur := Vector2(velocity.x, velocity.z).move_toward(hv, 12.0 * dt)
		velocity = Vector3(cur.x, -2.0 if is_on_floor() else velocity.y - 30.0 * dt, cur.y)
		move_and_slide()
		hull.rotation.y = body_yaw
		if is_on_floor():
			var n := get_floor_normal()
			var f := U.fwd(body_yaw)
			hull.rotation.x = lerpf(hull.rotation.x, asin(clampf(n.dot(f), -0.5, 0.5)), 0.1)
		fx_t -= dt
		if cur.length() > 3.0 and fx_t <= 0.0:
			fx_t = 0.25
			game.fx.dust(global_position, 1, 3.0, 4.0, 2.0)
	turret.rotation.y = t_yaw - body_yaw
	gun.rotation.x = t_pitch


func take_damage(dmg: float, _imp: float, from, how: String, pos: Vector3) -> void:
	if not alive:
		return
	dmg *= vuln()
	ap -= dmg
	last_hit_by = from
	alert_t = 15.0
	game.on_damage(self, dmg, from, how, pos)
	if ap <= 0.0:
		ap = 0.0
		alive = false
		state = "dead"
		collision_layer = 0
		for mi in meshes:
			mi.set_instance_shader_parameter("wreck", 1.0)
		gun.rotation.x = -0.25
		game.on_unit_killed(self, from)
