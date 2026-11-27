extends RefCounted
# Player input, soft lock-on and third-person camera.

const U = preload("res://scripts/u.gd")
const Cockpit = preload("res://scripts/cockpit.gd")

const HIDE_LAYER := 1 << 19      # the frame's own torso while the view is inside it
const PIT_LAYER := 1 << 18       # cockpit furniture: only drawn in the cockpit view

var game
var m
var cam: Camera3D
var yaw := 0.0
var pitch := 0.05
var pivot := Vector3.ZERO
var trauma := 0.0
var lock = null
var lock_grace := 0.0
var no_lock := false          # the player released the lock: no automatic lock until the target key is pressed
var _tgt_hold := 0.0
var prev := {}
var tap := {}
var auto := {}
var cam_dist := 40.0     # camera sits this far behind the pivot ...
var cam_up := 8.0        # ... and the pivot this far above the frame's head, so the
                         # frame fills the lower part of the picture and the reticle stays clear
var fov_base := 70.0
var mouse := Vector2.ZERO
var sens := 0.0021
var lock_range := 720.0
var taps := {}
var cockpit := false
var seat_k := Vector2(0.8, 0.6)    # the seat in the chest: height as a share of the frame, metres ahead of the spine
var _seat_off := Vector3.ZERO      # where the seat is relative to the frame's origin, following the torso
var pit: Node3D
var look := Vector2.ZERO          # free look: head turned away from the aim (yaw, pitch)
var look_on := false
var glitch := 0.0
var _aim_rate := Vector2.ZERO


func _init(g, mech, camera: Camera3D) -> void:
	game = g
	m = mech
	cam = camera
	yaw = m.yaw
	cam_dist = g.cam_dist
	fov_base = g.fov_base
	cam_up = 3.0 + cam_dist * 0.13
	pivot = m.global_position + Vector3(0, m.hit_h + cam_up, 0)


# Gamepad (Xbox layout). Sticks and triggers are read in tick() / _pad().
const PAD_BTN := {"jump": JOY_BUTTON_A, "quick": JOY_BUTTON_B, "melee": JOY_BUTTON_X, "swap": JOY_BUTTON_Y,
	"boost": JOY_BUTTON_LEFT_SHOULDER, "fire2": JOY_BUTTON_RIGHT_SHOULDER, "descend": JOY_BUTTON_LEFT_STICK,
	"target": JOY_BUTTON_RIGHT_STICK, "od": JOY_BUTTON_DPAD_UP, "repair": JOY_BUTTON_DPAD_DOWN,
	"fire3": JOY_BUTTON_DPAD_LEFT, "fire4": JOY_BUTTON_DPAD_RIGHT}
const PAD_YAW := 2.7        # rad/s at full tilt, before the look-speed option
const PAD_PITCH := 1.7
var _pad_aim := Vector2.ZERO


func key(n: String) -> bool:
	if auto.has(n):
		return auto[n]
	return _kb(n) or _pad(n)


func _pad(n: String) -> bool:
	var id: int = game.pad_id
	if PAD_BTN.has(n):
		return Input.is_joy_button_pressed(id, PAD_BTN[n])
	match n:
		"fire0":
			return Input.get_joy_axis(id, JOY_AXIS_TRIGGER_RIGHT) > 0.35
		"fire1":
			return Input.get_joy_axis(id, JOY_AXIS_TRIGGER_LEFT) > 0.35
		"look":
			return game.pad_look()
	return false


# a stick with a round dead zone, rescaled so it starts from zero at its edge
func _stick(ax: int, ay: int) -> Vector2:
	var v := Vector2(Input.get_joy_axis(game.pad_id, ax), Input.get_joy_axis(game.pad_id, ay))
	var l := v.length()
	if l < 0.2:
		return Vector2.ZERO
	return v / l * minf((l - 0.2) / 0.75, 1.0)


func rumble(weak: float, strong: float, sec: float) -> void:
	if game.pad_mode and game.pad_rumble and not game.test_mode:
		Input.start_joy_vibration(game.pad_id, clampf(weak, 0.0, 1.0), clampf(strong, 0.0, 1.0), sec)


