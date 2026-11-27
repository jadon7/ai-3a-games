shader_type spatial;
render_mode unshaded, depth_test_disabled, depth_draw_never, cull_disabled, shadows_disabled, fog_disabled;
// The cockpit's all-round monitor: a SPHERE of display panels around the seat. Everything
// outside the cabin is a picture on that sphere, so the panel grid is laid out on the sphere
// (rings of near-square panels, fewer per ring toward the poles) and is fixed to the cabin:
// its seams curve across the view and stay put when the pilot turns his head. Damage shows
// on the picture, not on the cabin's own furniture: a torn picture and static after a hit; as
// the frame is hurt the wall fails panel by panel: a failed panel shows the picture knocked out
// of place, snow, or nothing, with the light split into a spectrum along its joints.
// A full-screen quad on the camera; the depth buffer tells the wall from the cabin.

uniform sampler2D depth_tex : hint_depth_texture, filter_nearest, repeat_disable;
uniform sampler2D screen_tex : hint_screen_texture, filter_linear, repeat_disable;
uniform float glitch = 0.0;      // just been hit
uniform float crack = 0.0;       // how badly the frame is hurt, 0..1
uniform float near_cut = 1.7;    // metres: nearer than this is the cabin
uniform mat3 pit_inv = mat3(1.0);  // world -> cabin
uniform vec3 eye_off = vec3(0.0);  // the eye in cabin space (the seat sways under the pilot)
uniform float radius = 2.4;      // of the monitor sphere, metres
uniform float seam_k = 0.42;      // how visible the joints are on a healthy wall
uniform float seam_glint = 0.12; // the joints catch a little cabin light: this is what shows them against black space

const float COLS = 18.0;         // panels around the equator
const float WIDEN = 1.3;         // > 1: panels straight ahead are wider than the ones to the sides
// elevations of the joints between rings (radians), mirrored about the horizon; none at eye level
const float EDGE[10] = float[10](-1.5708, -1.2566, -0.8727, -0.5236, -0.2443, 0.2443, 0.5236, 0.8727, 1.2566, 1.5708);

