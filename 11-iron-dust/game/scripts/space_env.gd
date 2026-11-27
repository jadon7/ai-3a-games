extends RefCounted
# Space map for "FLASH IN THE BELT": friendly staging area (south, +Z), a broad asteroid belt
# with flyable lanes, and the enemy anchorage beside a derelict ring station (north, -Z).
# Everything is generated from code. build() adds the scenery to `world` and returns the
# mission points, radar blockers and the environment nodes; tick() only animates lights.
# Front is -Z. Play volume: x [-1500, 1500], y [-450, 450], z [-2600, 900].

const MeshKit = preload("res://scripts/mesh_kit.gd")
const Tex = preload("res://scripts/tex.gd")

const HZ := PI * 0.5
const BOUNDS_MIN := Vector3(-1500.0, -450.0, -2600.0)
const BOUNDS_MAX := Vector3(1500.0, 450.0, 900.0)
const SPAWN := Vector3(250.0, 14.0, 640.0)
const ALLY_SHIP := Vector3(350.0, 0.0, 520.0)
const ENEMY_SHIPS := [Vector3(220.0, 0.0, -2020.0), Vector3(620.0, -40.0, -1900.0)]
const MEGA := Vector3(-560.0, 0.0, -2380.0)
const MEGA_R := 560.0
# the cruiser's route through the belt (kept clear of rocks) and two narrower side passages
const LANE := [Vector3(350, 0, 520), Vector3(340, 0, 160), Vector3(290, 8, -200), Vector3(170, 18, -520), Vector3(10, 6, -860), Vector3(10, -8, -1180), Vector3(110, 0, -1480)]
const LANE_B := [Vector3(-250, 40, -120), Vector3(-430, 60, -520), Vector3(-300, 20, -900), Vector3(-340, 0, -1300), Vector3(-80, 0, -1540)]
const LANE_C := [Vector3(760, -20, -150), Vector3(830, -40, -600), Vector3(620, -20, -1000), Vector3(430, 0, -1420)]
# where the phase-1 attack waves leave the belt, and pockets beside the lane for ambush squads
const WAVES := [Vector3(-420, 70, -230), Vector3(160, -50, -300), Vector3(760, 40, -250)]
const AMBUSH := [Vector3(-80, 70, -420), Vector3(430, -60, -800), Vector3(-330, 50, -1150), Vector3(420, 40, -1420)]
# rocks that carry a gun platform on the face turned toward the lane
const PLATFORM_ROCKS := [Vector3(470, 50, -330), Vector3(-50, -55, -650), Vector3(230, 60, -960), Vector3(-190, 40, -1260), Vector3(300, -50, -1400)]
const HEROES := [[Vector3(640, 40, -600), 150.0], [Vector3(-540, -60, -980), 135.0], [Vector3(-700, 80, -420), 140.0], [Vector3(760, -70, -1200), 125.0], [Vector3(-900, -90, -1250), 110.0], [Vector3(1150, 60, -800), 130.0]]
const SUN_DIR := Vector3(-0.72, 0.42, 0.4)
const PLANET_DIR := Vector3(0.84, -0.22, -0.46)

const SKY_CODE := "
shader_type sky;
// Deep space: procedural stars, a faint galactic band, the sun, and a ringed gas giant lit by LIGHT0.
uniform sampler2D noise_tex : repeat_enable, filter_linear_mipmap;
uniform vec3 planet_dir = vec3(0.84, -0.22, -0.46);
uniform float planet_ang = 0.25;
uniform vec3 planet_axis = vec3(0.25, 0.95, 0.18);
uniform vec3 sun_color : source_color = vec3(1.0, 0.95, 0.86);