func _kb(n: String) -> bool:
	match n:
		"fwd":
			return Input.is_physical_key_pressed(KEY_W)
		"back":
			return Input.is_physical_key_pressed(KEY_S)
		"left":
			return Input.is_physical_key_pressed(KEY_A)
		"right":
			return Input.is_physical_key_pressed(KEY_D)
		"boost":
			return Input.is_physical_key_pressed(KEY_SPACE)
		"jump":
			return Input.is_physical_key_pressed(KEY_SHIFT)
		"unlock":
			return Input.is_physical_key_pressed(KEY_Z)
		"quick":
			return Input.is_physical_key_pressed(KEY_Q)
		"melee":
			return Input.is_physical_key_pressed(KEY_F) or Input.is_mouse_button_pressed(MOUSE_BUTTON_MIDDLE)
		"fire0":
			return Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT)
		"fire1":
			return Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT)
		"fire2":
			return Input.is_physical_key_pressed(KEY_E)
		"fire3":
			return Input.is_physical_key_pressed(KEY_G)
		"fire4":
			return Input.is_physical_key_pressed(KEY_B)
		"repair":
			return Input.is_physical_key_pressed(KEY_R)
		"target":
			return Input.is_physical_key_pressed(KEY_T)
		"swap":
			return Input.is_physical_key_pressed(KEY_X)
		"od":
			return Input.is_physical_key_pressed(KEY_V)
		"descend":
			return Input.is_physical_key_pressed(KEY_C) or Input.is_physical_key_pressed(KEY_CTRL)
		"look":
			return Input.is_physical_key_pressed(KEY_ALT)
	return false


# a key / button / wheel event seen by _input: counts as a press even if it began and
# ended between two frames (polling alone drops short taps at low frame rates)
func push(n: String) -> void:
	taps[n] = true


func pressed(n: String) -> bool:
	var now := key(n)
	var was: bool = prev.get(n, false)
	prev[n] = now
	if taps.has(n):
		taps.erase(n)
		return true
	return now and not was


# switch between the chase camera and the cockpit
func set_cockpit(on: bool) -> void:
	cockpit = on
	if pit == null:
		pit = Cockpit.new()
		game.add_child(pit)
		pit.build()
		pit.make_wall(cam)
	pit.visible = on
	m.model.set_cockpit(on, HIDE_LAYER, PIT_LAYER)
	var base: int = 0xFFFFF & ~HIDE_LAYER & ~PIT_LAYER & ~(1 << 17)       # 17: the cabin's reflection surround
	cam.cull_mask = (base | PIT_LAYER) if on else (base | HIDE_LAYER)
	cam.near = 0.12 if on else 0.3


func leave() -> void:
	if cockpit:
		set_cockpit(false)
	if pit != null:
		pit.queue_free()
		pit = null


func hit(amount: float) -> void:
	glitch = minf(1.0, glitch + clampf(amount, 0.15, 0.8))
	rumble(0.25 + amount * 0.5, amount, 0.15 + 0.25 * amount)
	if pit != null and cockpit:
		pit.hit(amount)


# where the pilot is looking: the aim direction turned by the free look
func view_vec() -> Vector3:
	var y := yaw + look.x
	var p := clampf(pitch + look.y, -1.45, 1.45)
	var cp := cos(p)
	return Vector3(-sin(y) * cp, sin(p), -cos(y) * cp)


func aim_vec() -> Vector3:
	var cp := cos(pitch)
	return Vector3(-sin(yaw) * cp, sin(pitch), -cos(yaw) * cp)


