extends "res://scripts/unit.gd"
# A destructible part of a warship (main turret / point-defence gun / engine / bridge) that
# follows an anchor node on the hull, or a free-standing gun platform bolted to an asteroid.
# Each part is its own unit: it can be locked, shot and destroyed on its own.

const MeshKit = preload("res://scripts/mesh_kit.gd")
const Tex = preload("res://scripts/tex.gd")
const FX = preload("res://scripts/fx.gd")
const Weapon = preload("res://scripts/weapon.gd")
const U = preload("res://scripts/u.gd")

const HZ := PI * 0.5

# same keys as Defs.WEAPONS
const WEAPONS := {
	"cr_main": {"name": "280mm 联装舰炮", "tag": "NAVAL-280", "kind": "shell", "dmg": 380.0, "impact": 90.0, "rof": 1.6, "mag": 2, "reload": 7.5, "speed": 340.0, "range": 1150.0, "spread": 0.006, "splash": 12.0, "sfx": "cannon_big", "tracer": Color(1.6, 3.0, 4.6)},
	"cr_pd": {"name": "近防机炮", "tag": "CIWS-30", "kind": "bullet", "dmg": 26.0, "impact": 2.5, "rof": 9.0, "mag": 36, "reload": 2.6, "speed": 620.0, "range": 560.0, "spread": 0.022, "sfx": "smg", "tracer": Color(1.4, 2.6, 4.0)},
	"bb_main": {"name": "三联装重炮", "tag": "E-HVY-320", "kind": "shell", "dmg": 400.0, "impact": 100.0, "rof": 1.4, "mag": 3, "reload": 10.0, "speed": 320.0, "range": 1200.0, "spread": 0.007, "splash": 13.0, "sfx": "cannon_big", "tracer": Color(4.6, 1.5, 0.45)},
	"bb_beam": {"name": "舰载熔切炮", "tag": "E-LANCE-S", "kind": "beam", "dmg": 160.0, "impact": 20.0, "rof": 1.0, "mag": 1, "reload": 7.0, "speed": 9999.0, "range": 1000.0, "spread": 0.0, "heat": 3.2, "sfx": "beam"},
	"fr_main": {"name": "联装舰炮", "tag": "E-MED-200", "kind": "shell", "dmg": 300.0, "impact": 80.0, "rof": 1.5, "mag": 2, "reload": 8.0, "speed": 320.0, "range": 1000.0, "spread": 0.008, "splash": 11.0, "sfx": "cannon", "tracer": Color(4.6, 1.5, 0.45)},
	"bb_pd": {"name": "点防御炮", "tag": "E-PD", "kind": "bullet", "dmg": 30.0, "impact": 3.0, "rof": 8.0, "mag": 30, "reload": 3.0, "speed": 560.0, "range": 560.0, "spread": 0.028, "sfx": "rifle"},
	"plat_gun": {"name": "炮台机炮", "tag": "E-PLT", "kind": "bullet", "dmg": 64.0, "impact": 6.0, "rof": 4.5, "mag": 14, "reload": 3.4, "speed": 500.0, "range": 600.0, "spread": 0.02, "sfx": "rifle"},
}

var ship = null             # owning warship; null for a platform
var anchor: Node3D          # hull node this part follows (the turret mount)
var off := Vector3.ZERO     # part centre in anchor space
var ctr := Vector3.ZERO     # centre offset from the unit origin (platforms)
var fixed := false
var index := 1
var yaw_n: Node3D
var pitch_n: Node3D
var muz: Array = []
var mi := 0
var weapon
var target = null
var missile = null          # hostile missile a point-defence gun is tracking
var bombard = null          # enemy warship whose hull shields every part this gun could shoot at
var bombard_at := Vector3.ZERO
var kill_t := 0.0
var think_t := 0.0
var burst_t := 0.0
var pause_t := 0.0
var clear_t := 0.0
var clear_ok := true
var armed := true
var only_ships := false
var mech_k := 1.6
var rng_max := 600.0
var t_yaw := 0.0
var t_pitch := 0.0
var want_yaw := 0.0
var want_pitch := 0.0
var yaw_rate := 0.5
var pitch_rate := 0.4
var pitch_min := -0.06
var pitch_max := 1.35
var pivot_h := 4.0
var tol := 0.06
var kick := 2.2
var recoil := 0.0
var pitch_rest := Vector3.ZERO
var meshes: Array = []
var pm: MeshInstance3D
var plume_r := 8.0
var plume_l := 40.0
var lamp: OmniLight3D
var dead_t := 0.0
var fx_t := 0.0
var flash_col := Color(1.0, 0.7, 0.4)
var shell_w := 1.6
var shell_l := 20.0
var _dt := 0.016
var _t := 0.0


# ------------------------------------------------------------------ materials / models
static var _plate: ShaderMaterial


