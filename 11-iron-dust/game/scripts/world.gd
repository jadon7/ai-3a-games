extends Node3D
# Battlefields: terrain, sky, lighting, static structures, colliders.
# Maps: "refinery" (desert refinery base) and "gunline" (anti-orbit gun line at dusk).

const MeshKit = preload("res://scripts/mesh_kit.gd")
const Tex = preload("res://scripts/tex.gd")
const Glb = preload("res://scripts/glb_kit.gd")
const FX = preload("res://scripts/fx.gd")
const Buildings = preload("res://scripts/buildings.gd")

# gun-line map: the assembly hall behind the left flank (centre, size)
const HALL_POS := Vector2(-600.0, 640.0)
const HALL_SIZE := Vector3(210.0, 84.0, 116.0)
# megastructure plots in the ruined town: x, z, width, depth, height
const MEGA_PLOTS := [[640.0, -830.0, 120.0, 90.0, 250.0], [-880.0, -520.0, 100.0, 80.0, 190.0], [800.0, -540.0, 84.0, 110.0, 160.0], [-300.0, -985.0, 130.0, 80.0, 215.0]]

const BASE := Vector2(0, -60)
const BATTERY_POS := [Vector2(-70, 70), Vector2(112, -18), Vector2(-30, -212)]

var map_id := "refinery"
var bound := 700.0
# zero-g maps are not square: the playable box of the space map (the lane runs far along -Z)
var space_min := Vector3(-1500.0, -460.0, -1500.0)
var space_max := Vector3(1500.0, 460.0, 1500.0)
var radar := 380.0
var size := 2000.0
var cells := 200
var points := {}
var pads: Array = []
var craters: Array = []
var streaks: Array = []
var lamps: Array = []
var far_ships: Array = []
var flak_lines: Array = []
var _n3 := FastNoiseLite.new()
var _rock_st: SurfaceTool
var _rock_faces := PackedVector3Array()
var _rock_n := 0
var _line_t := 2.0
var _sky_t := 0.0
var _flak_t := 0.0
var dusk := false
var space := false
var space_env = null
var cols: Array = []
var emitters: Array = []
var sun: DirectionalLight3D
var env: Environment
var we: WorldEnvironment
var body: StaticBody3D
# box / cylinder colliders are spread over many static bodies: the physics engine refuses
# a single body with hundreds of shapes ("compound hierarchy is too deep")
var bodies: Array = []
var _cb: StaticBody3D
var _cb_n := 0
var motes: GPUParticles3D
var sun_dir := Vector3(-0.5, 0.45, 0.74).normalized()
var _n1 := FastNoiseLite.new()
var _n2 := FastNoiseLite.new()
var _wind_t := 0.0
var _rng := RandomNumberGenerator.new()


func height(x: float, z: float) -> float:
	if space:
		return -9999.0
	if map_id == "gunline":
		return _h_gunline(x, z)
	var h := _n1.get_noise_2d(x, z) * 40.0 + _n2.get_noise_2d(x, z) * 3.5 + 3.0
	var dist := Vector2(x - BASE.x, z - BASE.y).length()
	# canyon country: outside the base the dunes break into rock terraces, except along
	# the southern approach, which stays an open sand road
	var rocky := smoothstep(390.0, 520.0, dist) * smoothstep(-0.25, 0.15, _n3.get_noise_2d(x, z))
	if z > 60.0:
		rocky *= smoothstep(70.0, 150.0, absf(x))
	h = _terrace(h, 11.0, rocky)
	h = lerpf(h, 0.0, smoothstep(480.0, 335.0, dist))
	var e := smoothstep(650.0, 880.0, maxf(absf(x), absf(z)))
	return h + e * e * 140.0


# pulls a height toward flat treads and steep risers of the given step
func _terrace(h: float, step: float, amt: float) -> float:
	if amt <= 0.001:
		return h
	var t := h / step
	var f := floorf(t)
	var e := smoothstep(0.0, 1.0, clampf((t - f - 0.5) * 3.4 + 0.5, 0.0, 1.0))
	return lerpf(h, (f + e) * step, amt)


func _h_gunline(x: float, z: float) -> float:
	var plain := smoothstep(1050.0, 560.0, absf(x)) * smoothstep(-1120.0, -760.0, z) * smoothstep(800.0, 460.0, z)
	var h := (_n1.get_noise_2d(x, z) * 34.0 + _n2.get_noise_2d(x, z) * 2.6) * lerpf(1.0, 0.26, plain) + 4.0
	h = _terrace(h, 9.0, (1.0 - plain) * smoothstep(-0.3, 0.1, _n3.get_noise_2d(x, z)))
	var rz := z + 250.0 + sin(x * 0.006) * 60.0
	h -= 10.0 * smoothstep(64.0, 16.0, absf(rz)) * plain
	for c in craters:
		var dx: float = x - float(c[0])
		var dz: float = z - float(c[1])
		var r: float = c[2]
		var d2 := dx * dx + dz * dz
		if d2 < r * r * 1.7:
			var q := sqrt(d2) / r
			h += float(c[3]) * (smoothstep(1.3, 1.0, q) * 0.22 - (1.0 - minf(q, 1.0) * minf(q, 1.0)))
	for pd in pads:
		var dist := Vector2(x - float(pd[0]), z - float(pd[1])).length()
		var r: float = pd[2]
		if dist < r + 70.0:
			h = lerpf(h, float(pd[3]), smoothstep(r + 70.0, r, dist))
	var e := smoothstep(bound - 60.0, bound + 260.0, maxf(absf(x), absf(z)))
	return h + e * e * 170.0


func setup(id: String = "refinery") -> void:
	map_id = id
	dusk = id == "gunline"
	if id == "belt":
		_build_space()
		return
	if id == "gunline":
		bound = 1150.0
		radar = 520.0
		size = 3200.0
		cells = 330
		points = {
			"cannons": [Vector2(-400, 100), Vector2(0, 40), Vector2(400, 100)],
			"aa": [Vector2(-215, -30), Vector2(215, -30), Vector2(-610, 70), Vector2(610, 70), Vector2(-150, 270), Vector2(150, 270)],
			"lz": [Vector2(-330, -500), Vector2(40, -600), Vector2(360, -480), Vector2(-120, -380), Vector2(180, -360)],
			"spawn": Vector2(0, 190), "carrier": Vector3(0, 340, -820),
		}
		for cp in points["cannons"]:
			pads.append([cp.x, cp.y, 74.0, 6.0])
		pads.append([0.0, 390.0, 240.0, 5.0])
		var hp := Buildings.hall_pad(HALL_SIZE.x, HALL_SIZE.z, HALL_SIZE.y)
		pads.append([HALL_POS.x - hp.get_center().x, HALL_POS.y - hp.get_center().y, hp.size.length() * 0.5 + 10.0, 7.0])
		var cr := RandomNumberGenerator.new()
		cr.seed = 77
		for i in 22:
			var cx := cr.randf_range(-900.0, 900.0)
			var cz := cr.randf_range(-700.0, -90.0)
			craters.append([cx, cz, cr.randf_range(14.0, 34.0), cr.randf_range(2.5, 6.5)])
	else:
		points = {"battery": BATTERY_POS, "spawn": Vector2(0, 560)}
	_rng.seed = 2024
	_n1.seed = 7 if id == "refinery" else 31
	_n1.frequency = 0.0028
	_n1.fractal_octaves = 4
	_n2.seed = 19
	_n2.frequency = 0.02
	_n2.fractal_octaves = 3
	_n3.seed = 53
	_n3.frequency = 0.0045
	_n3.fractal_octaves = 2
	if id != "gunline":
		cells = 300
	_build_env()
	body = StaticBody3D.new()
	body.collision_layer = 1
	body.collision_mask = 0
	add_child(body)
	_build_terrain()
	if id == "gunline":
		_build_gunline()
		_build_sky_fx()
	else:
		_build_base()
	_build_rocks()
	_build_motes()


