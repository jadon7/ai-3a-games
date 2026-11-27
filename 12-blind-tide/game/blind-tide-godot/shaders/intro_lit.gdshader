shader_type spatial;
// 开场动画的受光材质。法线始终朝向观察者，所以镜像出来的右手、曲面内侧都能正确受光。
render_mode cull_disabled;
uniform vec3 albedo = vec3(0.2);
uniform float roughness = 0.6;
uniform float metallic = 0.0;
uniform vec3 emission = vec3(0.0);
uniform float em = 1.0;
uniform vec3 tint = vec3(1.0);

void fragment() {
	if (dot(NORMAL, VIEW) < 0.0) {
		NORMAL = -NORMAL;
	}
	ALBEDO = albedo;
	ROUGHNESS = roughness;
	METALLIC = metallic;
	EMISSION = emission * tint * em;
}
