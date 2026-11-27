shader_type sky;
// Gradient sky with a sun and a layer of lit cumulus. The clouds do not move: a sky that
// changes every frame would force the reflection / ambient probe to be rebuilt every frame.

uniform vec3 top_color : source_color = vec3(0.13, 0.33, 0.72);
uniform vec3 horizon_color : source_color = vec3(0.6, 0.74, 0.88);
uniform vec3 ground_color : source_color = vec3(0.42, 0.34, 0.24);
uniform vec3 sun_color : source_color = vec3(1.0, 0.95, 0.85);
uniform vec3 cloud_color : source_color = vec3(1.0, 0.98, 0.95);
uniform vec3 cloud_shade : source_color = vec3(0.5, 0.57, 0.7);
uniform float cloud_cover = 0.46;
uniform float cloud_scale = 0.15;
uniform float sun_glow = 0.3;
uniform sampler2D noise_tex : repeat_enable, filter_linear_mipmap;

float fbm(vec2 uv) {
	return texture(noise_tex, uv).r * 0.58 + texture(noise_tex, uv * 2.7 + 0.31).r * 0.28 + texture(noise_tex, uv * 6.3 + 0.7).r * 0.14;
}

void sky() {
	vec3 d = EYEDIR;
	float h = d.y;
	vec3 col = mix(horizon_color, top_color, pow(clamp(h, 0.0, 1.0), 0.42));
	if (h < 0.0) {
		col = mix(horizon_color, ground_color, clamp(-h * 5.0, 0.0, 1.0));
	}
	float sd = max(dot(d, LIGHT0_DIRECTION), 0.0);
	col += sun_color * (pow(sd, 1200.0) * 14.0 + pow(sd, 40.0) * sun_glow + pow(sd, 6.0) * sun_glow * 0.3);
	if (h > 0.005) {
		vec2 uv = d.xz / (h + 0.1) * cloud_scale;
		float n = fbm(uv);
		float lo = 1.0 - cloud_cover;
		float c = smoothstep(lo, lo + 0.15, n);
		// self-shadowing: denser toward the sun means this side is in shade
		vec2 ld = normalize(LIGHT0_DIRECTION.xz + vec2(0.0001)) * 0.018;
		float lit = clamp(0.62 + (n - fbm(uv + ld)) * 5.0, 0.0, 1.0);
		vec3 cc = mix(cloud_shade, cloud_color, lit) * (0.82 + 0.3 * smoothstep(lo + 0.05, lo + 0.4, n));
		cc += sun_color * pow(sd, 10.0) * 0.5;
		col = mix(col, cc, c * smoothstep(0.005, 0.14, h) * 0.94);
	}
	COLOR = col;
}
