extends "res://scripts/unit.gd"
# Enemy air units: strike fighters (strafing runs), VTOL transports (deliver frames to
# a landing zone) and orbital drop pods (fall from the sky, brake, open, release a frame).

const Glb = preload("res://scripts/glb_kit.gd")
const MeshKit = preload("res://scripts/mesh_kit.gd")
const Tex = preload("res://scripts/tex.gd")
const FX = preload("res://scripts/fx.gd")
const Weapon = preload("res://scripts/weapon.gd")
const Defs = preload("res://scripts/defs.gd")
const U = preload("res://scripts/u.gd")

var root: Node3D
var meshes: Array = []
var glow: StandardMaterial3D
var nozzles: Array = []      # [{n, pm, r, len}]
var muz: Node3D
var weapon
var weapon2
var target = null
var mode := "ingress"
var t := 0.0
var dir := Vector3.FORWARD
var speed := 90.0
var bank := 0.0
var think_t := 0.0
var fx_t := 0.0
var dead_t := 0.0
var crashing := false
var spin := 0.0
# transport / pod
var cargo: Array = []        # [[frame_id, loadout], ...]
var dest := Vector3.ZERO
var engines: Array = []
var doors: Array = []
var petals: Array = []
var bay: Node3D
var door_k := 0.0
var drop_t := 0.0
var escaped := false
var delivered := false
var on_drop: Callable
var start := Vector3.ZERO
var open_k := 0.0


func setup(g, kind_id: String, tm: int, pos: Vector3, to: Vector3, load: Array = []) -> void:
	game = g
	team = tm
	kind = kind_id
	airborne = true
	cargo = load
	dest = to
	start = pos
	collision_layer = 2
	collision_mask = 0
	glow = StandardMaterial3D.new()
	glow.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	glow.albedo_color = Color(1.0, 0.25, 0.1) * 2.5
	var am := Tex.armor
	var mats := {
		"A": {"mat": am, "params": {"tint": Color(0.23, 0.13, 0.1), "metal": 0.45}},
		"B": {"mat": am, "params": {"tint": Color(0.11, 0.11, 0.115), "metal": 0.5}},
		"C": {"mat": am, "params": {"tint": Color(0.5, 0.45, 0.38), "metal": 0.3}},
		"F": {"mat": am, "params": {"tint": Color(0.08, 0.085, 0.09), "metal": 0.75}},
		"W": {"mat": am, "params": {"tint": Color(0.07, 0.075, 0.08), "metal": 0.75}},
		"T": {"mat": am, "params": {"tint": Color(0.015, 0.015, 0.017), "metal": 0.5}},
		"H": {"mat": am, "params": {"tint": Color(0.7, 0.5, 0.06), "metal": 0.2, "stripes": 1.0}},
		"G": {"mat": glow},
	}
	root = Glb.instance(kind_id)
	if root != null:
		add_child(root)
		Glb.skin(root, mats, 2, meshes)
	else:
		root = Node3D.new()
		add_child(root)
		_build_proc(mats)
	var cs := CollisionShape3D.new()
	if kind == "fighter":
		unit_name = "F-9 攻击机"
		ap_max = 850.0
		radius = 8.0
		hit_h = 5.0
		var sh := SphereShape3D.new()
		sh.radius = 8.0
		cs.shape = sh
		weapon = Weapon.new(Defs.WEAPONS["f_gun"], "M")
		weapon2 = Weapon.new(Defs.WEAPONS["f_rkt"], "M")
		spread_mul = 1.3
		lead_k = 0.9
		speed = randf_range(92.0, 106.0)
		muz = Glb.find(root, "muzzle")
		_find_nozzles(["noz_1", "noz_2"], 1.6, 9.0)
	elif kind == "transport":
		unit_name = "运输机「驮兽」"
		ap_max = 5200.0
		radius = 22.0
		hit_h = 12.0
		var bs := BoxShape3D.new()
		bs.size = Vector3(24, 13, 58)
		cs.shape = bs
		speed = 64.0
		for nm in ["engine_FL", "engine_FR", "engine_BL", "engine_BR"]:
			var e := Glb.find(root, nm)
			if e != null:
				engines.append({"n": e, "rest": e.basis})
		for nm in ["door_L", "door_R"]:
			var dn := Glb.find(root, nm)
			if dn != null:
				doors.append({"n": dn, "rest": dn.basis})
		bay = Glb.find(root, "bay")
		_find_nozzles(["noz_FL", "noz_FR", "noz_BL", "noz_BR"], 4.0, 16.0)
	else:
		unit_name = "空降舱"
		ap_max = 2400.0
		radius = 9.0
		hit_h = 22.0
		var cyl := CylinderShape3D.new()
		cyl.radius = 6.5
		cyl.height = 22.0
		cs.shape = cyl
		cs.position = Vector3(0, 11, 0)
		for i in range(1, 5):
			var pn := Glb.find(root, "petal_%d" % i)
			if pn != null:
				petals.append({"n": pn, "rest": pn.basis})
		_find_nozzles(["noz_1", "noz_2", "noz_3", "noz_4"], 3.0, 18.0)
		speed = 105.0
	add_child(cs)
	ap = ap_max
	global_position = pos
	var d := to - pos
	if kind != "pod":
		d.y = 0.0
	if d.length() > 1.0:
		dir = d.normalized()
	_orient(0.0)


