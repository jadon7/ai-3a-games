shader_type spatial;
render_mode unshaded, depth_test_disabled, depth_draw_never, cull_disabled, shadows_disabled, fog_disabled;
// Screen-space line work: dark ink along depth steps (silhouettes, overlapping plates) and
// along sharp creases in the surface normal, fading out with distance. A full-screen quad
// parented to the camera; the vertex shader pins it to the near plane.

uniform sampler2D depth_tex : hint_depth_texture, filter_nearest, repeat_disable;
uniform sampler2D nr_tex : hint_normal_roughness_texture, filter_nearest, repeat_disable;
uniform float strength = 0.75;
uniform float reach = 420.0;
uniform vec3 ink : source_color = vec3(0.03, 0.03, 0.04);

void vertex() {
	POSITION = vec4(VERTEX.xy, 1.0, 1.0);
}

float lin_depth(vec2 uv, mat4 inv_proj) {
	float d = texture(depth_tex, uv).r;
	vec4 v = inv_proj * vec4(uv * 2.0 - 1.0, d, 1.0);
	return -v.z / v.w;
}

void fragment() {
	vec2 px = 1.0 / VIEWPORT_SIZE;
	vec2 uv = SCREEN_UV;
	float d0 = lin_depth(uv, INV_PROJECTION_MATRIX);
	float dl = lin_depth(uv - vec2(px.x, 0.0), INV_PROJECTION_MATRIX);
	float dr = lin_depth(uv + vec2(px.x, 0.0), INV_PROJECTION_MATRIX);
	float du = lin_depth(uv - vec2(0.0, px.y), INV_PROJECTION_MATRIX);
	float dd = lin_depth(uv + vec2(0.0, px.y), INV_PROJECTION_MATRIX);
	// second difference: flat slopes cancel out, only real steps remain
	float lap = abs(dl + dr - 2.0 * d0) + abs(du + dd - 2.0 * d0);
	float e_depth = smoothstep(0.012, 0.05, lap / max(d0, 1.0));
	vec3 n0 = texture(nr_tex, uv).rgb * 2.0 - 1.0;
	vec3 n1 = texture(nr_tex, uv + vec2(px.x, 0.0)).rgb * 2.0 - 1.0;
	vec3 n2 = texture(nr_tex, uv + vec2(0.0, px.y)).rgb * 2.0 - 1.0;
	float e_norm = smoothstep(0.35, 0.8, 1.0 - min(dot(n0, n1), dot(n0, n2)));
	float near = 1.0 - smoothstep(reach * 0.35, reach, d0);
	float sky = step(d0, 5000.0);
	float e = max(e_depth, e_norm * 0.7 * (1.0 - smoothstep(60.0, 220.0, d0))) * near * sky;
	ALBEDO = ink;
	ALPHA = clamp(e * strength, 0.0, 1.0);
}
