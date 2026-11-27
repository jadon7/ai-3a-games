shader_type spatial;
render_mode cull_disabled;
// Worn painted surface: triplanar seams / chipped paint / grime streaks / settled dust,
// layered over photographed PBR detail (det_* = the painted layer, bare_* = what shows through).
// panels: R = seams, G = chip mask, B = grime, A = dark openings (windows)
// vertex colour: R = baked occlusion, G = dust, B = edge wear (bevels and corners)

uniform sampler2D panels : repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D grunge : repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D det_alb : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D det_nr : repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D bare_alb : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D bare_nr : repeat_enable, filter_linear_mipmap_anisotropic;
uniform vec3 det_avg = vec3(0.5);
uniform vec3 bare_avg = vec3(0.5);
uniform float det_tile = 5.0;
uniform float det_amt = 0.0;
uniform float det_bump = 1.0;
uniform float rust_amt = 0.5;
uniform float edge_wear = 1.0;
uniform float dust_amt = 1.0;
uniform float tile = 7.0;
uniform vec3 bare_color : source_color = vec3(0.2, 0.185, 0.17);
uniform vec3 dust_color : source_color = vec3(0.56, 0.46, 0.33);
uniform float rough_base = 0.6;
uniform float seam_dark = 0.8;
uniform float corr = 0.0;
uniform float bump = 1.0;
uniform float chip_lo = 0.52;
uniform float chip_hi = 0.64;
uniform bool world_space = false;

instance uniform vec4 tint : source_color = vec4(0.5, 0.5, 0.5, 1.0);
instance uniform float metal = 0.45;
instance uniform float wear = 1.0;
instance uniform float holes_amt = 1.0;
instance uniform float wreck = 0.0;
instance uniform float stripes = 0.0;

varying vec3 lpos;
varying vec3 lnrm;

void vertex() {
	lpos = VERTEX;
	lnrm = NORMAL;
	if (world_space) {
		lpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
		lnrm = normalize(mat3(MODEL_MATRIX) * NORMAL);
	}
}

vec4 tri(sampler2D s, vec3 p, vec3 w) {
	return texture(s, p.zy) * w.x + texture(s, p.xz) * w.y + texture(s, p.xy) * w.z;
}

vec3 unpack_n(vec3 t, float k) {
	vec2 a = (t.xy * 2.0 - 1.0) * k;
	return vec3(a, sqrt(max(0.04, 1.0 - dot(a, a))));
}