static func make_mats(style: String, glow: Material) -> Dictionary:
	# hull plating with ship sized plates instead of the frame sized seam grid
	if _plate == null:
		_plate = Tex.plating.duplicate() as ShaderMaterial
		_plate.set_shader_parameter("tile", 24.0)
		_plate.set_shader_parameter("seam_dark", 0.36)
	var pl := _plate
	var am := Tex.armor
	if style == "fed":
		return {
			"A": {"mat": pl, "params": {"tint": Color(0.40, 0.42, 0.46), "metal": 0.35, "wear": 0.55}},
			"B": {"mat": pl, "params": {"tint": Color(0.2, 0.235, 0.3), "metal": 0.4, "wear": 0.7}},
			"C": {"mat": am, "params": {"tint": Color(0.1, 0.25, 0.55), "metal": 0.3}},
			"T": {"mat": am, "params": {"tint": Color(0.5, 0.52, 0.55), "metal": 0.4}},
			"F": {"mat": am, "params": {"tint": Color(0.09, 0.095, 0.105), "metal": 0.7}},
			"H": {"mat": am, "params": {"tint": Color(0.7, 0.5, 0.06), "metal": 0.2, "stripes": 1.0}},
			"G": {"mat": glow},
		}
	return {
		"A": {"mat": pl, "params": {"tint": Color(0.34, 0.12, 0.085), "metal": 0.3, "wear": 1.2}},
		"B": {"mat": pl, "params": {"tint": Color(0.115, 0.09, 0.085), "metal": 0.4, "wear": 1.2}},
		"C": {"mat": am, "params": {"tint": Color(0.62, 0.48, 0.25), "metal": 0.25}},
		"T": {"mat": am, "params": {"tint": Color(0.27, 0.1, 0.075), "metal": 0.4}},
		"F": {"mat": am, "params": {"tint": Color(0.07, 0.065, 0.065), "metal": 0.7}},
		"H": {"mat": am, "params": {"tint": Color(0.62, 0.48, 0.25), "metal": 0.2, "stripes": 1.0}},
		"G": {"mat": glow},
	}


static func _marker(parent: Node3D, pos: Vector3) -> Node3D:
	var m := Node3D.new()
	m.position = pos
	parent.add_child(m)
	return m


static func _st(z: float, hw: float, hh: float, dk: float, kk: float, uk: float, lk: float, y: float, sc: float) -> Array:
	return [z * sc, hw * sc, hh * sc, dk, kk, uk, lk, y * sc]