func _build_env() -> void:
	# clear desert day: deep blue zenith, pale horizon, lit cumulus
	var sky_mat := ShaderMaterial.new()
	sky_mat.shader = load("res://shaders/sky.gdshader")
	sky_mat.set_shader_parameter("noise_tex", Tex.cloud_noise)
	var sky := Sky.new()
	sky.sky_material = sky_mat
	env = Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 1.0
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = 1.0
	env.tonemap_white = 6.0
	env.ssao_enabled = true
	env.ssao_radius = 2.5
	env.ssao_intensity = 2.2
	env.glow_enabled = true
	env.glow_intensity = 0.5
	env.glow_strength = 1.0
	env.glow_bloom = 0.04
	env.glow_hdr_threshold = 1.1
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE
	env.fog_enabled = true
	env.fog_light_color = Color(0.74, 0.72, 0.68)
	env.fog_light_energy = 1.0
	env.fog_sun_scatter = 0.25
	env.fog_density = 0.00055
	env.fog_aerial_perspective = 0.6
	env.fog_sky_affect = 0.15
	env.volumetric_fog_enabled = true
	env.volumetric_fog_density = 0.0008
	env.volumetric_fog_albedo = Color(0.9, 0.84, 0.74)
	env.volumetric_fog_anisotropy = 0.55
	env.volumetric_fog_length = 260.0
	env.volumetric_fog_ambient_inject = 0.4
	env.volumetric_fog_sky_affect = 0.0
	env.adjustment_enabled = true
	env.adjustment_saturation = 1.06
	env.adjustment_contrast = 1.06
	sun_dir = Vector3(-0.46, 0.6, 0.65).normalized()
	Tex.terrain.set_shader_parameter("sand_col", Color(0.6, 0.44, 0.25))
	Tex.terrain.set_shader_parameter("gravel_col", Color(0.4, 0.3, 0.2))
	Tex.terrain.set_shader_parameter("rock_col", Color(0.56, 0.36, 0.2))
	Tex.rock.set_shader_parameter("rock_color", Color(0.56, 0.36, 0.2))
	Tex.rock.set_shader_parameter("sand_color", Color(0.6, 0.44, 0.25))
	if dusk:
		# golden hour: warm low sun, violet zenith, clouds lit from below
		sky_mat.set_shader_parameter("top_color", Color(0.1, 0.13, 0.3))
		sky_mat.set_shader_parameter("horizon_color", Color(0.95, 0.56, 0.3))
		sky_mat.set_shader_parameter("ground_color", Color(0.2, 0.14, 0.1))
		sky_mat.set_shader_parameter("sun_color", Color(1.0, 0.7, 0.42))
		sky_mat.set_shader_parameter("cloud_color", Color(1.0, 0.62, 0.42))
		sky_mat.set_shader_parameter("cloud_shade", Color(0.3, 0.2, 0.32))
		sky_mat.set_shader_parameter("cloud_cover", 0.5)
		sky_mat.set_shader_parameter("sun_glow", 0.6)
		Tex.terrain.set_shader_parameter("sand_col", Color(0.5, 0.36, 0.22))
		Tex.terrain.set_shader_parameter("gravel_col", Color(0.28, 0.22, 0.17))
		Tex.terrain.set_shader_parameter("rock_col", Color(0.46, 0.28, 0.17))
		Tex.rock.set_shader_parameter("rock_color", Color(0.46, 0.28, 0.17))
		Tex.rock.set_shader_parameter("sand_color", Color(0.5, 0.36, 0.22))
		env.ambient_light_energy = 2.3
		env.fog_light_color = Color(0.42, 0.3, 0.25)
		env.fog_density = 0.00055
		env.fog_sun_scatter = 0.25
		env.fog_sky_affect = 0.3
		env.volumetric_fog_density = 0.0011
		env.volumetric_fog_albedo = Color(0.7, 0.55, 0.46)
		env.volumetric_fog_anisotropy = 0.3
		env.volumetric_fog_length = 320.0
		env.glow_intensity = 0.65
		env.adjustment_saturation = 0.9
		sun_dir = Vector3(-0.84, 0.24, 0.3).normalized()
	we = WorldEnvironment.new()
	we.environment = env
	add_child(we)
	sun = DirectionalLight3D.new()
	sun.light_color = Color(1.0, 0.72, 0.5) if dusk else Color(1.0, 0.95, 0.86)
	sun.light_energy = 2.2 if dusk else 3.0
	sun.shadow_enabled = true
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	sun.directional_shadow_max_distance = 640.0 if dusk else 520.0
	sun.directional_shadow_blend_splits = true
	sun.light_angular_distance = 0.8
	sun.shadow_bias = 0.06
	sun.shadow_normal_bias = 1.6
	add_child(sun)
	sun.basis = Basis.looking_at(-sun_dir, Vector3.UP)


func _build_terrain() -> void:
	var n := cells
	var sz := size
	var step := sz / n
	var w := n + 1
	var hgt := PackedFloat32Array()
	hgt.resize(w * w)
	for j in w:
		for i in w:
			hgt[j * w + i] = height(-sz * 0.5 + i * step, -sz * 0.5 + j * step)
	var verts := PackedVector3Array()
	var norms := PackedVector3Array()
	var cols_a := PackedColorArray()
	var tang := PackedFloat32Array()
	verts.resize(w * w)
	norms.resize(w * w)
	cols_a.resize(w * w)
	tang.resize(w * w * 4)
	var gn := FastNoiseLite.new()
	gn.frequency = 0.012
	for j in w:
		for i in w:
			var idx := j * w + i
			var x := -sz * 0.5 + i * step
			var z := -sz * 0.5 + j * step
			var h: float = hgt[idx]
			verts[idx] = Vector3(x, h, z)
			var hl: float = hgt[j * w + maxi(i - 1, 0)]
			var hr: float = hgt[j * w + mini(i + 1, n)]
			var hd: float = hgt[maxi(j - 1, 0) * w + i]
			var hu: float = hgt[mini(j + 1, n) * w + i]
			norms[idx] = Vector3(hl - hr, 2.0 * step, hd - hu).normalized()
			var dist := Vector2(x - BASE.x, z - BASE.y).length()
			var pad := smoothstep(345.0, 300.0, dist)
			var road := smoothstep(28.0, 10.0, absf(x)) * (1.0 if z > -300.0 else 0.0) * 0.55
			if map_id == "gunline":
				pad = 0.0
				for pd in pads:
					pad = maxf(pad, smoothstep(float(pd[2]) + 14.0, float(pd[2]) - 10.0, Vector2(x - float(pd[0]), z - float(pd[1])).length()))
				road = smoothstep(26.0, 9.0, absf(x)) * (1.0 if z < 200.0 else 0.0) * 0.5
				road = maxf(road, smoothstep(22.0, 8.0, absf(z - 150.0)) * smoothstep(700.0, 640.0, absf(x)) * 0.5)
			var br := 0.9 + gn.get_noise_2d(x, z) * 0.25 + clampf(h, -10.0, 20.0) * 0.006
			cols_a[idx] = Color(maxf(pad, road), br, 0.0)
			tang[idx * 4] = 1.0
			tang[idx * 4 + 1] = 0.0
			tang[idx * 4 + 2] = 0.0
			tang[idx * 4 + 3] = 1.0
	var ind := PackedInt32Array()
	var faces := PackedVector3Array()
	for j in n:
		for i in n:
			var a := j * w + i
			var b := a + 1
			var c := a + w
			var d := c + 1
			for q in [a, b, c, b, d, c]:
				ind.append(q)
				faces.append(verts[q])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_NORMAL] = norms
	arr[Mesh.ARRAY_COLOR] = cols_a
	arr[Mesh.ARRAY_TANGENT] = tang
	arr[Mesh.ARRAY_INDEX] = ind
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = Tex.terrain
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	var shape := ConcavePolygonShape3D.new()
	shape.set_faces(faces)
	shape.backface_collision = true
	var cs := CollisionShape3D.new()
	cs.shape = shape
	body.add_child(cs)


func _cbody() -> StaticBody3D:
	if _cb == null or _cb_n >= 28:
		_cb = StaticBody3D.new()
		_cb.collision_layer = 1
		_cb.collision_mask = 0
		add_child(_cb)
		bodies.append(_cb)
		_cb_n = 0
	_cb_n += 1
	return _cb


func _add_box(x: float, z: float, w: float, d: float, y0: float, y1: float, list: bool = true) -> void:
	var s := BoxShape3D.new()
	s.size = Vector3(w, y1 - y0, d)
	var cs := CollisionShape3D.new()
	cs.shape = s
	cs.position = Vector3(x, (y0 + y1) * 0.5, z)
	_cbody().add_child(cs)
	if list:
		cols.append({"x": x, "z": z, "w": w, "d": d, "h": y1})


func _add_cyl(x: float, z: float, r: float, y0: float, y1: float) -> void:
	var s := CylinderShape3D.new()
	s.radius = r
	s.height = y1 - y0
	var cs := CollisionShape3D.new()
	cs.shape = s
	cs.position = Vector3(x, (y0 + y1) * 0.5, z)
	_cbody().add_child(cs)
	cols.append({"x": x, "z": z, "r": r, "h": y1})


