extends Node3D
# First-person cockpit built around a linear seat: the pilot sits in an armchair-like seat
# unit in the middle of an all-round monitor. In front, low: a ring instrument panel with a
# round central display and two side displays; at the feet two pedals; on arm pedestals two
# ball-type control sticks with buttons; side consoles by the hips; one canopy strut carrying
# a small monitor and a round gauge. The whole unit follows the frame's aim, so a free look
# turns the pilot's head inside it (the seat back is there when looking behind).
# Damage: an instant jolt, sparks and lamp flash on every hit; smoke, intermittent sparks and
# red lamps while the frame is badly hurt (dead monitor panels and cracks: post.gdshader).

const UI = preload("res://scripts/cockpit_ui.gd")
const Tex = preload("res://scripts/tex.gd")
const U = preload("res://scripts/u.gd")

const LAYER := 1 << 18
const MODEL := "res://models/cockpit.glb"
const KEY_E := 0.3           # overhead bar: a fill now, the shadow-casting key carries the cabin
const FILL_E := 0.12         # glow of the instruments (their faces light the cabin as area lights)
const ENV_LAYER := 1 << 17   # the surround that only the cabin's reflection probe sees
const KEY_AIM := Vector3(0.0, -0.45, -0.4)     # middle of the furniture
const KEY_DIST := 2.6
const KEY_SUN := 1.9         # the outside light as the monitor wall throws it in

var stick_l: Node3D
var stick_r: Node3D
var trig_r: MeshInstance3D
var pedal_l: Node3D
var pedal_r: Node3D
var sweep: Node3D
var btn_mats: Array = []
var lamp_mat: StandardMaterial3D
var screens: Array = []
var sparks: CPUParticles3D
var smoke: CPUParticles3D
var spray: CPUParticles3D     # a long fan of fine sparks from a broken fitting overhead
var beacon: SpotLight3D       # the red warning beacon that turns overhead while the frame is in danger
var alarm_k := 0.0
var lamp: OmniLight3D
var jolt := Vector3.ZERO
var hit_t := 0.0
var t := 0.0
var spark_t := 0.0
var _mats := {}
# ---- modelled cockpit (models/cockpit.glb)
var from_glb := false
var n := {}                  # named nodes
var rest := {}               # their rest transforms
var ui: Control
var vp: SubViewport
var scr_mats: Array = []
var lamp_mats: Array = []
var fill: OmniLight3D
var key: SpotLight3D          # the outside light: stands where the sun stands on the monitor wall, and casts shadows
var key_col := Color(1.0, 0.95, 0.86)
var key_gain := 1.0
var face_lights: Array = []   # [AreaLight3D, energy]: the lit faces of the instruments
var spec_lights: Array = []   # the highlight sources
var key_fix := Vector3.ZERO   # test: hold the key light in this direction (cabin space)
var solo := false             # test: the key light alone
var no_shadow := false        # test
var sway := Vector3.ZERO
var _vel := Vector3.ZERO
var _acc := Vector3.ZERO
var scope_k := 0.0
var _scope_want := false
var needle := {}
var scope_vp: SubViewport
var scope_cam: Camera3D
var scope_mat: ShaderMaterial
var wall: MeshInstance3D      # monitor-wall damage pass, on the camera
var wall_mat: ShaderMaterial
var _step_t := 0.0


# lit structure material
func _mat(col: Color) -> StandardMaterial3D:
	var key := col.to_html()
	if _mats.has(key):
		return _mats[key]
	var m := StandardMaterial3D.new()
	m.albedo_color = col
	m.metallic = 0.35
	m.roughness = 0.55
	_mats[key] = m
	return m


# self-lit material (screens, lamps, buttons); unique = it will be animated on its own
func _glow(col: Color, unique: bool = false) -> StandardMaterial3D:
	var key := "g" + col.to_html()
	if not unique and _mats.has(key):
		return _mats[key]
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = col
	if not unique:
		_mats[key] = m
	return m


func _add(parent: Node3D, mesh: Mesh, pos: Vector3, mat: Material, rot: Vector3 = Vector3.ZERO) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.position = pos
	mi.rotation = rot
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.layers = LAYER
	parent.add_child(mi)
	return mi


func _box(parent: Node3D, size: Vector3, pos: Vector3, mat: Material, rot: Vector3 = Vector3.ZERO) -> MeshInstance3D:
	var bm := BoxMesh.new()
	bm.size = size
	return _add(parent, bm, pos, mat, rot)


func _cyl(parent: Node3D, r: float, h: float, pos: Vector3, mat: Material, rot: Vector3 = Vector3.ZERO, r_top: float = -1.0, seg: int = 16) -> MeshInstance3D:
	var cm := CylinderMesh.new()
	cm.top_radius = r if r_top < 0.0 else r_top
	cm.bottom_radius = r
	cm.height = h
	cm.radial_segments = seg
	return _add(parent, cm, pos, mat, rot)


func _node(parent: Node3D, pos: Vector3, rot: Vector3 = Vector3.ZERO) -> Node3D:
	var n := Node3D.new()
	n.position = pos
	n.rotation = rot
	parent.add_child(n)
	return n


func _button(parent: Node3D, size: Vector3, pos: Vector3, col: Color) -> void:
	var m := _glow(col * 0.5, true)
	_box(parent, size, pos, m)
	btn_mats.append({"m": m, "c": col, "ph": randf() * 9.0})


func _screen(parent: Node3D, mesh_r: float, pos: Vector3, col: Color, squash: float = 1.0) -> Node3D:
	var m := _glow(col * 0.25, true)
	var s := _cyl(parent, mesh_r, 0.012, pos, m, Vector3.ZERO, -1.0, 24)
	s.scale = Vector3(1.0, 1.0, squash)
	screens.append({"m": m, "c": col})
	return s


func build() -> void:
	if ResourceLoader.exists(MODEL):
		_build_glb()
	else:
		_build_proc()
	_build_fx()
	if from_glb:
		# human-scale cabin: the effects sit on the instrument cluster and the right console
		sparks.position = Vector3(0, -0.5, -0.7)
		sparks.initial_velocity_min = 0.6
		sparks.initial_velocity_max = 1.8
		sparks.gravity = Vector3(0, -3.5, 0)
		(sparks.mesh as BoxMesh).size = Vector3(0.004, 0.004, 0.025)
		smoke.position = Vector3(0.42, -0.62, -0.62)
		smoke.initial_velocity_min = 0.1
		smoke.initial_velocity_max = 0.25
		(smoke.mesh as QuadMesh).size = Vector2(0.22, 0.22)


# the monitor wall's damage pass: a full-screen quad on the camera (shaders/pit_wall.gdshader)
func make_wall(cam: Camera3D) -> void:
	if wall != null:
		return
	wall = MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(2, 2)
	wall_mat = ShaderMaterial.new()
	wall_mat.shader = load("res://shaders/pit_wall.gdshader")
	wall_mat.render_priority = 4
	q.material = wall_mat
	wall.mesh = q
	wall.extra_cull_margin = 16000.0
	wall.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	wall.layers = LAYER
	wall.position = Vector3(0, 0, -2.0)
	cam.add_child(wall)


func _exit_tree() -> void:
	if wall != null and is_instance_valid(wall):
		wall.queue_free()


# offset of the whole unit from the eye: hit jolt plus the lag behind the frame's acceleration
func offset() -> Vector3:
	return jolt * (0.07 if from_glb else 0.35) + sway


func _find(root: Node, nm: String) -> Node3D:
	return root.find_child(nm, true, false) as Node3D


func _screen_mat(rc: Rect2) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_texture = vp.get_texture()
	m.uv1_scale = Vector3(rc.size.x / UI.ATLAS.x, rc.size.y / UI.ATLAS.y, 1.0)
	m.uv1_offset = Vector3(rc.position.x / UI.ATLAS.x, rc.position.y / UI.ATLAS.y, 0.0)
	m.albedo_color = Color(1.5, 1.5, 1.5)
	scr_mats.append(m)
	return m