float h21(vec2 p) {
	return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void vertex() {
	POSITION = vec4(VERTEX.xy, 1.0, 1.0);
}

// where on the sphere's glass a crack is centred (cabin space: -Z ahead, +X right, +Y up)
vec3 sph(float az, float el) {
	return vec3(sin(az) * cos(el), sin(el), -cos(az) * cos(el));
}

void fragment() {
	float d = texture(depth_tex, SCREEN_UV).r;
	vec4 v = INV_PROJECTION_MATRIX * vec4(SCREEN_UV * 2.0 - 1.0, d, 1.0);
	float wall = smoothstep(near_cut, near_cut + 0.3, -v.z / v.w);
	// the point of the sphere this pixel looks at
	vec3 rd = pit_inv * (INV_VIEW_MATRIX * vec4(normalize(v.xyz / v.w), 0.0)).xyz;
	float b = dot(eye_off, rd);
	float t_hit = -b + sqrt(max(b * b - dot(eye_off, eye_off) + radius * radius, 0.0));
	vec3 p = normalize(eye_off + rd * t_hit);
	float el = asin(clamp(p.y, -1.0, 1.0));
	float az = atan(p.x, -p.z);
	// panel grid: uneven on purpose, but mirrored left-right, and no joint runs through the middle
	// of the view. Rings: a tall one straight ahead, lower ones above and below (EDGE = the joints'
	// elevations). Around each ring the panels are widest straight ahead and narrow toward the back,
	// and every ring has a panel CENTRED on dead ahead, so the centre of the picture is one whole
	// panel with the others laid out symmetrically around it.
	float row = 0.0;
	float e0 = EDGE[0];
	float e1 = EDGE[1];
	for (int ri = 1; ri < 9; ri++) {
		if (el >= EDGE[ri]) {
			row = float(ri);
			e0 = EDGE[ri];
			e1 = EDGE[ri + 1];
		}
	}
	float el_mid = 0.5 * (e0 + e1);
	float n_col = max(3.0, floor(COLS * cos(el_mid) + 0.5));
	float wa = az / PI;
	float w = sign(wa) * pow(abs(wa), WIDEN);
	float u = w * n_col * 0.5 + 0.5;
	float col_i = mod(floor(u), n_col);
	vec2 id = vec2(col_i, row);
	// distance to the nearest joint, in pixels
	float fx = fract(u);
	float e_x = min(fx, 1.0 - fx) / max(fwidth(u), 1e-5);
	float e_y = min(el - e0, e1 - el) / max(fwidth(el), 1e-6);
	float e = min(e_x, e_y);
	// Blocky, angular layout: many panels have one corner cut off at 45 degrees, the cut-off
	// triangle being a small panel of its own. The same panels on the left and on the right
	// (the choice hangs on the distance from dead ahead), and never the panel dead ahead.
	float k0 = floor(u);
	vec2 mir = vec2(abs(k0), row);
	if (h21(mir + 23.7) > 0.42 && !(k0 == 0.0 && row == 4.0)) {
		float fxm = k0 < 0.0 ? 1.0 - fx : fx;
		float cx = (h21(mir + 31.1) < 0.5 ? fxm : 1.0 - fxm) / max(fwidth(u), 1e-5);
		float cy = (h21(mir + 47.3) < 0.5 ? el - e0 : e1 - el) / max(fwidth(el), 1e-6);
		float cs = (45.0 + 120.0 * h21(mir + 5.9)) * VIEWPORT_SIZE.y / 1080.0;
		float dc = (cx + cy - cs) * 0.7071;
		e = min(e, abs(dc));
		if (dc < 0.0) {
			id += vec2(0.37, 0.61);
		}
	}
	float seam = 1.0 - smoothstep(0.8, 2.0, e);

	float n = h21(SCREEN_UV * vec2(1920.0, 1080.0) + fract(TIME) * vec2(311.0, 173.0));
	// ---- the picture as the wall would show it: torn sideways for a moment after a hit
	float band = h21(vec2(floor(SCREEN_UV.y * 46.0), floor(TIME * 24.0)));
	vec2 uv = SCREEN_UV + vec2((band - 0.5) * 0.05 * step(0.55, band) * glitch, 0.0);
	vec2 split = vec2(0.004, 0.0) * glitch;
	float cover = clamp(glitch * 1.4, 0.0, 1.0) * step(0.55, band);

	// ---- damage: the wall fails panel by panel, along its own joints. A failed panel shows the
	// picture knocked out of place, or snow, or nothing; the joints around it split the light.
	vec2 sid = id;
	float edge = e;                                     // pixels to the nearest joint
	vec2 eg = vec2(dFdx(e), dFdy(e));
	vec2 tow = -eg / max(length(eg), 1e-5);             // screen direction toward that joint
	float sr = h21(sid + 5.3);
	float skind = h21(sid + 17.9);
	// the panels straight ahead go last, so the fight stays playable on a failing wall
	float kc = floor(u);
	vec3 pc = sph(sign(kc) * pow(abs(kc) * 2.0 / n_col, 1.0 / WIDEN) * PI, el_mid);
	float ahead = smoothstep(0.72, 0.95, -pc.z);
	float broken = step(sr, crack * 0.95 - 0.14 - ahead * 0.45);
	float cracked = step(sr, crack * 1.5 - 0.05 - ahead * 0.3) * step(0.03, crack);
	float flick = step(0.7, h21(vec2(floor(TIME * 11.0), sr * 71.0)));
	if (broken > 0.5) {
		// knocked out of place: the shard's own offset and tilt, colours pulled apart
		vec2 knock = (vec2(h21(sid + 1.1), h21(sid + 2.2)) - 0.5) * vec2(0.16, 0.12);
		uv = (uv - 0.5) * (0.92 + 0.2 * h21(sid + 3.3)) + 0.5 + knock + vec2((band - 0.5) * 0.02 * flick, 0.0);
		split += normalize(knock + vec2(0.001)) * (0.006 + 0.012 * sr);
		cover = 1.0;
	}
	// glass refraction along the breaks (the edge direction stands in for a normal map)
	float lip = cracked * (1.0 - smoothstep(0.0, 12.0, edge));
	uv += tow * lip * 0.03;
	cover = max(cover, lip * 0.9);
	uv = clamp(uv, vec2(0.002), vec2(0.998));
	vec3 col = vec3(texture(screen_tex, uv + split).r, texture(screen_tex, uv).g, texture(screen_tex, uv - split).b);

	if (broken > 0.5) {
		if (skind < 0.42) {
			// displaced picture: washed out a little, rolling bar
			col = col * (0.75 + 0.25 * flick) + vec3(0.03, 0.02, 0.015);
			col *= 0.8 + 0.2 * step(0.5, fract(SCREEN_UV.y * 3.0 - TIME * 0.7 + sr));
		} else if (skind < 0.80) {
			// snow: the picture crushed to a few levels and drowned in grain
			float lum = dot(col, vec3(0.3, 0.55, 0.15));
			vec3 crush = floor(col * 3.0 + n * 0.9) / 3.0;
			col = mix(crush, vec3(step(0.5 - lum * 0.35, n)) * vec3(1.0, 0.86, 0.72), 0.62);
		} else {
			// dead: black glass with a ghost of scan lines
			col = vec3(0.012, 0.014, 0.016) + n * 0.05 * (0.5 + 0.5 * sin(SCREEN_UV.y * 900.0)) * flick;
		}
	}
	// the breaks themselves: a bright hairline that splits into a spectrum, wider on a dead wall
	float line = cracked * (1.0 - smoothstep(0.8, 2.0 + 2.0 * broken, edge));
	float hue = fract(az * 1.7 + el * 2.3 + sr * 3.0 + edge * 0.06);
	vec3 spec = 0.55 + 0.45 * cos(6.2832 * (hue + vec3(0.0, 0.33, 0.67)));
	float fan = cracked * (1.0 - smoothstep(0.0, 16.0, edge)) * step(0.55, h21(sid + floor(edge / 3.0) + 9.0)) * (0.35 + 0.65 * broken);
	col = mix(col, spec * 1.5, fan * 0.55);
	col = mix(col, mix(vec3(0.9, 0.95, 1.0), spec * 1.4, 0.45), line * 0.6);
	cover = max(cover, max(line, fan * 0.6));
	// a failed panel's joints are live: blue-white arcs that jump from place to place along them
	float seg = floor(az * 41.0 + el * 57.0);
	float tick = floor(TIME * 16.0 + sr * 20.0);
	float arc = broken * (1.0 - smoothstep(0.0, 4.5, edge)) * step(0.88, h21(vec2(seg, tick) + sid));
	float halo = broken * (1.0 - smoothstep(0.0, 26.0, edge)) * step(0.93, h21(vec2(floor(seg * 0.25), tick) + sid));
	col += vec3(0.5, 0.75, 1.3) * halo * 0.45;
	col = mix(col, vec3(2.6, 3.0, 3.4), arc);
	cover = max(cover, max(arc, halo * 0.5));
	// and they shed embers: fine orange sparks dropping from the top joint down the dead glass
	float fyn = (el - e0) / max(e1 - e0, 1e-5);
	for (int si = 0; si < 3; si++) {
		float hx = h21(sid + float(si) * 7.31 + 2.0);
		float start = floor(TIME * (0.55 + hx * 0.5) + hx * 9.0);
		float ph = fract(TIME * (0.55 + hx * 0.5) + hx * 9.0);
		float sxp = 0.12 + 0.76 * h21(vec2(start, hx * 31.0) + sid);
		float syp = 1.0 - ph * ph * 1.15;                      // falls faster as it goes
		vec2 dpx = vec2((fx - sxp) / max(fwidth(u), 1e-5), (fyn - syp) / max(fwidth(fyn), 1e-5));
		float ember = broken * step(0.45, h21(vec2(start, 3.0) + sid)) * (1.0 - smoothstep(0.8, 2.4, length(dpx * vec2(1.0, 0.45)))) * (1.0 - ph);
		col = mix(col, vec3(3.2, 1.7, 0.5), ember);
		cover = max(cover, ember);
	}

	// ---- the healthy wall's own look: joints between panels, no two panels matched exactly
	float tone = 0.035 * h21(id + 11.3);
	float sa = seam * mix(seam_k, 0.75, smoothstep(0.05, 0.4, crack));
	col = col * (1.0 - tone) * (1.0 - sa) + vec3(0.55, 0.62, 0.66) * seam_glint * sa / max(seam_k, 0.01);
	cover = max(cover, max(sa, tone * 4.0));
	// static over everything for a moment after a hit
	col = mix(col, vec3(n), glitch * 0.3);
	cover = max(cover, glitch * 0.3);
	ALBEDO = col;
	ALPHA = clamp(cover, 0.0, 1.0) * wall;
}
