extends Node3D
# Bullets / shells / rockets / missiles: physics raycast per step, MultiMesh tracers.

const CAP := 720

class P:
	var pos: Vector3
	var vel: Vector3
	var d: Dictionary
	var kind: String
	var team: int
	var shooter
	var target
	var travelled := 0.0
	var life := 0.0
	var trail_t := 0.0
	var col: Color
	var w := 0.25
	var l := 8.0
	var dmg := 0.0
	var imp := 0.0
	var splash := 0.0
	var power := 0.0

var game
var list: Array = []
var mm: MultiMesh
var _q := PhysicsRayQueryParameters3D.new()


func setup(g) -> void:
	game = g
	mm = MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	var bm := BoxMesh.new()
	bm.size = Vector3(1, 1, 1)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.vertex_color_use_as_albedo = true
	bm.material = m
	mm.mesh = bm
	mm.instance_count = CAP
	mm.visible_instance_count = 0
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.extra_cull_margin = 16000.0
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mmi)
	_q.collision_mask = 3


func clear() -> void:
	list.clear()
	mm.visible_instance_count = 0


func spawn(d: Dictionary, pos: Vector3, dir: Vector3, shooter, target, mods: Dictionary = {}) -> void:
	if list.size() >= CAP:
		return
	var p := P.new()
	p.pos = pos
	p.d = d
	p.kind = d["kind"]
	p.team = shooter.team
	p.shooter = shooter
	p.target = target
	p.dmg = mods.get("dmg", d["dmg"])
	p.imp = mods.get("impact", d["impact"])
	p.splash = mods.get("splash", d.get("splash", 0.0))
	p.power = mods.get("power", 0.0)
	var sp: float = d["speed"]
	var friendly: bool = shooter.team == 0
	if p.kind == "bullet":
		p.col = Color(3.2, 1.9, 0.6) if friendly else Color(3.0, 0.7, 0.35)
		p.w = 0.24
		p.l = 9.0
	elif p.kind == "pellet":
		p.col = Color(3.0, 2.0, 0.9) if friendly else Color(3.0, 0.8, 0.4)
		p.w = 0.16
		p.l = 5.0
	elif p.kind == "shell":
		p.col = Color(4.0, 2.4, 0.9) if friendly else Color(4.0, 1.2, 0.5)
		p.w = 0.6
		p.l = 5.0
	else:
		p.col = Color(3.5, 1.6, 0.5)
		p.w = 0.45
		p.l = 3.2
		if p.kind == "missile":
			sp *= 0.45
	if d.has("tracer"):
		p.col = d["tracer"]
	if d.has("bolt"):
		# a beam bolt: thicker and much longer than a tracer round
		p.w = float(d["bolt"][0])
		p.l = float(d["bolt"][1])
	if p.power > 0.0 or d.has("charge"):
		p.col = Color(1.6, 3.0, 4.2) if friendly else Color(4.0, 1.0, 1.6)
		p.w *= 1.0 + p.power * 2.2
		p.l = 14.0 + p.power * 26.0
	p.vel = dir * sp
	list.append(p)


# break the guidance of every missile homing on u
func jam(u) -> int:
	var n := 0
	for p in list:
		if p.target == u:
			p.target = null
			n += 1
	return n


func incoming(u) -> int:
	var n := 0
	for p in list:
		if p.target == u and p.kind == "missile":
			n += 1
	return n