float hash(vec3 p) {
	p = fract(p * 0.3183099 + vec3(0.1, 0.17, 0.23));
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

vec3 stars(vec3 d, float scale, float thr) {
	vec3 p = d * scale;
	vec3 id = floor(p);
	vec3 f = fract(p) - 0.5;
	float h = hash(id);
	if (h < thr) {
		return vec3(0.0);
	}
	vec3 off = (vec3(hash(id + 1.7), hash(id + 5.3), hash(id + 9.1)) - 0.5) * 0.5;
	float dd = length(f - off);
	float b = (h - thr) / (1.0 - thr);
	float s = smoothstep(0.17, 0.0, dd) * (0.12 + b * b * b * 3.6);
	vec3 tint = mix(vec3(1.0, 0.8, 0.62), vec3(0.68, 0.8, 1.0), hash(id + 3.3));
	return tint * s;
}

void sky() {
	vec3 d = normalize(EYEDIR);
	vec3 col = vec3(0.0);
	vec3 bn = normalize(vec3(0.42, 0.86, 0.28));
	float bd = dot(d, bn);
	float band = exp(-bd * bd * 9.0);
	vec3 t1 = normalize(cross(bn, vec3(0.0, 0.0, 1.0)));
	vec3 t2 = cross(bn, t1);
	float lon = atan(dot(d, t2), dot(d, t1)) / 6.2831853;
	float n1 = texture(noise_tex, vec2(lon * 3.0, bd * 1.4 + 0.5)).r;
	float n2 = texture(noise_tex, vec2(lon * 8.0 + 0.37, bd * 3.6 + 0.2)).r;
	float cloud = smoothstep(0.32, 0.8, n1 * 0.65 + n2 * 0.35);
	col += band * (0.004 + 0.022 * cloud) * mix(vec3(0.45, 0.52, 0.85), vec3(0.8, 0.58, 0.48), n2);
	col += vec3(0.12, 0.04, 0.09) * 0.02 * smoothstep(0.5, 0.9, n1) * (1.0 - band);
	col += stars(d, 120.0, 0.93);
	col += stars(d, 260.0, 0.95) * 0.7;
	col += stars(d, 480.0, 0.9) * (0.1 + band * 0.7);
	float sd = max(dot(d, LIGHT0_DIRECTION), 0.0);
	col += sun_color * (pow(sd, 9000.0) * 60.0 + pow(sd, 900.0) * 1.2 + pow(sd, 90.0) * 0.07);
	// gas giant: sphere of angular radius planet_ang seen from the origin, plus a thin ring
	vec3 pc = normalize(planet_dir);
	vec3 ax = normalize(planet_axis);
	float pr = sin(planet_ang);
	float b = dot(d, pc);
	float disc = b * b - (1.0 - pr * pr);
	float t_hit = 1e9;
	if (b > 0.0 && disc > 0.0) {
		t_hit = b - sqrt(disc);
		vec3 n = (d * t_hit - pc) / pr;
		float lat = dot(n, ax);
		vec3 e1 = normalize(cross(ax, vec3(0.3, 0.1, 0.9)));
		vec3 e2 = cross(ax, e1);
		float plon = atan(dot(n, e2), dot(n, e1)) / 6.2831853;
		float turb = texture(noise_tex, vec2(plon * 2.0, lat * 0.9 + 0.5)).r - 0.5;
		float turb2 = texture(noise_tex, vec2(plon * 6.0 + 0.2, lat * 2.6)).r - 0.5;
		float bands = sin(lat * 17.0 + turb * 3.2) * 0.5 + 0.5;
		float bands2 = sin(lat * 43.0 + turb2 * 5.0 + 1.0) * 0.5 + 0.5;
		vec3 pcol = mix(vec3(0.52, 0.36, 0.24), vec3(0.86, 0.74, 0.58), bands);
		pcol = mix(pcol, vec3(0.6, 0.5, 0.46), bands2 * 0.35);
		pcol = mix(pcol, vec3(0.36, 0.42, 0.5), smoothstep(0.62, 0.98, abs(lat)));
		float lam = dot(n, LIGHT0_DIRECTION);
		float lit = smoothstep(-0.08, 0.5, lam);
		float rim = pow(1.0 - max(dot(n, -d), 0.0), 3.0);
		col = pcol * lit * 0.34 + vec3(0.5, 0.65, 0.95) * rim * (lit * 0.3 + 0.015) + pcol * 0.005;
	}
	float dn = dot(d, ax);
	if (abs(dn) > 0.0005) {
		float tr = dot(pc, ax) / dn;
		if (tr > 0.0 && tr < t_hit) {
			vec3 rp = d * tr - pc;
			float rr = length(rp) / pr;
			if (rr > 1.3 && rr < 2.05) {
				float rk = (rr - 1.3) / 0.75;
				float rb = (0.5 + 0.5 * sin(rr * 140.0)) * (0.55 + 0.45 * sin(rr * 37.0 + 1.0)) * (0.7 + 0.3 * sin(rr * 311.0));
				float gap = smoothstep(0.0, 0.05, abs(rk - 0.6));
				float a = smoothstep(0.0, 0.05, rk) * smoothstep(1.0, 0.92, rk) * (0.25 + 0.75 * rb) * gap * 0.4;
				// the planet's shadow falls across the far side of the ring
				vec3 rn = rp / max(length(rp), 0.0001);
				float sh = dot(rn, LIGHT0_DIRECTION);
				float perp = length(rp - LIGHT0_DIRECTION * dot(rp, LIGHT0_DIRECTION)) / pr;
				float shadow = (sh < 0.0 && perp < 1.0) ? 0.06 : 1.0;
				col = mix(col, vec3(0.78, 0.7, 0.58) * 0.3 * shadow, a);
			}
		}
	}
	COLOR = col;
}
"

const ROCK_CODE := "
shader_type spatial;
// Asteroid rock. Object-space triplanar (so the pattern rides with the rock), two scales of a
// photographed cliff, large mottling. COLOR = cavity shade x instance tint.
// tumble > 0: each MultiMesh instance spins about INSTANCE_CUSTOM.xyz at INSTANCE_CUSTOM.w rad/s.
uniform sampler2D wall_alb : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D wall_nr : repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D grunge : repeat_enable, filter_linear_mipmap;
uniform vec3 wall_avg = vec3(0.5);
uniform vec3 rock_color : source_color = vec3(0.3, 0.275, 0.25);
uniform float tile = 46.0;
uniform float tile2 = 9.0;
uniform float det_amt = 1.0;
uniform float tumble = 0.0;
instance uniform vec4 tint : source_color = vec4(1.0, 1.0, 1.0, 1.0);

varying vec3 lp;
varying vec3 ln;
varying vec3 m0;
varying vec3 m1;
varying vec3 m2;

mat3 rot_axis(vec3 a, float ang) {
	float s = sin(ang);
	float c = cos(ang);
	float oc = 1.0 - c;
	return mat3(
		vec3(oc * a.x * a.x + c, oc * a.x * a.y + a.z * s, oc * a.z * a.x - a.y * s),
		vec3(oc * a.x * a.y - a.z * s, oc * a.y * a.y + c, oc * a.y * a.z + a.x * s),
		vec3(oc * a.z * a.x + a.y * s, oc * a.y * a.z - a.x * s, oc * a.z * a.z + c));
}

void vertex() {
	float sc = length(MODEL_MATRIX[0].xyz);
	lp = VERTEX * sc;
	ln = NORMAL;
	mat3 r = mat3(1.0);
	if (tumble > 0.0) {
		vec3 ax = normalize(INSTANCE_CUSTOM.xyz + vec3(0.0001, 0.0, 0.0));
		r = rot_axis(ax, TIME * INSTANCE_CUSTOM.w * tumble);
		VERTEX = r * VERTEX;
		NORMAL = r * NORMAL;
	}
	mat3 mm = mat3(normalize(MODEL_MATRIX[0].xyz), normalize(MODEL_MATRIX[1].xyz), normalize(MODEL_MATRIX[2].xyz));
	mat3 mv = mat3(VIEW_MATRIX) * mm * r;
	m0 = mv[0];
	m1 = mv[1];
	m2 = mv[2];
}

vec3 unpack_n(vec3 t, float k) {
	vec2 a = (t.xy * 2.0 - 1.0) * k;
	return vec3(a, sqrt(max(0.04, 1.0 - dot(a, a))));
}

void fragment() {
	vec3 n = normalize(ln);
	vec3 w = pow(abs(n), vec3(4.0));
	w /= (w.x + w.y + w.z);
	vec3 col = rock_color * COLOR.rgb * tint.rgb;
	float mot = texture(grunge, lp.xz / 170.0 + vec2(lp.y / 210.0)).r;
	float mot2 = texture(grunge, lp.zy / 37.0 + vec2(lp.x / 51.0)).r;
	col *= (0.62 + 0.62 * mot) * (0.8 + 0.4 * mot2);
	float rough = 0.93;
	vec3 no = n;
	if (det_amt > 0.0) {
		vec3 p1 = lp / tile;
		vec3 p2 = lp / tile2;
		vec3 a1 = texture(wall_alb, p1.zy).rgb * w.x + texture(wall_alb, p1.xz).rgb * w.y + texture(wall_alb, p1.xy).rgb * w.z;
		vec3 a2 = texture(wall_alb, p2.zy).rgb * w.x + texture(wall_alb, p2.xz).rgb * w.y + texture(wall_alb, p2.xy).rgb * w.z;
		float g1 = dot(a1 / wall_avg, vec3(0.333));
		float g2 = dot(a2 / wall_avg, vec3(0.333));
		col *= mix(1.0, g1, 0.8) * mix(1.0, g2, 0.55);
		vec3 fx = texture(wall_nr, p1.zy).rgb;
		vec3 fy = texture(wall_nr, p1.xz).rgb;
		vec3 fz = texture(wall_nr, p1.xy).rgb;
		vec3 nx = texture(wall_nr, p2.zy).rgb;
		vec3 ny = texture(wall_nr, p2.xz).rgb;
		vec3 nz = texture(wall_nr, p2.xy).rgb;
		rough = clamp(0.5 + 0.5 * (nx.b * w.x + ny.b * w.y + nz.b * w.z), 0.7, 1.0);
		vec3 tx = unpack_n(fx, 1.6) + unpack_n(nx, 1.2) * vec3(1.0, 1.0, 0.0);
		vec3 ty = unpack_n(fy, 1.6) + unpack_n(ny, 1.2) * vec3(1.0, 1.0, 0.0);
		vec3 tz = unpack_n(fz, 1.6) + unpack_n(nz, 1.2) * vec3(1.0, 1.0, 0.0);
		tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
		ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
		tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
		no = normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
	}
	ALBEDO = col;
	ROUGHNESS = rough;
	SPECULAR = 0.25;
	NORMAL = normalize(mat3(m0, m1, m2) * no);
}
"

const SPECK_CODE := "
shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, shadows_disabled, fog_disabled;
// Fine dust fixed in world space (wrapped around the camera): the only cue for speed in open space.
uniform float span = 260.0;
uniform float size = 0.2;
varying float fade;

void vertex() {
	vec3 base = INSTANCE_CUSTOM.xyz * span;
	vec3 rel = mod(base - CAMERA_POSITION_WORLD, vec3(span)) - vec3(span * 0.5);
	float d = length(rel);
	fade = smoothstep(span * 0.5, span * 0.3, d) * smoothstep(4.0, 16.0, d) * (0.35 + INSTANCE_CUSTOM.w * 0.65);
	vec3 wp = CAMERA_POSITION_WORLD + rel;
	wp += (INV_VIEW_MATRIX[0].xyz * VERTEX.x + INV_VIEW_MATRIX[1].xyz * VERTEX.y) * size * (1.0 + d * 0.012);
	POSITION = PROJECTION_MATRIX * VIEW_MATRIX * vec4(wp, 1.0);
}

void fragment() {
	float r = length(UV - vec2(0.5)) * 2.0;
	ALBEDO = vec3(0.72, 0.78, 0.9) * fade * smoothstep(1.0, 0.15, r) * 0.45;
}
"


# ------------------------------------------------------------------ public
static func default_points() -> Dictionary:
	return {
		"spawn": SPAWN, "ally_ship": ALLY_SHIP, "enemy_ships": ENEMY_SHIPS.duplicate(), "lane": LANE.duplicate(), "mega": MEGA,
		"lane_b": LANE_B.duplicate(), "lane_c": LANE_C.duplicate(), "waves": WAVES.duplicate(), "ambush": AMBUSH.duplicate(),
		"platforms": [], "platform_up": [], "bounds_min": BOUNDS_MIN, "bounds_max": BOUNDS_MAX,
	}


static func build(world: Node3D) -> Dictionary:
	var t0 := Time.get_ticks_msec()
	var ctx := {"world": world, "body": null, "n": 0, "cols": [], "shapes": 0, "bodies": 0, "rocks": []}
	var st := {"t": 0.0}
	var pts := default_points()
	var out := {"points": pts, "cols": ctx["cols"]}
	_build_env(world, out)
	_build_belt(world, ctx, pts)
	_build_mega(world, ctx, st)
	_build_structures(world, ctx, st)
	_build_specks(world)
	world.set_meta("space_env", st)
	out["rocks"] = ctx["rocks"]
	var cs := census(world)
	cs["bodies"] = ctx["bodies"]
	cs["shapes"] = ctx["shapes"]
	cs["ms"] = Time.get_ticks_msec() - t0
	out["stats"] = cs
	return out


# blinking beacons and the relay dish; everything else is static or animated in shaders
static func tick(world: Node3D, dt: float, _cam_pos: Vector3 = Vector3.ZERO) -> void:
	if world == null or not world.has_meta("space_env"):
		return
	var st: Dictionary = world.get_meta("space_env")
	var t: float = float(st["t"]) + dt
	st["t"] = t
	var red: StandardMaterial3D = st.get("red")
	if red != null:
		var k := 1.0 if fmod(t, 1.6) < 0.22 else 0.06
		red.albedo_color = Color(1.0, 0.16, 0.08) * (3.0 * k)
	var blue: StandardMaterial3D = st.get("blue")
	if blue != null:
		blue.albedo_color = Color(0.3, 0.62, 1.0) * (1.2 + 1.2 * (0.5 + 0.5 * sin(t * 2.4)))
	var dish = st.get("dish")
	if dish != null and is_instance_valid(dish):
		(dish as Node3D).rotation.y = t * 0.12


# triangles / mesh nodes below a node (MultiMesh instances counted in full)
static func census(node: Node) -> Dictionary:
	var tris := 0
	var items := 0
	for c in node.find_children("*", "GeometryInstance3D", true, false):
		var m: Mesh = null
		var mul := 1
		if c is MultiMeshInstance3D:
			var mm: MultiMesh = (c as MultiMeshInstance3D).multimesh
			if mm == null:
				continue
			m = mm.mesh
			mul = mm.instance_count
		elif c is MeshInstance3D:
			m = (c as MeshInstance3D).mesh
		if m == null:
			continue
		items += 1
		var n := 0
		if m is ArrayMesh:
			for s in m.get_surface_count():
				var il: int = (m as ArrayMesh).surface_get_array_index_len(s)
				n += (il if il > 0 else (m as ArrayMesh).surface_get_array_len(s)) / 3
		else:
			n = m.get_faces().size() / 3
		tris += n * mul
	return {"tris": tris, "items": items}


# ------------------------------------------------------------------ sky / light
static func _build_env(world: Node3D, out: Dictionary) -> void:
	var sh := Shader.new()
	sh.code = SKY_CODE
	var sky_mat := ShaderMaterial.new()
	sky_mat.shader = sh
	sky_mat.set_shader_parameter("noise_tex", Tex.cloud_noise)
	sky_mat.set_shader_parameter("planet_dir", PLANET_DIR.normalized())
	var sky := Sky.new()
	sky.sky_material = sky_mat
	sky.process_mode = Sky.PROCESS_MODE_QUALITY
	sky.radiance_size = Sky.RADIANCE_SIZE_128
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	# no atmosphere: a flat cool fill instead of sky light, so shadowed sides stay readable
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.42, 0.48, 0.64)
	env.ambient_light_energy = 0.8
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = 1.0
	env.tonemap_white = 6.0
	env.ssao_enabled = true
	env.ssao_radius = 3.0
	env.ssao_intensity = 2.0
	env.glow_enabled = true
	env.glow_intensity = 0.6
	env.glow_strength = 1.0
	env.glow_bloom = 0.03
	env.glow_hdr_threshold = 1.1
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE
	env.fog_enabled = false
	env.volumetric_fog_enabled = false
	env.adjustment_enabled = true
	env.adjustment_saturation = 1.0
	env.adjustment_contrast = 1.06
	var we := WorldEnvironment.new()
	we.environment = env
	world.add_child(we)
	var sun_dir := SUN_DIR.normalized()
	var sun := DirectionalLight3D.new()
	sun.light_color = Color(1.0, 0.96, 0.9)
	sun.light_energy = 3.3
	sun.shadow_enabled = true
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	sun.directional_shadow_max_distance = 1300.0
	sun.directional_shadow_blend_splits = true
	sun.light_angular_distance = 0.4
	sun.shadow_bias = 0.06
	sun.shadow_normal_bias = 1.6
	world.add_child(sun)
	sun.basis = Basis.looking_at(-sun_dir, Vector3.UP)
	# planet-shine: a weak warm light from the gas giant, no shadows
	var fill := DirectionalLight3D.new()
	fill.light_color = Color(0.9, 0.72, 0.55)
	fill.light_energy = 0.7
	fill.shadow_enabled = false
	fill.sky_mode = DirectionalLight3D.SKY_MODE_LIGHT_ONLY
	world.add_child(fill)
	fill.basis = Basis.looking_at(-PLANET_DIR.normalized(), Vector3.UP)
	out["we"] = we
	out["env"] = env
	out["sun"] = sun
	out["fill"] = fill
	out["sun_dir"] = sun_dir


