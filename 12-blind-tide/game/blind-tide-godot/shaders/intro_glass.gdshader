shader_type spatial;
// 头盔面窗：几乎透明，只在掠射角泛出一点青色
render_mode blend_mix, cull_disabled, depth_draw_never;

void fragment() {
	if (dot(NORMAL, VIEW) < 0.0) {
		NORMAL = -NORMAL;
	}
	float fr = pow(1.0 - max(dot(NORMAL, VIEW), 0.0), 4.0);
	ALBEDO = vec3(0.1, 0.5, 0.55);
	METALLIC = 1.0;
	ROUGHNESS = 0.1;
	EMISSION = vec3(0.02, 0.1, 0.11) * fr;
	ALPHA = clamp(0.08 + fr * 0.25, 0.0, 1.0);
}
