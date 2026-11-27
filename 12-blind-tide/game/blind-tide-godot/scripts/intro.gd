extends Node3D
## 实机开场（第一人称，全程不切镜头）：
## 冲过走廊 → 跌进求生舱 → 关门、压杠、拉杆弹射 → 戴头盔、合面窗 → 落水 → 舷窗开裂、血水涌入 → 全黑
## 模型全部由 proc_mesh 程序化生成；开场结束后整体释放。

const ProcMesh := preload("res://scripts/proc_mesh.gd")

const FAB := [Color(.075, .085, .1), .75, 0.0, 0.0]
const ARM := [Color(.2, .215, .24), .38, .55, 0.0]
const RUB := [Color(.03, .03, .036), .9, 0.0, 0.0]
const HULL := [Color(.085, .095, .11), .62, .4, 0.0]
const PAD := [Color(.045, .038, .032), .9, 0.0, 0.0]
const DARK := [Color(.05, .055, .065), .6, .5, 0.0]
const EMC := [Color(.15, .9, 1), .5, 0.0, 1.3]
const EMA := [Color(1, .55, .15), .5, 0.0, 1.0]
const EMR := [Color(1, .08, .05), .5, 0.0, 2.2]
const HAZ := [Color(.55, .42, .05), .6, 0.0, 0.0]
const FL := [.041, .046, .042, .033]
const FX := [-.031, -.0105, .0105, .031]
const FR := [.0098, .0102, .0098, .0088]
const HA := .155
const HB := .172
const HC := .19
const AZ := .9
const EL0 := -.68
const EL1 := .62
const NK := -1.02
const END_T := 15.7                # 受光段结束，之后全黑、只剩声呐
# 时间点 → 音效 / 动作
const CUES := [
	[0.0, "i_run"], [3.0, "i_swish1"], [4.3, "i_swish2"], [4.8, "i_door"], [4.95, "i_bar"], [5.1, "i_lever"],
	[5.25, "i_launch"], [6.3, "i_helm"], [7.55, "i_seal"], [8.3, "i_visor"], [8.4, "@hud"], [9.0, "@impact"],
	[10.2, "i_groan1"], [11.4, "i_groan2"], [12.2, "flood"], [13.5, "i_sparks"], [15.6, "@muffle"],
]

var g                                  # main.gd 实例
var b := ProcMesh.new()
var px := 0.0
var pz := 0.0
var meshes := {}                       # 名称 -> [ArrayMesh, 材质数组]
var nodes := {}                        # 名称 -> MeshInstance3D（世界里的部件）
var cam_root: Node3D                   # 挂在相机下：双手、头盔
var hand_l := {}
var hand_r := {}
var helm: MeshInstance3D
var visor: MeshInstance3D
var jets: Array[GPUParticles3D] = []
var sparks: Array[GPUParticles3D] = []
var fill: OmniLight3D
var water: MeshInstance3D
var water_mat: ShaderMaterial
var l1: OmniLight3D
var l2: OmniLight3D
var hl := [-.3, -.75, -.15, .6, 0.0, 0.0, .3]
var hr := [-.3, -.75, -.15, .6, 0.0, 0.0, .3]
var cue_i := 0
var lit := false
var built := false
var freed := false
var u_vis := 0.0
var light_gain := 0.8


static func ez(k: float) -> float:
	k = clampf(k, 0.0, 1.0)
	return k * k * (3.0 - 2.0 * k)


static func V(x: float, y: float, z: float) -> Vector3:
	return Vector3(x, y, z)


static func _t(x: float, y: float, z: float) -> Transform3D:
	return Transform3D(Basis.IDENTITY, Vector3(x, y, z))


static func _rx(a: float) -> Transform3D:
	return Transform3D(Basis(Vector3.RIGHT, a), Vector3.ZERO)


static func _ry(a: float) -> Transform3D:
	return Transform3D(Basis(Vector3.UP, a), Vector3.ZERO)


static func _rz(a: float) -> Transform3D:
	return Transform3D(Basis(Vector3.BACK, a), Vector3.ZERO)


func _mi(nm: String, parent: Node) -> MeshInstance3D:
	var m := MeshInstance3D.new()
	m.mesh = meshes[nm][0]
	m.visible = false
	parent.add_child(m)
	return m


func _em(nm: String, k: float, tint := Vector3.ONE) -> void:
	for m: ShaderMaterial in meshes[nm][1]:
		m.set_shader_parameter("em", k)
		m.set_shader_parameter("tint", tint)