# main turret on `mount` (mount +Y = out of the hull, -Z = rest direction).
# Returns {"yaw", "pitch", "muz": [Node3D], "pivot": float}
#   fed: a wedge gunhouse lofted in eight-sided sections (sloped face, widest behind the trunnions, a
#        drawn-in bustle), rangefinder arms across the roof, a cupola, the ship's blue line on its cheeks
#   foe: overlapping carapace shells over a brow with a lit slit, gill fins, horns
# The guns swing on a trunnion drum; every barrel has a sleeve at its root and a muzzle fitting.
static func build_turret(k, mount: Node3D, style: String, barrels: int, sc: float, beam: bool) -> Dictionary:
	var yaw: Node3D = k.bone(mount)
	var res := {"yaw": yaw, "muz": [], "pivot": 4.2 * sc}
	if style == "fed":
		k.cyl(yaw, "B", 6.9 * sc, 7.6 * sc, 1.0 * sc, Vector3(0, 0.5 * sc, 0), Vector3.ZERO, 16, 0.8)
		k.cyl(yaw, "T", 6.3 * sc, 6.6 * sc, 0.9 * sc, Vector3(0, 1.4 * sc, 0), Vector3.ZERO, 16, 0.7)
		k.hull(yaw, "T", [_st(-6.8, 4.4, 1.9, 0.58, 1.0, 0.15, 1.0, 3.5, sc), _st(-3.0, 6.3, 2.9, 0.62, 1.0, 0.3, 1.0, 4.5, sc),
			_st(3.6, 6.6, 3.2, 0.62, 1.0, 0.3, 1.0, 4.8, sc), _st(8.8, 4.6, 2.3, 0.6, 1.0, 0.3, 1.0, 4.0, sc)])
		# roof plate, rangefinder arms with their heads, cupola
		k.hull(yaw, "B", [_st(-2.4, 3.9, 0.28, 0.9, 0.9, 0.5, 0.5, 7.75, sc), _st(3.4, 4.1, 0.28, 0.9, 0.9, 0.5, 0.5, 8.05, sc)], Vector3.ZERO, 0.9)
		k.cyl(yaw, "T", 0.85 * sc, 0.85 * sc, 16.4 * sc, Vector3(0, 6.6 * sc, 5.2 * sc), Vector3(0, 0, HZ), 8, 0.85)
		for sx: float in [-1.0, 1.0]:
			k.cyl(yaw, "B", 1.25 * sc, 1.25 * sc, 1.6 * sc, Vector3(sx * 8.4 * sc, 6.6 * sc, 5.2 * sc), Vector3(0, 0, HZ), 8, 0.8)
			k.box(yaw, "C", Vector3(0.4, 1.3, 7.0) * sc, Vector3(sx * 6.65 * sc, 4.6 * sc, 0.6 * sc))
		k.cyl(yaw, "T", 1.5 * sc, 1.8 * sc, 1.0 * sc, Vector3(2.2 * sc, 8.5 * sc, 2.6 * sc), Vector3.ZERO, 10, 0.8)
		k.ball(yaw, "B", Vector3(1.5, 0.9, 1.5) * sc, Vector3(2.2 * sc, 9.0 * sc, 2.6 * sc))
		k.box(yaw, "G", Vector3(0.4, 0.4, 0.4) * sc, Vector3(-3.0 * sc, 8.3 * sc, 6.0 * sc))
	else:
		k.cyl(yaw, "B", 7.2 * sc, 8.0 * sc, 1.2 * sc, Vector3(0, 0.6 * sc, 0), Vector3.ZERO, 14, 0.8)
		k.ball(yaw, "T", Vector3(7.8, 5.4, 8.8) * sc, Vector3(0, 3.4 * sc, 1.0 * sc))
		k.ball(yaw, "A", Vector3(6.4, 4.6, 6.2) * sc, Vector3(0, 4.9 * sc, 3.6 * sc))
		k.ball(yaw, "T", Vector3(5.6, 2.0, 3.4) * sc, Vector3(0, 6.0 * sc, -4.4 * sc), Vector3(0.28, 0, 0))            # brow
		k.box(yaw, "G", Vector3(5.2, 0.55, 0.9) * sc, Vector3(0, 4.9 * sc, -7.3 * sc))
		for sx: float in [-1.0, 1.0]:
			k.cyl(yaw, "C", 0.0, 1.3 * sc, 8.0 * sc, Vector3(sx * 3.6, 9.6, 5.0) * sc, Vector3(0.55, 0, -sx * 0.3), 6, 1.1)
			for g in 3:
				k.box(yaw, "A", Vector3(0.7, 3.4 - g * 0.5, 4.2) * sc, Vector3(sx * (7.2 - g * 0.5), 3.4 + g * 0.3, -0.5 + g * 3.0) * sc, Vector3(0, -sx * 0.3, sx * 0.35),
					{"tz": 0.5, "sz": 1.4 * sc})
		k.cyl(yaw, "C", 0.0, 1.0 * sc, 5.0 * sc, Vector3(0, 10.4, 2.4) * sc, Vector3(0.2, 0, 0), 6, 1.1)
	var pitch: Node3D = k.bone(yaw, Vector3(0, 4.2 * sc, -4.4 * sc))
	res["pitch"] = pitch
	if beam:
		k.cyl(pitch, "F", 2.9 * sc, 2.9 * sc, 5.4 * sc, Vector3.ZERO, Vector3(0, 0, HZ), 10, 0.9)
		k.cyl(pitch, "F", 2.8 * sc, 2.0 * sc, 14.0 * sc, Vector3(0, 0, -7.0 * sc), Vector3(HZ, 0, 0), 10)
		for j in 3:
			k.cyl(pitch, "F", 3.0 * sc, 3.0 * sc, 0.9 * sc, Vector3(0, 0, (-3.0 - j * 3.6) * sc), Vector3(HZ, 0, 0), 10, 0.7)
		k.cyl(pitch, "G", 1.7 * sc, 1.7 * sc, 0.6 * sc, Vector3(0, 0, -14.2 * sc), Vector3(HZ, 0, 0), 10)
		k.box(pitch, "G", Vector3(0.5, 0.5, 9.0) * sc, Vector3(0, 2.9 * sc, -7.0 * sc))
		# three focusing prongs round the emitter
		for j in 3:
			var pa := HZ + float(j) * TAU / 3.0
			var pv := Vector3(cos(pa), sin(pa), 0)
			k.cyl(pitch, "C", 0.0, 0.7 * sc, 6.0 * sc, pv * (2.6 * sc) + Vector3(0, 0, -15.0 * sc), Vector3(-HZ, 0, 0), 5, 1.1)
		(res["muz"] as Array).append(_marker(pitch, Vector3(0, 0, -15.0 * sc)))
	else:
		var gap := 3.3 * sc
		var fed: bool = style == "fed"
		k.cyl(pitch, "F", 2.2 * sc, 2.2 * sc, gap * (barrels - 1) + 4.2 * sc, Vector3(0, 0, -0.6 * sc), Vector3(0, 0, HZ), 10, 0.9)
		for i in barrels:
			var x := (float(i) - float(barrels - 1) * 0.5) * gap
			k.cyl(pitch, "T" if fed else "A", 1.75 * sc, 1.5 * sc, 5.0 * sc, Vector3(x, 0, -4.4 * sc), Vector3(HZ, 0, 0), 10, 0.85)          # sleeve
			k.cyl(pitch, "F", 1.15 * sc, 0.92 * sc, 13.5 * sc, Vector3(x, 0, -12.6 * sc), Vector3(HZ, 0, 0), 10)
			k.cyl(pitch, "F", 1.35 * sc, 1.35 * sc, 0.7 * sc, Vector3(x, 0, -9.6 * sc), Vector3(HZ, 0, 0), 10, 0.75)
			if fed:
				# slotted muzzle brake: two collars
				k.cyl(pitch, "F", 1.5 * sc, 1.5 * sc, 1.0 * sc, Vector3(x, 0, -18.2 * sc), Vector3(HZ, 0, 0), 10, 0.7)
				k.cyl(pitch, "F", 1.5 * sc, 1.5 * sc, 1.0 * sc, Vector3(x, 0, -19.8 * sc), Vector3(HZ, 0, 0), 10, 0.7)
			else:
				# flared mouth
				k.cyl(pitch, "C", 1.0 * sc, 1.9 * sc, 2.6 * sc, Vector3(x, 0, -19.1 * sc), Vector3(HZ, 0, 0), 8, 1.0)
			(res["muz"] as Array).append(_marker(pitch, Vector3(x, 0, -20.4 * sc)))
	return res


