shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, shadows_disabled, fog_disabled;
// Thruster exhaust cone. Mesh: unit cylinder along Y, nozzle end at y = +0.5.

uniform float vacuum = 0.0;
instance uniform float power = 1.0;
instance uniform vec4 tint : source_color = vec4(0.5, 0.72, 1.0, 1.0);

varying float v;

void vertex() {
	v = 0.5 - VERTEX.y;
	float wob = sin(TIME * 53.0 + v * 9.0 + NODE_POSITION_WORLD.x) * 0.07 + sin(TIME * 31.0 + NODE_POSITION_WORLD.z) * 0.05;
	VERTEX.xz *= 1.0 + wob * v * 2.0;
}

void fragment() {
	float fres = abs(dot(normalize(NORMAL), normalize(VIEW)));
	float core = pow(fres, 2.2);
	float fade = pow(clamp(1.0 - v, 0.0, 1.0), 1.5);
	float dia = 0.72 + 0.28 * sin(v * 24.0 - TIME * 38.0);
	// vacuum: standing shock diamonds near the nozzle, and the plume stays thin to the end
	float shock = pow(0.5 + 0.5 * cos(v * 30.0), 6.0) * smoothstep(0.55, 0.05, v);
	dia = mix(dia, 0.55 + 1.6 * shock, vacuum);
	fade = mix(fade, pow(clamp(1.0 - v, 0.0, 1.0), 0.8), vacuum);
	vec3 col = mix(tint.rgb, vec3(1.0, 0.96, 0.88), core * (1.0 - v));
	col = mix(col, vec3(1.0, 0.42, 0.1), smoothstep(0.4, 1.0, v) * 0.8);
	ALBEDO = col * fade * dia * (0.25 + core * 1.5) * power * 1.7;
}