func _find_nozzles(names: Array, r: float, ln: float) -> void:
	for nm in names:
		var nn := Glb.find(root, nm)
		if nn != null:
			var pm := FX.plume(nn, r, ln, 2)
			pm.visible = false
			nozzles.append({"n": nn, "pm": pm, "r": r, "len": ln})


func _marker(parent: Node3D, pos: Vector3, nm: String, rot: Vector3 = Vector3.ZERO) -> Node3D:
	var m := Node3D.new()
	m.name = nm
	m.position = pos
	m.rotation = rot
	parent.add_child(m)
	return m


# crude stand-ins used only when the .glb models are missing
func _build_proc(mats: Dictionary) -> void:
	var k := MeshKit.new(11)
	k.dust = 0.15
	var hz := PI * 0.5
	var b := k.bone(root)
	if kind == "fighter":
		k.box(b, "A", Vector3(2.6, 2.2, 16), Vector3(0, 0, 0), Vector3.ZERO, {"tx": 0.6, "bz": 0.9})
		k.box(b, "B", Vector3(14, 0.4, 5.5), Vector3(0, 0, 2.0), Vector3.ZERO, {"tz": 0.5})
		for s in [-1.0, 1.0]:
			k.box(b, "A", Vector3(0.3, 3.4, 3.4), Vector3(s * 1.6, 1.8, 6.2), Vector3(0, 0, -s * 0.4), {"tz": 0.5})
			k.cyl(b, "W", 0.5, 0.5, 3.0, Vector3(s * 4.4, -0.6, 1.0), Vector3(hz, 0, 0), 8)
			_marker(root, Vector3(s * 0.9, 0, 8.2), "noz_%d" % (1 if s < 0.0 else 2), Vector3(-hz, 0, 0))
		k.box(b, "G", Vector3(1.4, 0.8, 2.6), Vector3(0, 1.0, -3.6))
		k.cyl(b, "W", 0.2, 0.2, 3.0, Vector3(0, -1.2, -7.2), Vector3(hz, 0, 0), 6)
		_marker(root, Vector3(0, -1.2, -8.8), "muzzle")
	elif kind == "transport":
		k.box(b, "A", Vector3(18, 11, 56), Vector3(0, 0, 0), Vector3.ZERO, {"tx": 0.7, "tz": 0.85, "bx": 0.85})
		k.box(b, "B", Vector3(40, 1.6, 12), Vector3(0, 4, -8))
		k.box(b, "B", Vector3(34, 1.4, 9), Vector3(0, 4, 20))
		k.box(b, "G", Vector3(8, 2, 3), Vector3(0, 3.4, -27.2))
		k.box(b, "A", Vector3(1.2, 9, 10), Vector3(0, 9, 23), Vector3.ZERO, {"tz": 0.5})
		for e in [["FL", -20.0, -8.0], ["FR", 20.0, -8.0], ["BL", -17.0, 20.0], ["BR", 17.0, 20.0]]:
			var en := k.bone(root, Vector3(e[1], 3.4, e[2]))
			en.name = "engine_" + str(e[0])
			k.cyl(en, "F", 3.4, 3.0, 7.0, Vector3(0, 0, 0), Vector3.ZERO, 12)
			k.cyl(en, "T", 2.6, 3.2, 1.6, Vector3(0, -4.2, 0), Vector3.ZERO, 12)
			_marker(en, Vector3(0, -5.0, 0), "noz_" + str(e[0]))
		_marker(root, Vector3(0, -6.5, 0), "bay")
	else:
		k.cyl(b, "T", 6.5, 5.0, 3.0, Vector3(0, 1.5, 0), Vector3.ZERO, 14)
		k.cyl(b, "A", 4.2, 6.5, 16.0, Vector3(0, 11, 0), Vector3.ZERO, 14)
		k.cyl(b, "B", 1.2, 4.2, 4.0, Vector3(0, 21, 0), Vector3.ZERO, 14)
		for i in 4:
			var a := TAU * i / 4.0 + PI / 4.0
			_marker(root, Vector3(cos(a) * 5.4, 1.0, sin(a) * 5.4), "noz_%d" % (i + 1))
	for m in k.bake(mats):
		m.layers = 2
		meshes.append(m)


