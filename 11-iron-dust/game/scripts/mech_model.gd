extends Node3D
# Part-based frame model. Joints come from a Blender-authored .glb (models/<frame>.glb);
# if that file is missing a code-built fallback with the same joint names is used.
# Front is -Z, right arm at +X. Joint rotation.x > 0 swings a hanging limb forward.
# Features: two-bone leg IK with planted feet, skirt-armour springs, gimballed thrusters
# with exhaust plumes, overdrive vents, swappable equipment on hard-points.

const MeshKit = preload("res://scripts/mesh_kit.gd")
const Tex = preload("res://scripts/tex.gd")
const Glb = preload("res://scripts/glb_kit.gd")
const Defs = preload("res://scripts/defs.gd")
const U = preload("res://scripts/u.gd")

class Anim:
	var boost := 0.0
	var air := 0.0
	var twist := 0.0
	var pitch := 0.0
	var recoil_r := 0.0
	var recoil_l := 0.0
	var aim_l := 0.0
	var melee_on := false
	var melee_t := 0.0
	var melee_style := 1
	var melee_path := "down"
	var melee_arm := -1
	var stagger := 0.0
	var down := 0.0
	var land := 0.0
	var idle_t := 0.0
	var mvx := 0.0          # body-local velocity, right +, normalised by boost speed
	var mvz := 0.0          # forward +
	var vy := 0.0           # vertical speed m/s
	var thrust := Vector3.ZERO   # world direction the thrusters push the frame, length = power
	var od := 0.0           # overdrive 0..1
	var charge := 0.0       # right-arm weapon charge 0..1
	var swap := 0.0         # weapon swap (arm lowered) 0..1
	var guard := 0.0        # shield raised 0..1
	var crouch := 0.0       # extra pelvis dip (m)
	var fire := 0.0         # gun shouldered (shooting or just shot) 0..1
	var two_hand := 1.0     # support hand on the weapon 0..1
	var mcharge := 0.0      # melee charge 0..1
	var space := false      # zero-g
	var blade_show := 0.0   # hangar: keep an energy blade lit
	var blade := 0.0        # sword drawn, frame on guard 0..1

class Leg:
	var side := 1.0
	var hip: Node3D
	var knee: Node3D
	var ankle: Node3D
	var pos := Vector3.ZERO      # planted sole position (world)
	var yaw := 0.0
	var cur := Vector3.ZERO      # current sole position incl. swing arc
	var cur_yaw := 0.0
	var nrm := Vector3.UP
	var pitch := 0.0
	var swing := false
	var armed := true
	var t := 0.0
	var dur := 0.4
	var lift := 1.2
	var from := Vector3.ZERO
	var from_yaw := 0.0

const UA := 2.8
const FA := 3.0
const BETA := 0.58
const SKIRTS := [["skirt_FL", "F", -1.0], ["skirt_FR", "F", 1.0], ["skirt_SL", "S", -1.0], ["skirt_SR", "S", 1.0], ["skirt_BL", "B", -1.0], ["skirt_BR", "B", 1.0]]

static var _plume_mesh: CylinderMesh
static var _plume_mat: ShaderMaterial

var st: Dictionary
var n := {}
var pelvis: Node3D
var waist: Node3D
var head: Node3D
var legs: Array = []
var arms := {}
var muz := {}
var muz_r: Array = [null, null, null]
var hand_r: Array = [null, null, null]
var _trail: MeshInstance3D
var _trail_im: ImmediateMesh
var _trail_pts: Array = []
var _trail_arm := "L"
var trail_col := Color(0.85, 0.87, 0.9)
var plasma: Array = []        # [{root, k}] energy blades that ignite for a swing
var plasma_mat: StandardMaterial3D
var plasma_len := 10.5
const MODEL_BLADE_K := 1.5    # a modelled energy blade is drawn this much longer than authored when lit
var blade_k := 1.0            # length scale of the melee weapon model
var wrists := {}
var grips := {}              # arm -> the node a held sword hangs under (child of the wrist or of the rack)
var racks := {}              # arm -> where that sword is stowed
var _stowed := {}
var _sword_hid := {}
var _pit_hide := 0            # the layer hidden from the seat while the cockpit view is on, else 0              # arm -> wrist joint of a sword held in the fist
var foot_bias := 0.0          # stance: metres the right foot stands ahead of (and the left behind) its usual place
var _bw := 0.0                # how far the body is given over to the blade-work key
var guard_key: Array = GUARD_KEY     # this frame's on-guard key and dash carry (heavy blade or sabre)
var trail_arm: Array = TRAIL_ARM
var thr: Array[Node3D] = []
var noz: Array = []
var vents: Array = []
var skirts: Array = []
var spins: Array = []
var meshes: Array[MeshInstance3D] = []
var plumes: Array[MeshInstance3D] = []
var mats := {}
var blade_mat: StandardMaterial3D
var glow_mat: StandardMaterial3D
var pit_view := false         # the player is looking out from this frame's cockpit
static var GUARD_POSE := Vector3(1.0, 1.2, 0.5)   # shield guard: shoulder pitch, elbow bend, inward roll
static var GUARD_YAW := -0.6
# the shoulder girdle: the shoulder joint and its pauldron travel (forward, up, outward) with the arm.
# GIRDLE_GUARD is the travel of the shield shoulder with the shield raised, GIRDLE_REACH the forward
# travel per radian an arm is swung forward (back when it is swung back)
static var GIRDLE_GUARD := Vector3(0.7, 0.2, 0.2)
# which way a raised shield's plate faces, in the model's space: at the enemy, the top leaning back a little
static var GUARD_FACE := Vector3(0.0, 0.12, -1.0)
static var GIRDLE_REACH := 0.3
static var dbg_guard := []     # pose viewer: [pitch, elbow, roll, yaw] to try on any shield
var _ghost_mat: ShaderMaterial
var back_off := {}            # per-slot shift of the back mounts for this frame
var _pit_extra: Array = []    # solid bits that are not weapons in use (a torch's hilt): hidden from the seat
var glow_col := Color(0.5, 1.0, 0.7)
var shield_root: Node3D
var shield_parts: Array = []
var has_shield := false
var own_guard: Array = []      # [shoulder pitch, elbow, inward roll, yaw] of this shield, if it has its own
var from_glb := false
var layer := 1
var th := 3.9
var sh_len := 4.2
var foot_h := 1.0
var hip_y := 9.2
var hip_w := 1.7
var hip_off := -0.15
var height := 17.0
var walk_ref := 22.0
var steps: Array = []
var phase := 0.0
var gait_on := false
var ikw := 0.0
var spin_v := 0.0
var _binder_rest := {}
var _pauld_rest := {}
var _sh_pos := {}             # rest position of each shoulder joint and pauldron: the girdle moves them
var _pauld_pos := {}


func _mark(parent: Node3D, pos: Vector3, nm: String = "", rot: Vector3 = Vector3.ZERO) -> Node3D:
	var m := Node3D.new()
	m.position = pos
	m.rotation = rot
	parent.add_child(m)
	if nm != "":
		m.name = nm
		n[nm] = m
	return m


# ------------------------------------------------------------------ build
func build(frame_id: String, def: Dictionary, loadout: Dictionary, seed_v: int = 1, layer_mask: int = 1) -> void:
	st = def["style"]
	walk_ref = def["walk"]
	back_off = def.get("back_off", {})
	layer = layer_mask
	var pal: Dictionary = def["pal"]
	glow_col = pal["g"]
	blade_mat = StandardMaterial3D.new()
	blade_mat.albedo_color = Color(0.12, 0.11, 0.1)
	blade_mat.metallic = 0.8
	blade_mat.roughness = 0.35
	blade_mat.emission_enabled = true
	blade_mat.emission = Color(1.0, 0.36, 0.06)
	blade_mat.emission_energy_multiplier = 0.03
	glow_mat = StandardMaterial3D.new()
	glow_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	glow_mat.albedo_color = glow_col * 2.0
	var am := Tex.armor
	mats = {
		"A": {"mat": am, "params": {"tint": pal["a"], "metal": 0.4, "wear": 1.0}},
		"B": {"mat": am, "params": {"tint": pal["b"], "metal": 0.45, "wear": 1.0}},
		"C": {"mat": am, "params": {"tint": pal["c"], "metal": 0.3, "wear": 1.1}},
		"F": {"mat": am, "params": {"tint": Color(0.1, 0.105, 0.11), "metal": 0.8, "wear": 0.8}},
		"W": {"mat": am, "params": {"tint": Color(0.085, 0.09, 0.095), "metal": 0.75, "wear": 0.9}},
		"T": {"mat": am, "params": {"tint": Color(0.02, 0.02, 0.022), "metal": 0.6, "wear": 0.6}},
		"H": {"mat": am, "params": {"tint": Color(0.7, 0.5, 0.06), "metal": 0.2, "wear": 1.2, "stripes": 1.0}},
		"G": {"mat": glow_mat},
		"K": {"mat": blade_mat},
	}
	var glb_id := str(def.get("model", frame_id))
	if Glb.has(glb_id):
		_build_glb(glb_id)
	if not from_glb:
		_build_proc(loadout, seed_v)
	_setup_rig()
	if from_glb:
		_attach_all(loadout)
	_add_marks()
	set_active_r(0)


func _build_glb(frame_id: String) -> void:
	var root := Glb.instance(frame_id)
	if root == null:
		return
	var pv := Glb.find(root, "pelvis")
	if pv == null or Glb.find(root, "knee_L") == null or Glb.find(root, "waist") == null:
		push_warning("models/%s.glb does not match the joint contract; using code-built model" % frame_id)
		root.free()
		return
	# hoist the pelvis directly under this node so pelvis.position is model-space
	var xf := pv.transform
	var p := pv.get_parent()
	while p != null and p != root:
		xf = (p as Node3D).transform * xf
		p = p.get_parent()
	xf = root.transform * xf
	pv.owner = null
	for c in pv.find_children("*", "", true, false):
		c.owner = null
	pv.get_parent().remove_child(pv)
	add_child(pv)
	pv.transform = xf
	root.free()
	n["pelvis"] = pv
	for c in pv.find_children("*", "Node3D", true, false):
		if not (c is MeshInstance3D):
			n[String(c.name)] = c
	Glb.skin(pv, mats, layer, meshes)
	from_glb = true


func _setup_rig() -> void:
	pelvis = n["pelvis"]
	waist = n["waist"]
	head = n["head"]
	hip_y = pelvis.position.y
	th = -(n["knee_L"] as Node3D).position.y
	sh_len = -(n["ankle_L"] as Node3D).position.y
	if n.has("sole_L"):
		foot_h = maxf(0.3, -(n["sole_L"] as Node3D).position.y)
	hip_w = absf((n["hip_R"] as Node3D).position.x)
	hip_off = (n["hip_L"] as Node3D).position.y
	for sd in [["L", -1.0], ["R", 1.0]]:
		var lg := Leg.new()
		lg.side = sd[1]
		lg.hip = n["hip_" + sd[0]]
		lg.knee = n["knee_" + sd[0]]
		lg.ankle = n["ankle_" + sd[0]]
		legs.append(lg)
		arms[sd[0]] = [n["sh_" + sd[0]], n["el_" + sd[0]]]
		_sh_pos[sd[0]] = (n["sh_" + sd[0]] as Node3D).position
		if n.has("pauldron_" + sd[0]):
			_pauld_pos[sd[0]] = (n["pauldron_" + sd[0]] as Node3D).position
			_pauld_rest[sd[0]] = (n["pauldron_" + sd[0]] as Node3D).basis
		if n.has("binder_" + sd[0]):
			_binder_rest[sd[0]] = (n["binder_" + sd[0]] as Node3D).basis
	height = hip_y + waist.position.y + head.position.y + 2.4
	for sk in SKIRTS:
		if n.has(sk[0]):
			var node: Node3D = n[sk[0]]
			skirts.append({"n": node, "kind": sk[1], "side": sk[2], "rest": node.basis, "a": 0.0, "w": 0.0})
	if _plume_mesh == null:
		_plume_mesh = CylinderMesh.new()
		_plume_mesh.top_radius = 0.5
		_plume_mesh.bottom_radius = 0.16
		_plume_mesh.height = 1.0
		_plume_mesh.radial_segments = 12
		_plume_mesh.rings = 4
		_plume_mesh.cap_top = false
		_plume_mesh.cap_bottom = false
		_plume_mat = ShaderMaterial.new()
		_plume_mat.shader = load("res://shaders/plume.gdshader")
	for nm in n:
		var s := String(nm)
		var node: Node3D = n[nm]
		if s.begins_with("noz_"):
			var grp := "side"
			var gim := 0.0
			var cut := 0.55
			var r := 0.7
			var ln := 4.5
			if s.begins_with("noz_back") or s.begins_with("noz_binder"):
				grp = "back"
				gim = 0.6 if s.begins_with("noz_back") else 0.35
				cut = 0.1
				r = 1.25
				ln = 11.0
				thr.append(node)
			elif s.begins_with("noz_leg"):
				grp = "leg"
				gim = 0.4
				cut = 0.35
				r = 0.9
				ln = 7.0
			elif s.begins_with("noz_front"):
				grp = "front"
				ln = 4.0
			var pm := MeshInstance3D.new()
			pm.mesh = _plume_mesh
			pm.material_override = _plume_mat
			pm.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			pm.visible = false
			pm.layers = layer
			node.add_child(pm)
			plumes.append(pm)
			noz.append({"n": node, "rest": node.basis, "dir": (node.basis * Vector3.DOWN).normalized(), "grp": grp, "gim": gim, "cut": cut, "r": r, "len": ln, "lvl": 0.0, "pm": pm})
		elif s.begins_with("vent_"):
			vents.append({"n": node, "rest": node.basis})


