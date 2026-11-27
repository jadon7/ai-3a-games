shader_type canvas_item;
// Lens pass: chromatic aberration, vignette, film grain, damage flash.

uniform sampler2D screen : hint_screen_texture, repeat_disable, filter_linear;
uniform float damage = 0.0;
uniform float boost = 0.0;
uniform float grain = 0.028;
uniform float dim = 0.0;
uniform float od = 0.0;
uniform float cockpit = 0.0;   // 1 inside the cockpit: the picture is a monitor wall
uniform float glitch = 0.0;    // just been hit
uniform float crack = 0.0;     // how badly the frame is hurt, 0..1
uniform float alarm = 0.0;     // armour alarm on, 0..1
uniform vec2 sun_uv = vec2(0.5);
uniform float sun_vis = 0.0;   // sun on screen and not hidden behind anything

float h21(vec2 p) {
	return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void fragment() {
	vec2 uv = SCREEN_UV;
	// a hit tears the picture sideways in bands for a moment
	if (glitch > 0.0) {
		float band = step(0.55, h21(vec2(floor(uv.y * 26.0), floor(TIME * 34.0))));
		uv.x += (h21(vec2(floor(uv.y * 60.0), floor(TIME * 50.0))) - 0.5) * 0.07 * glitch * band * mix(0.35, 1.0, cockpit);
	}
	vec2 c = uv - 0.5;
	float r2 = dot(c, c);
	float ca = (0.00015 + damage * 0.005 + boost * 0.0016 + od * 0.0022) * (1.0 + r2 * 4.0);
	vec3 col;
	col.r = texture(screen, uv + c * ca).r;
	col.g = texture(screen, uv).g;
	col.b = texture(screen, uv - c * ca).b;
	col *= 1.0 - smoothstep(0.14, 0.7, r2) * 0.32;
	float n = h21(uv * vec2(1920.0, 1080.0) + fract(TIME) * vec2(311.0, 173.0));
	col += (n - 0.5) * grain;
	col = mix(col, vec3(0.7, 0.05, 0.02), damage * smoothstep(0.06, 0.5, r2) * 0.55);
	if (sun_vis > 0.001) {
		// lens flare: veiling glare, a horizontal streak, a ring and ghosts along the axis through the centre
		vec2 asp = vec2(1.78, 1.0);
		vec2 sd = (SCREEN_UV - sun_uv) * asp;
		float sl = length(sd);
		float facing = 1.0 - smoothstep(0.0, 0.75, length((sun_uv - 0.5) * asp));
		vec3 fl = vec3(1.0, 0.9, 0.75) * exp(-sl * 5.0) * 0.9;
		fl += vec3(1.0, 0.85, 0.7) * exp(-abs(sd.y) * 70.0) * exp(-abs(sd.x) * 1.6) * 0.5;
		fl += vec3(0.6, 0.8, 1.0) * (1.0 - smoothstep(0.0, 0.012, abs(sl - 0.33))) * 0.1;
		vec2 ax = 0.5 - sun_uv;
		for (int gi = 0; gi < 4; gi++) {
			float gk = 0.5 + float(gi) * 0.45;
			float gr = 0.03 + 0.022 * float(gi);
			float gd = length((SCREEN_UV - (sun_uv + ax * gk)) * asp);
			vec3 gc = gi == 1 ? vec3(0.4, 0.9, 0.6) : (gi == 2 ? vec3(0.9, 0.5, 0.3) : vec3(0.5, 0.6, 1.0));
			fl += gc * (1.0 - smoothstep(gr * 0.6, gr, gd)) * 0.07;
		}
		// in the cockpit the monitors dim themselves when the sun is in view; outside, the lens washes out
		float k = sun_vis * mix(1.0, 0.45, cockpit);
		col = col * (1.0 - 0.3 * sun_vis * facing * cockpit) + fl * k + vec3(1.0, 0.92, 0.8) * 0.22 * facing * k;
	}
	col += vec3(0.5, 0.2, 0.04) * od * smoothstep(0.1, 0.55, r2) * 0.5;
	col = mix(col, col * vec3(1.08, 0.98, 0.9), od);
	if (cockpit > 0.5) {
		// (the monitor wall's own damage is drawn in 3D: shaders/pit_wall.gdshader)
		col = mix(col, vec3(0.55, 0.04, 0.02), crack * 0.14 * (0.6 + 0.4 * sin(TIME * 5.0)) * smoothstep(0.05, 0.5, r2));
	}
	col *= 1.0 - dim;
	// armour alarm: a red warning light turning behind the camera washes round the edge of the
	// picture, and the whole picture breathes a little red with it
	float a_ang = atan(c.y, c.x);
	float a_beam = pow(0.5 + 0.5 * cos(a_ang - TIME * 4.2), 6.0);
	col += vec3(0.9, 0.06, 0.03) * alarm * a_beam * smoothstep(0.08, 0.42, r2) * 0.5;
	col *= mix(vec3(1.0), vec3(1.0, 0.84, 0.82), alarm * 0.4 * (0.5 + 0.5 * sin(TIME * 8.4)));
	COLOR = vec4(col, 1.0);
}