func tick(dt: float) -> void:
	var space: bool = game.world.space
	# right stick: turns the view like the mouse does. The response is fine near the centre and
	# fast at the rim, and eases in so a flick does not jerk the picture.
	var rs := _stick(JOY_AXIS_RIGHT_X, JOY_AXIS_RIGHT_Y)
	var rl := rs.length()
	var want_aim := Vector2.ZERO
	if rl > 0.0:
		want_aim = rs / rl * (rl * rl * 0.75 + rl * 0.25)
	_pad_aim = _pad_aim.lerp(want_aim, 1.0 - exp(-(14.0 if rl > 0.0 else 24.0) * dt))
	if _pad_aim.length() > 0.002:
		mouse += Vector2(_pad_aim.x * PAD_YAW, _pad_aim.y * PAD_PITCH * (-1.0 if game.pad_inv else 1.0)) * (game.pad_sens * dt / maxf(sens, 0.0001))
	# free look (hold ALT / hold the pad's view button): the head turns, the aim stays where it was
	look_on = key("look")
	_aim_rate = _aim_rate.lerp(Vector2.ZERO if look_on else mouse * 0.02, 0.3)
	if look_on:
		look.x = clampf(look.x - mouse.x * sens, -2.9, 2.9)
		look.y = clampf(look.y - mouse.y * sens, -1.3, 1.3)
	else:
		look = look.lerp(Vector2.ZERO, 1.0 - exp(-10.0 * dt))
		yaw -= mouse.x * sens
		pitch = clampf(pitch - mouse.y * sens, -1.3 if space else -0.75, 1.3 if space else 1.25)
	glitch = maxf(0.0, glitch - dt * 2.2)
	mouse = Vector2.ZERO
	if auto.has("yaw"):
		yaw = auto["yaw"]
	if auto.has("pitch"):
		pitch = auto["pitch"]
	var f := Vector3(-sin(yaw), 0, -cos(yaw))
	var r := Vector3(cos(yaw), 0, -sin(yaw))
	var mx := float(key("right")) - float(key("left"))
	var mz := float(key("fwd")) - float(key("back"))
	if not auto.has("fwd"):
		var ls := _stick(JOY_AXIS_LEFT_X, JOY_AXIS_LEFT_Y)
		mx = clampf(mx + ls.x, -1.0, 1.0)
		mz = clampf(mz - ls.y, -1.0, 1.0)
	var mv := f * mz + r * mx
	m.c_move = Vector2(mv.x, mv.z)
	m.c_boost = key("boost")
	m.c_jump = key("jump")
	m.c_jump_p = pressed("jump")
	var dbl := false
	var now := Time.get_ticks_msec()
	for k in (["fwd", "back", "left", "right", "jump", "descend"] if space else ["fwd", "back", "left", "right"]):
		var down := key(k)
		var was: bool = prev.get("d_" + k, false)
		prev["d_" + k] = down
		if down and not was:
			if now - int(tap.get(k, -9999)) < 260:
				dbl = true
			tap[k] = now
	m.c_quick_p = pressed("quick") or dbl
	m.c_fire = [key("fire0"), key("fire1"), key("fire2"), key("fire3"), key("fire4")]
	m.c_melee_p = pressed("melee")
	m.c_swap_p = pressed("swap")
	m.c_swap_dir = -1 if pressed("swap_up") else (1 if pressed("swap_dn") else 0)
	m.c_melee = key("melee")
	m.c_od_p = pressed("od")
	m.c_descend = key("descend")
	m.c_vert = 0.0
	if space:
		# zero-g: SHIFT / CTRL (pad: A / L3) are straight up / down, SPACE (LB) is the sustained boost,
		# the same keys as on the ground
		m.c_vert = float(key("jump")) - float(key("descend"))
		m.c_jump = false
		m.c_jump_p = false
		m.c_descend = false
	if pressed("repair"):
		if m.repair():
			game.on_repair()
	var t_tap := pressed("target")
	_tgt_hold = _tgt_hold + dt if key("target") else 0.0
	if pressed("unlock") or (_tgt_hold > 0.45 and not no_lock):
		# let go of the target and aim freely until the target key is pressed again
		if lock != null or not no_lock:
			game.sfx.play2d("click", 0.5)
		no_lock = true
		lock = null
		lock_grace = 0.0
	elif t_tap:
		no_lock = false
	_update_lock(dt, t_tap)
	# aim point under the reticle
	var d := aim_vec()
	var from := cam.global_position + d * (cam_dist + 6.0)
	if cockpit:
		from = m.global_position + Vector3(0, m.hit_h * 0.93, 0) + d * 6.0
	var to := cam.global_position + d * 1000.0
	var res: Dictionary = game.ray(from, to, 3, [m.get_rid()])
	var ap: Vector3 = res["position"] if not res.is_empty() else to
	m.c_aim_point = ap
	var c: Vector3 = m.center()
	var tgt: Vector3 = lock.center() if lock != null else ap
	var dd := tgt - c
	if Vector2(dd.x, dd.z).length() > 12.0:
		m.c_aim_yaw = atan2(-dd.x, -dd.z)
		m.c_aim_pitch = clampf(atan2(dd.y, Vector2(dd.x, dd.z).length()), -1.4 if game.world.space else -0.8, 1.4)
	else:
		m.c_aim_yaw = yaw
		m.c_aim_pitch = pitch