func _build_glb() -> void:
	from_glb = true
	var root := (load(MODEL) as PackedScene).instantiate() as Node3D
	add_child(root)
	for c in root.find_children("*", "MeshInstance3D", true, false):
		var mi: MeshInstance3D = c
		mi.layers = LAYER
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON      # only the cabin's own key light sees them
	_tune_materials(root)
	_brush_metals(root)
	for nm in ["stick_L", "stick_R", "trigger_R", "pedal_L", "pedal_R", "throttle", "seat", "scope_arm", "scope_fore", "scope_head",
			"scope_arm_dep", "scope_fore_dep", "scope_head_dep", "needle_speed", "needle_thrust", "needle_heat", "needle_ap", "needle_alt", "needle_aux"]:
		var nd := _find(root, nm)
		if nd != null:
			n[nm] = nd
			rest[nm] = nd.transform
	# live instrument faces
	vp = SubViewport.new()
	vp.size = Vector2i(UI.ATLAS)
	vp.disable_3d = true
	vp.transparent_bg = false
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(vp)
	ui = UI.new()
	ui.size = UI.ATLAS
	vp.add_child(ui)
	var faces := {"scr_radar": UI.R_RADAR, "scr_status": UI.R_STATUS, "scr_scope": UI.R_SCOPE,
		"scr_touch_L": UI.R_TOUCH_L, "scr_touch_R": UI.R_TOUCH_R}
	for i in 4:
		faces["scr_warn_%d" % (i + 1)] = UI.warn_rect(i)
	for nm in faces:
		var sn := _find(root, nm)
		if sn is MeshInstance3D:
			(sn as MeshInstance3D).material_override = _screen_mat(faces[nm])
	_build_scope(root)
	for i in range(1, 11):
		var ln := _find(root, "lamp_%d" % i)
		var lm := StandardMaterial3D.new()
		lm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		lm.albedo_color = Color(0.05, 0.05, 0.05)
		if ln is MeshInstance3D:
			(ln as MeshInstance3D).material_override = lm
		lamp_mats.append(lm)
	# the cabin sits inside the chest: no direct sun, only its own lamps and the monitor wall
	for dl in get_tree().root.find_children("*", "DirectionalLight3D", true, false):
		(dl as DirectionalLight3D).light_cull_mask &= ~LAYER
		(dl as DirectionalLight3D).shadow_caster_mask &= ~LAYER
	_build_key()
	_build_face_lights(root)
	_build_surround()
	# cabin lights: a cool key from the overhead bar, a dim warm fill from the instruments
	lamp = OmniLight3D.new()
	lamp.position = Vector3(0, 0.46, -0.36)
	lamp.omni_range = 3.0
	lamp.omni_attenuation = 1.2
	lamp.light_energy = KEY_E
	lamp.light_color = Color(0.8, 0.88, 1.0)
	lamp.light_specular = 0.7
	lamp.shadow_enabled = false
	lamp.light_cull_mask = LAYER
	add_child(lamp)
	fill = OmniLight3D.new()
	fill.position = Vector3(0, -0.25, -0.55)
	fill.omni_range = 1.6
	fill.omni_attenuation = 1.4
	fill.light_energy = FILL_E
	# Highlights are what makes metal read as metal. Two sources at the header's light strips throw
	# streaks down the tubes and the sticks. They cast no shadow, so they stay weak: anything stronger
	# floods the floor plates and flattens the cabin. The long reflections come from the surround.
	for sx in [-1.0, 1.0]:
		var sl := OmniLight3D.new()
		sl.position = Vector3(sx * 0.22, 0.66, -0.93)
		sl.omni_range = 2.8
		sl.omni_attenuation = 1.0
		sl.light_color = Color(1.0, 0.94, 0.82)
		sl.light_energy = 0.12
		sl.light_specular = 1.6
		sl.shadow_enabled = false
		sl.light_cull_mask = LAYER
		add_child(sl)
		spec_lights.append(sl)
	# The cabin is inside the chest: its metal must mirror the cabin, not the open sky outside (which
	# turned every steel part sky-blue). A probe that sees only the cabin's own layer, on a dark ground.
	var rp := ReflectionProbe.new()
	rp.size = Vector3(5.0, 6.0, 6.0)          # well beyond the floor and the header: its hold fades toward the box's faces
	rp.blend_distance = 0.2
	rp.interior = true
	rp.ambient_mode = ReflectionProbe.AMBIENT_COLOR
	rp.ambient_color = Color(0.16, 0.17, 0.19)
	rp.ambient_color_energy = 1.0
	rp.cull_mask = LAYER | ENV_LAYER
	rp.reflection_mask = LAYER
	rp.update_mode = ReflectionProbe.UPDATE_ONCE
	rp.enable_shadows = false
	add_child(rp)
	fill.light_color = Color(0.6, 1.0, 0.7)
	fill.shadow_enabled = false
	fill.light_cull_mask = LAYER
	add_child(fill)


# The monitor wall shows the outside, so the outside lights the cabin: one shadow-casting light that stands
# where the sun stands on the wall (drive() turns it as the frame turns). It sits just outside the
# furniture, inside the chest, and only the cabin's own parts throw shadows in it.
func _build_key() -> void:
	key = SpotLight3D.new()
	key.spot_range = 7.0
	key.spot_attenuation = 0.15
	key.spot_angle = 42.0
	key.spot_angle_attenuation = 0.5
	key.light_size = 0.1
	key.light_specular = 1.0
	key.shadow_enabled = true
	key.shadow_bias = 0.02
	key.shadow_normal_bias = 0.8
	key.shadow_blur = 1.4
	key.light_cull_mask = LAYER
	key.shadow_caster_mask = LAYER
	add_child(key)
	_aim_key(Vector3(-0.45, 0.7, -0.55))
	var w = get_parent().get("world") if get_parent() != null else null
	if w != null:
		var sun = w.get("sun")
		if sun is DirectionalLight3D:
			key_col = (sun as DirectionalLight3D).light_color
			key_gain = clampf((sun as DirectionalLight3D).light_energy / 3.0, 0.5, 1.2)
		if w.get("space") == true:
			key.light_size = 0.03                # hard light, no air
			key_gain *= 0.75                     # and nothing scatters it: bare steel would burn out
	key.light_color = key_col
	key.light_energy = KEY_SUN * key_gain
	var v := get_viewport()
	if v != null:
		v.positional_shadow_atlas_size = 4096
		v.set_positional_shadow_atlas_quadrant_subdiv(0, Viewport.SHADOW_ATLAS_QUADRANT_SUBDIV_1)
	RenderingServer.positional_soft_shadow_filter_set_quality(RenderingServer.SHADOW_QUALITY_SOFT_HIGH)


# d: where the light comes from, in the cabin's own space
func _aim_key(d: Vector3) -> void:
	# The wall is brightest overhead whatever the hour, so the light always falls steeply: what the pilot
	# looks at (floor, arm rests, the tops of the consoles) is lit and throws its shadow downward; the sun
	# decides only which way the shadows lean.
	d.y = maxf(d.y, 1.5 * Vector2(d.x, d.z).length())
	d = d.normalized()
	var up := Vector3.UP if absf(d.y) < 0.95 else Vector3.FORWARD
	key.transform = Transform3D(Basis.looking_at(-d, up), KEY_AIM + d * KEY_DIST)


# Every lit face is a rectangle of light: the two touch screens, the radar, the bank of dials. Area lights
# of the faces' own size and colour, so the sticks and the bezels beside them catch that colour and the
# polished parts mirror a rectangle rather than a point.
func _build_face_lights(root: Node) -> void:
	for e in [["scr_touch_L", Color(0.45, 0.85, 1.0), 0.9, 1.3, Vector2.ZERO],
			["scr_touch_R", Color(0.45, 0.85, 1.0), 0.9, 1.3, Vector2.ZERO],
			["scr_radar", Color(0.3, 1.0, 0.8), 0.5, 0.9, Vector2.ZERO],
			["scr_radar", Color(1.0, 0.5, 0.16), 0.9, 1.1, Vector2(0.56, 0.24)]]:
		var mi := _find(root, e[0]) as MeshInstance3D
		if mi == null:
			continue
		var ab: AABB = mi.get_aabb()
		var xf: Transform3D = global_transform.affine_inverse() * mi.global_transform
		var ax := ab.get_shortest_axis_index()
		var nrm: Vector3 = (xf.basis * ([Vector3.RIGHT, Vector3.UP, Vector3.BACK][ax] as Vector3)).normalized()
		var c: Vector3 = xf * ab.get_center()
		if nrm.dot(-c) < 0.0:
			nrm = -nrm                           # the lit side is the one that faces the seat
		var sz: Vector2 = e[4]
		if sz == Vector2.ZERO:
			var d: Array[float] = [ab.size.x, ab.size.y, ab.size.z]
			d.remove_at(ax)
			var sc: float = xf.basis.get_scale().x
			sz = Vector2(maxf(d[0], d[1]), minf(d[0], d[1])) * sc
		var al := AreaLight3D.new()
		al.area_size = sz
		al.area_range = e[3]
		al.area_attenuation = 1.2
		al.light_color = e[1]
		al.light_energy = e[2]
		al.light_specular = 1.0
		al.shadow_enabled = false
		al.light_cull_mask = LAYER
		var up := Vector3.UP if absf(nrm.y) < 0.95 else Vector3.FORWARD
		al.transform = Transform3D(Basis.looking_at(nrm, up), c + nrm * 0.02)
		add_child(al)
		face_lights.append([al, e[2]])
		print("[pit] face light ", e[0], " at ", c, " n ", nrm, " size ", sz)


