shader_type spatial;
// Layered sandstone for mesas and buttes. Cliff faces are projected from the side with
// V = world height, so the strata of the photographed cliff stay horizontal; flat tops and
// ledges get a cracked sandstone and a drift of sand. COLOR.r = per-layer shade.

uniform sampler2D wall_alb : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D wall_nr : repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D top_alb : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D top_nr : repeat_enable, filter_linear_mipmap_anisotropic;
uniform vec3 wall_avg = vec3(0.5);
uniform vec3 top_avg = vec3(0.5);
uniform vec3 rock_color : source_color = vec3(0.5, 0.33, 0.18);
uniform vec3 sand_color : source_color = vec3(0.56, 0.4, 0.22);
uniform float tile = 34.0;
uniform float det_amt = 1.0;

varying vec3 wp;
varying vec3 wn;

void vertex() {
	wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wn = normalize(mat3(MODEL_MATRIX) * NORMAL);
}

vec3 unpack_n(vec3 t, float k) {
	vec2 a = (t.xy * 2.0 - 1.0) * k;
	return vec3(a, sqrt(max(0.04, 1.0 - dot(a, a))));
}

void fragment() {
	vec3 n = normalize(wn);
	vec3 w = pow(abs(n), vec3(4.0));
	w /= (w.x + w.y + w.z);
	float side = max(w.x + w.z, 0.001);
	// broad colour bands that follow height, bent a little so they are not ruler straight
	float bend = sin(wp.x * 0.011 + wp.z * 0.017) * 2.2;
	float band = sin(wp.y * 0.2 + bend) * 0.5 + 0.5;
	float band2 = sin(wp.y * 0.71 + bend * 1.7 + 1.3) * 0.5 + 0.5;
	vec3 tintv = mix(vec3(0.84, 0.86, 0.9), vec3(1.14, 1.0, 0.86), band) * (0.9 + 0.2 * band2);
	vec3 wall = rock_color * tintv;
	vec3 top = mix(rock_color * 1.1, sand_color, 0.6);
	float r_wall = 0.9;
	float r_top = 0.95;
	vec3 nn = n;
	if (det_amt > 0.0) {
		vec2 ux = vec2(wp.z, wp.y) / tile;
		vec2 uz = vec2(wp.x, wp.y) / tile;
		vec2 uy = wp.xz / (tile * 0.55);
		vec3 ax = texture(wall_alb, ux).rgb;
		vec3 az = texture(wall_alb, uz).rgb;
		vec3 ay = texture(top_alb, uy).rgb;
		wall *= (ax * w.x + az * w.z) / side / wall_avg;
		top *= ay / top_avg;
		vec3 nx = texture(wall_nr, ux).rgb;
		vec3 nz = texture(wall_nr, uz).rgb;
		vec3 ny = texture(top_nr, uy).rgb;
		r_wall = (nx.b * w.x + nz.b * w.z) / side;
		r_top = ny.b;
		vec3 tx = unpack_n(nx, 1.5);
		vec3 ty = unpack_n(ny, 1.2);
		vec3 tz = unpack_n(nz, 1.5);
		tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
		ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
		tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
		nn = normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
	}
	float up = smoothstep(0.5, 0.82, n.y);
	ALBEDO = mix(wall, top, up) * COLOR.r;
	ROUGHNESS = clamp(mix(r_wall, r_top, up), 0.5, 1.0);
	if (det_amt > 0.0) {
		NORMAL = normalize((VIEW_MATRIX * vec4(nn, 0.0)).xyz);
	}
}
