extends RefCounted
# Display / graphics / input options. Saved to user://settings.json.
# v[id] is the index of the chosen option of each item.

const PATH := "user://settings.json"
const RES := [Vector2i(1280, 720), Vector2i(1366, 768), Vector2i(1600, 900), Vector2i(1680, 1050), Vector2i(1920, 1080), Vector2i(1920, 1200),
	Vector2i(2560, 1080), Vector2i(2560, 1440), Vector2i(2560, 1600), Vector2i(3440, 1440), Vector2i(3840, 2160)]

var items: Array = [
	{"id": "mode", "name": "显示模式", "en": "DISPLAY MODE", "opts": ["窗口", "无边框全屏", "独占全屏"], "vals": [0, 1, 2]},
	{"id": "res", "name": "窗口分辨率", "en": "RESOLUTION", "opts": [], "vals": []},
	{"id": "scale", "name": "渲染精度", "en": "RENDER SCALE", "opts": ["50%", "67%", "75%", "85%", "100%"], "vals": [0.5, 0.67, 0.75, 0.85, 1.0]},
	{"id": "quality", "name": "画质", "en": "QUALITY", "opts": ["低", "中", "高"], "vals": [0, 1, 2]},
	{"id": "vsync", "name": "垂直同步", "en": "V-SYNC", "opts": ["关", "开"], "vals": [0, 1]},
	{"id": "fps", "name": "帧率上限", "en": "FPS LIMIT", "opts": ["30", "60", "90", "120", "144", "240", "不限"], "vals": [30, 60, 90, 120, 144, 240, 0]},
	{"id": "fov", "name": "视野", "en": "FIELD OF VIEW", "opts": ["60°", "65°", "70°", "75°", "80°", "90°"], "vals": [60.0, 65.0, 70.0, 75.0, 80.0, 90.0]},
	{"id": "cam", "name": "镜头距离", "en": "CAMERA DISTANCE", "opts": ["近", "标准", "远", "很远"], "vals": [32.0, 40.0, 48.0, 58.0]},
	{"id": "sens", "name": "鼠标灵敏度", "en": "MOUSE SENSITIVITY", "opts": ["40%", "60%", "80%", "100%", "120%", "140%", "170%", "200%"], "vals": [0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.7, 2.0]},
	{"id": "pad", "name": "手柄视角速度", "en": "GAMEPAD LOOK SPEED", "opts": ["50%", "70%", "85%", "100%", "120%", "140%", "170%", "200%"], "vals": [0.5, 0.7, 0.85, 1.0, 1.2, 1.4, 1.7, 2.0]},
	{"id": "pad_inv", "name": "手柄视角上下反转", "en": "GAMEPAD INVERT Y", "opts": ["关", "开"], "vals": [0, 1]},
	{"id": "rumble", "name": "手柄震动", "en": "GAMEPAD RUMBLE", "opts": ["关", "开"], "vals": [0, 1]},
	{"id": "vol", "name": "主音量", "en": "MASTER VOLUME", "opts": ["0%", "10%", "20%", "30%", "40%", "50%", "60%", "70%", "80%", "90%", "100%"], "vals": [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]},
]
var v := {}
var screen_size := Vector2i(1920, 1080)
var screen_hz := 60.0
var embedded := false


func _init() -> void:
	screen_size = DisplayServer.screen_get_size()
	screen_hz = DisplayServer.screen_get_refresh_rate()
	if screen_hz <= 0.0:
		screen_hz = 60.0
	embedded = Engine.has_method("is_embedded_in_editor") and Engine.call("is_embedded_in_editor")
	var res: Dictionary = item("res")
	for r in RES:
		if r.x <= screen_size.x and r.y <= screen_size.y:
			res["opts"].append("%d × %d" % [r.x, r.y])
			res["vals"].append(r)
	if res["vals"].is_empty():
		res["opts"].append("%d × %d" % [screen_size.x, screen_size.y])
		res["vals"].append(screen_size)
	# defaults: the largest window that still leaves room for the task bar; a display that
	# reports a low refresh rate (remote desktop, virtual displays) must not drive v-sync
	var best := 0
	for i in res["vals"].size():
		var r: Vector2i = res["vals"][i]
		if r.x <= screen_size.x - 60 and r.y <= screen_size.y - 100 and r.x <= 1920:
			best = i
	var slow := screen_hz < 50.0
	v = {"mode": 0, "res": best, "scale": 4, "quality": 2, "vsync": 0 if slow else 1, "fps": 3 if slow else 6, "fov": 2, "cam": 1, "sens": 3, "pad": 3, "pad_inv": 0, "rumble": 1, "vol": 10}