func tick(dt: float) -> void:
	var space := get_world_3d().direct_space_state
	var i := 0
	var n := 0
	while i < list.size():
		var p: P = list[i]
		var dead := false
		p.life += dt
		var sp: float = p.d["speed"]
		if p.kind == "missile":
			var cur := p.vel.length()
			cur = minf(sp, cur + sp * 1.6 * dt)
			var dir := p.vel.normalized()
			if p.target != null and p.target.alive and not p.target.hidden and p.life > 0.28:
				var want: Vector3 = (p.target.center() - p.pos).normalized()
				var ang := dir.angle_to(want)
				if ang > 1.5 and p.life > 1.2:
					p.target = null
				elif ang > 0.001:
					dir = dir.slerp(want, minf(1.0, float(p.d["turn"]) * dt / ang)).normalized()
			p.vel = dir * cur
		elif p.d.has("grav") and not game.world.space:
			p.vel.y -= float(p.d["grav"]) * dt
		if p.kind == "missile" or p.kind == "rocket" or p.kind == "shell":
			p.trail_t -= dt
			if p.trail_t <= 0.0:
				p.trail_t = 0.03 if p.kind != "shell" else 0.05
				game.fx.emit("trail", p.pos, Vector3(randf_range(-1, 1), randf_range(0, 1.5), randf_range(-1, 1)))
		var prev := p.pos
		var nxt := prev + p.vel * dt
		_q.from = prev
		_q.to = nxt
		_q.exclude = game.team_rids[p.team]
		var res := space.intersect_ray(_q)
		if not res.is_empty():
			var hp: Vector3 = res["position"]
			var col = res["collider"]
			var unit = col if (col != null and col.has_method("take_damage")) else null
			_impact(p, hp, unit, res["normal"])
			dead = true
		else:
			p.pos = nxt
			p.travelled += (nxt - prev).length()
			if p.travelled > float(p.d["range"]):
				dead = true
				# anti-air shells that miss burst at the end of their run
				if p.d.has("flak") and randf() < float(p.d["flak"]):
					game.fx.moon(p.pos, randf_range(7.0, 11.0), randf_range(1.4, 2.4), Color(1.0, 0.3, 0.6), Vector3(0, -2.0, 0))
					game.fx.emit("smoke", p.pos, Vector3(randf_range(-3, 3), randf_range(-1, 3), randf_range(-3, 3)))
					if randf() < 0.35:
						game.sfx.play("flak", p.pos, 1.3, randf_range(0.85, 1.2))
				if p.d.has("splash"):
					_impact(p, p.pos, null, Vector3.UP)
			elif p.kind == "missile" and p.target != null and p.target.alive and p.pos.distance_to(p.target.center()) < 6.0:
				_impact(p, p.pos, p.target, Vector3.UP)
				dead = true
		if dead:
			list[i] = list[list.size() - 1]
			list.pop_back()
			continue
		if n < CAP:
			var dirn := p.vel.normalized()
			var up := Vector3.UP if absf(dirn.y) < 0.99 else Vector3.RIGHT
			var b := Basis.looking_at(dirn, up)
			b.x *= p.w
			b.y *= p.w
			b.z *= p.l
			mm.set_instance_transform(n, Transform3D(b, p.pos - dirn * p.l * 0.5))
			mm.set_instance_color(n, p.col)
			n += 1
		i += 1
	mm.visible_instance_count = n


func _impact(p: P, pos: Vector3, unit, normal: Vector3) -> void:
	var dmg: float = p.dmg * p.shooter.dmg_mul * p.shooter.od_dmg
	var imp: float = p.imp
	var splash: float = p.splash
	if unit != null and unit.alive:
		unit.take_damage(dmg, imp, p.shooter, p.kind, pos)
	if splash > 0.0:
		game.explode(pos, clampf(splash / 9.0, 0.6, 2.0))
		for u in game.units:
			if not u.alive or u.team == p.team or u == unit:
				continue
			var dd: float = u.center().distance_to(pos) - 3.5
			if dd < splash:
				var k := clampf(1.0 - dd / splash, 0.25, 1.0)
				u.take_damage(dmg * 0.6 * k, imp * 0.6 * k, p.shooter, "splash", pos)
	else:
		game.fx.sparks(pos, 5 if unit != null else 3, 26.0, normal)
		if unit != null:
			game.sfx.play("hit", pos, 0.7, randf_range(0.85, 1.2))
		else:
			game.fx.emit("dust", pos, normal * 5.0 + Vector3(0, 2, 0))
			if game.world.space:
				# rock chips knocked off an asteroid drift away
				for q in 3:
					game.fx.emit("spark", pos, (normal + Vector3(randf_range(-0.6, 0.6), randf_range(-0.6, 0.6), randf_range(-0.6, 0.6))) * randf_range(8, 22))
				if dmg > 250.0:
					game.fx.chunks(pos + normal * 2.0, 1, 0.5)
			if randf() < 0.3:
				game.sfx.play("ric", pos, 0.4, randf_range(0.8, 1.3))
