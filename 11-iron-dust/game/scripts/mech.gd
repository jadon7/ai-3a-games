extends "res://scripts/unit.gd"
# Tactical frame: heavy inertial movement, thrusters and flight, stagger / down, melee,
# destructible arm shield, weapon swap, overdrive.

const MechModel = preload("res://scripts/mech_model.gd")
const Weapon = preload("res://scripts/weapon.gd")
const Defs = preload("res://scripts/defs.gd")
const U = preload("res://scripts/u.gd")

const CEILING := 330.0

var def: Dictionary
var def_id := ""
var loadout := {}
var melee := {}
var sys := {}
var model
var anim
var weapons: Array = [null, null, null, null, null]   # fire groups: LMB hand / RMB heavy / E pod / G left arm / B under-barrel
var w_r: Array = [null, null, null]       # hand weapons, cycled with the swap key
var w_sub: Array = [null, null, null]     # their under-barrel weapons
var swap_next := 0
var melee_charge := 0.0
var melee_mul := 1.0
var melee_released := false
var hit_freeze := 0.0
var qb_dir3 := Vector3.ZERO
var _used := false
var fire_t := 0.0
var scrape_t := 0.0
var base_melee := {}
var recover_t := 0.0
var brace_t := 0.0
var bracing := false
var brace_fail := 0.0
var hook := {}
var hook_vel := Vector3.ZERO
var hook_node: Node3D
var r_idx := 0
var swap_t := 0.0
var swap_buf := 0.0
var swap_want := -1
var od_buf := 0.0
var spread_keep := 1.0
var sys_kind := ""
var ramming := false
var ram_hit := {}
var yaw := 0.0
var thrust := 1.0
var overheat_t := 0.0
var thrust_idle := 0.0
var boosting := false
var ascending := false
var descending := false
var qb_cd := 0.0
var qb_t := 0.0
var qb_dir := Vector2.ZERO
var state_t := 0.0
var guard_t := 0.0
var impact_idle := 0.0
var melee_cd := 0.0
var melee_t := 0.0
var melee_total := 0.85
var melee_combo := 0
var melee_hit := false
var melee_queued := false
var melee_target = null
var blade_t := 0.0            # the sword stays drawn this long after a bout
var grounded := true
var dead_t := 0.0
var gone := false
var repair_kits := 0
var land_t := 0.0
var crouch_t := 0.0
var fx_t := 0.0
var aim_l_t := 0.0
var hit_flash := 0.0
var walk := 22.0
var boost := 60.0
var qb_speed := 90.0
var turn_rate := 2.0
var base_poise := 100.0
var mob := 1.0
# shield
var shield_def := {}
var shield_hp := 0.0
var shield_max := 0.0
var guard_v := 0.0
# overdrive
var od := 0.0
var od_on := false
var od_t := 0.0
var od_speed := 1.0
var od_turn := 1.0
var od_taken := 1.0
var od_rof := 1.0
# control inputs
var c_move := Vector2.ZERO
var c_boost := false
var c_jump := false
var c_jump_p := false
var c_descend := false
var c_quick_p := false
var c_fire := [false, false, false, false, false]
var c_melee_p := false
var c_swap_p := false
var c_swap_to := -1
var c_swap_dir := 0
var c_melee := false
var c_vert := 0.0
var c_od_p := false
var c_aim_yaw := 0.0
var c_aim_pitch := 0.0


func setup(g, id: String, t: int, pos: Vector3, y: float, seed_v: int = 1, lo: Dictionary = {}) -> void:
	game = g
	def_id = id
	def = Defs.FRAMES[id]
	team = t
	kind = "mech"
	unit_name = def["name"]
	ap_max = def["ap"]
	ap = ap_max
	base_poise = def["poise"]
	poise = base_poise
	loadout = (def["loadout"] as Dictionary).duplicate()
	for k in lo:
		loadout[k] = lo[k]
	mob = Defs.mobility(loadout, float(def["cap"]))
	walk = float(def["walk"]) * mob
	boost = float(def["boost"]) * mob
	qb_speed = float(def["qb"]) * mob
	turn_rate = float(def["turn"]) * lerpf(1.0, mob, 0.5)
	melee = (Defs.MELEE[str(loadout["M"])] as Dictionary).duplicate()
	melee["dmg"] = float(melee["dmg"]) * float(def.get("melee_mul", 1.0))
	base_melee = melee
	sys = Defs.SYSTEMS.get(str(loadout.get("SYS", "")), {})
	sys_kind = str(sys.get("kind", "od")) if not sys.is_empty() else ""
	yaw = y
	c_aim_yaw = y
	collision_layer = 2
	collision_mask = 3
	floor_snap_length = 1.8
	floor_max_angle = deg_to_rad(52.0)
	model = MechModel.new()
	add_child(model)
	model.build(id, def, loadout, seed_v, 2)
	hit_h = model.height
	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 3.2
	cap.height = hit_h
	cs.shape = cap
	cs.position = Vector3(0, hit_h * 0.5, 0)
	add_child(cs)
	anim = MechModel.Anim.new()
	# weapons
	# hand weapons fill the slots in order, empty ones are skipped (the model does the same)
	var ri := 0
	for i in 3:
		var wid := str(loadout.get("R%d" % (i + 1), ""))
		if Defs.WEAPONS.has(wid):
			w_r[ri] = Weapon.new(Defs.WEAPONS[wid], "R")
			ri += 1
	weapons[0] = w_r[0]
	if game.world.space:
		motion_mode = CharacterBody3D.MOTION_MODE_FLOATING
	for i in 3:
		if w_r[i] != null and Defs.WEAPONS.has(str(w_r[i].d.get("sub", ""))):
			w_sub[i] = Weapon.new(Defs.WEAPONS[str(w_r[i].d["sub"])], "R")
	weapons[4] = w_sub[0]
	_refresh_melee()
	var lid := str(loadout.get("L", ""))
	var s1 := str(loadout.get("S1", ""))
	if Defs.WEAPONS.has(s1):
		weapons[1] = Weapon.new(Defs.WEAPONS[s1], "S1")
	# the left-arm weapon is on the right mouse button unless a shoulder weapon already is
	if Defs.WEAPONS.has(lid):
		weapons[1 if weapons[1] == null else 3] = Weapon.new(Defs.WEAPONS[lid], "L")
	var s2 := str(loadout.get("S2", ""))
	if Defs.WEAPONS.has(s2):
		weapons[2] = Weapon.new(Defs.WEAPONS[s2], "S2")
	if Defs.SHIELDS.has(lid):
		shield_def = Defs.SHIELDS[lid]
		shield_max = shield_def["hp"]
		shield_hp = shield_max
	global_position = pos
	model.rotation = Vector3(0, yaw, 0)
	model.pose(anim, 1.0)


