extends SceneTree
# Pose viewer for blade work: stands one frame on a plain floor in even light, holds it in each
# requested key of a blow and saves pictures from two sides.
#   godot --path <project> --resolution 1400x900 -s tools/pose_view.gd -- --frame=reaver --out=<dir>
#         --keys=guard,down:0.36,down:0.47,down:0.6 [--lunge] [--views=q,s] [--melee=<id>] [--charge=1]
#         [--hand --dist=22  close-up of the sword hand]
#         [--tint  parts in flat colours: shield red, sword yellow, gun green, back weapons purple,
#                  left upper arm blue, left forearm cyan, right arm orange, the rest grey]
#         [--noblade  sword not drawn]
#         [--shield=<id> --guard --gp=pitch,elbow,roll,yaw  a shield raised, optionally with a pose to try]
# guard = sword drawn, standing; <path>:<phase> = that instant of the blow (0.36 coiled, 0.47 the
# blade lands, 0.6 end of the cut). --lunge shows the legs as they are in the thruster lunge
# (feet free) instead of planted. Views: q three-quarter front, s side, f front, r rear, t top.

const Tex = preload("res://scripts/tex.gd")
const Defs = preload("res://scripts/defs.gd")
const Glb = preload("res://scripts/glb_kit.gd")
const MechModel = preload("res://scripts/mech_model.gd")

const VIEWS := {"q": Vector3(-0.62, 0.22, -1.0), "s": Vector3(-1.0, 0.12, 0.0), "f": Vector3(0.0, 0.12, -1.0),
	"r": Vector3(0.45, 0.3, 1.0), "t": Vector3(0.0, 1.0, -0.25), "o": Vector3(1.0, 0.12, 0.0)}


func _ground(_x: float, _z: float) -> float:
	return 0.0


func _initialize() -> void:
	_run()


func _run() -> void:
	var fid := "reaver"
	var out := "res://_shots"
	var keys: Array = ["guard"]
	var views: Array = ["q", "s"]
	var lunge := false
	var melee := ""
	var charge := 0.0
	var dist := 78.0
	var hand := false
	var dash := false
	var guard := false
	var shield := ""
	var tint := false
	var blade := 1.0
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--frame="):
			fid = a.substr(8)
		elif a.begins_with("--out="):
			out = a.substr(6)
		elif a.begins_with("--keys="):
			keys = Array(a.substr(7).split(","))
		elif a.begins_with("--views="):
			views = Array(a.substr(8).split(","))
		elif a.begins_with("--melee="):
			melee = a.substr(8)
		elif a.begins_with("--charge="):
			charge = float(a.substr(9))
		elif a.begins_with("--dist="):
			dist = float(a.substr(7))
		elif a.begins_with("--shield="):
			shield = a.substr(9)
		elif a.begins_with("--gp="):
			for v in a.substr(5).split(","):
				MechModel.dbg_guard.append(float(v))
		elif a == "--tint":
			tint = true
		elif a == "--noblade":
			blade = 0.0
		elif a == "--guard":
			guard = true
		elif a == "--dash":
			dash = true
		elif a == "--hand":
			hand = true
		elif a == "--lunge":
			lunge = true
	await process_frame
	Tex.init()
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.56, 0.6, 0.66)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.8, 0.82, 0.88)
	env.ambient_light_energy = 1.1
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	var we := WorldEnvironment.new()
	we.environment = env
	root.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation = Vector3(-0.9, 2.5, 0)
	sun.light_energy = 1.3
	sun.shadow_enabled = true
	root.add_child(sun)
	var floor_mi := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(400, 400)
	floor_mi.mesh = pm
	var fm := StandardMaterial3D.new()
	fm.albedo_color = Color(0.42, 0.43, 0.45)
	fm.roughness = 0.9
	floor_mi.material_override = fm
	root.add_child(floor_mi)
	var cam := Camera3D.new()
	cam.fov = 30.0
	cam.far = 800.0
	root.add_child(cam)
	cam.make_current()

	var def: Dictionary = Defs.FRAMES[fid]
	var lo: Dictionary = (def["loadout"] as Dictionary).duplicate()
	if melee != "":
		lo["M"] = melee
	if shield != "":
		lo["L"] = shield
	var m = MechModel.new()
	root.add_child(m)
	m.build(fid, def, lo)
	if tint:
		_tint(m)
	var an = MechModel.Anim.new()
	an.blade = blade
	an.fire = 0.0
	an.two_hand = 1.0
	an.guard = 1.0 if guard else 0.0
	var dt := 1.0 / 60.0
	var n := 0
	for key in keys:
		var ks := str(key).split(":")
		var is_blow := ks.size() > 1
		MechModel.dbg_key = [ks[0], float(ks[1]), charge] if is_blow else []
		var free_feet := (lunge and is_blow) or (dash and not is_blow)
		an.boost = 1.0 if free_feet else 0.0
		an.mvz = 1.0 if free_feet else 0.0
		m.rotation.x = -0.3 if free_feet else 0.0
		for i in 70:
			an.idle_t += dt
			m.gait(dt, 0.0, Vector3.ZERO, _ground, not free_feet)
			m.pose(an, dt)
		for v in views:
			var d: Vector3 = (VIEWS[v] as Vector3).normalized()
			var tgt := Vector3(0, m.hip_y + 1.5, 0)
			if hand and m.wrists.has("L"):
				tgt = (m.wrists["L"] as Node3D).global_position
			cam.global_position = tgt + d * dist
			cam.look_at(tgt, Vector3.UP if absf(d.y) < 0.9 else Vector3(0, 0, -1))
			await process_frame
			await process_frame
			await RenderingServer.frame_post_draw
			var img := root.get_viewport().get_texture().get_image()
			img.save_png(ProjectSettings.globalize_path("%s/pose_%02d_%s.png" % [out, n, v]) if out.begins_with("res://") else "%s/pose_%02d_%s.png" % [out, n, v])
		n += 1
	MechModel.dbg_key = []
	Glb.free_templates()
	quit()


# flat colours per part, so a check render shows which piece is which and which way it points
func _flat(col: Color) -> StandardMaterial3D:
	var sm := StandardMaterial3D.new()
	sm.albedo_color = col
	sm.roughness = 0.8
	return sm


func _paint(nd: Node, mat: Material, skip_equip: bool) -> void:
	if skip_equip and nd.has_meta("equip"):
		return
	if nd is MeshInstance3D:
		(nd as MeshInstance3D).material_override = mat
	for c in nd.get_children():
		_paint(c, mat, skip_equip)


func _tint(m) -> void:
	_paint(m, _flat(Color(0.45, 0.45, 0.47)), false)
	_paint(m.arms["L"][0], _flat(Color(0.1, 0.25, 0.9)), true)
	_paint(m.arms["L"][1], _flat(Color(0.1, 0.8, 0.9)), true)
	_paint(m.arms["R"][0], _flat(Color(0.95, 0.5, 0.1)), true)
	for nd in m.find_children("*", "Node3D", true, false):
		if not nd.has_meta("equip"):
			continue
		var mt := str(nd.get_meta("equip"))
		var col := Color(0.6, 0.2, 0.8)
		if mt == "mount_arm_L" and nd == m.shield_root:
			col = Color(0.9, 0.1, 0.1)
		elif mt.contains("blade") or mt.begins_with("wrist") or mt.begins_with("grip") or mt == "mount_arm_L":
			col = Color(1.0, 0.9, 0.1)
		elif mt.contains("hand"):
			col = Color(0.1, 0.8, 0.2)
		_paint(nd, _flat(col), false)
