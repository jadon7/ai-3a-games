extends RefCounted
# Procedural textures, shared materials and fonts.

static var armor: ShaderMaterial
static var plating: ShaderMaterial
static var concrete: ShaderMaterial
static var facade: ShaderMaterial
static var corrugated: ShaderMaterial
static var terrain: ShaderMaterial
static var rock: ShaderMaterial
static var cloud_noise: Texture2D
static var grunge: Texture2D
static var puff: Texture2D
static var glow: Texture2D
static var scorch: Texture2D
static var font: Font
static var _glow_mats := {}
static var sets := {}
static var detail_on := true


static func init() -> void:
	if armor != null:
		return
	grunge = _grunge()
	for id in ["green_metal_rust", "metal_plate_02", "rusty_metal_sheet", "concrete_wall_004", "damaged_concrete_floor", "gravelly_sand", "dry_ground_rocks", "dry_ground_01", "cliff_side", "sandstone_cracks"]:
		sets[id] = _load_set(id)
	var sh: Shader = load("res://shaders/armor.gdshader")
	# armor: for modelled parts (frames, vehicles, weapons). No projected seam grid: panel
	# lines come from the geometry, wear from the baked edge mask, so nothing cuts across a plate.
	# plating: the same paint with a seam / rivet grid, for huge flat hulls only.
	armor = _mk(sh, _panels(1, 3), {"tile": 9.0, "chip_lo": 0.66, "chip_hi": 0.8})
	_detail(armor, "green_metal_rust", "green_metal_rust", 5.0, {"rust_amt": 0.4, "det_bump": 1.1, "dust_amt": 0.5})
	plating = _mk(sh, _panels(1, 0), {"tile": 7.0, "chip_lo": 0.6, "chip_hi": 0.72})
	_detail(plating, "green_metal_rust", "metal_plate_02", 5.0, {"rust_amt": 0.45, "det_bump": 1.1})
	concrete = _mk(sh, _panels(2, 1), {
		"tile": 18.0, "bare_color": Color(0.36, 0.34, 0.31), "rough_base": 0.95, "seam_dark": 0.55,
		"bump": 0.7, "world_space": true, "chip_lo": 0.62, "chip_hi": 0.8})
	_detail(concrete, "concrete_wall_004", "damaged_concrete_floor", 11.0, {"rust_amt": 0.0, "edge_wear": 0.0, "det_bump": 1.4})
	facade = _mk(sh, _panels(3, 2), {
		"tile": 16.0, "bare_color": Color(0.3, 0.27, 0.24), "rough_base": 0.95, "seam_dark": 0.5,
		"bump": 0.8, "world_space": true, "chip_lo": 0.6, "chip_hi": 0.8})
	_detail(facade, "concrete_wall_004", "damaged_concrete_floor", 13.0, {"rust_amt": 0.0, "edge_wear": 0.0, "det_bump": 1.2})
	corrugated = _mk(sh, _panels(4, 0), {
		"tile": 11.0, "bare_color": Color(0.3, 0.14, 0.07), "rough_base": 0.7, "seam_dark": 0.6,
		"corr": 1.0, "world_space": true, "chip_lo": 0.4, "chip_hi": 0.58})
	_detail(corrugated, "rusty_metal_sheet", "metal_plate_02", 9.0, {"rust_amt": 1.0, "edge_wear": 0.0})
	terrain = ShaderMaterial.new()
	terrain.shader = load("res://shaders/terrain.gdshader")
	terrain.set_shader_parameter("grunge", grunge)
	var ground_ok := true
	for pr in [["sand", "gravelly_sand"], ["rock", "dry_ground_rocks"], ["crack", "dry_ground_01"], ["pad", "damaged_concrete_floor"], ["cliff", "cliff_side"]]:
		var gs: Dictionary = sets[pr[1]]
		if gs.is_empty():
			ground_ok = false
			continue
		terrain.set_shader_parameter(pr[0] + "_alb", gs["alb"])
		terrain.set_shader_parameter(pr[0] + "_nr", gs["nr"])
		terrain.set_shader_parameter(pr[0] + "_avg", gs["avg"])
	terrain.set_meta("det", 1.0 if ground_ok else 0.0)
	terrain.set_shader_parameter("det_amt", 1.0 if ground_ok else 0.0)
	var nt := NoiseTexture2D.new()
	nt.width = 512
	nt.height = 512
	nt.seamless = true
	nt.as_normal_map = true
	nt.bump_strength = 10.0
	var nn := FastNoiseLite.new()
	nn.frequency = 0.035
	nn.fractal_octaves = 5
	nt.noise = nn
	terrain.set_shader_parameter("nmap", nt)
	# layered sandstone for mesas and outcrops
	rock = ShaderMaterial.new()
	rock.shader = load("res://shaders/rock.gdshader")
	var rw: Dictionary = sets["cliff_side"]
	var rt: Dictionary = sets["sandstone_cracks"]
	if rw.is_empty() or rt.is_empty():
		rock.set_meta("det", 0.0)
		rock.set_shader_parameter("det_amt", 0.0)
	else:
		rock.set_shader_parameter("wall_alb", rw["alb"])
		rock.set_shader_parameter("wall_nr", rw["nr"])
		rock.set_shader_parameter("wall_avg", rw["avg"])
		rock.set_shader_parameter("top_alb", rt["alb"])
		rock.set_shader_parameter("top_nr", rt["nr"])
		rock.set_shader_parameter("top_avg", rt["avg"])
		rock.set_meta("det", 1.0)
	var cn := FastNoiseLite.new()
	cn.seed = 5
	cn.frequency = 0.007
	cn.fractal_octaves = 5
	var cimg := cn.get_seamless_image(512, 512)
	cimg.generate_mipmaps()
	cloud_noise = ImageTexture.create_from_image(cimg)
	puff = _puff()
	glow = _radial([Color(1, 1, 1, 1), Color(1, 1, 1, 0.6), Color(1, 1, 1, 0.12), Color(1, 1, 1, 0)], [0.0, 0.25, 0.6, 1.0])
	scorch = _radial([Color(0.02, 0.018, 0.015, 0.95), Color(0.03, 0.027, 0.022, 0.7), Color(0.05, 0.04, 0.03, 0)], [0.0, 0.5, 1.0])
	var f := SystemFont.new()
	f.font_names = PackedStringArray(["Bahnschrift", "Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", "Arial"])
	f.allow_system_fallback = true
	f.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
	font = f