void fragment() {
	vec3 n = normalize(lnrm);
	vec3 w = pow(abs(n), vec3(6.0));
	w /= (w.x + w.y + w.z);
	vec3 p = lpos / tile;
	vec4 pan = tri(panels, p, w);
	vec4 g1 = tri(grunge, p * 0.31 + 0.37, w);
	vec4 g2 = tri(grunge, p * 1.7, w);
	float holes = pan.a * (1.0 - w.y) * holes_amt;
	float chip = smoothstep(chip_lo, chip_hi, pan.g * (0.55 + g1.r * 0.9) * wear);
	// paint is knocked off along bevels and corners first
	float ew = COLOR.b * edge_wear * wear * (0.25 + g2.r * 0.9 + pan.g * 0.5);
	chip = max(chip, smoothstep(0.34, 0.6, ew));
	vec3 base = tint.rgb;
	if (stripes > 0.5) {
		float s = step(0.5, fract((lpos.x + lpos.y + lpos.z) * 0.55));
		base = mix(vec3(0.72, 0.52, 0.06), vec3(0.025), s);
	}
	// photographed detail
	vec3 da = vec3(1.0);
	vec3 ba = vec3(1.0);
	float d_rough = rough_base;
	float b_rough = 0.4;
	float rust = 0.0;
	vec3 rust_col = vec3(0.2, 0.09, 0.04);
	vec3 nn = n;
	if (det_amt > 0.0) {
		vec3 q = lpos / det_tile;
		vec3 q2 = q * 1.37 + 0.21;
		vec3 raw = tri(det_alb, q, w).rgb;
		da = raw / det_avg;
		ba = tri(bare_alb, q2, w).rgb / bare_avg;
		vec3 dx = texture(det_nr, q.zy).rgb;
		vec3 dy = texture(det_nr, q.xz).rgb;
		vec3 dz = texture(det_nr, q.xy).rgb;
		vec3 bx = texture(bare_nr, q2.zy).rgb;
		vec3 by = texture(bare_nr, q2.xz).rgb;
		vec3 bz = texture(bare_nr, q2.xy).rgb;
		d_rough = dx.b * w.x + dy.b * w.y + dz.b * w.z;
		b_rough = bx.b * w.x + by.b * w.y + bz.b * w.z;
		rust = smoothstep(1.25, 1.9, da.r / max(da.g, 0.05)) * rust_amt * clamp(wear, 0.0, 1.5);
		rust_col = raw;
		// whiteout-blended triplanar normal in the space of lnrm
		vec3 tx = unpack_n(mix(dx, bx, chip), det_bump);
		vec3 ty = unpack_n(mix(dy, by, chip), det_bump);
		vec3 tz = unpack_n(mix(dz, bz, chip), det_bump);
		tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
		ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
		tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
		nn = normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
	}
	float dl = clamp(dot(da, vec3(0.3333)), 0.5, 1.6);
	vec3 paint = base * (0.78 + 0.4 * g1.g) * (0.9 + 0.2 * g2.b) * mix(1.0, dl, det_amt) * COLOR.r;
	paint = mix(paint, rust_col * (0.7 + 0.5 * g2.g) * COLOR.r, rust);
	float cr = 0.0;
	if (corr > 0.0) {
		cr = sin((lpos.x + lpos.z) * 3.2);
		paint *= 1.0 - corr * 0.25 * (0.5 - 0.5 * cr);
	}
	paint *= 1.0 - pan.b * 0.55;
	vec3 bare = bare_color * mix(vec3(0.6 + g2.r * 0.8), ba * (0.85 + g2.r * 0.3), det_amt);
	vec3 alb = mix(paint, bare, chip);
	alb *= 1.0 - pan.r * seam_dark;
	float dust = clamp(COLOR.g * (0.5 + 0.9 * g1.b), 0.0, 1.0);
	dust = clamp(dust + w.y * step(0.0, n.y) * 0.3 * g1.r, 0.0, 1.0) * dust_amt;
	alb = mix(alb, dust_color * (0.75 + 0.5 * g2.g), dust);
	alb = mix(alb, vec3(0.012), holes);
	alb = mix(alb, vec3(0.03, 0.026, 0.023) * (0.5 + g1.r), wreck);
	ALBEDO = alb;
	METALLIC = mix(metal * (1.0 - rust), 0.85, chip) * (1.0 - dust) * (1.0 - wreck * 0.6);
	float r_paint = mix(rough_base + g1.r * 0.22 - 0.1, mix(rough_base, d_rough, 0.65) + rust * 0.25, det_amt);
	float r_bare = mix(0.4, clamp(b_rough * 0.85, 0.2, 0.9), det_amt);
	ROUGHNESS = clamp(mix(r_paint, r_bare, chip) + pan.b * 0.2 + dust * 0.35 + wreck * 0.3, 0.05, 1.0);
	AO = 1.0 - pan.r * 0.5;
	if (det_amt > 0.0) {
		vec3 nv = world_space ? (VIEW_MATRIX * vec4(nn, 0.0)).xyz : (VIEW_MATRIX * MODEL_MATRIX * vec4(nn, 0.0)).xyz;
		NORMAL = normalize(mix(NORMAL, normalize(nv), det_amt));
	}
	// derivative bump from seams / chips / corrugation
	float h = (1.0 - pan.r) - chip * 0.35 + cr * corr * 0.7 - holes;
	vec3 dpx = dFdx(VERTEX);
	vec3 dpy = dFdy(VERTEX);
	float dhx = dFdx(h);
	float dhy = dFdy(h);
	vec3 r1 = cross(dpy, NORMAL);
	vec3 r2 = cross(NORMAL, dpx);
	float det = dot(dpx, r1);
	vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
	NORMAL = normalize(abs(det) * NORMAL - bump * 0.07 * grad);
}


