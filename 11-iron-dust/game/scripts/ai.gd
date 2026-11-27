extends RefCounted
# Drives a frame through the same control inputs the player uses.

const U = preload("res://scripts/u.gd")

var m
var game
var cfg: Dictionary
var target = null
var think_t := 0.0
var aim_yaw := 0.0
var aim_pitch := 0.0
var strafe := 1.0
var strafe_t := 0.0
var burst_t := 1.0
var burst_on := false
var dodge_t := 3.0
var melee_t := 2.0
var los_t := 0.0
var los_ok := false
var stuck_t := 0.0
var jump_hold := 0.0
var heavy_t := 3.0
var missile_t := 6.0
var post := Vector3.ZERO
var follow = null
var follow_off := Vector3(-24, 0, 16)
var sense := 520.0
var prefer_ground := true
var hunt_objectives := false
var hunt_bias := 0.0
var hold_t := [0.0, 0.0, 0.0, 0.0, 0.0]
var aux_t := 4.0
var sub_t := 5.0
var air_t := 5.0


func _init(mech, g, post_pos: Vector3) -> void:
	m = mech
	game = g
	post = post_pos
	cfg = m.def.get("ai", {"range": [120.0, 230.0], "acc": 1.0, "burst": [1.6, 1.2], "melee": 0.2, "dodge": [4.0, 8.0]})
	aim_yaw = m.yaw
	m.spread_mul = 2.0 * float(cfg["acc"])
	m.lead_k = 0.8
	m.ai = self
	strafe = 1.0 if randf() < 0.5 else -1.0
	hunt_bias = randf()
	dodge_t = randf_range(2.0, 6.0)
	heavy_t = randf_range(2.0, 5.0)
	missile_t = randf_range(4.0, 9.0)


func _pick_target() -> void:
	var best := sense * (2.2 if m.alert_t > 0.0 else 1.0)
	var pick = null
	var p: Vector3 = m.global_position
	# objective hunters go for the nearest objective and only bite on defenders that
	# are close or that have just hit them
	var hunter := hunt_objectives and hunt_bias > 0.3
	var obj = null
	var obj_d := 1e9
	for u in game.units:
		if not u.alive or u.team == m.team or u.hidden:
			continue
		var d: float = u.global_position.distance_to(p)
		if hunter:
			if u.objective:
				if d < obj_d:
					obj_d = d
					obj = u
				continue
			if u.airborne or d > (240.0 if u == m.last_hit_by else 110.0):
				continue
		if u.is_player:
			d *= 0.8
		if u.kind != "mech":
			d *= 1.3
		if d < best:
			best = d
			pick = u
	if hunter and pick == null:
		pick = obj
	target = pick


# hold a charge weapon's trigger for dur seconds, then release to fire
func _hold(i: int, dt: float, dur: float, start: bool) -> void:
	if hold_t[i] > 0.0:
		hold_t[i] -= dt
		m.c_fire[i] = hold_t[i] > 0.0
	elif start and m.weapons[i].ready():
		hold_t[i] = dur
		m.c_fire[i] = true


func _unstick(dt: float) -> void:
	var hs := Vector2(m.velocity.x, m.velocity.z).length()
	if m.c_move.length() > 0.1 and hs < 2.5 and m.grounded and m.state == "normal":
		stuck_t += dt
		if stuck_t > 0.5:
			stuck_t = 0.0
			m.c_jump_p = true
			jump_hold = 0.8
			strafe = -strafe
	else:
		stuck_t = 0.0
	if jump_hold > 0.0:
		jump_hold -= dt
		m.c_jump = true