# One photographed PBR set from res://textures (see textures/CREDITS.md): albedo, packed
# normal XY + roughness, and the average albedo used to normalise it in the shaders.
# The files are read directly so the game does not depend on the editor having imported them.
static func _load_set(id: String) -> Dictionary:
	var base := ProjectSettings.globalize_path("res://textures/")
	if not FileAccess.file_exists(base + id + "_alb.jpg") or not FileAccess.file_exists(base + id + "_nr.jpg"):
		return {}
	var ia := Image.load_from_file(base + id + "_alb.jpg")
	var inr := Image.load_from_file(base + id + "_nr.jpg")
	if ia == null or inr == null:
		return {}
	var sum := Vector3.ZERO
	var n := 0
	for y in range(8, ia.get_height(), 32):
		for x in range(8, ia.get_width(), 32):
			var c := ia.get_pixel(x, y).srgb_to_linear()
			sum += Vector3(c.r, c.g, c.b)
			n += 1
	sum /= float(maxi(n, 1))
	ia.generate_mipmaps()
	inr.generate_mipmaps()
	return {"alb": ImageTexture.create_from_image(ia), "nr": ImageTexture.create_from_image(inr), "avg": Vector3(maxf(sum.x, 0.01), maxf(sum.y, 0.01), maxf(sum.z, 0.01))}