func _screen_off(p: Vector3) -> Vector2:
	var vs := cam.get_viewport().get_visible_rect().size
	var sp := cam.unproject_position(p)
	return Vector2((sp.x - vs.x * 0.5) / (vs.y * 0.5), (sp.y - vs.y * 0.5) / (vs.y * 0.5))


# Line of sight for the lock. Clear, or blocked only right at the target: a turret, bridge or engine
# sits in its own ship's hull and a frame may stand hull-down behind a ridge, and both are still
# plainly there to be locked.
func _sees(u, c: Vector3) -> bool:
	var near := float(u.radius) * 1.6 + 5.0
	if "anchor" in u:
		near = float(u.radius) * 2.5 + 10.0
	if _los_to(c, c, near):
		return true
	# Something thin across the middle of the target does not hide it: a dock post, a spar, one of the
	# ship's own tusks. Its rim is tried as well, left, right, above and below as the camera sees it.
	var rr := float(u.radius) * 0.75
	if rr < 2.0:
		return false
	var cb: Basis = cam.global_transform.basis
	for o: Vector3 in [cb.x, -cb.x, cb.y, -cb.y]:
		if _los_to(c + o * rr, c, near):
			return true
	return false


func _los_to(p: Vector3, c: Vector3, near: float) -> bool:
	var r: Dictionary = game.ray(pivot, p, 1, [])
	return r.is_empty() or (r["position"] as Vector3).distance_to(c) < near


func _update_lock(dt: float, cycle: bool) -> void:
	var best = null
	var best_s := 99.0
	var cur_ok := false
	for u in game.units:
		if not u.alive or u.team == m.team or u.hidden:
			continue
		var c: Vector3 = u.center()
		var dist := c.distance_to(m.global_position)
		# a warship is hundreds of metres long and looks near from far off: its parts can be locked from further out
		if dist > lock_range * (1.8 if "anchor" in u else 1.0) or cam.is_position_behind(c):
			continue
		var off := _screen_off(c)
		if u == lock:
			if absf(off.x) < 0.9 and absf(off.y) < 0.8:
				if _sees(u, c):
					cur_ok = true
					lock_grace = 0.7
			if cycle:
				continue
		if absf(off.x) > 0.42 or absf(off.y) > 0.42:
			continue
		var s := off.length() + dist / 3000.0
		if s < best_s and _sees(u, c):
			best_s = s
			best = u
	if lock != null and not cur_ok:
		lock_grace -= dt
		if lock_grace <= 0.0 or not lock.alive:
			lock = null
	if cycle and best != null:
		lock = best
		m.c_lock_t = 0.0
		lock_grace = 0.7
	elif lock == null and best != null and not no_lock:
		lock = best
		m.c_lock_t = 0.0
		lock_grace = 0.7
		game.sfx.play2d("lock", 0.5)
	m.c_lock = lock
	if lock != null:
		m.c_lock_t += dt
	else:
		m.c_lock_t = 0.0


