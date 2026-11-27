shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, shadows_disabled;
// Anti-air burst seen from far away: a glowing disc that is eaten into a crescent as it
// dies ("full moon to waning moon"). One MultiMesh quad per burst, camera facing.
// INSTANCE_CUSTOM: x = age 0..1, y = random seed 0..1 (direction of the dark limb)

varying float age;
varying float seed;

void vertex() {
	age = INSTANCE_CUSTOM.x;
	seed = INSTANCE_CUSTOM.y;
	float s = length(MODEL_MATRIX[0].xyz);
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0] * s, INV_VIEW_MATRIX[1] * s, INV_VIEW_MATRIX[2] * s, MODEL_MATRIX[3]);
	MODELVIEW_NORMAL_MATRIX = mat3(MODELVIEW_MATRIX);
}

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float d = length(p);
	float r = 0.56;
	float disc = smoothstep(r, r - 0.07, d);
	// the dark limb slides in from one side: full -> gibbous -> thin crescent
	float ang = seed * 6.2832;
	vec2 dir = vec2(cos(ang), sin(ang));
	float off = mix(2.3 * r, 0.24 * r, smoothstep(0.1, 0.8, age));
	float limb = smoothstep(r * 1.02, r * 0.9, length(p - dir * off));
	float lit = disc * (1.0 - limb);
	float fade = smoothstep(0.0, 0.03, age) * (1.0 - smoothstep(0.8, 1.0, age));
	float halo = exp(-d * d * 5.0) * 0.35 * (1.0 - age) * (1.0 - age);
	float flash = exp(-d * d * 2.2) * 1.4 * (1.0 - smoothstep(0.0, 0.07, age));
	vec3 rim = COLOR.rgb;
	vec3 core = mix(rim, vec3(1.0, 0.85, 0.92), 0.45);
	vec3 c = mix(core, rim, smoothstep(0.0, r, d)) * lit * (0.95 + 0.9 * (1.0 - age));
	c += rim * (halo + flash);
	ALBEDO = c * fade;
	ALPHA = clamp(max(lit, halo + flash) * fade, 0.0, 1.0);
}
