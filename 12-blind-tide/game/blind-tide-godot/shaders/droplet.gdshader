shader_type spatial;
// 粒子用的圆形液滴 / 火花：始终朝向相机，边缘裁成圆
render_mode unshaded, cull_disabled;
uniform vec3 color = vec3(0.3, 0.01, 0.02);

void vertex() {
	mat4 bb = mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
	float sc = length(MODEL_MATRIX[0].xyz);
	bb[0].xyz *= sc;
	bb[1].xyz *= sc;
	bb[2].xyz *= sc;
	MODELVIEW_MATRIX = VIEW_MATRIX * bb;
	MODELVIEW_NORMAL_MATRIX = mat3(MODELVIEW_MATRIX);
}

void fragment() {
	float d = length(UV - 0.5);
	if (d > 0.5) {
		discard;
	}
	ALBEDO = color * (1.0 - d * 0.9);
}
