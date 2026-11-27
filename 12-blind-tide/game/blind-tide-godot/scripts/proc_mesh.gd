extends RefCounted
## 程序化建模：用参数曲面拼出带平滑法线的网格，按材质分组成多个表面。
## 开场动画里的手、头盔、求生舱、走廊都由它生成，没有外部模型文件。

class Grp:
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	var idx := PackedInt32Array()
	var col := Color()
	var rough := 0.6
	var metal := 0.0
	var emis := 0.0


var mx := Transform3D.IDENTITY
var col := Color(.2, .2, .2)
var rough := 0.6
var metal := 0.0
var emis := 0.0
var _stack: Array[Transform3D] = []
var _groups := {}
var lit_shader: Shader = load("res://shaders/intro_lit.gdshader")


func begin() -> void:
	_groups = {}
	mx = Transform3D.IDENTITY
	_stack.clear()


## m = [Color, 粗糙度, 金属度, 自发光强度]
func use(m: Array) -> void:
	col = m[0]
	rough = m[1]
	metal = m[2]
	emis = m[3]


func push(m: Transform3D) -> void:
	_stack.append(mx)
	mx = mx * m


func pop() -> void:
	mx = _stack.pop_back()


func _grp() -> Grp:
	var key := "%s|%.3f|%.3f|%.3f" % [col.to_html(), rough, metal, emis]
	if not _groups.has(key):
		var g := Grp.new()
		g.col = col
		g.rough = rough
		g.metal = metal
		g.emis = emis
		_groups[key] = g
	return _groups[key]


static func sp(x: float, e: float) -> float:
	return signf(x) * pow(absf(x), e)


## 参数曲面：fn(u, v) -> Vector3，u、v ∈ [0,1]；skip(u, v) 为真的格子不生成（用来挖洞）
func surf(fn: Callable, nu: int, nv: int, skip := Callable()) -> void:
	var g := _grp()
	var w := nu + 1
	var pts := PackedVector3Array()
	pts.resize(w * (nv + 1))
	for j in nv + 1:
		for i in w:
			var p: Vector3 = fn.call(float(i) / nu, float(j) / nv)
			pts[j * w + i] = mx * p
	# u / v 方向是否闭合（闭合时法线跨接缝取差分，避免接缝处出现折痕）
	@warning_ignore("integer_division")
	var mid := nv / 2
	var cu := pts[mid * w].distance_to(pts[mid * w + nu]) < 1e-5
	@warning_ignore("integer_division")
	var mi := nu / 2
	var cv := pts[mi].distance_to(pts[nv * w + mi]) < 1e-5
	var nor := PackedVector3Array()
	nor.resize(pts.size())
	var bad := PackedByteArray()
	bad.resize(pts.size())
	for j in nv + 1:
		for i in w:
			var i1 := i + 1
			var i0 := i - 1
			if i1 > nu:
				i1 = 1 if cu else nu
			if i0 < 0:
				i0 = nu - 1 if cu else 0
			var j1 := j + 1
			var j0 := j - 1
			if j1 > nv:
				j1 = 1 if cv else nv
			if j0 < 0:
				j0 = nv - 1 if cv else 0
			var d1 := pts[j * w + i1] - pts[j * w + i0]
			var d2 := pts[j1 * w + i] - pts[j0 * w + i]
			var nn := d1.cross(d2)
			var l := nn.length()
			if l > 1e-12:
				nor[j * w + i] = nn / l
			else:
				bad[j * w + i] = 1
	for k in pts.size():
		if bad[k] == 1:
			# 退化点（比如椭球的极点）：借相邻一圈的法线
			if k + w < pts.size() and bad[k + w] == 0:
				nor[k] = nor[k + w]
			elif k - w >= 0 and bad[k - w] == 0:
				nor[k] = nor[k - w]
			else:
				nor[k] = Vector3.UP
	var base := g.v.size()
	g.v.append_array(pts)
	g.n.append_array(nor)
	var has_skip := skip.is_valid()
	for j in nv:
		for i in nu:
			if has_skip and skip.call((i + .5) / nu, (j + .5) / nv):
				continue
			var a := base + j * w + i
			g.idx.append(a)
			g.idx.append(a + w + 1)
			g.idx.append(a + 1)
			g.idx.append(a)
			g.idx.append(a + w)
			g.idx.append(a + w + 1)


