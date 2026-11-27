shader_type spatial;
// Brushed metal without texture coordinates. The grain and the stretched highlight have to run ALONG a
// tube or a stick, whatever way it points, and the cabin's parts carry no UVs or tangents to say which
// way that is. So the direction is read off the surface itself: across a tube the normal turns, along it
// the normal does not, so the axis is the direction in which the normal stays put (from the normal's
// screen-space derivatives). On flat faces there is no such direction and the part's own axes decide.
// The grain is fine streaks along that axis (procedural), which vary the roughness and, a little, the
// brightness; the highlight is anisotropic along the same axis.

uniform vec3 tint : source_color = vec3(0.42, 0.43, 0.45);
uniform float rough = 0.42;
uniform float aniso = 0.8;
uniform float grain = 0.5;          // how strongly the streaks show
uniform float density = 520.0;      // streaks per metre across the grain

varying vec3 opos;
varying vec3 onrm;

float h11(float x) {
	return fract(sin(x * 127.1) * 43758.5453);
}

float streaks(float v, float u) {
	// value noise across the grain, two scales; each streak drifts slowly along its length
	float a = mix(h11(floor(v)), h11(floor(v) + 1.0), smoothstep(0.0, 1.0, fract(v)));
	float v2 = v * 0.23 + floor(u) * 17.0;
	float b = mix(h11(floor(v2) + 31.0), h11(floor(v2) + 32.0), smoothstep(0.0, 1.0, fract(v2)));
	return a * 0.65 + b * 0.35;
}

void vertex() {
	opos = VERTEX;
	onrm = NORMAL;
	// a tangent frame from the part's own axes, so the engine has one to turn the highlight in
	vec3 ax = abs(NORMAL.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
	TANGENT = normalize(cross(ax, NORMAL));
	BINORMAL = normalize(cross(NORMAL, TANGENT));
}

void fragment() {
	vec3 n = normalize(NORMAL);
	// across a curved part the normal turns: that direction, and at right angles to it the axis
	vec3 dx = dFdx(n);
	vec3 dy = dFdy(n);
	vec3 turn = dot(dx, dx) > dot(dy, dy) ? dx : dy;
	float curved = smoothstep(0.0004, 0.004, length(turn));
	vec3 axis_curved = cross(n, normalize(turn + vec3(1e-6)));
	vec3 axis_flat = normalize(TANGENT);
	vec3 axis = normalize(mix(axis_flat, axis_curved, curved));
	vec3 across = normalize(cross(n, axis));
	// the same two directions in the part's own space, to lay the streaks out in
	mat3 to_model = transpose(mat3(MODEL_MATRIX)) * mat3(INV_VIEW_MATRIX);
	vec3 axis_m = normalize(to_model * axis);
	vec3 across_m = normalize(to_model * across);
	float s = streaks(dot(opos, across_m) * density, dot(opos, axis_m) * 6.0);
	// COLOR: the baked occlusion (how much of the surround this point sees)
	ALBEDO = tint * (1.0 - grain * 0.22 + grain * 0.44 * s) * COLOR.rgb;
	AO = COLOR.r;
	AO_LIGHT_AFFECT = 0.5;
	METALLIC = 1.0;
	SPECULAR = 0.5;
	ROUGHNESS = clamp(rough * (1.0 - grain * 0.3 + grain * 0.6 * s), 0.08, 1.0);
	ANISOTROPY = aniso;
	ANISOTROPY_FLOW = vec2(dot(axis, normalize(TANGENT)), dot(axis, normalize(BINORMAL)));
}
