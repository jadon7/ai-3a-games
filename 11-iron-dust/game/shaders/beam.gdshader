shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, shadows_disabled, fog_disabled;
// Sustained beam / searchlight shaft. Mesh: unit cylinder along Y.

instance uniform vec4 tint : source_color = vec4(1.0, 0.6, 0.25, 1.0);
instance uniform float power = 1.0;
instance uniform float soft = 0.0;

varying float v;

void vertex() {
	v = 0.5 - VERTEX.y;
}

void fragment() {
	float f = abs(dot(normalize(NORMAL), normalize(VIEW)));
	float core = pow(f, 3.0);
	float fl = 0.86 + 0.14 * sin(TIME * 90.0 + v * 60.0);
	vec3 hard = (tint.rgb * (0.35 + f) + vec3(1.0) * core * 1.6) * fl * 3.0;
	vec3 shaft = tint.rgb * pow(f, 1.5) * (1.0 - v * 0.75);
	ALBEDO = mix(hard, shaft, soft) * power;
}