## 胶囊：从原点沿 -Z 延伸 L，前端半径 r，末端半径 r2
func cap(r: float, l: float, r2 := -1.0, nu := 12) -> void:
	if r2 < 0.0:
		r2 = r
	var f := func(u: float, v: float) -> Vector3:
		var a := u * TAU
		var z := 0.0
		var q := 0.0
		if v < .3:
			var k := v / .3 * PI * .5
			z = r * cos(k)
			q = r * sin(k)
		elif v < .7:
			var k := (v - .3) / .4
			z = -l * k
			q = lerpf(r, r2, k)
		else:
			var k := (v - .7) / .3 * PI * .5
			z = -l - r2 * sin(k)
			q = r2 * cos(k)
		return Vector3(q * cos(a), q * sin(a), z)
	surf(f, nu, 12)


## 超椭球：e < 1 时趋向圆角方块
func ell(a: float, b: float, c: float, e := 1.0, nu := 20, nv := 12, skip := Callable()) -> void:
	var f := func(u: float, v: float) -> Vector3:
		var t := (v - .5) * PI
		var q := u * TAU
		var ct := sp(cos(t), e)
		return Vector3(a * ct * sp(cos(q), e), b * sp(sin(t), e), c * ct * sp(sin(q), e))
	surf(f, nu, nv, skip)


func tor(rr: float, r: float, nu := 28) -> void:
	var f := func(u: float, v: float) -> Vector3:
		var a := u * TAU
		var b := v * TAU
		var q := rr + r * cos(b)
		return Vector3(q * cos(a), q * sin(a), r * sin(b))
	surf(f, nu, 8)


## 两点之间的胶囊
func cap_ab(a: Vector3, b: Vector3, r: float, r2 := -1.0, nu := 10) -> void:
	var d := a - b
	var l := d.length()
	var z := d / l
	var x := Vector3(z.z, 0, -z.x)
	x = Vector3.RIGHT if x.length() < 1e-5 else x.normalized()
	var y := z.cross(x)
	push(Transform3D(Basis(x, y, z), a))
	cap(r, l, r2, nu)
	pop()


## 平移后的超椭球
func ell_at(p: Vector3, a: float, b: float, c: float, e := 1.0, nu := 20, nv := 12) -> void:
	push(Transform3D(Basis.IDENTITY, p))
	ell(a, b, c, e, nu, nv)
	pop()


## 圆角板块
func slab(cx: float, cy: float, cz: float, sx: float, sy: float, sz: float, e := .25) -> void:
	ell_at(Vector3(cx, cy, cz), sx / 2.0, sy / 2.0, sz / 2.0, e)


## 结束一段，返回 [ArrayMesh, 材质数组]；每个表面一个独立材质，便于单独调自发光
func end() -> Array:
	var am := ArrayMesh.new()
	var mats := []
	for key: String in _groups:
		var g: Grp = _groups[key]
		if g.idx.is_empty():
			continue
		var arr := []
		arr.resize(Mesh.ARRAY_MAX)
		arr[Mesh.ARRAY_VERTEX] = g.v
		arr[Mesh.ARRAY_NORMAL] = g.n
		arr[Mesh.ARRAY_INDEX] = g.idx
		am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
		var m := ShaderMaterial.new()
		m.shader = lit_shader
		m.set_shader_parameter("albedo", Vector3(g.col.r, g.col.g, g.col.b))
		m.set_shader_parameter("roughness", g.rough)
		m.set_shader_parameter("metallic", g.metal)
		m.set_shader_parameter("emission", Vector3(g.col.r, g.col.g, g.col.b) * g.emis)
		am.surface_set_material(am.get_surface_count() - 1, m)
		mats.append(m)
	_groups = {}
	return [am, mats]