# point-defence mount: one mesh that yaws and pitches. Returns {"yaw", "pitch", "muz", "pivot"}
static func build_pd(k, mount: Node3D, style: String, sc: float) -> Dictionary:
	var yaw := Node3D.new()
	mount.add_child(yaw)
	var pitch: Node3D = k.bone(yaw, Vector3(0, 2.2 * sc, 0))
	if style == "fed":
		# a small faired pod with a sensor dome on its shoulder
		k.hull(pitch, "T", [_st(-2.9, 1.5, 1.2, 0.6, 0.8, 0.3, 0.6, 0.0, sc), _st(-1.0, 2.3, 1.9, 0.62, 0.8, 0.35, 0.6, 0.0, sc), _st(1.6, 2.3, 1.9, 0.62, 0.8, 0.35, 0.6, 0.0, sc),
			_st(3.0, 1.5, 1.3, 0.6, 0.8, 0.3, 0.6, 0.0, sc)])
		k.ball(pitch, "B", Vector3(0.95, 0.95, 0.95) * sc, Vector3(1.2, 2.0, 0.8) * sc)
		k.box(pitch, "C", Vector3(0.3, 0.7, 2.6) * sc, Vector3(-2.35, 0.3, 0.2) * sc)
	else:
		k.ball(pitch, "T", Vector3(2.6, 2.3, 2.9) * sc)
		k.ball(pitch, "A", Vector3(2.0, 1.5, 1.9) * sc, Vector3(0, 1.3, 1.0) * sc)
		k.box(pitch, "G", Vector3(1.8, 0.3, 0.5) * sc, Vector3(0, 0.9, -2.5) * sc)
		k.cyl(pitch, "C", 0.0, 0.6 * sc, 3.0 * sc, Vector3(0, 3.4, 1.4) * sc, Vector3(0.4, 0, 0), 6, 1.1)
	var muz: Array = []
	for sx: float in [-1.0, 1.0]:
		k.cyl(pitch, "F", 0.62 * sc, 0.55 * sc, 2.4 * sc, Vector3(sx * 1.0, 0, -3.2) * sc, Vector3(HZ, 0, 0), 8, 0.8)
		k.cyl(pitch, "F", 0.4 * sc, 0.32 * sc, 4.4 * sc, Vector3(sx * 1.0, 0, -5.6) * sc, Vector3(HZ, 0, 0), 6, 0.6)
		muz.append(_marker(pitch, Vector3(sx * 1.0, 0, -7.8) * sc))
	return {"yaw": yaw, "pitch": pitch, "muz": muz, "pivot": 2.2 * sc}


