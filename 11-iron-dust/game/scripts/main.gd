extends Node3D
# IRON DUST - game root: state machine, spawning, event callbacks, camera, post.

const Tex = preload("res://scripts/tex.gd")
const Defs = preload("res://scripts/defs.gd")
const World = preload("res://scripts/world.gd")
const FX = preload("res://scripts/fx.gd")
const Sfx = preload("res://scripts/sfx.gd")
const Projectiles = preload("res://scripts/projectiles.gd")
const Mech = preload("res://scripts/mech.gd")
const Vehicle = preload("res://scripts/vehicle.gd")
const AI = preload("res://scripts/ai.gd")
const PlayerCtl = preload("res://scripts/player_ctl.gd")
const HUD = preload("res://scripts/hud.gd")
const Menus = preload("res://scripts/menus.gd")
const Mission = preload("res://scripts/mission.gd")
const MissionDrop = preload("res://scripts/mission_drop.gd")
const Aircraft = preload("res://scripts/aircraft.gd")
const Emplacement = preload("res://scripts/emplacement.gd")
const Glb = preload("res://scripts/glb_kit.gd")
const MechModel = preload("res://scripts/mech_model.gd")
const Settings = preload("res://scripts/settings.gd")
const MeshKit = preload("res://scripts/mesh_kit.gd")
const U = preload("res://scripts/u.gd")

const STAGE_POS := Vector3(0, 3000, 0)

var state := "boot"
var world
var fx
var sfx
var proj
var hud
var menus
var cam: Camera3D
var pc
var mission
var player
var units: Array = []
var ais: Array = []
var team_rids := {}
var units_root: Node3D
var sel := 0
var mission_idx := 0
var loadouts := {}
var slot_i := 0
var extras: Array = []
var test_lo := {}
var stage: Node3D
var stage_env: Environment
var stage_model = null
var alarm_k := 0.0             # armour alarm, 0..1 (eased)
var alarm_t := 0.0
var _pit_fx := false           # screen-space light currently tuned for the cabin
var stage_anim
var stage_t := 0.0
var post_mat: ShaderMaterial
var ink_quad: MeshInstance3D
var burns: Array = []
var cockpit_pref := false
var sun_vis := 0.0
var dmg_flash := 0.0
var hit_stop_until := 0
var stats := {}
var combat := 0.0
var result_t := 0.0
var orbit_focus := Vector3.ZERO
var seed_n := 1
var test_mode := false
var test_t := 0.0
var test_steps: Array = []
var _q := PhysicsRayQueryParameters3D.new()
var cfg
var sens_mul := 1.0
var pad_mode := false         # the last input came from a gamepad: prompts show its buttons
var pad_id := 0
var pad_sens := 1.0
var pad_inv := false
var pad_rumble := true
var focus_i := 0              # pause / result screens: the button the pad or the arrow keys are on
var focus_on := false
var _pad_back_ms := -1
var _nav_dir := 0
var _nav_ms := 0
const FOCUS_IDS := {"pause": ["resume", "retry", "hangar", "options"], "result": ["retry", "hangar"]}
var fov_base := 70.0
var cam_dist := 40.0
var opt_i := 0
var opt_from := "title"
var perf := false
var test_speed := 1.0
var apply_win := false
var watch_t := -1.0
var _pf := {}
var _pf_n := 0
var _pf_spikes := 0
var _pf_max := 0.0
var _pf_last := 0
var _pf_note := ""


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	var t0 := Time.get_ticks_msec()
	Tex.init()
	cam = Camera3D.new()
	cam.far = 6000.0
	cam.near = 0.3
	cam.fov = 60.0
	add_child(cam)
	cam.current = true
	# line-work pass: a full-screen quad that inks depth steps and creases (shaders/ink.gdshader)
	ink_quad = MeshInstance3D.new()
	var iq := QuadMesh.new()
	iq.size = Vector2(2, 2)
	var im := ShaderMaterial.new()
	im.shader = load("res://shaders/ink.gdshader")
	im.render_priority = -100
	iq.material = im
	ink_quad.mesh = iq
	ink_quad.extra_cull_margin = 16000.0
	ink_quad.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	ink_quad.position = Vector3(0, 0, -2.0)
	cam.add_child(ink_quad)
	cfg = Settings.new()
	if not OS.get_cmdline_user_args().has("--autotest"):
		cfg.load_file()
	_load_loadouts()
	_load_map("refinery")
	fx = FX.new()
	fx.process_mode = Node.PROCESS_MODE_PAUSABLE
	add_child(fx)
	fx.setup(world)
	fx.set_space(world.space)
	proj = Projectiles.new()
	add_child(proj)
	proj.setup(self)
	units_root = Node3D.new()
	units_root.process_mode = Node.PROCESS_MODE_PAUSABLE
	add_child(units_root)
	sfx = Sfx.new()
	add_child(sfx)
	sfx.setup()
	var pl := CanvasLayer.new()
	pl.layer = 1
	add_child(pl)
	var rect := ColorRect.new()
	rect.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	post_mat = ShaderMaterial.new()
	post_mat.shader = load("res://shaders/post.gdshader")
	rect.material = post_mat
	pl.add_child(rect)
	var hl := CanvasLayer.new()
	hl.layer = 2
	add_child(hl)
	hud = HUD.new()
	hl.add_child(hud)
	hud.setup(self)
	var ml := CanvasLayer.new()
	ml.layer = 3
	add_child(ml)
	menus = Menus.new()
	ml.add_child(menus)
	menus.setup(self)
	_build_stage()
	_rebuild_rids()
	print("boot ms ", Time.get_ticks_msec() - t0)
	var args := OS.get_cmdline_user_args()
	if args.has("--autotest"):
		test_mode = true
		_build_test(args)
	cfg.apply(self, not test_mode or apply_win)
	_enter_title()


# ---------------------------------------------------------------- hangar stage
func _build_stage() -> void:
	stage = Node3D.new()
	stage.position = STAGE_POS
	add_child(stage)
	var k := MeshKit.new(5)
	k.dust = 0.3
	k.dust_top = 3.0
	var g := k.bone(stage)
	k.box(g, "CON", Vector3(160, 2, 160), Vector3(0, -1, 0))
	k.cyl(g, "STL", 13.0, 14.0, 1.2, Vector3(0, 0.6, 0), Vector3.ZERO, 32)
	k.cyl(g, "HAZ", 15.0, 15.0, 0.16, Vector3(0, 0.08, 0), Vector3.ZERO, 32)
	k.box(g, "COR", Vector3(160, 70, 2), Vector3(0, 35, -36))
	for s in [-1.0, 1.0]:
		k.box(g, "COR", Vector3(2, 70, 160), Vector3(s * 52, 35, 0))
		k.box(g, "STL", Vector3(7, 1, 44), Vector3(s * 19, 13.5, -10))
		k.box(g, "HAZ", Vector3(0.5, 1.3, 44), Vector3(s * 15.4, 13.6, -10))
		k.box(g, "STL", Vector3(0.3, 2.2, 44), Vector3(s * 22.4, 15.2, -10))
		for z in [-30.0, -10.0, 10.0]:
			k.box(g, "STL", Vector3(1.2, 13, 1.2), Vector3(s * 21.5, 6.5, z))
		k.box(g, "RST", Vector3(3, 70, 3), Vector3(s * 34, 35, -33))
		k.box(g, "CN1" if s < 0 else "CN2", Vector3(14, 5.6, 5.8), Vector3(s * 36, 2.8, -22), Vector3(0, 0.3 * s, 0))
		k.box(g, "CN3", Vector3(14, 5.6, 5.8), Vector3(s * 37, 2.8, -12), Vector3(0, PI * 0.5, 0))
	for x in [-12.0, 12.0]:
		k.box(g, "STL", Vector3(2.4, 70, 2.4), Vector3(x, 35, -33.5))
	k.box(g, "RST", Vector3(104, 3.5, 4.5), Vector3(0, 33, -8))
	k.box(g, "HAZ", Vector3(8, 4, 8), Vector3(8, 30, -8))
	k.box(g, "DRK", Vector3(0.5, 8, 0.5), Vector3(8, 24, -8))
	k.box(g, "HAZ", Vector3(60, 0.1, 1.2), Vector3(0, 0.06, 22))
	var am := Tex.armor
	k.bake({
		"CON": {"mat": Tex.concrete, "params": {"tint": Color(0.32, 0.31, 0.29), "metal": 0.0}},
		"COR": {"mat": Tex.corrugated, "params": {"tint": Color(0.2, 0.22, 0.21), "metal": 0.45}},
		"CN1": {"mat": Tex.corrugated, "params": {"tint": Color(0.42, 0.17, 0.1), "metal": 0.35}},
		"CN2": {"mat": Tex.corrugated, "params": {"tint": Color(0.16, 0.26, 0.34), "metal": 0.35}},
		"CN3": {"mat": Tex.corrugated, "params": {"tint": Color(0.33, 0.33, 0.16), "metal": 0.35}},
		"STL": {"mat": am, "params": {"tint": Color(0.13, 0.14, 0.15), "metal": 0.7}},
		"RST": {"mat": am, "params": {"tint": Color(0.3, 0.15, 0.08), "metal": 0.3, "wear": 1.3}},
		"HAZ": {"mat": am, "params": {"tint": Color(0.7, 0.5, 0.06), "metal": 0.2, "wear": 1.2, "stripes": 1.0}},
		"DRK": {"mat": am, "params": {"tint": Color(0.008, 0.008, 0.009), "metal": 0.0, "wear": 0.0}},
	})
	var key := SpotLight3D.new()
	key.light_color = Color(1.0, 0.88, 0.7)
	key.light_energy = 30.0
	key.spot_range = 110.0
	key.spot_angle = 30.0
	key.spot_attenuation = 0.6
	key.shadow_enabled = true
	stage.add_child(key)
	key.look_at_from_position(STAGE_POS + Vector3(20, 40, 26), STAGE_POS + Vector3(0, 8, 0))
	var rim := SpotLight3D.new()
	rim.light_color = Color(0.5, 0.68, 1.0)
	rim.light_energy = 22.0
	rim.spot_range = 90.0
	rim.spot_angle = 40.0
	rim.spot_attenuation = 0.6
	rim.shadow_enabled = true
	stage.add_child(rim)
	rim.look_at_from_position(STAGE_POS + Vector3(-22, 26, -22), STAGE_POS + Vector3(0, 10, 0))
	var fill := OmniLight3D.new()
	fill.light_color = Color(1.0, 0.8, 0.6)
	fill.light_energy = 2.0
	fill.omni_range = 80.0
	fill.position = Vector3(-10, 6, 34)
	stage.add_child(fill)
	stage_env = Environment.new()
	stage_env.background_mode = Environment.BG_COLOR
	stage_env.background_color = Color(0.008, 0.009, 0.009)
	stage_env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	stage_env.ambient_light_color = Color(0.5, 0.56, 0.62)
	stage_env.ambient_light_energy = 0.16
	stage_env.tonemap_mode = Environment.TONE_MAPPER_ACES
	stage_env.tonemap_white = 6.0
	stage_env.ssao_enabled = true
	stage_env.glow_enabled = true
	stage_env.glow_intensity = 0.7
	stage_env.glow_hdr_threshold = 1.1
	stage_env.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE
	stage_env.volumetric_fog_enabled = true
	stage_env.volumetric_fog_density = 0.012
	stage_env.volumetric_fog_albedo = Color(0.85, 0.82, 0.78)
	stage_env.volumetric_fog_length = 140.0
	stage_env.adjustment_enabled = true
	stage_env.adjustment_saturation = 0.88
	stage_env.adjustment_contrast = 1.06
	stage_anim = MechModel.Anim.new()