func center() -> Vector3:
	if kind == "pod":
		return global_position + Vector3(0, 11, 0)
	return global_position


func muzzle(_mount: String) -> Vector3:
	return muz.global_position if muz != null else global_position + dir * 9.0


func aim_dir() -> Vector3:
	return dir


func _orient(roll: float) -> void:
	if kind == "pod":
		return
	var up := Vector3.UP if absf(dir.y) < 0.98 else Vector3.RIGHT
	root.basis = Basis.looking_at(dir, up) * Basis(Vector3(0, 0, 1), roll)


func _plumes(power: float) -> void:
	for z in nozzles:
		FX.set_plume(z["pm"], float(z["r"]), float(z["len"]) * power * randf_range(0.9, 1.1), 0.4 + power)


func _steer(want: Vector3, rate: float, dt: float) -> void:
	want = want.normalized()
	var ang := dir.angle_to(want)
	var before := dir
	if ang > 0.001:
		dir = dir.slerp(want, minf(1.0, rate * dt / ang)).normalized()
	var turn := before.cross(dir).y / maxf(dt, 0.001)
	bank = U.damp(bank, clampf(-turn * 1.1, -1.1, 1.1), 3.0, dt)


func tick(dt: float) -> void:
	if not alive:
		_tick_dead(dt)
		return
	t += dt
	alert_t -= dt
	if kind == "fighter":
		_tick_fighter(dt)
	elif kind == "transport":
		_tick_transport(dt)
	else:
		_tick_pod(dt)


# ------------------------------------------------------------------ fighter
func _pick_target() -> void:
	var best := 1e9
	target = null
	for u in game.units:
		if not u.alive or u.team == team or u.airborne or u.hidden:
			continue
		var d: float = u.global_position.distance_to(global_position) * randf_range(0.6, 1.4)
		if u.kind == "aa":
			d *= 0.6
		elif u.kind == "cannon":
			d *= 0.8
		elif u.is_player:
			d *= 0.7
		if d < best:
			best = d
			target = u


func _tick_fighter(dt: float) -> void:
	weapon.tick(dt, self)
	weapon2.tick(dt, self)
	think_t -= dt
	if target == null or not target.alive or think_t <= 0.0 and mode != "attack":
		think_t = 4.0
		_pick_target()
	var pos := global_position
	var gy: float = game.world.height(pos.x, pos.z)
	var want := dir
	var rate := 0.9
	if target == null:
		want = Vector3(dir.x, 0.05, dir.z) + Vector3(dir.z, 0, -dir.x) * 0.4
	elif mode == "ingress":
		var tp: Vector3 = target.center() + Vector3(0, 150.0, 0)
		want = tp - pos
		if Vector2(tp.x - pos.x, tp.z - pos.z).length() < 640.0:
			mode = "attack"
	elif mode == "attack":
		var tc: Vector3 = target.center()
		var tt := pos.distance_to(tc) / float(weapon.d["speed"])
		var aim: Vector3 = tc + target.velocity * tt
		want = aim - pos
		rate = 1.3
		var dist := pos.distance_to(tc)
		c_lock = target
		c_aim_point = aim
		var on := dir.angle_to(want.normalized()) < 0.1
		if on and dist < 560.0:
			weapon.trigger(self)
			if dist < 440.0:
				weapon2.trigger(self)
		if dist < 170.0 or pos.y - gy < 46.0:
			mode = "egress"
			t = 0.0
			think_t = randf_range(5.0, 8.0)
			spin = 1.0 if randf() < 0.5 else -1.0
	else:
		want = Vector3(dir.x, 0.0, dir.z).normalized() + Vector3(0, 0.45, 0) + Vector3(dir.z, 0, -dir.x) * 0.35 * spin
		if pos.y - gy > 190.0:
			want.y = 0.0
		if t > think_t:
			mode = "ingress"
			_pick_target()
	if pos.y - gy < 40.0:
		want = want.normalized() + Vector3(0, 1.2, 0)
		rate = 2.2
	var bound: float = game.world.bound + 500.0
	if absf(pos.x) > bound or absf(pos.z) > bound:
		want = Vector3(-pos.x, 0, -pos.z)
	_steer(want, rate, dt)
	velocity = dir * speed
	global_position = pos + velocity * dt
	_orient(bank)
	_plumes(1.0)