# ------------------------------------------------------------------ setup
# c: anchor, off, ap, r, and for guns yaw / pitch / muz / pivot / wpn; for engines noz / plume
func setup_part(g, shp, kind_id: String, idx: int, c: Dictionary) -> void:
	game = g
	ship = shp
	team = shp.team
	kind = kind_id
	index = idx
	anchor = c["anchor"]
	off = c.get("off", Vector3.ZERO)
	meshes = c.get("meshes", [])
	ap_max = float(c["ap"])
	ap = ap_max
	radius = float(c.get("r", 10.0))
	hit_h = radius * 2.0
	airborne = true
	objective = kind == "bridge" or kind == "engine"
	callsign = str(shp.ship_name) if objective else ""
	var foe: bool = team != 0
	flash_col = Color(1.0, 0.55, 0.3) if foe else Color(0.6, 0.8, 1.0)
	match kind:
		"turret":
			unit_name = "主炮 %d" % idx
		"pd":
			unit_name = "点防御 %d" % idx
		"engine":
			unit_name = "引擎 %d" % idx
		_:
			unit_name = "舰桥"
	_shape(radius, Vector3.ZERO)
	if c.has("wpn"):
		weapon = Weapon.new(WEAPONS[c["wpn"]], "M")
		rng_max = float(weapon.d["range"])
		yaw_n = c["yaw"]
		pitch_n = c["pitch"]
		muz = c["muz"]
		pivot_h = float(c.get("pivot", 4.0))
		pitch_rest = pitch_n.position
		if kind == "turret":
			spread_mul = 1.0
			lead_k = 0.85
			yaw_rate = 0.42
			pitch_rate = 0.35
			tol = 0.05
			kick = 2.4
			only_ships = weapon.is_beam
			if str(c["wpn"]) == "fr_main":
				shell_w = 1.2
				shell_l = 16.0
		else:
			spread_mul = 1.25
			lead_k = 0.9
			yaw_rate = 2.4
			pitch_rate = 2.0
			tol = 0.14
			kick = 0.5
			pitch_min = -0.25
			pitch_max = 1.5
	if c.has("noz"):
		var noz: Node3D = c["noz"]
		var pl: Array = c.get("plume", [8.0, 40.0])
		plume_r = pl[0]
		plume_l = pl[1]
		pm = FX.plume(noz, plume_r, plume_l, 2)
		var tint := Color(1.0, 0.5, 0.2) if foe else Color(0.5, 0.72, 1.0)
		pm.set_instance_shader_parameter("tint", tint)
		lamp = OmniLight3D.new()
		lamp.light_color = tint
		lamp.light_energy = 10.0
		lamp.omni_range = 70.0
		lamp.omni_attenuation = 0.9
		lamp.shadow_enabled = false
		lamp.position = Vector3(0, -plume_r * 1.2, 0)
		noz.add_child(lamp)
	think_t = randf() * 1.2
	_follow()


# free-standing enemy gun platform; `up` = surface normal of the rock it sits on
func setup_platform(g, t: int, pos: Vector3, up: Vector3, idx: int = 1) -> void:
	game = g
	team = t
	kind = "platform"
	index = idx
	fixed = true
	unit_name = "浮游炮台 %d" % idx
	ap_max = 3200.0
	ap = ap_max
	radius = 7.0
	hit_h = 14.0
	airborne = true
	global_position = pos
	up = up.normalized() if up.length() > 0.01 else Vector3.UP
	var side := up.cross(Vector3.FORWARD if absf(up.z) < 0.9 else Vector3.RIGHT).normalized()
	var root := Node3D.new()
	root.basis = Basis(side, up, side.cross(up).normalized())
	add_child(root)
	anchor = root
	ctr = up * 6.0
	var glow := StandardMaterial3D.new()
	glow.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	glow.albedo_color = Color(1.0, 0.4, 0.1) * 2.4
	var mats := make_mats("foe" if t != 0 else "fed", glow)
	var k = MeshKit.new(11 + idx)
	k.dust = 0.0
	var base: Node3D = k.bone(root)
	k.cyl(base, "B", 5.2, 6.6, 2.4, Vector3(0, 0.6, 0), Vector3.ZERO, 10)
	k.cyl(base, "F", 2.4, 3.0, 3.6, Vector3(0, 3.4, 0), Vector3.ZERO, 10)
	for i in 3:
		var a := float(i) * TAU / 3.0 + 0.4
		k.box(base, "B", Vector3(2.2, 1.6, 9.0), Vector3(cos(a) * 7.0, -0.6, sin(a) * 7.0), Vector3(0.35, HZ - a, 0), {"tz": 0.6})
		k.cyl(base, "C", 0.0, 0.9, 5.0, Vector3(cos(a) * 11.0, -2.6, sin(a) * 11.0), Vector3(PI, 0, 0), 6)
	yaw_n = k.bone(base, Vector3(0, 5.2, 0))
	k.box(yaw_n, "T", Vector3(6.6, 4.4, 7.6), Vector3(0, 1.6, 0.6), Vector3.ZERO, {"tx": 0.76, "tz": 0.84})
	for sx: float in [-1.0, 1.0]:
		k.box(yaw_n, "B", Vector3(0.8, 5.4, 6.4), Vector3(sx * 3.9, 1.8, -0.6), Vector3(0, 0, -sx * 0.14))
		k.cyl(yaw_n, "C", 0.0, 0.6, 3.6, Vector3(sx * 2.4, 5.4, 2.6), Vector3(0.4, 0, 0), 6)
	k.box(yaw_n, "G", Vector3(2.6, 0.7, 0.4), Vector3(0, 2.6, -3.0))
	pitch_n = k.bone(yaw_n, Vector3(0, 1.2, -2.4))
	for sx: float in [-1.0, 1.0]:
		k.cyl(pitch_n, "F", 0.62, 0.5, 9.0, Vector3(sx * 1.2, 0, -4.6), Vector3(HZ, 0, 0), 8)
		k.cyl(pitch_n, "F", 0.8, 0.8, 1.4, Vector3(sx * 1.2, 0, -8.6), Vector3(HZ, 0, 0), 8, 0.7)
		muz.append(_marker(pitch_n, Vector3(sx * 1.2, 0, -9.6)))
	k.box(pitch_n, "F", Vector3(4.4, 2.0, 3.0), Vector3(0, 0, -0.6))
	for m in k.bake(mats):
		m.layers = 2
		meshes.append(m)
	pivot_h = 6.4
	pitch_rest = pitch_n.position
	_shape(6.0, ctr)
	weapon = Weapon.new(WEAPONS["plat_gun"], "M")
	rng_max = float(weapon.d["range"])
	spread_mul = 1.3
	lead_k = 0.85
	yaw_rate = 1.3
	pitch_rate = 1.1
	tol = 0.1
	kick = 0.6
	pitch_min = -0.1
	pitch_max = 1.45
	flash_col = Color(1.0, 0.55, 0.3)
	think_t = randf()