# ---------- 建模 ----------
func _in_ap(u: float, v: float) -> bool:
	var t := (v - .5) * PI
	var q := u * TAU
	return absf(q - 1.5 * PI) < AZ and t > EL0 and t < EL1


func _h_skip(u: float, v: float) -> bool:
	return _in_ap(u, v) or (v - .5) * PI < NK


func _not_ap(u: float, v: float) -> bool:
	return not _in_ap(u, v)


func _hp(q: float, t: float, gg: float) -> Vector3:
	return Vector3((HA + gg) * cos(t) * cos(q), (HB + gg) * sin(t), (HC + gg) * cos(t) * sin(q))


func _cprof(a: float) -> Vector2:
	return Vector2(1.32 + 1.36 * ProcMesh.sp(cos(a), .5), pz + 1.1 * ProcMesh.sp(sin(a), .5))


func _cring(x: float, r: float) -> void:
	var f := func(u: float, v: float) -> Vector3:
		var q := _cprof(u * TAU)
		var bb := v * TAU
		var ny := q.x - 1.32
		var nz := q.y - pz
		var l := sqrt(ny * ny + nz * nz)
		if l < 1e-6:
			l = 1.0
		var k := r * cos(bb) - r
		return Vector3(x + r * sin(bb), q.x + ny / l * k, q.y + nz / l * k)
	b.surf(f, 44, 6)