# ------------------------------------------------------------------ collision helpers
static func _body(ctx: Dictionary) -> StaticBody3D:
	if ctx["body"] == null or int(ctx["n"]) >= 24:
		var b := StaticBody3D.new()
		b.collision_layer = 1
		b.collision_mask = 0
		(ctx["world"] as Node3D).add_child(b)
		ctx["body"] = b
		ctx["n"] = 0
		ctx["bodies"] = int(ctx["bodies"]) + 1
	ctx["n"] = int(ctx["n"]) + 1
	ctx["shapes"] = int(ctx["shapes"]) + 1
	return ctx["body"]


static func _cshape(ctx: Dictionary, sh: Shape3D, xf: Transform3D) -> void:
	var cs := CollisionShape3D.new()
	cs.shape = sh
	cs.transform = xf
	_body(ctx).add_child(cs)


static func _cbox(ctx: Dictionary, xf: Transform3D, size: Vector3) -> void:
	var s := BoxShape3D.new()
	s.size = size
	_cshape(ctx, s, xf.orthonormalized())


static func _ccyl(ctx: Dictionary, xf: Transform3D, r: float, h: float) -> void:
	var s := CylinderShape3D.new()
	s.radius = r
	s.height = h
	_cshape(ctx, s, xf.orthonormalized())


static func _csph(ctx: Dictionary, p: Vector3, r: float) -> void:
	var s := SphereShape3D.new()
	s.radius = r
	_cshape(ctx, s, Transform3D(Basis.IDENTITY, p))


# collision box along a beam from a to c
static func _cbeam(ctx: Dictionary, xf: Transform3D, a: Vector3, c: Vector3, w: float, h: float) -> void:
	var d := c - a
	var ln := d.length()
	if ln < 0.01:
		return
	var up := Vector3.UP if absf(d.y / ln) < 0.95 else Vector3.RIGHT
	_cbox(ctx, xf * Transform3D(Basis.looking_at(d / ln, up), (a + c) * 0.5), Vector3(w, h, ln))


static func _col(ctx: Dictionary, p: Vector3, r: float) -> void:
	(ctx["cols"] as Array).append({"x": p.x, "z": p.z, "r": r, "h": p.y + r, "y": p.y})


# ------------------------------------------------------------------ mesh helpers
static func _beam(k, b: Node3D, key: String, a: Vector3, c: Vector3, w: float, h: float = -1.0, shade: float = -1.0) -> void:
	var d := c - a
	var ln := d.length()
	if ln < 0.01:
		return
	var up := Vector3.UP if absf(d.y / ln) < 0.95 else Vector3.RIGHT
	var bas := Basis.looking_at(d / ln, up)
	k.box(b, key, Vector3(w, h if h > 0.0 else w, ln), (a + c) * 0.5, bas.get_euler(), {}, shade)


# open lattice girder of square section w between a and c
static func _truss(k, b: Node3D, key: String, a: Vector3, c: Vector3, w: float, bays: int, chord: float = 0.0) -> void:
	var d := c - a
	var ln := d.length()
	if ln < 0.01:
		return
	var f := d / ln
	var up := Vector3.UP if absf(f.y) < 0.95 else Vector3.RIGHT
	var r := f.cross(up).normalized()
	var u := r.cross(f).normalized()
	var cw := chord if chord > 0.0 else w * 0.1
	var hw := w * 0.5
	var corners := [r * hw + u * hw, -r * hw + u * hw, -r * hw - u * hw, r * hw - u * hw]
	for o in corners:
		_beam(k, b, key, a + o, c + o, cw)
	for i in bays + 1:
		var p := a + f * (ln * float(i) / float(bays))
		for j in 4:
			_beam(k, b, key, p + corners[j], p + corners[(j + 1) % 4], cw * 0.7)
		if i < bays:
			var q := a + f * (ln * float(i + 1) / float(bays))
			for j in 4:
				var j2 := (j + 1) % 4
				if (i + j) % 2 == 0:
					_beam(k, b, key, p + corners[j], q + corners[j2], cw * 0.6)
				else:
					_beam(k, b, key, p + corners[j2], q + corners[j], cw * 0.6)


static func _glow(c: Color, e: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = c * e
	return m


static func _mats(st: Dictionary) -> Dictionary:
	if not st.has("red"):
		st["red"] = _glow(Color(1.0, 0.16, 0.08), 3.0)
		st["blue"] = _glow(Color(0.3, 0.62, 1.0), 2.0)
		st["amber"] = _glow(Color(1.0, 0.62, 0.25), 1.5)
	if not st.has("plate"):
		var pm := Tex.plating.duplicate() as ShaderMaterial
		pm.set_shader_parameter("tile", 38.0)
		pm.set_shader_parameter("seam_dark", 0.4)
		st["plate"] = pm
	var am: ShaderMaterial = st["plate"]
	return {
		"S": {"mat": am, "params": {"tint": Color(0.17, 0.18, 0.2), "metal": 0.35, "wear": 1.3}},
		"L": {"mat": am, "params": {"tint": Color(0.29, 0.3, 0.31), "metal": 0.3, "wear": 1.3}},
		"R": {"mat": am, "params": {"tint": Color(0.26, 0.15, 0.1), "metal": 0.25, "wear": 1.5}},
		"D": {"mat": Tex.armor, "params": {"tint": Color(0.07, 0.073, 0.08), "metal": 0.55}},
		"P": {"mat": Tex.armor, "params": {"tint": Color(0.03, 0.05, 0.14), "metal": 0.85, "wear": 0.3}},
		"H": {"mat": Tex.armor, "params": {"tint": Color(0.7, 0.5, 0.06), "metal": 0.2, "stripes": 1.0}},
		"W": {"mat": Tex.armor, "params": {"tint": Color(0.16, 0.15, 0.15), "metal": 0.4, "wear": 1.5, "wreck": 0.75}},
		"G": {"mat": st["amber"]},
		"B": {"mat": st["blue"]},
		"X": {"mat": st["red"]},
	}


static func _kit(seed_v: int):
	var k = MeshKit.new(seed_v)
	k.dust = 0.0
	k.jitter = 0.22
	return k


# ------------------------------------------------------------------ asteroid meshes
# unit icosphere: [directions, triangle indices]
static func _ico(sub: int) -> Array:
	var t := (1.0 + sqrt(5.0)) / 2.0
	var v: Array = []
	for p in [Vector3(-1, t, 0), Vector3(1, t, 0), Vector3(-1, -t, 0), Vector3(1, -t, 0), Vector3(0, -1, t), Vector3(0, 1, t), Vector3(0, -1, -t), Vector3(0, 1, -t), Vector3(t, 0, -1), Vector3(t, 0, 1), Vector3(-t, 0, -1), Vector3(-t, 0, 1)]:
		v.append((p as Vector3).normalized())
	var f: Array = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1]
	for s in sub:
		var cache := {}
		var nf: Array = []
		for i in range(0, f.size(), 3):
			var a: int = f[i]
			var b: int = f[i + 1]
			var c: int = f[i + 2]
			var ab := _mid(v, cache, a, b)
			var bc := _mid(v, cache, b, c)
			var ca := _mid(v, cache, c, a)
			nf.append_array([a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca])
		f = nf
	return [PackedVector3Array(v), PackedInt32Array(f)]


static func _mid(v: Array, cache: Dictionary, a: int, b: int) -> int:
	var key := mini(a, b) * 100000 + maxi(a, b)
	if cache.has(key):
		return cache[key]
	v.append(((v[a] as Vector3) + (v[b] as Vector3)).normalized())
	cache[key] = v.size() - 1
	return v.size() - 1


# displaced surface point for a unit direction; .w of the Plane-free result: radius before stretch
static func _rock_pt(dir: Vector3, n: FastNoiseLite, shp: Dictionary) -> Vector3:
	var off: Vector3 = shp["off"]
	var r: float = 1.0 + float(shp["a1"]) * n.get_noise_3dv(dir * 1.15 + off) + float(shp["a2"]) * n.get_noise_3dv(dir * 3.4 - off)
	for c in shp["craters"]:
		var ang := acos(clampf(dir.dot(c[0]), -1.0, 1.0))
		var rad: float = c[1]
		if ang < rad:
			var q := ang / rad
			r -= float(c[2]) * (1.0 - q * q)
		elif ang < rad * 1.3:
			r += float(c[2]) * 0.22 * (1.0 - (ang - rad) / (rad * 0.3))
	var p := dir * r
	for pl in shp["planes"]:
		var d: float = p.dot(pl[0])
		if d > float(pl[1]):
			p -= (pl[0] as Vector3) * ((d - float(pl[1])) * 0.9)
	return p