static func _detail(m: ShaderMaterial, det: String, bare: String, tile: float, params: Dictionary = {}) -> void:
	var d: Dictionary = sets.get(det, {})
	var b: Dictionary = sets.get(bare, {})
	if d.is_empty() or b.is_empty():
		m.set_meta("det", 0.0)
		return
	m.set_shader_parameter("det_alb", d["alb"])
	m.set_shader_parameter("det_nr", d["nr"])
	m.set_shader_parameter("det_avg", d["avg"])
	m.set_shader_parameter("bare_alb", b["alb"])
	m.set_shader_parameter("bare_nr", b["nr"])
	m.set_shader_parameter("bare_avg", b["avg"])
	m.set_shader_parameter("det_tile", tile)
	m.set_shader_parameter("det_amt", 1.0)
	m.set_meta("det", 1.0)
	for k in params:
		m.set_shader_parameter(k, params[k])


# graphics option: photographed detail layers on / off (off = procedural only, far fewer samples)
static func set_detail(on: bool) -> void:
	detail_on = on
	for m in [armor, plating, concrete, facade, corrugated, terrain, rock]:
		if m != null:
			m.set_shader_parameter("det_amt", float(m.get_meta("det", 0.0)) if on else 0.0)


static func _mk(sh: Shader, pan: Texture2D, params: Dictionary) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = sh
	m.set_shader_parameter("panels", pan)
	m.set_shader_parameter("grunge", grunge)
	for k in params:
		m.set_shader_parameter(k, params[k])
	return m


static func glow_mat(c: Color, energy: float) -> StandardMaterial3D:
	var key := "%s_%.1f" % [c.to_html(), energy]
	if _glow_mats.has(key):
		return _glow_mats[key]
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = Color(c.r * energy, c.g * energy, c.b * energy)
	_glow_mats[key] = m
	return m


static func _noise_bytes(size: int, seed_v: int, freq: float, oct: int) -> PackedByteArray:
	var n := FastNoiseLite.new()
	n.seed = seed_v
	n.frequency = freq
	n.fractal_octaves = oct
	var img := n.get_seamless_image(size, size)
	img.convert(Image.FORMAT_L8)
	return img.get_data()


static func _grunge() -> ImageTexture:
	var s := 256
	var a := _noise_bytes(s, 11, 0.014, 4)
	var b := _noise_bytes(s, 23, 0.035, 4)
	var c := _noise_bytes(s, 37, 0.09, 3)
	var data := PackedByteArray()
	data.resize(s * s * 3)
	for i in s * s:
		data[i * 3] = a[i]
		data[i * 3 + 1] = b[i]
		data[i * 3 + 2] = c[i]
	var img := Image.create_from_data(s, s, false, Image.FORMAT_RGB8, data)
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