func build(world) -> void:
	if built:
		return
	built = true
	px = world.PX
	pz = world.PZ

	# 手套：掌、护甲、腕环、前臂（左手几何，右手镜像）
	b.begin()
	b.use(FAB)
	b.ell(.045, .017, .052, .6)
	b.ell_at(V(0, 0, .07), .04, .034, .035, .7)
	b.cap_ab(V(0, 0, .09), V(0, -.03, .46), .04, .058, 14)
	b.use(ARM)
	b.ell_at(V(0, .014, -.004), .037, .009, .038, .5)
	for x: float in FX:
		b.ell_at(V(x, .012, -.045), .0105, .007, .012, .8, 10, 6)
	b.push(_t(0, 0, .058))
	b.tor(.04, .008)
	b.pop()
	b.push(_t(0, .038, .27) * _rx(-.065))
	b.ell(.036, .014, .13, .5)
	b.pop()
	b.use(RUB)
	b.ell_at(V(0, -.013, .005), .036, .008, .04, .6)
	b.ell_at(V(.03, -.012, .02), .014, .01, .02, .8, 8, 6)
	b.use(DARK)
	for s: float in [-1.0, 1.0]:
		b.cap_ab(V(s * .03, .02, .06), V(s * .036, .032, .2), .006, .006, 6)
		b.ell_at(V(s * .036, .032, .2), .009, .009, .012, 1, 8, 6)
	b.use(EMC)
	b.push(_t(0, 0, .088))
	b.tor(.0415, .0028)
	b.pop()
	b.ell_at(V(0, .052, .2), .012, .003, .03, .6, 8, 6)
	meshes["hand"] = b.end()
	# 四指三节 + 拇指两节
	for f in 4:
		for j in 3:
			b.begin()
			var l: float = FL[f] * [1.0, .62, .5][j]
			var r: float = FR[f] * [1.0, .93, .86][j]
			b.use(FAB)
			b.cap(r, l, r * .7 if j == 2 else r * .92, 10)
			b.use(RUB)
			if j == 2:
				b.ell_at(V(0, -r * .45, -l * .7), r * .7, r * .45, l * .32, .8, 8, 6)
			else:
				b.ell_at(V(0, 0, -l), r * 1.08, r * 1.08, r * .5, 1, 8, 6)
			if j < 2:
				b.use(ARM)
				b.ell_at(V(0, r * .75, -l * .5), r * .85, r * .4, l * .36, .6, 8, 6)
			meshes["f%d%d" % [f, j]] = b.end()
	for j in 2:
		b.begin()
		b.use(FAB)
		b.cap(.0118 - .001 * j, [.034, .028][j], .0105 - .001 * j, 10)
		meshes["t%d" % j] = b.end()

	# 头盔：内衬 + 外壳（挖出面窗与颈口）、密封圈、颈环、耳舱、脊、状态灯
	b.begin()
	b.use(RUB)
	b.ell(HA, HB, HC, 1, 56, 36, _h_skip)
	b.use(ARM)
	b.ell(HA + .03, HB + .03, HC + .032, 1, 56, 36, _h_skip)
	b.use(RUB)
	var rim: Array[Vector3] = []
	for i in 49:
		var k := minf(i / 48.0 * 4.0, 3.9999)
		var s := fmod(k, 1.0)
		var q := 0.0
		var t := 0.0
		if k < 1.0:
			q = 1.5 * PI - AZ + 2.0 * AZ * s
			t = EL1
		elif k < 2.0:
			q = 1.5 * PI + AZ
			t = EL1 + (EL0 - EL1) * s
		elif k < 3.0:
			q = 1.5 * PI + AZ - 2.0 * AZ * s
			t = EL0
		else:
			q = 1.5 * PI - AZ
			t = EL0 + (EL1 - EL0) * s
		rim.append(_hp(q, t, .015))
	rim.append(rim[0])
	for i in rim.size() - 1:
		if rim[i].distance_to(rim[i + 1]) > 1e-4:
			b.cap_ab(rim[i], rim[i + 1], .018, .018, 6)
	b.use(ARM)
	for i in 32:
		b.cap_ab(_hp(i / 32.0 * TAU, NK, .015), _hp((i + 1) / 32.0 * TAU, NK, .015), .02, .02, 6)
	for s: float in [-1.0, 1.0]:
		b.ell_at(V(s * (HA + .035), -.01, .03), .022, .05, .06, .6)
		b.ell_at(V(s * .09, -.115, -.168), .03, .022, .03, .7, 10, 6)
	b.cap_ab(V(0, HB + .03, -.1), V(0, HB + .02, .13), .016, .012)
	b.use(EMC)
	b.ell_at(V(0, .122, -.165), .05, .003, .004, 1, 8, 4)
	for s: float in [-1.0, 1.0]:
		b.ell_at(V(s * (HA + .058), -.01, .03), .003, .02, .006, 1, 6, 4)
	meshes["helm"] = b.end()
	b.begin()
	b.ell(HA + .016, HB + .016, HC + .017, 1, 56, 36, _not_ap)
	meshes["visor"] = b.end()

	# 求生舱：圆筒舱壁、肋环、管线、软垫、门框、控制台、弹射杆座
	b.begin()
	b.use(HULL)
	var hull := func(u: float, v: float) -> Vector3:
		var a := u * TAU
		return Vector3(px - 1.62 + 3.24 * v, 1.3 + 1.44 * cos(a), pz + 1.44 * sin(a))
	b.surf(hull, 44, 4)
	b.use(DARK)
	b.slab(px, 0, pz, 3.2, .12, 2.3, .2)
	b.slab(px - 1.62, 1.3, pz, .12, 2.9, 2.9, .3)
	b.slab(px + 1.6, 1.3, pz - 1.12, .14, 2.9, .86, .25)
	b.slab(px + 1.6, 1.3, pz + 1.12, .14, 2.9, .86, .25)
	b.slab(px + 1.6, 2.5, pz, .14, .7, 1.4, .25)
	b.use(ARM)
	for x: float in [-1.2, -.4, .4, 1.2]:
		b.push(_t(px + x, 1.3, pz) * _ry(PI / 2.0))
		b.tor(1.4, .05, 44)
		b.pop()
	for s: float in [-1.0, 1.0]:
		b.use(ARM)
		b.cap_ab(V(px - 1.6, 2.5, pz + s * .5), V(px + 1.6, 2.5, pz + s * .5), .035, .035, 8)
		b.cap_ab(V(px - 1.6, 2.28, pz + s * .9), V(px + 1.6, 2.28, pz + s * .9), .022, .022, 8)
		b.cap_ab(V(px + 1.5, .05, pz + s * .7), V(px + 1.5, 2.15, pz + s * .7), .04, .04, 8)
		b.use(PAD)
		for x: float in [-.8, 0.0, .8]:
			b.slab(px + x, 1.25, pz + s * 1.36, .7, .5, .1, .3)
	b.use(ARM)
	b.cap_ab(V(px + 1.5, 2.15, pz - .7), V(px + 1.5, 2.15, pz + .7), .04, .04, 8)
	b.use(DARK)
	b.slab(px + 1.15, .5, pz + 1.0, .55, 1, .55, .3)
	b.slab(px + 1.2, .6, pz - 1.02, .45, 1.2, .45, .3)
	b.use(ARM)
	b.cap_ab(V(px + .02, 0, pz + .62), V(px, .74, pz + .46), .05, .035, 10)
	b.ell_at(V(px, .75, pz + .45), .055, .055, .055)
	meshes["pod"] = b.end()

	b.begin()
	b.use(EMA)
	b.push(_t(px + 1.0, 1.04, pz + .98) * _rz(.6))
	b.ell(.008, .1, .2, .25)
	b.pop()
	b.use(EMC)
	b.ell_at(V(px + 1.02, .92, pz + .72), .012, .012, .012)
	b.use(EMA)
	b.ell_at(V(px + 1.1, 1.22, pz - 1.02), .012, .05, .12, .3)
	meshes["cons"] = b.end()

	b.begin()
	b.use(EMR)
	b.ell_at(V(px, 2.66, pz), .09, .04, .09)
	meshes["lamp"] = b.end()

	b.begin()
	b.use(ARM)
	b.cap_ab(V(0, 0, 0), V(0, .2, 0), .016, .016, 8)
	b.use([Color(.7, .06, .04), .6, 0.0, .5])
	b.ell_at(V(0, .23, 0), .03, .04, .03)
	meshes["lever"] = b.end()

	b.begin()
	b.use(RUB)
	var bp: Array[Vector3] = [V(-.3, 0, 0), V(-.3, -.03, -.22), V(-.2, -.07, -.36), V(0, -.085, -.4), V(.2, -.07, -.36), V(.3, -.03, -.22), V(.3, 0, 0)]
	for i in 6:
		b.cap_ab(bp[i], bp[i + 1], .032, .032, 10)
	b.use(HAZ)
	b.ell_at(V(0, -.085, -.4), .1, .036, .036, .6)
	meshes["bar"] = b.end()

	# 舱门：门板、观察窗框、手轮、警示条
	b.begin()
	b.use(ARM)
	b.ell(.055, 1.06, .69, .22, 24, 16)
	b.use(DARK)
	b.push(_t(-.06, .45, 0) * _ry(PI / 2.0))
	b.tor(.27, .045)
	b.pop()
	b.push(_t(-.075, -.32, 0) * _ry(PI / 2.0))
	b.tor(.13, .016)
	b.pop()
	for i in 5:
		var a := i * 1.2566 + .3
		b.cap_ab(V(-.075, -.32, 0), V(-.075, -.32 + .13 * cos(a), .13 * sin(a)), .01, .01, 6)
	b.ell_at(V(-.085, -.32, 0), .02, .035, .035)
	b.use(HAZ)
	b.ell_at(V(-.058, -.78, 0), .006, .06, .5, .3)
	meshes["door"] = b.end()

	b.begin()
	b.use([Color(1, 1, 1), .2, 0.0, 1.0])
	b.ell(.012, .235, .235, 1, 20, 8)
	meshes["port"] = b.end()
	meshes["port"][1][0].set_shader_parameter("albedo", Vector3(.008, .008, .01))
	meshes["port"][1][0].set_shader_parameter("roughness", .12)

	b.begin()
	b.use([Color(.9, .9, .95), .3, 0.0, .3])
	var cr: Array[Vector3] = [V(0, .05, -.2), V(0, .02, -.08), V(0, .09, .02), V(0, -.03, .1), V(0, 0, .21)]
	for i in 4:
		b.cap_ab(cr[i], cr[i + 1], .004, .004, 5)
	b.cap_ab(cr[1], V(0, -.15, -.05), .004, .003, 5)
	b.cap_ab(cr[2], V(0, .2, .08), .004, .003, 5)
	meshes["crack"] = b.end()

	# 弯曲截面的走廊：舱壁、肋环、管线、软垫、警示灯带
	b.begin()
	b.use(HULL)
	var corr := func(u: float, v: float) -> Vector3:
		var q := _cprof(u * TAU)
		return Vector3(px + 1.62 + 13.6 * v, q.x, q.y)
	b.surf(corr, 44, 8)
	b.use(DARK)
	b.slab(px + 8.4, .02, pz, 13.6, .14, 1.9, .2)
	b.slab(px + 15.25, 1.3, pz, .12, 2.8, 2.3, .3)
	b.use(ARM)
	var x := 2.4
	while x < 15.0:
		_cring(px + x, .07)
		x += 1.8
	for s: float in [-1.0, 1.0]:
		b.use(ARM)
		for p: Array in [[2.38, .72, .045], [2.3, .84, .03], [2.44, .6, .022], [.42, 1.0, .035]]:
			b.cap_ab(V(px + 1.7, p[0], pz + s * p[1]), V(px + 15.2, p[0], pz + s * p[1]), p[2], p[2], 8)
		b.use(PAD)
		x = 3.3
		while x < 15.0:
			b.slab(px + x, 1.35, pz + s * 1.06, 1.3, 1.0, .08, .3)
			x += 1.8
		b.use(DARK)
		x = 3.3
		while x < 15.0:
			b.slab(px + x, 1.95, pz + s * 1.02, .5, .16, .1, .4)
			x += 3.6
	meshes["corr"] = b.end()

	b.begin()
	b.use(EMR)
	x = 3.3
	while x < 15.0:
		b.slab(px + x, 2.62, pz, .9, .03, .12, .4)
		x += 1.8
	b.use([Color(1, .4, .1), .5, 0.0, 3.0])
	for s: float in [-1.0, 1.0]:
		b.slab(px + 8.4, .1, pz + s * .93, 13, .02, .03, .3)
	meshes["strip"] = b.end()

	# ---------- 节点 ----------
	for nm: String in ["pod", "cons", "lamp", "corr", "strip", "door", "port", "crack", "lever", "bar"]:
		nodes[nm] = _mi(nm, self)
	# 血水喷溅与控制台短路的火花：GPU 粒子
	for i in 3:
		jets.append(_mk_spray(Vector3(px + 1.46, [.5, 1.55, 1.0][i], pz + [-.68, .68, -.4][i])))
	sparks.append(_mk_sparks(Vector3(px + 1.0, 1.06, pz + .95)))
	sparks.append(_mk_sparks(Vector3(px + 1.1, 1.22, pz - 1.0)))
	water = MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(3.2, 3.0)
	pm.subdivide_width = 24
	pm.subdivide_depth = 24
	water.mesh = pm
	water_mat = ShaderMaterial.new()
	water_mat.shader = load("res://shaders/blood_water.gdshader")
	water.material_override = water_mat
	water.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	water.visible = false
	add_child(water)

	cam_root = Node3D.new()
	g.cam.add_child(cam_root)
	var names: Array[String] = ["hand", "t0", "t1"]
	for f in 4:
		for j in 3:
			names.append("f%d%d" % [f, j])
	var rl := Node3D.new()
	cam_root.add_child(rl)
	var rr := Node3D.new()
	rr.transform = Transform3D(Basis.from_scale(Vector3(-1, 1, 1)), Vector3.ZERO)
	cam_root.add_child(rr)
	for nm in names:
		hand_l[nm] = _mi(nm, rl)
		hand_r[nm] = _mi(nm, rr)
	helm = _mi("helm", cam_root)
	visor = MeshInstance3D.new()
	visor.mesh = meshes["visor"][0]
	var gm := ShaderMaterial.new()
	gm.shader = load("res://shaders/intro_glass.gdshader")
	visor.material_override = gm
	visor.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	visor.visible = false
	cam_root.add_child(visor)

	# 很弱的贴身补光，让手套和头盔不至于只剩剪影
	fill = OmniLight3D.new()
	fill.position = Vector3(0, .08, .1)
	fill.omni_range = 1.3
	fill.light_energy = .1
	fill.light_color = Color(.8, .86, 1)
	fill.shadow_enabled = false
	fill.light_volumetric_fog_energy = 0.0
	cam_root.add_child(fill)

	l1 = OmniLight3D.new()
	l2 = OmniLight3D.new()
	for l: OmniLight3D in [l1, l2]:
		l.omni_range = 9.0
		l.omni_attenuation = 1.3
		l.shadow_enabled = true
		l.shadow_bias = .03
		l.light_volumetric_fog_energy = 1.5
		l.visible = false
		add_child(l)