func muzzle(mount: String) -> Vector3:
	if model.muz.has(mount):
		return model.muz[mount].global_position
	return center()


func aim_dir() -> Vector3:
	var cp := cos(c_aim_pitch)
	return Vector3(-sin(c_aim_yaw) * cp, sin(c_aim_pitch), -cos(c_aim_yaw) * cp)


# a rifle with a bayonet turns the melee attack into a thrust while it is in hand
func _refresh_melee() -> void:
	var w0 = weapons[0]
	if w0 != null and w0.d.get("bayonet", false):
		melee = (Defs.MELEE["bayonet"] as Dictionary).duplicate()
		melee["dmg"] = float(melee["dmg"]) * float(def.get("melee_mul", 1.0))
	else:
		melee = base_melee


# next / previous hand weapon that exists, starting from slot i
func next_r(i: int, step: int) -> int:
	for k in range(1, 3):
		var j := posmod(i + step * k, 3)
		if w_r[j] != null:
			return j
	return i


func on_fired(d: Dictionary, mount: String = "R", power: float = 1.0) -> void:
	fire_t = 0.9
	recover_t = maxf(recover_t, float(d.get("rec", 0.0)))
	var r: float = float(d.get("recoil", 0.3)) * power
	if mount == "L":
		anim.recoil_l = r
		aim_l_t = 1.2
	else:
		anim.recoil_r = r
	if is_player:
		game.shake((float(d.get("shake", 0.05)) + r * 0.06) * power)


func can_thrust() -> bool:
	return overheat_t <= 0.0 and thrust > 0.0


func free_thrust() -> bool:
	return od_on and (str(loadout.get("SYS", "")) == "od_mobility" or sys_kind == "ram")


func gain_od(v: float) -> void:
	if not od_on and not sys.is_empty():
		od = minf(1.0, od + v)


func _start_od() -> void:
	od_on = true
	od = 1.0
	od_t = sys["dur"]
	od_speed = sys["speed"]
	od_turn = sys["turn"]
	od_taken = sys["taken"]
	od_rof = sys["rof"]
	od_dmg = sys["dmg"]
	poise = base_poise * float(sys["poise"])
	impact = 0.0
	if sys_kind == "od" or sys_kind == "ram":
		thrust = 1.0
		overheat_t = 0.0
	if sys_kind == "ram":
		ram_hit.clear()
	elif sys_kind == "jam":
		hidden = true
	elif sys_kind == "focus":
		spread_keep = spread_mul
		spread_mul *= 0.1
	if str(loadout.get("SYS", "")) == "od_fortress" and shield_max > 0.0:
		shield_hp = maxf(shield_hp, shield_max * 0.6)
		model.restore_shield()
		model.set_shield(shield_hp / shield_max)
	model.kick_skirts(7.0)
	game.on_overdrive(self, true)


func _end_od() -> void:
	od_on = false
	od = 0.0
	od_speed = 1.0
	od_turn = 1.0
	od_taken = 1.0
	od_rof = 1.0
	od_dmg = 1.0
	poise = base_poise
	ramming = false
	if sys_kind == "jam":
		hidden = false
	elif sys_kind == "focus":
		spread_mul = spread_keep
	if alive:
		if sys_kind == "od":
			thrust = 0.0
			overheat_t = float(def["overheat"]) * 1.25
			boosting = false
		game.on_overdrive(self, false)


