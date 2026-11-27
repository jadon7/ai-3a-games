extends "res://scripts/unit.gd"
# A destroyable descent engine of the landing ship. Follows an anchor node on the hull
# and carries a point-defence gun.

const FX = preload("res://scripts/fx.gd")
const Weapon = preload("res://scripts/weapon.gd")
const Defs = preload("res://scripts/defs.gd")

var anchor: Node3D
var noz: Node3D
var pm: MeshInstance3D
var weapon
var target = null
var think_t := 0.0
var burst_t := 0.0
var fx_t := 0.0
var dead_t := 0.0
var power := 1.0
var meshes: Array = []
var armed := false
var lamp: OmniLight3D


func setup(g, a: Node3D, nozzle: Node3D, idx: int) -> void:
	game = g
	team = 1
	kind = "engine"
	unit_name = "下降引擎 %d" % idx
	anchor = a
	noz = nozzle
	airborne = true
	objective = true
	ap_max = 13000.0
	ap = ap_max
	radius = 24.0
	hit_h = 30.0
	collision_layer = 2
	collision_mask = 0
	var cs := CollisionShape3D.new()
	var sh := SphereShape3D.new()
	sh.radius = 22.0
	cs.shape = sh
	add_child(cs)
	weapon = Weapon.new(Defs.WEAPONS["pd_gun"], "M")
	spread_mul = 1.4
	lead_k = 0.8
	if noz != null:
		pm = FX.plume(noz, 20.0, 100.0, 2)
		var lt := OmniLight3D.new()
		lt.light_color = Color(0.6, 0.75, 1.0)
		lt.light_energy = 24.0
		lt.omni_range = 190.0
		lt.omni_attenuation = 0.8
		lt.shadow_enabled = false
		lt.position = Vector3(0, -20.0, 0)
		noz.add_child(lt)
		lamp = lt
	think_t = randf()
	_follow()


func _follow() -> void:
	if anchor != null and is_instance_valid(anchor):
		global_position = anchor.global_position


func center() -> Vector3:
	return global_position


func muzzle(_mount: String) -> Vector3:
	return global_position + Vector3(0, -16.0, 0)


func aim_dir() -> Vector3:
	if target != null:
		return (target.center() - muzzle("M")).normalized()
	return Vector3.DOWN


func tick(dt: float) -> void:
	var prev := global_position
	_follow()
	velocity = (global_position - prev) / maxf(dt, 0.001)
	if not alive:
		dead_t += dt
		fx_t -= dt
		if fx_t <= 0.0:
			fx_t = 0.05
			var p := global_position + Vector3(randf_range(-12, 12), randf_range(-14, 0), randf_range(-12, 12))
			game.fx.emit("smoke", p, Vector3(randf_range(-3, 3), randf_range(4, 12), randf_range(-3, 3)))
			if randf() < 0.6:
				game.fx.emit("fire", p, Vector3(randf_range(-4, 4), randf_range(-8, 4), randf_range(-4, 4)))
		return
	if pm != null:
		FX.set_plume(pm, 20.0 * randf_range(0.95, 1.05), (70.0 + 40.0 * power) * randf_range(0.93, 1.07), 0.22 + power * 0.2)
	if not armed:
		return
	weapon.tick(dt, self)
	think_t -= dt
	if think_t <= 0.0:
		think_t = randf_range(0.8, 1.4)
		target = null
		var best := 680.0
		for u in game.units:
			if not u.alive or u.team == team or u.hidden or u.kind == "cannon" or u.kind == "aa":
				continue
			var d: float = u.center().distance_to(global_position)
			if u.is_player:
				d *= 0.85
			if d < best:
				best = d
				target = u
		burst_t = randf_range(0.8, 1.6) if target != null else 0.0
	if target != null and target.alive and burst_t > 0.0:
		burst_t -= dt
		c_lock = target
		weapon.trigger(self)


func take_damage(dmg: float, _imp: float, from, how: String, pos: Vector3) -> void:
	if not alive:
		return
	dmg *= vuln()
	ap -= dmg
	last_hit_by = from
	game.on_damage(self, dmg, from, how, pos)
	if ap <= 0.0:
		ap = 0.0
		alive = false
		state = "dead"
		collision_layer = 0
		if pm != null:
			pm.visible = false
		if lamp != null:
			lamp.light_color = Color(1.0, 0.5, 0.2)
			lamp.light_energy = 12.0
		for m in meshes:
			if is_instance_valid(m):
				m.set_instance_shader_parameter("wreck", 1.0)
		game.on_unit_killed(self, from)
