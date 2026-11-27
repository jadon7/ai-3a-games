shader_type spatial;
// 纯黑遮挡体：世界本身不可见，只负责挡住它后面的回波点。
render_mode unshaded, cull_disabled, shadows_disabled, fog_disabled;
void fragment() { ALBEDO = vec3(0.0); }