func tick(dt: float) -> void:
	m.c_move = Vector2.ZERO
	m.c_boost = false
	m.c_jump = false
	m.c_jump_p = false
	m.c_quick_p = false
	m.c_melee_p = false
	m.c_swap_p = false
	m.c_swap_to = -1
	m.c_swap_dir = 0
	m.c_melee = false
	m.c_vert = 0.0
	m.c_od_p = false
	m.c_descend = false
	m.c_fire = [false, false, false, false, false]
	if not m.alive:
		return
	# retro-brake when dropped from altitude
	var space: bool = game.world.space
	if not space and not m.grounded and m.velocity.y < -24.0:
		var alt: float = m.global_position.y - game.world.height(m.global_position.x, m.global_position.z)
		if alt < 14.0 + absf(m.velocity.y) * 1.3:
			m.c_jump = true
	if target != null and (target.hidden or not target.alive):
		target = null
		m.c_lock = null
	if m.od >= 1.0 and not m.od_on:
		var sk: String = m.sys_kind
		if sk == "od" or sk == "jam":
			m.c_od_p = m.ap < m.ap_max * 0.6
		elif sk == "scan":
			m.c_od_p = target != null
		elif sk == "ram" and target != null and not target.airborne:
			var td: float = target.global_position.distance_to(m.global_position)
			m.c_od_p = td < 150.0 and td > 30.0 and absf(U.ang_diff(m.yaw, aim_yaw)) < 0.3
	think_t -= dt
	if think_t <= 0.0:
		think_t = randf_range(0.6, 1.1)
		_pick_target()
	var pos: Vector3 = m.global_position
	if target == null or not target.alive:
		target = null
		m.c_lock = null
		var goal := post
		if follow != null and follow.alive:
			goal = follow.global_position + follow_off.rotated(Vector3.UP, follow.yaw)
		var to := Vector2(goal.x - pos.x, goal.z - pos.z)
		var dl := to.length()
		if dl > 26.0:
			var dir := to / dl
			m.c_move = dir
			aim_yaw = U.turn_to(aim_yaw, atan2(-dir.x, -dir.y), 2.5 * dt)
			m.c_boost = dl > 120.0 and m.thrust > 0.35
		if space:
			m.c_vert = clampf((goal.y - pos.y) / 25.0, -1.0, 1.0)
		m.c_aim_yaw = aim_yaw
		m.c_aim_pitch = 0.0
		_unstick(dt)
		return
	var tc: Vector3 = target.center()
	var me: Vector3 = m.center()
	var dd := tc - me
	var d2 := Vector2(dd.x, dd.z)
	var dist := d2.length()
	var dirn := d2 / maxf(dist, 0.1)
	var want_yaw := atan2(-dd.x, -dd.z)
	var want_pitch := atan2(dd.y, maxf(dist, 1.0))
	aim_yaw = U.turn_to(aim_yaw, want_yaw, 2.6 * dt)
	aim_pitch = U.turn_to(aim_pitch, want_pitch, 1.5 * dt)
	m.c_aim_yaw = aim_yaw
	m.c_aim_pitch = aim_pitch
	m.c_aim_point = tc
	if m.c_lock != target:
		m.c_lock = target
		m.c_lock_t = 0.0
	m.c_lock_t += dt
	los_t -= dt
	if los_t <= 0.0:
		los_t = 0.35
		los_ok = game.los(me, tc)
	# movement
	var rng: Array = cfg["range"]
	var rad := 0.0
	if dist > float(rng[1]) or not los_ok:
		rad = 1.0
	elif dist < float(rng[0]):
		rad = -1.0
	strafe_t -= dt
	if strafe_t <= 0.0:
		strafe_t = randf_range(2.0, 5.0)
		if randf() < 0.7:
			strafe = -strafe
	var wish := dirn * rad + Vector2(dirn.y, -dirn.x) * strafe * 0.8
	for u in game.units:
		if u == m or not u.alive or u.team != m.team:
			continue
		var o := Vector2(pos.x - u.global_position.x, pos.z - u.global_position.z)
		var ol := o.length()
		if ol < 24.0 and ol > 0.1:
			wish += o / ol * (1.0 - ol / 24.0) * 1.6
	if wish.length() > 0.05:
		m.c_move = wish.normalized()
	m.c_boost = dist > float(rng[1]) * 1.35 and m.thrust > 0.3
	if space:
		# hold a little above or below the target's level rather than exactly on it
		m.c_vert = clampf((tc.y + strafe * 14.0 - me.y) / 25.0, -1.0, 1.0)
	# pick the hand weapon that suits the range
	if m.w_r[1] != null and m.swap_t <= 0.0 and m.swap_want < 0:
		var pick: int = m.r_idx
		var best := -1.0
		for wi in 3:
			var hw = m.w_r[wi]
			if hw == null:
				continue
			var wr: float = hw.d["range"]
			var score := (1000.0 - wr) if dist < wr * 0.85 else wr * 0.001
			if score > best:
				best = score
				pick = wi
		if pick != m.r_idx:
			m.swap_want = pick
			m.swap_buf = 0.9
	dodge_t -= dt
	var dg: Array = cfg["dodge"]
	if dodge_t <= 0.0 and dist < 360.0 and m.thrust > 0.45 and m.state == "normal":
		dodge_t = randf_range(float(dg[0]), float(dg[1]))
		m.c_quick_p = true
		m.c_move = Vector2(dirn.y, -dirn.x) * strafe
	_unstick(dt)
	# fire control
	var aligned := absf(U.ang_diff(aim_yaw, want_yaw)) < 0.14
	burst_t -= dt
	var bt: Array = cfg["burst"]
	if burst_t <= 0.0:
		burst_on = not burst_on
		burst_t = float(bt[0] if burst_on else bt[1]) * randf_range(0.7, 1.3)
	var w0 = m.weapons[0]
	if w0 != null and aligned and los_ok and dist < float(w0.d["range"]) * 0.95:
		if w0.is_charge:
			_hold(0, dt, float(w0.d["charge"]["t"]) * randf_range(0.7, 1.05), burst_on)
		elif burst_on:
			m.c_fire[0] = true
	var w1 = m.weapons[1]
	if w1 != null:
		heavy_t -= dt
		if w1.is_charge or w1.d.has("brace"):
			# charge / braced weapons need the trigger held: the frame plants itself and fires
			if aligned and los_ok and dist < float(w1.d["range"]) * 0.9:
				var hold_for: float = float(w1.d.get("brace", 0.0)) + 0.3
				if w1.is_charge:
					hold_for += float(w1.d["charge"]["t"]) * 1.02
				_hold(1, dt, hold_for, heavy_t <= 0.0)
				if hold_t[1] <= 0.0 and heavy_t <= 0.0:
					heavy_t = randf_range(2.5, 5.0)
		elif heavy_t <= 0.0 and aligned and los_ok and dist < float(w1.d["range"]) * 0.9:
			m.c_fire[1] = true
			heavy_t = randf_range(1.5, 4.0)
	var w2 = m.weapons[2]
	if w2 != null:
		missile_t -= dt
		if missile_t <= 0.0 and los_ok and m.c_lock_t > float(w2.d.get("lock", 0.0)) + 0.2 and dist < float(w2.d["range"]):
			m.c_fire[2] = true
			missile_t = randf_range(7.0, 12.0)
	# left-arm weapon on its own key, and the under-barrel launcher
	var w3 = m.weapons[3]
	if w3 != null:
		aux_t -= dt
		if aux_t <= 0.0 and aligned and los_ok and dist < float(w3.d["range"]) * 0.9:
			m.c_fire[3] = true
			aux_t = randf_range(3.0, 6.0)
	var w4 = m.weapons[4]
	if w4 != null:
		sub_t -= dt
		if sub_t <= 0.0 and aligned and los_ok and dist < float(w4.d["range"]) * 0.9 and dist > 40.0:
			m.c_fire[4] = true
			sub_t = randf_range(4.0, 8.0)
	# aces take to the air now and then
	if cfg.has("air"):
		air_t -= dt
		if air_t <= 0.0:
			air_t = randf_range(5.0, 11.0)
			if randf() < float(cfg["air"]) and m.thrust > 0.6:
				if m.grounded:
					m.c_jump_p = true
				jump_hold = randf_range(1.0, 2.2)
	# melee
	melee_t -= dt
	var ml: Dictionary = m.melee
	if m.state == "melee":
		m.c_melee_p = randf() < 0.3
	elif dist < float(ml["lunge"]) * 0.8 and melee_t <= 0.0 and m.state == "normal" and absf(dd.y) < 10.0:
		if target.state == "stagger" or randf() < float(cfg["melee"]):
			m.c_melee_p = true
		melee_t = randf_range(1.5, 3.5)