func _shape(r: float, at: Vector3) -> void:
	collision_layer = 2
	collision_mask = 0
	var cs := CollisionShape3D.new()
	var sh := SphereShape3D.new()
	sh.radius = r
	cs.shape = sh
	cs.position = at
	add_child(cs)


func _follow() -> void:
	if fixed:
		return
	if anchor != null and is_instance_valid(anchor) and anchor.is_inside_tree():
		global_position = anchor.global_transform * off


# ------------------------------------------------------------------ unit interface
func center() -> Vector3:
	return global_position + ctr


func muzzle(_mount: String) -> Vector3:
	if muz.is_empty():
		return center()
	return (muz[mi % muz.size()] as Node3D).global_position


func aim_dir() -> Vector3:
	if pitch_n == null:
		return Vector3.FORWARD
	return -pitch_n.global_transform.basis.z.normalized()


func _pivot() -> Vector3:
	return pitch_n.global_position if pitch_n != null else center()


func on_fired(_d: Dictionary, _mount: String = "M", _power: float = 1.0) -> void:
	recoil = 1.0
	if weapon != null and weapon.is_beam:
		return
	if kind == "turret":
		var o := muzzle("M")
		game.fx.flash(o, 70.0, 0.22, flash_col)
		game.fx.muzzle(o, aim_dir(), 5.0)
		game.shake(0.3, o)
		# a capital shell should read as one: fatten the tracer the weapon just spawned
		var pr = game.get("proj")
		if pr != null and not pr.list.is_empty():
			var p = pr.list[pr.list.size() - 1]
			if p.shooter == self:
				p.w = shell_w
				p.l = shell_l
		if bombard != null and bombard.alive and target == null:
			bombard.on_hull_hit(float(weapon.d["dmg"]), self)
	mi += 1


# ------------------------------------------------------------------ tick
func tick(dt: float) -> void:
	var prev := global_position
	_follow()
	_dt = dt
	_t += dt
	velocity = (global_position - prev) / maxf(dt, 0.001)
	if not alive:
		_tick_dead(dt)
		return
	alert_t -= dt
	if kind == "engine":
		if pm != null:
			var thr: float = clampf(float(ship.throttle), 0.0, 1.0) if ship != null else 0.0
			FX.set_plume(pm, plume_r * randf_range(0.95, 1.05), plume_l * (0.3 + 0.7 * thr) * randf_range(0.93, 1.07), 0.22 + 0.5 * thr)
			if lamp != null:
				lamp.light_energy = 5.0 + 12.0 * thr
		return
	if weapon == null:
		return
	recoil = maxf(0.0, recoil - dt * (1.1 if kind == "turret" else 7.0))
	var live: bool = armed and (ship == null or (ship.alive and not ship.disabled))
	var firing := false
	if live:
		think_t -= dt
		if think_t <= 0.0:
			think_t = randf_range(0.7, 1.2) if kind == "turret" else randf_range(0.4, 0.7)
			_think()
		firing = _track(dt)
	else:
		target = null
		missile = null
		bombard = null
	c_lock = target if (target != null and target.alive and missile == null) else null
	if weapon.is_beam:
		weapon.tick(dt, self, firing)
		if weapon.beam_on:
			_beam_fx()
			if bombard != null and bombard.alive and target == null:
				bombard.on_hull_hit(float(weapon.d["dmg"]) * dt, self)
	else:
		weapon.tick(dt, self, false)
		if firing:
			weapon.trigger(self)
	_apply()


func _apply() -> void:
	if yaw_n == null or pitch_n == null:
		return
	yaw_n.rotation.y = t_yaw
	pitch_n.rotation.x = t_pitch
	pitch_n.position = pitch_rest + pitch_n.basis.z * (recoil * kick)


func _is_ship_part(u) -> bool:
	return u.kind == "turret" or u.kind == "pd" or u.kind == "engine" or u.kind == "bridge"


