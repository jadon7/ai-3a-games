extends Node3D
## 点云显示。每个声脉冲提交为一个 MultiMesh（实例 = 回波点），到期整体释放；
## 另有一个小的动态点池，给敌人轮廓、弹道这类逐帧少量追加的点用。

const WorldData := preload("res://scripts/world.gd")
const Tracer := preload("res://scripts/tracer.gd")
const DYN := 30000
const PF := 20

var world: WorldData
var tracer: Tracer
var mat: ShaderMaterial
var quad := QuadMesh.new()
var pending: Array = []
var live: Array = []            # [MultiMeshInstance3D, 到期时间, 点数]
var dyn_mm := MultiMesh.new()
var dyn_i := 0
var epoch := 0
var hatch_occ: MeshInstance3D
var door_occ: MeshInstance3D
var last_ms := 0.0              # 最近一次脉冲从提交到显示的耗时
var last_pts := 0
var seed_n := 1
var on_crystal := Callable()
var ctxs: Array[Tracer] = []     # 每个工作线程一个独立的求交上下文


func setup(w: WorldData, t: Tracer) -> void:
	world = w
	tracer = t
	for i in 12:
		var c := Tracer.new()
		c.bind_world(w)
		ctxs.append(c)
	mat = ShaderMaterial.new()
	mat.shader = load("res://shaders/points.gdshader")
	quad.size = Vector2.ONE
	_build_occluder()
	dyn_mm.transform_format = MultiMesh.TRANSFORM_3D
	dyn_mm.use_colors = true
	dyn_mm.use_custom_data = true
	dyn_mm.mesh = quad
	dyn_mm.instance_count = DYN
	_clear_dyn()
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = dyn_mm
	mmi.material_override = mat
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mmi.custom_aabb = AABB(Vector3(-10, -10, -10), Vector3(WorldData.MW * WorldData.CS + 20, 40, world.MH * WorldData.CS + 20))
	add_child(mmi)


func _clear_dyn() -> void:
	var b := PackedFloat32Array()
	b.resize(DYN * PF)
	for i in DYN:
		b[i * PF + 16] = -1e4
	dyn_mm.buffer = b
	dyn_i = 0


func add_point(x: float, y: float, z: float, birth: float, life: float, r: float, g: float, b: float, s: float) -> void:
	dyn_mm.set_instance_transform(dyn_i, Transform3D(Basis.IDENTITY, Vector3(x, y, z)))
	dyn_mm.set_instance_color(dyn_i, Color(r, g, b, 1.0))
	dyn_mm.set_instance_custom_data(dyn_i, Color(birth, life, s, 0.0))
	dyn_i = (dyn_i + 1) % DYN


func submit(J: Tracer.Job) -> void:
	J.epoch = epoch
	J.seed = seed_n * 7001
	seed_n += 1
	# 实测：分 8–16 段最快，再多反而互相拖慢
	var chunks := clampi(ceili(J.n / 1500.0), 1, ctxs.size())
	J.chunk = ceili(J.n / float(chunks))
	J.results.resize(chunks)
	J.t_us = Time.get_ticks_usec()
	J.gid = WorkerThreadPool.add_group_task(_dispatch.bind(J), chunks, -1, true, "sonar pulse")
	pending.append(J)


func _dispatch(c: int, J: Tracer.Job) -> void:
	ctxs[c].run_chunk(c, J)


func poll(now: float) -> void:
	mat.set_shader_parameter("u_now", now)
	var i := 0
	while i < pending.size():
		var J: Tracer.Job = pending[i]
		if WorkerThreadPool.is_group_task_completed(J.gid):
			WorkerThreadPool.wait_for_group_task_completion(J.gid)
			pending.remove_at(i)
			if J.epoch == epoch:
				_commit(J)
		else:
			i += 1
	for k in range(live.size() - 1, -1, -1):
		if now > live[k][1]:
			(live[k][0] as Node).queue_free()
			live.remove_at(k)


func _commit(J: Tracer.Job) -> void:
	var all := PackedFloat32Array()
	var cn := 0
	var kx := 0
	var kz := 0
	var kt := 0.0
	for r in J.results:
		if r == null:
			continue
		all.append_array(r[0])
		if r[1] > 0:
			cn += r[1]
			kx = r[2]
			kz = r[3]
			kt = r[4]
	@warning_ignore("integer_division")
	var count := all.size() / PF
	if count > 0:
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = true
		mm.use_custom_data = true
		mm.mesh = quad
		mm.instance_count = count
		mm.buffer = all
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.material_override = mat
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var e := J.rng + 3.0
		mmi.custom_aabb = AABB(Vector3(J.x - e, J.y - e, J.z - e), Vector3(e, e, e) * 2.0)
		add_child(mmi)
		live.append([mmi, J.t0 + J.rng / J.sp + J.life * 1.3 + 0.5, count])
	last_ms = (Time.get_ticks_usec() - J.t_us) / 1000.0
	last_pts = count
	if cn >= 3 and on_crystal.is_valid():
		on_crystal.call(kx, kz, J.t0 + kt / J.sp)


func _exit_tree() -> void:
	for J: Tracer.Job in pending:
		WorkerThreadPool.wait_for_group_task_completion(J.gid)
	pending.clear()


func points_alive() -> int:
	var n := 0
	for l in live:
		n += l[2]
	return n


func reset() -> void:
	epoch += 1
	for l in live:
		(l[0] as Node).queue_free()
	live.clear()
	_clear_dyn()


func set_hatch(open: bool) -> void:
	hatch_occ.visible = not open


func set_door(open: bool) -> void:
	door_occ.visible = not open