func _build_base() -> void:
	var k := MeshKit.new(77)
	k.dust = 0.5
	k.dust_top = 7.0
	k.jitter = 0.16
	var hz := PI * 0.5
	var r := _rng

	# hangars (doors face +X)
	var hi := 0
	for hzp in [-205.0, -112.0, -19.0]:
		var g := k.bone(self)
		var x := -168.0
		var z: float = hzp
		var y := height(x, z)
		var w := 56.0
		var d := 62.0
		var h := 24.0
		k.box(g, "CON", Vector3(w + 4, 2, d + 4), Vector3(x, y + 0.6, z))
		k.box(g, "COR", Vector3(w, h, d), Vector3(x, y + h * 0.5 + 1, z))
		k.box(g, "COR", Vector3(w + 3, 8, d + 2), Vector3(x, y + h + 5, z), Vector3.ZERO, {"tx": 0.06})
		k.box(g, "DRK", Vector3(1.2, h * 0.72, d * 0.56), Vector3(x + w * 0.5, y + h * 0.36 + 1.4, z))
		k.box(g, "CON", Vector3(2, h * 0.78, 3), Vector3(x + w * 0.5, y + h * 0.39 + 1, z - d * 0.3))
		k.box(g, "CON", Vector3(2, h * 0.78, 3), Vector3(x + w * 0.5, y + h * 0.39 + 1, z + d * 0.3))
		k.box(g, "HAZ", Vector3(2.2, 2.4, d * 0.66), Vector3(x + w * 0.5, y + h * 0.78 + 1.8, z))
		for i in [-1.0, 0.0, 1.0]:
			k.box(g, "STL", Vector3(1.2, h + 2, 1.6), Vector3(x - w * 0.5 - 0.5, y + h * 0.5 + 1, z + i * d * 0.4))
		_add_box(x, z, w + 2, d + 2, y - 5, y + h + 1.2)
		for st in [[0.78, 3.0], [0.53, 5.0], [0.28, 7.0]]:
			_add_box(x, z, (w + 3) * float(st[0]), d + 2, y + h, y + h + float(st[1]), false)
		hi += 1
		var lb := Label3D.new()
		lb.text = "H-0%d" % hi
		lb.font = Tex.font
		lb.font_size = 200
		lb.pixel_size = 0.04
		lb.modulate = Color(0.78, 0.75, 0.66, 0.85)
		lb.outline_size = 0
		lb.position = Vector3(x + w * 0.5 + 1.4, y + h * 0.9 + 3.6, z)
		lb.rotation.y = hz
		add_child(lb)

	# tank farm
	for i in 2:
		for j in 3:
			var g := k.bone(self)
			var x := 142.0 + i * 50.0
			var z := -212.0 + j * 52.0
			var rr := 17.0
			var h := 22.0 + ((i + j) % 2) * 4.0
			var y := height(x, z)
			k.cyl(g, "CON", rr + 1.5, rr + 2.0, 1.6, Vector3(x, y + 0.6, z), Vector3.ZERO, 20)
			k.cyl(g, "TNK", rr, rr, h, Vector3(x, y + h * 0.5 + 1, z), Vector3.ZERO, 24)
			k.cyl(g, "TNK", rr * 0.25, rr, 3.0, Vector3(x, y + h + 2.5, z), Vector3.ZERO, 24)
			for q in [0.3, 0.72]:
				k.cyl(g, "RST", rr + 0.25, rr + 0.25, 0.7, Vector3(x, y + h * q + 1, z), Vector3.ZERO, 24)
			k.box(g, "STL", Vector3(1.4, h + 2, 0.5), Vector3(x, y + h * 0.5 + 1, z + rr + 0.3))
			_add_cyl(x, z, rr + 0.5, y - 5, y + h + 3)
	# pipe rack
	var pg := k.bone(self)
	for q in 3:
		k.cyl(pg, "RST" if q == 1 else "STL", 1.3, 1.3, 170.0, Vector3(108 + q * 3.4, 8.5 + (q % 2) * 2.2, -150), Vector3(hz, 0, 0), 10)
	for zz in range(-230, -60, 32):
		k.box(pg, "STL", Vector3(13, 1, 1.4), Vector3(111.5, 6.6, zz))
		k.box(pg, "STL", Vector3(1.2, 7, 1.2), Vector3(106, 3.4, zz))
		k.box(pg, "STL", Vector3(1.2, 7, 1.2), Vector3(117, 3.4, zz))
		_add_box(111.5, zz, 12, 2, -5, 12)

	# command bunker + radar tower
	if true:
		var g := k.bone(self)
		var x := 0.0
		var z := -305.0
		var y := height(x, z)
		k.box(g, "CON", Vector3(80, 17, 42), Vector3(x, y + 8, z), Vector3.ZERO, {"tx": 0.9, "tz": 0.82})
		k.box(g, "CON", Vector3(46, 7, 24), Vector3(x - 8, y + 20, z), Vector3.ZERO, {"tx": 0.9, "tz": 0.85})
		k.box(g, "DRK", Vector3(50, 2.2, 1.2), Vector3(x, y + 11, z + 19.6))
		k.box(g, "DRK", Vector3(30, 1.6, 1.2), Vector3(x - 8, y + 21, z + 11.2))
		k.box(g, "STL", Vector3(14, 9, 1.5), Vector3(x + 22, y + 4.5, z + 20.6))
		k.box(g, "HAZ", Vector3(16, 1.6, 2), Vector3(x + 22, y + 9.6, z + 20.8))
		_add_box(x, z, 78, 40, y - 5, y + 17)
		var tg := k.bone(self)
		var tx := 66.0
		var tz := -272.0
		var ty := height(tx, tz)
		for o in [[-4, -4], [4, -4], [-4, 4], [4, 4]]:
			k.box(tg, "STL", Vector3(0.9, 52, 0.9), Vector3(tx + o[0], ty + 26, tz + o[1]))
		for hh in range(8, 52, 11):
			k.box(tg, "STL", Vector3(9, 0.6, 0.6), Vector3(tx, ty + hh, tz - 4))
			k.box(tg, "STL", Vector3(9, 0.6, 0.6), Vector3(tx, ty + hh, tz + 4))
			k.box(tg, "STL", Vector3(0.6, 0.6, 9), Vector3(tx - 4, ty + hh, tz))
			k.box(tg, "STL", Vector3(0.6, 0.6, 9), Vector3(tx + 4, ty + hh, tz))
		k.box(tg, "STL", Vector3(12, 1.2, 12), Vector3(tx, ty + 52.5, tz))
		k.cyl(tg, "TNK", 8.0, 2.0, 3.0, Vector3(tx, ty + 58, tz), Vector3(1.1, 0.6, 0), 16)
		k.box(tg, "RST", Vector3(0.4, 14, 0.4), Vector3(tx + 4, ty + 60, tz + 4))
		_add_box(tx, tz, 10, 10, ty - 5, ty + 53)

	# perimeter walls
	var wg := k.bone(self)
	for wl in [[-140, 150, 200, 4], [140, 150, 200, 4], [-240, -95, 4, 490], [240, -200, 4, 280], [240, 85, 4, 130], [-140, -340, 200, 4], [140, -340, 200, 4]]:
		var x: float = wl[0]
		var z: float = wl[1]
		var w: float = wl[2]
		var d: float = wl[3]
		var y := 0.0
		var h := 9.0
		var along_x := w > d
		k.box(wg, "CON", Vector3(w, h + 3, d), Vector3(x, y + h * 0.5 - 1.5, z), Vector3.ZERO, {"tx": 1.0 if along_x else 0.7, "tz": 0.7 if along_x else 1.0})
		k.box(wg, "HAZ", Vector3(w if along_x else 1.2, 0.8, 1.2 if along_x else d), Vector3(x, y + h + 0.2, z))
		_add_box(x, z, w, d, y - 5, y + h)
	for s in [-1.0, 1.0]:
		var x: float = s * 46.0
		var z := 150.0
		k.box(wg, "CON", Vector3(9, 24, 9), Vector3(x, 12, z), Vector3.ZERO, {"tx": 0.85, "tz": 0.85})
		k.box(wg, "STL", Vector3(11, 5, 11), Vector3(x, 26.5, z))
		k.box(wg, "HAZ", Vector3(11.4, 1.2, 11.4), Vector3(x, 24.2, z))
		k.box(wg, "RST", Vector3(12, 0.8, 12), Vector3(x, 29.6, z))
		_add_box(x, z, 10, 10, -5, 30)

	# containers
	var cmats := ["CN1", "CN2", "CN3", "COR"]
	var cg := k.bone(self)
	for cp in [[58, 84], [-112, 112], [64, -64], [-70, -150], [20, 30]]:
		var turned := r.randf() < 0.5
		for i in 3:
			var x: float = cp[0] + (i * 7.2 if turned else 0.0)
			var z: float = cp[1] + (0.0 if turned else i * 7.2)
			var cnt := 1 + r.randi() % 3
			var y := height(x, z)
			for q in cnt:
				k.box(cg, cmats[r.randi() % 4], Vector3(14, 5.6, 5.8), Vector3(x + r.randf_range(-0.4, 0.4), y + 2.8 + q * 5.7, z + r.randf_range(-0.4, 0.4)), Vector3(0, hz if turned else 0.0, 0))
			_add_box(x, z, 6.2 if turned else 14.4, 14.4 if turned else 6.2, y - 5, y + cnt * 5.7)

	# gantry crane
	if true:
		var g := k.bone(self)
		var x := 40.0
		var z := -125.0
		for s in [-1.0, 1.0]:
			for q in [-6.0, 6.0]:
				k.box(g, "RST", Vector3(2, 34, 2), Vector3(x + s * 30, 17, z + q))
			k.box(g, "RST", Vector3(3, 2, 16), Vector3(x + s * 30, 34, z))
			k.box(g, "STL", Vector3(1, 1, 20), Vector3(x + s * 30, 16, z), Vector3(0.9, 0, 0))
			_add_box(x + s * 30, z, 4, 15, -5, 35)
		k.box(g, "RST", Vector3(66, 3.4, 4), Vector3(x, 36.5, z - 3))
		k.box(g, "RST", Vector3(66, 3.4, 4), Vector3(x, 36.5, z + 3))
		k.box(g, "HAZ", Vector3(7, 4, 9), Vector3(x + 9, 39, z))
		k.box(g, "DRK", Vector3(0.4, 16, 0.4), Vector3(x + 9, 29, z))
		k.box(g, "STL", Vector3(3, 3, 3), Vector3(x + 9, 20, z))

	# refinery block + smokestacks
	if true:
		var g := k.bone(self)
		var x := 190.0
		var z := 0.0
		k.box(g, "CON", Vector3(30, 2, 30), Vector3(x, 0.6, z))
		for o in [[-12, -12], [12, -12], [-12, 12], [12, 12]]:
			k.box(g, "STL", Vector3(1.6, 44, 1.6), Vector3(x + o[0], 22, z + o[1]))
		for hh in range(10, 45, 11):
			k.box(g, "STL", Vector3(27, 1, 27), Vector3(x, hh, z))
		k.cyl(g, "TNK", 5.0, 5.0, 50.0, Vector3(x - 4, 26, z - 3), Vector3.ZERO, 14)
		k.cyl(g, "RST", 3.2, 3.2, 38.0, Vector3(x + 6, 20, z + 5), Vector3.ZERO, 12)
		k.cyl(g, "STL", 1.0, 1.0, 30.0, Vector3(x + 2, 30, z + 9), Vector3(0, 0, 0.5), 8)
		_add_box(x, z, 27, 27, -5, 44)
		for sp in [[204.0, 62.0, 62.0], [222.0, 88.0, 50.0]]:
			var sx: float = sp[0]
			var sz: float = sp[1]
			var hh: float = sp[2]
			k.cyl(g, "CON", 3.0, 4.6, hh, Vector3(sx, hh * 0.5, sz), Vector3.ZERO, 14)
			k.cyl(g, "RST", 3.3, 3.5, 4.0, Vector3(sx, hh - 6, sz), Vector3.ZERO, 14)
			_add_cyl(sx, sz, 4.6, -5, hh)
			emitters.append({"pos": Vector3(sx, hh + 2, sz), "kind": "stack", "t": 0.0})

	# battery emplacements (sandbag rings)
	var bg := k.bone(self)
	for bp in BATTERY_POS:
		var y := height(bp.x, bp.y)
		k.cyl(bg, "CON", 7.0, 7.6, 1.0, Vector3(bp.x, y + 0.3, bp.y), Vector3.ZERO, 18)
		for ring in 2:
			for q in 14:
				var a := TAU * (q + ring * 0.5) / 14.0
				k.box(bg, "SND", Vector3(4.6, 1.5, 2.2), Vector3(bp.x + cos(a) * 10.5, y + 0.7 + ring * 1.4, bp.y + sin(a) * 10.5), Vector3(0, -a + hz, 0), {"tx": 0.85, "tz": 0.8})

	# ruined blocks south of the base
	for i in 22:
		var g := k.bone(self)
		var x := r.randf_range(-450.0, 450.0)
		var z := r.randf_range(215.0, 515.0)
		if absf(x) < 70.0:
			x += signf(x + 0.001) * 90.0
		var w := r.randf_range(18.0, 44.0)
		var d := r.randf_range(18.0, 40.0)
		var h := 12.0 + r.randf() * r.randf() * 46.0
		var y := height(x, z) - 3.0
		_tower(k, g, x, z, w, d, h, r, r.randf() * r.randf() * 0.8)

	# czech hedgehogs + wrecks
	var hg := k.bone(self)
	for i in 26:
		var x := r.randf_range(-150.0, 150.0)
		var z := r.randf_range(175.0, 235.0)
		if absf(x) < 22.0:
			continue
		var y := height(x, z) + 1.4
		for o in [[1.3, 0.0, 1.0], [-0.3, 0.5, 0.4], [0.5, 0.4, 1.3]]:
			k.box(hg, "RST", Vector3(0.5, 5.4, 0.5), Vector3(x, y, z), Vector3(o[0], o[1], o[2]))
	for wk in [[32.0, 240.0, 0.6], [-64.0, 196.0, 2.1], [150.0, 120.0, 1.2], [-20.0, -80.0, 0.3], [84.0, -180.0, 2.6]]:
		var x: float = wk[0]
		var z: float = wk[1]
		var ry: float = wk[2]
		var y := height(x, z)
		k.box(hg, "RST", Vector3(7, 2.6, 12), Vector3(x, y + 1.3, z), Vector3(0.05, ry, 0.08), {"tx": 0.8, "tz": 0.85})
		k.box(hg, "RST", Vector3(4.4, 2, 5), Vector3(x + 0.6, y + 3.3, z), Vector3(0.1, ry + 0.7, 0.05), {"tx": 0.7, "tz": 0.7})
		k.cyl(hg, "DRK", 0.3, 0.3, 7.0, Vector3(x + 3, y + 3.2, z + 2), Vector3(1.2, ry + 0.7, 0), 8)
		_add_box(x, z, 9, 9, y - 5, y + 4)
		if r.randf() < 0.75:
			emitters.append({"pos": Vector3(x, y + 4, z), "kind": "fire", "t": 0.0})
	for fp in [[-90, -160], [-90, -66], [-90, 28], [90, 110], [-30, 120], [30, -240]]:
		k.box(hg, "STL", Vector3(0.7, 26, 0.7), Vector3(fp[0], 13, fp[1]))
		k.box(hg, "STL", Vector3(5, 1.6, 1.2), Vector3(fp[0], 26.5, fp[1]))

	var bm := _mats()
	bm.merge(Buildings.mats())
	k.bake(bm)