func tick(dt: float) -> void:
	if state == "dead":
		_tick_dead(dt)
		return
	guard_t = maxf(0.0, guard_t - dt)
	qb_cd -= dt
	melee_cd -= dt
	alert_t -= dt
	hit_flash = maxf(0.0, hit_flash - dt * 3.0)
	impact_idle += dt
	if impact_idle > 2.2:
		impact = maxf(0.0, impact - 45.0 * dt)
	if state == "stagger" or state == "down":
		state_t -= dt
		if state_t <= 0.0:
			guard_t = 1.5 if state == "down" else 0.5
			state = "normal"
	var can_act := state == "normal"
	if overheat_t > 0.0:
		overheat_t -= dt
		if overheat_t <= 0.0:
			thrust = 1.0
	# overdrive
	if od_on:
		od_t -= dt
		od = clampf(od_t / float(sys["dur"]), 0.0, 1.0)
		if str(loadout.get("SYS", "")) == "od_fortress" and shield_max > 0.0 and shield_hp > 0.0:
			shield_hp = minf(shield_max, shield_hp + shield_max * 0.05 * dt)
		# a ram charge can be cut short by pressing the key again
		if od_t <= 0.0 or (sys_kind == "ram" and c_od_p and od_t < float(sys["dur"]) - 0.6):
			_end_od()
	else:
		gain_od(dt / float(sys.get("cd", 170.0)))
		# buffered like the weapon swap: a press during a stagger fires when it ends
		if c_od_p:
			od_buf = 1.6
		od_buf = maxf(0.0, od_buf - dt)
		if od_buf > 0.0 and can_act and od >= 1.0 and not sys.is_empty():
			od_buf = 0.0
			_start_od()
	# dash cancel: a quick boost cuts the recovery of a melee swing short
	if state == "melee" and melee_hit and melee_t > melee_total * 0.47 + 0.1 and c_quick_p and qb_cd <= 0.0 and can_thrust():
		state = "normal"
		melee_cd = 0.3
		can_act = true
		game.on_cancel(self)
	recover_t = maxf(0.0, recover_t - dt)
	brace_fail = maxf(0.0, brace_fail - dt)
	# braced weapons: holding the trigger plants the frame; it fires once it has settled
	var want_brace := false
	if can_act and not (od_on and sys_kind == "ram"):
		for i in weapons.size():
			var bw = weapons[i]
			if bw == null or not c_fire[i] or not bw.d.has("brace") or (i == 0 and swap_t > 0.0):
				continue
			if (bw.is_beam and not bw.overheated) or (not bw.is_beam and bw.reload_t <= 0.0 and bw.cd <= 0.25 and bw.ammo > 0):
				want_brace = true
	var space: bool = game.world.space
	var was_bracing := bracing
	bracing = want_brace and (grounded or space) and recover_t <= 0.0
	if bracing and not was_bracing:
		game.sfx.play("brace", global_position, 0.9, randf_range(0.9, 1.05))
	if bracing:
		brace_t += dt
	else:
		brace_t = maxf(0.0, brace_t - dt * 3.0)
		if want_brace and not grounded and not space:
			brace_fail = 0.5
	var spd := od_speed
	var wish := c_move if can_act else Vector2.ZERO
	if bracing:
		wish = Vector2.ZERO
	if wish.length() > 1.0:
		wish = wish.normalized()
	var wl := wish.length()
	ramming = od_on and sys_kind == "ram" and can_act
	if ramming:
		var rf := U.fwd(yaw)
		wish = Vector2(rf.x, rf.z)
		wl = 1.0
	var used := false
	var was_boost := boosting
	ascending = false
	descending = false
	if can_act:
		yaw = U.turn_to(yaw, c_aim_yaw, turn_rate * od_turn * dt)
	var hv := Vector2(velocity.x, velocity.z)
	var vy := velocity.y
	var tv := Vector3.ZERO
	if can_act and c_melee_p and melee_cd <= 0.0 and can_thrust() and not ramming and recover_t <= 0.0:
		state = "melee"
		melee_combo = 1
		_melee_begin()
	if space:
		tv = _move_space(dt, can_act, wish, spd)
		used = _used
		hv = Vector2(velocity.x, velocity.z)
		vy = velocity.y
	else:
		if state == "melee":
			hv = _tick_melee(dt, hv)
			used = true
			boosting = false
			if melee_t < melee_total * 0.47:
				tv += U.fwd(yaw) * 1.2 + Vector3.UP * 0.2
		else:
			var want_boost := ramming or (can_act and c_boost and can_thrust() and wl > 0.05)
			if want_boost and not boosting:
				thrust -= 0.04
				if recover_t > 0.0:
					# starting a boost cancels the recovery of the last shot, at a price
					recover_t = 0.0
					thrust -= 0.08
					game.on_cancel(self)
				hv += wish * boost * spd * 0.5
				crouch_t = 0.22
				model.kick_skirts(5.0)
				game.on_boost_start(self)
			boosting = want_boost
			if can_act and c_quick_p and qb_cd <= 0.0 and can_thrust() and not ramming:
				var qd := wish
				if wl < 0.05:
					qd = Vector2(sin(yaw), cos(yaw))
				qb_dir = qd.normalized()
				hv = qb_dir * qb_speed * spd
				thrust -= 0.2
				qb_cd = 0.6
				qb_t = 0.22
				used = true
				if recover_t > 0.0:
					recover_t = 0.0
					game.on_cancel(self)
				model.kick_skirts(6.0)
				game.on_quick(self)
			qb_t -= dt
			var tgt := wish * (boost if boosting else walk) * spd
			if recover_t > 0.0 and not boosting:
				tgt *= 0.35
			var acc := 0.0
			if qb_t > 0.0:
				acc = 0.0
				tv += Vector3(qb_dir.x, 0.15, qb_dir.y) * 1.4
			elif not can_act:
				tgt = Vector2.ZERO
				acc = 36.0 if grounded else 3.0
			elif boosting:
				acc = 85.0
			elif not grounded:
				acc = 14.0 if wl > 0.05 else 3.0
			else:
				acc = 62.0 if wl > 0.05 else 52.0
			hv = hv.move_toward(tgt, acc * dt)
			if boosting:
				thrust -= float(def["drain"]) * (1.0 if grounded else 1.25) * dt
				used = true
				tv += Vector3(wish.x, 0.3 if grounded else 0.75, wish.y)
			if can_act and can_thrust():
				if c_jump_p and grounded:
					vy = 23.0
					grounded = false
					thrust -= 0.06
					used = true
					crouch_t = 0.0
					model.kick_skirts(6.0)
					game.on_jump(self)
				elif c_jump and not grounded:
					var alt: float = global_position.y - game.world.height(global_position.x, global_position.z)
					var top := 25.0 * spd * clampf((CEILING - alt) / 60.0, 0.0, 1.0)
					vy = minf(vy + 72.0 * dt, maxf(top, vy - 40.0 * dt))
					thrust -= 0.2 * dt
					used = true
					ascending = true
					tv += Vector3.UP * 1.1
			if can_act and c_descend and not grounded and not ascending:
				vy = maxf(vy - 95.0 * dt, -62.0)
				descending = true
		if grounded:
			vy = -1.5
		else:
			vy -= 34.0 * dt
			if boosting and not ascending and not descending:
				# air dash: hold altitude
				vy = lerpf(vy, -1.5, 1.0 - exp(-7.0 * dt))
			vy = maxf(vy, -70.0)
	# thrust economy
	if free_thrust():
		thrust = 1.0
	if used:
		thrust_idle = 0.0
	else:
		thrust_idle += dt
		if thrust_idle > 0.7 and overheat_t <= 0.0:
			thrust = minf(1.0, thrust + float(def["regen"]) * (1.0 if (grounded or space) else 0.4) * dt)
	if thrust <= 0.0 and overheat_t <= 0.0:
		thrust = 0.0
		overheat_t = def["overheat"]
		boosting = false
		game.on_overheat(self)
	if was_boost and not boosting and grounded:
		model.kick_skirts(-3.0)
	# wire anchor: flying out, reeling the frame in, or coming back
	if not hook.is_empty() and _tick_hook(dt):
		hv = Vector2(hook_vel.x, hook_vel.z)
		vy = hook_vel.y
		tv += hook_vel.normalized() * 1.2
		used = true
	# move
	var fall := -vy
	velocity = Vector3(hv.x, vy, hv.y)
	move_and_slide()
	if space and get_slide_collision_count() > 0 and velocity.length() + fall * 0.0 > 12.0:
		scrape_t -= dt
		if scrape_t <= 0.0:
			scrape_t = 0.05
			var kc := get_slide_collision(0)
			for q in 3:
				game.fx.emit("spark", kc.get_position(), kc.get_normal() * randf_range(6, 16) + Vector3(randf_range(-8, 8), randf_range(-8, 8), randf_range(-8, 8)))
	var on := is_on_floor()
	if on and not grounded and fall > 12.0:
		land_t = minf(1.0, fall / 40.0)
		model.kick_skirts(4.0 + fall * 0.2)
		game.on_land(self, fall)
	grounded = on
	if ramming:
		_ram_sweep()
	var gp := global_position
	if space:
		var cp: Vector3 = gp.clamp(game.world.space_min, game.world.space_max)
		if cp != gp:
			global_position = cp
	else:
		var bound: float = game.world.bound
		if absf(gp.x) > bound or absf(gp.z) > bound:
			global_position = Vector3(clampf(gp.x, -bound, bound), gp.y, clampf(gp.z, -bound, bound))
	# weapon swap: the press is buffered so one made during a melee swing, a stagger or
	# the previous swap is carried out as soon as it becomes possible
	# X toggles (relative to where the hand ends up after a swap already under way);
	# the wheel asks for a specific weapon, so several notches still mean one swap.
	if c_swap_p:
		var cur := swap_want if swap_want >= 0 else (swap_next if swap_t > 0.25 else r_idx)
		swap_want = next_r(cur, 1)
		swap_buf = 0.9
	if c_swap_dir != 0 and swap_t <= 0.0 and swap_want < 0:
		# the wheel steps once per gesture: further notches during the swap are ignored
		swap_want = next_r(r_idx, c_swap_dir)
		swap_buf = 0.9
	if state != "down":
		swap_buf = maxf(0.0, swap_buf - dt)
		if swap_buf <= 0.0:
			swap_want = -1
	if swap_t > 0.0:
		var before := swap_t
		swap_t -= dt
		if before > 0.25 and swap_t <= 0.25:
			r_idx = swap_next
			weapons[0] = w_r[r_idx]
			if weapons[4] != null:
				weapons[4].cancel()
			weapons[4] = w_sub[r_idx]
			_refresh_melee()
			model.set_active_r(r_idx)
			if is_player:
				game.sfx.play2d("swap", 0.7)
	elif swap_want >= 0 and state != "down":
		if swap_want != r_idx and w_r[swap_want] != null:
			swap_t = 0.5
			swap_next = swap_want
			w_r[r_idx].cancel()
		swap_want = -1
	# weapons
	var wdt := dt * od_rof
	var settled: bool = (grounded and Vector2(velocity.x, velocity.z).length() < 4.0) or (space and velocity.length() < 6.0)
	var brace_k := 0.4 if (od_on and sys_kind == "focus") else 1.0
	for i in weapons.size():
		var w = weapons[i]
		if w == null:
			continue
		var held: bool = can_act and c_fire[i] and recover_t <= 0.0 and not ((i == 0 or i == 4) and swap_t > 0.0)
		if held and w.d.has("brace"):
			held = settled and brace_t >= float(w.d["brace"]) * brace_k
		w.tick(wdt, self, held)
	# the stowed right-hand weapon and its under-barrel weapon keep reloading
	for i in 3:
		if i != r_idx:
			for ow in [w_r[i], w_sub[i]]:
				if ow != null:
					ow.tick(wdt, self, false)
	_animate(dt, tv)