# What polished metal shows is its surroundings. The cabin's own parts are dark, so chrome that mirrors
# only them is dark too, with a few points of light on it. Round the cabin goes the monitor wall: bright
# sky above, a brighter band at the horizon, dull ground below, cut by the wall's own joints, and the
# two light bars overhead. That surround is drawn for the reflection probe alone (its own layer, which
# no camera renders), so tubes and sticks get the long graded reflections that make them read as metal.
func _build_surround() -> void:
	var sm := SphereMesh.new()
	sm.radius = 2.4
	sm.height = 4.8
	sm.radial_segments = 32
	sm.rings = 16
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/pit_surround.gdshader")
	var w = get_parent().get("world") if get_parent() != null else null
	if w != null and w.get("space") == true:
		mat.set_shader_parameter("top", Color(0.03, 0.04, 0.06))
		mat.set_shader_parameter("horizon", Color(0.06, 0.07, 0.1))
		mat.set_shader_parameter("ground", Color(0.02, 0.02, 0.03))
		mat.set_shader_parameter("sun_col", Color(1.0, 0.97, 0.9))
	elif w != null and w.get("dusk") == true:
		mat.set_shader_parameter("top", Color(0.1, 0.12, 0.2))
		mat.set_shader_parameter("horizon", Color(0.5, 0.3, 0.18))
		mat.set_shader_parameter("ground", Color(0.07, 0.05, 0.04))
		mat.set_shader_parameter("sun_col", Color(1.0, 0.7, 0.42))
	sm.material = mat
	var mi := MeshInstance3D.new()
	mi.mesh = sm
	mi.layers = ENV_LAYER
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.position = Vector3(0, -0.2, -0.2)
	add_child(mi)


# The sight on its arm is a working instrument: a narrow camera looks down the aim line and its
# picture, with the reticle drawn over it, is what the little screen shows while it is deployed.
func _build_scope(root: Node) -> void:
	var face := _find(root, "scr_scope") as MeshInstance3D
	if face == null:
		return
	scope_vp = SubViewport.new()
	scope_vp.size = Vector2i(288, 288)
	scope_vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
	scope_vp.positional_shadow_atlas_size = 0
	add_child(scope_vp)
	scope_cam = Camera3D.new()
	scope_cam.fov = 7.0
	scope_cam.near = 3.0
	scope_cam.far = 6000.0
	scope_cam.cull_mask = 0xFFFFF & ~LAYER & ~(1 << 19) & ~ENV_LAYER
	scope_vp.add_child(scope_cam)
	var sh := Shader.new()
	sh.code = """shader_type spatial;
render_mode unshaded;
uniform sampler2D feed : source_color, filter_linear;
uniform sampler2D atlas : source_color, filter_linear;
uniform vec4 rect;
uniform float bright = 1.0;
uniform float live = 0.0;
void fragment() {
	vec3 f = texture(feed, UV).rgb;
	float l = dot(f, vec3(0.3, 0.6, 0.1));
	// a monochrome-leaning monitor picture with visible scan lines
	vec3 pic = mix(vec3(l), f, 0.45) * vec3(0.78, 1.05, 0.82) * 0.9;
	pic *= 0.86 + 0.14 * sin(UV.y * 288.0 * 3.14159);
	vec3 ui = texture(atlas, rect.xy + UV * rect.zw).rgb;
	float vig = smoothstep(0.74, 0.3, length(UV - 0.5));
	ALBEDO = (pic * live * vig + ui) * bright;
}
"""
	scope_mat = ShaderMaterial.new()
	scope_mat.shader = sh
	scope_mat.set_shader_parameter("feed", scope_vp.get_texture())
	scope_mat.set_shader_parameter("atlas", vp.get_texture())
	var rc: Rect2 = UI.R_SCOPE
	scope_mat.set_shader_parameter("rect", Vector4(rc.position.x / UI.ATLAS.x, rc.position.y / UI.ATLAS.y, rc.size.x / UI.ATLAS.x, rc.size.y / UI.ATLAS.y))
	face.material_override = scope_mat


# The model carries plain PBR colours; give each family its surface character:
# lacquer a clear coat, leather and rubber a photographed grain, brushed metal its direction.
func _tune_materials(root: Node) -> void:
	var seen := {}
	for c in root.find_children("*", "MeshInstance3D", true, false):
		var mesh: Mesh = (c as MeshInstance3D).mesh
		if mesh == null:
			continue
		for si in mesh.get_surface_count():
			var m := mesh.surface_get_material(si) as BaseMaterial3D
			if m == null or seen.has(m):
				continue
			seen[m] = true
			var nm := m.resource_name.to_lower()
			# Baked occlusion (tools/blender/cockpit/ck_ao.py) is in the vertex colours of every part. On metal
			# the albedo is the reflectance, so this darkens what a hidden corner mirrors as well as what it
			# scatters: the probe alone would show the sky under the instrument cluster.
			m.vertex_color_use_as_albedo = true
			m.vertex_color_is_srgb = false
			if m.emission_enabled:
				# self-lit faces read as lit print, not as lamps
				m.emission_energy_multiplier = 0.55 if nm.contains("legend") else (0.1 if nm.contains("dial") else 0.5)
				if nm.contains("legend"):
					m.albedo_color = m.albedo_color * 0.35
			if nm.contains("weld"):
				# weld beads: heat-blued, rough
				m.metallic = 1.0
				_surface(m, "metal038", 0.08, 1.0, 0.5, 0.6)
			elif nm.contains("fabric"):
				_grain(m, "rubber_tiles", 0.05, 0.9)
				m.roughness = 0.95
			elif nm.contains("dial_dark"):
				# black instrument faces: the lamp behind them shows as a low amber wash, the markings carry the light
				m.albedo_color = Color(0.03, 0.032, 0.036)
				m.emission_enabled = true
				m.emission = Color(1.0, 0.45, 0.1)
				m.emission_energy_multiplier = 0.09
				m.roughness = 0.75                     # matt: a glossy black face turns white under the key light
				m.metallic_specular = 0.2
			elif nm.contains("dial"):
				# instrument faces lit amber from behind
				m.albedo_color = Color(0.85, 0.42, 0.12)
				m.emission_enabled = true
				m.emission = Color(1.0, 0.42, 0.08)
				m.emission_energy_multiplier = 0.85
			elif nm.contains("decal"):
				# printed matter: dial faces, legends, placards. Lit from behind a little, like instrument
				# lighting, so the panels read in a dark cabin and in space.
				var lt := _label_tex()
				if lt != null:
					m.albedo_color = Color(0.8, 0.8, 0.78)
					m.albedo_texture = lt
					m.emission_enabled = true
					m.emission_texture = lt
					m.emission = Color(1.0, 0.92, 0.78)
					m.emission_energy_multiplier = 0.07
					m.roughness = 0.7
					m.metallic = 0.0
					m.metallic_specular = 0.15          # print, not gloss: the highlight lights must not wash it out
					m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
			elif nm.contains("gel"):
				# the translucent rim behind a housing: glows from within
				m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
				m.albedo_color = Color(0.3, 0.9, 0.86, 0.15)
				m.emission_enabled = true
				m.emission = Color(0.15, 0.95, 0.85)
				m.emission_energy_multiplier = 0.2
				m.roughness = 0.08
				m.rim_enabled = true
				m.rim = 0.5
				m.cull_mode = BaseMaterial3D.CULL_DISABLED
				# cast resin: what is behind it shows through bent, the surface is glass-smooth
				m.refraction_enabled = true
				m.refraction_scale = 0.07
				m.clearcoat_enabled = true
				m.clearcoat = 1.0
				m.clearcoat_roughness = 0.04
				m.metallic_specular = 0.9
				_grain(m, "metal012", 0.5, 0.45)
			elif nm.contains("strip_light"):
				m.emission_enabled = true
				m.emission = Color(1.0, 0.94, 0.82)
				m.emission_energy_multiplier = 2.4
			elif nm.contains("shell"):
				# rounded housings: glossy cream enamel, rubbed at the edges
				m.clearcoat_enabled = true
				m.clearcoat = 0.15
				m.clearcoat_roughness = 0.35
				_surface(m, "rusty_painted_metal", 0.55, 0.2, 0.2, 0.6)
				# off-white enamel, not paper white: under the key light a lighter coat burns out
				m.albedo_color = Color(0.52, 0.5, 0.44)
			elif nm.contains("tread"):
				# floor plates: raised tread pattern, worn bright where boots land
				m.metallic = 1.0
				_surface(m, "metal_plate", 0.3, 1.2, 0.7, 1.0)
				m.albedo_color = m.albedo_color * 0.6
			elif nm.contains("struct"):
				# the frame the seat stands in: heavy painted steel, chipped
				# bare scratched plate, dark: structure is steel, not painted plastic
				m.metallic = 0.92
				_surface(m, "metal038", 0.5, 0.8, 0.55, 0.78)
				m.albedo_color = Color(0.19, 0.19, 0.2) * (255.0 / 200.0)          # neutral steel, not blue paint
			elif nm.contains("leather") or nm.contains("cushion") or nm.contains("pad"):
				_grain(m, "leather_white", 0.3, 1.3)
				m.albedo_color = Color(0.30, 0.125, 0.07)
				m.roughness = 0.42
				m.metallic_specular = 0.35
			elif nm.contains("rubber") or nm.contains("grip"):
				_grain(m, "rubberized_track", 0.12, 0.8)
				m.roughness = 0.85
			elif nm.contains("lacquer") or nm.contains("gloss"):
				# lacquer over metal: the clear coat stays smooth, the metal under it is not
				m.clearcoat_enabled = true
				m.clearcoat = 0.0
				# dark anodised metal with a fine brushed grain
				m.metallic = 0.9
				_surface(m, "metal009", 0.22, 0.5, 0.35, 0.5)
				m.albedo_color = Color(0.085, 0.09, 0.10) * (255.0 / 200.0)
			elif nm.contains("chrome"):
				m.metallic = 1.0
				m.metallic_specular = 0.8
				_surface(m, "metal009", 0.25, 0.2, 0.15, 0.24)
			elif nm.contains("brush") or nm.contains("frame") or nm.contains("steel"):
				# bare steel: handled, scuffed, never one even sheen
				m.metallic = 1.0
				# brushed steel: the grain runs one way and the highlight stretches across it
				_surface(m, "metal009", 0.2, 0.9, 0.35, 0.42)
				m.albedo_color = m.albedo_color * 0.9
				m.anisotropy_enabled = true
				m.anisotropy = 0.75
			elif nm.contains("paint"):
				# painted plate: chipped and rubbed where hands and boots go
				m.vertex_color_use_as_albedo = true
				m.metallic = 0.35
				_surface(m, "green_metal_rust", 0.4, 0.5, 0.4, 0.95)
			elif nm.contains("panel") or nm.contains("satin") or nm.contains("plastic"):
				# console shells: powder-coated metal rather than moulded plastic
				if nm.contains("bluegrey"):
					# painted instrument faces
					m.metallic = 0.3
					_surface(m, "rusty_painted_metal", 0.3, 0.35, 0.3, 0.85)
				else:
					# console and screen shells: dark scratched metal
					m.metallic = 0.9
					_surface(m, "metal038", 0.35, 0.7, 0.5, 0.7)
					m.albedo_color = m.albedo_color * 2.6