func _mk_spray(pos: Vector3) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.amount = 420
	p.lifetime = .75
	p.emitting = false
	p.local_coords = false
	p.visibility_aabb = AABB(Vector3(-4, -3, -3), Vector3(6, 6, 6))
	var pm := ParticleProcessMaterial.new()
	pm.direction = Vector3(-1, -.2, 0)
	pm.spread = 10.0
	pm.initial_velocity_min = 3.5
	pm.initial_velocity_max = 7.5
	pm.gravity = Vector3(0, -9.8, 0)
	pm.scale_min = .5
	pm.scale_max = 1.7
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	pm.emission_sphere_radius = .02
	p.process_material = pm
	var q := QuadMesh.new()
	q.size = Vector2(.02, .02)
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/droplet.gdshader")
	m.set_shader_parameter("color", Vector3(.34, .012, .022))
	q.material = m
	p.draw_pass_1 = q
	p.position = pos
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(p)
	return p


func _mk_sparks(pos: Vector3) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.amount = 70
	p.lifetime = .45
	p.explosiveness = .55
	p.emitting = false
	p.local_coords = false
	p.visibility_aabb = AABB(Vector3(-3, -3, -3), Vector3(6, 6, 6))
	var pm := ParticleProcessMaterial.new()
	pm.direction = Vector3(-.6, 1, 0)
	pm.spread = 75.0
	pm.initial_velocity_min = 1.2
	pm.initial_velocity_max = 3.8
	pm.gravity = Vector3(0, -9.8, 0)
	pm.scale_min = .4
	pm.scale_max = 1.2
	p.process_material = pm
	var q := QuadMesh.new()
	q.size = Vector2(.01, .01)
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/droplet.gdshader")
	m.set_shader_parameter("color", Vector3(5.0, 2.0, .5))
	q.material = m
	p.draw_pass_1 = q
	p.position = pos
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(p)
	return p