# Zero-g flight: no gravity, no ground. WASD moves in the horizontal plane relative to the
# view, c_vert goes straight up / down, and the three combine; the frame never rolls.
# Returns the thrust direction for the animation and sets velocity.
func _move_space(dt: float, can_act: bool, wish: Vector2, spd: float) -> Vector3:
	var tv := Vector3.ZERO
	var v := velocity
	_used = false
	if state == "melee":
		var hv := _tick_melee(dt, Vector2(v.x, v.z))
		var vy := v.y
		if melee_target != null and melee_target.alive and melee_t < melee_total * 0.47:
			vy = clampf((melee_target.center().y - center().y) * 4.0, -70.0, 70.0)
		else:
			vy = move_toward(vy, 0.0, 130.0 * dt)
		velocity = Vector3(hv.x, vy, hv.y)
		_used = true
		boosting = false
		if melee_t < melee_total * 0.47:
			tv = velocity.normalized() * 1.2
		return tv
	var w3 := Vector3(wish.x, c_vert if (can_act and not bracing) else 0.0, wish.y)
	if ramming:
		w3.y = 0.0
	if w3.length() > 1.0:
		w3 = w3.normalized()
	var wl := w3.length()
	var want_boost := ramming or (can_act and c_boost and can_thrust() and wl > 0.05)
	if want_boost and not boosting:
		thrust -= 0.04
		if recover_t > 0.0:
			recover_t = 0.0
			thrust -= 0.08
			game.on_cancel(self)
		v += w3 * boost * spd * 0.5
		model.kick_skirts(5.0)
		game.on_boost_start(self)
	boosting = want_boost
	if can_act and c_quick_p and qb_cd <= 0.0 and can_thrust() and not ramming:
		var qd := w3
		if wl < 0.05:
			qd = U.fwd(yaw)
		qb_dir3 = qd.normalized()
		qb_dir = Vector2(qb_dir3.x, qb_dir3.z)
		v = qb_dir3 * qb_speed * spd
		thrust -= 0.2
		qb_cd = 0.6
		qb_t = 0.22
		_used = true
		if recover_t > 0.0:
			recover_t = 0.0
			game.on_cancel(self)
		model.kick_skirts(6.0)
		game.on_quick(self)
	qb_t -= dt
	var tgt := w3 * (boost if boosting else walk * 1.5) * spd
	if recover_t > 0.0 and not boosting:
		tgt *= 0.35
	var acc := 0.0
	if qb_t > 0.0:
		tv += qb_dir3 * 1.4
	elif not can_act:
		tgt = Vector3.ZERO
		acc = 14.0
	elif boosting:
		acc = 85.0
	else:
		acc = 46.0 if wl > 0.05 else 24.0
	v = v.move_toward(tgt, acc * dt)
	if boosting:
		thrust -= float(def["drain"]) * dt
		_used = true
		tv += w3
	elif wl > 0.05:
		tv += w3 * 0.5
	ascending = boosting and w3.y > 0.5
	velocity = v
	return tv