# Brushed and polished metal get the cabin's own metal shader (shaders/brushed.gdshader): grain and
# highlight run along each tube and stick. One material per kind, put on every surface of that kind.
const BRUSHED := {
	"chrome": [Color(0.72, 0.73, 0.75), 0.2, 0.55, 0.25],
	"frame": [Color(0.40, 0.41, 0.43), 0.46, 0.85, 0.6],
	"brush": [Color(0.40, 0.41, 0.43), 0.46, 0.85, 0.6],
	"lacquer": [Color(0.065, 0.07, 0.08), 0.5, 0.7, 0.45],
}


func _brush_metals(root: Node) -> void:
	var made := {}
	for c in root.find_children("*", "MeshInstance3D", true, false):
		var mesh: Mesh = (c as MeshInstance3D).mesh
		if mesh == null:
			continue
		for si in mesh.get_surface_count():
			var m := mesh.surface_get_material(si)
			if m == null or not (m is BaseMaterial3D):
				continue
			var nm := m.resource_name.to_lower()
			for key in BRUSHED:
				if nm.contains(key):
					if not made.has(key):
						var sm := ShaderMaterial.new()
						sm.shader = load("res://shaders/brushed.gdshader")
						sm.resource_name = nm
						var v: Array = BRUSHED[key]
						sm.set_shader_parameter("tint", v[0])
						sm.set_shader_parameter("rough", v[1])
						sm.set_shader_parameter("aniso", v[2])
						sm.set_shader_parameter("grain", v[3])
						made[key] = sm
					mesh.surface_set_material(si, made[key])
					break


# the printed-matter atlas drawn by tools/blender/cockpit/ck_labels.py
func _label_tex() -> Texture2D:
	if Tex.sets.has("_labels"):
		return Tex.sets["_labels"]
	var img := Image.load_from_file(ProjectSettings.globalize_path("res://textures/cockpit_labels.png"))
	if img == null:
		return null
	img.generate_mipmaps()
	var t := ImageTexture.create_from_image(img)
	Tex.sets["_labels"] = t
	return t


# A full photographed surface on a plain-coloured material, triplanar: the set's normal map
# (depth), its roughness map (rough = the material's roughness the map is scaled by) and its
# light-and-dark as a wear pattern over the material's own colour (wear 0..1). The colour itself
# stays the model's: only the brightness pattern of the photograph is used.
func _surface(m: BaseMaterial3D, set_id: String, tile: float, depth: float, wear: float, rough: float) -> void:
	_grain(m, set_id, tile, depth)
	var st: Dictionary = Tex.sets.get(set_id, {})
	if st.is_empty():
		return
	m.roughness = rough
	m.roughness_texture = st["nr"]
	m.roughness_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_BLUE
	var key := "lum%d" % int(round(wear * 100.0))
	if not st.has(key):
		var img: Image = (st["alb"] as Texture2D).get_image()
		img.clear_mipmaps()
		img.resize(512, 512, Image.INTERPOLATE_BILINEAR)
		img.convert(Image.FORMAT_L8)
		var data := img.get_data()
		var sum := 0
		for v in data:
			sum += v
		var mean := maxf(1.0, float(sum) / float(data.size()))
		for i in data.size():
			data[i] = int(clampf(lerpf(1.0, float(data[i]) / mean, wear) * 200.0, 0.0, 255.0))
		var li := Image.create_from_data(512, 512, false, Image.FORMAT_L8, data)
		li.generate_mipmaps()
		st[key] = ImageTexture.create_from_image(li)
	m.albedo_texture = st[key]
	# the pattern is centred on 200/255, so the colour is lifted back to where it was
	m.albedo_color = m.albedo_color * (255.0 / 200.0)


# triplanar normal + roughness detail from one of the photographed sets
func _grain(m: BaseMaterial3D, set_id: String, tile: float, depth: float) -> void:
	var st: Dictionary = Tex.sets.get(set_id, {})
	if st.is_empty():
		st = Tex._load_set(set_id)
		Tex.sets[set_id] = st
	if st.is_empty():
		return
	if not st.has("nrm"):
		# the packed file keeps roughness in blue; a normal map wants blue = up
		var img: Image = (st["nr"] as Texture2D).get_image()
		img.clear_mipmaps()
		img.convert(Image.FORMAT_RGB8)
		var data := img.get_data()
		for i in range(2, data.size(), 3):
			data[i] = 255
		var ni := Image.create_from_data(img.get_width(), img.get_height(), false, Image.FORMAT_RGB8, data)
		ni.generate_mipmaps()
		st["nrm"] = ImageTexture.create_from_image(ni)
	m.normal_enabled = true
	m.normal_texture = st["nrm"]
	m.normal_scale = depth
	m.uv1_triplanar = true
	m.uv1_world_triplanar = false
	m.uv1_scale = Vector3.ONE / tile