# ------------------------------------------------------------------ transport
func _tick_transport(dt: float) -> void:
	var pos := global_position
	var gy: float = game.world.height(dest.x, dest.z)
	var hover_y := gy + 64.0
	var flat := Vector2(dest.x - pos.x, dest.z - pos.z)
	var dist := flat.length()
	var hov := 0.0
	if mode == "ingress":
		var sp := clampf(dist * 0.35, 6.0, speed)
		var want := Vector3(flat.x, 0, flat.y).normalized() if dist > 1.0 else dir
		_steer(want, 0.5, dt)
		var vy := clampf((lerpf(hover_y, start.y, clampf(dist / 500.0, 0.0, 1.0)) - pos.y) * 0.6, -14.0, 14.0)
		velocity = dir * sp + Vector3(0, vy, 0)
		hov = clampf(1.0 - sp / speed, 0.0, 1.0)
		if dist < 14.0:
			mode = "drop"
			t = 0.0
			drop_t = 1.4
	elif mode == "drop":
		velocity = velocity.lerp(Vector3.ZERO, 1.0 - exp(-3.0 * dt))
		hov = 1.0
		door_k = minf(1.0, door_k + dt * 1.2)
		drop_t -= dt
		if drop_t <= 0.0:
			if cargo.is_empty():
				mode = "egress"
				t = 0.0
				delivered = true
			else:
				drop_t = 1.5
				var c: Array = cargo.pop_front()
				var bp: Vector3 = bay.global_position if bay != null else pos + Vector3(0, -8, 0)
				var yw := atan2(-dir.x, -dir.z)
				var u = game.spawn_mech(c[0], team, bp + Vector3(randf_range(-3, 3), -12.0, randf_range(-3, 3)), yw + PI, true, c[1] if c.size() > 1 else {})
				u.velocity = Vector3(0, -10.0, 0)
				u.grounded = false
				u.alert_t = 9999.0
				u.ai.sense = 2500.0
				if on_drop.is_valid():
					on_drop.call(u)
				game.sfx.play("land", bp, 0.8, 1.4)
	else:
		door_k = maxf(0.0, door_k - dt * 0.8)
		hov = clampf(1.0 - t / 4.0, 0.0, 1.0)
		var out := Vector3(signf(pos.x + 0.01) * 0.35, 0, -1.0).normalized()
		_steer(out, 0.4, dt)
		velocity = velocity.lerp(dir * speed * 1.15 + Vector3(0, 9.0, 0), 1.0 - exp(-0.7 * dt))
		if pos.z < -game.world.bound - 420.0 or pos.y > 700.0:
			escaped = true
			alive = false
			hidden = true
			visible = false
			_free_model()
			collision_layer = 0
			game._rebuild_rids()
			return
	global_position = pos + velocity * dt
	_orient(bank * 0.35)
	root.rotate_object_local(Vector3.RIGHT, -0.1 * (1.0 - hov))
	for e in engines:
		(e["n"] as Node3D).basis = (e["rest"] as Basis) * Basis(Vector3.RIGHT, -1.15 * (1.0 - hov))
	for i in doors.size():
		var s := -1.0 if i == 0 else 1.0
		(doors[i]["n"] as Node3D).basis = (doors[i]["rest"] as Basis) * Basis(Vector3(0, 0, 1), s * 1.4 * door_k)
	_plumes(0.75 + hov * 0.4)
	fx_t -= dt
	if fx_t <= 0.0 and hov > 0.6 and pos.y - gy < 90.0:
		fx_t = 0.07
		game.fx.dust(Vector3(pos.x, gy, pos.z), 2, 16.0, 26.0, 5.0)