func _load_map(id: String) -> void:
	if world != null and world.map_id == id:
		return
	if world != null:
		remove_child(world)
		world.free()
	world = World.new()
	world.process_mode = Node.PROCESS_MODE_PAUSABLE
	add_child(world)
	move_child(world, 1)
	world.setup(id)
	if fx != null:
		fx.world = world
		fx.set_space(world.space)
	apply_quality(int(cfg.val("quality")))


# graphics quality: 0 low (no SSAO / volumetric fog, short 2-split shadows), 1 medium, 2 high
func apply_quality(q: int) -> void:
	Tex.set_detail(q >= 1)
	if ink_quad != null:
		ink_quad.visible = q >= 1
	if world != null:
		world.env.ssao_enabled = q >= 1
		world.env.volumetric_fog_enabled = q >= 1
		world.sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS if q >= 1 else DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
		world.sun.directional_shadow_max_distance = (640.0 if world.dusk else 520.0) * (1.0 if q >= 1 else 0.6)
	if stage_env != null:
		stage_env.ssao_enabled = q >= 1
		stage_env.volumetric_fog_enabled = q >= 1


func _load_loadouts() -> void:
	for id in Defs.PLAYER_FRAMES:
		loadouts[id] = (Defs.FRAMES[id]["loadout"] as Dictionary).duplicate()
	if OS.get_cmdline_user_args().has("--autotest") or not FileAccess.file_exists("user://loadouts.json"):
		return
	var data = JSON.parse_string(FileAccess.get_file_as_string("user://loadouts.json"))
	if not (data is Dictionary):
		return
	var old: bool = not data.has("_v")
	for id in Defs.PLAYER_FRAMES:
		if not (data.get(id) is Dictionary):
			continue
		var slots: Dictionary = Defs.FRAMES[id]["slots"]
		for sl in slots:
			if old and sl == "SYS":
				continue
			var v = data[id].get(sl)
			if v is String and (slots[sl] as Array).has(v):
				loadouts[id][sl] = v
		if loadouts[id]["R1"] == loadouts[id]["R2"]:
			loadouts[id]["R2"] = ""
		if loadouts[id]["R3"] != "" and (loadouts[id]["R3"] == loadouts[id]["R1"] or loadouts[id]["R3"] == loadouts[id]["R2"]):
			loadouts[id]["R3"] = ""


func _save_loadouts() -> void:
	if test_mode:
		return
	var f := FileAccess.open("user://loadouts.json", FileAccess.WRITE)
	if f != null:
		var out: Dictionary = loadouts.duplicate()
		out["_v"] = 2
		f.store_string(JSON.stringify(out))


func cur_frame() -> String:
	return Defs.PLAYER_FRAMES[sel]


func cur_loadout() -> Dictionary:
	return loadouts[cur_frame()]


# step the selected hangar slot to its next / previous allowed item
func _cycle_slot(i: int, step: int) -> void:
	var sl: String = Defs.SLOT_ORDER[i]
	var lo := cur_loadout()
	var opts: Array = Defs.FRAMES[cur_frame()]["slots"][sl]
	if opts.size() < 2:
		return
	var idx := opts.find(lo[sl])
	for n in opts.size():
		idx = posmod(idx + step, opts.size())
		var v: String = opts[idx]
		if sl == "R1" and v == "":
			continue
		if sl in ["R1", "R2", "R3"] and v != "":
			# the same weapon cannot sit in two hand slots
			var taken := false
			for other in ["R1", "R2", "R3"]:
				if other != sl and lo[other] == v:
					taken = true
			if taken:
				continue
		lo[sl] = v
		break
	slot_i = i
	_save_loadouts()
	_stage_set()


func _stage_ground(_x: float, _z: float) -> float:
	return STAGE_POS.y + 1.2


func _stage_set() -> void:
	if stage_model != null:
		stage_model.queue_free()
	var id := cur_frame()
	stage_model = MechModel.new()
	stage.add_child(stage_model)
	stage_model.position = Vector3(0, 1.2, 0)
	stage_model.rotation.y = PI + 0.25
	stage_model.build(id, Defs.FRAMES[id], cur_loadout(), sel + 11, 1)
	stage_model.pose(stage_anim, 1.0)


func _show_stage(on: bool) -> void:
	stage.visible = on
	world.visible = not on
	fx.visible = not on
	proj.visible = not on
	units_root.visible = not on
	world.we.environment = stage_env if on else world.env
	if on and stage_model == null:
		_stage_set()


# ---------------------------------------------------------------- state flow
func _enter_title() -> void:
	state = "title"
	get_tree().paused = false
	Engine.time_scale = 1.0
	_show_stage(true)
	hud.visible = false
	menus.show_screen("title")
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


func _enter_hangar() -> void:
	_cleanup()
	state = "hangar"
	get_tree().paused = false
	Engine.time_scale = 1.0
	_show_stage(true)
	hud.visible = false
	menus.show_screen("hangar")
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


func _enter_missions() -> void:
	_cleanup()
	state = "missions"
	get_tree().paused = false
	Engine.time_scale = 1.0
	_show_stage(true)
	hud.visible = false
	menus.show_screen("missions")
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


func _enter_options() -> void:
	opt_from = state
	state = "options"
	menus.show_screen("options")


func _leave_options() -> void:
	if not test_mode:
		cfg.save_file()
	state = opt_from
	menus.show_screen(opt_from)


func _cfg_step(i: int, step: int) -> void:
	opt_i = i
	cfg.cycle(str(cfg.items[i]["id"]), step)
	cfg.apply(self, not test_mode or apply_win)
	if not test_mode:
		cfg.save_file()


func menu_action(id: String) -> void:
	sfx.play2d("confirm", 0.5)
	if id == "options":
		_enter_options()
	elif id == "cfgback":
		_leave_options()
	elif id.begins_with("cfgrow"):
		opt_i = int(id.substr(6))
	elif id.begins_with("cfgm"):
		_cfg_step(int(id.substr(4)), -1)
	elif id.begins_with("cfgp"):
		_cfg_step(int(id.substr(4)), 1)
	elif id == "start" or id == "missions":
		_enter_missions()
	elif id.begins_with("msel"):
		mission_idx = int(id.substr(4))
	elif id == "mok":
		_enter_hangar()
	elif id.begins_with("sel"):
		sel = int(id.substr(3))
		_stage_set()
	elif id.begins_with("slot"):
		slot_i = int(id.substr(4))
	elif id.begins_with("optp"):
		_cycle_slot(int(id.substr(4)), 1)
	elif id.begins_with("optm"):
		_cycle_slot(int(id.substr(4)), -1)
	elif id == "sortie":
		_load_map(Defs.MISSIONS[mission_idx]["map"])
		_show_stage(true)
		state = "briefing"
		menus.show_screen("briefing")
	elif id == "engage" or id == "retry":
		start_mission()
	elif id == "resume":
		_set_pause(false)
	elif id == "hangar":
		_enter_hangar()


func _set_pause(on: bool) -> void:
	if on and state == "play":
		state = "pause"
		focus_i = 0
		get_tree().paused = true
		menus.show_screen("pause")
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	elif not on and state == "pause":
		state = "play"
		get_tree().paused = false
		menus.show_screen("none")
		_capture_mouse()


func _capture_mouse() -> void:
	if not test_mode:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _cleanup() -> void:
	for u in units:
		u.queue_free()
	units.clear()
	for e in extras:
		if is_instance_valid(e):
			e.queue_free()
	extras.clear()
	if pc != null:
		pc.leave()
		cam.cull_mask = 0xFFFFF & ~(1 << 18)
		cam.near = 0.3
	ais.clear()
	burns.clear()
	proj.clear()
	player = null
	pc = null
	mission = null
	_rebuild_rids()


func start_mission() -> void:
	_cleanup()
	get_tree().paused = false
	Engine.time_scale = 1.0
	var md: Dictionary = Defs.MISSIONS[mission_idx]
	_load_map(md["map"])
	_show_stage(false)
	stats = {"kills": 0, "taken": 0.0, "dealt": 0.0}
	dmg_flash = 0.0
	var mcls = Mission
	if md["id"] == "descent":
		mcls = MissionDrop
	elif md["id"] == "belt":
		mcls = load("res://scripts/mission_belt.gd" if ResourceLoader.exists("res://scripts/mission_belt.gd") else "res://scripts/mission_belt_stub.gd")
	mission = mcls.new(self)
	mission.time_limit = md["time"]
	var id := cur_frame()
	var lo: Dictionary = cur_loadout().duplicate()
	for k in test_lo:
		lo[k] = test_lo[k]
	var sp: Array = mission.player_spawn()
	player = spawn_mech(id, 0, sp[0], sp[1], false, lo)
	player.is_player = true
	player.repair_kits = 2 if md["id"] == "rust" else 3
	player.callsign = "砂砾 1"
	pc = PlayerCtl.new(self, player, cam)
	pc.sens = 0.0021 * sens_mul
	if cockpit_pref:
		pc.set_cockpit(true)
	hud.reset()
	hud.visible = true
	menus.show_screen("none")
	state = "play"
	mission.start()
	_capture_mouse()
	pc.cam_update(1.0)