# ---------- 时间线 ----------
func start() -> void:
	cue_i = 0
	lit = true
	hl = [-.3, -.75, -.15, .6, 0.0, 0.0, .3]
	hr = hl.duplicate()
	_set_env(true)
	l1.visible = true
	l2.visible = true


## 调试跳转后重新对齐音效指针（不补播错过的音效）
func seek(t: float) -> void:
	cue_i = 0
	while cue_i < CUES.size() and CUES[cue_i][0] <= t:
		cue_i += 1
	if t < END_T and not lit and not freed:
		lit = true
		_set_env(true)
		l1.visible = true
		l2.visible = true


func _cue(c: Array) -> void:
	var nm: String = c[1]
	if nm == "@hud":
		g.hud_show = true
		g.glitch_t = .45
		g.set_obj(8)
	elif nm == "@impact":
		g.sfx.play("impact")
		g.sfx.set_muffle(900.0)
		g.sfx.start_drone()
	elif nm == "@muffle":
		g.sfx.set_muffle(3600.0)
	else:
		g.sfx.play(nm)
		if nm == "i_visor":
			g.sfx.set_muffle(2400.0)


func _pose(h: Array, tg: Array, k: float) -> void:
	for i in 7:
		h[i] = lerpf(h[i], tg[i], k)