# ------------------------------------------------------------------ drop pod
func _tick_pod(dt: float) -> void:
	var pos := global_position
	var gy: float = game.world.height(dest.x, dest.z)
	var alt := pos.y - gy
	if mode == "ingress":
		var want := (dest + Vector3(0, 210.0, 0)) - pos
		if alt < 230.0:
			mode = "brake"
		else:
			dir = want.normalized()
		velocity = dir * speed
		fx_t -= dt
		if fx_t <= 0.0:
			fx_t = 0.03
			var p := pos + Vector3(randf_range(-3, 3), 2.0, randf_range(-3, 3))
			game.fx.emit("fire", p, -velocity * 0.15)
			game.fx.emit("smoke", p + Vector3(0, 10, 0), -velocity * 0.1 + Vector3(randf_range(-3, 3), 0, randf_range(-3, 3)))
		_plumes(0.0)
	elif mode == "brake":
		var flat := Vector3(dest.x - pos.x, 0, dest.z - pos.z)
		var vdown := clampf(alt * 0.42, 9.0, speed)
		velocity = velocity.lerp(flat * 0.9 + Vector3(0, -vdown, 0), 1.0 - exp(-2.5 * dt))
		_plumes(clampf(alt / 60.0, 0.5, 1.3))
		fx_t -= dt
		if fx_t <= 0.0:
			fx_t = 0.05
			if alt < 60.0:
				game.fx.dust(Vector3(pos.x, gy, pos.z), 3, 8.0, 30.0, 6.0)
			game.fx.emit("smoke", pos + Vector3(randf_range(-4, 4), 0, randf_range(-4, 4)), Vector3(randf_range(-6, 6), randf_range(-12, -4), randf_range(-6, 6)))
		if alt <= 0.6:
			mode = "land"
			t = 0.0
			velocity = Vector3.ZERO
			airborne = false
			global_position = Vector3(pos.x, gy, pos.z)
			game.fx.dust(global_position, 18, 6.0, 34.0, 7.0)
			game.sfx.play("land", global_position, 1.5, 0.7)
			game.shake(0.5, global_position)
			_plumes(0.0)
			return
	else:
		open_k = minf(1.0, open_k + dt / 1.5)
		var e := open_k * open_k * (3.0 - 2.0 * open_k)
		for pt in petals:
			(pt["n"] as Node3D).basis = (pt["rest"] as Basis) * Basis(Vector3.RIGHT, deg_to_rad(100.0) * e)
		if open_k >= 1.0 and not delivered:
			delivered = true
			for c in cargo:
				var u = game.spawn_mech(c[0], team, global_position + Vector3(0, 1.0, 0), randf() * TAU, true, c[1] if c.size() > 1 else {})
				u.alert_t = 9999.0
				u.ai.sense = 2500.0
				if on_drop.is_valid():
					on_drop.call(u)
			cargo.clear()
			# the empty shell stays behind as cover
			alive = false
			hidden = true
			collision_layer = 1 if not petals.is_empty() else 0
			if petals.is_empty():
				visible = false
			game._rebuild_rids()
		return
	global_position = pos + velocity * dt


# ------------------------------------------------------------------ damage / death
func take_damage(dmg: float, _imp: float, from, how: String, pos: Vector3) -> void:
	if not alive:
		return
	dmg *= vuln()
	ap -= dmg
	last_hit_by = from
	alert_t = 10.0
	game.on_damage(self, dmg, from, how, pos)
	if ap <= 0.0:
		ap = 0.0
		alive = false
		state = "dead"
		crashing = true
		collision_layer = 0
		spin = randf_range(-2.5, 2.5)
		for m in meshes:
			if m.get_meta("key", "") == "G":
				m.visible = false
			else:
				m.set_instance_shader_parameter("wreck", 0.8)
		_plumes(0.0)
		if velocity.length() < 5.0:
			velocity = Vector3(randf_range(-8, 8), -4, randf_range(-8, 8))
		game.on_unit_killed(self, from)


func _free_model() -> void:
	meshes.clear()
	nozzles.clear()
	engines.clear()
	doors.clear()
	petals.clear()
	bay = null
	muz = null
	if root != null:
		root.queue_free()
		root = null


func _tick_dead(dt: float) -> void:
	if not crashing:
		return
	dead_t += dt
	velocity.y -= 26.0 * dt
	velocity *= 1.0 - 0.15 * dt
	var pos := global_position + velocity * dt
	global_position = pos
	root.rotate_object_local(Vector3(0, 0, 1), spin * dt)
	root.rotate_object_local(Vector3.RIGHT, 0.4 * dt)
	fx_t -= dt
	if fx_t <= 0.0:
		fx_t = 0.035
		game.fx.emit("smoke", pos, Vector3(randf_range(-2, 2), randf_range(1, 4), randf_range(-2, 2)))
		if randf() < 0.5:
			game.fx.emit("fire", pos, velocity * 0.2)
	var gy: float = game.world.height(pos.x, pos.z)
	if pos.y <= gy + 2.0 or dead_t > 14.0:
		crashing = false
		game.explode(Vector3(pos.x, gy + 2.0, pos.z), 1.4 + radius * 0.07)
		game.fx.chunks(pos, 5 if kind == "fighter" else 12, 1.0 if kind == "fighter" else 1.8)
		visible = false
		hidden = true
		_free_model()