func finish_mission() -> void:
	if state != "play":
		return
	state = "result"
	focus_i = 0
	result_t = 0.0
	orbit_focus = player.global_position
	var used: float = mission.time_limit - mission.time_left
	var taken_pct: float = stats["taken"] / player.ap_max * 100.0
	var rank := "D"
	if mission.won:
		var score: float = 100.0 - minf(taken_pct, 150.0) * 0.25 - used / mission.time_limit * 40.0 + minf(float(stats["kills"]), 12.0) + mission.score_bonus()
		rank = "S" if score >= 80.0 else ("A" if score >= 66.0 else ("B" if score >= 52.0 else "C"))
	var rows := [
		["出击机体", str(player.def["name"])],
		["作战用时", "%02d:%02d" % [int(used / 60.0), int(used) % 60]],
		["击坠数", str(stats["kills"])],
		["累计受损", "%d%%" % int(taken_pct)],
		["造成伤害", str(int(stats["dealt"]))],
	]
	rows.append_array(mission.result_rows())
	menus.result = {"win": mission.won, "reason": mission.fail_reason, "rank": rank, "rows": rows}
	hud.visible = false
	menus.show_screen("result")
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


# ---------------------------------------------------------------- spawning
func add_unit(u) -> void:
	units_root.add_child(u)
	units.append(u)


func add_extra(n: Node) -> void:
	units_root.add_child(n)
	extras.append(n)


func spawn_mech(id: String, team: int, pos: Vector3, yaw: float, with_ai: bool, lo: Dictionary = {}):
	var m = Mech.new()
	add_unit(m)
	seed_n += 1
	m.setup(self, id, team, pos, yaw, seed_n, lo)
	if with_ai:
		ais.append(AI.new(m, self, pos))
	_rebuild_rids()
	return m


func spawn_vehicle(kind_id: String, team: int, pos: Vector3, yaw: float):
	var v = Vehicle.new()
	add_unit(v)
	v.setup(self, kind_id, team, pos, yaw)
	_rebuild_rids()
	return v


func spawn_emplacement(kind_id: String, team: int, pos: Vector3, yaw: float):
	var e = Emplacement.new()
	add_unit(e)
	e.setup(self, kind_id, team, pos, yaw)
	_rebuild_rids()
	return e


func spawn_aircraft(kind_id: String, pos: Vector3, dest: Vector3, load: Array = []):
	var a = Aircraft.new()
	add_unit(a)
	a.setup(self, kind_id, 1, pos, dest, load)
	_rebuild_rids()
	return a


func _rebuild_rids() -> void:
	var a: Array[RID] = []
	var b: Array[RID] = []
	for u in units:
		if u.alive:
			if u.team == 0:
				a.append(u.get_rid())
			else:
				b.append(u.get_rid())
	team_rids = {0: a, 1: b}


func ray(from: Vector3, to: Vector3, mask: int, exclude: Array) -> Dictionary:
	var ex: Array[RID] = []
	for r in exclude:
		ex.append(r)
	_q.from = from
	_q.to = to
	_q.collision_mask = mask
	_q.exclude = ex
	return get_world_3d().direct_space_state.intersect_ray(_q)


func los(a: Vector3, b: Vector3) -> bool:
	return ray(a, b, 1, []).is_empty()


# ---------------------------------------------------------------- callbacks
func shake(amount: float, pos = null) -> void:
	if pc == null:
		return
	if pos != null:
		var d: float = cam.global_position.distance_to(pos)
		amount *= clampf(1.0 - d / 300.0, 0.0, 1.0)
	pc.trauma = minf(1.0, pc.trauma + amount)


func hit_stop(sec: float) -> void:
	hit_stop_until = Time.get_ticks_msec() + int(sec * 1000.0)


func explode(pos: Vector3, s: float) -> void:
	fx.explosion(pos, s)
	sfx.play("explosion", pos, clampf(0.6 + s * 0.4, 0.5, 1.6), randf_range(0.8, 1.1) / sqrt(maxf(s, 0.5)))
	shake(0.45 * s, pos)


func on_step(m, p: Vector3) -> void:
	if cam.global_position.distance_squared_to(p) > 500.0 * 500.0:
		return
	fx.dust(p, 2, 1.0, 5.0, 2.5)
	sfx.play("step", p, 1.0, randf_range(0.9, 1.1) * clampf(float(m.def["walk"]) / 22.0, 0.7, 1.2) * 0.95)
	if m == player:
		shake(0.1)
	else:
		shake(0.12, p)


func on_land(m, speed: float) -> void:
	var p: Vector3 = m.global_position
	fx.dust(p, 10, 3.0, 18.0, 5.0)
	sfx.play("land", p, clampf(speed / 30.0, 0.5, 1.4))
	shake(clampf(speed / 60.0, 0.15, 0.7), null if m == player else p)


func on_boost_start(m) -> void:
	sfx.play("boost", m.center(), 0.9, randf_range(0.9, 1.1))
	if m.grounded:
		fx.dust(m.global_position - U.fwd(m.yaw) * 3.0, 6, 2.0, 14.0, 4.0)
	if m == player:
		shake(0.15)


func on_quick(m) -> void:
	sfx.play("qb", m.center(), 1.0, randf_range(0.9, 1.1))
	if m.grounded:
		fx.dust(m.global_position, 7, 2.0, 18.0, 4.0)
	for t in m.model.thr:
		for i in 3:
			fx.emit("fire", t.global_position, Vector3(randf_range(-4, 4), randf_range(-4, 2), randf_range(-4, 4)))
	if m == player:
		shake(0.25)


func on_jump(m) -> void:
	sfx.play("boost", m.center(), 0.9, 1.15)
	fx.dust(m.global_position, 14, 3.0, 22.0, 6.0)
	for t in m.model.thr:
		for i in 2:
			fx.emit("fire", t.global_position, Vector3(randf_range(-5, 5), randf_range(-14, -6), randf_range(-5, 5)))
	if m == player:
		shake(0.22)


func on_shield_hit(m, from, pos: Vector3, dmg: float, broke: bool, lost: Array) -> void:
	fx.sparks(pos, 8, 36.0)
	sfx.play("shield", pos, clampf(dmg / 500.0, 0.4, 1.2), randf_range(0.9, 1.1))
	for lp in lost:
		fx.chunks(lp, 2, 0.7)
		fx.sparks(lp, 14, 50.0)
	if broke:
		sfx.play("shield_break", pos, 1.3)
		fx.explosion(pos, 0.7)
	if m == player:
		shake(clampf(dmg / 2500.0, 0.04, 0.3))
		if broke:
			hud.note("臂盾损毁  SHIELD BROKEN", hud.C_ALERT, 2.4)
			sfx.play2d("alarm", 0.5)
	elif from == player and m.team != 0:
		stats["dealt"] += dmg
		hud.hit_marker()
		if broke:
			hud.note("敌盾击破  SHIELD BREAK", hud.C_WARN, 1.6)
	combat = 1.0


# a skill core (V) switched on / off: overdrive, weak-point scan, ram charge or jammer
func on_overdrive(m, on: bool) -> void:
	var c: Vector3 = m.center()
	var kind: String = m.sys_kind
	var mine: bool = m == player
	if on:
		var heavy: bool = kind == "od" or kind == "ram"
		var col := Color(1.0, 0.55, 0.2)
		if kind == "scan":
			col = Color(1.0, 0.85, 0.3)
		elif kind == "jam":
			col = Color(0.45, 0.8, 1.0)
		sfx.play("od_on", c, 1.4 if heavy else 1.0, 1.0 if kind == "od" else 1.35)
		# each kind of system has its own voice on top of the power-up
		var voice := {"scan": "scan", "jam": "jam", "ram": "ram", "focus": "focus"}
		if voice.has(kind):
			sfx.play(voice[kind], c, 1.2)
		fx.flash(c, 30.0, 0.5, col)
		if heavy:
			fx.sparks(c, 30, 60.0)
			fx.dust(m.global_position, 12, 3.0, 20.0, 5.0)
		var info := str(m.sys["info"])
		if kind == "scan":
			var n := 0
			for u in units:
				if not u.alive or u.team == m.team or u.hidden:
					continue
				if u.center().distance_to(c) > float(m.sys["range"]):
					continue
				u.mark_t = float(m.sys["dur"])
				u.mark_mul = float(m.sys["mul"])
				n += 1
			info = "标记 %d 个目标 · 全队对其伤害 +%d%%" % [n, int(round((float(m.sys["mul"]) - 1.0) * 100.0))]
			if mine:
				hud.scan_pulse()
			elif m.team == 0 and n > 0:
				hud.note("%s 弱点扫描 · 标记 %d 个目标" % [m.callsign, n], hud.C_ALLY, 2.2)
		elif kind == "jam":
			var lost: int = proj.jam(m)
			for a in ais:
				if a.target == m:
					a.target = null
					a.m.c_lock = null
			if lost > 0:
				info = "%d 枚来袭导弹失去制导 · 敌方丢失锁定" % lost
		if mine:
			hud.show_banner(str(m.sys["tag"]), "%s  ·  %s" % [m.sys["name"], info], col, 2.6)
			shake(0.35 if heavy else 0.12)
		elif m.team != 0 and kind == "od":
			hud.note("敌机超频  ENEMY OVERDRIVE", hud.C_ALERT, 2.0)
	elif kind == "od":
		sfx.play("od_off", c, 1.2)
		for i in 10:
			fx.emit("smoke", c + Vector3(randf_range(-3, 3), randf_range(-3, 3), randf_range(-3, 3)), Vector3(randf_range(-5, 5), randf_range(3, 9), randf_range(-5, 5)))
		if mine:
			hud.note("超频结束 · 强制冷却  COOLDOWN", hud.C_WARN, 2.6)
	elif mine:
		sfx.play2d("od_off", 0.35, 1.3)
		hud.note("%s 结束 · 重新蓄能" % str(m.sys["name"]), hud.C_WARN, 1.8)


func on_hook(m, victim, pos: Vector3) -> void:
	fx.sparks(pos, 18, 50.0)
	fx.flash(pos, 8.0, 0.12)
	sfx.play("clang", pos, 0.9, randf_range(1.2, 1.4))
	if m == player:
		shake(0.25)
		if victim != null:
			hit_stop(0.05)
			hud.note("钩锁命中  ANCHOR HIT", hud.C_WARN, 1.2)
	elif victim == player:
		shake(0.5)
		hud.note("被钩锁命中  ANCHORED", hud.C_ALERT, 1.4)