func _think() -> void:
	target = null
	missile = null
	bombard = null
	var o := center()
	if kind == "pd" and _scan_missiles(o):
		return
	var cands: Array = []
	for u in game.units:
		if not u.alive or u.team == team or u.hidden:
			continue
		var sp: bool = _is_ship_part(u)
		if only_ships and not sp and u.kind != "platform":
			continue
		if kind != "turret" and sp:
			continue
		var d: float = (u.center() as Vector3).distance_to(o)
		if d > rng_max * 0.97:
			continue
		# capital guns only bother with small targets at medium range
		if kind == "turret" and not sp and d > rng_max * 0.55:
			continue
		var sc := d
		if kind == "turret":
			if not sp:
				sc *= mech_k
			elif u.objective:
				sc *= 0.9
		elif u.is_player:
			sc *= 0.85
		cands.append([sc * randf_range(0.85, 1.2), u])
	if cands.is_empty():
		return
	cands.sort_custom(func(a, b): return a[0] < b[0])
	for i in mini(3, cands.size()):
		var u = cands[i][1]
		if not _bears(u.center()):
			continue
		if _clear(u):
			target = u
			clear_ok = true
			clear_t = 0.6
			burst_t = randf_range(1.0, 1.8)
			pause_t = 0.0
			return
		# a capital gun with nothing in sight pounds the hull that shields its targets
		if kind == "turret" and bombard == null and u.get("ship") != null and u.ship != null and u.ship.alive:
			var res: Dictionary = game.ray(_pivot(), u.center(), 1, [])
			if not res.is_empty() and u.ship.bodies.has(res["collider"]):
				bombard = u.ship
				bombard_at = (u.ship as Node3D).to_local(res["position"])


func _scan_missiles(o: Vector3) -> bool:
	var pr = game.get("proj")
	if pr == null:
		return false
	var best := 380.0
	for p in pr.list:
		if p.team == team or (p.kind != "missile" and p.kind != "rocket"):
			continue
		var d: float = (p.pos as Vector3).distance_to(o)
		if d < best and _bears(p.pos):
			best = d
			missile = p
	if missile != null:
		kill_t = 0.0
	return missile != null


# target above this mount's horizon?
func _bears(p: Vector3) -> bool:
	var l: Vector3 = anchor.global_transform.affine_inverse() * p
	l.y -= pivot_h
	return atan2(l.y, Vector2(l.x, l.z).length()) >= pitch_min - 0.03


# line of fire: nothing solid (own hull, rocks) between the gun and the target
func _clear(u) -> bool:
	var c: Vector3 = u.center()
	var res: Dictionary = game.ray(_pivot(), c, 1, [])
	if res.is_empty():
		return true
	return (res["position"] as Vector3).distance_to(c) < float(u.radius) + 14.0


func _aim(p: Vector3, dt: float) -> bool:
	var l: Vector3 = anchor.global_transform.affine_inverse() * p
	l.y -= pivot_h
	want_yaw = atan2(-l.x, -l.z)
	var wp := atan2(l.y, Vector2(l.x, l.z).length())
	var bear := wp >= pitch_min - 0.03
	want_pitch = clampf(wp, pitch_min, pitch_max)
	t_yaw = U.turn_to(t_yaw, want_yaw, yaw_rate * dt)
	t_pitch = move_toward(t_pitch, want_pitch, pitch_rate * dt)
	return bear and absf(U.ang_diff(t_yaw, want_yaw)) < tol and absf(t_pitch - want_pitch) < tol


func _track(dt: float) -> bool:
	var o := _pivot()
	var speed: float = weapon.d["speed"]
	if missile != null:
		var mp: Vector3 = missile.pos
		var d := mp.distance_to(o)
		if d > 460.0 or float(missile.travelled) > 1e8:
			missile = null
			think_t = 0.0
			return false
		var aim: Vector3 = mp + (missile.vel as Vector3) * (d / speed)
		c_aim_point = aim
		var ok := _aim(aim, dt)
		if ok:
			kill_t += dt
			# tracers cannot hit a projectile, so a tracked missile is detonated by chance
			if kill_t > 0.35 and randf() < dt * 2.4:
				missile.travelled = 1e9
				game.fx.flash(mp, 14.0, 0.15)
				missile = null
				think_t = 0.1
		return ok
	if target == null and bombard != null and bombard.alive:
		var bp: Vector3 = (bombard as Node3D).to_global(bombard_at)
		c_aim_point = bp
		return _aim(bp, dt)
	if target == null or not target.alive or target.hidden:
		target = null
		t_yaw = U.turn_to(t_yaw, 0.0, yaw_rate * 0.3 * dt)
		t_pitch = move_toward(t_pitch, 0.0 if kind == "turret" else 0.5, pitch_rate * 0.3 * dt)
		return false
	var tc: Vector3 = target.center()
	var dist := tc.distance_to(o)
	if dist > rng_max * 1.03:
		target = null
		return false
	var lead := 0.0 if weapon.is_beam else dist / speed * lead_k
	var ok := _aim(tc + (target.velocity as Vector3) * lead, dt)
	clear_t -= dt
	if clear_t <= 0.0:
		clear_t = 0.6
		clear_ok = _clear(target)
		if not clear_ok:
			think_t = minf(think_t, 0.2)
	if not ok or not clear_ok:
		return false
	if kind == "turret":
		return true
	# light guns fire in bursts
	if pause_t > 0.0:
		pause_t -= dt
		return false
	burst_t -= dt
	if burst_t <= 0.0:
		burst_t = randf_range(1.0, 1.8)
		pause_t = randf_range(0.6, 1.2)
	return true