func _mats() -> Dictionary:
	var am := Tex.armor
	var mats := {
		"CON": {"mat": Tex.concrete, "params": {"tint": Color(0.5, 0.47, 0.41), "metal": 0.0}},
		"SND": {"mat": Tex.concrete, "params": {"tint": Color(0.46, 0.36, 0.22), "metal": 0.0}},
		"FAC": {"mat": Tex.facade, "params": {"tint": Color(0.52, 0.47, 0.4), "metal": 0.0}},
		"COR": {"mat": Tex.corrugated, "params": {"tint": Color(0.27, 0.3, 0.27), "metal": 0.45}},
		"CN1": {"mat": Tex.corrugated, "params": {"tint": Color(0.42, 0.17, 0.1), "metal": 0.35}},
		"CN2": {"mat": Tex.corrugated, "params": {"tint": Color(0.16, 0.26, 0.34), "metal": 0.35}},
		"CN3": {"mat": Tex.corrugated, "params": {"tint": Color(0.33, 0.33, 0.16), "metal": 0.35}},
		"STL": {"mat": am, "params": {"tint": Color(0.13, 0.14, 0.15), "metal": 0.7}},
		"RST": {"mat": am, "params": {"tint": Color(0.3, 0.15, 0.08), "metal": 0.3, "wear": 1.3}},
		"TNK": {"mat": am, "params": {"tint": Color(0.4, 0.4, 0.35), "metal": 0.4}},
		"HAZ": {"mat": am, "params": {"tint": Color(0.7, 0.5, 0.06), "metal": 0.2, "wear": 1.2, "stripes": 1.0}},
		"DRK": {"mat": am, "params": {"tint": Color(0.008, 0.008, 0.009), "metal": 0.0, "wear": 0.0}},
	}
	return mats


# ------------------------------------------------------------------ mesas and outcrops
func _rock_tri(a: Vector3, b: Vector3, c: Vector3, out: Vector3, shade: float, solid: bool) -> void:
	var nrm := (c - a).cross(b - a)
	if nrm.dot(out) < 0.0:
		var t := b
		b = c
		c = t
		nrm = -nrm
	if nrm.length_squared() < 1e-8:
		return
	nrm = nrm.normalized()
	_rock_st.set_color(Color(shade, 1.0, 0.0))
	_rock_st.set_normal(nrm)
	_rock_st.add_vertex(a)
	_rock_st.set_normal(nrm)
	_rock_st.add_vertex(b)
	_rock_st.set_normal(nrm)
	_rock_st.add_vertex(c)
	if solid:
		_rock_faces.append(a)
		_rock_faces.append(b)
		_rock_faces.append(c)


# One layered formation: a talus skirt, then bands of cliff separated by ledges, then a cap.
# rx / rz = half extents before rotation, h = height above its lowest footing.
func _mesa(cx: float, cz: float, rx: float, rz: float, rot: float, h: float, seed_v: int, solid: bool) -> void:
	var rr := RandomNumberGenerator.new()
	rr.seed = seed_v
	var n := 22 if maxf(rx, rz) < 120.0 else 30
	var base_y := 1e9
	for i in 8:
		var a := TAU * i / 8.0
		base_y = minf(base_y, height(cx + cos(a) * rx * 1.3, cz + sin(a) * rz * 1.3))
	base_y -= 5.0
	var p1 := rr.randf() * TAU
	var p2 := rr.randf() * TAU
	var prof := PackedFloat32Array()
	for i in n:
		var a := TAU * i / n
		prof.append(1.0 + 0.2 * sin(a * 2.0 + p1) + 0.11 * sin(a * 5.0 + p2) + rr.randf_range(-0.06, 0.06))
	# bands: [y0, scale0, y1, scale1, shade]
	var bands: Array = [[base_y, 1.6, base_y + h * 0.13, 1.12, 0.92]]
	var y := base_y + h * 0.13
	var top := base_y + h
	while y < top - 1.0:
		var st := minf(rr.randf_range(0.08, 0.17) * h, top - y)
		var t := clampf((y - base_y) / h, 0.0, 1.0)
		var sc := lerpf(1.06, 0.7, pow(t, 0.85)) * rr.randf_range(0.93, 1.05)
		bands.append([y, sc, y + st, sc * rr.randf_range(0.95, 0.99), rr.randf_range(0.8, 1.0)])
		y += st
	var cr := cos(rot)
	var sr := sin(rot)
	var centre := Vector3(cx, 0, cz)
	var prev: PackedVector3Array = PackedVector3Array()
	for bi in bands.size():
		var b: Array = bands[bi]
		var lo := PackedVector3Array()
		var hi := PackedVector3Array()
		for i in n:
			var a := TAU * i / n
			var jit := rr.randf_range(0.965, 1.035)
			var ox := cos(a) * rx * prof[i] * jit
			var oz := sin(a) * rz * prof[i] * jit
			var dx := ox * cr - oz * sr
			var dz := ox * sr + oz * cr
			lo.append(Vector3(cx + dx * float(b[1]), float(b[0]), cz + dz * float(b[1])))
			hi.append(Vector3(cx + dx * float(b[3]), float(b[2]), cz + dz * float(b[3])))
		for i in n:
			var j := (i + 1) % n
			var out := (lo[i] + lo[j]) * 0.5 - Vector3(cx, (lo[i].y + hi[i].y) * 0.5, cz)
			out.y = 0.0
			_rock_tri(lo[i], lo[j], hi[j], out, float(b[4]), solid)
			_rock_tri(lo[i], hi[j], hi[i], out, float(b[4]), solid)
			if bi > 0:
				# ledge between the band below and this one
				_rock_tri(prev[i], prev[j], lo[j], Vector3.UP, float(b[4]) * 1.04, solid)
				_rock_tri(prev[i], lo[j], lo[i], Vector3.UP, float(b[4]) * 1.04, solid)
		prev = hi
	var capc := Vector3(cx, top + rr.randf_range(0.5, 2.5), cz)
	for i in n:
		_rock_tri(prev[i], prev[(i + 1) % n], capc, Vector3.UP, 1.0, solid)
	_rock_n += 1
	if solid:
		cols.append({"x": cx, "z": cz, "r": maxf(rx, rz) * 0.85, "h": top})