func _build_proc() -> void:
	var hull := _mat(Color(0.2, 0.22, 0.25))      # seat unit shell (grey-blue)
	var hull2 := _mat(Color(0.13, 0.145, 0.17))
	var dark := _mat(Color(0.05, 0.055, 0.06))
	var pad := _mat(Color(0.3, 0.2, 0.1))         # seat cushions
	var steel := _mat(Color(0.42, 0.44, 0.46))
	var red := Color(0.95, 0.2, 0.15)
	var amber := Color(1.0, 0.72, 0.2)
	var green := Color(0.3, 1.0, 0.55)
	var cyan := Color(0.3, 0.85, 1.0)

	# ---- ring instrument panel, low in front, tilted up at the pilot
	var ip := _node(self, Vector3(0, -0.78, -1.3), Vector3(0.95, 0, 0))
	_cyl(ip, 0.46, 0.1, Vector3.ZERO, hull, Vector3.ZERO, -1.0, 28)
	var tor := TorusMesh.new()
	tor.inner_radius = 0.33
	tor.outer_radius = 0.42
	tor.rings = 28
	tor.ring_segments = 8
	_add(ip, tor, Vector3(0, 0.055, 0), hull2)
	_screen(ip, 0.31, Vector3(0, 0.056, 0), cyan)
	# radar: range rings, a turning sweep, the frame in the middle
	for rr in [0.1, 0.2, 0.29]:
		var ring := TorusMesh.new()
		ring.inner_radius = rr - 0.004
		ring.outer_radius = rr + 0.004
		ring.rings = 24
		ring.ring_segments = 4
		_add(ip, ring, Vector3(0, 0.066, 0), _glow(cyan * 0.9))
	sweep = _node(ip, Vector3(0, 0.068, 0))
	_box(sweep, Vector3(0.01, 0.004, 0.29), Vector3(0, 0, -0.145), _glow(cyan * 1.6))
	_box(ip, Vector3(0.03, 0.006, 0.045), Vector3(0, 0.07, 0), _glow(Color(1, 1, 1)))
	# two side displays in their own lobes
	for sd in [-1.0, 1.0]:
		var lobe := _node(ip, Vector3(sd * 0.56, -0.01, 0.12), Vector3(0, -sd * 0.25, 0))
		_cyl(lobe, 0.27, 0.09, Vector3.ZERO, hull, Vector3.ZERO, -1.0, 20).scale = Vector3(1.0, 1.0, 0.8)
		_box(lobe, Vector3(0.3, 0.012, 0.22), Vector3(0, 0.05, 0), dark)
		var col: Color = green if sd < 0.0 else amber
		var m := _glow(col * 0.25, true)
		_box(lobe, Vector3(0.26, 0.012, 0.18), Vector3(0, 0.054, 0), m)
		screens.append({"m": m, "c": col})
		for q in 4:
			_box(lobe, Vector3(0.2 - q * 0.035, 0.014, 0.014), Vector3(-0.02 + q * 0.012, 0.058, -0.06 + q * 0.04), _glow(col))
	# airbag housing under the central display
	_box(ip, Vector3(0.16, 0.07, 0.1), Vector3(0, 0.02, 0.47), hull2)
	_box(ip, Vector3(0.1, 0.012, 0.05), Vector3(0, 0.058, 0.47), _glow(amber * 0.7))
	# panel support down to the floor
	_box(self, Vector3(0.2, 0.9, 0.16), Vector3(0, -1.2, -1.32), hull2, Vector3(-0.3, 0, 0))

	# ---- pedals with studded treads
	for sd in [-1.0, 1.0]:
		var pd := _node(self, Vector3(sd * 0.2, -1.38, -0.92), Vector3(-0.75, 0, 0))
		_box(pd, Vector3(0.24, 0.035, 0.42), Vector3.ZERO, steel)
		for i in 5:
			_cyl(pd, 0.03, 0.02, Vector3(-0.05 + (i % 2) * 0.1, 0.027, -0.14 + i * 0.07), dark, Vector3.ZERO, -1.0, 8)
		if sd < 0.0:
			pedal_l = pd
		else:
			pedal_r = pd
	_cyl(self, 0.07, 0.12, Vector3(0, -1.43, -0.88), hull2, Vector3(0, 0, PI * 0.5))
	_box(self, Vector3(0.9, 0.06, 0.7), Vector3(0, -1.6, -0.75), hull2)

	# ---- ball-type control sticks on arm pedestals that reach forward from the seat
	for sd in [-1.0, 1.0]:
		var arm := _node(self, Vector3(sd * 0.56, -0.78, -0.42))
		_box(arm, Vector3(0.24, 0.16, 0.78), Vector3(0, 0, 0.05), hull)
		_box(arm, Vector3(0.2, 0.2, 0.26), Vector3(0, -0.02, -0.42), hull2, Vector3(0.25, 0, 0))
		_box(arm, Vector3(0.25, 0.03, 0.5), Vector3(0, 0.09, 0.14), pad)
		# socket and ball
		_cyl(arm, 0.13, 0.05, Vector3(0, 0.1, -0.42), dark, Vector3(0.25, 0, 0))
		var piv := _node(arm, Vector3(0, 0.13, -0.43))
		var sm := SphereMesh.new()
		sm.radius = 0.105
		sm.height = 0.21
		sm.radial_segments = 16
		sm.rings = 8
		_add(piv, sm, Vector3.ZERO, steel)
		# grip moulded to the hand, standing on the ball
		var grip := _node(piv, Vector3(0, 0.1, 0.0), Vector3(-0.2, 0, 0))
		_box(grip, Vector3(0.085, 0.2, 0.1), Vector3(0, 0.08, 0), dark)
		_box(grip, Vector3(0.1, 0.05, 0.12), Vector3(0, 0.2, -0.01), hull2)
		_button(grip, Vector3(0.03, 0.02, 0.03), Vector3(-0.025, 0.232, -0.03), red)
		_button(grip, Vector3(0.03, 0.02, 0.03), Vector3(0.025, 0.232, -0.03), amber)
		_cyl(grip, 0.014, 0.035, Vector3(0, 0.24, 0.025), steel, Vector3.ZERO, -1.0, 8)
		_button(grip, Vector3(0.02, 0.03, 0.02), Vector3(-sd * 0.05, 0.13, 0.0), cyan)
		var tr := _box(grip, Vector3(0.03, 0.075, 0.025), Vector3(0, 0.12, -0.062), _glow(Color(0.8, 0.15, 0.1)))
		if sd > 0.0:
			stick_r = piv
			trig_r = tr
		else:
			stick_l = piv

	# ---- side consoles by the hips: keypad blocks, a throttle-like lever, switches
	for sd in [-1.0, 1.0]:
		var sc := _node(self, Vector3(sd * 0.96, -0.86, -0.12), Vector3(0, 0, sd * 0.3))
		_box(sc, Vector3(0.46, 0.2, 1.05), Vector3.ZERO, hull)
		_box(sc, Vector3(0.4, 0.02, 0.44), Vector3(0, 0.105, -0.26), dark)
		_box(sc, Vector3(0.4, 0.02, 0.4), Vector3(0, 0.105, 0.24), dark)
		var cols := [red, amber, green, cyan, Color(0.7, 0.72, 0.75)]
		for i in 12:
			_button(sc, Vector3(0.075, 0.025, 0.075), Vector3(-0.13 + (i % 4) * 0.087, 0.12, -0.4 + int(i / 4.0) * 0.1), cols[(i * 3 + int(sd)) % 5])
		for i in 4:
			_cyl(sc, 0.013, 0.09, Vector3(-0.13 + i * 0.087, 0.15, 0.12), steel, Vector3(0.45 if i % 2 == 0 else -0.45, 0, 0), -1.0, 6)
		_box(sc, Vector3(0.05, 0.16, 0.05), Vector3(sd * 0.1, 0.17, 0.32), dark, Vector3(-0.4, 0, 0))
		_cyl(sc, 0.04, 0.07, Vector3(sd * 0.1, 0.25, 0.29), _glow(amber * 0.6), Vector3(0, 0, PI * 0.5), -1.0, 10)
		var ml := _glow(green, true)
		_box(sc, Vector3(0.14, 0.03, 0.1), Vector3(-sd * 0.1, 0.12, 0.34), ml)
		if lamp_mat == null:
			lamp_mat = ml
		else:
			btn_mats.append({"m": ml, "c": green, "ph": 0.0, "lamp": true})

	# ---- the seat itself, behind the eye point: back, headrest wings, hip bolsters
	_box(self, Vector3(0.74, 1.5, 0.22), Vector3(0, -0.45, 0.42), hull, Vector3(0.12, 0, 0))
	_box(self, Vector3(0.56, 1.2, 0.06), Vector3(0, -0.42, 0.3), pad, Vector3(0.12, 0, 0))
	_box(self, Vector3(0.9, 0.5, 0.3), Vector3(0, 0.45, 0.52), hull2)
	for sd in [-1.0, 1.0]:
		_box(self, Vector3(0.12, 0.36, 0.34), Vector3(sd * 0.3, 0.2, 0.3), hull, Vector3(0, sd * 0.3, 0))
		_box(self, Vector3(0.1, 0.3, 0.7), Vector3(sd * 0.42, -0.95, 0.0), hull2)
	_box(self, Vector3(0.7, 0.14, 0.75), Vector3(0, -1.08, -0.05), pad)
	# the linear rail the seat rides on, and its power cable
	_box(self, Vector3(0.3, 0.3, 1.6), Vector3(0, -1.75, 0.1), hull2)
	for i in 7:
		_cyl(self, 0.045, 0.2, Vector3(0.52 + i * 0.02, -1.3 - i * 0.12, 0.45 + i * 0.05), _mat(Color(0.35, 0.08, 0.06)), Vector3(0.5, 0, 0.2), -1.0, 8)

	# ---- canopy: one main strut right of centre carrying a small monitor and a round gauge,
	# a cross strut, and an overhead light strip
	var post := _node(self, Vector3(0.78, 0.2, -1.75), Vector3(0.1, 0, -0.06))
	_box(post, Vector3(0.09, 4.6, 0.1), Vector3.ZERO, dark)
	_box(post, Vector3(0.05, 1.2, 0.02), Vector3(-0.08, 1.2, 0.05), _glow(cyan * 0.8))
	var mon := _node(post, Vector3(0.03, 0.32, 0.12), Vector3(-0.1, -0.25, 0))
	_box(mon, Vector3(0.44, 0.3, 0.07), Vector3.ZERO, dark)
	var mm := _glow(Color(0.1, 0.3, 0.42), true)
	_box(mon, Vector3(0.38, 0.2, 0.02), Vector3(0, 0.025, 0.035), mm)
	screens.append({"m": mm, "c": Color(0.4, 1.2, 1.7)})
	_box(mon, Vector3(0.11, 0.12, 0.012), Vector3(-0.09, 0.03, 0.05), _glow(amber))
	_box(mon, Vector3(0.11, 0.12, 0.012), Vector3(0.09, 0.03, 0.05), _glow(cyan))
	for i in 4:
		_button(mon, Vector3(0.06, 0.035, 0.02), Vector3(-0.135 + i * 0.09, -0.115, 0.04), red if i == 3 else Color(0.7, 0.72, 0.75))
	var gauge := _node(post, Vector3(0.03, -0.12, 0.12), Vector3(PI * 0.5 - 0.1, 0, 0))
	_cyl(gauge, 0.15, 0.06, Vector3.ZERO, dark, Vector3.ZERO, -1.0, 20)
	_cyl(gauge, 0.125, 0.012, Vector3(0, 0.032, 0), _glow(amber * 0.5), Vector3.ZERO, -1.0, 20)
	_box(gauge, Vector3(0.012, 0.014, 0.22), Vector3(0, 0.04, 0), _glow(amber * 1.4))
	_box(gauge, Vector3(0.22, 0.014, 0.012), Vector3(0, 0.04, 0), _glow(amber * 1.4))
	_box(self, Vector3(5.0, 0.08, 0.09), Vector3(-0.2, 0.42, -1.82), dark, Vector3(0, 0, 0.03))
	_box(self, Vector3(0.07, 4.0, 0.08), Vector3(-1.5, 0.2, -1.5), dark, Vector3(0.1, 0, 0.2))
	for sd in [-1.0, 1.0]:
		_box(self, Vector3(0.07, 3.6, 0.07), Vector3(sd * 2.2, 0.4, 0.3), dark, Vector3(-0.05, 0, -sd * 0.25))
	_box(self, Vector3(0.9, 0.05, 0.14), Vector3(0, 1.75, -0.6), dark)
	_box(self, Vector3(0.7, 0.02, 0.06), Vector3(0, 1.72, -0.6), _glow(Color(0.5, 0.8, 1.0)))

	# ---- the cockpit's own light: nothing else reaches the inside of the chest
	lamp = OmniLight3D.new()
	lamp.position = Vector3(0, 0.9, -0.5)
	lamp.omni_range = 5.0
	lamp.light_energy = 1.6
	lamp.light_color = Color(0.75, 0.85, 1.0)
	lamp.shadow_enabled = false
	lamp.light_cull_mask = LAYER
	add_child(lamp)