func _ground_at(x: float, z: float) -> float:
	return game.world.height(x, z) + _g_off


var _g_off := 0.0


func _animate(dt: float, tv: Vector3) -> void:
	var a = anim
	var hs := Vector2(velocity.x, velocity.z).length()
	var f := U.fwd(yaw)
	var right := Vector3(-f.z, 0, f.x)
	var fv := velocity.dot(f)
	var lv := velocity.dot(right)
	var lunging := state == "melee" and melee_t < melee_total * 0.47
	var dashing := boosting or qb_t > 0.0 or lunging or (grounded and hs > walk * od_speed * 1.5)
	a.boost = U.damp(a.boost, 1.0 if dashing else 0.0, 9.0, dt)
	a.air = U.damp(a.air, 0.0 if grounded else 1.0, 8.0, dt)
	a.twist = U.damp(a.twist, clampf(U.ang_diff(yaw, c_aim_yaw), -1.75, 1.75), 16.0, dt)
	a.pitch = U.damp(a.pitch, c_aim_pitch, 14.0, dt)
	a.recoil_r = maxf(0.0, a.recoil_r - dt * 7.0)
	a.recoil_l = maxf(0.0, a.recoil_l - dt * 7.0)
	# "fire": the gun stays shouldered while shooting and for a moment after
	fire_t -= dt
	var trig := false
	for i in c_fire.size():
		if c_fire[i] and weapons[i] != null:
			trig = true
	if trig or bracing:
		fire_t = maxf(fire_t, 0.5)
	a.fire = U.damp(a.fire, 1.0 if fire_t > 0.0 else 0.0, 10.0, dt)
	a.mcharge = U.damp(a.mcharge, melee_charge if state == "melee" else 0.0, 14.0, dt)
	a.space = game.world.space
	var wh = weapons[0]
	a.two_hand = U.damp(a.two_hand, 1.0 if (wh != null and float(wh.d.get("wt", 3.0)) >= 2.5) else 0.0, 8.0, dt)
	a.stagger = U.damp(a.stagger, 1.0 if state == "stagger" else 0.0, 12.0, dt)
	a.down = U.damp(a.down, 1.0 if (state == "down" or state == "dead") else 0.0, 7.0, dt)
	land_t = maxf(0.0, land_t - dt * 2.5)
	a.land = land_t
	crouch_t = maxf(0.0, crouch_t - dt)
	a.crouch = sin(clampf(crouch_t / 0.22, 0.0, 1.0) * PI) * 1.1 + clampf(brace_t / 0.3, 0.0, 1.0) * 0.55
	a.idle_t += dt
	a.melee_on = state == "melee"
	if a.melee_on:
		a.melee_t = melee_t / melee_total
	# the sword is out through a bout and for a moment after it, and whenever the locked
	# foe is inside lunge range
	blade_t = 2.5 if a.melee_on else maxf(0.0, blade_t - dt)
	var drawn := blade_t > 0.0
	if not drawn and alive and c_lock != null and is_instance_valid(c_lock) and c_lock.alive:
		var bd: Vector3 = c_lock.global_position - global_position
		drawn = Vector2(bd.x, bd.z).length() < float(melee.get("lunge", 60.0)) * 1.15
	a.blade = U.damp(a.blade, 1.0 if (drawn and (state == "normal" or state == "melee")) else 0.0, 6.0, dt)
	a.mvx = U.damp(a.mvx, clampf(lv / boost, -1.0, 1.0), 9.0, dt)
	a.mvz = U.damp(a.mvz, clampf(fv / boost, -1.0, 1.0), 9.0, dt)
	a.vy = velocity.y if (not grounded and not game.world.space) else 0.0
	a.thrust = tv.limit_length(1.4)
	var hot: bool = od_on and (sys_kind == "od" or sys_kind == "ram")
	a.od = U.damp(a.od, 1.0 if hot else 0.0, 5.0, dt)
	var w0 = weapons[0]
	a.charge = U.damp(a.charge, w0.charge if w0 != null else 0.0, 12.0, dt)
	a.swap = sin(clampf(swap_t / 0.5, 0.0, 1.0) * PI)
	guard_v = maxf(0.0, guard_v - dt * 1.2)
	a.guard = U.damp(a.guard, clampf(guard_v, 0.0, 1.0) if shield_hp > 0.0 else 0.0, 14.0, dt)
	# whole-body lean follows acceleration / dash direction
	var lk := 0.36 if a.boost > 0.3 else 0.07
	var lean_x := -clampf(fv / boost, -1.0, 1.0) * lk
	var lean_z := -clampf(lv / boost, -1.0, 1.0) * (0.36 if a.boost > 0.3 else 0.1)
	if ascending and not boosting:
		lean_x -= 0.06
	if descending:
		lean_x -= 0.3
	if ramming:
		lean_x -= 0.16
	if state == "stagger":
		lean_x += sin(state_t * 40.0) * 0.03 + 0.08
	var r: Vector3 = model.rotation
	model.rotation = Vector3(U.damp(r.x, lean_x, 7.0, dt), yaw, U.damp(r.z, lean_z, 7.0, dt))
	# feet
	var feet_on: bool = grounded and not dashing and (state == "normal" or state == "stagger" or state == "melee")
	if grounded:
		_g_off = global_position.y - game.world.height(global_position.x, global_position.z)
	model.gait(dt, yaw, velocity, _ground_at, feet_on)
	for lg in model.steps:
		model.kick_skirts(1.6)
		game.on_step(self, lg.pos)
	model.pose(a, dt)
	# exhaust particles + ground wash
	if tv.length_squared() > 0.01:
		for z in model.noz:
			if float(z["lvl"]) > 0.45 and z["grp"] != "side" and z["grp"] != "front":
				var nn: Node3D = z["n"]
				game.fx.thruster(nn.global_position, -nn.global_transform.basis.y.normalized())
		fx_t -= dt
		if fx_t <= 0.0:
			fx_t = 0.045
			var gy: float = game.world.height(global_position.x, global_position.z)
			var alt := global_position.y - gy
			if alt < 16.0:
				var back := Vector3(tv.x, 0, tv.z)
				var p := Vector3(global_position.x, gy, global_position.z) - back * 3.0
				game.fx.dust(p, 2 if ascending else 1, 2.5 + alt * 0.4, 9.0 + alt, 4.0)
	# overdrive heat shimmer
	if hot:
		fx_t -= dt * 0.5
		if randf() < dt * 14.0:
			var c := center()
			game.fx.emit("spark", c + Vector3(randf_range(-2.5, 2.5), randf_range(-3, 4), randf_range(-2.5, 2.5)), Vector3(randf_range(-3, 3), randf_range(6, 14), randf_range(-3, 3)) - velocity * 0.2)