func _build_rocks() -> void:
	_rock_st = SurfaceTool.new()
	_rock_st.begin(Mesh.PRIMITIVE_TRIANGLES)
	_rock_faces = PackedVector3Array()
	var rr := RandomNumberGenerator.new()
	rr.seed = 404 if map_id == "gunline" else 303
	var placed: Array = []
	var tries := 0
	var want := 22 if map_id == "gunline" else 26
	while placed.size() < want and tries < 600:
		tries += 1
		var x := 0.0
		var z := 0.0
		if map_id == "gunline":
			# the flanks of the gun line and the hills behind it; the plain and the town stay clear
			var side := -1.0 if rr.randf() < 0.5 else 1.0
			x = side * rr.randf_range(640.0, 1080.0)
			z = rr.randf_range(-300.0, 1050.0)
			if rr.randf() < 0.3:
				x = rr.randf_range(-1050.0, 1050.0)
				z = rr.randf_range(660.0, 1080.0)
		else:
			var a := rr.randf() * TAU
			var d := rr.randf_range(410.0, 650.0)
			x = BASE.x + cos(a) * d
			z = BASE.y + sin(a) * d
			if z > 40.0 and absf(x) < 150.0:
				continue
		var rx := rr.randf_range(26.0, 74.0)
		var rz := rx * rr.randf_range(0.55, 1.5)
		var ok := true
		for q in placed:
			if Vector2(x - q.x, z - q.y).length() < q.z + maxf(rx, rz) + 24.0:
				ok = false
		var spv: Vector2 = points["spawn"]
		if Vector2(x - spv.x, z - spv.y).length() < 130.0:
			ok = false
		if map_id == "gunline" and Vector2(x - HALL_POS.x, z - HALL_POS.y).length() < 300.0:
			ok = false
		if not ok:
			continue
		placed.append(Vector3(x, z, maxf(rx, rz)))
		_mesa(x, z, rx, rz, rr.randf() * PI, rr.randf_range(28.0, 96.0), rr.randi(), true)
	# the country beyond the battlefield: big mesas out to the horizon, no collision
	for i in 26:
		var a := rr.randf() * TAU
		var d := rr.randf_range(bound + 260.0, bound + 1500.0)
		var rx := rr.randf_range(90.0, 260.0)
		_mesa(cos(a) * d, sin(a) * d, rx, rx * rr.randf_range(0.6, 1.6), rr.randf() * PI, rr.randf_range(110.0, 300.0), rr.randi(), false)
	var mi := MeshInstance3D.new()
	mi.mesh = _rock_st.commit()
	mi.material_override = Tex.rock
	mi.extra_cull_margin = 100.0
	add_child(mi)
	if not _rock_faces.is_empty():
		var shape := ConcavePolygonShape3D.new()
		shape.set_faces(_rock_faces)
		var cs := CollisionShape3D.new()
		cs.shape = shape
		body.add_child(cs)
	_rock_st = null


func _build_motes() -> void:
	motes = GPUParticles3D.new()
	motes.amount = 900
	motes.lifetime = 7.0
	motes.preprocess = 7.0
	motes.local_coords = false
	motes.visibility_aabb = AABB(Vector3(-200, -200, -200), Vector3(400, 400, 400))
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	pm.emission_box_extents = Vector3(90, 40, 90)
	pm.direction = Vector3(1, 0.05, 0.3)
	pm.spread = 12.0
	pm.initial_velocity_min = 6.0
	pm.initial_velocity_max = 12.0
	pm.gravity = Vector3.ZERO
	pm.scale_min = 0.05
	pm.scale_max = 0.16
	var gr := Gradient.new()
	gr.colors = PackedColorArray([Color(0.95, 0.84, 0.64, 0), Color(0.95, 0.84, 0.64, 0.5), Color(0.95, 0.84, 0.64, 0)])
	gr.offsets = PackedFloat32Array([0.0, 0.3, 1.0])
	var gt := GradientTexture1D.new()
	gt.gradient = gr
	pm.color_ramp = gt
	motes.process_material = pm
	var q := QuadMesh.new()
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.billboard_keep_scale = true
	m.vertex_color_use_as_albedo = true
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_texture = Tex.glow
	q.material = m
	motes.draw_pass_1 = q
	motes.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(motes)


# zero-g map: no terrain; the asteroid belt, structures, sky and light come from space_env.gd
func _build_space() -> void:
	space = true
	bound = 1500.0
	radar = 700.0
	body = StaticBody3D.new()
	body.collision_layer = 1
	body.collision_mask = 0
	add_child(body)
	var path := "res://scripts/space_env.gd"
	if ResourceLoader.exists(path):
		space_env = load(path)
		var res: Dictionary = space_env.build(self)
		# fly right up to (and a little past) the far ships: the box from the map's own layout
		space_min = Vector3(space_env.BOUNDS_MIN.x, space_env.BOUNDS_MIN.y - 10.0, space_env.BOUNDS_MIN.z)
		space_max = Vector3(space_env.BOUNDS_MAX.x, space_env.BOUNDS_MAX.y + 10.0, space_env.BOUNDS_MAX.z)
		points = res.get("points", {})
		cols = res.get("cols", [])
		we = res["we"]
		env = res["env"]
		sun = res["sun"]
	else:
		# stand-in until the real environment exists: black sky and a few rocks
		env = Environment.new()
		env.background_mode = Environment.BG_COLOR
		env.background_color = Color(0.004, 0.005, 0.01)
		env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
		env.ambient_light_color = Color(0.3, 0.34, 0.45)
		env.ambient_light_energy = 0.5
		env.tonemap_mode = Environment.TONE_MAPPER_ACES
		env.glow_enabled = true
		we = WorldEnvironment.new()
		we.environment = env
		add_child(we)
		sun = DirectionalLight3D.new()
		sun.light_energy = 3.0
		sun.shadow_enabled = true
		add_child(sun)
		sun.basis = Basis.looking_at(Vector3(0.5, -0.5, -0.7), Vector3.UP)
		var rr := RandomNumberGenerator.new()
		rr.seed = 9
		for i in 40:
			var p := Vector3(rr.randf_range(-900, 900), rr.randf_range(-250, 250), rr.randf_range(-1400, -150))
			var sz := rr.randf_range(20.0, 110.0)
			var mi := MeshInstance3D.new()
			var bm := BoxMesh.new()
			bm.size = Vector3(sz, sz * 0.7, sz * 0.9)
			mi.mesh = bm
			mi.material_override = Tex.rock
			mi.position = p
			mi.rotation = Vector3(rr.randf() * 3.0, rr.randf() * 3.0, rr.randf() * 3.0)
			add_child(mi)
			var sb := StaticBody3D.new()
			sb.collision_layer = 1
			sb.collision_mask = 0
			var cs := CollisionShape3D.new()
			var bs := BoxShape3D.new()
			bs.size = bm.size
			cs.shape = bs
			sb.add_child(cs)
			sb.transform = mi.transform
			add_child(sb)
		points = {"spawn": Vector3(0, 0, 600)}
	sun_dir = (sun.global_transform.basis.z).normalized() if sun.is_inside_tree() else Vector3.UP
	# hard light: the unlit side is nearly black, read by rim light and the frame's own lamps
	env.ambient_light_energy *= 0.32
	# thin dust inside the belt only, so sunlight falls through the gaps between rocks in shafts
	env.volumetric_fog_enabled = true
	env.volumetric_fog_density = 0.0
	env.volumetric_fog_albedo = Color(0.8, 0.74, 0.66)
	env.volumetric_fog_anisotropy = 0.7
	env.volumetric_fog_length = 900.0
	env.volumetric_fog_detail_spread = 2.6
	env.volumetric_fog_ambient_inject = 0.0
	env.volumetric_fog_sky_affect = 0.0
	env.volumetric_fog_gi_inject = 0.0
	sun.light_volumetric_fog_energy = 3.0
	var fogv := FogVolume.new()
	fogv.shape = RenderingServer.FOG_VOLUME_SHAPE_ELLIPSOID
	fogv.size = Vector3(3600.0, 620.0, 1700.0)
	fogv.position = Vector3(0, 0, -800.0)
	var fm := FogMaterial.new()
	fm.density = 0.0003
	fm.albedo = Color(0.8, 0.74, 0.66)
	fm.edge_fade = 0.8
	fogv.material = fm
	add_child(fogv)
	if points.get("spawn") is Vector3:
		var sp3: Vector3 = points["spawn"]
		points["spawn3"] = sp3
		points["spawn"] = Vector2(sp3.x, sp3.z)
	elif not points.has("spawn"):
		points["spawn"] = Vector2(0, 600)
		points["spawn3"] = Vector3(0, 0, 600)


# the rest of the fleet action, far beyond reach: silent flashes and beams on the horizon
var _far: Array = []
var _far_t := 1.0