func _build_fx() -> void:
	var qsm := StandardMaterial3D.new()
	qsm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	qsm.albedo_color = Color(4.0, 2.6, 1.0)
	sparks = CPUParticles3D.new()
	sparks.emitting = false
	sparks.one_shot = true
	sparks.amount = 26
	sparks.lifetime = 0.5
	sparks.explosiveness = 0.9
	sparks.direction = Vector3(0, 1, 0.3)
	sparks.spread = 70.0
	sparks.initial_velocity_min = 1.5
	sparks.initial_velocity_max = 4.5
	sparks.gravity = Vector3(0, -7, 0)
	sparks.scale_amount_min = 0.5
	sparks.scale_amount_max = 1.0
	var spm := BoxMesh.new()
	spm.size = Vector3(0.012, 0.012, 0.07)
	spm.material = qsm
	sparks.mesh = spm
	sparks.layers = LAYER
	sparks.position = Vector3(0, -0.6, -1.1)
	add_child(sparks)
	smoke = CPUParticles3D.new()
	smoke.emitting = false
	smoke.amount = 14
	smoke.lifetime = 2.2
	smoke.direction = Vector3(0, 1, 0)
	smoke.spread = 25.0
	smoke.initial_velocity_min = 0.25
	smoke.initial_velocity_max = 0.6
	smoke.gravity = Vector3(0, 0.15, 0)
	smoke.scale_amount_min = 0.5
	smoke.scale_amount_max = 1.4
	var qm := QuadMesh.new()
	qm.size = Vector2(0.5, 0.5)
	var smat := StandardMaterial3D.new()
	smat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	smat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	smat.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	smat.albedo_color = Color(0.05, 0.05, 0.05, 0.22)
	qm.material = smat
	smoke.mesh = qm
	smoke.layers = LAYER
	smoke.position = Vector3(0.6, -0.7, -1.2)
	add_child(smoke)
	beacon = SpotLight3D.new()
	beacon.light_color = Color(1.0, 0.1, 0.05)
	beacon.light_energy = 0.0
	beacon.spot_range = 4.0
	beacon.spot_angle = 38.0
	beacon.spot_attenuation = 0.6
	beacon.shadow_enabled = false
	beacon.light_cull_mask = LAYER
	beacon.position = Vector3(0, 0.55, -0.2)
	add_child(beacon)
	# The spray: many very fine sparks thrown a long way in a narrow fan, each one a thin streak
	# along its own path, white-hot at first and dying through orange to a dull red as it slows.
	var ssm := StandardMaterial3D.new()
	ssm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	ssm.vertex_color_use_as_albedo = true
	spray = CPUParticles3D.new()
	spray.emitting = false
	spray.one_shot = true
	spray.amount = 90
	spray.lifetime = 1.0
	spray.lifetime_randomness = 0.6
	spray.explosiveness = 0.72
	spray.spread = 13.0
	spray.damping_min = 0.6
	spray.damping_max = 2.4
	spray.scale_amount_min = 0.35
	spray.scale_amount_max = 1.0
	spray.set_particle_flag(CPUParticles3D.PARTICLE_FLAG_ALIGN_Y_TO_VELOCITY, true)
	var gr := Gradient.new()
	gr.offsets = PackedFloat32Array([0.0, 0.25, 0.65, 1.0])
	gr.colors = PackedColorArray([Color(5.0, 4.6, 3.6, 1.0), Color(4.2, 2.6, 0.9, 1.0), Color(2.2, 0.6, 0.12, 1.0), Color(0.5, 0.08, 0.02, 0.0)])
	spray.color_ramp = gr
	var sc := Curve.new()
	sc.add_point(Vector2(0.0, 1.0))
	sc.add_point(Vector2(0.6, 0.8))
	sc.add_point(Vector2(1.0, 0.15))
	spray.scale_amount_curve = sc
	var stm := BoxMesh.new()
	stm.size = Vector3(0.0035, 0.05, 0.0035)
	stm.material = ssm
	spray.mesh = stm
	spray.layers = LAYER
	add_child(spray)


# Throw the spray: from a fitting up in one of the overhead corners, slanting down and across so
# the sparks fly out to about eye level in the middle of the cabin before they die.
func _spray(strength: float = 1.0) -> void:
	var k := 0.62 if from_glb else 1.0             # the modelled cabin is the smaller one
	var side := -1.0 if randf() < 0.5 else 1.0
	var from := Vector3(side * randf_range(0.5, 0.85), randf_range(0.55, 0.8), randf_range(-0.55, -0.95)) * k
	var to := Vector3(-side * randf_range(-0.1, 0.35), randf_range(-0.12, 0.1), randf_range(-1.0, -1.35)) * k
	spray.position = from
	spray.direction = (to - from).normalized()
	spray.initial_velocity_min = 2.2 * k * strength
	spray.initial_velocity_max = 6.5 * k * strength
	spray.gravity = Vector3(0, -2.6 * k, 0)
	(spray.mesh as BoxMesh).size = Vector3(0.0035, 0.05, 0.0035) * k
	spray.restart()
	spray.emitting = true