func _melee_begin() -> void:
	var m: Dictionary = melee
	melee_t = 0.0
	melee_hit = false
	melee_queued = false
	melee_charge = 0.0
	melee_released = false
	hit_freeze = 0.0
	# this blow of the weapon's combo
	var moves: Array = m.get("moves", [])
	var mv: Array = ["down", "", 1.0, 0.85]
	if not moves.is_empty():
		mv = moves[clampi(melee_combo - 1, 0, moves.size() - 1)]
	melee_total = float(mv[3])
	melee_mul = float(mv[2])
	anim.melee_path = str(mv[0])
	thrust -= 0.09 + (0.04 if str(m.get("energy", "")) == "plasma" else 0.0)
	melee_target = null
	if c_lock != null and c_lock.alive:
		var dd: Vector3 = c_lock.global_position - global_position
		if Vector2(dd.x, dd.z).length() < float(m["lunge"]):
			melee_target = c_lock
	var sty: int = m["style"]
	anim.melee_style = 3 if sty == 3 else melee_combo
	anim.melee_arm = -1
	if (m["arm"] == "both" and melee_combo % 2 == 0) or m["arm"] == "R":
		anim.melee_arm = 1
	if str(mv[1]) != "":
		anim.melee_arm = 1 if str(mv[1]) == "R" else -1
	game.sfx.play("plasma_swing" if str(m.get("energy", "solid")) == "plasma" else "swing", center(), 1.0, randf_range(0.9, 1.1))


func _tick_melee(dt: float, hv: Vector2) -> Vector2:
	var m: Dictionary = melee
	# hit-stop: the blade bites and both frames hang for a moment
	if hit_freeze > 0.0:
		hit_freeze -= dt
		return hv.move_toward(Vector2.ZERO, 900.0 * dt)
	var hit_time := melee_total * 0.47
	var wind := melee_total * 0.36
	# keep the key down through the wind-up of an opening attack to charge it
	var holding: bool = melee_combo == 1 and c_melee and not melee_released and melee_t + dt >= wind and melee_charge < 1.0
	if holding:
		melee_t = wind
		melee_charge = minf(1.0, melee_charge + dt / 0.9)
		if randf() < dt * 30.0:
			var bp: Vector3 = model.blade_tip()
			game.fx.emit("spark", bp, Vector3(randf_range(-6, 6), randf_range(2, 10), randf_range(-6, 6)))
		if melee_charge >= 1.0:
			game.fx.flash(model.blade_tip(), 12.0, 0.2, Color(1.0, 0.5, 0.2))
	else:
		melee_t += dt
		if melee_t >= wind:
			melee_released = true
	var f := U.fwd(yaw)
	if melee_t < hit_time:
		var dir := Vector2(f.x, f.z)
		var dist := 999.0
		if melee_target != null and melee_target.alive:
			var dd: Vector3 = melee_target.global_position - global_position
			var d2 := Vector2(dd.x, dd.z)
			dist = d2.length()
			if dist > 0.5:
				dir = d2 / dist
			yaw = U.turn_to(yaw, atan2(-dir.x, -dir.y), 7.0 * dt)
			c_aim_yaw = yaw
		var sp: float = float(m["speed"]) * od_speed if dist > float(m["reach"]) * 0.75 else 6.0
		if holding:
			sp *= 0.3
		hv = hv.move_toward(dir * sp, 420.0 * dt)
	else:
		if not melee_hit:
			melee_hit = true
			_melee_strike()
		hv = hv.move_toward(Vector2.ZERO, 130.0 * dt)
		if c_melee_p and melee_combo < int(m["combo"]):
			melee_queued = true
		if melee_t > melee_total * 0.7 and melee_queued and can_thrust():
			melee_combo += 1
			_melee_begin()
		elif melee_t >= melee_total:
			state = "normal"
			melee_cd = 0.45
	return hv