# a boost cut short the recovery of an attack
func on_cancel(m) -> void:
	sfx.play("qb", m.center(), 0.5, 1.5)
	if m == player:
		hud.cancel_t = 0.5


func on_ram_hit(att, victim, pos: Vector3) -> void:
	fx.sparks(pos, 30, 70.0)
	fx.flash(pos, 16.0, 0.18)
	fx.dust(victim.global_position, 8, 3.0, 16.0, 5.0)
	sfx.play("clang", pos, 1.3, randf_range(0.7, 0.85))
	sfx.play("land", pos, 1.2, 0.8)
	if att == player or victim == player:
		hit_stop(0.07)
		shake(0.7)
		if att == player:
			hud.note("撞击  RAM HIT", hud.C_WARN, 1.0)
	else:
		shake(0.4, pos)


func on_overheat(m) -> void:
	if m == player:
		hud.note("推进器过热  THRUSTER OVERHEAT", hud.C_ALERT, 2.4)
		sfx.play2d("alarm", 0.6)


func on_repair() -> void:
	sfx.play2d("repair", 0.7)
	hud.note("维修套件已使用  AP RESTORED", hud.C_MAIN, 2.0)


func on_stagger(m) -> void:
	fx.sparks(m.center(), 14, 40.0)
	sfx.play("stagger", m.center(), 1.0, randf_range(0.9, 1.1))
	if m == player:
		shake(0.5)
	elif m.last_hit_by == player:
		hud.note("目标硬直  STAGGER", hud.C_WARN, 1.4)


func on_down(m) -> void:
	fx.dust(m.global_position, 12, 3.0, 16.0, 5.0)
	sfx.play("land", m.center(), 1.2, 0.8)
	shake(0.5, null if m == player else m.global_position)
	if m.last_hit_by == player and m != player:
		hud.note("目标倒地  DOWN", hud.C_WARN, 1.6)


# damage over time from a heat weapon
func add_burn(u, total: float, dur: float, from) -> void:
	burns.append({"u": u, "dps": total / dur, "t": dur, "acc": 0.0, "from": from})


func _tick_burns(dt: float) -> void:
	var i := 0
	while i < burns.size():
		var b: Dictionary = burns[i]
		var u = b["u"]
		b["t"] = float(b["t"]) - dt
		b["acc"] = float(b["acc"]) + dt
		if not is_instance_valid(u) or not u.alive or float(b["t"]) <= 0.0:
			burns.remove_at(i)
			continue
		if float(b["acc"]) >= 0.25:
			var c: Vector3 = u.center()
			u.take_damage(float(b["dps"]) * float(b["acc"]), 0.0, b["from"] if is_instance_valid(b["from"]) else null, "burn", c)
			b["acc"] = 0.0
			fx.emit("fire", c + Vector3(randf_range(-2, 2), randf_range(-2, 3), randf_range(-2, 2)), Vector3(0, randf_range(3, 7), 0))
			fx.emit("smoke", c, Vector3(randf_range(-2, 2), randf_range(4, 8), randf_range(-2, 2)))
		i += 1


func on_melee_hit(att, victim, pos: Vector3, power: float = 0.0, energy: String = "solid") -> void:
	if att == player and pc != null:
		pc.rumble(0.5, 0.8 + 0.2 * power, 0.2 + 0.1 * power)
	if energy == "plasma":
		fx.flash(pos, 26.0, 0.2, Color(0.7, 0.85, 1.0))
		sfx.play("beam", pos, 1.0, 1.6)
		sfx.play("heat_hit", pos, 1.1, randf_range(1.0, 1.2))
	elif energy == "heat":
		sfx.play("heat_hit", pos, 1.2, randf_range(0.8, 0.95))
		for i in 4:
			fx.emit("fire", pos, Vector3(randf_range(-8, 8), randf_range(2, 10), randf_range(-8, 8)))
	fx.sparks(pos, 24 + int(power * 30.0), 62.0 + power * 40.0)
	fx.flash(pos, 14.0 + power * 22.0, 0.15 + power * 0.15)
	if power > 0.5:
		fx.chunks(pos, 3, 0.8)
		sfx.play("stagger", pos, 1.2, 0.8)
	for i in 3:
		fx.emit("fire", pos, Vector3(randf_range(-6, 6), randf_range(0, 8), randf_range(-6, 6)))
	sfx.play("clang", pos, 1.2, randf_range(0.85, 1.1))
	if att == player or victim == player:
		hit_stop(0.1 + power * 0.1)
		shake(0.6 + power * 0.3)
	else:
		shake(0.4, pos)


func on_damage(u, dmg: float, from, _how: String, pos: Vector3) -> void:
	if u == player:
		stats["taken"] += dmg
		dmg_flash = minf(1.0, dmg_flash + clampf(dmg / 1400.0, 0.08, 0.6))
		shake(clampf(dmg / 1800.0, 0.05, 0.5))
		if from != null:
			hud.damage_from(from.global_position)
		pc.hit(clampf(dmg / 900.0, 0.1, 0.8))
		sfx.play2d("hurt", clampf(dmg / 600.0, 0.25, 0.9), randf_range(0.9, 1.1))
	elif from == player and u.team != 0:
		stats["dealt"] += dmg
		hud.hit_marker()
	if from != null and from.kind == "mech" and from.team != u.team:
		from.gain_od(dmg / 7500.0)
	combat = 1.0


func on_unit_killed(u, from) -> void:
	var c: Vector3 = u.center()
	match u.kind:
		"mech":
			explode(c, 2.2)
			fx.chunks(c, 10, 1.0)
			explode(c + Vector3(randf_range(-3, 3), -4, randf_range(-3, 3)), 1.2)
		"fighter":
			explode(c, 1.5)
		"transport", "pod":
			explode(c, 2.4)
			fx.chunks(c, 8, 1.6)
			explode(c + Vector3(randf_range(-8, 8), randf_range(-4, 4), randf_range(-8, 8)), 1.8)
		"engine":
			for i in 5:
				fx.explosion(c + Vector3(randf_range(-14, 14), randf_range(-14, 10), randf_range(-14, 14)), 2.5)
			fx.chunks(c, 14, 2.4)
			sfx.play2d("bigboom", 0.6, 1.3)
			shake(0.6)
			hud.note("引擎击毁  ENGINE DESTROYED", hud.C_WARN, 2.6)
		"cannon":
			for i in 4:
				explode(c + Vector3(randf_range(-12, 12), randf_range(-8, 14), randf_range(-12, 12)), 2.5)
			fx.chunks(c, 14, 2.2)
			hud.note("对轨炮被摧毁  CANNON LOST", hud.C_ALERT, 3.0)
			sfx.play2d("alarm", 0.6)
		_:
			explode(c, 1.7)
			fx.chunks(c, 6, 0.8)
	_rebuild_rids()
	if u.team != 0:
		if from == player:
			stats["kills"] += 1
		if from == player or cam.global_position.distance_to(c) < 500.0:
			hud.kill(u.unit_name)
	if mission != null:
		mission.on_kill(u, from)


# ---------------------------------------------------------------- input
func _input(ev: InputEvent) -> void:
	if ev is InputEventMouseMotion:
		if ev.screen_relative.length() > 3.0:
			pad_mode = false
			focus_on = false
		if state == "play" and pc != null and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
			pc.mouse += ev.screen_relative
		return
	if ev is InputEventMouseButton:
		pad_mode = false
		if state == "play" and ev.pressed:
			if Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
				_capture_mouse()
			elif pc != null and (ev.button_index == MOUSE_BUTTON_WHEEL_UP or ev.button_index == MOUSE_BUTTON_WHEEL_DOWN):
				pc.push("swap_up" if ev.button_index == MOUSE_BUTTON_WHEEL_UP else "swap_dn")
			elif pc != null and ev.button_index == MOUSE_BUTTON_MIDDLE:
				pc.push("melee")
		return
	if ev is InputEventJoypadMotion:
		if absf(ev.axis_value) > 0.5:
			_set_pad(true, ev.device)
		return
	if ev is InputEventJoypadButton:
		_set_pad(true, ev.device)
		if ev.pressed:
			_pad_button(ev.button_index)
		elif ev.button_index == JOY_BUTTON_BACK:
			# a tap of the view button switches chase / cockpit; held, it is the free look
			if state == "play" and _pad_back_ms >= 0 and Time.get_ticks_msec() - _pad_back_ms < 280:
				_toggle_cockpit()
			_pad_back_ms = -1
		return
	if not (ev is InputEventKey) or not ev.pressed or ev.echo:
		return
	_set_pad(false, pad_id)
	_key_action(ev.physical_keycode)


func _set_pad(on: bool, id: int) -> void:
	pad_mode = on
	if on:
		pad_id = id
		focus_on = true


# the pad's view button is held down long enough to count as the free look
func pad_look() -> bool:
	return _pad_back_ms >= 0 and Time.get_ticks_msec() - _pad_back_ms >= 280 and Input.is_joy_button_pressed(pad_id, JOY_BUTTON_BACK)


func _toggle_cockpit() -> void:
	if pc == null:
		return
	pc.set_cockpit(not pc.cockpit)
	cockpit_pref = pc.cockpit
	hud.note("驾驶舱视角  COCKPIT" if pc.cockpit else "追尾视角  CHASE CAM", hud.C_MAIN, 1.4)


# prompt text for whichever device was used last
func kh(kb: String, pad: String) -> String:
	return pad if pad_mode else kb


func _pad_button(b: int) -> void:
	if state == "play":
		if pc == null:
			return
		var act := ""
		match b:
			JOY_BUTTON_START:
				_set_pause(true)
			JOY_BUTTON_BACK:
				_pad_back_ms = Time.get_ticks_msec()
			JOY_BUTTON_A:
				act = "jump"
			JOY_BUTTON_B:
				act = "quick"
			JOY_BUTTON_X:
				act = "melee"
			JOY_BUTTON_Y:
				act = "swap"
			JOY_BUTTON_RIGHT_STICK:
				act = "target"
			JOY_BUTTON_DPAD_UP:
				act = "od"
			JOY_BUTTON_DPAD_DOWN:
				act = "repair"
		if act != "":
			pc.push(act)
		return
	# menus: the pad stands in for the keys the screens already answer to
	var k := 0
	match b:
		JOY_BUTTON_A:
			k = KEY_ENTER
		JOY_BUTTON_START:
			k = KEY_ESCAPE if state == "pause" else KEY_ENTER
		JOY_BUTTON_B:
			k = KEY_ESCAPE
		JOY_BUTTON_Y:
			k = KEY_O
		JOY_BUTTON_LEFT_SHOULDER:
			k = KEY_Q
		JOY_BUTTON_RIGHT_SHOULDER:
			k = KEY_E
		JOY_BUTTON_DPAD_UP:
			k = KEY_UP
		JOY_BUTTON_DPAD_DOWN:
			k = KEY_DOWN
		JOY_BUTTON_DPAD_LEFT:
			k = KEY_LEFT
		JOY_BUTTON_DPAD_RIGHT:
			k = KEY_RIGHT
	if k != 0:
		_key_action(k)