func _tick_far_battle(dt: float, cam_pos: Vector3, fx) -> void:
	_far_t -= dt
	if _far_t <= 0.0:
		_far_t = randf_range(0.4, 2.2)
		var a := randf_range(-2.6, -0.5)
		var c := cam_pos + Vector3(cos(a), randf_range(-0.12, 0.3), sin(a)) * randf_range(3200.0, 4800.0)
		if randf() < 0.55:
			fx.moon(c, randf_range(40.0, 130.0), randf_range(0.5, 1.4), Color(1.0, 0.8, 0.55) if randf() < 0.7 else Color(0.6, 0.8, 1.0))
		else:
			var d := Vector3(randf_range(-1, 1), randf_range(-0.2, 0.2), randf_range(-1, 1)).normalized()
			_far.append({"a": c, "b": c + d * randf_range(500.0, 1400.0), "t": randf_range(0.25, 0.9), "col": Color(1.0, 0.45, 0.3) if randf() < 0.5 else Color(0.5, 0.75, 1.0)})
	var i := 0
	while i < _far.size():
		var f: Dictionary = _far[i]
		f["t"] = float(f["t"]) - dt
		if float(f["t"]) <= 0.0:
			if randf() < 0.5:
				fx.moon(f["b"], randf_range(50.0, 110.0), 0.8, Color(1.0, 0.8, 0.55))
			_far.remove_at(i)
			continue
		fx.beam(f["a"], f["b"], 9.0, f["col"], 0.0, 0.9)
		i += 1


func tick(dt: float, cam_pos: Vector3, fx) -> void:
	if space:
		if space_env != null and space_env.has_method("tick"):
			space_env.tick(self, dt, cam_pos)
		_tick_far_battle(dt, cam_pos, fx)
		return
	if motes != null:
		motes.global_position = cam_pos
	_wind_t -= dt
	if _wind_t <= 0.0:
		_wind_t = 0.14
		var x := cam_pos.x + randf_range(-170, 170)
		var z := cam_pos.z + randf_range(-170, 170)
		fx.emit("haze", Vector3(x, height(x, z) + randf_range(2, 7), z), Vector3(randf_range(9, 15), randf_range(0.2, 1.2), randf_range(2, 6)))
	if dusk:
		_tick_sky(dt, cam_pos, fx)
	for e in emitters:
		e["t"] -= dt
		if e["t"] > 0.0:
			continue
		var p: Vector3 = e["pos"]
		if p.distance_squared_to(cam_pos) > 640.0 * 640.0:
			e["t"] = 0.5
			continue
		if e["kind"] == "stack":
			e["t"] = 0.13
			fx.emit("smoke", p + Vector3(randf_range(-2, 2), 0, randf_range(-2, 2)), Vector3(randf_range(3, 6), randf_range(7, 11), randf_range(-1, 2)))
		else:
			e["t"] = 0.2
			fx.emit("smoke", p + Vector3(randf_range(-1.5, 1.5), 0, randf_range(-1.5, 1.5)), Vector3(randf_range(2, 4), randf_range(5, 8), randf_range(-1, 1)))
			if randf() < 0.6:
				fx.emit("fire", p + Vector3(randf_range(-1.5, 1.5), -1.5, randf_range(-1.5, 1.5)), Vector3(0, randf_range(2, 5), 0))


# ------------------------------------------------------------------ gun line map
func _hangar(k, g: Node3D, x: float, z: float, w: float, d: float, h: float) -> void:
	var y := height(x, z)
	k.box(g, "CON", Vector3(w + 4, 2, d + 4), Vector3(x, y + 0.6, z))
	k.box(g, "COR", Vector3(w, h, d), Vector3(x, y + h * 0.5 + 1, z))
	k.box(g, "COR", Vector3(w + 3, 8, d + 2), Vector3(x, y + h + 5, z), Vector3.ZERO, {"tz": 0.06})
	k.box(g, "DRK", Vector3(w * 0.56, h * 0.72, 1.2), Vector3(x, y + h * 0.36 + 1.4, z - d * 0.5))
	k.box(g, "HAZ", Vector3(w * 0.66, 2.4, 2.2), Vector3(x, y + h * 0.78 + 1.8, z - d * 0.5))
	for i in [-1.0, 1.0]:
		k.box(g, "CON", Vector3(3, h * 0.78, 2), Vector3(x + i * w * 0.3, y + h * 0.39 + 1, z - d * 0.5))
	# walls up to the eaves, then the gabled roof as three steps
	_add_box(x, z, w + 2, d + 2, y - 5, y + h + 1.2)
	for st in [[0.78, 3.0], [0.53, 5.0], [0.28, 7.0]]:
		_add_box(x, z, w + 3, (d + 2) * float(st[0]), y + h, y + h + float(st[1]), false)


# one modelled tower block standing on the lowest corner of its footprint
func _tower(k, g: Node3D, x: float, z: float, w: float, d: float, h: float, r: RandomNumberGenerator, ruined: float) -> void:
	var y := minf(minf(height(x - w * 0.5, z - d * 0.5), height(x + w * 0.5, z - d * 0.5)), minf(height(x - w * 0.5, z + d * 0.5), height(x + w * 0.5, z + d * 0.5)))
	Buildings.tower(k, g, _add_box, x, z, w, d, h, maxf(y, height(x, z) - 4.0), r, ruined)


# megablocks use the megastructure generator when the kit has one, a giant tower otherwise
func _megablock(k, g: Node3D, x: float, z: float, w: float, d: float, h: float, r: RandomNumberGenerator) -> void:
	var bk = Buildings as Script
	var has_mega := false
	for m in bk.get_script_method_list():
		if m["name"] == "megablock":
			has_mega = true
	if has_mega:
		bk.call("megablock", k, g, _add_box, x, z, w, d, h, height(x, z) - 4.0, r)
	else:
		Buildings.tower(k, g, _add_box, x, z, w, d, h, height(x, z) - 4.0, r, 0.15)


# (superseded by _megablock) a stepped megablock: plinth, three setbacks, buttress fins and a broken crown
func _arcology(k, g: Node3D, x: float, z: float, w: float, d: float, h: float) -> void:
	var y := height(x, z) - 4.0
	k.box(g, "CON", Vector3(w + 34, 16, d + 34), Vector3(x, y + 7, z), Vector3.ZERO, {"tx": 0.92, "tz": 0.92})
	_add_box(x, z, w + 30, d + 30, y - 5, y + 15)
	var tiers := [[1.0, 1.0, 0.0, 0.56, 0.0, 0.0], [0.74, 0.78, 0.56, 0.86, 0.07, 0.0], [0.42, 0.5, 0.86, 1.0, -0.12, 0.08]]
	for t in tiers:
		var tw: float = w * float(t[0])
		var td: float = d * float(t[1])
		var y0: float = y + 14.0 + (h - 14.0) * float(t[2])
		var y1: float = y + 14.0 + (h - 14.0) * float(t[3])
		var tx: float = x + w * float(t[4])
		var tz: float = z + d * float(t[5])
		k.box(g, "FAC", Vector3(tw, y1 - y0, td), Vector3(tx, (y0 + y1) * 0.5, tz))
		k.box(g, "CON", Vector3(tw + 5, 3.0, td + 5), Vector3(tx, y1 + 0.5, tz))
		_add_box(tx, tz, tw, td, y0 - 2.0, y1 + 2.0, float(t[2]) == 0.0)
	for sgn in [-1.0, 1.0]:
		k.box(g, "CON", Vector3(9, h * 0.62, d * 0.46), Vector3(x + sgn * (w * 0.5 + 4.0), y + h * 0.31, z), Vector3.ZERO, {"tz": 0.25})
		k.box(g, "STL", Vector3(3.0, h * 0.5, 3.0), Vector3(x + sgn * w * 0.3, y + h * 0.75, z - d * 0.5 - 2.0))
	# service gantry and antenna farm on the crown
	k.box(g, "STL", Vector3(w * 0.3, 2.0, 4.0), Vector3(x - w * 0.12, y + h + 9.0, z + d * 0.05))
	for i in 3:
		k.box(g, "STL", Vector3(1.6, 26.0 + i * 9.0, 1.6), Vector3(x - w * 0.2 + i * w * 0.08, y + h + 13.0 + i * 4.5, z + d * 0.05))
	emitters.append({"pos": Vector3(x + w * 0.2, y + h * 0.58 + 16.0, z), "kind": "fire", "t": 0.0})


func _lattice(k, g: Node3D, x: float, z: float, h: float, w: float) -> void:
	var y := height(x, z)
	for o in [[-1, -1], [1, -1], [-1, 1], [1, 1]]:
		k.box(g, "STL", Vector3(0.9, h, 0.9), Vector3(x + o[0] * w, y + h * 0.5, z + o[1] * w))
	var hh := 9.0
	while hh < h:
		k.box(g, "STL", Vector3(w * 2.2, 0.6, 0.6), Vector3(x, y + hh, z - w))
		k.box(g, "STL", Vector3(w * 2.2, 0.6, 0.6), Vector3(x, y + hh, z + w))
		k.box(g, "STL", Vector3(0.6, 0.6, w * 2.2), Vector3(x - w, y + hh, z))
		k.box(g, "STL", Vector3(0.6, 0.6, w * 2.2), Vector3(x + w, y + hh, z))
		hh += 12.0
	k.box(g, "STL", Vector3(w * 2.6, 1.2, w * 2.6), Vector3(x, y + h, z))
	_add_box(x, z, w * 2.2, w * 2.2, y - 5, y + h)


