shader_type spatial;
render_mode unshaded, cull_disabled, shadows_disabled, fog_disabled;
// The surround of the cabin, as its reflection probe sees it (scripts/cockpit.gd::_build_surround): the
// monitor wall with the outside on it, kept dim like a studio so that rough metal is not flooded. Sky above, a bright band at the horizon, ground below, the joints
// of the wall as dark lines, the patch of the sun on one side and two light bars overhead.
// No camera draws it.

uniform vec3 top : source_color = vec3(0.22, 0.25, 0.3);
uniform vec3 horizon : source_color = vec3(0.45, 0.4, 0.33);
uniform vec3 ground : source_color = vec3(0.1, 0.08, 0.06);
uniform vec3 sun_col : source_color = vec3(1.0, 0.94, 0.82);
uniform float bars = 3.0;          // brightness of the light bars
uniform float band = 1.2;          // extra brightness at the horizon

varying vec3 dir;

void vertex() {
	dir = VERTEX;
}

void fragment() {
	vec3 n = normalize(dir);
	float y = n.y;
	vec3 c = mix(horizon, top, smoothstep(0.0, 0.65, y));
	c = mix(c, ground, smoothstep(0.02, -0.3, y));
	c += horizon * band * exp(-y * y * 120.0) * step(-0.05, y);
	c = mix(c, ground * 0.35, smoothstep(-0.45, -0.9, y));          // the floor of the chest under the seat
	// the joints of the wall: meridians every 20 degrees, three parallels
	float az = atan(n.x, -n.z);
	float m = abs(fract(az / 0.349 + 0.5) - 0.5) * 0.349 * length(n.xz);
	float el = asin(clamp(y, -1.0, 1.0));
	float p = min(min(abs(el - 0.38), abs(el + 0.3)), abs(el - 0.95));
	c *= 1.0 - 0.7 * smoothstep(0.022, 0.006, min(m, p));
	// the patch of the sun on the wall, forward and to the left
	vec3 sd = normalize(vec3(-0.5, 0.55, -0.6));
	c += sun_col * 4.0 * smoothstep(0.965, 0.99, dot(n, sd));
	// two light bars overhead, fore and aft, one each side
	if (y > 0.2) {
		vec2 q = n.xz / y;
		float bx = smoothstep(0.06, 0.0, abs(abs(q.x) - 0.42) - 0.07);
		float bz = smoothstep(0.1, 0.0, abs(q.y + 0.2) - 0.9);
		c += vec3(1.0, 0.96, 0.88) * bars * bx * bz;
	}
	ALBEDO = c;
}