# ------------------------------------------------------------------ equipment (glb)
# (outward, up, back) -> a shift in the mount's parent space; outward is away from the centre
# line on the mount's own side
static func back_shift(mount: Node3D, slot: String, off: Vector3) -> Vector3:
	var side := signf(mount.position.x)
	if side == 0.0:
		side = 1.0 if slot == "S1" else -1.0
	return Vector3(side * off.x, off.y, off.z)


func _attach(item: String, mount: String) -> Node3D:
	if item == "" or not n.has(mount):
		return null
	var p := _part(item)
	if p == null:
		return null
	(n[mount] as Node3D).add_child(p)
	p.set_meta("equip", mount)
	Glb.skin(p, mats, layer, meshes)
	var sp := Glb.find(p, item + "_spin")
	if sp != null:
		spins.append(sp)
	return p


# equipment lives in several library files: the original set plus one per modelling pass
func _part(item: String) -> Node3D:
	for lib in ["equip", "equip_f", "equip_e", "equip_s", "equip_m", "equip_b"]:
		var p := Glb.part(lib, item)
		if p != null:
			return p
	return null


# a skinned copy of one library item that is not attached to the rig (e.g. the anchor's hook head)
func loose_part(item: String) -> Node3D:
	var p := _part(item)
	if p != null:
		Glb.skin(p, mats, layer, meshes)
	return p


# a pylon from a back hard-point to a weapon that is carried away from it (see "back_off"):
# foot plate on the hard-point, a braced post, a saddle under the weapon
func _add_pylon(mount: Node3D, lift: Vector3) -> void:
	var host := mount.get_parent() as Node3D
	if host == null or not mats.has("W") or not mats.has("F"):
		return
	var up := lift.normalized()
	var side := up.cross(Vector3.BACK)
	if side.length() < 0.1:
		side = up.cross(Vector3.RIGHT)
	side = side.normalized()
	var root := Node3D.new()
	root.name = "pylon"
	root.transform = Transform3D(Basis(side, up, side.cross(up)), mount.position - lift)
	host.add_child(root)
	var L := lift.length()
	# [material key, size, centre]
	var parts := [
		["F", Vector3(1.1, 0.28, 1.5), Vector3(0, 0.1, 0)],
		["W", Vector3(0.5, L, 0.8), Vector3(0, L * 0.5, 0)],
		["F", Vector3(0.62, 0.2, 0.92), Vector3(0, L * 0.45, 0)],
		["F", Vector3(0.95, 0.26, 1.7), Vector3(0, L - 0.1, 0)],
	]
	for pt in parts:
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = pt[1]
		mi.mesh = bm
		mi.position = pt[2]
		var md: Dictionary = mats[pt[0]]
		mi.material_override = md["mat"]
		for kk in md.get("params", {}):
			mi.set_instance_shader_parameter(kk, md["params"][kk])
		mi.layers = layer
		root.add_child(mi)
		_pit_extra.append(mi)
	# two raking braces from the foot to the saddle, fore and aft
	for sg in [-1.0, 1.0]:
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		var run := Vector3(0, L - 0.3, sg * 0.45)
		bm.size = Vector3(0.16, run.length(), 0.16)
		mi.mesh = bm
		mi.position = Vector3(0, 0.15, sg * 0.25) + run * 0.5
		mi.rotation.x = atan2(run.z, run.y)
		var md: Dictionary = mats["F"]
		mi.material_override = md["mat"]
		for kk in md.get("params", {}):
			mi.set_instance_shader_parameter(kk, md["params"][kk])
		mi.layers = layer
		root.add_child(mi)
		_pit_extra.append(mi)


# one solid box in a material of the frame (pylons, racks)
func _solid(parent: Node3D, key: String, size: Vector3, pos: Vector3, rot: Vector3 = Vector3.ZERO) -> void:
	if not mats.has(key):
		return
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.position = pos
	mi.rotation = rot
	var md: Dictionary = mats[key]
	mi.material_override = md["mat"]
	for kk in md.get("params", {}):
		mi.set_instance_shader_parameter(kk, md["params"][kk])
	mi.layers = layer
	parent.add_child(mi)
	_pit_extra.append(mi)


# box of a part's own meshes in its own space (not its child joints)
func _own_box(nd: Node3D) -> AABB:
	var box := AABB()
	var first := true
	for c in nd.get_children():
		if c is MeshInstance3D and (c as MeshInstance3D).mesh != null:
			var b: AABB = (c as Node3D).transform * (c as MeshInstance3D).mesh.get_aabb()
			box = b if first else box.merge(b)
			first = false
	return box


# Where a hand-held sword is carried when it is not drawn. "hip": on the outside of that side's hip
# skirt, hilt up, blade down and a little back. "back": across the back of the waist, hilt at the
# sword arm's side. Returns the node the grip is parented to while stowed; the blade runs along its -Y.
func _make_rack(arm: String, kind: String) -> Node3D:
	var s := -1.0 if arm == "L" else 1.0
	var rk := Node3D.new()
	rk.name = "rack_" + arm
	var host: Node3D = null
	if kind == "back" and n.has("waist"):
		host = n["waist"]
		var bx := _own_box(host)
		# hilt up at the sword arm's shoulder blade, blade slanting down across the back
		rk.position = Vector3(s * bx.size.x * 0.22, bx.get_center().y + bx.size.y * 0.28, bx.end.z + 0.45)
		rk.rotation = Vector3(0.0, 0.0, s * 0.6)
		_solid(rk, "F", Vector3(0.9, 0.5, 0.5), Vector3(0, -0.6, -0.25))
		_solid(rk, "F", Vector3(0.7, 0.4, 0.4), Vector3(0, -2.6, -0.25))
	else:
		var sk := "skirt_S" + arm
		if n.has(sk):
			host = n[sk]
			var bx := _own_box(host)
			var out_x: float = bx.position.x if s < 0.0 else bx.end.x
			rk.position = Vector3(out_x + s * 0.3, bx.end.y - bx.size.y * 0.2, bx.get_center().z)
		elif n.has("pelvis") and n.has("hip_" + arm):
			host = n["pelvis"]
			var hp: Vector3 = (n["hip_" + arm] as Node3D).position
			rk.position = hp + Vector3(s * 1.6, 0.3, 0.0)
		rk.rotation = Vector3(-0.3, 0.0, 0.0)
		_solid(rk, "F", Vector3(0.36, 0.7, 0.9), Vector3(-s * 0.18, -0.5, 0.0))
		_solid(rk, "F", Vector3(0.3, 0.3, 0.7), Vector3(-s * 0.16, -2.0, 0.0))
	if host == null:
		return null
	host.add_child(rk)
	n["rack_" + arm] = rk
	return rk


# plasma torch: a hilt on the forearm and a beam blade that exists only while lit
func _add_plasma(arm: String) -> void:
	var mk := "mount_blade_" + arm
	var oy := 0.0
	if wrists.has(arm):
		mk = "grip_" + arm
		oy = 0.6
	if not n.has(mk):
		return
	var mount: Node3D = n[mk]
	if plasma_mat == null:
		plasma_mat = StandardMaterial3D.new()
		plasma_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		plasma_mat.albedo_color = Color(trail_col.r * 3.0, trail_col.g * 3.0, trail_col.b * 3.0)
	var hilt := MeshInstance3D.new()
	var hm := CylinderMesh.new()
	hm.top_radius = 0.26
	hm.bottom_radius = 0.2
	hm.height = 1.7
	hm.radial_segments = 8
	hilt.mesh = hm
	hilt.position = Vector3(0, -0.7 + oy, 0)
	hilt.material_override = (mats["W"] as Dictionary)["mat"] if mats.has("W") else null
	hilt.layers = layer
	mount.add_child(hilt)
	_pit_extra.append(hilt)
	for kk in (mats["W"] as Dictionary).get("params", {}) if mats.has("W") else {}:
		hilt.set_instance_shader_parameter(kk, mats["W"]["params"][kk])
	var root := Node3D.new()
	root.position = Vector3(0, -1.5 + oy, 0)
	mount.add_child(root)
	# white-hot core inside a wider coloured sheath
	for spec in [[0.16, Color(3.2, 3.2, 3.2)], [0.36, Color(0, 0, 0)]]:
		var bm := CylinderMesh.new()
		bm.top_radius = float(spec[0])
		bm.bottom_radius = float(spec[0]) * 0.55
		bm.height = 1.0
		bm.radial_segments = 8
		var mi := MeshInstance3D.new()
		mi.mesh = bm
		mi.position = Vector3(0, -0.5, 0)
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.layers = layer
		if float(spec[0]) < 0.2:
			var cm := StandardMaterial3D.new()
			cm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			cm.albedo_color = spec[1]
			mi.material_override = cm
		else:
			var sm := StandardMaterial3D.new()
			sm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			sm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			sm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
			sm.albedo_color = Color(trail_col.r * 2.2, trail_col.g * 2.2, trail_col.b * 2.2, 0.7)
			mi.material_override = sm
		root.add_child(mi)
	var lt := OmniLight3D.new()
	lt.light_color = trail_col
	lt.omni_range = 26.0
	lt.light_energy = 0.0
	lt.shadow_enabled = false
	lt.position = Vector3(0, -0.5, 0)
	root.add_child(lt)
	root.scale = Vector3(1, 0.001, 1)
	root.visible = false
	plasma.append({"root": root, "k": 0.0, "arm": arm, "lamp": lt})