# mode 0: armour plating with seams and rivets, 1: cast concrete, 2: building facade with
# windows, 3: plain painted plate (no seams at all, only chip / grime noise)
static func _panels(seed_v: int, mode: int) -> ImageTexture:
	var s := 512
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_v * 977
	var n_hi := _noise_bytes(s, seed_v * 7 + 1, 0.1, 3)
	var n_lo := _noise_bytes(s, seed_v * 7 + 2, 0.014, 4)
	var n_col := _noise_bytes(s, seed_v * 7 + 3, 0.08, 2)
	var n_mid := _noise_bytes(s, seed_v * 7 + 4, 0.035, 3)
	var hs: Array[int] = []
	var vs: Array[int] = []
	if mode == 0:
		hs = [58, 190, 322, 446]
		vs = [84, 250, 404]
	elif mode == 1:
		hs = [0, 128, 256, 384]
	elif mode == 2:
		hs = [118, 246, 374, 502]
	var dh := PackedFloat32Array()
	dh.resize(s)
	var db := PackedFloat32Array()
	db.resize(s)
	var dv := PackedFloat32Array()
	dv.resize(s)
	for y in s:
		var best := 9999.0
		var below := 9999.0
		for h in hs:
			var d := absf(float(y - h))
			best = minf(best, minf(d, s - d))
			below = minf(below, float(posmod(y - h, s)))
		dh[y] = best
		db[y] = below
	for x in s:
		var best := 9999.0
		for v in vs:
			var d := absf(float(x - v))
			best = minf(best, minf(d, s - d))
		dv[x] = best
	var crack := PackedByteArray()
	crack.resize(s * s)
	if mode == 1 or mode == 2:
		for k in 12:
			var cx := rng.randf() * s
			var cy := rng.randf() * s
			var ang := rng.randf() * TAU
			for st in 220:
				ang += (rng.randf() - 0.5) * 0.5
				cx += cos(ang)
				cy += sin(ang)
				var px := posmod(int(cx), s)
				var py := posmod(int(cy), s)
				crack[py * s + px] = 200
				crack[py * s + posmod(px + 1, s)] = 120
	var data := PackedByteArray()
	data.resize(s * s * 4)
	var i := 0
	for y in s:
		var dhy: float = dh[y]
		var dby: float = db[y]
		for x in s:
			var idx := y * s + x
			var dvx: float = dv[x]
			var d := minf(dhy, dvx)
			var hi := n_hi[idx] / 255.0
			var lo := n_lo[idx] / 255.0
			var seam := clampf(2.6 - d, 0.0, 1.0)
			if mode == 0:
				if (dhy > 8.0 and dhy < 11.0 and x % 38 < 3) or (dvx > 8.0 and dvx < 11.0 and y % 38 < 3):
					seam = maxf(seam, 0.75)
			seam = maxf(seam, crack[idx] / 255.0)
			var chips := clampf(n_mid[idx] / 255.0 * 0.8 + exp(-d / 5.0) * 0.4 + hi * 0.12 - 0.1, 0.0, 1.0)
			var col := n_col[x] / 255.0
			var streak := exp(-dby / 55.0) * smoothstep(0.45, 0.75, col)
			var grime := clampf(streak * 0.9 + maxf(lo - 0.55, 0.0) * 1.2, 0.0, 1.0)
			var hole := 0.0
			if mode == 2:
				var gx := x % 128
				var gy := y % 128
				if gx > 30 and gx < 98 and gy > 26 and gy < 104:
					hole = 1.0
				elif gx > 22 and gx < 106 and gy <= 26:
					grime = maxf(grime, (1.0 - gy / 26.0) * 0.2 + float(gy) / 26.0 * 0.75 * lo)
			data[i] = int(seam * 255.0)
			data[i + 1] = int(chips * 255.0)
			data[i + 2] = int(grime * 255.0)
			data[i + 3] = int(hole * 255.0)
			i += 4
	var img := Image.create_from_data(s, s, false, Image.FORMAT_RGBA8, data)
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


static func _puff() -> ImageTexture:
	var s := 128
	var nz := _noise_bytes(s, 91, 0.035, 4)
	var data := PackedByteArray()
	data.resize(s * s * 4)
	var i := 0
	for y in s:
		for x in s:
			var dx := (x - 64) / 64.0
			var dy := (y - 64) / 64.0
			var n := nz[y * s + x] / 255.0
			var a := clampf(1.0 - sqrt(dx * dx + dy * dy), 0.0, 1.0)
			a = a * a * (3.0 - 2.0 * a) * clampf(0.3 + n * 1.3, 0.0, 1.0)
			var v := int(190.0 + n * 65.0)
			data[i] = v
			data[i + 1] = v
			data[i + 2] = v
			data[i + 3] = int(a * 255.0)
			i += 4
	var img := Image.create_from_data(s, s, false, Image.FORMAT_RGBA8, data)
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


static func _radial(cols: Array, offs: Array) -> GradientTexture2D:
	var g := Gradient.new()
	g.colors = PackedColorArray(cols)
	g.offsets = PackedFloat32Array(offs)
	var t := GradientTexture2D.new()
	t.gradient = g
	t.width = 128
	t.height = 128
	t.fill = GradientTexture2D.FILL_RADIAL
	t.fill_from = Vector2(0.5, 0.5)
	t.fill_to = Vector2(1.0, 0.5)
	return t