func _pose_hand(nd: Dictionary, h: Array) -> void:
	var c: float = h[6]
	var base := _t(h[0], h[1], h[2]) * _ry(h[4]) * _rx(h[3]) * _rz(h[5])
	nd["hand"].transform = base
	for f in 4:
		var m := base * _t(FX[f], 0, -.047) * _ry((f - 1.5) * -.07 * (1.0 - c)) * _rx(-c * 1.25)
		nd["f%d0" % f].transform = m
		m = m * _t(0, 0, -FL[f]) * _rx(-c * 1.5)
		nd["f%d1" % f].transform = m
		m = m * _t(0, 0, -FL[f] * .62) * _rx(-c * 1.1)
		nd["f%d2" % f].transform = m
	var th := base * _t(.04, -.006, .012) * _ry(-.95 + c * .35) * _rx(-c * .35)
	nd["t0"].transform = th
	th = th * _t(0, 0, -.034) * _rx(-c * .8)
	nd["t1"].transform = th


func _light(l: OmniLight3D, pos: Vector3, c: Vector3) -> void:
	l.position = pos
	var mx := maxf(c.x, maxf(c.y, c.z))
	if mx < 1e-5:
		l.light_energy = 0.0
		return
	l.light_color = Color(c.x / mx, c.y / mx, c.z / mx)
	l.light_energy = mx * light_gain


func _set_env(on: bool) -> void:
	var env: Environment = g.env
	if on:
		env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
		env.tonemap_exposure = 1.0
		env.ssao_enabled = true
		env.ssao_radius = .6
		env.ssao_intensity = 2.5
		env.glow_intensity = .55
		env.glow_bloom = .05
		env.glow_hdr_threshold = 1.0
		env.volumetric_fog_enabled = true
		env.volumetric_fog_density = .02
		env.volumetric_fog_albedo = Color(.9, .85, .8)
		env.volumetric_fog_emission = Color.BLACK
		env.volumetric_fog_length = 20.0
	else:
		g.env_sonar()