# a modelled energy blade: its mesh hangs under a joint of its own, so it is lit for a swing and
# put out again like the drawn one. The blade grows along the mesh's long axis.
func _add_model_plasma(arm: String, bj: Node3D) -> void:
	if plasma_mat == null:
		plasma_mat = StandardMaterial3D.new()
		plasma_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		plasma_mat.albedo_color = Color(trail_col.r * 3.0, trail_col.g * 3.0, trail_col.b * 3.0)
	var list: Array = bj.find_children("*", "MeshInstance3D", true, false)
	if bj is MeshInstance3D:
		list.append(bj)
	var box := AABB()
	var first := true
	for mi in list:
		(mi as MeshInstance3D).material_override = plasma_mat
		(mi as MeshInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var b: AABB = (mi as MeshInstance3D).mesh.get_aabb()
		if mi != bj:
			b = (mi as Node3D).transform * b
		box = b if first else box.merge(b)
		first = false
	var axis := box.get_longest_axis_index()
	var long_len := box.get_longest_axis_size()
	var lt := OmniLight3D.new()
	lt.light_color = trail_col
	lt.omni_range = 26.0
	lt.light_energy = 0.0
	lt.shadow_enabled = false
	lt.position = box.get_center()
	bj.add_child(lt)
	bj.visible = false
	plasma_len = long_len * MODEL_BLADE_K
	plasma.append({"root": bj, "k": 0.0, "arm": arm, "lamp": lt, "axis": axis, "len": MODEL_BLADE_K})


func _muzzle_of(node: Node3D, item: String) -> Node3D:
	if node == null:
		return null
	var m := Glb.find(node, item + "_muzzle")
	return m if m != null else node


func _attach_all(lo: Dictionary) -> void:
	var ri := 0
	for i in 3:
		var id := str(lo.get("R%d" % (i + 1), ""))
		if Defs.WEAPONS.has(id):
			var model: String = Defs.WEAPONS[id].get("model", "")
			hand_r[ri] = _attach(model, "mount_hand_R")
			muz_r[ri] = _muzzle_of(hand_r[ri], model)
			ri += 1
	var l := str(lo.get("L", ""))
	if Defs.SHIELDS.has(l):
		var model: String = Defs.SHIELDS[l]["model"]
		shield_root = _attach(model, "mount_arm_L")
		if shield_root != null:
			has_shield = true
			own_guard = Defs.SHIELDS[l].get("guard", [])
			for part in ["lower", "upper", "core"]:
				var pn := Glb.find(shield_root, "%s_%s" % [model, part])
				if pn != null:
					shield_parts.append(pn)
	elif Defs.WEAPONS.has(l):
		var model: String = Defs.WEAPONS[l].get("model", "")
		var at := "mount_arm_L" if Defs.WEAPONS[l].get("arm_mount", false) else "mount_hand_L"
		var ln := _attach(model, at)
		if ln != null:
			muz["L"] = _muzzle_of(ln, model)
	for sl in [["S1", "mount_back_R"], ["S2", "mount_back_L"]]:
		var id := str(lo.get(sl[0], ""))
		# some frames carry their shoulder weapons further out or higher so they clear the
		# head and pauldrons (values found by tools/test_clip.gd --solve)
		var lift := Vector3.ZERO
		if back_off.has(sl[0]) and n.has(sl[1]):
			lift = back_shift(n[sl[1]], sl[0], back_off[sl[0]])
			(n[sl[1]] as Node3D).position += lift
		if Defs.WEAPONS.has(id):
			var model: String = Defs.WEAPONS[id].get("model", "")
			var node := _attach(model, sl[1])
			if node != null:
				muz[sl[0]] = _muzzle_of(node, model)
				if lift.length() > 0.6:
					# moved well clear of its hard-point: a pylon carries it, or it would hang in the air
					_add_pylon(n[sl[1]], lift)
	var ml := str(lo.get("M", ""))
	if Defs.MELEE.has(ml):
		var md: Dictionary = Defs.MELEE[ml]
		var models: Dictionary = md["models"]
		# blades are scaled up along their length: longer reach and a broader arc
		blade_k = float(md.get("len", 1.0))
		var marm := str(md["arm"])
		var marms: Array = ["L", "R"] if marm == "both" else [marm]
		# a sword is held in the fist, on a wrist joint of its own, when that hand is free;
		# everything else rides the forearm
		var hold: Array = md.get("hold", [])
		var host := {}
		for arm in marms:
			host[arm] = "mount_blade_" + str(arm)
			var fist_free: bool = str(arm) == "L" and not (Defs.WEAPONS.has(l) and not Defs.WEAPONS[l].get("arm_mount", false))
			if not hold.is_empty() and fist_free and n.has("mount_hand_" + str(arm)):
				var wj := Node3D.new()
				wj.name = "wrist_" + str(arm)
				((arms[arm] as Array)[1] as Node3D).add_child(wj)
				wj.position = (n["mount_hand_" + str(arm)] as Node3D).position
				n["wrist_" + str(arm)] = wj
				wrists[arm] = wj
				# the sword itself hangs under a grip node: in the fist when drawn, on its rack otherwise
				var gj := Node3D.new()
				gj.name = "grip_" + str(arm)
				wj.add_child(gj)
				n["grip_" + str(arm)] = gj
				grips[arm] = gj
				racks[arm] = _make_rack(str(arm), str(md.get("rack", "hip")))
				host[arm] = "grip_" + str(arm)
		var bsc := Vector3(1.0 + (blade_k - 1.0) * 0.35, blade_k, 1.0 + (blade_k - 1.0) * 0.35)
		for arm in models:
			var bn := _attach(models[arm], str(host.get(arm, "mount_blade_" + str(arm))))
			if bn != null:
				bn.scale = bsc
				if wrists.has(arm):
					# the grip of the hilt sits in the fist
					bn.position = -Vector3(0, float(hold[0]) * bsc.y, float(hold[1]) * bsc.z)
		var en := str(md.get("energy", "solid"))
		if en == "heat":
			trail_col = Color(1.0, 0.5, 0.16)
		elif en == "plasma":
			trail_col = Color(glow_col.r * 0.6 + 0.4, glow_col.g * 0.6 + 0.4, glow_col.b * 0.6 + 0.4)
			if not wrists.is_empty():
				guard_key = SABRE_KEY
				trail_arm = SABRE_TRAIL
			for arm in marms:
				# a modelled sabre brings its own blade (a joint named <item>_blade); a torch gets a drawn one
				var bj: Node3D = null
				if models.has(arm) and n.has(str(host[arm])):
					bj = Glb.find(n[str(host[arm])], str(models[arm]) + "_blade")
				if bj != null:
					_add_model_plasma(arm, bj)
				else:
					_add_plasma(arm)


func set_active_r(i: int) -> void:
	for j in hand_r.size():
		if hand_r[j] != null:
			(hand_r[j] as Node3D).visible = j == i
	if muz_r[i] != null:
		muz["R"] = muz_r[i]


# shield break-up: frac = remaining hp fraction. Returns world positions of pieces just lost.
func set_shield(frac: float) -> Array:
	var lost := []
	if shield_root == null:
		return lost
	var keep := 3
	if frac <= 0.0:
		keep = 0
	elif frac < 0.3:
		keep = 1
	elif frac < 0.62:
		keep = 2
	if shield_parts.is_empty():
		if keep == 0 and shield_root.visible:
			shield_root.visible = false
			lost.append(shield_root.global_position)
		return lost
	var total := shield_parts.size()
	for i in total:
		var pn: Node3D = shield_parts[i]
		var want := (total - i) <= keep
		if pn.visible and not want:
			lost.append(pn.global_position)
		pn.visible = want
	if keep == 0:
		shield_root.visible = false
		has_shield = false
	return lost


func restore_shield() -> void:
	if shield_root == null:
		return
	shield_root.visible = true
	has_shield = true
	for pn in shield_parts:
		(pn as Node3D).visible = true


func _add_marks() -> void:
	var mark: String = st.get("mark", "")
	if mark == "":
		return
	for sd in [["L", -1.0], ["R", 1.0]]:
		var s: float = sd[1]
		var host: Node3D = n.get("pauldron_" + sd[0], arms[sd[0]][0])
		var box := AABB()
		var first := true
		for c in host.get_children():
			if c is MeshInstance3D and c.mesh != null and c.mesh != _plume_mesh:
				var bb: AABB = c.transform * c.mesh.get_aabb()
				box = bb if first else box.merge(bb)
				first = false
		if first:
			continue
		var lb := Label3D.new()
		lb.text = mark
		lb.font = Tex.font
		lb.font_size = 96
		lb.pixel_size = 0.014
		lb.shaded = true
		lb.outline_size = 0
		lb.modulate = Color(0.82, 0.8, 0.72, 0.8)
		lb.layers = layer
		var c := box.get_center()
		var ox := box.end.x if s > 0.0 else box.position.x
		lb.position = Vector3(ox + s * 0.04, c.y, c.z)
		lb.rotation.y = s * PI * 0.5
		host.add_child(lb)


# ------------------------------------------------------------------ code-built fallback
func _build_proc(lo: Dictionary, seed_v: int) -> void:
	var k := MeshKit.new(seed_v)
	th = st["thigh"]
	sh_len = st["shin"]
	var lw: float = st["leg_w"]
	var aw: float = st["arm_w"]
	var hw: float = st["hip_w"]
	var tw: float = st["torso_w"]
	var thh: float = st["torso_h"]
	var td: float = st["torso_d"]
	var sw: float = st["sh_w"]
	var sk: float = st["skirt"]
	var hz := PI * 0.5
	var r1: Dictionary = Defs.WEAPONS.get(str(lo.get("R1", "")), {})
	var lid := str(lo.get("L", ""))
	var lgun: String = Defs.WEAPONS[lid].get("gun", "") if Defs.WEAPONS.has(lid) else ""
	var s1: String = Defs.WEAPONS.get(str(lo.get("S1", "")), {}).get("back", "")
	var s2: String = Defs.WEAPONS.get(str(lo.get("S2", "")), {}).get("pod", "")
	var bl: String = Defs.MELEE.get(str(lo.get("M", "")), {}).get("blade", "")
	var shield: bool = Defs.SHIELDS.has(lid)

	var pv := k.bone(self, Vector3(0, 1.0 + sh_len + th + 0.1, 0))
	n["pelvis"] = pv
	k.box(pv, "F", Vector3(2.6, 1.7, 2.3), Vector3(0, 0.1, 0))
	k.box(pv, "A", Vector3(1.5, 2.0, 1.1), Vector3(0, -0.2, -1.25), Vector3.ZERO, {"bx": 0.6, "bz": 0.7})
	k.box(pv, "B", Vector3(1.6, 1.6, 0.9), Vector3(0, -0.1, 1.3), Vector3.ZERO, {"bx": 0.7})
	k.box(pv, "H", Vector3(1.1, 0.35, 0.2), Vector3(0, 0.55, -1.82))
	for side in [["L", -1.0], ["R", 1.0]]:
		var s: float = side[1]
		var sn: String = side[0]
		k.cyl(pv, "F", 0.75, 0.75, 1.0, Vector3(s * 1.55, -0.15, 0), Vector3(0, 0, hz), 10)
		# skirt armour on its own hinges
		var sf := k.bone(pv, Vector3(s * 1.45, 0.4, -1.45))
		k.box(sf, "A", Vector3(1.5 * sk, 2.5, 0.35), Vector3(0, -1.25, -0.25), Vector3(0.2, 0, 0), {"bx": 0.85})
		k.box(sf, "F", Vector3(0.9, 0.3, 0.3), Vector3(0, 0, 0))
		n["skirt_F" + sn] = sf
		var ss := k.bone(pv, Vector3(s * (hw + 1.0), 0.55, 0))
		k.box(ss, "A", Vector3(0.4, 2.7, 2.6 * sk), Vector3(s * 0.25, -1.35, 0), Vector3(0, 0, s * 0.14), {"bz": 0.8})
		k.box(ss, "C", Vector3(0.46, 0.4, 1.6 * sk), Vector3(s * 0.42, -2.3, 0), Vector3(0, 0, s * 0.14))
		n["skirt_S" + sn] = ss
		var sb := k.bone(pv, Vector3(s * 1.4, 0.4, 1.5))
		k.box(sb, "B", Vector3(1.5, 2.3, 0.35), Vector3(0, -1.15, 0.22), Vector3(-0.18, 0, 0), {"bx": 0.85})
		n["skirt_B" + sn] = sb
		# leg
		var hip := k.bone(pv, Vector3(s * hw, -0.15, 0))
		k.cyl(hip, "F", 0.55 * lw, 0.5 * lw, th, Vector3(0, -th * 0.5, 0), Vector3.ZERO, 8)
		k.box(hip, "A", Vector3(1.75 * lw, th * 0.82, 2.1 * lw), Vector3(0, -th * 0.48, -0.1), Vector3.ZERO, {"tx": 0.85, "tz": 0.8, "bx": 0.9, "bz": 0.9})
		k.box(hip, "B", Vector3(1.2 * lw, th * 0.5, 0.5), Vector3(0, -th * 0.45, -1.15 * lw), Vector3(0.05, 0, 0))
		var knee := k.bone(hip, Vector3(0, -th, 0))
		k.cyl(knee, "F", 0.7 * lw, 0.7 * lw, 1.9 * lw, Vector3.ZERO, Vector3(0, 0, hz), 10)
		k.box(knee, "B", Vector3(1.5 * lw, 1.5, 0.8), Vector3(0, 0.1, -1.05 * lw), Vector3.ZERO, {"tx": 0.7, "bx": 0.8, "tz": 0.5})
		k.box(knee, "A", Vector3(1.95 * lw, sh_len * 0.9, 2.3 * lw), Vector3(0, -sh_len * 0.52, -0.05), Vector3.ZERO, {"tx": 0.72, "tz": 0.7, "bz": 1.05})
		k.box(knee, "B", Vector3(1.3 * lw, sh_len * 0.55, 0.5), Vector3(0, -sh_len * 0.5, -1.25 * lw), Vector3(-0.06, 0, 0), {"tx": 0.8})
		k.box(knee, "B", Vector3(1.4 * lw, sh_len * 0.5, 1.2), Vector3(0, -sh_len * 0.42, 1.35 * lw), Vector3.ZERO, {"tx": 0.8, "bx": 0.9})
		k.cyl(knee, "F", 0.12, 0.12, sh_len * 0.6, Vector3(s * 0.85 * lw, -sh_len * 0.4, 0.7 * lw), Vector3.ZERO, 6)
		var nl := k.bone(knee, Vector3(0, -sh_len * 0.72, 1.5 * lw))
		nl.rotation.x = -0.5
		k.cyl(nl, "T", 0.42, 0.6, 0.8, Vector3(0, 0.4, 0), Vector3.ZERO, 10)
		n["noz_leg_" + sn] = nl
		var ankle := k.bone(knee, Vector3(0, -sh_len, 0))
		k.cyl(ankle, "F", 0.6 * lw, 0.6 * lw, 1.6 * lw, Vector3.ZERO, Vector3(0, 0, hz), 8)
		k.box(ankle, "B", Vector3(2.3 * lw, 1.0, 3.0 * lw), Vector3(0, -0.5, -0.2), Vector3.ZERO, {"tx": 0.8, "tz": 0.85})
		k.box(ankle, "A", Vector3(2.1 * lw, 0.8, 1.9 * lw), Vector3(0, -0.6, -2.4 * lw), Vector3.ZERO, {"tx": 0.7, "tz": 0.6, "sz": 0.3})
		k.box(ankle, "F", Vector3(1.6 * lw, 0.9, 1.3), Vector3(0, -0.55, 1.7 * lw), Vector3.ZERO, {"tz": 0.6})
		k.box(ankle, "A", Vector3(1.7 * lw, 1.3, 0.4), Vector3(0, 0.3, -1.3 * lw), Vector3(0.5, 0, 0))
		n["hip_" + sn] = hip
		n["knee_" + sn] = knee
		n["ankle_" + sn] = ankle

	var ws := k.bone(pv, Vector3(0, 1.0, 0))
	n["waist"] = ws
	var cy := 1.9 + thh * 0.5
	k.cyl(ws, "F", 1.15, 1.3, 1.1, Vector3(0, 0.45, 0), Vector3.ZERO, 12)
	k.box(ws, "B", Vector3(2.6, 1.3, 2.3), Vector3(0, 1.3, -0.1), Vector3.ZERO, {"tx": 1.15, "tz": 1.1})
	k.box(ws, "A", Vector3(tw, thh, td), Vector3(0, cy, 0), Vector3.ZERO, {"bx": 0.72, "bz": 0.85, "tx": 0.96, "tz": 0.9})
	k.box(ws, "B", Vector3(tw * 0.42, thh * 0.7, 0.9), Vector3(0, cy + 0.1, -td * 0.5 - 0.25), Vector3.ZERO, {"tx": 0.8, "tz": 0.5, "bx": 0.9})
	k.box(ws, "C", Vector3(tw * 0.3, 0.35, 0.2), Vector3(0, cy + thh * 0.2, -td * 0.5 - 0.6))
	for s in [-1.0, 1.0]:
		k.box(ws, "T", Vector3(tw * 0.22, thh * 0.4, 0.5), Vector3(s * tw * 0.33, cy + 0.25, -td * 0.5 + 0.1), Vector3(0.1, 0, 0))
		for i in 3:
			k.box(ws, "B", Vector3(tw * 0.22, 0.1, 0.62), Vector3(s * tw * 0.33, cy + 0.25 + (i - 1) * thh * 0.13, -td * 0.5 + 0.08), Vector3(0.1, 0, 0))
		k.box(ws, "B", Vector3(1.2, 0.9, td * 0.8), Vector3(s * (tw * 0.5 - 0.9), cy + thh * 0.5 + 0.3, 0), Vector3.ZERO, {"tx": 0.6})
		k.cyl(ws, "F", 0.8, 0.8, 1.2, Vector3(s * (tw * 0.5 + 0.3), cy + thh * 0.2, 0), Vector3(0, 0, hz), 10)
		var nf := _mark(ws, Vector3(s * tw * 0.33, cy - thh * 0.3, -td * 0.5 - 0.2), "noz_front_" + ("L" if s < 0.0 else "R"), Vector3(1.0, 0, 0))
		nf.set_meta("rest_y", 0.0)
	_proc_back(k, ws, tw, thh, td, cy)
	_proc_shoulder_weapons(k, ws, tw, thh, td, cy, s1, s2)
	var hd := k.bone(ws, Vector3(0, cy + thh * 0.5 + 0.2, -0.3))
	n["head"] = hd
	_proc_head(k, hd)
	for side in [["L", -1.0], ["R", 1.0]]:
		var s: float = side[1]
		var sn: String = side[0]
		var sh := k.bone(ws, Vector3(s * (tw * 0.5 + 1.0), cy + thh * 0.22, 0))
		_proc_shoulder(k, sh, s, sw)
		_mark(sh, Vector3(s * (0.6 + sw * 0.5), 0.2, 0), "noz_sh_" + sn, Vector3(0, 0, s * 1.2))
		k.box(sh, "B", Vector3(1.3 * aw, UA, 1.4 * aw), Vector3(0, -UA * 0.5 - 0.2, 0), Vector3.ZERO, {"tx": 0.9, "bx": 0.85})
		var el := k.bone(sh, Vector3(0, -UA - 0.3, 0))
		k.cyl(el, "F", 0.6 * aw, 0.6 * aw, 1.5 * aw, Vector3.ZERO, Vector3(0, 0, hz), 8)
		k.box(el, "A", Vector3(1.5 * aw, FA, 1.7 * aw), Vector3(0, -FA * 0.5 - 0.2, 0), Vector3.ZERO, {"tx": 0.85})
		k.box(el, "F", Vector3(1.0, 0.9, 1.1), Vector3(0, -FA - 0.6, 0))
		n["sh_" + sn] = sh
		n["el_" + sn] = el
		var gun: String = r1.get("gun", "") if s > 0.0 else lgun
		if gun != "":
			var mz := _proc_gun(k, el, gun, s)
			muz[sn] = mz
			if s > 0.0:
				muz_r[0] = mz
				muz_r[1] = mz
		if (bl == "L" and s < 0.0) or bl == "both":
			k.box(el, "W", Vector3(0.5, 2.4, 1.0), Vector3(s * 0.95 * aw, -1.6, 0.2))
			k.box(el, "K", Vector3(0.2, 5.4, 0.95), Vector3(s * 1.0 * aw, -FA - 2.0, 0.3), Vector3.ZERO, {"bz": 0.25, "bx": 0.5})
		elif bl == "pile" and s < 0.0:
			k.box(el, "W", Vector3(1.7, 3.8, 1.8), Vector3(s * 1.3, -1.8, 0), Vector3.ZERO, {"bx": 0.85})
			k.cyl(el, "K", 0.34, 0.06, 3.4, Vector3(s * 1.3, -FA - 2.2, 0), Vector3.ZERO, 8)
			k.cyl(el, "F", 0.5, 0.5, 0.8, Vector3(s * 1.3, -FA - 0.6, 0), Vector3.ZERO, 8)
			k.box(el, "H", Vector3(1.75, 0.5, 1.85), Vector3(s * 1.3, -0.5, 0))
		if shield and s < 0.0:
			var sb := k.bone(el, Vector3(s * 1.5, -2.2, -0.4))
			k.box(sb, "A", Vector3(0.45, 7.2, 3.6), Vector3.ZERO, Vector3.ZERO, {"tz": 0.75, "bz": 0.55})
			k.box(sb, "B", Vector3(0.3, 5.2, 0.9), Vector3(s * 0.28, 0, 0))
			k.box(sb, "H", Vector3(0.5, 0.6, 2.4), Vector3(s * 0.05, -2.5, 0))
			k.box(el, "F", Vector3(0.6, 1.2, 1.0), Vector3(s * 1.1, -1.6, -0.2))
			shield_root = sb
			has_shield = true
	var out := k.bake(mats)
	for mi in out:
		mi.layers = layer
		meshes.append(mi)


func _proc_shoulder(k, sh: Node3D, s: float, sw: float) -> void:
	var kind: String = st["sh"]
	if kind == "block":
		k.box(sh, "A", Vector3(sw, sw * 0.95, sw * 1.15), Vector3(s * 0.5, 0.3, 0), Vector3.ZERO, {"tx": 0.8, "tz": 0.8, "bx": 0.92})
		k.box(sh, "B", Vector3(sw * 0.7, 0.3, sw * 0.8), Vector3(s * 0.5, 0.3 + sw * 0.5, 0))
		k.box(sh, "T", Vector3(0.3, sw * 0.4, sw * 0.6), Vector3(s * (0.5 + sw * 0.47), 0.3, 0))
		k.box(sh, "H", Vector3(0.2, 0.4, sw * 0.9), Vector3(s * (0.5 + sw * 0.49), -0.3, 0))
	elif kind == "heavy":
		k.box(sh, "A", Vector3(sw * 1.2, sw * 1.1, sw * 1.35), Vector3(s * 0.6, 0.4, 0), Vector3.ZERO, {"tx": 0.75, "tz": 0.8})
		k.box(sh, "A", Vector3(0.5, sw * 1.5, sw * 1.4), Vector3(s * (0.6 + sw * 0.72), 0.0, 0), Vector3(0, 0, s * 0.2), {"bz": 0.8})
		k.box(sh, "H", Vector3(0.56, 0.5, sw * 1.2), Vector3(s * (0.75 + sw * 0.72), -sw * 0.5, 0), Vector3(0, 0, s * 0.2))
	elif kind == "slim":
		k.box(sh, "A", Vector3(sw * 0.8, sw * 0.8, sw), Vector3(s * 0.4, 0.3, 0), Vector3.ZERO, {"tx": 0.6, "tz": 0.7})
		k.box(sh, "B", Vector3(sw * 0.6, sw * 0.6, sw * 0.9), Vector3(s * 0.6, 0.2, sw * 0.7), Vector3.ZERO, {"tz": 0.8})
		k.box(sh, "C", Vector3(0.15, sw * 0.5, sw * 0.7), Vector3(s * (0.4 + sw * 0.38), 0.35, 0))
	else:
		k.ball(sh, "A", Vector3(sw * 0.75, sw * 0.7, sw * 0.8), Vector3(s * 0.4, 0.3, 0))
		k.box(sh, "B", Vector3(sw * 1.05, 0.35, sw * 1.35), Vector3(s * 0.4, -0.3, 0))
		k.box(sh, "C", Vector3(0.2, 0.5, sw * 0.8), Vector3(s * (0.4 + sw * 0.72), 0.2, 0))


func _proc_gun(k, el: Node3D, gun: String, s: float) -> Node3D:
	var z := -0.9
	var y := -FA
	if gun == "gatling":
		k.cyl(el, "W", 0.9, 0.9, 2.4, Vector3(0, y - 0.6, z), Vector3.ZERO, 12)
		for i in 6:
			var a := TAU * i / 6.0
			k.cyl(el, "T", 0.14, 0.14, 3.4, Vector3(cos(a) * 0.45, y - 3.4, z + sin(a) * 0.45), Vector3.ZERO, 6)
		k.cyl(el, "W", 0.7, 0.7, 0.3, Vector3(0, y - 4.2, z), Vector3.ZERO, 12)
		k.box(el, "F", Vector3(1.2, 1.6, 1.4), Vector3(s * 0.9, y + 0.6, z))
		return _mark(el, Vector3(0, y - 5.2, z))
	if gun == "smg":
		k.box(el, "W", Vector3(0.7, 2.3, 1.0), Vector3(0, y - 0.5, z))
		k.cyl(el, "T", 0.28, 0.28, 1.6, Vector3(0, y - 2.4, z - 0.1), Vector3.ZERO, 8)
		k.box(el, "F", Vector3(0.45, 1.5, 0.6), Vector3(0, y - 0.6, z - 0.8))
		return _mark(el, Vector3(0, y - 3.3, z - 0.1))
	if gun == "shotgun":
		k.box(el, "W", Vector3(0.9, 2.6, 1.1), Vector3(0, y - 0.6, z))
		for x in [-0.22, 0.22]:
			k.cyl(el, "T", 0.24, 0.24, 2.2, Vector3(x, y - 2.9, z - 0.1), Vector3.ZERO, 8)
		return _mark(el, Vector3(0, y - 4.1, z - 0.1))
	k.box(el, "W", Vector3(0.7, 3.4, 1.0), Vector3(0, y - 0.8, z))
	k.cyl(el, "T", 0.2, 0.2, 3.0, Vector3(0, y - 3.9, z - 0.1), Vector3.ZERO, 8)
	k.cyl(el, "W", 0.32, 0.32, 0.6, Vector3(0, y - 5.3, z - 0.1), Vector3.ZERO, 8)
	k.box(el, "F", Vector3(0.5, 1.0, 1.2), Vector3(0, y + 0.4, z - 0.8))
	k.box(el, "W", Vector3(0.5, 1.6, 0.8), Vector3(0, y + 1.4, z))
	return _mark(el, Vector3(0, y - 5.7, z - 0.1))


func _proc_back(k, ws: Node3D, tw: float, thh: float, td: float, cy: float) -> void:
	var kind: String = st["back"]
	var zb := td * 0.5
	var bw := 0.62
	var bd := 1.6
	if kind == "heavy":
		bw = 0.75
		bd = 2.2
	elif kind == "wing":
		bw = 0.55
		bd = 1.3
	k.box(ws, "B", Vector3(tw * bw, thh * 0.95, bd), Vector3(0, cy + 0.1, zb + bd * 0.45), Vector3.ZERO, {"tz": 0.8})
	for x in [-1.0, 1.0]:
		var sn := "L" if x < 0.0 else "R"
		k.box(ws, "A", Vector3(1.3, thh * 0.7, 1.0), Vector3(x * 1.05, cy + 0.2, zb + bd), Vector3.ZERO, {"tx": 0.8})
		var nb: Node3D = k.bone(ws, Vector3(x * 1.1, cy - 1.3, zb + bd + 0.5))
		nb.rotation.x = -0.85
		k.cyl(nb, "T", 0.55, 0.95, 1.3, Vector3(0, 0.65, 0), Vector3.ZERO, 10)
		n["noz_back_" + sn] = nb
		if kind == "heavy":
			var nb2: Node3D = k.bone(ws, Vector3(x * 1.2, cy + 0.2, zb + bd + 0.7))
			nb2.rotation.x = -1.0
			k.cyl(nb2, "T", 0.5, 0.85, 1.1, Vector3(0, 0.55, 0), Vector3.ZERO, 10)
			n["noz_back_2" + sn] = nb2
		elif kind == "wing":
			var bn: Node3D = k.bone(ws, Vector3(x * 1.6, cy + 0.6, zb + 1.2))
			bn.rotation = Vector3(-0.45, 0, x * 0.5)
			k.box(bn, "A", Vector3(0.4, 6.0, 2.3), Vector3(x * 0.4, 0.6, 0.9), Vector3.ZERO, {"bz": 0.45, "tz": 0.8})
			k.box(bn, "C", Vector3(0.44, 0.5, 1.9), Vector3(x * 0.4, 3.0, 0.9))
			n["binder_" + sn] = bn


func _proc_shoulder_weapons(k, ws: Node3D, tw: float, thh: float, td: float, cy: float, s1: String, s2: String) -> void:
	var top := cy + thh * 0.5
	var hz := PI * 0.5
	if s1 == "bazooka":
		var x := tw * 0.5 - 0.6
		k.cyl(ws, "W", 0.6, 0.6, 7.5, Vector3(x, top + 1.2, -0.3), Vector3(hz, 0, 0), 12)
		k.cyl(ws, "W", 0.9, 0.6, 0.9, Vector3(x, top + 1.2, 3.8), Vector3(hz, 0, 0), 12)
		k.cyl(ws, "T", 0.72, 0.72, 0.5, Vector3(x, top + 1.2, -4.0), Vector3(hz, 0, 0), 12)
		k.box(ws, "F", Vector3(0.9, 1.2, 1.4), Vector3(x, top + 0.5, 0.3))
		muz["S1"] = _mark(ws, Vector3(x, top + 1.2, -4.5))
	elif s1 == "howitzer":
		var x := tw * 0.5 - 0.8
		k.box(ws, "W", Vector3(2.2, 1.7, 3.2), Vector3(x, top + 1.0, 0.7), Vector3.ZERO, {"tx": 0.85})
		k.cyl(ws, "W", 0.5, 0.62, 9.0, Vector3(x, top + 1.5, -3.2), Vector3(hz, 0, 0), 12)
		k.cyl(ws, "F", 0.75, 0.75, 2.2, Vector3(x, top + 1.5, -0.6), Vector3(hz, 0, 0), 12)
		k.box(ws, "T", Vector3(1.5, 1.0, 1.3), Vector3(x, top + 1.5, -7.5))
		muz["S1"] = _mark(ws, Vector3(x, top + 1.5, -8.3))
	if s2 == "pod":
		var x := -(tw * 0.5 - 0.8)
		k.box(ws, "B", Vector3(2.6, 1.9, 3.2), Vector3(x, top + 1.1, 0.2), Vector3(0.2, 0, 0))
		k.box(ws, "T", Vector3(2.3, 1.6, 0.2), Vector3(x, top + 1.42, -1.38), Vector3(0.2, 0, 0))
		k.box(ws, "F", Vector3(1.0, 0.8, 1.2), Vector3(x, top + 0.2, 0.4))
		muz["S2"] = _mark(ws, Vector3(x, top + 1.6, -1.9))
	elif s2 == "rockets":
		for x in [-1.0, 1.0]:
			k.box(ws, "W", Vector3(1.0, 1.0, 3.4), Vector3(x * (tw * 0.5 - 0.3), top + 0.7, 0.5), Vector3(0.12, 0, 0))
			k.box(ws, "T", Vector3(0.8, 0.8, 0.2), Vector3(x * (tw * 0.5 - 0.3), top + 0.9, -1.18), Vector3(0.12, 0, 0))
		muz["S2"] = _mark(ws, Vector3(0, top + 1.2, -1.6))


func _proc_head(k, hd: Node3D) -> void:
	var kind: String = st["head"]
	if kind == "visor":
		k.box(hd, "A", Vector3(1.7, 1.3, 1.9), Vector3(0, 0.75, 0), Vector3.ZERO, {"tx": 0.8, "tz": 0.8})
		k.box(hd, "G", Vector3(1.5, 0.28, 0.25), Vector3(0, 0.8, -0.9))
		k.box(hd, "B", Vector3(1.75, 0.3, 0.7), Vector3(0, 1.08, -0.8), Vector3.ZERO, {"tz": 0.6})
		k.box(hd, "F", Vector3(0.1, 2.3, 0.12), Vector3(0.95, 1.6, 0.3), Vector3(0.25, 0, 0))
	elif kind == "turret":
		k.box(hd, "A", Vector3(2.5, 1.0, 2.5), Vector3(0, 0.6, 0), Vector3.ZERO, {"tx": 0.8, "tz": 0.8})
		k.box(hd, "G", Vector3(1.2, 0.3, 0.3), Vector3(-0.2, 0.62, -1.2))
		k.box(hd, "B", Vector3(1.3, 0.3, 1.7), Vector3(0.2, 1.22, 0.1))
	elif kind == "wedge":
		k.box(hd, "A", Vector3(1.3, 1.2, 2.4), Vector3(0, 0.7, -0.2), Vector3.ZERO, {"tx": 0.6, "tz": 0.7, "bx": 0.9})
		k.box(hd, "G", Vector3(0.9, 0.16, 0.2), Vector3(0, 0.75, -1.36))
		k.box(hd, "C", Vector3(0.12, 1.4, 2.6), Vector3(-0.55, 1.5, 0.5), Vector3.ZERO, {"tz": 0.3, "sz": 0.9})
	elif kind == "dome":
		k.ball(hd, "A", Vector3(1.1, 0.95, 1.1), Vector3(0, 0.8, 0))
		k.box(hd, "G", Vector3(1.5, 0.2, 0.5), Vector3(0, 0.78, -0.8))
		k.box(hd, "B", Vector3(0.15, 0.5, 1.5), Vector3(0, 1.7, 0))
	else:
		k.box(hd, "A", Vector3(1.4, 1.3, 2.2), Vector3(0, 0.7, -0.1), Vector3.ZERO, {"tx": 0.55, "tz": 0.7})
		k.box(hd, "G", Vector3(0.18, 0.7, 0.2), Vector3(0, 0.72, -1.16))
		k.box(hd, "G", Vector3(1.0, 0.1, 0.2), Vector3(0, 0.98, -1.1))
		for x in [-1.0, 1.0]:
			k.box(hd, "C", Vector3(0.1, 1.7, 2.8), Vector3(x * 0.62, 1.5, 0.6), Vector3(0, 0, -x * 0.3), {"tz": 0.3, "sz": 1.0})


# ------------------------------------------------------------------ state changes
# Cockpit view. Cameras all over the hull are stitched into one picture seen from the seat in
# the chest, so the frame's own body is not drawn solid: every body mesh moves to a layer the
# cockpit camera skips (it keeps casting its shadow) and a line-work copy of it is shown
# instead (shaders/ghost.gdshader). What attacks stays solid - the weapon in the hand, blades,
# and of course shots, beams and sword arcs; shoulder weapons and shields count as body, or
# they would wall off part of the picture. The hidden body stops casting shadows meanwhile so
# the weapon the pilot does see is lit like everything else.
const WEAPON_MOUNTS := ["mount_hand_R", "mount_hand_L", "mount_blade_L", "mount_blade_R", "wrist_L", "wrist_R", "grip_L", "grip_R"]

func _is_weapon_mesh(mi: Node) -> bool:
	var q: Node = mi
	while q != null and q != self:
		if q.has_meta("equip"):
			var mt := str(q.get_meta("equip"))
			return mt in WEAPON_MOUNTS or (mt == "mount_arm_L" and not has_shield)
		q = q.get_parent()
	return false


func set_cockpit(on: bool, hide_layer: int, ghost_layer: int = 1 << 18) -> void:
	_pit_hide = hide_layer if on else 0
	_sword_hid.clear()
	for arm in grips:
		for mi in (grips[arm] as Node3D).find_children("*", "MeshInstance3D", true, false):
			(mi as MeshInstance3D).layers = layer
	pit_view = on
	if on and _ghost_mat == null:
		_ghost_mat = ShaderMaterial.new()
		_ghost_mat.shader = load("res://shaders/ghost.gdshader")
		_ghost_mat.set_shader_parameter("tint", Color(glow_col.r * 0.5 + 0.2, glow_col.g * 0.5 + 0.45, glow_col.b * 0.5 + 0.3))
	for e in _pit_extra:
		if is_instance_valid(e):
			(e as MeshInstance3D).layers = hide_layer if on else layer
	# painted markings go with the body they are on
	for lb in find_children("*", "Label3D", true, false):
		(lb as Label3D).layers = hide_layer if on else layer
	for mi in meshes:
		if not is_instance_valid(mi) or _is_weapon_mesh(mi):
			continue
		mi.layers = hide_layer if on else layer
		if on:
			if not mi.has_meta("cs0"):
				mi.set_meta("cs0", mi.cast_shadow)
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		elif mi.has_meta("cs0"):
			mi.cast_shadow = mi.get_meta("cs0")
		var g: MeshInstance3D = mi.get_meta("ghost") if mi.has_meta("ghost") else null
		if on and g == null:
			g = MeshInstance3D.new()
			g.mesh = mi.mesh
			g.material_override = _ghost_mat
			g.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			g.layers = ghost_layer
			mi.add_child(g)
			mi.set_meta("ghost", g)
		if g != null:
			g.visible = on


func set_wreck() -> void:
	for mi in meshes:
		if not is_instance_valid(mi):
			continue
		var key: String = mi.get_meta("key", "A")
		if key == "G":
			mi.visible = false
		elif key != "K":
			mi.set_instance_shader_parameter("wreck", 1.0)
	for pm in plumes:
		pm.visible = false
	blade_mat.emission_energy_multiplier = 0.0


func kick_skirts(amount: float) -> void:
	for s in skirts:
		s["w"] += amount * randf_range(0.6, 1.3)


# ------------------------------------------------------------------ gait
func _ground_normal(ground: Callable, p: Vector3) -> Vector3:
	var e := 1.2
	var hx: float = float(ground.call(p.x + e, p.z)) - float(ground.call(p.x - e, p.z))
	var hz: float = float(ground.call(p.x, p.z + e)) - float(ground.call(p.x, p.z - e))
	return Vector3(-hx, 2.0 * e, -hz).normalized()


func _sole(lg: Leg) -> Vector3:
	return lg.ankle.global_transform * Vector3(0, -foot_h, 0)


# Plants and steps the feet in world space. active = feet are supposed to carry the frame.
func gait(dt: float, yaw: float, vel: Vector3, ground: Callable, active: bool) -> void:
	steps.clear()
	if not active:
		gait_on = false
		return
	var root := global_position
	var right := Vector3(cos(yaw), 0, -sin(yaw))
	var stance_w := hip_w + 0.2
	if not gait_on:
		gait_on = true
		for lg in legs:
			var p := _sole(lg)
			lg.pos = Vector3(p.x, float(ground.call(p.x, p.z)), p.z)
			lg.cur = p
			lg.yaw = yaw
			lg.cur_yaw = yaw
			lg.swing = false
			lg.armed = true
			lg.nrm = _ground_normal(ground, lg.pos)
			# drop from wherever the foot is onto the ground with a short settle step
			if p.y - lg.pos.y > 0.4 or Vector3(p.x - root.x, 0, p.z - root.z).length() > th + sh_len:
				lg.pos = root + right * (lg.side * stance_w)
				lg.pos.y = float(ground.call(lg.pos.x, lg.pos.z))
				lg.swing = true
				lg.t = 0.55
				lg.dur = 0.22
				lg.lift = 0.0
				lg.from = p
				lg.from_yaw = yaw
	var hv := Vector3(vel.x, 0, vel.z)
	var sp := hv.length()
	var moving := sp > 1.2
	var leg_len := th + sh_len
	var kk := clampf(sp / walk_ref, 0.0, 1.0)
	var stride := lerpf(leg_len * 1.0, leg_len * 2.35, kk)
	if moving:
		stride *= 1.0 - 0.45 * absf(hv.dot(right)) / sp
	# ready stance: left foot ahead, right foot back, a little wider than the hips;
	# it fades out as the frame gets up to walking speed
	var rest := 1.0 - kk
	stance_w += 0.42 * rest
	var fwd_v := Vector3(-sin(yaw), 0, -cos(yaw))
	var cadence := sp / stride
	var sw_dur := clampf((1.0 - BETA) / maxf(cadence, 0.01), 0.22, 0.5)
	if moving:
		phase = fposmod(phase + cadence * dt, 1.0)
	for i in 2:
		var lg: Leg = legs[i]
		var other: Leg = legs[1 - i]
		var home := root + right * (lg.side * stance_w) - fwd_v * (lg.side * (0.95 - foot_bias) * rest)
		if lg.swing:
			lg.t += dt / lg.dur
			var tt := clampf(lg.t, 0.0, 1.0)
			var tgt := home
			if moving:
				tgt += hv * (maxf(0.0, 1.0 - tt) * lg.dur) + hv / sp * (BETA * stride * 0.5)
			var lx := (tgt - root).dot(right) * lg.side
			if lx < 0.8:
				tgt += right * (lg.side * (0.8 - lx))
			tgt.y = float(ground.call(tgt.x, tgt.z))
			var s := tt * tt * (3.0 - 2.0 * tt)
			lg.cur = lg.from.lerp(tgt, s)
			lg.cur.y = lerpf(lg.from.y, tgt.y, s) + sin(PI * tt) * lg.lift
			lg.cur_yaw = lerp_angle(lg.from_yaw, yaw, s)
			lg.pitch = -sin(TAU * tt) * 0.38 * clampf(lg.lift, 0.0, 1.0)
			lg.nrm = lg.nrm.lerp(Vector3.UP, 0.2)
			if lg.t >= 1.0:
				lg.swing = false
				lg.pos = tgt
				lg.cur = tgt
				lg.yaw = yaw
				lg.cur_yaw = yaw
				lg.pitch = 0.0
				lg.nrm = _ground_normal(ground, tgt)
				steps.append(lg)
		else:
			lg.cur = lg.pos
			lg.cur_yaw = lg.yaw
			var err := lg.pos - home
			err.y = 0.0
			var el := err.length()
			var start := false
			if el > leg_len * 2.6:
				# teleported: snap
				lg.pos = Vector3(home.x, float(ground.call(home.x, home.z)), home.z)
				lg.cur = lg.pos
				lg.yaw = yaw
				lg.cur_yaw = yaw
				continue
			if el > leg_len * 0.92 and (not other.swing or other.t > 0.5):
				start = true
			elif moving:
				var ph := fposmod(phase + (0.0 if i == 0 else 0.5), 1.0)
				if ph < BETA:
					lg.armed = true
				elif lg.armed and (not other.swing or other.t > 0.7):
					start = true
					lg.armed = false
			elif not other.swing and (el > 0.9 or absf(U.ang_diff(lg.yaw, yaw)) > 0.4):
				start = true
			if start:
				lg.swing = true
				lg.t = 0.0
				lg.from = lg.pos
				lg.from_yaw = lg.yaw
				lg.dur = sw_dur if moving else 0.4
				lg.lift = lerpf(0.8, 2.0, kk) if moving else 0.9


func _foot_basis(yaw: float, nrm: Vector3, pitch: float) -> Basis:
	var up := (Vector3.UP * 0.3 + nrm * 0.7).normalized()
	var back := Vector3(sin(yaw), 0, cos(yaw))
	var x := up.cross(back).normalized()
	var z := x.cross(up)
	return Basis(x, up, z) * Basis(Vector3.RIGHT, pitch)


func _solve_leg(lg: Leg, w: float, fk_hip: Basis, fk_knee: float, fk_ankle: float) -> void:
	var hip_b := fk_hip
	var knee_x := fk_knee
	if w > 0.001:
		var fb := _foot_basis(lg.cur_yaw, lg.nrm, lg.pitch)
		var ankle_w := lg.cur + fb.y * foot_h
		var inv := pelvis.global_transform.affine_inverse()
		var a := inv * ankle_w
		var d := a - lg.hip.position
		var dl := d.length()
		var dist := clampf(dl, absf(th - sh_len) + 0.3, (th + sh_len) * 0.996)
		var y := -d / maxf(dl, 0.01)
		var ax := (Vector3.RIGHT * 0.55 + (inv.basis * fb.x) * 0.45).normalized()
		var x := ax - y * ax.dot(y)
		if x.length_squared() < 0.0001:
			x = Vector3.RIGHT
		x = x.normalized()
		var z := x.cross(y)
		var alpha := acos(clampf((th * th + dist * dist - sh_len * sh_len) / (2.0 * th * dist), -1.0, 1.0))
		var beta := acos(clampf((sh_len * sh_len + dist * dist - th * th) / (2.0 * sh_len * dist), -1.0, 1.0))
		var ik_hip := Basis(x, y, z) * Basis(Vector3.RIGHT, alpha)
		var ik_knee := -(alpha + beta)
		if w >= 0.999:
			hip_b = ik_hip
			knee_x = ik_knee
		else:
			hip_b = Basis(Quaternion(fk_hip).slerp(Quaternion(ik_hip.orthonormalized()), w))
			knee_x = lerpf(fk_knee, ik_knee, w)
		lg.hip.basis = hip_b
		lg.knee.rotation = Vector3(knee_x, 0, 0)
		var local := (lg.knee.global_transform.basis.orthonormalized().inverse() * fb).orthonormalized()
		if w >= 0.999:
			lg.ankle.basis = local
		else:
			lg.ankle.basis = Basis(Quaternion(Basis(Vector3.RIGHT, fk_ankle)).slerp(Quaternion(local), w))
	else:
		lg.hip.basis = hip_b
		lg.knee.rotation = Vector3(knee_x, 0, 0)
		lg.ankle.rotation = Vector3(fk_ankle, 0, 0)


# ------------------------------------------------------------------ pose
func _rot(node: Node3D, x: float, y: float, z: float, k: float) -> void:
	var r := node.rotation
	node.rotation = Vector3(lerpf(r.x, x, k), lerpf(r.y, y, k), lerpf(r.z, z, k))


func _ease(t: float) -> float:
	t = clampf(t, 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)


# Blade work. Every move is three whole-body keys - the coil before the blow, the instant the
# blade lands, and the end of the cut-through - and a blow starts from and comes back to the
# on-guard key. Channels are written for the striking side; the code mirrors them.
#   SX shoulder pitch (0 hanging, 1.5 level forward, 2.9 overhead)    SZ arm out from the body (- = across it)
#   SY shoulder yaw, + swings the raised arm outward                  EX elbow bend
#   WR wrist: angle between blade and forearm (0 = in line)           WA which way the blade leans off the forearm:
#                                                                        0 front, 1.57 outward, 3.14 back, -1.57 inward
#   TW chest turned back (+ = striking shoulder away from the target) LN chest leans forward
#   SD chest bends to the striking side                               PY hips turned back; they lead the chest
#   DP hips sink (in leg lengths)                                     LS stride: + the striking side's foot leads, - the other
#   OX OZ OE the other arm: shoulder pitch, out from the body, elbow
enum {SX, SZ, SY, EX, WR, WA, TW, LN, SD, PY, DP, LS, OX, OZ, OE, CH_N}
# sword drawn and low at the side, wrist pressed down so the point slants to the ground
const GUARD_KEY := [-0.12, 0.40, 0.0, 0.22, 0.72, 1.25, 0.25, 0.02, 0.0, 0.30, 0.03, -0.35, 0.4, 0.2, 0.9]
# the same arm in a dash: swept back, the blade trailing
const TRAIL_ARM := [-0.5, 0.5, 0.0, 0.35, 0.5, 2.5]
# a light energy sabre is not dragged: the hand stays low at the side, the wrist pressed down,
# and the point is held out in front toward the enemy - standing and in a dash alike
const SABRE_KEY := [-0.10, 0.30, 0.0, 0.30, 1.15, 0.25, 0.25, 0.02, 0.0, 0.30, 0.03, -0.35, 0.4, 0.2, 0.9]
const SABRE_TRAIL := [-0.35, 0.45, 0.0, 0.5, 1.3, 0.2]
const PATHS := {
	# overhead cut: rise onto the back foot, then drop the whole frame into the blow
	"down": [
		[2.85, 0.25, 0.0, 0.9, 1.5, 0.0, 0.45, -0.18, 0.0, 0.25, -0.02, 0.2, 0.9, 0.2, 0.6],
		[1.0, 0.1, 0.0, 0.3, 0.45, 0.0, -0.25, 0.3, 0.0, -0.2, 0.12, 0.8, -0.2, 0.3, 1.2],
		[0.45, 0.0, 0.0, 0.15, 0.6, 0.0, -0.45, 0.5, 0.0, -0.3, 0.2, 0.9, -0.45, 0.35, 1.0]],
	# shoulder-to-hip cut across the body: coiled over the back leg, the hips throw it
	"diag_in": [
		[2.5, 0.9, 0.3, 1.0, 1.45, 0.5, 0.9, -0.12, 0.12, 0.5, 0.0, -0.5, 1.0, 0.1, 0.5],
		[1.05, 0.0, -0.2, 0.35, 0.6, 0.6, -0.3, 0.25, -0.12, -0.3, 0.12, -0.85, -0.1, 0.3, 1.2],
		[0.5, -0.6, -0.3, 0.25, 0.6, 0.9, -0.9, 0.45, -0.22, -0.5, 0.2, -0.95, -0.5, 0.4, 1.0]],
	# the backhand of it
	"diag_out": [
		[2.4, -0.6, -0.3, 1.3, 1.4, -0.6, -0.7, -0.08, -0.1, -0.4, 0.0, 0.5, 0.3, 0.3, 1.0],
		[1.3, 0.3, 0.2, 0.4, 0.8, -0.6, 0.2, 0.22, 0.1, 0.2, 0.1, 0.8, 0.3, 0.2, 1.1],
		[0.55, 0.95, 0.3, 0.2, 0.6, -0.8, 0.7, 0.35, 0.2, 0.4, 0.16, 0.9, 0.6, 0.1, 0.9]],
	# rising cut: starts crouched with the point trailing low, the legs straighten through it
	"rise_in": [
		[-0.35, 0.75, 0.0, 0.3, 0.6, 2.6, 0.8, 0.3, 0.15, 0.45, 0.2, -0.6, 0.9, 0.1, 0.8],
		[1.2, 0.1, 0.0, 0.35, 0.45, 2.9, -0.2, 0.1, 0.0, -0.25, 0.08, -0.8, 0.0, 0.3, 1.2],
		[2.5, -0.45, 0.0, 0.3, 0.55, 3.14, -0.75, -0.15, -0.1, -0.4, -0.03, -0.7, -0.4, 0.4, 0.9]],
	"rise_out": [
		[0.3, -0.55, -0.2, 0.7, 0.6, -2.6, -0.6, 0.3, -0.12, -0.4, 0.2, 0.5, 0.2, 0.3, 1.0],
		[1.25, 0.3, 0.0, 0.35, 0.45, -2.9, 0.15, 0.08, 0.0, 0.15, 0.08, 0.8, 0.4, 0.2, 1.0],
		[2.5, 0.95, 0.0, 0.25, 0.55, -3.14, 0.65, -0.15, 0.12, 0.35, -0.03, 0.8, 0.7, 0.1, 0.8]],
	# level sweep: the arm is carried round by the turning body, the wrist whips last
	"sweep": [
		[1.45, 0.0, 1.35, 0.5, 1.35, 1.57, 1.0, 0.0, 0.05, 0.55, 0.06, -0.6, 0.9, 0.0, 0.7],
		[1.45, 0.0, 0.15, 0.25, 0.7, 1.57, -0.2, 0.15, 0.0, -0.3, 0.12, -0.85, -0.1, 0.4, 1.2],
		[1.4, 0.0, -0.85, 0.4, 0.45, 1.57, -0.95, 0.25, -0.1, -0.55, 0.16, -0.9, -0.5, 0.5, 1.0]],
	# lunge: hilt drawn back to the hip, then the whole frame goes in behind the point
	"thrust": [
		[-0.45, 0.3, 0.0, 1.75, 0.3, 0.0, 0.7, -0.05, 0.0, 0.45, 0.1, 0.0, 1.2, 0.0, 0.4],
		[1.3, 0.05, 0.0, 0.2, 0.3, 0.0, -0.75, 0.3, 0.0, -0.5, 0.18, 1.0, -0.5, 0.3, 0.7],
		[1.4, 0.0, 0.0, 0.08, 0.25, 0.0, -0.9, 0.42, 0.0, -0.55, 0.22, 1.1, -0.7, 0.35, 0.5]],
}
# the frame uncoils from the ground up: hips first, then the chest, the arm, and the wrist last
const CHAIN := [0.0, 0.0, 0.0, 0.0, -0.025, -0.025, 0.02, 0.02, 0.02, 0.035, 0.035, 0.035, 0.01, 0.01, 0.01]
static var dbg_key := []      # test: hold every frame in this key ([path, phase])


# the whole-body key of a blow at phase p (0..1); the blade lands at 0.47
func _melee_pose(path: String, p: float, charge: float = 0.0) -> Array:
	var kf: Array = PATHS.get(path, PATHS["down"])
	var wu: Array = (kf[0] as Array).duplicate()
	var hit: Array = (kf[1] as Array).duplicate()
	var fol: Array = (kf[2] as Array).duplicate()
	# a charged blow is coiled further and driven deeper
	wu[TW] += 0.35 * signf(wu[TW]) * charge
	wu[PY] += 0.2 * signf(wu[PY]) * charge
	wu[LN] -= 0.1 * charge
	wu[DP] += 0.08 * charge
	wu[WR] += 0.15 * charge
	for kk in [hit, fol]:
		kk[TW] += 0.2 * signf(kk[TW]) * charge
		kk[LN] += 0.1 * charge
		kk[DP] += 0.05 * charge
	var lead := clampf((p - 0.36) / 0.03, 0.0, 1.0)
	var out := []
	out.resize(CH_N)
	for i in CH_N:
		var q := p + float(CHAIN[i]) * lead
		var ka: Array
		var kb: Array
		var t: float
		if q < 0.36:
			ka = guard_key
			kb = wu
			t = _ease(q / 0.36)
		elif q < 0.47:
			ka = wu
			kb = hit
			t = pow((q - 0.36) / 0.11, 1.5)
		elif q < 0.6:
			ka = hit
			kb = fol
			t = (q - 0.47) / 0.13
			t = 1.0 - (1.0 - t) * (1.0 - t)
		else:
			ka = fol
			kb = guard_key
			t = _ease((q - 0.6) / 0.4)
		out[i] = lerpf(float(ka[i]), float(kb[i]), t)
	return out


func pose(a: Anim, dt: float) -> void:
	var k := 1.0 - exp(-(32.0 if a.melee_on else 14.0) * dt)
	# a hand-held sword lives on its rack until it is drawn (for a blow, or with an enemy in reach)
	for arm in grips:
		var rk = racks.get(arm)
		if rk == null:
			continue
		var stow: bool = not (a.blade > 0.5 or a.melee_on or a.blade_show > 0.5)
		if stow != bool(_stowed.get(arm, false)):
			_stowed[arm] = stow
			var g: Node3D = grips[arm]
			g.get_parent().remove_child(g)
			((rk as Node3D) if stow else (wrists[arm] as Node3D)).add_child(g)
		# from the seat, a sword held up behind the raised shield would stand right across the
		# picture: it is not drawn there until the shield comes down or the blow starts
		var hide: bool = _pit_hide != 0 and has_shield and a.guard > 0.5 and not a.melee_on and not stow
		if hide != bool(_sword_hid.get(arm, false)):
			_sword_hid[arm] = hide
			for mi in (grips[arm] as Node3D).find_children("*", "MeshInstance3D", true, false):
				(mi as MeshInstance3D).layers = _pit_hide if hide else layer
	var b := a.boost
	var ar := a.air * (1.0 - b)
	var dn := a.down
	ikw = U.damp(ikw, 1.0 if gait_on else 0.0, 18.0, dt)
	var w := ikw * (1.0 - dn)
	var fwd := maxf(a.mvz, 0.0)
	var bck := maxf(-a.mvz, 0.0)
	var fall := clampf(-a.vy / 26.0, 0.0, 1.0)
	var lg_l: Leg = legs[0]
	var lg_r: Leg = legs[1]

	# ---- blade work: the whole-body key of this instant
	var ms := float(a.melee_arm)
	var sword_s := 0.0
	if wrists.has("L"):
		sword_s = -1.0
	elif wrists.has("R"):
		sword_s = 1.0
	var in_blow := a.melee_on
	var mp: Array = guard_key
	if not dbg_key.is_empty():
		in_blow = true
		mp = _melee_pose(str(dbg_key[0]), float(dbg_key[1]), float(dbg_key[2]) if dbg_key.size() > 2 else 0.0)
		k = 1.0 - exp(-32.0 * dt)
	elif a.melee_on:
		mp = _melee_pose(a.melee_path, a.melee_t, a.mcharge)
	# on guard with the sword drawn: side-on, sword side back. Fades with speed.
	var gw := 0.0
	if sword_s != 0.0 and not in_blow:
		gw = a.blade * (1.0 - b) * (1.0 - a.air) * (1.0 - a.stagger)
	_bw = U.damp(_bw, 1.0 if in_blow else gw, 16.0 if in_blow else 8.0, dt)
	var bw := _bw * (1.0 - dn)
	var bs: float = ms if (in_blow or sword_s == 0.0) else sword_s

	# ---- FK leg targets: standing / dash / airborne / down
	var d_hl := lerpf(-0.1, -0.55, fwd) + 0.45 * bck
	var d_hr := lerpf(0.05, 0.5, fwd) + 0.3 * bck
	var d_kl := -0.5 - 0.3 * fwd + 0.1 * bck
	var d_kr := -0.6 - 0.6 * fwd + 0.15 * bck
	var a_hl := lerpf(-0.18, 0.42, fall)
	var a_hr := lerpf(0.12, 0.3, fall)
	var a_kl := lerpf(-0.3, -0.95, fall)
	var a_kr := lerpf(-0.55, -0.8, fall)
	var hl := lerpf(lerpf(lerpf(0.12, d_hl, b), a_hl, ar), 1.2, dn) + a.stagger * 0.15
	var hr := lerpf(lerpf(lerpf(0.12, d_hr, b), a_hr, ar), 1.05, dn) + a.stagger * 0.1
	var kl := lerpf(lerpf(lerpf(-0.25, d_kl, b), a_kl, ar), -2.1, dn) - a.stagger * 0.3
	var kr := lerpf(lerpf(lerpf(-0.25, d_kr, b), a_kr, ar), -1.9, dn) - a.stagger * 0.25
	var toe := (0.45 * b + 0.55 * ar * (1.0 - fall)) * (1.0 - dn)
	# a blow is thrown from the legs: the frame lunges onto the leading foot, the other leg drives
	if bw > 0.001:
		var ls := float(mp[LS])
		var la := absf(ls)
		var dp := maxf(float(mp[DP]), 0.0)
		var h_f := 0.12 + 0.78 * la + 0.5 * dp
		var k_f := -(0.3 + 0.85 * la + 1.6 * dp)
		var h_b := 0.1 - 0.72 * la
		var k_b := -(0.22 + 0.2 * la + 0.6 * dp)
		var lead_r: bool = ls * bs > 0.0
		hl = lerpf(hl, h_b if lead_r else h_f, bw)
		kl = lerpf(kl, k_b if lead_r else k_f, bw)
		hr = lerpf(hr, h_f if lead_r else h_b, bw)
		kr = lerpf(kr, k_f if lead_r else k_b, bw)
		toe *= 1.0 - bw
	var zl := -(0.07 + 0.3 * maxf(-a.mvx, 0.0) * b + 0.08 * ar) * (1.0 - dn)
	var zr := (0.07 + 0.3 * maxf(a.mvx, 0.0) * b + 0.08 * ar) * (1.0 - dn)
	var fk_l := Basis.from_euler(Vector3(hl, 0, zl))
	var fk_r := Basis.from_euler(Vector3(hr, 0, zr))

	# ---- pelvis
	var ext := maxf(th * cos(hl) + sh_len * cos(hl + kl), th * cos(hr) + sh_len * cos(hr + kr))
	var ready := 0.42 * (1.0 - b) * (1.0 - a.air)
	var py_fk := lerpf(hip_y - 0.3 * b - a.crouch - ready, ext + foot_h + 0.1 - hip_off, dn)
	# in a lunge the frame rides as low as its spread legs put it
	py_fk = lerpf(py_fk, minf(py_fk, ext + foot_h - hip_off), bw)
	var py := py_fk
	var hard := 1e9
	var sway := 0.0
	var roll := 0.0
	var pyaw := 0.0
	if w > 0.001:
		var lim := hip_y - a.land * 1.8 - a.stagger * 0.8 - a.crouch - ready - float(mp[DP]) * bw * (th + sh_len)
		var reach := (th + sh_len) * 0.985
		var inv := global_transform.affine_inverse()
		var fz := [0.0, 0.0]
		for i in 2:
			var lg: Leg = legs[i]
			var al: Vector3 = inv * lg.cur + Vector3(0, foot_h, 0)
			var dx := al.x - lg.side * hip_w - pelvis.position.x
			var dz := al.z - pelvis.position.z
			var hy := al.y + sqrt(maxf(reach * reach - dx * dx - dz * dz, 1.0)) - hip_off
			hard = minf(hard, hy)
			fz[i] = al.z
			if lg.swing:
				var up := sin(PI * clampf(lg.t, 0.0, 1.0))
				sway -= lg.side * 0.28 * up
				roll += lg.side * 0.045 * up
		lim = minf(lim, hard)
		py = lerpf(py_fk, lim, w)
		pyaw = clampf((float(fz[1]) - float(fz[0])) * 0.014, -0.16, 0.16) * w * (1.0 - bw)
	# the hips turn with the blow, ahead of the chest
	pyaw -= bs * float(mp[PY]) * bw
	var ny := U.damp(pelvis.position.y, py, 22.0, dt)
	if w > 0.9:
		ny = minf(ny, hard)
	pelvis.position = Vector3(U.damp(pelvis.position.x, sway * w, 7.0, dt), ny, 0)
	pelvis.rotation = Vector3(0, U.damp(pelvis.rotation.y, pyaw, 26.0 if in_blow else 9.0, dt), U.damp(pelvis.rotation.z, roll * w, 8.0, dt))

	# ---- legs
	_solve_leg(lg_l, w, fk_l, kl, -(hl + kl) - toe)
	_solve_leg(lg_r, w, fk_r, kr, -(hr + kr) - toe)
	_update_skirts(a, dt)
	foot_bias = bs * float(mp[LS]) * bw * (th + sh_len) * 0.65

	# ---- torso / head
	var idle := sin(a.idle_t * 0.9) * 0.012
	# the on-guard turn gives way while the gun is up, so the shot still goes where it is aimed
	var tk := bw * (1.0 if in_blow else 1.0 - 0.75 * a.fire)
	var tws: float = a.twist - bs * float(mp[TW]) * tk
	var lean: float = float(mp[LN]) * bw
	var bend: float = -bs * float(mp[SD]) * bw
	var up_x := b * 0.25 * a.mvz * (1.0 - dn)
	var up_z := b * 0.22 * a.mvx * (1.0 - dn)
	_rot(waist, a.pitch * 0.3 + a.stagger * 0.35 + up_x - lean - dn * 0.55 + idle + a.charge * 0.04, tws - pelvis.rotation.y, -pelvis.rotation.z + up_z + bend, k)
	# the head stays on the target while the body turns under it
	_rot(head, a.pitch * 0.4 - dn * 0.3 + lean * 0.6, clampf(a.twist * 0.3 - (tws - a.twist) * 0.8, -1.2, 1.2), -bend * 0.5, k)

	# ---- arms
	# In a boost the arms open out with the elbows a little bent, unless the gun is in use;
	# otherwise the weapon is shouldered with the left hand on the fore-end.
	var open := b * (1.0 - a.fire) * (1.0 - dn)
	var hold := (1.0 - a.swap) * (1.0 - open * 0.85)
	for side in [["L", -1.0], ["R", 1.0]]:
		var s: float = side[1]
		var arm: Array = arms[side[0]]
		var held: bool = wrists.has(side[0])
		var dk := clampf(a.blade, 0.0, 1.0) if held else 0.0      # 1 = sword in the fist, 0 = on its rack
		var sz := s * (0.14 + 0.16 * ar * fall + 0.42 * open)
		var rc := a.recoil_r
		var relax_sx := 0.12 - 0.3 * open
		var relax_ex := 0.5 + 0.3 * open
		var aim_sx := 0.45 + a.pitch * 0.6 + rc * 0.06
		var aim_ex := 1.05 + a.pitch * 0.4 + rc * 0.22
		var aim_sz := s * 0.2
		var aim := hold
		var sy := 0.0
		var wr := 0.0
		var wa := 0.0
		if s < 0.0:
			# support arm: across the chest to the weapon; a raised shield takes priority,
			# and a hand that holds a sword stays on the sword
			aim_sx = 0.66 + a.pitch * 0.6 + rc * 0.04
			aim_ex = 1.32 + a.pitch * 0.3 + rc * 0.1
			aim_sz = 0.5
			aim = hold * a.two_hand * (1.0 - a.guard) * (1.0 - dk)
			if has_shield:
				# guarding: the forearm comes up AND across, so the shield covers the chest
				# instead of standing out to the side
				# a small shield is pushed out in front instead: folded against the chest it reads as a folded arm
				var gp := GUARD_POSE
				var gy := GUARD_YAW
				if own_guard.size() == 4 and dbg_guard.is_empty():
					gp = Vector3(float(own_guard[0]), float(own_guard[1]), float(own_guard[2]))
					gy = float(own_guard[3])
				elif dbg_guard.size() == 4:
					gp = Vector3(float(dbg_guard[0]), float(dbg_guard[1]), float(dbg_guard[2]))
					gy = float(dbg_guard[3])
				relax_sx = lerpf(0.3, gp.x, a.guard)
				relax_ex = lerpf(0.9, gp.y, a.guard)
				sz = s * lerpf(0.22 + 0.3 * open, -gp.z, a.guard)
				sy = -s * gy * a.guard
		var sx := lerpf(relax_sx, aim_sx, aim)
		var ex := lerpf(relax_ex, aim_ex, aim)
		sz = lerpf(sz, aim_sz, aim)
		if s > 0.0:
			sx += a.charge * 0.05 + sin(a.idle_t * 70.0) * 0.006 * a.charge
			ex += a.charge * 0.1
		if held:
			# the sword is carried low at the side, the point slanting to the ground; in a dash
			# it trails behind. With the shield up the blade stands clear of it.
			var carry := (1.0 - (a.guard if (s < 0.0 and has_shield) else 0.0)) * dk
			sx = lerpf(sx, lerpf(float(guard_key[SX]), float(trail_arm[0]), open), carry)
			sz = lerpf(sz, s * lerpf(float(guard_key[SZ]), float(trail_arm[1]), open), carry)
			ex = lerpf(ex, lerpf(float(guard_key[EX]), float(trail_arm[3]), open), carry)
			wr = lerpf(1.7, lerpf(float(guard_key[WR]), float(trail_arm[4]), open), carry)
			wa = lerpf(1.15, lerpf(float(guard_key[WA]), float(trail_arm[5]), open), carry)
		elif not in_blow:
			# the gun arm stays on the aim while the body stands side-on
			sy += bs * float(mp[TW]) * tk
		if in_blow:
			if is_equal_approx(s, ms):
				sx = mp[SX]
				sz = s * float(mp[SZ])
				sy = -s * float(mp[SY])
				ex = mp[EX]
				wr = mp[WR]
				wa = mp[WA]
			else:
				# the other arm balances the blow: out in front for the coil, snatched back as it lands
				sx = mp[OX]
				sz = s * float(mp[OZ])
				ex = mp[OE]
		sx = lerpf(sx, -0.35, a.stagger)
		sz = lerpf(sz, s * 0.55, a.stagger)
		sx = lerpf(sx, 0.35, dn)
		ex = lerpf(ex, 0.5, dn)
		_rot(arm[0], sx, sy * (1.0 - a.stagger) * (1.0 - dn), sz, k)
		_rot(arm[1], ex, 0, 0, k)
		if _sh_pos.has(side[0]):
			# the shoulder itself moves: it comes forward with a reaching arm and travels out in front
			# of the chest when the shield goes up, so the shield is not folded into the torso
			var gg := (a.guard if (s < 0.0 and has_shield) else 0.0) * (1.0 - maxf(a.stagger, dn))
			var goff := Vector3(s * GIRDLE_GUARD.z, GIRDLE_GUARD.y, -GIRDLE_GUARD.x) * gg
			goff.z -= GIRDLE_REACH * clampf(sx, -0.6, 1.2) * (1.0 - gg)
			var shn: Node3D = arm[0]
			shn.position = shn.position.lerp((_sh_pos[side[0]] as Vector3) + goff, k)
			if _pauld_pos.has(side[0]):
				var pdn: Node3D = n["pauldron_" + side[0]]
				pdn.position = pdn.position.lerp((_pauld_pos[side[0]] as Vector3) + goff, k)
			if s < 0.0 and has_shield and shield_root != null and is_inside_tree():
				# the shield sits on a swivel: raised, its plate turns to face the enemy and stands
				# square in front of the chest, its long axis still following the line of the forearm
				var sq := Quaternion.IDENTITY
				if gg > 0.01:
					var mb: Basis = (global_transform.affine_inverse() * (shield_root.get_parent() as Node3D).global_transform).basis.orthonormalized()
					var face := GUARD_FACE.normalized()
					var along: Vector3 = mb.y - face * mb.y.dot(face)
					if along.length() > 0.05:
						along = along.normalized()
						var tb := Basis(-face, along, (-face).cross(along))
						sq = Quaternion.IDENTITY.slerp(Quaternion((mb.inverse() * tb).orthonormalized()), gg)
				shield_root.quaternion = shield_root.quaternion.slerp(sq, k)
		if held:
			var wj: Node3D = wrists[side[0]]
			wr = lerpf(wr, 0.9, maxf(a.stagger, dn))
			var wq := Quaternion(Basis.from_euler(Vector3(wr, -s * wa, 0.0)))
			var gk := (a.guard if (s < 0.0 and has_shield) else 0.0) * (1.0 - maxf(a.stagger, dn))
			if gk > 0.01 and not in_blow:
				# shield up: the sword carries on the line of the forearm, slanting up past the shoulder,
				# where it neither sticks out at the enemy nor crosses the view from the seat
				wq = wq.slerp(Quaternion.IDENTITY, gk)
			wj.quaternion = wj.quaternion.slerp(wq, k)
		if _pauld_rest.has(side[0]):
			var sr: Vector3 = (arm[0] as Node3D).rotation
			(n["pauldron_" + side[0]] as Node3D).basis = (_pauld_rest[side[0]] as Basis) * Basis.from_euler(Vector3(sr.x * 0.32, 0, sr.z * 0.5))
		if _binder_rest.has(side[0]):
			var dep := maxf(maxf(b, ar * 0.7), a.od * 0.6) * (1.0 - dn)
			var bn: Node3D = n["binder_" + side[0]]
			var cur := bn.get_meta("dep", 0.0) as float
			cur = U.damp(cur, dep, 7.0, dt)
			bn.set_meta("dep", cur)
			bn.basis = (_binder_rest[side[0]] as Basis) * Basis(Vector3.RIGHT, 0.55 * cur)

	# ---- misc parts
	blade_mat.emission_energy_multiplier = lerpf(blade_mat.emission_energy_multiplier, 6.0 if a.melee_on else 0.03 + a.od * 0.6, 1.0 - exp(-10.0 * dt))
	var hot := glow_col.lerp(Color(1.0, 0.42, 0.08), a.od)
	glow_mat.albedo_color = hot * (2.0 + a.od * (2.6 + 0.8 * sin(a.idle_t * 23.0)))
	for v in vents:
		(v["n"] as Node3D).basis = (v["rest"] as Basis) * Basis(Vector3.RIGHT, 0.62 * a.od)
	spin_v = U.damp(spin_v, 34.0 if a.recoil_r > 0.02 else 0.0, 4.0, dt)
	for sp in spins:
		(sp as Node3D).rotate_object_local(Vector3(0, 0, 1), spin_v * dt)
	_update_nozzles(a, dt)
	# energy blades: ignite with a flicker for the swing, longer when charged
	for pb in plasma:
		var lit: bool = a.melee_on or a.blade_show > 0.5 or a.blade > 0.5
		var pk: float = U.damp(float(pb["k"]), 1.0 if lit else 0.0, 22.0 if lit else 9.0, dt)
		pb["k"] = pk
		var pr: Node3D = pb["root"]
		pr.visible = pk > 0.02
		var flick := 1.0 + sin(a.idle_t * 61.0) * 0.03 + sin(a.idle_t * 97.0) * 0.02
		if pb.has("axis"):
			var sc := Vector3(flick, flick, flick)
			sc[int(pb["axis"])] = maxf(pk * float(pb["len"]) * (1.0 + 0.3 * a.mcharge), 0.001)
			pr.scale = sc
		else:
			pr.scale = Vector3(flick, maxf(pk * plasma_len * (1.0 + 0.3 * a.mcharge), 0.001), flick)
		(pb["lamp"] as OmniLight3D).light_energy = pk * (3.0 + 3.0 * a.mcharge)
	_trail_arm = "R" if a.melee_arm > 0 else "L"
	_update_trail(a.melee_on and a.melee_t > 0.3 and a.melee_t < 0.66, dt)


# where the blade (or bayonet) of the striking arm ends, in world space
func blade_tip(reach: float = 6.0) -> Vector3:
	if not arms.has(_trail_arm):
		return global_position
	if wrists.has(_trail_arm):
		var wj: Node3D = wrists[_trail_arm]
		return wj.global_position - wj.global_transform.basis.y.normalized() * reach
	var el: Node3D = (arms[_trail_arm] as Array)[1]
	var mk := "mount_blade_" + _trail_arm
	var base: Vector3 = (n[mk] as Node3D).global_position if n.has(mk) else el.global_position
	var d := base - el.global_position
	if d.length() < 0.05:
		d = -el.global_transform.basis.y
	return base + d.normalized() * reach


# the sweep of the blade drawn as a fading ribbon between its root and its tip
func _update_trail(on: bool, dt: float) -> void:
	if _trail == null:
		_trail_im = ImmediateMesh.new()
		_trail = MeshInstance3D.new()
		_trail.mesh = _trail_im
		_trail.top_level = true
		_trail.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		_trail.extra_cull_margin = 60.0
		_trail.layers = layer
		var tm := StandardMaterial3D.new()
		tm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		tm.vertex_color_use_as_albedo = true
		tm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		tm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		tm.cull_mode = BaseMaterial3D.CULL_DISABLED
		tm.no_depth_test = false
		_trail.material_override = tm
		add_child(_trail)
		_trail.global_transform = Transform3D.IDENTITY
	for p in _trail_pts:
		p[2] = float(p[2]) + dt
	while not _trail_pts.is_empty() and float(_trail_pts[0][2]) > 0.2:
		_trail_pts.pop_front()
	if on:
		_trail_pts.append([blade_tip(1.6), blade_tip(plasma_len + 1.6 if not plasma.is_empty() else 5.6 * blade_k), 0.0])
		if _trail_pts.size() > 24:
			_trail_pts.pop_front()
	_trail_im.clear_surfaces()
	if _trail_pts.size() < 2:
		return
	var col := trail_col
	_trail_im.surface_begin(Mesh.PRIMITIVE_TRIANGLE_STRIP)
	for p in _trail_pts:
		var al := clampf(1.0 - float(p[2]) / 0.2, 0.0, 1.0)
		_trail_im.surface_set_color(Color(col.r * 0.6, col.g * 0.4, col.b * 0.3, 0.0))
		_trail_im.surface_add_vertex(p[0])
		_trail_im.surface_set_color(Color(col.r * 2.2, col.g * 2.0, col.b * 1.6, al * 0.85))
		_trail_im.surface_add_vertex(p[1])
	_trail_im.surface_end()


func _update_skirts(a: Anim, dt: float) -> void:
	var fall := clampf(-a.vy / 30.0, 0.0, 1.0) * a.air
	var rise := clampf(a.vy / 20.0, 0.0, 1.0) * a.air
	for s in skirts:
		var side: float = s["side"]
		var lg: Leg = legs[0] if side < 0.0 else legs[1]
		var t: Vector3 = lg.hip.basis * Vector3.DOWN
		var pitch := atan2(-t.z, -t.y)
		var lat := atan2(t.x * side, -t.y)
		var base := 0.0
		var flare := 0.0
		var kind: String = s["kind"]
		if kind == "F":
			base = maxf(0.0, pitch - 0.1) * 0.95
			flare = 0.06 * a.boost + fall * 0.4 - rise * 0.05
		elif kind == "B":
			base = maxf(0.0, -pitch - 0.08) * 0.95
			flare = a.boost * (0.3 + 0.35 * maxf(a.mvz, 0.0)) + fall * 0.45 + rise * 0.2
		else:
			base = maxf(0.0, lat - 0.06) * 0.9 + maxf(0.0, absf(pitch) - 0.55) * 0.25
			flare = a.boost * (0.16 + 0.3 * maxf(a.mvx * side, 0.0)) + fall * 0.4 + rise * 0.1
		var acc: float = (flare - float(s["a"])) * 110.0 - float(s["w"]) * 8.5
		s["w"] = float(s["w"]) + acc * dt
		s["a"] = clampf(float(s["a"]) + float(s["w"]) * dt, -0.12, 1.3)
		var ang: float = base + float(s["a"])
		var node: Node3D = s["n"]
		var rest: Basis = s["rest"]
		if kind == "F":
			node.basis = rest * Basis(Vector3.RIGHT, ang)
		elif kind == "B":
			node.basis = rest * Basis(Vector3.RIGHT, -ang)
		else:
			node.basis = rest * Basis(Vector3(0, 0, 1), side * ang)


func _update_nozzles(a: Anim, dt: float) -> void:
	var pw := a.thrust.length()
	var want_w := Vector3.ZERO
	if pw > 0.01:
		want_w = -a.thrust / pw
	var kd := 1.0 - exp(-11.0 * dt)
	var tint := Color(0.5, 0.72, 1.0).lerp(Color(1.0, 0.5, 0.2), a.od)
	for z in noz:
		var node: Node3D = z["n"]
		var rest: Basis = z["rest"]
		var rd: Vector3 = (rest * Vector3.DOWN).normalized()
		var dir := rd
		var lvl := 0.0
		if pw > 0.01:
			var wl: Vector3 = ((node.get_parent() as Node3D).global_transform.basis.orthonormalized().inverse() * want_w).normalized()
			var ang := rd.angle_to(wl)
			var lim: float = z["gim"]
			if ang > 0.001 and lim > 0.0:
				dir = rd.slerp(wl, minf(1.0, lim / ang)).normalized()
			var cut: float = z["cut"]
			lvl = minf(pw, 1.4) * clampf((dir.dot(wl) - cut) / (1.0 - cut), 0.0, 1.0)
		var cd: Vector3 = (z["dir"] as Vector3).lerp(dir, kd).normalized()
		z["dir"] = cd
		if float(z["gim"]) > 0.0:
			node.basis = Basis(Quaternion(rd, cd)) * rest
		var lv: float = U.damp(float(z["lvl"]), lvl, 20.0, dt)
		z["lvl"] = lv
		var pm: MeshInstance3D = z["pm"]
		if lv > 0.03:
			var ln: float = float(z["len"]) * pow(lv, 0.7) * randf_range(0.92, 1.08)
			var r: float = z["r"]
			pm.visible = true
			pm.position = Vector3(0, -ln * 0.5, 0)
			pm.scale = Vector3(r, ln, r)
			pm.set_instance_shader_parameter("power", 0.5 + lv)
			pm.set_instance_shader_parameter("tint", tint)
		else:
			pm.visible = false