# the weapon's own beam is frame sized; lay a ship sized one over it
func _beam_fx() -> void:
	var o := muzzle("M")
	var dir := aim_dir()
	if target != null and target.alive:
		var d2: Vector3 = (target.center() as Vector3) - o
		if d2.normalized().dot(dir) > 0.25:
			dir = d2.normalized()
	var end := o + dir * rng_max
	var res: Dictionary = game.ray(o, end, 3, game.team_rids[team])
	if not res.is_empty():
		end = res["position"]
	var foe: bool = team != 0
	game.fx.beam(o, end, 2.6 + sin(_t * 40.0) * 0.3, Color(1.0, 0.32, 0.12) if foe else Color(0.4, 0.7, 1.0), 0.0, 1.5)
	fx_t -= _dt
	if fx_t <= 0.0:
		fx_t = 0.08
		game.fx.flash(o, 30.0, 0.12, flash_col)
		if not res.is_empty():
			game.fx.flash(end, 40.0, 0.14, flash_col)
			game.fx.sparks(end, 6, 60.0, res["normal"])
			if randf() < 0.3:
				game.fx.explosion(end, 0.8)


func _tick_dead(dt: float) -> void:
	dead_t += dt
	if dead_t > 26.0:
		return
	fx_t -= dt
	if fx_t > 0.0:
		return
	fx_t = 0.16
	var cam = game.get("cam")
	if cam != null and (cam.global_position as Vector3).distance_squared_to(global_position) > 800.0 * 800.0:
		return
	var p := center() + Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * radius * 0.6
	game.fx.emit("smoke", p, velocity + Vector3(randf_range(-3, 3), randf_range(-3, 3), randf_range(-3, 3)))
	if dead_t < 12.0 and randf() < 0.6:
		game.fx.emit("fire", p, velocity + Vector3(randf_range(-4, 4), randf_range(-4, 4), randf_range(-4, 4)))


# ------------------------------------------------------------------ damage
func take_damage(dmg: float, _imp: float, from, how: String, pos: Vector3) -> void:
	if not alive:
		return
	dmg *= vuln()
	if ship != null:
		dmg *= float(ship.dmg_taken)
		# frames, platforms and aircraft (anything that is not a warship gun) may be scaled per ship
		if from == null or from.get("ship") == null:
			dmg *= float(ship.frame_dmg)
	# overkill is wasted: only what the part could still absorb reaches the hull pool
	var eff := minf(dmg, ap)
	ap -= dmg
	last_hit_by = from
	alert_t = 15.0
	game.on_damage(self, dmg, from, how, pos)
	if ap <= 0.0:
		ap = 0.0
		_die()
		var c := center()
		if kind == "turret" or kind == "bridge":
			for i in 3:
				game.fx.explosion(c + Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * radius * 0.7, 2.2)
			game.fx.flash(c, 160.0, 0.5)
			if ship != null:
				ship.blast(c, radius * (2.6 if kind == "turret" else 3.6), 0.8)
		elif kind == "engine" and ship != null:
			ship.blast(c, radius * 3.0, 0.9)
		if kind == "bridge":
			game.sfx.play2d("bigboom", 0.6, 1.2)
			game.shake(0.5, c)
		game.on_unit_killed(self, from)
		if ship != null:
			ship.on_part_dead(self, from)
	if ship != null:
		ship.on_part_hit(self, eff, from)


func _die() -> void:
	alive = false
	state = "dead"
	collision_layer = 0
	target = null
	missile = null
	bombard = null
	if weapon != null:
		weapon.cancel()
	if pm != null:
		pm.visible = false
	if lamp != null:
		lamp.light_color = Color(1.0, 0.45, 0.2)
		lamp.light_energy = 4.0
	for m in meshes:
		if not is_instance_valid(m):
			continue
		if m.get_meta("key", "") == "G":
			m.visible = false
		else:
			m.set_instance_shader_parameter("wreck", 1.0)
	if pitch_n != null and kind != "pd":
		pitch_n.rotation.x = pitch_min
		pitch_n.position = pitch_rest


# destroyed with the ship: no kill credit, no callbacks
func scuttle() -> void:
	if alive:
		ap = 0.0
		_die()
	if lamp != null:
		lamp.light_energy = 0.0