# left stick in the menus: one step per push, repeating while it is held
func _pad_nav() -> void:
	if state == "play":
		_nav_dir = 0
		return
	var x := Input.get_joy_axis(pad_id, JOY_AXIS_LEFT_X)
	var y := Input.get_joy_axis(pad_id, JOY_AXIS_LEFT_Y)
	var d := 0
	if absf(x) > 0.6 or absf(y) > 0.6:
		if absf(x) > absf(y):
			d = KEY_RIGHT if x > 0.0 else KEY_LEFT
		else:
			d = KEY_DOWN if y > 0.0 else KEY_UP
	var now := Time.get_ticks_msec()
	if d == 0:
		_nav_dir = 0
	elif d != _nav_dir:
		_nav_dir = d
		_nav_ms = now + 380
		_set_pad(true, pad_id)
		_key_action(d)
	elif now >= _nav_ms and state != "missions":
		_nav_ms = now + 130
		_key_action(d)


func _key_action(k: int) -> void:
	if k == KEY_F11:
		cfg.v["mode"] = 1 if int(cfg.v["mode"]) == 0 else 0
		cfg.apply(self)
		cfg.save_file()
		return
	if k == KEY_M:
		sfx.set_muted(not sfx.muted)
		return
	var enter := k == KEY_ENTER or k == KEY_KP_ENTER or k == KEY_SPACE
	match state:
		"title":
			menu_action("options" if k == KEY_O else "start")
		"options":
			var n: int = cfg.items.size()
			if k == KEY_W or k == KEY_UP:
				opt_i = posmod(opt_i - 1, n)
			elif k == KEY_S or k == KEY_DOWN:
				opt_i = posmod(opt_i + 1, n)
			elif k == KEY_A or k == KEY_LEFT:
				menu_action("cfgm%d" % opt_i)
			elif k == KEY_D or k == KEY_RIGHT:
				menu_action("cfgp%d" % opt_i)
			elif k == KEY_ESCAPE or k == KEY_ENTER or k == KEY_KP_ENTER or k == KEY_O:
				menu_action("cfgback")
		"missions":
			if k == KEY_O:
				menu_action("options")
			elif k == KEY_A or k == KEY_LEFT or k == KEY_W or k == KEY_UP or k == KEY_D or k == KEY_RIGHT or k == KEY_S or k == KEY_DOWN:
				menu_action("msel%d" % posmod(mission_idx + 1, Defs.MISSIONS.size()))
			elif enter:
				menu_action("mok")
			elif k == KEY_ESCAPE:
				_enter_title()
		"hangar":
			if k == KEY_O:
				menu_action("options")
			elif k == KEY_Q or k == KEY_PAGEUP:
				menu_action("sel%d" % posmod(sel - 1, Defs.PLAYER_FRAMES.size()))
			elif k == KEY_E or k == KEY_PAGEDOWN or k == KEY_TAB:
				menu_action("sel%d" % posmod(sel + 1, Defs.PLAYER_FRAMES.size()))
			elif k == KEY_W or k == KEY_UP:
				menu_action("slot%d" % posmod(slot_i - 1, Defs.SLOT_ORDER.size()))
			elif k == KEY_S or k == KEY_DOWN:
				menu_action("slot%d" % posmod(slot_i + 1, Defs.SLOT_ORDER.size()))
			elif k == KEY_A or k == KEY_LEFT:
				menu_action("optm%d" % slot_i)
			elif k == KEY_D or k == KEY_RIGHT:
				menu_action("optp%d" % slot_i)
			elif k == KEY_ENTER or k == KEY_KP_ENTER:
				menu_action("sortie")
			elif k == KEY_ESCAPE:
				_enter_missions()
		"briefing":
			if enter:
				menu_action("engage")
			elif k == KEY_ESCAPE:
				menu_action("hangar")
		"play":
			if k == KEY_ESCAPE:
				_set_pause(true)
			elif k == KEY_TAB and pc != null:
				_toggle_cockpit()
			elif pc != null:
				# edge-triggered actions come from the event itself so a tap shorter than
				# one frame still registers
				var act := ""
				match k:
					KEY_X:
						act = "swap"
					KEY_V:
						act = "od"
					KEY_F:
						act = "melee"
					KEY_Q:
						act = "quick"
					KEY_R:
						act = "repair"
					KEY_T:
						act = "target"
					KEY_SPACE:
						act = "jump"
				if act != "":
					pc.push(act)
		"pause", "result":
			var ids: Array = FOCUS_IDS[state]
			if k == KEY_LEFT or k == KEY_A or k == KEY_UP or k == KEY_W:
				focus_i = posmod(focus_i - 1, ids.size())
				focus_on = true
				sfx.play2d("click", 0.4)
			elif k == KEY_RIGHT or k == KEY_D or k == KEY_DOWN or k == KEY_S:
				focus_i = posmod(focus_i + 1, ids.size())
				focus_on = true
				sfx.play2d("click", 0.4)
			elif k == KEY_ENTER or k == KEY_KP_ENTER:
				if state == "pause" and not focus_on:
					return
				menu_action(ids[clampi(focus_i, 0, ids.size() - 1)])
			elif k == KEY_ESCAPE:
				if state == "pause":
					_set_pause(false)
				else:
					menu_action("hangar")
			elif k == KEY_O and state == "pause":
				menu_action("options")


# ---------------------------------------------------------------- loop
func _process(dt: float) -> void:
	_pad_nav()
	if perf:
		_perf_frame()
	if test_mode:
		_tick_test(dt)
	match state:
		"title", "missions", "hangar", "briefing":
			_tick_stage(dt)
		"options":
			if opt_from != "pause":
				_tick_stage(dt)
		"play":
			Engine.time_scale = 0.06 if Time.get_ticks_msec() < hit_stop_until else test_speed
			var t0 := Time.get_ticks_usec()
			pc.tick(dt)
			t0 = _pf_add("pc", t0)
			_tick_sim(dt)
			t0 = Time.get_ticks_usec()
			if pc != null:
				pc.cam_update(dt)
			if mission != null:
				mission.tick(dt)
			t0 = _pf_add("mission", t0)
			hud.tick(dt)
			_pf_add("hud", t0)
		"result":
			Engine.time_scale = 1.0
			result_t += dt
			_tick_sim(dt)
			var a := result_t * 0.15
			var c := orbit_focus + Vector3(0, 12, 0)
			var want := c + Vector3(sin(a) * 46.0, 16.0, cos(a) * 46.0)
			var hit := ray(c, want, 1, [])
			if not hit.is_empty():
				var hp: Vector3 = hit["position"]
				want = c.lerp(hp, 0.85)
			cam.global_position = want
			cam.look_at(c, Vector3.UP)
	dmg_flash = maxf(0.0, dmg_flash - dt * 1.4)
	combat = maxf(0.0, combat - dt * 0.12)
	var low := 0.0
	var bst := 0.0
	var thr_amt := 0.0
	if state == "play" and player != null:
		if player.alive and player.ap / player.ap_max < 0.25:
			low = 0.2 + 0.12 * sin(Time.get_ticks_msec() * 0.006)
		bst = clampf(Vector2(player.velocity.x, player.velocity.z).length() / 90.0, 0.0, 1.0)
		if player.alive and (player.boosting or player.ascending or player.qb_t > 0.0):
			thr_amt = 1.0
		post_mat.set_shader_parameter("od", player.anim.od)
	else:
		post_mat.set_shader_parameter("od", 0.0)
	var in_pit: bool = state == "play" and pc != null and pc.cockpit
	# the sun in the lens: where it is on screen and how much of it is unblocked
	var sv := 0.0
	var suv := Vector2(0.5, 0.5)
	if (state == "play" or state == "result") and world != null and not stage.visible:
		var sd: Vector3 = world.sun_dir
		var cp := cam.global_position
		if not cam.is_position_behind(cp + sd * 1000.0):
			var vs := get_viewport().get_visible_rect().size
			suv = cam.unproject_position(cp + sd * 1000.0) / vs
			if suv.x > -0.3 and suv.x < 1.3 and suv.y > -0.3 and suv.y < 1.3:
				sv = 1.0 if ray(cp + sd * 2.0, cp + sd * 4000.0, 3, [player.get_rid()] if player != null else []).is_empty() else 0.0
	sun_vis = lerpf(sun_vis, sv, 1.0 - exp(-14.0 * dt))
	post_mat.set_shader_parameter("sun_uv", suv)
	post_mat.set_shader_parameter("sun_vis", sun_vis * (1.0 if (world != null and world.space) else 0.45))
	sfx.set_outside(world != null and world.space and state == "play", in_pit, dt)
	post_mat.set_shader_parameter("cockpit", 1.0 if in_pit else 0.0)
	if world != null and in_pit != _pit_fx:
		# Screen-space light at the scale of what fills the picture. Outside: wide occlusion between
		# frames, buildings and ground. In the cabin: tight contact shadow in every joint and corner of
		# the furniture, lamps and screens bouncing their colour onto it, reflections on lacquer.
		_pit_fx = in_pit
		var e: Environment = world.env
		var hi: bool = e.ssao_enabled                # the quality setting decides whether any of it runs
		e.ssao_radius = 0.55 if in_pit else 2.5
		e.ssao_intensity = 3.4 if in_pit else 2.2
		e.ssao_power = 1.8 if in_pit else 1.5
		e.ssao_detail = 0.8 if in_pit else 0.5
		e.ssao_light_affect = 0.25 if in_pit else 0.0
		e.ssil_enabled = in_pit and hi
		e.ssil_radius = 1.6
		e.ssil_intensity = 1.6
		e.ssr_enabled = in_pit and hi
		e.ssr_max_steps = 32
		e.ssr_fade_in = 0.2
		e.ssr_fade_out = 2.0
		# bloom: outside it is the sun on armour and muzzle light; in the cabin it would turn every
		# highlight on polished metal into a white blot
		e.glow_hdr_threshold = 1.7 if in_pit else 1.1
		e.glow_intensity = 0.32 if in_pit else 0.5
	# armour alarm: a klaxon that quickens as the armour goes, and the warning light's sweep
	var a_frac: float = player.ap / player.ap_max if (state == "play" and player != null and player.alive) else 1.0
	var a_on := a_frac < 0.25
	alarm_k = lerpf(alarm_k, 1.0 if a_on else 0.0, 1.0 - exp(-5.0 * dt))
	post_mat.set_shader_parameter("alarm", alarm_k)
	if a_on:
		alarm_t -= dt
		if alarm_t <= 0.0:
			alarm_t = 0.75 if a_frac < 0.12 else 1.3
			sfx.play2d("warn", 0.42, 0.72 if a_frac < 0.12 else 0.6)
	else:
		alarm_t = 0.0
	post_mat.set_shader_parameter("glitch", pc.glitch if (state == "play" and pc != null) else 0.0)
	post_mat.set_shader_parameter("crack", clampf((0.6 - player.ap / player.ap_max) / 0.6, 0.0, 1.0) if (state == "play" and player != null) else 0.0)
	post_mat.set_shader_parameter("damage", maxf(dmg_flash, low))
	post_mat.set_shader_parameter("boost", bst)
	sfx.tick(dt, thr_amt, combat if state == "play" else 0.0)