# one asteroid shape: {"mesh": ArrayMesh, "hull": PackedVector3Array}, bounding radius 1
static func _rock_variant(sub: int, seed_v: int, flat: bool, rough: float = 1.0) -> Dictionary:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_v * 7919 + 13
	var n := FastNoiseLite.new()
	n.seed = seed_v
	n.frequency = 1.0
	n.fractal_octaves = 3
	var shp := {"off": Vector3(rng.randf_range(-40, 40), rng.randf_range(-40, 40), rng.randf_range(-40, 40)), "a1": 0.34 * rough, "a2": 0.13 * rough, "craters": [], "planes": []}
	for i in (rng.randi_range(2, 5) if sub >= 2 else 1):
		shp["craters"].append([_rdir(rng), rng.randf_range(0.22, 0.6), rng.randf_range(0.06, 0.17)])
	for i in rng.randi_range(2, 4):
		shp["planes"].append([_rdir(rng), rng.randf_range(0.6, 0.86)])
	var stretch := Vector3(rng.randf_range(0.78, 1.0), rng.randf_range(0.6, 0.9), rng.randf_range(0.85, 1.0))
	var ico := _ico(sub)
	var dirs: PackedVector3Array = ico[0]
	var idx: PackedInt32Array = ico[1]
	var pts := PackedVector3Array()
	pts.resize(dirs.size())
	var rad := PackedFloat32Array()
	rad.resize(dirs.size())
	var mx := 0.0
	var rmin := 1e9
	var rmax := 0.0
	for i in dirs.size():
		var p := _rock_pt(dirs[i], n, shp)
		var pr := p.length()
		rad[i] = pr
		rmin = minf(rmin, pr)
		rmax = maxf(rmax, pr)
		p *= stretch
		pts[i] = p
		mx = maxf(mx, p.length())
	var inv := 1.0 / mx
	for i in pts.size():
		pts[i] *= inv
	# collision hull: the same surface sampled on a coarse sphere
	var hull := PackedVector3Array()
	var hd: PackedVector3Array = _ico(1)[0] if sub >= 2 else dirs
	for d in hd:
		hull.append(_rock_pt(d, n, shp) * stretch * inv)
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	var span := maxf(rmax - rmin, 0.001)
	if flat:
		var v := PackedVector3Array()
		var nn := PackedVector3Array()
		var cc := PackedColorArray()
		for i in range(0, idx.size(), 3):
			var a := pts[idx[i]]
			var b := pts[idx[i + 1]]
			var c := pts[idx[i + 2]]
			var g := (b - a).cross(c - a)
			if g.dot(a + b + c) > 0.0:
				var tmp := b
				b = c
				c = tmp
			else:
				g = -g
			g = g.normalized()
			var shd := rng.randf_range(0.78, 1.08)
			for p in [a, b, c]:
				v.append(p)
				nn.append(g)
				cc.append(Color(shd, shd, shd))
		arr[Mesh.ARRAY_VERTEX] = v
		arr[Mesh.ARRAY_NORMAL] = nn
		arr[Mesh.ARRAY_COLOR] = cc
	else:
		var nrm := PackedVector3Array()
		nrm.resize(pts.size())
		var oi := PackedInt32Array()
		for i in range(0, idx.size(), 3):
			var ia := idx[i]
			var ib := idx[i + 1]
			var ic := idx[i + 2]
			var g := (pts[ib] - pts[ia]).cross(pts[ic] - pts[ia])
			if g.dot(pts[ia] + pts[ib] + pts[ic]) > 0.0:
				oi.append_array([ia, ic, ib])
			else:
				g = -g
				oi.append_array([ia, ib, ic])
			nrm[ia] += g
			nrm[ib] += g
			nrm[ic] += g
		var cc := PackedColorArray()
		cc.resize(pts.size())
		for i in pts.size():
			nrm[i] = nrm[i].normalized()
			var s := clampf(lerpf(0.58, 1.06, (rad[i] - rmin) / span), 0.5, 1.1)
			cc[i] = Color(s, s, s)
		arr[Mesh.ARRAY_VERTEX] = pts
		arr[Mesh.ARRAY_NORMAL] = nrm
		arr[Mesh.ARRAY_COLOR] = cc
		arr[Mesh.ARRAY_INDEX] = oi
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return {"mesh": m, "hull": hull}


static func _rdir(rng: RandomNumberGenerator) -> Vector3:
	var z := rng.randf_range(-1.0, 1.0)
	var a := rng.randf() * TAU
	var s := sqrt(maxf(0.0, 1.0 - z * z))
	return Vector3(cos(a) * s, z, sin(a) * s)


static func _rbasis(rng: RandomNumberGenerator) -> Basis:
	return Basis(_rdir(rng), rng.randf() * TAU)


static func _rock_mat(tumble: float) -> ShaderMaterial:
	var sh := Shader.new()
	sh.code = ROCK_CODE
	var m := ShaderMaterial.new()
	m.shader = sh
	m.set_shader_parameter("grunge", Tex.grunge)
	m.set_shader_parameter("tumble", tumble)
	var rw: Dictionary = Tex.sets.get("cliff_side", {})
	if rw.is_empty():
		m.set_shader_parameter("det_amt", 0.0)
	else:
		m.set_shader_parameter("wall_alb", rw["alb"])
		m.set_shader_parameter("wall_nr", rw["nr"])
		m.set_shader_parameter("wall_avg", rw["avg"])
	return m


static func _seg_d(p: Vector3, a: Vector3, b: Vector3) -> float:
	var ab := b - a
	var t := clampf((p - a).dot(ab) / maxf(ab.length_squared(), 0.0001), 0.0, 1.0)
	return p.distance_to(a + ab * t)


static func _lane_d(p: Vector3, lane: Array) -> float:
	var best := 1e9
	for i in lane.size() - 1:
		best = minf(best, _seg_d(p, lane[i], lane[i + 1]))
	return best


static func _lane_near(p: Vector3, lane: Array) -> Vector3:
	var best := 1e9
	var out: Vector3 = lane[0]
	for i in lane.size() - 1:
		var a: Vector3 = lane[i]
		var ab: Vector3 = lane[i + 1] - a
		var t := clampf((p - a).dot(ab) / maxf(ab.length_squared(), 0.0001), 0.0, 1.0)
		var q := a + ab * t
		var d := p.distance_to(q)
		if d < best:
			best = d
			out = q
	return out


static func _tint(rng: RandomNumberGenerator) -> Color:
	var g := rng.randf_range(0.72, 1.2)
	if rng.randf() < 0.25:
		# stony, lighter and warmer
		return Color(g * 1.5, g * 1.3, g * 1.05)
	var w := rng.randf_range(-0.06, 0.1)
	return Color(g * (1.0 + w), g, g * (1.0 - w))


static func _mmi(world: Node3D, mesh: Mesh, mat: Material, xfs: Array, cols: Array, custom: Array, shadows: bool) -> void:
	if xfs.is_empty():
		return
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.use_custom_data = not custom.is_empty()
	mm.mesh = mesh
	mm.instance_count = xfs.size()
	for i in xfs.size():
		mm.set_instance_transform(i, xfs[i])
		mm.set_instance_color(i, cols[i])
		if mm.use_custom_data:
			mm.set_instance_custom_data(i, custom[i])
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.extra_cull_margin = 16.0
	world.add_child(mi)


# surface point of a placed rock furthest along dir
static func _rock_top(hull: PackedVector3Array, xf: Transform3D, dir: Vector3) -> Vector3:
	var best := -1e9
	var out := xf.origin
	for h in hull:
		var p := xf * h
		var d := p.dot(dir)
		if d > best:
			best = d
			out = p
	return out


# ------------------------------------------------------------------ the belt
static func _build_belt(world: Node3D, ctx: Dictionary, pts: Dictionary) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 4711
	var mat := _rock_mat(0.0)
	var mat_t := _rock_mat(1.0)
	var big: Array = []
	for i in 6:
		big.append(_rock_variant(3, 101 + i, false))
	var med: Array = []
	for i in 3:
		med.append(_rock_variant(2, 211 + i, false))
	var chunk: Array = []
	for i in 2:
		chunk.append(_rock_variant(1, 307 + i, true, 1.2))
	var shard: Array = []
	for i in 2:
		shard.append(_rock_variant(0, 401 + i, true, 1.5))
	# volumes that must stay empty: ships, spawn, structures, squads
	var keep: Array = [[ALLY_SHIP, 240.0], [SPAWN, 70.0], [ENEMY_SHIPS[0], 330.0], [ENEMY_SHIPS[1], 190.0], [Vector3(-380, 90, 380), 110.0], [Vector3(780, 130, 200), 190.0], [Vector3(-760, -60, 40), 110.0], [Vector3(-620, 20, -760), 110.0], [Vector3(560, -70, -1050), 100.0]]
	for p in WAVES:
		keep.append([p, 60.0])
	for p in AMBUSH:
		keep.append([p, 60.0])
	var rocks: Array = []      # {"p", "r", "v", "xf"}
	# hero rocks first, then random large ones
	for h in HEROES:
		rocks.append({"p": h[0], "r": h[1], "v": rng.randi() % big.size()})
	var tries := 0
	while rocks.size() < 58 and tries < 6000:
		tries += 1
		var p := Vector3(rng.randf_range(-1480.0, 1480.0), clampf(rng.randfn(0.0, 125.0), -340.0, 340.0), rng.randf_range(-1440.0, -160.0))
		var r := lerpf(46.0, 112.0, pow(rng.randf(), 2.2))
		var zk := minf(p.z + 1440.0, -160.0 - p.z) / 160.0
		if zk < 1.0 and rng.randf() > zk:
			continue
		if _lane_d(p, LANE) < r + 112.0 or _lane_d(p, LANE_B) < r * 0.9 + 52.0 or _lane_d(p, LANE_C) < r * 0.9 + 52.0:
			continue
		if not _free(p, r, keep, rocks, 0.9) or not _free_sites(p, r + 60.0):
			continue
		rocks.append({"p": p, "r": r, "v": rng.randi() % big.size()})
	var bxf: Array = []
	var bcol: Array = []
	for i in big.size():
		bxf.append([])
		bcol.append([])
	for rk in rocks:
		var xf := Transform3D(_rbasis(rng), rk["p"])
		rk["xf"] = xf
		var v: Dictionary = big[int(rk["v"])]
		bxf[int(rk["v"])].append(Transform3D(xf.basis.scaled(Vector3.ONE * float(rk["r"])), xf.origin))
		bcol[int(rk["v"])].append(_tint(rng))
		_chull(ctx, v["hull"], xf, float(rk["r"]))
		_col(ctx, rk["p"], float(rk["r"]) * 0.8)
		(ctx["rocks"] as Array).append([rk["p"], float(rk["r"])])
	for i in big.size():
		_mmi(world, (big[i] as Dictionary)["mesh"], mat, bxf[i], bcol[i], [], true)
	var n_big := rocks.size()
	# medium rocks: platform sites, then clusters around the big ones and loose singles
	var mxf: Array = [[], [], [], [], [], []]
	var mcol: Array = [[], [], [], [], [], []]
	var meds: Array = []
	for i in PLATFORM_ROCKS.size():
		var p: Vector3 = PLATFORM_ROCKS[i]
		var xf := Transform3D(_rbasis(rng), p)
		meds.append({"p": p, "r": 40.0, "v": 0, "xf": xf})
		var dir := (_lane_near(p, LANE) - p).normalized()
		dir = (dir + Vector3(0, 0.25 if p.y < 0.0 else -0.25, 0)).normalized()
		var top := _rock_top((med[0] as Dictionary)["hull"], Transform3D(xf.basis.scaled(Vector3.ONE * 40.0), p), dir)
		(pts["platforms"] as Array).append(top + dir * 0.6)
		(pts["platform_up"] as Array).append(dir)
	tries = 0
	while meds.size() < 235 and tries < 12000:
		tries += 1
		var r := lerpf(13.0, 44.0, pow(rng.randf(), 1.8))
		var p: Vector3
		var roll := rng.randf()
		if roll < 0.5:
			var par: Dictionary = rocks[rng.randi() % n_big]
			p = (par["p"] as Vector3) + _rdir(rng) * (float(par["r"]) * rng.randf_range(1.05, 2.3) + r)
		elif roll < 0.92:
			p = Vector3(rng.randf_range(-1480.0, 1480.0), clampf(rng.randfn(0.0, 135.0), -360.0, 360.0), rng.randf_range(-1460.0, -140.0))
		else:
			p = Vector3(rng.randf_range(-1450.0, 1450.0), clampf(rng.randfn(0.0, 160.0), -380.0, 380.0), rng.randf_range(-1750.0, 380.0))
		if _lane_d(p, LANE) < r + 88.0 or _lane_d(p, LANE_B) < r + 30.0 or _lane_d(p, LANE_C) < r + 30.0:
			continue
		if not _free(p, r, keep, rocks, 0.85) or not _free(p, r, [], meds, 0.85) or not _free_sites(p, r + 40.0):
			continue
		meds.append({"p": p, "r": r, "v": rng.randi() % med.size(), "xf": Transform3D(_rbasis(rng), p)})
	for rk in meds:
		var xf: Transform3D = rk["xf"]
		var r: float = rk["r"]
		var p: Vector3 = rk["p"]
		var key := int(rk["v"]) * 2 + (0 if p.z > -800.0 else 1)
		mxf[key].append(Transform3D(xf.basis.scaled(Vector3.ONE * r), p))
		mcol[key].append(_tint(rng))
		_chull(ctx, (med[int(rk["v"])] as Dictionary)["hull"], xf, r)
		(ctx["rocks"] as Array).append([p, r])
	for key in 6:
		_mmi(world, (med[key / 2] as Dictionary)["mesh"], mat, mxf[key], mcol[key], [], true)
	# debris: boulders (5-12 m) and shards (1-5 m), most of it in clouds around bigger rocks.
	# No collision; it tumbles in the vertex shader.
	var parents: Array = rocks + meds
	var extra_c: Array = [[MEGA + Vector3(-430, 40, 250), 170.0], [Vector3(-620, 20, -760), 120.0], [Vector3(560, -70, -1050), 110.0], [MEGA + Vector3(-200, -60, 480), 150.0]]
	for cls in 2:
		var count := 520 if cls == 0 else 2400
		var vars: Array = chunk if cls == 0 else shard
		var dxf: Array = []
		var dcol: Array = []
		var dcus: Array = []
		for i in vars.size() * 2:
			dxf.append([])
			dcol.append([])
			dcus.append([])
		var made := 0
		tries = 0
		while made < count and tries < count * 6:
			tries += 1
			var r := lerpf(5.0, 12.0, pow(rng.randf(), 1.6)) if cls == 0 else lerpf(1.2, 5.0, pow(rng.randf(), 1.8))
			var p: Vector3
			var roll := rng.randf()
			if roll < 0.56:
				var par: Dictionary = parents[rng.randi() % parents.size()]
				p = (par["p"] as Vector3) + _rdir(rng) * (float(par["r"]) * rng.randf_range(1.0, 2.7) + r + rng.randf_range(0.0, 30.0))
			elif roll < 0.62:
				var ec: Array = extra_c[rng.randi() % extra_c.size()]
				p = (ec[0] as Vector3) + _rdir(rng) * (float(ec[1]) * sqrt(rng.randf()))
			elif roll < 0.9:
				p = Vector3(rng.randf_range(-1490.0, 1490.0), clampf(rng.randfn(0.0, 150.0), -420.0, 420.0), rng.randf_range(-1520.0, -80.0))
			else:
				p = Vector3(rng.randf_range(-1490.0, 1490.0), clampf(rng.randfn(0.0, 180.0), -430.0, 430.0), rng.randf_range(-2550.0, 850.0))
			if _lane_d(p, LANE) < r + 52.0:
				continue
			var ok := true
			for kp in keep:
				if p.distance_to(kp[0]) < float(kp[1]) * 0.75:
					ok = false
					break
			if not ok:
				continue
			var vi := rng.randi() % vars.size()
			var key := vi * 2 + (0 if p.z > -800.0 else 1)
			var sc := Vector3(r, r * rng.randf_range(0.6, 1.0), r * rng.randf_range(0.7, 1.0))
			dxf[key].append(Transform3D(_rbasis(rng).scaled(sc), p))
			dcol[key].append(_tint(rng))
			var ax := _rdir(rng)
			dcus[key].append(Color(ax.x, ax.y, ax.z, rng.randf_range(0.03, 0.22) * (1.0 if cls == 0 else 1.8)))
			made += 1
		for key in dxf.size():
			_mmi(world, (vars[key / 2] as Dictionary)["mesh"], mat_t, dxf[key], dcol[key], dcus[key], false)
	ctx["hero_xf"] = rocks[0]["xf"]
	ctx["hero_hull"] = (big[int(rocks[0]["v"])] as Dictionary)["hull"]
	ctx["hero_r"] = rocks[0]["r"]