func _build_gunline() -> void:
	var k := MeshKit.new(91)
	k.dust = 0.5
	k.dust_top = 7.0
	k.jitter = 0.16
	var hz := PI * 0.5
	var r := _rng

	# anti-orbit cannon pads with blast walls and power houses
	var ci := 0
	for cp in points["cannons"]:
		ci += 1
		var g := k.bone(self)
		var x: float = cp.x
		var z: float = cp.y
		var y := height(x, z)
		k.cyl(g, "CON", 66.0, 70.0, 3.0, Vector3(x, y - 0.7, z), Vector3(0, PI / 8.0, 0), 8)
		k.cyl(g, "HAZ", 54.0, 54.0, 0.2, Vector3(x, y + 0.85, z), Vector3(0, PI / 8.0, 0), 8)
		k.cyl(g, "CON", 50.0, 50.0, 0.24, Vector3(x, y + 0.86, z), Vector3(0, PI / 8.0, 0), 8)
		for wl in [[0.0, -84.0, 70.0, 5.0], [-84.0, 0.0, 5.0, 60.0], [84.0, 0.0, 5.0, 60.0]]:
			var wx: float = x + float(wl[0])
			var wz: float = z + float(wl[1])
			var ww: float = wl[2]
			var wd: float = wl[3]
			var along := ww > wd
			k.box(g, "CON", Vector3(ww, 13, wd), Vector3(wx, y + 4.5, wz), Vector3.ZERO, {"tx": 1.0 if along else 0.6, "tz": 0.6 if along else 1.0})
			k.box(g, "HAZ", Vector3(ww if along else 1.4, 0.8, 1.4 if along else wd), Vector3(wx, y + 11.2, wz))
			_add_box(wx, wz, ww, wd, y - 5, y + 11)
		var px := x + 52.0 * (1.0 if x <= 0.0 else -1.0)
		var pz := z + 96.0
		k.box(g, "CON", Vector3(30, 14, 22), Vector3(px, y + 6, pz), Vector3.ZERO, {"tx": 0.9, "tz": 0.9})
		k.box(g, "STL", Vector3(8, 6, 8), Vector3(px - 6, y + 15.5, pz))
		k.cyl(g, "RST", 2.6, 2.6, 16.0, Vector3(px + 9, y + 12, pz + 3), Vector3.ZERO, 12)
		k.cyl(g, "STL", 1.0, 1.0, 60.0, Vector3(lerpf(px, x, 0.5), y + 1.6, lerpf(pz, z, 0.5) + 10.0), Vector3(hz, atan2(x - px, z - pz), 0), 8)
		_add_box(px, pz, 30, 22, y - 5, y + 13)
		_add_box(px - 6, pz, 8, 8, y + 12, y + 18.5, false)
		var lb := Label3D.new()
		lb.text = "AO-%d" % ci
		lb.font = Tex.font
		lb.font_size = 220
		lb.pixel_size = 0.05
		lb.modulate = Color(0.8, 0.76, 0.66, 0.85)
		lb.outline_size = 0
		lb.position = Vector3(x, y + 5.0, z - 86.6)
		lb.rotation.y = PI
		add_child(lb)

	# rear base: command bunker, hangars, depot, radar
	if true:
		var g := k.bone(self)
		var y := height(0, 420)
		k.box(g, "CON", Vector3(90, 18, 44), Vector3(0, y + 8.5, 430), Vector3.ZERO, {"tx": 0.9, "tz": 0.82})
		k.box(g, "CON", Vector3(50, 8, 26), Vector3(8, y + 21, 432), Vector3.ZERO, {"tx": 0.9, "tz": 0.85})
		k.box(g, "DRK", Vector3(56, 2.2, 1.2), Vector3(0, y + 11.5, 409.4))
		k.box(g, "HAZ", Vector3(18, 1.6, 2), Vector3(-26, y + 10, 409))
		_add_box(0, 430, 88, 42, y - 5, y + 17.5)
		_add_box(8, 432, 50, 26, y + 17, y + 25, false)
		_hangar(k, g, -170.0, 440.0, 62.0, 56.0, 26.0)
		_hangar(k, g, 170.0, 440.0, 62.0, 56.0, 26.0)
		_hangar(k, g, -260.0, 430.0, 62.0, 56.0, 26.0)
		_lattice(k, g, 86.0, 372.0, 56.0, 4.5)
		var ty := height(86, 372)
		k.cyl(g, "TNK", 9.0, 2.0, 3.4, Vector3(86, ty + 62, 372), Vector3(1.0, 2.6, 0), 16)
		for i in 3:
			var tx := 270.0 + i * 44.0
			var tz := 420.0
			var tyy := height(tx, tz)
			k.cyl(g, "CON", 18.5, 19.0, 1.6, Vector3(tx, tyy + 0.6, tz), Vector3.ZERO, 20)
			k.cyl(g, "TNK", 17.0, 17.0, 20.0, Vector3(tx, tyy + 11, tz), Vector3.ZERO, 24)
			k.cyl(g, "TNK", 4.0, 17.0, 3.0, Vector3(tx, tyy + 22.5, tz), Vector3.ZERO, 24)
			_add_cyl(tx, tz, 17.5, tyy - 5, tyy + 23)
		var cmats := ["CN1", "CN2", "CN3", "COR"]
		for cpos in [[-60, 330], [70, 318], [-230, 330], [200, 340], [-20, 250], [330, 250], [-330, 240]]:
			var turned := r.randf() < 0.5
			for i in 3:
				var cx: float = cpos[0] + (i * 7.2 if turned else 0.0)
				var cz: float = cpos[1] + (0.0 if turned else i * 7.2)
				var cnt := 1 + r.randi() % 3
				var cy := height(cx, cz)
				for q in cnt:
					k.box(g, cmats[r.randi() % 4], Vector3(14, 5.6, 5.8), Vector3(cx + r.randf_range(-0.4, 0.4), cy + 2.8 + q * 5.7, cz + r.randf_range(-0.4, 0.4)), Vector3(0, hz if turned else 0.0, 0))
				_add_box(cx, cz, 6.2 if turned else 14.4, 14.4 if turned else 6.2, cy - 5, cy + cnt * 5.7)

	# forward barrier line with gaps, dragon's teeth, hedgehogs
	var bg := k.bone(self)
	var bx := -760.0
	while bx <= 760.0:
		var bz := -78.0 + sin(bx * 0.01) * 26.0
		var near_cannon := false
		for cp in points["cannons"]:
			if absf(bx - cp.x) < 60.0:
				near_cannon = true
		if not near_cannon and absf(bx) > 34.0 and r.randf() < 0.82:
			var by := height(bx, bz)
			var broken := r.randf() < 0.25
			var bh := 5.0 if broken else 9.0
			k.box(bg, "CON", Vector3(46, bh + 3, 6), Vector3(bx, by + bh * 0.5 - 1.5, bz), Vector3(0, 0, 0.0), {"tz": 0.6})
			if not broken:
				k.box(bg, "HAZ", Vector3(46, 0.7, 1.4), Vector3(bx, by + bh + 0.2, bz))
			_add_box(bx, bz, 46, 6, by - 5, by + bh)
		bx += 62.0
	for i in 70:
		var hx := r.randf_range(-800.0, 800.0)
		var hzz := r.randf_range(-190.0, -120.0)
		if absf(hx) < 26.0:
			continue
		var hy := height(hx, hzz) + 1.4
		if r.randf() < 0.5:
			for o in [[1.3, 0.0, 1.0], [-0.3, 0.5, 0.4], [0.5, 0.4, 1.3]]:
				k.box(bg, "RST", Vector3(0.5, 5.4, 0.5), Vector3(hx, hy, hzz), Vector3(o[0], o[1], o[2]))
		else:
			k.box(bg, "CON", Vector3(3.4, 4.0, 3.4), Vector3(hx, hy + 0.3, hzz), Vector3(0, r.randf() * 3.0, 0), {"tx": 0.25, "tz": 0.25})

	# AA nests
	for ap in points["aa"]:
		var ay := height(ap.x, ap.y)
		k.cyl(bg, "CON", 9.0, 9.6, 1.0, Vector3(ap.x, ay + 0.3, ap.y), Vector3.ZERO, 18)
		for ring in 2:
			for q in 16:
				var a := TAU * (q + ring * 0.5) / 16.0
				k.box(bg, "SND", Vector3(4.6, 1.5, 2.2), Vector3(ap.x + cos(a) * 12.5, ay + 0.7 + ring * 1.4, ap.y + sin(a) * 12.5), Vector3(0, -a + hz, 0), {"tx": 0.85, "tz": 0.8})

	# power-line pylons for scale
	for px2 in range(-960, 961, 240):
		_lattice(k, bg, float(px2), 215.0 + absf(float(px2)) * 0.04, 74.0, 5.5)
		var py2 := height(px2, 215.0)
		k.box(bg, "STL", Vector3(40, 1.0, 1.4), Vector3(px2, py2 + 66, 215.0 + absf(float(px2)) * 0.04))

	# ruined town to the north (enemy landing zone)
	for i in 64:
		var g := k.bone(self)
		var x := r.randf_range(-820.0, 820.0)
		var z := r.randf_range(-980.0, -400.0)
		if absf(x) < 56.0:
			x += signf(x + 0.001) * 80.0
		var skip := false
		for lz in points["lz"]:
			if Vector2(x - lz.x, z - lz.y).length() < 70.0:
				skip = true
		# keep the megastructure plots clear
		for mp in MEGA_PLOTS:
			if absf(x - float(mp[0])) < float(mp[2]) * 0.5 + 46.0 and absf(z - float(mp[1])) < float(mp[3]) * 0.5 + 46.0:
				skip = true
		if skip:
			continue
		var w := r.randf_range(20.0, 48.0)
		var d := r.randf_range(20.0, 44.0)
		var h := 12.0 + r.randf() * r.randf() * 58.0
		_tower(k, g, x, z, w, d, h, r, r.randf() * r.randf())
		if r.randf() < 0.16:
			emitters.append({"pos": Vector3(x, float(Buildings.last["top"]) + 2.0, z), "kind": "fire", "t": 0.0})

	# arcology blocks: buildings on a scale far beyond the town around them
	var ag := k.bone(self)
	for ar in MEGA_PLOTS:
		_megablock(k, ag, ar[0], ar[1], ar[2], ar[3], ar[4], r)
	# the assembly hall behind the left flank, door toward the gun line
	Buildings.megahall(k, k.bone(self), _add_box, HALL_POS.x, HALL_POS.y, HALL_SIZE.x, HALL_SIZE.z, HALL_SIZE.y, 7.0, PI, r)
	# skyline: platform cities on pylons far beyond the battlefield, silhouettes only
	var sg := k.bone(self)
	for sf in [[-1500.0, -2300.0, 1200.0, 560.0], [1900.0, -1700.0, 900.0, 440.0], [300.0, -3000.0, 1500.0, 640.0], [-2600.0, -700.0, 800.0, 400.0]]:
		Buildings.skyframe(k, sg, sf[0], sf[1], sf[2], sf[3], height(sf[0], sf[1]) - 30.0, r)

	# wrecks and burning hulks across the plain
	var wg := k.bone(self)
	for i in 16:
		var x := r.randf_range(-700.0, 700.0)
		var z := r.randf_range(-360.0, -110.0)
		var ry := r.randf() * TAU
		var y := height(x, z)
		k.box(wg, "RST", Vector3(7, 2.6, 12), Vector3(x, y + 1.3, z), Vector3(0.05, ry, 0.08), {"tx": 0.8, "tz": 0.85})
		k.box(wg, "RST", Vector3(4.4, 2, 5), Vector3(x + 0.6, y + 3.3, z), Vector3(0.1, ry + 0.7, 0.05), {"tx": 0.7, "tz": 0.7})
		k.cyl(wg, "DRK", 0.3, 0.3, 7.0, Vector3(x + 3, y + 3.2, z + 2), Vector3(1.2, ry + 0.7, 0), 8)
		_add_box(x, z, 9, 9, y - 5, y + 4)
		if r.randf() < 0.6:
			emitters.append({"pos": Vector3(x, y + 4, z), "kind": "fire", "t": 0.0})
	var bm := _mats()
	bm.merge(Buildings.mats())
	k.bake(bm)
	for c in sg.get_children():
		if c is MeshInstance3D:
			c.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			c.extra_cull_margin = 200.0