func _pf_add(k: String, t0: int) -> int:
	var now := Time.get_ticks_usec()
	_pf[k] = int(_pf.get(k, 0)) + now - t0
	return now


func _tick_sim(dt: float) -> void:
	var t0 := Time.get_ticks_usec()
	for a in ais:
		a.tick(dt)
	t0 = _pf_add("ai", t0)
	for u in units.duplicate():
		if u.mark_t > 0.0:
			u.mark_t -= dt
		u.tick(dt)
	for e in extras:
		e.tick(dt)
	t0 = _pf_add("units", t0)
	proj.tick(dt)
	_tick_burns(dt)
	t0 = _pf_add("proj", t0)
	world.tick(dt, cam.global_position, fx)
	fx.tick(dt)
	t0 = _pf_add("fx", t0)


func _tick_stage(dt: float) -> void:
	stage_t += dt
	if stage_model != null:
		var a = stage_anim
		a.idle_t += dt
		a.pitch = 0.05
		var sl: String = Defs.SLOT_ORDER[slot_i]
		var show: bool = state == "hangar"
		a.od = U.damp(a.od, 1.0 if (show and sl == "SYS") else 0.0, 4.0, dt)
		a.guard = U.damp(a.guard, 1.0 if (show and sl == "L") else 0.0, 5.0, dt)
		a.fire = 1.0
		a.blade_show = 1.0 if (show and sl == "M") else 0.0
		a.blade = U.damp(a.blade, a.blade_show, 5.0, dt)
		a.two_hand = U.damp(a.two_hand, 0.0 if (show and sl == "L") else 1.0, 5.0, dt)
		a.swap = 0.0
		var want_r := 0
		if show and (sl == "R2" or sl == "R3"):
			var lo2 := cur_loadout()
			if lo2[sl] != "":
				for q in ["R1", "R2", "R3"]:
					if q == sl:
						break
					if lo2[q] != "":
						want_r += 1
		if stage_model.hand_r[want_r] == null:
			want_r = 0
		stage_model.set_active_r(want_r)
		stage_model.gait(dt, stage_model.rotation.y, Vector3.ZERO, _stage_ground, true)
		stage_model.pose(a, dt)
	var ang := sin(stage_t * 0.22) * 0.6
	var tgt := STAGE_POS + Vector3(0, 9.6, 0)
	var pos := STAGE_POS + Vector3(sin(ang) * 41.0, 10.5, cos(ang) * 41.0)
	cam.fov = 38.0
	if state == "title" or state == "missions":
		pos = STAGE_POS + Vector3(-17.0 + sin(stage_t * 0.1) * 3.0, 5.0, 30.0)
		tgt = STAGE_POS + Vector3(6.0, 11.0, 0)
		cam.fov = 44.0
	cam.global_position = pos
	cam.look_at(tgt, Vector3.UP)


func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		Glb.free_templates()


# ---------------------------------------------------------------- autotest
# frame-time probe: prints every hitch with the script time spent per section that frame
func _perf_frame() -> void:
	var now := Time.get_ticks_usec()
	var ms := (now - _pf_last) / 1000.0
	if _pf_last != 0 and test_t > 1.0:
		_pf_n += 1
		_pf["frame"] = float(_pf.get("frame", 0.0)) + ms
		_pf_max = maxf(_pf_max, ms)
		if ms > 22.0:
			_pf_spikes += 1
			var parts := ""
			for k in _pf:
				if k != "frame" and not k.begins_with("T_"):
					parts += " %s %.1f" % [k, float(_pf[k]) / 1000.0]
			print("SPIKE t=%.1f  %.1f ms |%s | %s" % [test_t, ms, parts, _pf_note])
	for k in _pf.keys():
		if k != "frame" and not k.begins_with("T_"):
			_pf["T_" + k] = int(_pf.get("T_" + k, 0)) + int(_pf[k])
			_pf[k] = 0
	_pf_note = ""
	_pf_last = now


func _perf_report() -> void:
	var n := maxi(_pf_n, 1)
	var out := "PERF frames %d  avg %.2f ms  max %.1f ms  spikes %d |" % [n, float(_pf.get("frame", 0.0)) / n, _pf_max, _pf_spikes]
	for k in _pf:
		if k.begins_with("T_"):
			out += " %s %.2f" % [k.substr(2), float(_pf[k]) / 1000.0 / n]
	print(out)


func _shot(name: String) -> void:
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	img.save_png(ProjectSettings.globalize_path("res://_shots/%s.png" % name))


var test_foe = null


func _tp(x: float, z: float, yaw: float) -> void:
	player.global_position = Vector3(x, 0.0 if world.space else world.height(x, z) + 0.5, z)
	player.velocity = Vector3.ZERO
	player.yaw = yaw
	pc.yaw = yaw
	pc.auto["yaw"] = yaw
	pc.pivot = player.global_position + Vector3(0, 20, 0)


