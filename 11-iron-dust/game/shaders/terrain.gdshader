shader_type spatial;
// Desert ground: sand / rocky ground / cracked flats / compacted base pad.
// COLOR.r = pad amount, COLOR.g = brightness. The photographed sets only add detail:
// each is divided by its own average so the palette below stays in charge of the colour.

uniform sampler2D grunge : repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D nmap : hint_normal, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D sand_alb : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D sand_nr : repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D rock_alb : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D rock_nr : repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D crack_alb : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D crack_nr : repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D pad_alb : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D pad_nr : repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D cliff_alb : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D cliff_nr : repeat_enable, filter_linear_mipmap_anisotropic;
uniform vec3 cliff_avg = vec3(0.5);
uniform vec3 sand_col : source_color = vec3(0.47, 0.36, 0.225);
uniform vec3 gravel_col : source_color = vec3(0.25, 0.215, 0.17);
uniform vec3 pad_col : source_color = vec3(0.29, 0.285, 0.27);
uniform vec3 rock_col : source_color = vec3(0.5, 0.33, 0.18);
uniform vec3 sand_avg = vec3(0.5);
uniform vec3 rock_avg = vec3(0.5);
uniform vec3 crack_avg = vec3(0.5);
uniform vec3 pad_avg = vec3(0.5);
uniform float det_amt = 0.0;

varying vec3 wp;
varying vec3 wn;
varying float slope;

void vertex() {
	wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wn = NORMAL;
	slope = 1.0 - NORMAL.y;
}

// two scales of the same set, so the repeat does not read as a grid from the air
vec3 two(sampler2D s, vec2 uv, float a, float b) {
	return mix(texture(s, uv / a).rgb, texture(s, uv / b + 0.37).rgb, 0.42);
}

void fragment() {
	vec2 uv = wp.xz;
	vec3 a = texture(grunge, uv / 37.0).rgb;
	vec3 b = texture(grunge, uv / 211.0 + 0.3).rgb;
	vec3 c = texture(grunge, uv / 6.3).rgb;
	vec3 sand = sand_col;
	vec3 gravel = gravel_col;
	vec3 pad = pad_col;
	float g = max(smoothstep(0.42, 0.66, b.r), smoothstep(0.1, 0.3, slope));
	if (det_amt > 0.0) {
		float ck = smoothstep(0.56, 0.7, b.b) * (1.0 - g) * (1.0 - smoothstep(0.03, 0.1, slope));
		vec3 sa = two(sand_alb, uv, 12.0, 51.0) / sand_avg;
		vec3 ra = two(rock_alb, uv, 15.0, 61.0) / rock_avg;
		vec3 ca = two(crack_alb, uv, 19.0, 73.0) / crack_avg;
		vec3 pa = texture(pad_alb, uv / 17.0).rgb / pad_avg;
		vec3 sn = two(sand_nr, uv, 12.0, 51.0);
		vec3 rn = two(rock_nr, uv, 15.0, 61.0);
		vec3 cn = two(crack_nr, uv, 19.0, 73.0);
		vec3 pn = texture(pad_nr, uv / 17.0).rgb;
		vec3 alb = mix(sand * sa, gravel * ra, g * 0.85);
		alb = mix(alb, sand * 0.86 * ca, ck);
		alb *= (0.86 + 0.2 * a.g + 0.08 * c.b) * COLOR.g;
		vec3 padc = pad * pa * (0.9 + 0.2 * a.r);
		padc *= 1.0 - smoothstep(0.55, 0.75, b.g) * 0.18;
		padc = mix(padc, sand * sa * 0.8, smoothstep(0.62, 0.86, a.b) * 0.3);
		alb = mix(alb, padc, COLOR.r);
		vec3 nr = mix(mix(mix(sn, rn, g * 0.85), cn, ck), pn, COLOR.r);
		// steep faces (terrace risers, canyon walls): layered cliff rock projected from the side
		float cl = smoothstep(0.2, 0.42, slope) * (1.0 - COLOR.r);
		if (cl > 0.0) {
			vec3 an = abs(normalize(wn));
			float wx = an.x / max(an.x + an.z, 0.001);
			vec2 ux = vec2(wp.z, wp.y) / 30.0;
			vec2 uz = vec2(wp.x, wp.y) / 30.0;
			vec3 ca2 = mix(texture(cliff_alb, uz).rgb, texture(cliff_alb, ux).rgb, wx) / cliff_avg;
			float band = sin(wp.y * 0.2 + sin(wp.x * 0.011 + wp.z * 0.017) * 2.2) * 0.5 + 0.5;
			vec3 cliff = rock_col * ca2 * mix(vec3(0.84, 0.86, 0.9), vec3(1.14, 1.0, 0.86), band) * COLOR.g;
			alb = mix(alb, cliff, cl);
			nr = mix(nr, vec3(0.5, 0.5, mix(texture(cliff_nr, uz).b, texture(cliff_nr, ux).b, wx)), cl * 0.8);
		}
		ALBEDO = alb;
		vec2 nx = nr.rg * 2.0 - 1.0;
		ROUGHNESS = clamp(mix(0.96, nr.b, 0.55) - COLOR.r * 0.1, 0.35, 1.0);
		NORMAL_MAP = vec3(nr.rg, sqrt(max(0.05, 1.0 - dot(nx, nx))) * 0.5 + 0.5);
		NORMAL_MAP_DEPTH = 1.5;
	} else {
		vec3 alb = mix(sand, gravel, g * 0.8) * (0.78 + 0.3 * a.g + 0.16 * c.b) * COLOR.g;
		vec3 padc = pad * (0.65 + 0.7 * a.r) * (0.85 + 0.3 * c.g);
		padc *= 1.0 - smoothstep(0.55, 0.75, b.g) * 0.45;
		padc = mix(padc, sand * 0.8, smoothstep(0.5, 0.8, a.b) * 0.6);
		ALBEDO = mix(alb, padc, COLOR.r);
		ROUGHNESS = 0.96 - COLOR.r * 0.18 * a.b;
		NORMAL_MAP = mix(texture(nmap, uv / 9.0).rgb, texture(nmap, uv / 47.0).rgb, 0.4);
		NORMAL_MAP_DEPTH = 0.7;
	}
}
