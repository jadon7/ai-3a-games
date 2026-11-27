extends RefCounted
# One weapon instance. Normal weapons fire while held; "charge" weapons build up while
# held and fire on release; kind "beam" is a sustained ray with a heat gauge.

var d: Dictionary
var mount := "M"
var ammo := 0
var cd := 0.0
var reload_t := 0.0
var salvo_left := 0
var salvo_t := 0.0
var salvo_target = null
var no_lock_hint := 0.0
var is_charge := false
var is_beam := false
var charge := 0.0
var charging := false
var heat := 0.0
var overheated := false
var beam_on := false
var _acc := 0.0
var _fx_t := 0.0
var _snd_t := 0.0


func _init(def: Dictionary, m: String = "") -> void:
	d = def
	mount = m if m != "" else str(d.get("mount", "M"))
	ammo = d["mag"]
	is_charge = d.has("charge")
	is_beam = d["kind"] == "beam"


func cancel() -> void:
	charge = 0.0
	charging = false
	beam_on = false


func tick(dt: float, u, held: bool = false) -> void:
	cd -= dt
	no_lock_hint = maxf(0.0, no_lock_hint - dt)
	if is_beam:
		_tick_beam(dt, u, held)
		return
	if reload_t > 0.0:
		reload_t -= dt
		if reload_t <= 0.0:
			ammo = d["mag"]
			if u.is_player:
				u.game.sfx.play2d("reload", 0.5)
	if salvo_left > 0:
		salvo_t -= dt
		if salvo_t <= 0.0:
			_launch(u, salvo_target, 0.0)
			salvo_left -= 1
			salvo_t = d["gap"]
	if is_charge:
		if held and cd <= 0.0 and reload_t <= 0.0 and ammo > 0:
			if not charging:
				charging = true
				charge = 0.0
				u.game.sfx.play("charge", u.muzzle(mount), 0.8, 1.5 / float(d["charge"]["t"]))
			charge = minf(1.0, charge + dt / float(d["charge"]["t"]))
			_fx_t -= dt
			if _fx_t <= 0.0:
				_fx_t = 0.05
				var o: Vector3 = u.muzzle(mount)
				var off := Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)).normalized() * (1.5 + charge * 2.0)
				u.game.fx.emit("spark", o + off, -off * 9.0 + u.velocity)
				u.game.fx.flash(o, 2.0 + charge * 9.0, 0.09, Color(0.55, 0.8, 1.0))
		elif charging:
			charging = false
			var c := charge if charge > 0.18 else 0.0
			charge = 0.0
			cd = 1.0 / float(d["rof"])
			_launch(u, u.c_lock if (u.c_lock != null and u.c_lock.alive) else null, c)
		elif held and ammo <= 0 and reload_t <= 0.0:
			reload_t = d["reload"]
		return
	if held:
		trigger(u)


func ready() -> bool:
	if is_beam:
		return not overheated
	return cd <= 0.0 and reload_t <= 0.0 and salvo_left <= 0 and ammo > 0


func trigger(u) -> bool:
	if cd > 0.0 or reload_t > 0.0 or salvo_left > 0:
		return false
	if ammo <= 0:
		reload_t = d["reload"]
		return false
	var need: float = d.get("lock", 0.0)
	var tgt = u.c_lock
	if tgt != null and not tgt.alive:
		tgt = null
	if need > 0.0 and (tgt == null or u.c_lock_t < need):
		no_lock_hint = 0.6
		return false
	cd = 1.0 / float(d["rof"])
	if d.has("salvo"):
		salvo_left = mini(int(d["salvo"]), ammo)
		salvo_t = 0.0
		salvo_target = tgt
	else:
		_launch(u, tgt, 0.0)
	return true


func _aim_dir(u, o: Vector3, tgt, speed: float, grav: float, lead: bool) -> Vector3:
	var aim: Vector3
	if tgt != null and tgt.alive:
		aim = tgt.center()
		if lead:
			var t := o.distance_to(aim) / speed
			aim += tgt.velocity * t * u.lead_k
			t = o.distance_to(aim) / speed
			aim.y += 0.5 * grav * t * t
	else:
		aim = u.c_aim_point
		var t := o.distance_to(aim) / speed
		aim.y += 0.5 * grav * t * t
	var dir := (aim - o).normalized()
	var f: Vector3 = u.aim_dir()
	if dir.dot(f) < 0.25:
		dir = f
	return dir