func update(t: float, dt: float) -> void:
	while cue_i < CUES.size() and CUES[cue_i][0] <= t:
		_cue(CUES[cue_i])
		cue_i += 1
	var strobe := 1.0 if sin(t * 9.0) > 0.0 else .15
	var sh := 0.0
	var yaw := PI / 2.0
	var pitch := 0.0
	var x := px - .45
	var y := 1.15
	var z := pz
	var rest := [-.3, -.75, -.15, .6, 0.0, 0.0, .3]
	var barp := [-.2, -.19, -.42, .25, -.2, .4, .92]
	var tl: Array = rest
	var tr: Array = rest
	var helm_on := false
	var hp := Vector3.ZERO
	var hrx := 0.0
	if t < 3.0:
		# 冲过走廊：警报频闪，双臂摆动
		var sw := sin(t * 8.5)
		x = px + 13.0 - t / 3.0 * 10.6
		y = 1.62 + absf(sw) * .06
		z = pz + sin(t * 4.25) * .07
		yaw = -PI / 2.0 + sin(t * 4.25) * .03
		pitch = -.04
		sh = .004
		tl = [-.23, -.3 + sw * .08, -.36 + sw * .05, 1.15, .15, -.2, 1.0]
		tr = [-.23, -.3 - sw * .08, -.36 - sw * .05, 1.15, .15, -.2, 1.0]
	elif t < 4.3:
		# 转身跌进座椅
		var k := ez((t - 3.0) / 1.3)
		var s := sin(k * PI)
		x = lerpf(px + 2.4, px - .45, k)
		y = lerpf(1.62, 1.15, k) - s * .2
		z = pz + s * .25
		yaw = -PI / 2.0 + k * PI
		pitch = -.04 - s * .38
		tl = [-.27, -.03, -.5, 1.3, 0.0, .3, .15 + .6 * ez((t - 3.3) / .5)]
		tr = tl
	else:
		if t > 5.0:
			tl = barp
			tr = barp
		if t < 4.9:
			tr = [-.33, .02, -.55, 1.2, 0.0, .4, .8]
		elif t < 5.5:
			# 右手拉弹射杆
			var k := ez((t - 5.05) / .2)
			tr = [lerpf(-.42, -.37, k), lerpf(-.2, -.27, k), lerpf(-.45, -.37, k), .35, -.2, 1.3, .95]
		if t > 5.2 and t < 9.0:
			sh = .008 + .035 * exp(-(t - 5.2) * 2.0)
			y -= .08 * exp(-(t - 5.2) * 5.0)
		if t > 6.3 and t < 7.7:
			# 低头，双手把头盔从腿上举起扣上
			var k := ez((t - 6.4) / 1.2)
			pitch = -.5 * sin(PI * ez((t - 6.3) / 1.4))
			helm_on = true
			hp = Vector3(0, lerpf(-.46, -.01, k) + sin(k * PI) * .06, lerpf(-.42, .05, k))
			hrx = lerpf(-1.45, 0.0, k)
			tl = [hp.x - .2, hp.y - .03, hp.z + .01, 1.3, 0.0, 1.25, .5]
			tr = tl
		elif t >= 7.7:
			helm_on = true
			hp = Vector3(0, -.01, .05)
		if t >= 7.7 and t < 8.4:
			# 右手拉下面窗
			tr = [-.2, lerpf(.1, -.03, ez((t - 7.7) / .6)), -.19, 1.2, 0.0, 1.0, .5]
		if t > 9.0:
			# 落水
			sh = .07 * exp(-(t - 9.0) * 2.2) + .002
			pitch -= .15 * exp(-(t - 9.0) * 3.0)
			yaw += sin(t * .9) * .03
		if t > 12.2:
			sh += .05 * exp(-(t - 12.2) * 3.0)
		if t > 12.6 and t < END_T:
			# 舷窗开裂：抬手挡，血水漫上来
			pitch -= .3 * ez((t - 12.6) / .8) * (1.0 - ez((t - 13.9) / .7))
			sh += .006
			var q := (randf() - .5) * .012
			tl = [-.24, -.06 + q, -.46, 1.4, 0.0, .2, .05]
			tr = tl
		y += g.stand * .45
	var hk := 1.0 - exp(-dt * 12.0)
	_pose(hl, tl, hk)
	_pose(hr, tr, hk)
	g.cx = x
	g.cy = y
	g.cz = z
	g.c_yaw = yaw + (randf() - .5) * sh * 2.0
	g.c_pitch = pitch + (randf() - .5) * sh * 2.0

	if lit and t > END_T:
		lit = false
		_show(false)
		_set_env(false)
		g.flood = Color(0, 0, 0, 0)
	u_vis = .35 * ez((t - 7.7) / .6) if lit else 1.0
	if not lit:
		return

	var door_s := 1.45 if t < 4.3 else lerpf(1.45, 0.0, ez((t - 4.3) / .5))
	var lever_a := ez((t - 5.05) / .2)
	var bar_a := lerpf(1.2, -.5, ez((t - 4.55) / .5))
	var vis_a := lerpf(1.15, 0.0, ez((t - 7.7) / .6))
	# 舷窗外的颜色：大气层的灰白 → 逼近海面的血红 → 入水后暗下去
	var pc := Vector3(.02, .02, .03)
	if t >= 5.2 and t < 8.2:
		var k := (t - 5.2) / 3.0
		var f := .75 + .25 * randf()
		pc = Vector3(lerpf(.3, .38, k), lerpf(.34, .1, k), lerpf(.4, .09, k)) * f
	elif t >= 8.2 and t < 9.0:
		pc = Vector3(.4, .025, .04)
	elif t >= 9.0:
		var k := 1.0 - ez((t - 9.0) / 3.2)
		pc = Vector3(.3 * k * k, .014 * k, .03 * k)
	var cons_k := 0.0
	if t < 13.5:
		cons_k = .85 + .15 * randf()
	elif t < 14.1:
		cons_k = 0.0 if randf() < .5 else 1.0 - (t - 13.5) / .6
	var lamp_k := 1.0 if t < 14.5 else 0.0
	var amb := Vector3(.004 + .008 * lamp_k * strobe, .004, .0045)
	if t < 4.6:
		_light(l1, Vector3(x - 1.8, 2.3, pz), Vector3(1.5, .1, .07) * strobe)
		_light(l2, Vector3(px + .9, 1.4, pz + .5), Vector3(.3, .2, .1))
		amb = Vector3(.008, .005, .005)
	else:
		_light(l1, Vector3(px + .95, 1.25, pz + .75), Vector3(.42, .28, .14) * cons_k)
		if t < 5.2 or t > 12.0:
			var k := lamp_k * strobe * (.7 if t < 5.2 else .5)
			_light(l2, Vector3(px, 2.45, pz), Vector3(k, k * .07, k * .05))
		else:
			_light(l2, Vector3(px + 1.25, 1.55, pz), pc * 2.2)
	var env: Environment = g.env
	env.ambient_light_color = Color(amb.x, amb.y, amb.z) * (1.0 / maxf(amb.x, .0001))
	env.ambient_light_energy = amb.x * 6.0 * light_gain

	var water_y := -1.0 if t < 12.5 else (t - 12.5) * .62
	if water_y > y:
		# 血水漫过面罩
		var a := clampf((water_y - y) / .1, 0.0, .93)
		var k := ez((t - 14.4) / 1.2)
		g.flood = Color(.3 * (1.0 - k), .012 * (1.0 - k), .03 * (1.0 - k), a)
	else:
		g.flood = Color(0, 0, 0, 0)

	# 部件
	_show(true)
	nodes["corr"].visible = t < 5.2
	nodes["strip"].visible = t < 5.2
	_em("strip", strobe)
	_em("cons", cons_k)
	_em("lamp", lamp_k * strobe)
	var dm := _t(px + 1.5, 1.1, pz + door_s)
	nodes["door"].transform = dm
	var pm := dm * _t(-.075, .45, 0)
	nodes["port"].transform = pm
	_em("port", 2.2, pc)
	nodes["crack"].visible = t > 12.2
	nodes["crack"].transform = pm
	_em("crack", 1.0 + pc.x * 4.0)
	nodes["lever"].transform = _t(px, .75, pz + .45) * _rz(lever_a)
	nodes["bar"].transform = _t(px - .3, 1.2, pz) * _ry(-PI / 2.0) * _rx(bar_a)
	_pose_hand(hand_l, hl)
	_pose_hand(hand_r, hr)
	helm.visible = helm_on
	visor.visible = helm_on
	if helm_on:
		var hm := _t(hp.x, hp.y, hp.z) * _rx(hrx)
		helm.transform = hm
		visor.transform = hm * _rx(vis_a)
		_em("helm", 1.0 if t > 8.4 else 0.0)
	var jet_on := t > 12.3 and water_y < 2.0
	for i in 3:
		jets[i].emitting = jet_on and water_y < jets[i].position.y + .1
	var spark_on := t > 13.5 and t < 14.1
	for s in sparks:
		s.emitting = spark_on and water_y < s.position.y
	water.visible = water_y > 0.0
	water.position = Vector3(px, minf(water_y, 2.6), pz)
	water_mat.set_shader_parameter("t", t)


func _show(on: bool) -> void:
	for nm: String in nodes:
		nodes[nm].visible = on
	cam_root.visible = on
	l1.visible = on
	l2.visible = on
	if not on:
		water.visible = false
		for j in jets:
			j.emitting = false
		for s in sparks:
			s.emitting = false


## 开场结束：释放全部网格、材质和灯
func finish() -> void:
	if freed or not built:
		return
	freed = true
	lit = false
	_set_env(false)
	cam_root.queue_free()
	for c in get_children():
		c.queue_free()
	nodes.clear()
	hand_l.clear()
	hand_r.clear()
	jets.clear()
	sparks.clear()
	meshes.clear()
