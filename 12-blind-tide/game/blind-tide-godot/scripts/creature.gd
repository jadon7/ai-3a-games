extends RefCounted
## 潮听者的外形。从模型表面按面积均匀采样出一批点（位置 + 法线），
## 游戏里所有"看见怪物"的点云——声呐回波、被标记时的轮廓、受击和死亡——都从这批点里取。
## 模型换了只要覆盖同名文件即可；文件缺失或没被导入时退回到用 4 个球近似。
##
## 局部坐标：f = 朝前，y = 高度，s = 侧向。模型文件约定 Y 朝上、-Z 朝前。

var pts := PackedFloat32Array()      # 每点 6 个数：f, y, s, 法线 nf, ny, ns
var count := 0
var from_model := false
var poses := {}                      # 姿态名 -> 同样格式、同样点数的一批点（漂游 drift / 警觉 sus / 猎杀 hunt）


func load_model(path: String, n: int, sph: PackedFloat32Array) -> void:
	pts = _sample(path, n)
	if pts.size() == 0:
		_from_spheres(n, sph)
		return
	count = n
	from_model = true


## 再读一个姿态。文件缺失就退回默认造型，所以少导出一个姿态不会出错
func load_pose(nm: String, path: String) -> void:
	var a := _sample(path, count)
	poses[nm] = a if a.size() == count * 6 else pts


func pose(nm: String) -> PackedFloat32Array:
	return poses.get(nm, pts)


func _sample(path: String, n: int) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	var mesh: Mesh = null
	if ResourceLoader.exists(path):
		mesh = load(path) as Mesh
	if mesh == null or mesh.get_surface_count() == 0:
		return out
	var vs := PackedVector3Array()
	var ns := PackedVector3Array()
	for si in mesh.get_surface_count():
		var arr := mesh.surface_get_arrays(si)
		var v: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
		var nn = arr[Mesh.ARRAY_NORMAL]
		var idx = arr[Mesh.ARRAY_INDEX]
		var has_n: bool = nn != null and (nn as PackedVector3Array).size() == v.size()
		if idx != null and (idx as PackedInt32Array).size() > 0:
			for i: int in idx:
				vs.append(v[i])
				ns.append(nn[i] if has_n else Vector3.ZERO)
		else:
			vs.append_array(v)
			if has_n:
				ns.append_array(nn)
			else:
				ns.resize(vs.size())
	@warning_ignore("integer_division")
	var tris := vs.size() / 3
	if tris == 0:
		return out
	var cum := PackedFloat32Array()
	cum.resize(tris)
	var total := 0.0
	for t in tris:
		var a := vs[t * 3]
		total += (vs[t * 3 + 1] - a).cross(vs[t * 3 + 2] - a).length() * .5
		cum[t] = total
	out.resize(n * 6)
	for i in n:
		var t := mini(cum.bsearch(randf() * total), tris - 1)
		var u := randf()
		var w := randf()
		if u + w > 1.0:
			u = 1.0 - u
			w = 1.0 - w
		var a := vs[t * 3]
		var b := vs[t * 3 + 1]
		var c := vs[t * 3 + 2]
		var p := a + (b - a) * u + (c - a) * w
		var nr := ns[t * 3] * (1.0 - u - w) + ns[t * 3 + 1] * u + ns[t * 3 + 2] * w
		if nr.length() < 1e-6:
			nr = (b - a).cross(c - a)
		nr = nr.normalized()
		out[i * 6] = -p.z
		out[i * 6 + 1] = p.y
		out[i * 6 + 2] = p.x
		out[i * 6 + 3] = -nr.z
		out[i * 6 + 4] = nr.y
		out[i * 6 + 5] = nr.x
	return out


func _from_spheres(n: int, sph: PackedFloat32Array) -> void:
	pts.resize(n * 6)
	for i in n:
		var j := (i % 4) * 4
		var u := randf() * 2.0 - 1.0
		var a := randf() * TAU
		var q := sqrt(1.0 - u * u)
		var r := sph[j + 3]
		pts[i * 6] = sph[j] + q * cos(a) * r
		pts[i * 6 + 1] = sph[j + 1] + u * r
		pts[i * 6 + 2] = sph[j + 2] + q * sin(a) * r
		pts[i * 6 + 3] = q * cos(a)
		pts[i * 6 + 4] = u
		pts[i * 6 + 5] = q * sin(a)
	count = n
	from_model = false