static func _free(p: Vector3, r: float, keep: Array, others: Array, k: float) -> bool:
	for kp in keep:
		if p.distance_to(kp[0]) < r + float(kp[1]):
			return false
	for o in others:
		if p.distance_to(o["p"]) < (r + float(o["r"])) * k:
			return false
	return true


static func _free_sites(p: Vector3, r: float) -> bool:
	for s in PLATFORM_ROCKS:
		if p.distance_to(s) < r + 40.0:
			return false
	return true


static func _chull(ctx: Dictionary, hull: PackedVector3Array, xf: Transform3D, r: float) -> void:
	var pts := PackedVector3Array()
	pts.resize(hull.size())
	for i in hull.size():
		pts[i] = hull[i] * r
	var s := ConvexPolygonShape3D.new()
	s.points = pts
	_cshape(ctx, s, xf)


# ------------------------------------------------------------------ the derelict ring station
# "Halo-9": a broken habitat ring 1.1 km across on a 1.4 km spindle, with a shipyard cradle
# on the side facing the anchorage. Local frame: Y = spindle axis, ring in the XZ plane.
static func _build_mega(world: Node3D, ctx: Dictionary, st: Dictionary) -> void:
	var mats := _mats(st)
	var T := Transform3D(Basis.from_euler(Vector3(deg_to_rad(6.0), 0.3, deg_to_rad(-12.0))), MEGA)
	var mg := Node3D.new()
	mg.name = "RingStation"
	mg.transform = T
	world.add_child(mg)
	var k = _kit(31)
	var rng := RandomNumberGenerator.new()
	rng.seed = 97
	var R := MEGA_R
	var SEG := 48
	var da := TAU / float(SEG)
	var seg_len := 2.0 * R * tan(da * 0.5)
	# the ring is baked as two halves
	var quad: Array = []
	for q in 2:
		quad.append(k.bone(mg))
	var hub = k.bone(mg)
	var RW := 96.0
	var RH := 62.0
	for i in SEG:
		var a := (float(i) + 0.5) * da
		var b: Node3D = quad[i * 2 / SEG]
		var c := Vector3(cos(a), 0, sin(a))
		var tn := Vector3(-sin(a), 0, cos(a))
		var ry := Vector3(0, -a, 0)
		var gap := i >= 20 and i <= 28
		var skel := i == 19 or i == 29 or i == 30 or i == 6 or i == 40
		if gap:
			continue
		# rib frames at both ends of every remaining segment
		for e: float in [-0.5, 0.5]:
			var pe := c * R + tn * (seg_len * e)
			k.box(b, "D", Vector3(RW + 10.0, 5, 6), pe + Vector3(0, RH * 0.5 + 2.0, 0), ry, {}, 0.8)
			k.box(b, "D", Vector3(RW + 10.0, 5, 6), pe + Vector3(0, -RH * 0.5 - 2.0, 0), ry, {}, 0.8)
			k.box(b, "D", Vector3(5, RH + 9.0, 6), pe + c * (RW * 0.5 + 2.5), ry, {}, 0.8)
			k.box(b, "D", Vector3(5, RH + 9.0, 6), pe - c * (RW * 0.5 + 2.5), ry, {}, 0.8)
		if skel:
			for sx: float in [-1.0, 1.0]:
				for sy: float in [-1.0, 1.0]:
					var o := c * (R + sx * (RW * 0.5 - 3.0)) + Vector3(0, sy * (RH * 0.5 - 3.0), 0)
					_beam(k, b, "S", o - tn * seg_len * 0.5, o + tn * seg_len * 0.5, 4.5)
			_beam(k, b, "R", c * (R - RW * 0.5 + 3.0) + Vector3(0, RH * 0.5 - 3.0, 0) - tn * seg_len * 0.5, c * (R + RW * 0.5 - 3.0) + Vector3(0, -RH * 0.5 + 3.0, 0) + tn * seg_len * 0.5, 3.0)
			_beam(k, b, "S", c * (R + RW * 0.5 - 3.0) + Vector3(0, RH * 0.5 - 3.0, 0) - tn * seg_len * 0.5, c * (R - RW * 0.5 + 3.0) + Vector3(0, RH * 0.5 - 3.0, 0) + tn * seg_len * 0.5, 3.0)
			k.box(b, "W", Vector3(RW * 0.5, 3, seg_len * 0.6), c * (R + RW * 0.2) + Vector3(0, -RH * 0.5 + 3.0, 0), ry)
			_cbox(ctx, T * Transform3D(Basis.from_euler(ry), c * R + Vector3(0, RH * 0.5 - 3.0, 0)), Vector3(RW, 6, seg_len))
			_cbox(ctx, T * Transform3D(Basis.from_euler(ry), c * R - Vector3(0, RH * 0.5 - 3.0, 0)), Vector3(RW, 6, seg_len))
			continue
		var key := "S" if rng.randf() < 0.6 else ("L" if rng.randf() < 0.55 else "R")
		k.box(b, key, Vector3(RW, RH, seg_len + 0.5), c * R, ry, {"tx": 0.8, "bx": 0.88})
		# roof spine and underside service gallery
		k.box(b, "L" if key != "L" else "S", Vector3(RW * 0.36, 9, seg_len + 0.5), c * R + Vector3(0, RH * 0.5 + 4.0, 0), ry, {"tx": 0.7})
		k.box(b, "D", Vector3(RW * 0.5, 7, seg_len * 0.94), c * R + Vector3(0, -RH * 0.5 - 3.0, 0), ry, {"bx": 0.8}, 0.7)
		# inner promenade glazing: mostly dark, a few stretches still lit
		var gx := R - RW * 0.5 + 1.7
		k.box(b, "D", Vector3(4.0, 8, seg_len * 0.86), c * gx + Vector3(0, 10, 0), ry, {}, 0.5)
		k.box(b, "D", Vector3(4.0, 5, seg_len * 0.86), c * (gx + 2.0) + Vector3(0, -14, 0), ry, {}, 0.5)
		if rng.randf() < 0.42:
			for w in 5:
				if rng.randf() < 0.75:
					k.box(b, "G", Vector3(0.8, 2.6, 8.0), c * (gx - 2.2) + Vector3(0, 10, 0) + tn * ((w - 2) * 12.5), ry)
			if rng.randf() < 0.5:
				for w in 7:
					if rng.randf() < 0.6:
						k.box(b, "G", Vector3(0.8, 1.6, 5.0), c * (gx - 0.2) + Vector3(0, -14, 0) + tn * ((w - 3) * 9.0), ry)
		# outer service trench, pipes and tanks
		k.box(b, "D", Vector3(5, 14, seg_len * 0.9), c * (R + RW * 0.5 - 4.0), ry, {}, 0.6)
		_beam(k, b, "R", c * (R + 28.0) + Vector3(0, RH * 0.5 + 0.5, 0) - tn * seg_len * 0.5, c * (R + 28.0) + Vector3(0, RH * 0.5 + 0.5, 0) + tn * seg_len * 0.5, 6.0)
		_beam(k, b, "L", c * (R - 26.0) + Vector3(0, RH * 0.5, 0) - tn * seg_len * 0.5, c * (R - 26.0) + Vector3(0, RH * 0.5, 0) + tn * seg_len * 0.5, 3.6)
		if rng.randf() < 0.5:
			k.box(b, "L" if key == "S" else "S", Vector3(26, 13, 36), c * (R + 22.0 * (1.0 if rng.randf() < 0.5 else -1.0)) + Vector3(0, RH * 0.5 + 5.0, 0) + tn * rng.randf_range(-12.0, 12.0), ry, {"tx": 0.8, "tz": 0.8})
		if rng.randf() < 0.4:
			k.cyl(b, "R", 9.0, 9.0, 44.0, c * (R + 12.0) + Vector3(0, -RH * 0.5 - 11.0, 0), Vector3(HZ, -a, 0), 10)
		if rng.randf() < 0.3:
			k.box(b, "H", Vector3(RW * 0.82, 3, 5), c * R + Vector3(0, RH * 0.5 - 1.0, 0) + tn * (seg_len * 0.3), ry)
		_cbox(ctx, T * Transform3D(Basis.from_euler(ry), c * R), Vector3(RW * 0.9, RH, seg_len))
		if i % 6 == 3:
			_col(ctx, T * (c * R), 50.0)
	# torn ends of the ring: bent girders and plates
	for e in [[19.0 * da, 1.0], [30.0 * da + da, -1.0]]:
		var a: float = e[0]
		var c := Vector3(cos(a), 0, sin(a)) * R
		var tn := Vector3(-sin(a), 0, cos(a)) * float(e[1])
		var b: Node3D = quad[clampi(int(a / TAU * 2.0), 0, 1)]
		for j in 9:
			var o := Vector3(rng.randf_range(-46, 46), rng.randf_range(-30, 30), 0)
			var o2 := Vector3(c.x, 0, c.z).normalized() * o.x + Vector3(0, o.y, 0)
			_beam(k, b, "W", c + o2, c + o2 + tn * rng.randf_range(20, 70) + Vector3(rng.randf_range(-18, 18), rng.randf_range(-22, 22), rng.randf_range(-18, 18)), rng.randf_range(1.5, 3.5))
		k.box(b, "X", Vector3(4, 4, 4), c + Vector3(0, 38, 0))
	# drifting ring fragments in the gap
	for fr in [[23.0, 60.0, -30.0], [25.5, -90.0, 80.0], [27.0, 30.0, -120.0]]:
		var a: float = float(fr[0]) * da
		var c := Vector3(cos(a), 0, sin(a)) * (R + float(fr[2])) + Vector3(0, fr[1], 0)
		var rot := Vector3(rng.randf_range(-0.7, 0.7), -a + rng.randf_range(-0.6, 0.6), rng.randf_range(-0.7, 0.7))
		var b: Node3D = quad[clampi(int(a / TAU * 2.0), 0, 1)]
		var sz := Vector3(96, 62, rng.randf_range(34.0, 60.0))
		k.box(b, "W", sz, c, rot, {"tx": 0.84, "bx": 0.9})
		k.box(b, "D", Vector3(106, 5, 6), c + Basis.from_euler(rot) * Vector3(0, 33, sz.z * 0.5), rot)
		_cbox(ctx, T * Transform3D(Basis.from_euler(rot), c), sz)
	# spokes: paired lattice girders with a transit tube
	for si in [2, 10, 15, 34, 39, 45]:
		var a := (float(si) + 0.5) * da
		var c := Vector3(cos(a), 0, sin(a))
		_truss(k, hub, "S", c * 96.0, c * (R - 48.0), 30.0, 9, 3.0)
		_beam(k, hub, "L", c * 96.0, c * (R - 48.0), 9.0)
		_cbeam(ctx, T, c * 96.0, c * (R - 48.0), 30.0, 30.0)
	# snapped spokes pointing into the gap
	for sb in [[22.5, 250.0], [26.5, 170.0]]:
		var a: float = float(sb[0]) * da
		var c := Vector3(cos(a), 0, sin(a))
		_truss(k, hub, "W", c * 96.0, c * float(sb[1]), 26.0, 3, 2.6)
		_beam(k, hub, "W", c * float(sb[1]), c * (float(sb[1]) + 40.0) + Vector3(0, -24, 14), 4.0)
		_cbeam(ctx, T, c * 96.0, c * float(sb[1]), 26.0, 26.0)
	# hub and spindle
	k.cyl(hub, "S", 96.0, 96.0, 150.0, Vector3.ZERO, Vector3.ZERO, 28)
	for y: float in [-66.0, 0.0, 66.0]:
		k.cyl(hub, "D", 99.0, 99.0, 7.0, Vector3(0, y, 0), Vector3.ZERO, 28, 0.7)
	for i in 14:
		var a := rng.randf() * TAU
		if rng.randf() < 0.5:
			k.box(hub, "G", Vector3(9, 2.2, 1.0), Vector3(cos(a), 0, sin(a)) * 96.4 + Vector3(0, rng.randf_range(-50, 50), 0), Vector3(0, HZ - a, 0))
	k.cyl(hub, "L", 70.0, 96.0, 30.0, Vector3(0, 90, 0), Vector3.ZERO, 28)
	k.cyl(hub, "L", 96.0, 70.0, 30.0, Vector3(0, -90, 0), Vector3.ZERO, 28)
	k.cyl(hub, "S", 44.0, 48.0, 240.0, Vector3(0, 225, 0), Vector3.ZERO, 20)
	for y: float in [150.0, 215.0, 280.0]:
		k.cyl(hub, "R", 52.0, 52.0, 9.0, Vector3(0, y, 0), Vector3.ZERO, 20)
	k.cyl(hub, "R", 124.0, 118.0, 20.0, Vector3(0, 352, 0), Vector3.ZERO, 28)
	k.cyl(hub, "D", 126.0, 126.0, 4.0, Vector3(0, 352, 0), Vector3.ZERO, 28, 0.6)
	for i in 6:
		var a := float(i) * TAU / 6.0
		k.box(hub, "S", Vector3(30, 14, 46), Vector3(cos(a), 0, sin(a)) * 120.0 + Vector3(0, 360, 0), Vector3(0, HZ - a, 0), {"tz": 0.7})
		k.box(hub, "H", Vector3(31, 2, 47), Vector3(cos(a), 0, sin(a)) * 120.0 + Vector3(0, 352, 0), Vector3(0, HZ - a, 0))
	k.cyl(hub, "S", 15.0, 26.0, 60.0, Vector3(0, 392, 0), Vector3.ZERO, 14)
	k.cyl(hub, "L", 7.0, 15.0, 300.0, Vector3(0, 572, 0), Vector3.ZERO, 10)
	for y: float in [470.0, 540.0, 640.0]:
		_beam(k, hub, "D", Vector3(-50, y, 0), Vector3(50, y, 0), 2.5)
		_beam(k, hub, "D", Vector3(0, y + 8.0, -40), Vector3(0, y + 8.0, 40), 2.5)
	k.cyl(hub, "L", 34.0, 3.0, 12.0, Vector3(46, 474, 0), Vector3(0, 0, -1.1), 14)
	k.cyl(hub, "L", 26.0, 3.0, 10.0, Vector3(0, 552, -38), Vector3(1.0, 0, 0), 14)
	k.box(hub, "X", Vector3(4, 4, 4), Vector3(0, 724, 0))
	k.box(hub, "X", Vector3(4, 4, 4), Vector3(50, 542, 0))
	# lower spindle: reactor bulb, radiator fins, tail spike
	k.cyl(hub, "S", 48.0, 40.0, 60.0, Vector3(0, -135, 0), Vector3.ZERO, 20)
	k.ball(hub, "R", Vector3(92, 104, 92), Vector3(0, -250, 0))
	k.cyl(hub, "D", 94.0, 94.0, 8.0, Vector3(0, -250, 0), Vector3.ZERO, 24, 0.7)
	k.cyl(hub, "D", 80.0, 80.0, 6.0, Vector3(0, -196, 0), Vector3.ZERO, 24, 0.7)
	for i in 4:
		var a := float(i) * HZ + 0.6
		var c := Vector3(cos(a), 0, sin(a))
		var bent := i == 2
		var rot := Vector3(0, -a, 0.42 if bent else 0.0)
		var fc := c * 230.0 + Vector3(0, -250.0 - (50.0 if bent else 0.0), 0)
		k.box(hub, "P", Vector3(270, 3, 104), fc, rot)
		k.box(hub, "S", Vector3(280, 6, 6), fc + Vector3(0, 3, 0), rot)
		for j in 5:
			k.box(hub, "D", Vector3(2.5, 4.5, 104), fc + Basis.from_euler(rot) * Vector3(-110.0 + j * 55.0, 0, 0), rot, {}, 0.7)
		_cbox(ctx, T * Transform3D(Basis.from_euler(rot), fc), Vector3(270, 6, 104))
	k.cyl(hub, "S", 40.0, 6.0, 380.0, Vector3(0, -540, 0), Vector3.ZERO, 16)
	k.cyl(hub, "R", 46.0, 46.0, 10.0, Vector3(0, -372, 0), Vector3.ZERO, 16)
	k.box(hub, "X", Vector3(4, 4, 4), Vector3(0, -734, 0))
	_ccyl(ctx, T, 96.0, 210.0)
	_ccyl(ctx, T * Transform3D(Basis.IDENTITY, Vector3(0, 225, 0)), 48.0, 240.0)
	_ccyl(ctx, T * Transform3D(Basis.IDENTITY, Vector3(0, 352, 0)), 124.0, 24.0)
	_ccyl(ctx, T * Transform3D(Basis.IDENTITY, Vector3(0, 540, 0)), 16.0, 360.0)
	_ccyl(ctx, T * Transform3D(Basis.IDENTITY, Vector3(0, -135, 0)), 46.0, 60.0)
	_ccyl(ctx, T * Transform3D(Basis.IDENTITY, Vector3(0, -250, 0)), 92.0, 190.0)
	_ccyl(ctx, T * Transform3D(Basis.IDENTITY, Vector3(0, -500, 0)), 30.0, 300.0)
	_col(ctx, MEGA, 110.0)
	for m in k.bake(mats):
		m.layers = 1
	# shipyard cradle around the battleship berth (world aligned; the ship lies along Z)
	var B: Vector3 = ENEMY_SHIPS[0]
	var dock := Node3D.new()
	dock.name = "Shipyard"
	dock.position = B
	world.add_child(dock)
	var DT := Transform3D(Basis.IDENTITY, B)
	var kd = _kit(41)
	var db = kd.bone(dock)
	var z0 := -300.0
	var z1 := 190.0
	var bx := 128.0
	var by := 112.0
	for sx: float in [-1.0, 1.0]:
		for sy: float in [-1.0, 1.0]:
			var a := Vector3(sx * bx, sy * by, z0)
			var c := Vector3(sx * bx, sy * by, z1 if sy > 0.0 else z1 - 110.0)
			_truss(kd, db, "S", a, c, 22.0, 14, 2.4)
			_cbeam(ctx, DT, a, c, 22.0, 22.0)
			kd.box(db, "X", Vector3(3, 3, 3), c + Vector3(0, sy * 13.0, 0))
	# frames: a closed stern wall, then open hoops the ship sits inside
	for fz: float in [z0, -190.0, -70.0, 60.0]:
		var top_only := fz > 50.0
		for sy: float in ([1.0] if top_only else [-1.0, 1.0]):
			_truss(kd, db, "S", Vector3(-bx, sy * by, fz), Vector3(bx, sy * by, fz), 16.0, 8, 2.0)
			_cbeam(ctx, DT, Vector3(-bx, sy * by, fz), Vector3(bx, sy * by, fz), 16.0, 16.0)
		if not top_only:
			for sx: float in [-1.0, 1.0]:
				_truss(kd, db, "S", Vector3(sx * bx, -by, fz), Vector3(sx * bx, by, fz), 16.0, 7, 2.0)
				_cbeam(ctx, DT, Vector3(sx * bx, -by, fz), Vector3(sx * bx, by, fz), 16.0, 16.0)
	_beam(kd, db, "R", Vector3(-bx, -by, z0), Vector3(bx, by, z0), 5.0)
	_beam(kd, db, "R", Vector3(bx, -by, z0), Vector3(-bx, by, z0), 5.0)
	# yard control block and cranes
	kd.box(db, "L", Vector3(44, 30, 70), Vector3(bx + 34.0, by - 6.0, -250.0), Vector3.ZERO, {"tx": 0.8, "tz": 0.85})
	kd.box(db, "D", Vector3(45, 5, 50), Vector3(bx + 34.0, by - 2.0, -250.0), Vector3.ZERO, {}, 0.5)
	kd.box(db, "G", Vector3(0.8, 2.4, 40), Vector3(bx + 56.6, by - 2.0, -250.0))
	kd.box(db, "G", Vector3(30, 2.4, 0.8), Vector3(bx + 34.0, by - 2.0, -214.6))
	_cbox(ctx, DT * Transform3D(Basis.IDENTITY, Vector3(bx + 34.0, by - 6.0, -250.0)), Vector3(44, 30, 70))
	for cz: float in [-130.0, 0.0, 120.0]:
		var sx := 1.0 if cz < 0.0 or cz > 100.0 else -1.0
		_beam(kd, db, "H", Vector3(sx * bx, by, cz), Vector3(sx * 74.0, by - 8.0, cz), 6.0)
		_beam(kd, db, "D", Vector3(sx * 74.0, by - 8.0, cz), Vector3(sx * 70.0, by - 34.0, cz), 3.0)
		kd.box(db, "S", Vector3(12, 5, 12), Vector3(sx * 70.0, by - 36.0, cz), Vector3.ZERO, {"bx": 0.5, "bz": 0.5})
	for sx: float in [-1.0, 1.0]:
		kd.box(db, "G", Vector3(0.8, 1.6, 300), Vector3(sx * (bx - 11.5), by - 11.5, -110.0))
	# umbilical girders from the cradle's stern corners back to the ring
	var best_a := 0.0
	var best_d := 1e9
	for i in 96:
		var a := float(i) * TAU / 96.0
		var wp := T * (Vector3(cos(a), 0, sin(a)) * (R + 48.0))
		var d := wp.distance_to(B + Vector3(-bx, 0, z0))
		if d < best_d and (i * SEG / 96 < 19 or i * SEG / 96 > 30):
			best_d = d
			best_a = a
	for e in [[-0.07, -1.0], [0.07, 1.0]]:
		var a: float = best_a + float(e[0])
		var rp := T * (Vector3(cos(a), 0, sin(a)) * (R + 48.0)) - B
		var cp := Vector3(-bx - 11.0, float(e[1]) * by, z0 + (0.0 if float(e[1]) < 0.0 else 60.0))
		_truss(kd, db, "S", cp, rp, 18.0, int(clampf(cp.distance_to(rp) / 30.0, 3.0, 14.0)), 2.2)
		_cbeam(ctx, DT, cp, rp, 18.0, 18.0)
	for m in kd.bake(mats):
		m.layers = 1
	_col(ctx, B + Vector3(-bx, 0, -60), 30.0)
	_col(ctx, B + Vector3(bx, 0, -60), 30.0)


