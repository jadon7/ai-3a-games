shader_type spatial;
// 声呐点云：每个实例是一个回波点。custom = (到达时间, 寿命, 尺寸, 心跳标记)，color = 颜色。
// 点在"到达时间"之前不可见，所以波前推进完全由着色器按时间完成，CPU 不需要逐帧推进射线。
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, shadows_disabled, fog_disabled;

uniform float u_now = 0.0;
uniform float u_drift = 1.0;
uniform float u_gain = 1.0;      // 密度越高单点越暗，避免叠加后糊成一片白
uniform float u_psize = 1.0;     // 密度越高点越小
uniform float u_beat = 0.5;      // 血海的心跳相位 0–1（与心囊的声音同步）
varying vec3 v_col;

float hash3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }

void vertex() {
	vec3 p = MODEL_MATRIX[3].xyz;
	float age = u_now - INSTANCE_CUSTOM.x;
	float life = INSTANCE_CUSTOM.y;
	if (age < 0.0 || age > life || life <= 0.0) {
		POSITION = vec4(2.0, 2.0, 2.0, 1.0);
		v_col = vec3(0.0);
	} else {
		float k = age / life;
		float h = hash3(p);
		// 脏器与脉管：custom.w ≥ 1 的点跟着心跳"咚-咚"两下鼓起来，小数部分是相位延迟，
		// 位移向量借放在实例矩阵的第一列
		float beat = 0.0;
		if (INSTANCE_CUSTOM.w >= 1.0) {
			float ph = fract(u_beat - INSTANCE_CUSTOM.w);
			beat = exp(-ph * 10.0) + 0.75 * step(0.2, ph) * exp(-(ph - 0.2) * 12.0);
			p += MODEL_MATRIX[0].xyz * beat;
		}
		// 消散：不上浮、不游移——点留在原地，慢慢往下沉一点，然后一颗颗熄掉
		p.y -= u_drift * k * k * 0.1 * (0.3 + h);
		float flash = exp(-age * 7.0) * 1.4;
		float alive = 1.0 - smoothstep(0.35 + 0.6 * h, 0.42 + 0.6 * h, k);
		float tw = mix(1.0, 0.82 + 0.18 * sin(u_now * (5.0 + h * 9.0) + h * 90.0), k);
		vec4 vp = VIEW_MATRIX * vec4(p, 1.0);
		float d = length(vp.xyz);
		vp.xyz *= (d - min(0.08, d * 0.3)) / max(d, 1e-4);   // 朝相机拉近一点，避免与黑色遮挡面深度冲突
		vec4 clip = PROJECTION_MATRIX * vp;
		float w = max(clip.w, 1e-4);
		float ref = VIEWPORT_SIZE.y / 1080.0;
		float scale = abs(PROJECTION_MATRIX[1][1]) * VIEWPORT_SIZE.y * 0.5;
		float px = clamp(INSTANCE_CUSTOM.z * u_psize * scale / w, 2.3 * ref * u_psize, 6.0 * ref) * (1.0 + flash * 0.4);
		clip.xy += VERTEX.xy * px * 2.0 / VIEWPORT_SIZE * clip.w;
		POSITION = clip;
		float absorb = exp(-w * 0.012);                      // 血海吸收：远处更暗
		vec3 c = COLOR.rgb * absorb * 2.4 * u_gain * (pow(1.0 - k, 1.3) * tw * alive + flash * 0.6);
		if (INSTANCE_CUSTOM.w >= 1.0) c *= 0.7 + 1.1 * beat;
		v_col = pow(clamp(c, vec3(0.0), vec3(1.5)), vec3(2.2));   // 先按屏幕亮度封顶再转线性，避免距离环在泛光里糊成一团
	}
}

void fragment() {
	float d = length(UV - 0.5);
	ALBEDO = v_col;
	ALPHA = smoothstep(0.5, 0.08, d);
}