# re-entry streaks high in the northern sky and searchlights on the gun line
func _build_sky_fx() -> void:
	var cm := CylinderMesh.new()
	cm.top_radius = 1.0
	cm.bottom_radius = 0.15
	cm.height = 1.0
	cm.radial_segments = 6
	cm.rings = 1
	cm.cap_top = false
	cm.cap_bottom = false
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/beam.gdshader")
	var rr := RandomNumberGenerator.new()
	rr.seed = 5
	for i in 28:
		var m := MeshInstance3D.new()
		m.mesh = cm
		m.material_override = mat
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		m.extra_cull_margin = 16000.0
		m.set_instance_shader_parameter("tint", Color(1.0, 0.55, 0.25))
		m.set_instance_shader_parameter("soft", 0.0)
		m.set_instance_shader_parameter("power", rr.randf_range(0.5, 1.4))
		add_child(m)
		streaks.append({"m": m, "t": rr.randf(), "sp": rr.randf_range(0.02, 0.06), "x": rr.randf_range(-3600.0, 3600.0), "z": rr.randf_range(-5200.0, -2600.0), "len": rr.randf_range(200.0, 520.0), "w": rr.randf_range(3.0, 7.0)})
	for lp in [Vector2(-300, 210), Vector2(300, 210), Vector2(-60, 340), Vector2(520, 150), Vector2(-520, 150)]:
		lamps.append({"pos": Vector3(lp.x, height(lp.x, lp.y) + 3.0, lp.y), "a": rr.randf() * TAU, "sp": rr.randf_range(0.12, 0.3), "ph": rr.randf() * 6.0})
	# the rest of the invasion: two more landing ships coming down far off in the haze
	var am: ShaderMaterial = Tex.plating
	var glow := StandardMaterial3D.new()
	glow.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	glow.albedo_color = Color(1.0, 0.5, 0.2) * 2.2
	var smats := {"G": {"mat": glow}}
	for key in ["A", "B", "C", "F", "W", "T", "H"]:
		smats[key] = {"mat": am, "params": {"tint": Color(0.2, 0.19, 0.19) if key == "A" else Color(0.1, 0.1, 0.11), "metal": 0.4}}
	for sp in [[Vector3(-2300.0, 1500.0, -2500.0), 0.35, 1.0], [Vector3(2700.0, 1900.0, -3100.0), -0.3, 0.8]]:
		var ship: Node3D = Glb.instance("carrier")
		if ship == null:
			break
		add_child(ship)
		var out: Array = []
		Glb.skin(ship, smats, 1, out)
		for mi in out:
			mi.extra_cull_margin = 600.0
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		ship.position = sp[0]
		ship.rotation.y = sp[1]
		for i in range(1, 5):
			var nz := Glb.find(ship, "noz_engine_%d" % i)
			if nz != null:
				FX.set_plume(FX.plume(nz, 20.0, 110.0, 1), 20.0, 110.0, 0.45)
		far_ships.append({"n": ship, "y0": float(sp[0].y), "sp": float(sp[2])})


func _tick_sky(dt: float, cam_pos: Vector3, fx) -> void:
	_sky_t += dt
	for fs in far_ships:
		var sn: Node3D = fs["n"]
		sn.position.y = maxf(float(fs["y0"]) - _sky_t * 2.4 * float(fs["sp"]), 640.0)
		sn.rotation.z = sin(_sky_t * 0.13 + float(fs["y0"])) * 0.02
	for sdat in streaks:
		var t: float = fposmod(float(sdat["t"]) + float(sdat["sp"]) * dt, 1.0)
		sdat["t"] = t
		var top := Vector3(float(sdat["x"]), 3400.0, float(sdat["z"]))
		var dir := Vector3(0.18, -1.0, 0.42).normalized()
		var head := top + dir * (t * 3300.0)
		var ln: float = sdat["len"]
		var w: float = sdat["w"]
		var m: MeshInstance3D = sdat["m"]
		var y := -dir
		var x := y.cross(Vector3.RIGHT).normalized()
		var z := x.cross(y)
		m.global_transform = Transform3D(Basis(x * w, y * ln, z * w), head - dir * ln * 0.5)
		m.set_instance_shader_parameter("power", (0.4 + 1.2 * sin(t * PI)) * (0.8 + 0.2 * sin(_sky_t * 20.0 + float(sdat["x"]))))
	for lp in lamps:
		var a: float = float(lp["a"]) + sin(_sky_t * float(lp["sp"]) + float(lp["ph"])) * 0.9
		var el := 0.95 + 0.3 * sin(_sky_t * float(lp["sp"]) * 0.7 + float(lp["ph"]) * 2.0)
		var d := Vector3(cos(a) * cos(el), sin(el), -absf(sin(a) * cos(el)) - 0.2).normalized()
		var p: Vector3 = lp["pos"]
		fx.beam(p, p + d * 900.0, 9.0, Color(0.75, 0.82, 1.0), 1.0, 0.1)
	# anti-air "tracks": a battery walks a string of bursts up into the sky, each one
	# opening as a full disc and waning to a crescent
	_line_t -= dt
	if _line_t <= 0.0:
		_line_t = randf_range(0.5, 1.3)
		var o := Vector3(cam_pos.x + randf_range(-900.0, 900.0), randf_range(90.0, 220.0), cam_pos.z - randf_range(350.0, 1300.0))
		var d := Vector3(randf_range(-0.7, 0.7), randf_range(0.35, 0.9), randf_range(-0.6, 0.1)).normalized()
		flak_lines.append({"p": o, "d": d, "n": randi_range(4, 8), "t": 0.0, "gap": randf_range(0.1, 0.2), "step": randf_range(30.0, 55.0), "bend": randf_range(-0.12, 0.12), "s": randf_range(10.0, 18.0)})
	var li := 0
	while li < flak_lines.size():
		var fl: Dictionary = flak_lines[li]
		fl["t"] = float(fl["t"]) - dt
		if float(fl["t"]) <= 0.0:
			fl["t"] = fl["gap"]
			var fd: Vector3 = fl["d"]
			fx.moon(fl["p"], float(fl["s"]) * randf_range(0.8, 1.2), randf_range(1.7, 2.8), Color(1.0, 0.3, 0.6), Vector3(0, -1.5, 0))
			fl["p"] = fl["p"] + fd * float(fl["step"])
			fl["d"] = (fd + Vector3(float(fl["bend"]), -0.05, 0.0)).normalized()
			fl["n"] = int(fl["n"]) - 1
		if int(fl["n"]) <= 0:
			flak_lines.remove_at(li)
		else:
			li += 1
	_flak_t -= dt
	if _flak_t <= 0.0:
		_flak_t = randf_range(0.15, 0.5)
		var fp := Vector3(cam_pos.x + randf_range(-700.0, 700.0), randf_range(170.0, 480.0), cam_pos.z - randf_range(250.0, 1100.0))
		fx.flak(fp, randf_range(1.0, 2.2))