# Alarm state (armour under a quarter, or a missile inbound): the white cabin light drops to
# emergency level and a red beacon turns overhead, its beam sweeping the panel and consoles.
func _alarm_lights(dt: float, hp: float, msl: bool) -> void:
	var on := hp < 0.25 or msl
	alarm_k = lerpf(alarm_k, 1.0 if on else 0.0, 1.0 - exp(-6.0 * dt))
	if beacon == null:
		return
	lamp.light_energy *= 1.0 - 0.55 * alarm_k
	var k := 0.62 if from_glb else 1.0
	beacon.position = Vector3(0, 0.55, -0.2) * k
	beacon.rotation = Vector3(-0.55, t * (5.2 if hp < 0.12 else 3.6), 0.0)
	beacon.light_energy = alarm_k * (5.0 if from_glb else 7.0)
	beacon.visible = alarm_k > 0.02


func hit(amount: float) -> void:
	hit_t = 1.0
	jolt += Vector3(randf_range(-1, 1), randf_range(-0.6, 0.6), randf_range(0.0, 1.0)) * clampf(amount, 0.05, 0.5)
	sparks.position = Vector3(randf_range(-0.4, 0.4), -0.5, -0.72) if from_glb else Vector3(randf_range(-0.9, 0.9), -0.6, -1.1)
	sparks.restart()
	sparks.emitting = true
	if amount > 0.12 or randf() < 0.4:
		_spray(clampf(0.8 + amount * 1.2, 0.8, 1.4))


# move: left stick (strafe, forward) and pedals; aim: right stick (yaw rate, pitch rate)
func update(dt: float, hp: float, move: Vector2, aim: Vector2, firing: bool, boost: float = 0.0) -> void:
	t += dt
	hit_t = maxf(0.0, hit_t - dt * 2.5)
	jolt = jolt.lerp(Vector3.ZERO, 1.0 - exp(-9.0 * dt))
	var k := 1.0 - exp(-12.0 * dt)
	if stick_l != null:
		stick_l.rotation = stick_l.rotation.lerp(Vector3(-move.y * 0.38, 0, -move.x * 0.38), k)
		var kick := (0.03 * sin(t * 60.0)) if firing else 0.0
		stick_r.rotation = stick_r.rotation.lerp(Vector3(clampf(aim.y, -1, 1) * 0.36 + kick, 0, clampf(-aim.x, -1, 1) * 0.36), k)
		trig_r.position.z = lerpf(trig_r.position.z, -0.046 if firing else -0.062, k)
		pedal_r.rotation.x = lerpf(pedal_r.rotation.x, -0.75 - 0.3 * boost, k)
		pedal_l.rotation.x = lerpf(pedal_l.rotation.x, -0.75 - 0.25 * maxf(-move.y, 0.0), k)
	sweep.rotation.y = -t * 2.4
	# lamps: green, amber below half, blinking red below a quarter; white flash on a hit
	var lc := Color(0.2, 1.0, 0.5)
	if hp < 0.25:
		lc = Color(1.0, 0.12, 0.08) * (1.6 if fmod(t, 0.5) < 0.25 else 0.25)
	elif hp < 0.5:
		lc = Color(1.0, 0.7, 0.15)
	lc = lc.lerp(Color(3, 3, 3), hit_t)
	lamp_mat.albedo_color = lc
	# cabin light dips with damage and goes red when it is critical
	lamp.light_color = Color(0.75, 0.85, 1.0) if hp >= 0.25 else Color(1.0, 0.3, 0.2)
	lamp.light_energy = (1.6 if hp >= 0.4 else 1.0 + 0.5 * sin(t * 23.0) * sin(t * 7.0)) + hit_t * 3.0
	_alarm_lights(dt, hp, false)
	for b in btn_mats:
		if b.has("lamp"):
			(b["m"] as StandardMaterial3D).albedo_color = lc
			continue
		var c: Color = b["c"]
		var f := 0.45 + 0.3 * sin(t * 1.3 + float(b["ph"]))
		if hp < 0.25 and sin(t * 9.0 + float(b["ph"]) * 3.0) > 0.7:
			f = 0.05
		(b["m"] as StandardMaterial3D).albedo_color = c * f
	for s in screens:
		var c2: Color = s["c"]
		var f2 := 0.28 + 0.04 * sin(t * 3.0)
		if hit_t > 0.0 and fmod(t * 37.0, 1.0) < 0.5:
			f2 = 0.05
		if hp < 0.3 and fmod(t * 1.7 + c2.r * 5.0, 2.0) < 0.3:
			f2 = 0.04
		(s["m"] as StandardMaterial3D).albedo_color = c2 * f2
	smoke.emitting = hp < 0.4
	if hp < 0.3:
		spark_t -= dt
		if spark_t <= 0.0:
			spark_t = randf_range(0.8, 2.6) * (0.4 + hp * 2.0)
			sparks.position = Vector3(randf_range(-0.9, 0.9), -0.6, -1.1)
			sparks.restart()
			sparks.emitting = true
			_spray()


# ------------------------------------------------------------------ live drive
func _lamp(i: int, col: Color, on: bool, blink: float = 0.0) -> void:
	if i >= lamp_mats.size():
		return
	var k := 1.0 if on else 0.06
	if on and blink > 0.0 and fmod(t, blink) > blink * 0.5:
		k = 0.12
	(lamp_mats[i] as StandardMaterial3D).albedo_color = Color(col.r * 2.2 * k, col.g * 2.2 * k, col.b * 2.2 * k)


func _needle(nm: String, v: float, dt: float, jitter: float = 0.0) -> void:
	if not n.has(nm):
		return
	var cur: float = needle.get(nm, 0.0)
	cur = lerpf(cur, clampf(v, 0.0, 1.0), 1.0 - exp(-9.0 * dt))
	needle[nm] = cur
	var a := lerpf(2.2, -2.2, cur) + sin(t * 31.0 + cur * 9.0) * jitter
	(n[nm] as Node3D).transform = (rest[nm] as Transform3D) * Transform3D(Basis(Vector3(0, 0, 1), a - 0.0), Vector3.ZERO)