func _cam_cockpit(dt: float) -> void:
	# The seat is in the chest. Cameras all over the hull are stitched into the picture on the
	# monitor sphere, so the view is the pilot's own, from the seat, through the frame's body
	# (which the monitor only outlines: mech_model.set_cockpit).
	var d := aim_vec()
	var v := view_vec()
	var ah := Vector3(d.x, 0, d.z)
	ah = ah.normalized() if ah.length() > 0.01 else Vector3(-sin(m.yaw), 0, -cos(m.yaw))
	var seat: Vector3 = m.global_position + Vector3(0, m.hit_h * seat_k.x, 0) + ah * seat_k.y
	if m.model != null and m.model.waist != null and m.model.head != null:
		# ... and the chest moves: it pitches forward in a boost, drops in a crouch, swings in
		# a melee. The seat follows the torso joint, so the body never slides out in front of it.
		var wp: Vector3 = (m.model.waist as Node3D).global_position
		var hp: Vector3 = (m.model.head as Node3D).global_position
		var tgt: Vector3 = wp.lerp(hp, 0.72) + ah * seat_k.y - m.global_position
		_seat_off = tgt if _seat_off == Vector3.ZERO else _seat_off.lerp(tgt, 1.0 - exp(-18.0 * dt))
		seat = m.global_position + _seat_off
	trauma = maxf(0.0, trauma - dt * 1.7)
	var s := trauma * trauma
	var off := Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * s * 0.5
	cam.global_position = seat + off
	cam.look_at(seat + off + v * 100.0, Vector3.UP)
	cam.rotate_object_local(Vector3(0, 0, 1), randf_range(-1, 1) * s * 0.04)
	# the cockpit follows the aim (not the free look); it is scaled up so its furniture
	# sits beyond the frame's own arms and weapon
	# The cabin turns with the heading only: looking up or down moves the eye, not the instrument
	# panel, the consoles or the monitor wall
	var up := Vector3.UP
	var dh := Vector3(d.x, 0.0, d.z)
	if dh.length() < 0.001:
		dh = -pit.global_transform.basis.z
	dh = dh.normalized()
	var bx := up.cross(-dh).normalized()
	var pb := Basis(bx, up, -dh)
	pit.global_transform = Transform3D(pb, seat + off + pb * pit.offset())
	var mv := Vector2(float(key("right")) - float(key("left")), float(key("fwd")) - float(key("back")))
	pit.drive(dt, game, m, self)
	cam.fov = U.damp(cam.fov, fov_base + 16.0 + (4.0 if m.od_on else 0.0), 5.0, dt)


func cam_update(dt: float) -> void:
	if cockpit and not auto.has("cam"):
		_cam_cockpit(dt)
		return
	var tp: Vector3 = m.global_position + Vector3(0, m.hit_h + cam_up, 0)
	var k := 1.0 - exp(-13.0 * dt)
	pivot = Vector3(lerpf(pivot.x, tp.x, k), lerpf(pivot.y, tp.y, 1.0 - exp(-8.0 * dt)), lerpf(pivot.z, tp.z, k))
	var d := view_vec()
	var want := pivot - d * cam_dist
	var res: Dictionary = game.ray(pivot, want, 1, [])
	if not res.is_empty():
		var hp: Vector3 = res["position"]
		want = hp + d * 1.5
	trauma = maxf(0.0, trauma - dt * 1.7)
	var s := trauma * trauma
	var off := Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * s * 1.5
	cam.global_position = want + off
	cam.look_at(want + off + d * 100.0, Vector3.UP)
	cam.rotate_object_local(Vector3(0, 0, 1), randf_range(-1, 1) * s * 0.03)
	if auto.has("cam"):
		# fixed inspection views for the autotest
		var c: Vector3 = m.global_position + Vector3(0, 9.5, 0)
		var f := Vector3(-sin(m.yaw), 0, -cos(m.yaw))
		var r := Vector3(cos(m.yaw), 0, -sin(m.yaw))
		var view: String = auto["cam"]
		if view == "side":
			cam.global_position = c + r * 30.0 - f * 6.0 + Vector3(0, -2.0, 0)
		elif view == "front":
			cam.global_position = c + f * 30.0 + r * 8.0
		elif view == "left":
			cam.global_position = c - r * 34.0 + f * 10.0 + Vector3(0, -1.0, 0)
		elif view == "lf":
			cam.global_position = c - r * 22.0 + f * 30.0 + Vector3(0, 1.0, 0)
		else:
			cam.global_position = c - f * 30.0 + r * 12.0 + Vector3(0, 2.0, 0)
		cam.look_at(c, Vector3.UP)
	var hs := Vector2(m.velocity.x, m.velocity.z).length()
	cam.fov = U.damp(cam.fov, fov_base + clampf(hs / 70.0, 0.0, 1.0) * 10.0 + (4.0 if m.od_on else 0.0) + (3.0 if m.ascending else 0.0), 5.0, dt)