func _melee_strike() -> void:
	var m: Dictionary = melee
	var f := U.fwd(yaw)
	var mul: float = melee_mul * (1.0 + 0.8 * melee_charge)
	var any = null
	var space: bool = game.world.space
	for u in game.units:
		if not u.alive or u.team == team:
			continue
		var dd: Vector3 = u.global_position - global_position
		var d2 := Vector2(dd.x, dd.z)
		var dist := d2.length()
		if dist > float(m["reach"]) + 3.5 + u.radius + melee_charge * 2.0 or absf(u.center().y - center().y) > (14.0 + u.radius if space else 14.0):
			continue
		if dist > 1.0 and (d2 / dist).dot(Vector2(f.x, f.z)) < 0.35:
			continue
		var hp: Vector3 = u.center().lerp(center(), 0.35)
		u.take_damage(float(m["dmg"]) * mul * dmg_mul * od_dmg, 999.0, self, "melee", hp)
		any = u
		var en := str(m.get("energy", "solid"))
		var dealt: float = float(m["dmg"]) * mul * dmg_mul * od_dmg
		if en == "heat":
			# the wound keeps cooking: a quarter of the blow again over three seconds
			game.add_burn(u, dealt * 0.25, 3.0, self)
		elif en == "plasma" and u.kind == "mech" and u.shield_hp > 0.0:
			# a plasma blade goes through the arm shield and takes it apart on the way
			var take: float = dealt * 0.6
			u.shield_hp = maxf(0.0, u.shield_hp - take)
			var lost: Array = u.model.set_shield(u.shield_hp / u.shield_max)
			game.on_shield_hit(u, self, hp, take, u.shield_hp <= 0.0, lost)
		game.on_melee_hit(self, u, hp, melee_charge, en)
	if any != null:
		hit_freeze = 0.08 + 0.1 * melee_charge
	if any == null:
		game.sfx.play("whiff", center(), 0.6)


# ---------------------------------------------------------------- wire anchor
func fire_hook(d: Dictionary, from: Vector3, dir: Vector3) -> void:
	hook = {"d": d, "pos": from, "dir": dir, "phase": "fly", "t": 0.0, "dist": 0.0, "target": null, "anchor": from}
	if hook_node == null:
		hook_node = model.loose_part("h_hook")
		if hook_node != null:
			add_child(hook_node)
			hook_node.top_level = true


func _drop_hook() -> void:
	hook.clear()
	if hook_node != null:
		hook_node.visible = false


# returns true while the wire is reeling the frame in (hook_vel is then the velocity to use)
func _tick_hook(dt: float) -> bool:
	var d: Dictionary = hook["d"]
	var o := muzzle("L")
	hook["t"] = float(hook["t"]) + dt
	var pos: Vector3 = hook["pos"]
	var reel := false
	var phase := str(hook["phase"])
	if phase == "fly":
		var dir: Vector3 = hook["dir"]
		var step: float = float(d["speed"]) * dt
		var res: Dictionary = game.ray(pos, pos + dir * step, 3, game.team_rids[team])
		if not res.is_empty():
			pos = res["position"]
			var col = res["collider"]
			if col != null and col.has_method("take_damage") and col.get("alive") == true:
				hook["target"] = col
				col.take_damage(float(d["dmg"]) * dmg_mul * od_dmg, float(d["impact"]), self, "melee", pos)
				game.on_hook(self, col, pos)
			else:
				game.on_hook(self, null, pos)
			hook["anchor"] = pos
			hook["phase"] = "reel"
			hook["t"] = 0.0
		else:
			pos += dir * step
			hook["dist"] = float(hook["dist"]) + step
			if float(hook["dist"]) >= float(d["range"]):
				hook["phase"] = "back"
	elif phase == "reel":
		var tg = hook["target"]
		var goal: Vector3 = hook["anchor"]
		var live: bool = tg != null and is_instance_valid(tg) and tg.alive
		if live:
			goal = tg.center()
		pos = goal
		var to := goal - center()
		var dist := to.length()
		if dist < (13.0 if live else 7.0) or float(hook["t"]) > 1.7 or state != "normal" or c_quick_p or (c_jump_p and float(hook["t"]) > 0.15):
			hook["phase"] = "back"
		else:
			hook_vel = to / dist * minf(115.0, 45.0 + dist * 3.0)
			reel = true
	else:
		var back := o - pos
		var bl := back.length()
		var sp := 420.0 * dt
		if bl <= sp + 0.5:
			_drop_hook()
			return false
		pos += back / bl * sp
	hook["pos"] = pos
	game.fx.beam(o, pos, 0.16, Color(0.62, 0.66, 0.75), 0.0, 0.3)
	if hook_node != null:
		hook_node.visible = true
		var fwd := pos - o
		if fwd.length() > 0.5:
			hook_node.global_transform = Transform3D(Basis.looking_at(fwd.normalized(), Vector3.UP if absf(fwd.normalized().y) < 0.95 else Vector3.RIGHT), pos)
	return reel