# ---------- 黑色遮挡体 ----------
func _quad(v: PackedVector3Array, a: Vector3, b: Vector3, c: Vector3, d: Vector3) -> void:
	v.append(a)
	v.append(b)
	v.append(c)
	v.append(a)
	v.append(c)
	v.append(d)


func _box(v: PackedVector3Array, x0: float, y0: float, z0: float, x1: float, y1: float, z1: float) -> void:
	_quad(v, Vector3(x0, y0, z0), Vector3(x1, y0, z0), Vector3(x1, y1, z0), Vector3(x0, y1, z0))
	_quad(v, Vector3(x0, y0, z1), Vector3(x1, y0, z1), Vector3(x1, y1, z1), Vector3(x0, y1, z1))
	_quad(v, Vector3(x0, y0, z0), Vector3(x0, y0, z1), Vector3(x0, y1, z1), Vector3(x0, y1, z0))
	_quad(v, Vector3(x1, y0, z0), Vector3(x1, y0, z1), Vector3(x1, y1, z1), Vector3(x1, y1, z0))
	_quad(v, Vector3(x0, y1, z0), Vector3(x1, y1, z0), Vector3(x1, y1, z1), Vector3(x0, y1, z1))
	_quad(v, Vector3(x0, y0, z0), Vector3(x1, y0, z0), Vector3(x1, y0, z1), Vector3(x0, y0, z1))


func _mesh_of(v: PackedVector3Array, m: Material) -> MeshInstance3D:
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = v
	var am := ArrayMesh.new()
	am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	var mi := MeshInstance3D.new()
	mi.mesh = am
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	return mi


func _build_occluder() -> void:
	var om := ShaderMaterial.new()
	om.shader = load("res://shaders/occluder.gdshader")
	var cs := WorldData.CS
	var ht := WorldData.HT
	var v := PackedVector3Array()
	var hv := PackedVector3Array()
	var dv := PackedVector3Array()
	var wx := WorldData.MW * cs
	var wz := world.MH * cs
	_quad(v, Vector3(0, 0, 0), Vector3(wx, 0, 0), Vector3(wx, 0, wz), Vector3(0, 0, wz))
	for z in world.MH:
		for x in WorldData.MW:
			var k := z * WorldData.MW + x
			var x0 := x * cs
			var z0 := z * cs
			if world.ceil_t[k] != 0:
				_quad(v, Vector3(x0, ht, z0), Vector3(x0 + cs, ht, z0), Vector3(x0 + cs, ht, z0 + cs), Vector3(x0, ht, z0 + cs))
			if world.wall_m[k] != 0:
				_box(hv if k == world.hatch_k else (dv if k == world.door_k else v), x0, 0, z0, x0 + cs, world.wall_h[k], z0 + cs)
	# 舱门格打开后也有顶
	var hx := (world.hatch_k % WorldData.MW) * cs
	@warning_ignore("integer_division")
	var hz := (world.hatch_k / WorldData.MW) * cs
	_quad(v, Vector3(hx, ht, hz), Vector3(hx + cs, ht, hz), Vector3(hx + cs, ht, hz + cs), Vector3(hx, ht, hz + cs))
	# 井门格也一样
	hx = world.door_p.x - cs / 2.0
	hz = world.door_p.y - cs / 2.0
	_quad(v, Vector3(hx, ht, hz), Vector3(hx + cs, ht, hz), Vector3(hx + cs, ht, hz + cs), Vector3(hx, ht, hz + cs))
	# 图元：长方体精确遮挡，圆柱用内接八棱柱，大椭球用低面数球；小球和胶囊（肋骨、脉管）太细，不遮挡
	var p := world.prim
	@warning_ignore("integer_division")
	var np := p.size() / WorldData.PST
	for i in np:
		var b := i * WorldData.PST
		if p[b] == 2.0:
			_box(v, p[b + 2], p[b + 3], p[b + 4], p[b + 5], p[b + 6], p[b + 7])
		elif p[b] == 1.0 and p[b + 4] > .15:
			var r := p[b + 4]
			for s in 8:
				var a0 := s / 8.0 * TAU
				var a1 := (s + 1) / 8.0 * TAU
				var p0 := Vector3(p[b + 2] + cos(a0) * r, p[b + 5], p[b + 3] + sin(a0) * r)
				var p1 := Vector3(p[b + 2] + cos(a1) * r, p[b + 5], p[b + 3] + sin(a1) * r)
				_quad(v, p0, p1, Vector3(p1.x, p[b + 6], p1.z), Vector3(p0.x, p[b + 6], p0.z))
		elif p[b] == 4.0 and p[b + 5] > .3:
			# 大的椭球（心囊、颅骨、卵囊）：略微内缩的低面数球，挡住背后的点，也让颅骨的眼窝是真的黑
			var c := Vector3(p[b + 2], p[b + 3], p[b + 4])
			var rr := Vector3(p[b + 5], p[b + 6], p[b + 7]) * .93
			for j in 6:
				var t0 := j / 6.0 * PI
				var t1 := (j + 1) / 6.0 * PI
				for s in 10:
					var a0 := s / 10.0 * TAU
					var a1 := (s + 1) / 10.0 * TAU
					_quad(v, c + rr * Vector3(sin(t0) * cos(a0), cos(t0), sin(t0) * sin(a0)), c + rr * Vector3(sin(t0) * cos(a1), cos(t0), sin(t0) * sin(a1)),
						c + rr * Vector3(sin(t1) * cos(a1), cos(t1), sin(t1) * sin(a1)), c + rr * Vector3(sin(t1) * cos(a0), cos(t1), sin(t1) * sin(a0)))
	_mesh_of(v, om)
	hatch_occ = _mesh_of(hv, om)
	door_occ = _mesh_of(dv, om)
