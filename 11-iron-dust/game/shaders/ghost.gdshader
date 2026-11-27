shader_type spatial;
render_mode unshaded, blend_add, cull_back, depth_draw_never, shadows_disabled, fog_disabled;
// The pilot's own frame as the cockpit shows it. Cameras all over the hull are stitched into
// one picture seen from the seat, so the frame's own body would only be in the way: the
// monitor draws it as line work - silhouette and plate edges - and leaves it see-through.
// (Weapons are drawn in full; see mech_model.set_cockpit.)

uniform vec3 tint : source_color = vec3(0.4, 1.0, 0.72);
uniform float gain = 0.6;
uniform float fill = 0.0;       // faint body so the shape reads even face-on
uniform float near_fade = 2.2;   // metres: anything closer than this is not drawn at all

void fragment() {
	float ndv = clamp(dot(normalize(NORMAL), normalize(VIEW)), 0.0, 1.0);
	// silhouette line: where the surface turns away from the eye
	float rim = smoothstep(0.8, 0.97, 1.0 - ndv);
	// plate edges: the models carry an edge mask in vertex blue
	float edge = smoothstep(0.8, 0.98, COLOR.b) * 0.3;
	float dist = length(VERTEX);
	float fade = smoothstep(near_fade, near_fade + 1.6, dist);
	// a slow scan line running down the drawing
	float scan = 0.85 + 0.15 * sin(FRAGCOORD.y * 0.9 - TIME * 3.0);
	ALBEDO = tint * gain * scan;
	ALPHA = clamp(max(rim, edge) + fill, 0.0, 1.0) * 0.6 * fade;
}