func item(id: String) -> Dictionary:
	for it in items:
		if it["id"] == id:
			return it
	return {}


func val(id: String):
	var it := item(id)
	return it["vals"][clampi(int(v.get(id, 0)), 0, it["vals"].size() - 1)]


func label(id: String) -> String:
	var it := item(id)
	return str(it["opts"][clampi(int(v.get(id, 0)), 0, it["opts"].size() - 1)])


func cycle(id: String, step: int) -> void:
	var n: int = item(id)["opts"].size()
	v[id] = clampi(int(v.get(id, 0)) + step, 0, n - 1)


func load_file() -> void:
	if not FileAccess.file_exists(PATH):
		return
	var data = JSON.parse_string(FileAccess.get_file_as_string(PATH))
	if not (data is Dictionary):
		return
	for it in items:
		var id: String = it["id"]
		if not data.has(id):
			continue
		if id == "res":
			# stored as "WxH" so it survives a change of monitor
			var i: int = it["opts"].find(str(data[id]))
			if i >= 0:
				v[id] = i
		else:
			v[id] = clampi(int(data[id]), 0, it["opts"].size() - 1)


func save_file() -> void:
	var out := {}
	for it in items:
		var id: String = it["id"]
		out[id] = label(id) if id == "res" else int(v[id])
	var f := FileAccess.open(PATH, FileAccess.WRITE)
	if f != null:
		f.store_string(JSON.stringify(out))


# window = false leaves the window, v-sync and frame cap alone (autotest runs)
func apply(game, window: bool = true) -> void:
	var win: Window = game.get_window()
	if window and not embedded:
		var mode: int = val("mode")
		if mode == 0:
			if win.mode != Window.MODE_WINDOWED:
				win.mode = Window.MODE_WINDOWED
			var r: Vector2i = val("res")
			if win.size != r:
				win.size = r
				var org := DisplayServer.screen_get_position(win.current_screen)
				var free := DisplayServer.screen_get_size(win.current_screen) - r
				win.position = org + Vector2i(maxi(free.x / 2, 0), maxi(free.y / 2, 0))
		else:
			var want := Window.MODE_FULLSCREEN if mode == 1 else Window.MODE_EXCLUSIVE_FULLSCREEN
			if win.mode != want:
				win.mode = want
	if window:
		DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_ENABLED if int(val("vsync")) == 1 else DisplayServer.VSYNC_DISABLED)
		Engine.max_fps = int(val("fps"))
	var vp: Viewport = game.get_viewport()
	var sc: float = val("scale")
	vp.scaling_3d_mode = Viewport.SCALING_3D_MODE_BILINEAR if sc >= 0.999 else Viewport.SCALING_3D_MODE_FSR
	vp.scaling_3d_scale = sc
	var q: int = val("quality")
	vp.msaa_3d = Viewport.MSAA_2X if q >= 2 else Viewport.MSAA_DISABLED
	vp.screen_space_aa = Viewport.SCREEN_SPACE_AA_FXAA
	RenderingServer.directional_shadow_atlas_set_size(2048 if q == 0 else 4096, true)
	game.apply_quality(q)
	game.sens_mul = val("sens")
	game.pad_sens = val("pad")
	game.pad_inv = int(val("pad_inv")) == 1
	game.pad_rumble = int(val("rumble")) == 1
	game.fov_base = val("fov")
	game.cam_dist = val("cam")
	if game.pc != null:
		game.pc.sens = 0.0021 * game.sens_mul
		game.pc.fov_base = game.fov_base
		game.pc.cam_dist = game.cam_dist
		game.pc.cam_up = 3.0 + game.cam_dist * 0.13
	var vol: float = val("vol")
	AudioServer.set_bus_volume_db(0, -80.0 if vol <= 0.001 else linear_to_db(vol) - 5.0)