# ------------------------------------------------------------------ smaller structures
static func _build_structures(world: Node3D, ctx: Dictionary, st: Dictionary) -> void:
	var mats := _mats(st)
	# 1. relay station beside the staging area
	var p1 := Vector3(-380, 90, 380)
	var g1 := _group(world, "Relay", p1, Vector3(0.1, 0.5, 0.18))
	var k = _kit(51)
	var b = k.bone(g1)
	k.cyl(b, "L", 13.0, 13.0, 64.0, Vector3.ZERO, Vector3.ZERO, 16)
	k.cyl(b, "S", 17.0, 17.0, 10.0, Vector3(0, 18, 0), Vector3.ZERO, 16)
	k.cyl(b, "S", 17.0, 17.0, 10.0, Vector3(0, -18, 0), Vector3.ZERO, 16)
	k.cyl(b, "D", 6.0, 13.0, 12.0, Vector3(0, -38, 0), Vector3.ZERO, 12)
	k.box(b, "B", Vector3(1.0, 2.0, 12.0), Vector3(13.2, 4, 0))
	k.box(b, "B", Vector3(1.0, 2.0, 12.0), Vector3(-13.2, 4, 0))
	for sx: float in [-1.0, 1.0]:
		_truss(k, b, "S", Vector3(sx * 13.0, 0, 0), Vector3(sx * 34.0, 0, 0), 5.0, 3, 0.7)
		k.box(b, "P", Vector3(96, 1.0, 34), Vector3(sx * 84.0, 0, 0), Vector3(0.35, 0, 0))
		k.box(b, "S", Vector3(98, 1.6, 1.6), Vector3(sx * 84.0, 0, 0), Vector3(0.35, 0, 0))
		for j in 4:
			k.box(b, "D", Vector3(1.0, 1.4, 34), Vector3(sx * (48.0 + j * 24.0), 0, 0), Vector3(0.35, 0, 0), {}, 0.7)
		_cbox(ctx, g1.transform * Transform3D(Basis.from_euler(Vector3(0.35, 0, 0)), Vector3(sx * 84.0, 0, 0)), Vector3(96, 3, 34))
	k.box(b, "X", Vector3(2, 2, 2), Vector3(0, -45, 0))
	var dish = k.bone(b, Vector3(0, 34, 0))
	k.cyl(dish, "S", 3.0, 3.0, 14.0, Vector3(0, 7, 0), Vector3.ZERO, 8)
	k.cyl(dish, "L", 30.0, 3.0, 9.0, Vector3(0, 19, 8), Vector3(-0.9, 0, 0), 18)
	k.cyl(dish, "D", 0.8, 0.8, 22.0, Vector3(0, 26, 17), Vector3(-0.9, 0, 0), 6)
	st["dish"] = dish
	k.bake(mats)
	_ccyl(ctx, g1.transform, 14.0, 80.0)
	_col(ctx, p1, 40.0)
	# 2. solar farm east of the staging area
	var p2 := Vector3(780, 130, 200)
	var g2 := _group(world, "SolarFarm", p2, Vector3(0.25, -0.4, 0.1))
	k = _kit(52)
	b = k.bone(g2)
	_truss(k, b, "S", Vector3(0, 0, -170), Vector3(0, 0, 170), 9.0, 12, 1.0)
	_cbeam(ctx, g2.transform, Vector3(0, 0, -170), Vector3(0, 0, 170), 9.0, 9.0)
	for i in 5:
		var z := -136.0 + i * 68.0
		for sx: float in [-1.0, 1.0]:
			if i == 3 and sx > 0.0:
				# one wing torn off, a stub remains
				k.box(b, "W", Vector3(34, 1.0, 50), Vector3(sx * 26.0, 0, z), Vector3(0.0, 0.2, 0.5))
				continue
			var rot := Vector3(0, 0, sx * 0.12)
			k.box(b, "P", Vector3(118, 1.0, 56), Vector3(sx * 68.0, sx * 0.0 + 7.0, z), rot)
			k.box(b, "S", Vector3(120, 1.8, 1.8), Vector3(sx * 68.0, 7.0, z), rot)
			for j in 5:
				k.box(b, "D", Vector3(1.0, 1.5, 56), Basis.from_euler(rot) * Vector3(-48.0 + j * 24.0, 0, 0) + Vector3(sx * 68.0, 7.0, z), rot, {}, 0.7)
			_cbox(ctx, g2.transform * Transform3D(Basis.from_euler(rot), Vector3(sx * 68.0, 7.0, z)), Vector3(118, 3, 56))
	k.box(b, "L", Vector3(16, 12, 22), Vector3(0, 0, 182), Vector3.ZERO, {"tx": 0.7, "tz": 0.8})
	k.box(b, "B", Vector3(12, 1.4, 0.6), Vector3(0, 2, 193.2))
	k.box(b, "X", Vector3(2, 2, 2), Vector3(0, 0, -174))
	k.bake(mats)
	_col(ctx, p2, 120.0)
	# 3. fuel depot west of the staging area
	var p3 := Vector3(-760, -60, 40)
	var g3 := _group(world, "FuelDepot", p3, Vector3(-0.15, 0.9, 0.08))
	k = _kit(53)
	b = k.bone(g3)
	_truss(k, b, "S", Vector3(0, 0, -80), Vector3(0, 0, 80), 12.0, 6, 1.2)
	_cbeam(ctx, g3.transform, Vector3(0, 0, -80), Vector3(0, 0, 80), 12.0, 12.0)
	for i in 3:
		var z := -56.0 + i * 56.0
		for sx: float in [-1.0, 1.0]:
			var c := Vector3(sx * 34.0, 0, z)
			k.ball(b, "L" if (i + int(sx)) % 2 == 0 else "R", Vector3(24, 24, 24), c)
			k.cyl(b, "D", 24.6, 24.6, 3.0, c, Vector3.ZERO, 14, 0.7)
			k.cyl(b, "H", 25.0, 25.0, 1.4, c + Vector3(0, 8, 0), Vector3.ZERO, 14)
			_beam(k, b, "S", Vector3(sx * 6.0, 0, z), Vector3(sx * 12.0, 0, z), 5.0)
			_csph(ctx, g3.transform * c, 24.0)
	k.cyl(b, "S", 10.0, 10.0, 70.0, Vector3(0, 26, 0), Vector3(HZ, 0, 0), 12)
	k.cyl(b, "S", 10.0, 10.0, 70.0, Vector3(0, -26, 0), Vector3(HZ, 0, 0), 12)
	k.box(b, "L", Vector3(18, 14, 20), Vector3(0, 0, 94), Vector3.ZERO, {"tx": 0.75})
	k.box(b, "B", Vector3(14, 1.4, 0.6), Vector3(0, 3, 104.2))
	k.box(b, "X", Vector3(2, 2, 2), Vector3(0, 0, -86))
	k.bake(mats)
	_ccyl(ctx, g3.transform * Transform3D(Basis.from_euler(Vector3(HZ, 0, 0)), Vector3(0, 26, 0)), 10.0, 70.0)
	_ccyl(ctx, g3.transform * Transform3D(Basis.from_euler(Vector3(HZ, 0, 0)), Vector3(0, -26, 0)), 10.0, 70.0)
	_col(ctx, p3, 70.0)
	# 4. wreck of a friendly frigate inside the belt, broken in two
	var p4 := Vector3(-620, 20, -760)
	var g4 := _group(world, "WreckA", p4, Vector3(0.3, 0.8, -0.4))
	k = _kit(54)
	b = k.bone(g4)
	k.box(b, "W", Vector3(30, 24, 90), Vector3(0, 0, -62), Vector3.ZERO, {"tx": 0.8})
	k.box(b, "W", Vector3(18, 16, 40), Vector3(0, 0, -126), Vector3.ZERO, {"tx": 0.5, "bx": 0.5})
	k.box(b, "W", Vector3(12, 10, 60), Vector3(21, -3, -56))
	k.box(b, "W", Vector3(12, 10, 60), Vector3(-21, -3, -56))
	k.box(b, "W", Vector3(14, 14, 18), Vector3(0, 19, -40), Vector3.ZERO, {"tx": 0.7, "tz": 0.7})
	_cbox(ctx, g4.transform * Transform3D(Basis.IDENTITY, Vector3(0, 0, -62)), Vector3(54, 24, 90))
	var aft_rot := Vector3(0.5, 0.35, 0.9)
	var aft_c := Vector3(26, -30, 50)
	k.box(b, "W", Vector3(30, 24, 70), aft_c, aft_rot, {"tx": 0.8})
	k.box(b, "W", Vector3(34, 26, 20), aft_c + Basis.from_euler(aft_rot) * Vector3(0, 0, 40), aft_rot)
	for sx: float in [-1.0, 1.0]:
		k.cyl(b, "D", 6.0, 7.5, 14.0, aft_c + Basis.from_euler(aft_rot) * Vector3(sx * 9.0, 0, 56), aft_rot + Vector3(HZ, 0, 0), 10)
	_cbox(ctx, g4.transform * Transform3D(Basis.from_euler(aft_rot), aft_c + Basis.from_euler(aft_rot) * Vector3(0, 0, 8)), Vector3(32, 26, 90))
	var wr := RandomNumberGenerator.new()
	wr.seed = 9
	for i in 12:
		var o := Vector3(wr.randf_range(-14, 14), wr.randf_range(-11, 11), -17)
		_beam(k, b, "W", o, o + Vector3(wr.randf_range(-10, 10), wr.randf_range(-12, 8), wr.randf_range(6, 30)), wr.randf_range(0.8, 2.2))
	for i in 7:
		k.box(b, "W", Vector3(wr.randf_range(4, 12), wr.randf_range(0.6, 2.0), wr.randf_range(5, 14)), Vector3(wr.randf_range(-30, 40), wr.randf_range(-30, 20), wr.randf_range(-12, 24)), Vector3(wr.randf() * 3.0, wr.randf() * 3.0, wr.randf() * 3.0))
	k.bake(mats)
	_col(ctx, p4, 60.0)
	# 5. wreck of an old tanker deeper in the belt
	var p5 := Vector3(560, -70, -1050)
	var g5 := _group(world, "WreckB", p5, Vector3(-0.4, -0.5, 0.25))
	k = _kit(55)
	b = k.bone(g5)
	k.cyl(b, "W", 20.0, 20.0, 110.0, Vector3(0, 0, 0), Vector3(HZ, 0, 0), 14)
	k.cyl(b, "W", 22.0, 22.0, 5.0, Vector3(0, 0, -30), Vector3(HZ, 0, 0), 14)
	k.cyl(b, "W", 22.0, 22.0, 5.0, Vector3(0, 0, 30), Vector3(HZ, 0, 0), 14)
	k.cyl(b, "W", 4.0, 20.0, 30.0, Vector3(0, 0, -70), Vector3(HZ, 0, 0), 14)
	k.box(b, "W", Vector3(24, 18, 26), Vector3(0, 24, 40), Vector3.ZERO, {"tx": 0.7, "tz": 0.7})
	_truss(k, b, "W", Vector3(0, 0, 55), Vector3(10, -14, 120), 14.0, 4, 1.4)
	for i in 8:
		var o := Vector3(wr.randf_range(-14, 14), wr.randf_range(-14, 14), 55)
		_beam(k, b, "W", o, o + Vector3(wr.randf_range(-14, 14), wr.randf_range(-14, 14), wr.randf_range(8, 30)), wr.randf_range(0.8, 2.0))
	k.bake(mats)
	_ccyl(ctx, g5.transform * Transform3D(Basis.from_euler(Vector3(HZ, 0, 0)), Vector3.ZERO), 20.0, 110.0)
	_col(ctx, p5, 55.0)
	# 6. abandoned mining rig on the largest rock, on the face turned toward the lane
	if ctx.has("hero_xf"):
		var hx: Transform3D = ctx["hero_xf"]
		var hr: float = ctx["hero_r"]
		var dir := (Vector3(120, 30, -620) - hx.origin).normalized()
		dir = (dir + Vector3(0, 0.5, 0)).normalized()
		var top := _rock_top(ctx["hero_hull"], Transform3D(hx.basis.scaled(Vector3.ONE * hr), hx.origin), dir)
		var side := dir.cross(Vector3.UP).normalized()
		var bas := Basis(side, dir, side.cross(dir).normalized())
		var g6 := Node3D.new()
		g6.name = "MiningRig"
		g6.transform = Transform3D(bas, top - dir * 9.0)
		world.add_child(g6)
		k = _kit(56)
		b = k.bone(g6)
		k.cyl(b, "S", 22.0, 26.0, 14.0, Vector3(0, 5, 0), Vector3.ZERO, 12)
		k.cyl(b, "H", 22.6, 22.6, 1.2, Vector3(0, 11.6, 0), Vector3.ZERO, 12)
		_truss(k, b, "R", Vector3(0, 12, 0), Vector3(0, 76, 0), 12.0, 6, 1.2)
		_truss(k, b, "R", Vector3(0, 60, 0), Vector3(34, 82, 0), 6.0, 4, 0.8)
		k.box(b, "X", Vector3(2, 2, 2), Vector3(0, 78, 0))
		k.box(b, "L", Vector3(22, 12, 30), Vector3(-30, 8, 10), Vector3(0, 0.3, 0), {"tx": 0.8, "tz": 0.85})
		k.box(b, "G", Vector3(0.6, 1.6, 18), Vector3(-18.6, 10, 13.2), Vector3(0, 0.3, 0))
		k.ball(b, "L", Vector3(11, 9, 11), Vector3(24, 6, -22))
		k.ball(b, "R", Vector3(11, 9, 11), Vector3(30, 5, 4))
		k.cyl(b, "S", 3.0, 3.0, 40.0, Vector3(10, 4, -10), Vector3(HZ, 0.8, 0), 8)
		k.bake(mats)
		_ccyl(ctx, g6.transform * Transform3D(Basis.IDENTITY, Vector3(0, 40, 0)), 9.0, 80.0)
		_cbox(ctx, g6.transform * Transform3D(Basis.from_euler(Vector3(0, 0.3, 0)), Vector3(-30, 8, 10)), Vector3(22, 12, 30))
	# 7. nav buoys along the lane
	var g7 := Node3D.new()
	g7.name = "Buoys"
	world.add_child(g7)
	k = _kit(57)
	b = k.bone(g7)
	for i in range(1, LANE.size()):
		for sx: float in [-1.0, 1.0]:
			var a: Vector3 = LANE[i]
			var f: Vector3 = (a - LANE[i - 1]).normalized()
			var c := a + f.cross(Vector3.UP).normalized() * (sx * 74.0) + Vector3(0, sx * 10.0, 0)
			k.box(b, "L", Vector3(2.4, 5.0, 2.4), c, Vector3(0, 0.6, 0), {"tx": 0.5, "tz": 0.5, "bx": 0.5, "bz": 0.5})
			k.box(b, "D", Vector3(7.0, 0.4, 0.4), c)
			k.box(b, "D", Vector3(0.4, 0.4, 7.0), c)
			k.box(b, "B", Vector3(1.3, 1.3, 1.3), c + Vector3(0, 3.6, 0))
			k.box(b, "B", Vector3(1.3, 1.3, 1.3), c - Vector3(0, 3.6, 0))
	k.bake(mats, false)


static func _group(world: Node3D, nm: String, p: Vector3, rot: Vector3) -> Node3D:
	var g := Node3D.new()
	g.name = nm
	g.transform = Transform3D(Basis.from_euler(rot), p)
	world.add_child(g)
	return g


# ------------------------------------------------------------------ dust specks
static func _build_specks(world: Node3D) -> void:
	var sh := Shader.new()
	sh.code = SPECK_CODE
	var mat := ShaderMaterial.new()
	mat.shader = sh
	var qm := QuadMesh.new()
	qm.size = Vector2(1, 1)
	qm.material = mat
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_custom_data = true
	mm.mesh = qm
	mm.instance_count = 520
	var rng := RandomNumberGenerator.new()
	rng.seed = 5
	for i in mm.instance_count:
		mm.set_instance_transform(i, Transform3D.IDENTITY)
		mm.set_instance_custom_data(i, Color(rng.randf(), rng.randf(), rng.randf(), rng.randf()))
	var mi := MultiMeshInstance3D.new()
	mi.name = "Specks"
	mi.multimesh = mm
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.custom_aabb = AABB(Vector3(-20000, -20000, -20000), Vector3(40000, 40000, 40000))
	world.add_child(mi)