# called every frame by the player controller with the live game objects
func drive(dt: float, game, m, pc) -> void:
	var hp: float = clampf(m.ap / m.ap_max, 0.0, 1.0)
	if wall_mat != null:
		wall_mat.set_shader_parameter("glitch", pc.glitch)
		wall_mat.set_shader_parameter("crack", clampf((0.6 - hp) / 0.6, 0.0, 1.0))
		# the monitor sphere is fixed to the cabin; the eye rides a little off its centre
		var ob: Basis = global_transform.basis.orthonormalized()
		wall_mat.set_shader_parameter("pit_inv", ob.inverse())
		wall_mat.set_shader_parameter("eye_off", ob.inverse() * ((wall.get_parent() as Node3D).global_position - global_position))
	var mv := Vector2(float(pc.key("right")) - float(pc.key("left")), float(pc.key("fwd")) - float(pc.key("back")))
	var firing: bool = pc.key("fire0") or pc.key("fire1")
	var boost: float = 1.0 if m.boosting else 0.0
	if not from_glb:
		update(dt, hp, mv, pc._aim_rate, firing, boost)
		return
	t += dt
	hit_t = maxf(0.0, hit_t - dt * 2.5)
	jolt = jolt.lerp(Vector3.ZERO, 1.0 - exp(-9.0 * dt))
	var k := 1.0 - exp(-12.0 * dt)
	# ---- the pilot is pressed against the frame's acceleration; footfalls come up through the seat
	var inv: Basis = global_transform.basis.orthonormalized().inverse()
	var v_loc: Vector3 = inv * m.velocity
	var acc := (v_loc - _vel) / maxf(dt, 0.001)
	_vel = v_loc
	_acc = _acc.lerp(acc.limit_length(160.0), 1.0 - exp(-6.0 * dt))
	var bob := 0.0
	if m.grounded and Vector2(m.velocity.x, m.velocity.z).length() > 2.0:
		_step_t += dt * (3.0 + Vector2(m.velocity.x, m.velocity.z).length() * 0.12)
		bob = absf(sin(_step_t)) * 0.012
	sway = sway.lerp(Vector3(-_acc.x * 0.00035, -_acc.y * 0.00035 - bob, -_acc.z * 0.00035).limit_length(0.07), 1.0 - exp(-10.0 * dt))
	if n.has("seat"):
		var sh := hit_t * 0.006
		(n["seat"] as Node3D).transform = (rest["seat"] as Transform3D).translated(Vector3(randf_range(-sh, sh), randf_range(-sh, sh) - bob * 0.5, 0))
	# ---- controls
	var aim: Vector2 = pc._aim_rate
	if n.has("stick_L"):
		var sl: Node3D = n["stick_L"]
		sl.rotation = sl.rotation.lerp(Vector3(-mv.y * 0.33, 0, -mv.x * 0.33), k)
	if n.has("stick_R"):
		var sr: Node3D = n["stick_R"]
		var kick := (0.02 * sin(t * 60.0)) if firing else 0.0
		sr.rotation = sr.rotation.lerp(Vector3(clampf(aim.y, -1, 1) * 0.33 + kick, 0, clampf(-aim.x, -1, 1) * 0.33), k)
	if n.has("trigger_R"):
		var tr: Node3D = n["trigger_R"]
		tr.rotation.x = lerpf(tr.rotation.x, -0.3 if pc.key("fire0") else 0.0, 1.0 - exp(-30.0 * dt))
	if n.has("pedal_R"):
		(n["pedal_R"] as Node3D).rotation.x = lerpf((n["pedal_R"] as Node3D).rotation.x, -0.35 * maxf(boost, float(pc.key("jump"))), k)
	if n.has("pedal_L"):
		(n["pedal_L"] as Node3D).rotation.x = lerpf((n["pedal_L"] as Node3D).rotation.x, -0.35 * maxf(float(pc.key("descend")), maxf(-mv.y, 0.0)), k)
	if n.has("throttle"):
		var thr: float = 0.4 * boost + 0.2 * mv.y - (0.3 if m.overheat_t > 0.0 else 0.0)
		(n["throttle"] as Node3D).rotation.x = lerpf((n["throttle"] as Node3D).rotation.x, -thr, 1.0 - exp(-6.0 * dt))
	# ---- sight arm swings in for precise work: braced weapons, a charging shot, firing on a lock
	var w0 = m.weapons[0]
	var want_scope: bool = m.bracing or (w0 != null and w0.charging) or (pc.lock != null and pc.key("fire0") and w0 != null and float(w0.d["range"]) > 650.0)
	if pc.lock != null and not want_scope:
		# holding the aim on the locked target (a little slack once it is down, so it does not flap)
		var to: Vector3 = pc.lock.center() - global_position
		if to.length() > 1.0:
			var ang := acos(clampf(to.normalized().dot(pc.aim_vec()), -1.0, 1.0))
			want_scope = ang < (0.13 if _scope_want else 0.075)
	if want_scope != _scope_want:
		_scope_want = want_scope
		game.sfx.play2d("servo", 0.45, 1.0 if want_scope else 0.85)
	scope_k = move_toward(scope_k, 1.0 if want_scope else 0.0, dt * (3.2 if want_scope else 2.2))
	var e := scope_k * scope_k * (3.0 - 2.0 * scope_k)
	for nm in ["scope_arm", "scope_fore", "scope_head"]:
		if n.has(nm) and n.has(nm + "_dep"):
			(n[nm] as Node3D).transform = (rest[nm] as Transform3D).interpolate_with(rest[nm + "_dep"], e)
	if scope_cam != null:
		# the sight camera only runs while the arm is out
		var on_air := scope_k > 0.3 and visible
		scope_vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS if on_air else SubViewport.UPDATE_DISABLED
		if on_air:
			var eye: Vector3 = global_position
			var tgt: Vector3 = eye + pc.aim_vec() * 400.0
			if pc.lock != null:
				tgt = pc.lock.center()
			scope_cam.global_transform = Transform3D(Basis.IDENTITY, eye).looking_at(tgt, Vector3.UP)
			var dist := eye.distance_to(tgt)
			scope_cam.fov = clampf(rad_to_deg(2.0 * atan(22.0 / maxf(dist, 30.0))), 3.5, 28.0)
		scope_mat.set_shader_parameter("live", clampf((scope_k - 0.3) / 0.4, 0.0, 1.0))
	# ---- dials
	var spd: float = m.velocity.length()
	var heat: float = 1.0 if m.overheat_t > 0.0 else (1.0 - m.thrust) * 0.6
	if w0 != null and w0.is_beam:
		heat = maxf(heat, w0.heat)
	var shake := 0.012 + (0.05 if hp < 0.3 else 0.0) + hit_t * 0.2
	_needle("needle_speed", spd / 115.0, dt, shake)
	_needle("needle_thrust", m.thrust, dt, shake)
	_needle("needle_heat", heat, dt, shake)
	_needle("needle_ap", hp, dt, shake)
	var alt: float = absf(m.global_position.y) / 450.0 if game.world.space else (m.global_position.y - game.world.height(m.global_position.x, m.global_position.z)) / 330.0
	_needle("needle_alt", alt, dt, shake)
	_needle("needle_aux", m.od, dt, shake)
	# ---- warning displays and lamps
	var msl: bool = game.proj.incoming(m) > 0
	var locked: bool = pc.lock != null
	ui.game = game
	ui.m = m
	ui.pc = pc
	ui.t = t
	ui.noise = hit_t + (0.25 if hp < 0.25 and fmod(t * 1.3, 2.0) < 0.2 else 0.0)
	ui.warn = [msl, m.overheat_t > 0.0, hp < 0.35, locked]
	ui.queue_redraw()
	var amber := Color(1.0, 0.7, 0.15)
	var red := Color(1.0, 0.12, 0.08)
	var green := Color(0.2, 1.0, 0.45)
	var cyan := Color(0.3, 0.8, 1.0)
	_lamp(0, green, hp >= 0.25)
	_lamp(1, amber, locked)
	_lamp(2, red, msl, 0.3)
	_lamp(3, red, m.overheat_t > 0.0, 0.5)
	_lamp(4, red, hp < 0.35, 0.5)
	_lamp(5, green, m.od >= 1.0 and not m.od_on, 0.8)
	_lamp(6, green if m.shield_hp > 0.0 else red, m.shield_max > 0.0)
	_lamp(7, cyan, m.boosting)
	_lamp(8, amber, w0 != null and (w0.reload_t > 0.0 or w0.overheated), 0.4)
	_lamp(9, cyan, game.hud.radio_cur != null, 0.25)
	# displays lose brightness and flicker with damage
	var sb := 1.5
	if hit_t > 0.0 and fmod(t * 37.0, 1.0) < 0.5:
		sb = 0.4
	elif hp < 0.3 and fmod(t * 1.7, 2.0) < 0.25:
		sb = 0.3
	for sm in scr_mats:
		(sm as StandardMaterial3D).albedo_color = Color(sb, sb, sb)
	if scope_mat != null:
		scope_mat.set_shader_parameter("bright", sb / 1.5)
	# ---- cabin light: dips and flickers when hurt, red when critical, flares on a hit
	lamp.light_color = Color(0.8, 0.88, 1.0) if hp >= 0.25 else Color(1.0, 0.25, 0.18)
	lamp.light_energy = KEY_E * (1.0 if hp >= 0.4 else 0.6 + 0.35 * sin(t * 23.0) * sin(t * 7.0)) + hit_t * 1.2
	_alarm_lights(dt, hp, msl)
	# the wall's light turns with the frame; it flickers and dims with the displays that give it
	var w = game.world
	if key != null and w != null:
		_aim_key(key_fix if key_fix != Vector3.ZERO else inv * (w.sun_dir as Vector3))
		key.shadow_enabled = w.env.ssao_enabled and not no_shadow      # the quality setting
		key.light_color = key_col.lerp(Color(1.0, 0.35, 0.25), 0.5 * alarm_k)
		key.light_energy = KEY_SUN * key_gain * (sb / 1.5) * (1.0 - 0.4 * alarm_k)
	for fl in face_lights:
		(fl[0] as Light3D).light_energy = float(fl[1]) * (sb / 1.5)
	fill.light_energy = FILL_E * (sb / 1.5)
	if solo:
		lamp.light_energy = 0.0
		fill.light_energy = 0.0
		for fl in face_lights:
			(fl[0] as Light3D).light_energy = 0.0
	for l in spec_lights:
		(l as Light3D).visible = not solo
	fill.light_color = Color(0.6, 1.0, 0.7).lerp(Color(1.0, 0.3, 0.2), 1.0 if (msl or hp < 0.25) and fmod(t, 0.5) < 0.25 else 0.0)
	smoke.emitting = hp < 0.4
	if hp < 0.3:
		spark_t -= dt
		if spark_t <= 0.0:
			spark_t = randf_range(0.8, 2.6) * (0.4 + hp * 2.0)
			sparks.position = Vector3(randf_range(-0.5, 0.5), -0.4, -0.7)
			sparks.restart()
			sparks.emitting = true
			_spray()
