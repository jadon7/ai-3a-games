shader_type canvas_item;
// 头盔面罩后期：桶形畸变、色散、暗角、扫描线、噪点、呼吸雾、被追踪时的红色压迫、ping 干扰、过载。
uniform sampler2D screen_tex : hint_screen_texture, repeat_disable, filter_linear;
uniform float u_t = 0.0;
uniform float u_jam = 0.0;
uniform float u_vis = 1.0;
uniform float u_press = 0.0;
uniform float u_fog = 0.0;
uniform float u_over = 0.0;
uniform vec4 u_flood = vec4(0.0);

float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void fragment() {
	vec2 vuv = SCREEN_UV;
	vec2 c = vuv - 0.5;
	float r2 = dot(c, c);
	vec2 uv = 0.5 + c * (1.0 - 0.05 * u_vis + 0.2 * u_vis * r2);
	uv.x += u_jam * 0.03 * sin(vuv.y * 90.0 + u_t * 50.0) * step(0.55, h(vec2(floor(vuv.y * 40.0), floor(u_t * 30.0))));
	vec2 off = c * (0.0025 + u_vis * r2 * 0.016 + u_jam * 0.01);
	vec3 col = vec3(texture(screen_tex, uv + off).r, texture(screen_tex, uv).g, texture(screen_tex, uv - off).b);
	col *= 1.0 - u_vis * smoothstep(0.2, 0.7, r2);
	col.r += u_press * r2 * 0.22 * (0.6 + 0.4 * sin(u_t * 5.0));
	col += (h(vuv * 937.0 + u_t) - 0.5) * 0.045;
	col *= 1.0 - u_vis * 0.07 * step(0.5, fract(FRAGCOORD.y * 0.3333));
	col += vec3(0.5, 0.62, 0.66) * u_fog * 0.55 * smoothstep(0.6, 0.0, 1.0 - vuv.y) * (1.0 - abs(c.x));
	float fl = u_over * step(0.5, fract(u_t * 8.0));
	col = mix(col, col.brg * 1.7, fl);
	// 被血水淹没：不是纯色，而是缓慢翻涌、四周更暗的浑浊
	float murk = 0.8 + 0.3 * sin(vuv.x * 5.0 + sin(vuv.y * 4.0 + u_t * 0.6) * 2.0 + u_t * 0.4);
	col = mix(col, u_flood.rgb * murk * (1.0 - 1.1 * r2), u_flood.a);
	COLOR = vec4(col, 1.0);
}