func _build_test(args: PackedStringArray) -> void:
	var s := test_steps
	apply_win = args.has("--applywin")
	if args.has("--perf"):
		perf = true
		DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
	for a in args:
		if a.begins_with("--frame="):
			sel = int(a.substr(8))
		elif a.begins_with("--mission="):
			mission_idx = int(a.substr(10))
		elif a.begins_with("--lo="):
			for kv in a.substr(5).split(","):
				var pr := kv.split(":")
				test_lo[pr[0]] = pr[1] if pr.size() > 1 else ""
		elif a.begins_with("--cfg="):
			for kv in a.substr(6).split(","):
				var pr := kv.split(":")
				cfg.v[pr[0]] = int(pr[1])
	for a in args:
		# ad-hoc script: --script=0.3=start;0.5=set:fire0;2.0=shot:x;2.2=quit
		if a.begins_with("--script="):
			for st in a.substr(9).split(";"):
				var i := st.find("=")
				s.append([float(st.substr(0, i)), st.substr(i + 1)])
			return
	if args.has("--menus"):
		for e in [[0.8, "shot:m_title"], [1.2, "menu:start"], [1.9, "shot:m_missions0"], [2.0, "menu:msel1"], [2.6, "shot:m_missions1"], [2.7, "menu:mok"],
			[3.6, "shot:m_hangar0"], [3.7, "menu:slot2"], [4.5, "shot:m_hangar_shield"], [4.6, "menu:optp2"], [5.4, "shot:m_hangar_opt"],
			[5.5, "menu:slot6"], [6.6, "shot:m_hangar_od"], [6.7, "menu:sel1"], [7.6, "shot:m_hangar1"], [7.7, "menu:sel2"], [8.6, "shot:m_hangar2"],
			[8.7, "menu:sortie"], [9.6, "shot:m_brief"], [9.9, "quit"]]:
			s.append(e)
		return
	if args.has("--move"):
		# locomotion close-ups: walk in all directions, slope, dash, take-off, flight, landing
		for e in [[0.3, "start"], [0.35, "god"], [0.4, "cam:side"], [0.5, "set:fwd"], [1.6, "shot:v_walk1"], [1.85, "shot:v_walk2"], [2.1, "shot:v_walk3"],
			[2.2, "clr:fwd"], [2.2, "set:right"], [3.3, "shot:v_strafe"], [3.4, "clr:right"], [3.4, "set:back"], [4.5, "shot:v_back"], [4.6, "clr:back"],
			[5.4, "shot:v_idle"], [5.5, "cam:rear"], [5.5, "set:fwd"], [5.5, "set:boost"], [5.75, "shot:v_boost0"], [6.6, "shot:v_boost1"],
			[6.7, "clr:fwd"], [6.7, "set:left"], [7.4, "shot:v_boost_side"], [7.5, "clr:left"], [7.5, "clr:boost"], [8.4, "set:jump"], [8.6, "shot:v_takeoff"],
			[9.6, "shot:v_ascend"], [9.7, "set:fwd"], [9.7, "set:boost"], [10.6, "shot:v_airdash"], [10.7, "clr:jump"], [10.7, "clr:boost"], [10.7, "clr:fwd"],
			[11.3, "shot:v_fall"], [12.6, "shot:v_land"], [12.7, "set:quick"], [12.85, "shot:v_quick"], [12.9, "clr:quick"], [13.6, "stats"], [13.8, "quit"]]:
			s.append(e)
		return
	if args.has("--mech"):
		# new mechanics: charge shot, beam, swap, shield, overdrive
		for e in [[0.3, "start"], [0.35, "god"], [0.5, "tpnear"], [0.6, "pitch:0.06"], [1.2, "set:fire0"], [2.4, "shot:k_fire"], [2.5, "clr:fire0"],
			[2.6, "set:swap"], [2.7, "clr:swap"], [3.0, "shot:k_swap"], [3.6, "set:fire0"], [4.9, "shot:k_charge"], [5.3, "clr:fire0"], [5.4, "shot:k_charge_shot"],
			[5.8, "set:fire0"], [7.6, "clr:fire0"], [7.7, "shot:k_charge2"], [8.0, "od"], [8.1, "set:od"], [8.2, "clr:od"], [9.0, "shot:k_od"],
			[9.2, "set:fire1"], [9.6, "clr:fire1"], [10.2, "shot:k_od2"], [10.4, "shieldtest"], [12.5, "shot:k_shield"], [14.5, "shot:k_shield2"],
			[14.6, "stats"], [14.8, "quit"]]:
			s.append(e)
		return
	if args.has("--drop"):
		# Operation Descent tour
		for e in [[0.3, "start"], [0.35, "god"], [1.5, "shot:d_start"], [1.6, "pitch:0.35"], [9.0, "shot:d_fighters"], [9.2, "call:_fighters3"],
			[14.0, "shot:d_air"], [14.2, "tp:0,-120"], [14.3, "pitch:0.3"], [26.0, "shot:d_transport"], [33.0, "shot:d_drop"], [34.0, "pitch:0.05"],
			[34.2, "set:fire0"], [37.0, "shot:d_fight"], [37.1, "clr:fire0"], [37.2, "call:_phase2"], [38.0, "pitch:0.5"], [47.0, "shot:d_pods"],
			[52.0, "shot:d_pods2"], [52.1, "pitch:0.1"], [58.0, "shot:d_ground"], [58.2, "charge"], [59.0, "pitch:0.45"], [64.0, "shot:d_ship1"],
			[72.0, "shot:d_ship2"], [80.0, "shot:d_salvo"], [80.2, "tp:0,-520"], [80.3, "pitch:0.9"], [84.0, "shot:d_under"], [84.2, "killengines"],
			[87.0, "shot:d_fall1"], [91.0, "shot:d_fall2"], [96.0, "shot:d_crash"], [100.0, "stats"], [108.0, "shot:d_result"], [108.5, "quit"]]:
			s.append(e)
		return
	if args.has("--t3"):
		for e in [[0.3, "start"], [0.35, "god"], [0.5, "boss"], [2.2, "shot:b_drop"], [5.5, "tpboss"], [6.5, "shot:b_1"], [6.6, "set:fire0"],
			[9.0, "shot:b_2"], [12.0, "shot:b_3"], [15.0, "shot:b_4"], [15.1, "stats"], [15.3, "quit"]]:
			s.append(e)
		return
	if args.has("--t2"):
		for e in [
			[0.3, "start"], [0.35, "god"], [0.5, "tpnear"], [1.6, "set:fire1"], [2.3, "clr:fire1"], [2.35, "set:melee"], [2.45, "clr:melee"],
			[2.75, "shot:t_melee1"], [2.95, "set:melee"], [3.05, "clr:melee"], [3.35, "shot:t_melee2"], [4.4, "shot:t_down"],
			[4.6, "set:boost"], [4.6, "set:back"], [4.9, "set:jump"], [6.0, "shot:t_air"], [6.2, "clr:boost"], [6.2, "clr:back"], [6.2, "clr:jump"],
			[7.0, "killturrets"], [8.5, "shot:t_phase2"], [14.0, "killwave"], [20.5, "shot:t_phase3"], [23.0, "shot:t_boss"], [27.0, "shot:t_boss2"],
			[27.2, "die"], [29.0, "shot:t_fail"], [33.5, "shot:t_failres"], [34.0, "quit"]]:
			s.append(e)
		return
	for e in [
		[0.3, "start"], [0.4, "set:fwd"], [2.0, "shot:p_walk"], [2.1, "set:boost"], [4.0, "shot:p_boost"],
		[5.0, "clr:boost"], [5.0, "clr:fwd"], [5.0, "tp:0,330"], [5.2, "set:fire0"], [7.2, "shot:p_fire"], [7.2, "set:fire1"],
		[8.4, "shot:p_heavy"], [8.4, "set:fire2"], [9.8, "shot:p_missile"], [9.8, "clr:fire0"], [9.8, "clr:fire1"], [9.8, "clr:fire2"],
		[10.0, "tp:8,160"], [10.0, "set:fire0"], [10.0, "set:fire1"], [12.0, "shot:p_close"], [12.0, "set:melee"], [12.3, "clr:melee"],
		[12.42, "shot:p_melee"], [12.6, "set:melee"], [13.0, "shot:p_melee2"], [13.0, "clr:melee"],
		[16.0, "shot:p_after"], [16.0, "stats"], [16.2, "pause"], [16.6, "shot:m_pause"], [16.8, "resume"], [16.8, "win"],
		[23.5, "shot:m_result"], [24.0, "quit"]]:
		s.append(e)