func _launch(u, tgt, power: float) -> void:
	ammo -= 1
	var game = u.game
	var o: Vector3 = u.muzzle(mount)
	var speed: float = d["speed"]
	var grav: float = 0.0 if game.world.space else float(d.get("grav", 0.0))
	var k: String = d["kind"]
	var dir := _aim_dir(u, o, tgt, speed, grav, k != "missile")
	if k == "missile":
		dir = (dir + Vector3.UP * 0.55 + Vector3(randf_range(-0.3, 0.3), 0, randf_range(-0.3, 0.3))).normalized()
	if k == "hook":
		u.fire_hook(d, o, dir)
		game.sfx.play(d["sfx"], o, 1.0, 1.5)
		u.on_fired(d, mount, 1.0)
		if ammo <= 0:
			reload_t = d["reload"]
		return
	var n: int = d.get("pellets", 1)
	var sp: float = float(d.get("spread", 0.0)) * u.spread_mul
	var mods := {}
	if power > 0.0:
		var ch: Dictionary = d["charge"]
		mods = {
			"dmg": float(d["dmg"]) * lerpf(1.0, float(ch["mul"]), power),
			"impact": float(d["impact"]) * lerpf(1.0, float(ch["imp"]), power),
			"splash": lerpf(float(d.get("splash", 0.0)), float(ch.get("splash", 0.0)), power),
			"power": power,
		}
	for i in n:
		var dd := (dir + Vector3(randfn(0.0, sp), randfn(0.0, sp), randfn(0.0, sp))).normalized()
		game.proj.spawn(d, o, dd, u, tgt if k == "missile" else null, mods)
	var ms := 1.0
	if k == "shell":
		ms = 2.4
	elif k == "pellet":
		ms = 1.8
	elif k == "missile" or k == "rocket":
		ms = 1.3
	ms *= 1.0 + power * 1.2
	game.fx.muzzle(o, dir, ms)
	if power > 0.5:
		game.fx.flash(o, 30.0 * power, 0.2, Color(0.6, 0.85, 1.0))
		for i in 8:
			game.fx.emit("spark", o, (dir * randf_range(20, 70) + Vector3(randf_range(-9, 9), randf_range(-9, 9), randf_range(-9, 9))))
	game.sfx.play(d["sfx"], o, (1.0 + power * 0.4) * float(d.get("vol", 1.0)), randf_range(0.94, 1.06) * (1.0 - power * 0.25) * float(d.get("pitch", 1.0)))
	u.on_fired(d, mount, 1.0 + power * 1.6)
	if ammo <= 0:
		reload_t = d["reload"]
		if d.has("cool"):
			# the burst is out: the gun vents its heat
			for i in 3:
				game.fx.emit("smoke", o - dir * (1.5 + float(i) * 1.2), Vector3(randf_range(-2.0, 2.0), 5.0, randf_range(-2.0, 2.0)) + u.velocity * 0.5)


func _tick_beam(dt: float, u, held: bool) -> void:
	var game = u.game
	if overheated:
		beam_on = false
		heat -= dt / float(d["reload"])
		reload_t = maxf(heat, 0.0) * float(d["reload"])
		if heat <= 0.0:
			heat = 0.0
			reload_t = 0.0
			overheated = false
			if u.is_player:
				game.sfx.play2d("reload", 0.5)
		return
	if not held:
		beam_on = false
		heat = maxf(0.0, heat - dt / (float(d["reload"]) * 0.7))
		return
	beam_on = true
	heat += dt / float(d["heat"])
	var o: Vector3 = u.muzzle(mount)
	var tgt = u.c_lock if (u.c_lock != null and u.c_lock.alive) else null
	var dir := _aim_dir(u, o, tgt, 99999.0, 0.0, false)
	var rng: float = d["range"]
	var end := o + dir * rng
	var res: Dictionary = game.ray(o, end, 3, game.team_rids[u.team])
	var hit_unit = null
	var nrm := -dir
	if not res.is_empty():
		end = res["position"]
		nrm = res["normal"]
		var col = res["collider"]
		if col != null and col.has_method("take_damage"):
			hit_unit = col
	var enemy_col: bool = u.team != 0
	game.fx.beam(o, end, 0.38, Color(1.0, 0.3, 0.16) if enemy_col else Color(1.0, 0.5, 0.16), 0.0, 0.6)
	_acc += dt
	if _acc >= 0.1:
		var step := _acc
		_acc = 0.0
		if hit_unit != null and hit_unit.alive:
			hit_unit.take_damage(float(d["dmg"]) * step * u.dmg_mul * u.od_dmg, float(d["impact"]) * step, u, "beam", end)
		if not res.is_empty():
			game.fx.sparks(end, 4, 34.0, nrm)
			game.fx.flash(end, 5.0, 0.12)
			if hit_unit == null:
				game.fx.emit("smoke", end, nrm * 4.0 + Vector3(0, 3, 0))
		u.on_fired(d, mount, 1.0)
	_snd_t -= dt
	if _snd_t <= 0.0:
		_snd_t = 0.22
		game.sfx.play("beam", o, 0.8, randf_range(0.96, 1.04))
	if heat >= 1.0:
		heat = 1.0
		overheated = true
		beam_on = false
		reload_t = d["reload"]
		game.fx.emit("smoke", o, Vector3(0, 5, 0))
		if u.is_player:
			game.hud.note("照射器过热  BEAM OVERHEAT", game.hud.C_ALERT, 1.8)
			game.sfx.play2d("alarm", 0.4, 1.3)