# ram charge: everything hostile in the path is hit once, staggered and shoved aside
func _ram_sweep() -> void:
	var f := U.fwd(yaw)
	guard_v = 1.6
	for u in game.units:
		if not u.alive or u.team == team or u.airborne:
			continue
		var dd: Vector3 = u.global_position - global_position
		var d2 := Vector2(dd.x, dd.z)
		var dist := d2.length()
		if dist > 7.5 + u.radius or absf(dd.y) > 12.0:
			continue
		if dist > 1.0 and (d2 / dist).dot(Vector2(f.x, f.z)) < 0.2:
			continue
		var id: int = u.get_instance_id()
		if ram_hit.has(id) and float(ram_hit[id]) - od_t < 1.2:
			continue
		ram_hit[id] = od_t
		var hp: Vector3 = u.center().lerp(center(), 0.4)
		u.take_damage(float(sys["hit"]) * dmg_mul, 999.0, self, "ram", hp)
		if u.kind == "mech":
			u.velocity += f * 34.0 + Vector3(0, 6.0, 0)
		game.on_ram_hit(self, u, hp)


# does the arm shield cover an attack arriving from src?
func _shield_covers(src: Vector3) -> bool:
	if shield_hp <= 0.0 or state == "melee" or state == "down":
		return false
	var d := src - center()
	if Vector2(d.x, d.z).length() < 1.0:
		return false
	var to := atan2(-d.x, -d.z)
	var facing: float = yaw + anim.twist + 0.45
	return absf(U.ang_diff(facing, to)) < deg_to_rad(float(shield_def["arc"]))


func take_damage(dmg: float, imp: float, from, how: String, pos: Vector3) -> void:
	if not alive:
		return
	var mul := od_taken * vuln()
	if state == "stagger":
		mul *= 1.2
	elif state == "down":
		mul *= 0.8
	if guard_t > 0.0:
		mul *= 0.5
	dmg *= mul
	last_hit_by = from
	alert_t = 12.0
	# arm shield soaks hits arriving inside its arc
	if how != "melee" and how != "ram":
		var src: Vector3 = from.center() if from != null else pos
		if how == "splash":
			src = pos
		if _shield_covers(src):
			var take := dmg * (0.7 if how == "splash" else 1.0)
			var before := shield_hp
			shield_hp -= take
			guard_v = 1.6
			var broke := shield_hp <= 0.0
			var lost: Array = model.set_shield(maxf(shield_hp, 0.0) / shield_max)
			game.on_shield_hit(self, from, pos, take, broke, lost)
			if not broke:
				impact += imp * 0.2
				impact_idle = 0.0
				return
			dmg = maxf(0.0, take - before) * 0.5
			imp *= 0.5
			shield_hp = 0.0
	ap -= dmg
	hit_flash = 1.0
	gain_od(dmg / ap_max * 0.55)
	if imp > 20.0:
		model.kick_skirts(minf(imp * 0.05, 5.0))
	if guard_t <= 0.0 and state != "down":
		if how == "melee" and state == "stagger":
			_enter("down")
		else:
			impact += imp
			impact_idle = 0.0
			if impact >= poise and state != "stagger":
				_enter("stagger")
	game.on_damage(self, dmg, from, how, pos)
	if ap <= 0.0:
		ap = 0.0
		_die(from)


func _enter(s: String) -> void:
	state = s
	impact = 0.0
	boosting = false
	brace_t = 0.0
	recover_t = 0.0
	for w in weapons:
		if w != null:
			w.cancel()
	if s == "stagger":
		state_t = 1.35
		model.kick_skirts(6.0)
		game.on_stagger(self)
	else:
		state_t = 2.3
		model.kick_skirts(8.0)
		game.on_down(self)


func repair() -> bool:
	if repair_kits <= 0 or not alive or ap >= ap_max:
		return false
	repair_kits -= 1
	ap = minf(ap_max, ap + ap_max * 0.4)
	return true


func _die(from) -> void:
	alive = false
	state = "dead"
	boosting = false
	_drop_hook()
	if od_on:
		_end_od()
	for w in weapons:
		if w != null:
			w.cancel()
	collision_layer = 0
	model.set_wreck()
	game.on_unit_killed(self, from)


func _tick_dead(dt: float) -> void:
	dead_t += dt
	if gone:
		return
	# wrecks are cleared once they have burnt out and nobody is near: every frame keeps
	# dozens of mesh instances alive, and a long battle leaves a lot of them
	if dead_t > 45.0 and not is_player:
		var far: bool = game.cam.global_position.distance_to(global_position) > 160.0
		if far or dead_t > 100.0:
			gone = true
			visible = false
			if not far:
				game.fx.dust(global_position, 10, 4.0, 14.0, 4.0)
			model.queue_free()
			return
	var hv := Vector2(velocity.x, velocity.z).move_toward(Vector2.ZERO, 40.0 * dt)
	velocity = Vector3(hv.x, velocity.y - 34.0 * dt if not is_on_floor() else -1.5, hv.y)
	move_and_slide()
	anim.melee_on = false
	anim.down = U.damp(anim.down, 1.0, 5.0, dt)
	anim.stagger = U.damp(anim.stagger, 0.6, 5.0, dt)
	anim.boost = 0.0
	anim.thrust = Vector3.ZERO
	anim.od = 0.0
	# a wreck that has settled keeps its last pose
	if dead_t < 8.0 or not is_on_floor():
		model.gait(dt, yaw, Vector3.ZERO, _ground_at, false)
		model.pose(anim, dt)
	if dead_t < 30.0:
		fx_t -= dt
		if fx_t <= 0.0:
			fx_t = 0.18
			var c := center()
			game.fx.emit("smoke", c + Vector3(randf_range(-2, 2), -2, randf_range(-2, 2)), Vector3(randf_range(2, 4), randf_range(5, 9), randf_range(-1, 1)))
			if dead_t < 8.0 and randf() < 0.5:
				game.fx.emit("fire", c + Vector3(randf_range(-2, 2), -4, randf_range(-2, 2)), Vector3(0, randf_range(2, 5), 0))
