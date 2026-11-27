shader_type spatial;
// 涌进舱内的血水：不透明的暗红液面，带涌动的波纹和高光
render_mode blend_mix, cull_disabled, depth_draw_always;
uniform float t = 0.0;
varying vec3 wpos;

float wave(vec2 p) {
	return sin(p.x * 5.1 + t * 3.1) * 0.5 + sin(p.y * 6.7 - t * 2.3) * 0.5 + sin((p.x + p.y) * 9.3 + t * 4.7) * 0.25;
}

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	VERTEX.y += wave(wpos.xz) * 0.014;
}

void fragment() {
	float e = 0.02;
	float h0 = wave(wpos.xz);
	float hx = wave(wpos.xz + vec2(e, 0.0));
	float hz = wave(wpos.xz + vec2(0.0, e));
	vec3 n = normalize(vec3(-(hx - h0) / e * 0.014, 1.0, -(hz - h0) / e * 0.014));
	NORMAL = normalize((VIEW_MATRIX * vec4(n, 0.0)).xyz);
	if (dot(NORMAL, VIEW) < 0.0) {
		NORMAL = -NORMAL;
	}
	ALBEDO = vec3(0.09, 0.002, 0.006);
	ROUGHNESS = 0.07;
	SPECULAR = 0.9;
	EMISSION = vec3(0.012, 0.0003, 0.0008);
	ALPHA = 0.94;
}