func _test_cmd(c: String) -> void:
	var arg := ""
	var i := c.find(":")
	if i >= 0:
		arg = c.substr(i + 1)
		c = c.substr(0, i)
	match c:
		"shot":
			_shot(arg)
		"menu":
			menu_action(arg)
		"quit":
			get_tree().quit()
		"start":
			start_mission()
			pc.auto = {"yaw": 0.0, "pitch": 0.02}
		"set":
			pc.auto[arg] = true
		"clr":
			pc.auto[arg] = false
		"tp":
			var xy := arg.split(",")
			_tp(float(xy[0]), float(xy[1]), 0.0)
		"stats":
			if perf:
				_perf_report()
			print("SCREEN ", DisplayServer.screen_get_size(), " window ", get_window().size, " mode ", get_window().mode, " vp ", get_viewport().get_visible_rect().size, " hz ", DisplayServer.screen_get_refresh_rate())
			print("STATS ", stats, " ap ", player.ap, " phase ", mission.phase, " units ", units.size(), " fps ", Engine.get_frames_per_second(), " glb ", player.model.from_glb)
		"killboss":
			mission.boss.destroy(player)
		"pit":
			pc.set_cockpit(arg != "0")
		"pitkey":
			# hold the cabin's key light in a direction of the cabin's own space
			var kv := arg.split(",")
			if pc.pit != null:
				pc.pit.key_fix = Vector3(float(kv[0]), float(kv[1]), float(kv[2]))
		"pitsolo":
			if pc.pit != null:
				pc.pit.solo = arg != "0"
				pc.pit.no_shadow = arg == "2"
		"pitui":
			# dump the cockpit's instrument atlas
			if pc.pit != null and pc.pit.vp != null:
				pc.pit.vp.get_texture().get_image().save_png(ProjectSettings.globalize_path("res://_shots/pit_ui.png"))
		"aimlock":
			# point the aim at the locked target
			if pc.lock != null:
				var ad: Vector3 = (pc.lock.center() - cam.global_position).normalized()
				pc.yaw = atan2(-ad.x, -ad.z)
				pc.pitch = asin(clampf(ad.y, -1.0, 1.0))
		"foe":
			# foe:<frame>[,metres ahead][,1 = with its AI]: stand an enemy frame in front of the player
			var fa := arg.split(",")
			var fd := float(fa[1]) if fa.size() > 1 else 42.0
			var fp: Vector3 = player.global_position + Vector3(0, 0, -fd)
			if not world.space:
				fp.y = world.height(fp.x, fp.z) + 0.5
			test_foe = spawn_mech(fa[0], 1, fp, PI, fa.size() > 2 and fa[2] == "1")
		"roster":
			# enemy frames alive right now, counted by type
			var rc := {}
			for u in units:
				if u.alive and u.team == 1 and u.kind == "mech":
					rc[u.def_id] = int(rc.get(u.def_id, 0)) + 1
			print("ROSTER ", rc)
		"free":
			# drop every scripted input, so the real devices (or pad events) drive the frame
			pc.auto.clear()
		"padbtn":
			# padbtn:<button index>,<1|0>: a gamepad button event, as the engine would deliver it
			var pb := arg.split(",")
			var be := InputEventJoypadButton.new()
			be.device = 0
			be.button_index = int(pb[0])
			be.pressed = pb.size() < 2 or pb[1] != "0"
			Input.parse_input_event(be)
		"padaxis":
			# padaxis:<axis>,<value>
			var pa := arg.split(",")
			var ae := InputEventJoypadMotion.new()
			ae.device = 0
			ae.axis = int(pa[0])
			ae.axis_value = float(pa[1])
			Input.parse_input_event(ae)
		"where":
			var pp: Vector3 = player.global_position if player != null and is_instance_valid(player) else Vector3.ZERO
			print("WHERE state ", state, " pad ", pad_mode, " pos ", pp.snapped(Vector3.ONE), " yaw ", snappedf(pc.yaw, 0.01) if pc != null else 0.0,
				" pitch ", snappedf(pc.pitch, 0.01) if pc != null else 0.0, " mstate ", player.state if player != null and is_instance_valid(player) else "", " sel ", sel, " slot ", slot_i, " focus ", focus_i, " cockpit ", pc.cockpit if pc != null else false)
		"mkey":
			# mkey:<path>,<phase>[,charge]: hold every frame in that key of a blow; mkey: alone lets go
			var ka := arg.split(",")
			MechModel.dbg_key = [ka[0], float(ka[1]), float(ka[2]) if ka.size() > 2 else 0.0] if ka.size() > 1 else []
		"blade":
			# blade:1 / blade:0: the player's sword drawn or put up, whatever the range
			player.blade_t = 9999.0 if arg == "1" else 0.0
		"forcelock":
			# forcelock:<def id or part kind>: turn the view onto the first such enemy and lock it
			for u in units:
				if u.alive and u.team != player.team and (("def_id" in u and u.def_id == arg) or ("kind" in u and str(u.kind) == arg)):
					var fd: Vector3 = (u.center() - cam.global_position).normalized()
					pc.yaw = atan2(-fd.x, -fd.z)
					pc.pitch = asin(clampf(fd.y, -1.0, 1.0))
					pc.auto["yaw"] = pc.yaw
					pc.auto["pitch"] = pc.pitch
					pc.lock = u
					pc.lock_grace = 0.7
					break
		"lockinfo":
			# every enemy mech: what the lock-on test sees of it
			for u in units:
				if u.alive and u.team != player.team:
					var uc: Vector3 = u.center()
					var hitr: Dictionary = ray(pc.pivot, uc, 1, [])
					print("LOCKINFO ", (u.def_id if "def_id" in u else (str(u.kind) if "kind" in u else "?")), " scr ", pc._screen_off(uc).snapped(Vector2.ONE * 0.01), " behind ", cam.is_position_behind(uc), " dist ", snappedf(uc.distance_to(player.global_position), 1.0), " hidden ", u.hidden, " los ", hitr.is_empty(), " gap ", (snappedf((hitr["position"] as Vector3).distance_to(uc), 0.1) if not hitr.is_empty() else 0.0), " locked ", pc.lock == u, " sees ", pc._sees(u, uc),
						" by ", (str((hitr["collider"] as Node).get_path()).right(46) if not hitr.is_empty() else "-"), " name ", (u.unit_name if "unit_name" in u else ""))
					if not hitr.is_empty() and hitr["collider"] is CollisionObject3D and (hitr["collider"] as Node).get_parent() == world:
						var co: CollisionObject3D = hitr["collider"]
						var so: int = co.shape_find_owner(int(hitr["shape"]))
						var shp: Shape3D = co.shape_owner_get_shape(so, 0)
						var sxf: Transform3D = co.global_transform * co.shape_owner_get_transform(so)
						var ext := ""
						if shp is SphereShape3D:
							ext = "sphere r %.0f" % (shp as SphereShape3D).radius
						elif shp is BoxShape3D:
							ext = "box " + str((shp as BoxShape3D).size.snapped(Vector3.ONE))
						elif shp is CylinderShape3D:
							ext = "cyl r %.0f h %.0f" % [(shp as CylinderShape3D).radius, (shp as CylinderShape3D).height]
						else:
							ext = shp.get_class()
						print("  WORLDSHAPE ", ext, " at ", sxf.origin.snapped(Vector3.ONE), " hit ", (hitr["position"] as Vector3).snapped(Vector3.ONE), " scale ", sxf.basis.get_scale().snapped(Vector3.ONE * 0.1))
		"tpship":
			# stand off a warship and face it: "<0 boss | 1 escort | 2 own cruiser>,<dx>,<dy>,<dz>" (offset in world axes)
			var tv := arg.split(",")
			var tsh = mission.get(["boss", "escort", "ship"][clampi(int(tv[0]), 0, 2)])          # 2 = the friendly cruiser
			if tsh != null:
				var tc: Vector3 = tsh.center()
				player.global_position = tc + Vector3(float(tv[1]), float(tv[2]), float(tv[3]))
				player.velocity = Vector3.ZERO
				var td: Vector3 = tc - player.global_position
				pc.auto["yaw"] = atan2(-td.x, -td.z)
				pc.auto["pitch"] = atan2(td.y, Vector2(td.x, td.z).length())
				pc.yaw = pc.auto["yaw"]
				pc.pitch = pc.auto["pitch"]
				print("TPSHIP ", tsh.ship_name, " centre ", tc.snapped(Vector3.ONE), " player ", player.global_position.snapped(Vector3.ONE))
		"partvis":
			# every warship part: from how many of 48 directions round it the lock-on test can see it
			for u in units:
				if not ("anchor" in u) or not u.alive or u.ship == null:
					continue
				var uc: Vector3 = u.center()
				var seen := 0
				for iy in [-0.6, -0.2, 0.2, 0.6]:
					for ia in 12:
						var aa: float = TAU * ia / 12.0
						var hk: float = sqrt(1.0 - iy * iy)
						var dv := Vector3(cos(aa) * hk, iy, sin(aa) * hk)
						var hr: Dictionary = ray(uc + dv * 400.0, uc, 1, [])
						if hr.is_empty() or (hr["position"] as Vector3).distance_to(uc) < float(u.radius) * 2.5 + 10.0:
							seen += 1
				print("PARTVIS ", u.ship.ship_name, " ", u.unit_name, " r ", snappedf(u.radius, 0.1), " seen ", seen, "/48 hidden ", u.hidden, " team ", u.team,
					" local ", (u.ship.to_local(uc) as Vector3).snapped(Vector3.ONE))
		"foeinfo":
			# state of the frame placed by "foe": distance, armour, hand weapon ammo / reload
			if test_foe != null and is_instance_valid(test_foe):
				var fw = test_foe.weapons[0]
				print("FOE ", test_foe.def_id, " dist ", snappedf(test_foe.global_position.distance_to(player.global_position), 1.0), " ap ", test_foe.ap,
					" ammo ", fw.ammo if fw != null else -1, " reload ", snappedf(fw.reload_t, 0.1) if fw != null else -1.0, " cd ", snappedf(fw.cd, 0.1) if fw != null else -1.0)
				# and why the player can or cannot lock it
				var fc: Vector3 = test_foe.center()
				print("FOELOCK locked ", pc.lock == test_foe, " (lock = ", pc.lock.def_id if (pc.lock != null and "def_id" in pc.lock) else str(pc.lock), ") team ", test_foe.team, " hidden ", test_foe.hidden, " alive ", test_foe.alive, " in_units ", units.has(test_foe),
					" hit_h ", snappedf(test_foe.hit_h, 0.1), " centre ", fc.snapped(Vector3.ONE * 0.1), " behind ", cam.is_position_behind(fc), " screen ", pc._screen_off(fc).snapped(Vector2.ONE * 0.01), " los ", los(pc.pivot, fc), " range ", pc.lock_range)
		"guard":
			# hold the shield guard up for a while
			player.guard_v = float(arg)
		"guardpose":
			# tune the shield guard pose: shoulder pitch, elbow, inward roll, yaw
			var gv := arg.split(",")
			MechModel.GUARD_POSE = Vector3(float(gv[0]), float(gv[1]), float(gv[2]))
			MechModel.GUARD_YAW = float(gv[3])
		"seat":
			var sv := arg.split(",")
			pc.seat_k = Vector2(float(sv[0]), float(sv[1]))
		"hp":
			player.ap = player.ap_max * float(arg)
		"hurt":
			player.take_damage(float(arg), 0.0, null, "test", player.center())
		"look":
			var lv := arg.split(",")
			pc.auto["look"] = true
			pc.look = Vector2(float(lv[0]), float(lv[1]))
		"pitch":
			pc.auto["pitch"] = float(arg)
		"yaw":
			pc.auto["yaw"] = float(arg)
		"tp3":
			var v3 := arg.split(",")
			player.global_position = Vector3(float(v3[0]), float(v3[1]), float(v3[2]))
			player.velocity = Vector3.ZERO
			pc.pivot = player.global_position + Vector3(0, 20, 0)
		"roof":
			# drop onto the tallest ruined-town building
			var bestc = null
			for cc in world.cols:
				if cc.has("w") and float(cc["z"]) < -380.0 and float(cc["w"]) > 26.0 and (bestc == null or float(cc["h"]) > float(bestc["h"])):
					bestc = cc
			if bestc != null:
				player.global_position = Vector3(bestc["x"], float(bestc["h"]) + 30.0, bestc["z"])
				player.velocity = Vector3.ZERO
				pc.pivot = player.global_position + Vector3(0, 20, 0)
				print("ROOF ", bestc)
		"where":
			print("WHERE ", player.global_position, " ground ", world.height(player.global_position.x, player.global_position.z), " grounded ", player.grounded, " state ", player.state, " r_idx ", player.r_idx, " od_on ", player.od_on, " hidden ", player.hidden, " rec ", snappedf(player.recover_t, 0.01), " brace ", snappedf(player.brace_t, 0.01), " hook ", player.hook.get("phase", "-"), " melee ", player.melee["tag"], " dealt ", int(stats["dealt"]), " hs ", snappedf(Vector2(player.velocity.x, player.velocity.z).length(), 0.1))
		"speed":
			test_speed = float(arg)
		"watch":
			watch_t = 0.0
		"report":
			_report()
		"tap":
			pc.push(arg)
		"stun":
			player._enter("stagger")
		"cam":
			pc.auto["cam"] = arg
		"od":
			player.od = 1.0
		"call":
			if arg == "_fighters3":
				mission._fighters(3)
			else:
				mission.call(arg)
		"charge":
			mission.gun_charge = 0.985
			if mission.carrier != null:
				mission.carrier.t = mission.carrier.descend_time - 3.0
		"killengines":
			for e in mission.carrier.engines:
				if e.alive:
					e.take_damage(999999.0, 0.0, player, "test", e.center())
		"shieldtest":
			# an enemy opens up on the player's shield side
			player.ap = player.ap_max
			for u in units:
				if u.alive and u.team == 1 and u.kind == "mech":
					var pp: Vector3 = player.global_position
					u.global_position = Vector3(pp.x - 30.0, pp.y, pp.z - 60.0)
					u.dmg_mul = 6.0
					break
		"god":
			player.ap_max = 99999.0
			player.ap = 99999.0
		"tpnear":
			for u in units:
				if u.alive and u.team == 1 and u.kind == "mech":
					var ep: Vector3 = u.global_position
					_tp(ep.x, ep.z + 42.0, 0.0)
					break
		"killturrets":
			for u in units:
				if u.alive and u.kind == "turret":
					u.take_damage(99999.0, 0.0, player, "test", u.center())
		"killwave":
			for u in mission.wave:
				if u.alive:
					u.take_damage(99999.0, 0.0, player, "test", u.center())
		"boss":
			mission._phase3()
		"tpboss":
			var bp: Vector3 = mission.boss.global_position
			_tp(bp.x, bp.z + 70.0, 0.0)
		"die":
			player.guard_t = 0.0
			player.take_damage(999999.0, 0.0, null, "test", player.center())
		"pause":
			_set_pause(true)
		"resume":
			_set_pause(false)
		"win":
			mission._end(true, "")


func _report() -> void:
	if mission == null or player == null:
		return
	var foes := {}
	var friends := 0
	for u in units:
		if not u.alive:
			continue
		if u.team == 0:
			friends += 1
		else:
			foes[u.kind] = int(foes.get(u.kind, 0)) + 1
	var out := "REPORT t=%d phase %d over %s won %s | player ap %d | friends %d foes %s" % [int(mission.t), mission.phase, mission.over, mission.won, int(player.ap), friends, foes]
	if mission.get("cannons") != null:
		out += " | cannons"
		for c in mission.cannons:
			out += " %d" % int(c.ap)
		out += " | charge %d%%" % int(mission.gun_charge * 100.0)
		if mission.carrier != null:
			out += " | ship alt %d engines" % int(mission.carrier.altitude())
			for e in mission.carrier.engines:
				out += " %d" % int(e.ap)
	print(out)


func _tick_test(dt: float) -> void:
	test_t += dt / maxf(Engine.time_scale, 0.01)
	if watch_t >= 0.0 and state == "play":
		watch_t -= dt
		if watch_t <= 0.0:
			watch_t = 30.0
			_report()
	while not test_steps.is_empty() and float(test_steps[0][0]) <= test_t:
		var c: String = test_steps[0][1]
		test_steps.pop_front()
		_test_cmd(c)
