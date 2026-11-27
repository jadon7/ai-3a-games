extends RefCounted
## 关卡数据、图元与射线求交。构建完成后只读，可以在工作线程里并发调用。
##
## 地图图例：R 岩壁  . 海床(散落骨骸)  k 脉管林  x 巨兽肋骨笼  X 肋骨桥  a 心囊(环境声)  S/s 黏液  ~ 血海裂谷(无回声)
##           H 舱壁  P 求生舱  D 舱门  # 遗迹墙  _ 遗迹地面  o 有机墙  , 巢室地面(悬挂卵囊)  c 共鸣水晶
##           G 遗迹入口  B 唱诗井  T 井门(声锁)  C 耳石(两块都醒着井门才开)  L/l 回声日志
## 布局：西侧海床 → 肋骨桥跨过裂谷 → 方尖碑前庭 → 遗迹（中殿直通井门，北翼巢室、南翼壁刻厅各藏一块耳石）
## 材质号：1 遗迹金属  2 有机  3 水晶  4 岩/沙  5 骨  6 脉管  7 舱体  8 脏器
## 图元：0 球  1 竖直圆柱  2 长方体  3 胶囊（任意两点）  4 椭球

const CS := 3.0
const HT := 3.6
const MW := 40
const PST := 14          # 图元步长：type, mat, 6 个参数, solid, 附加（胶囊半径 / 椭球标记）, 包围球 x y z r²

const MAP := [
	"RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
	"RRRR..kk..RR....RR~~~~RRR#####C#########",
	"RHHH.kk.k........R~~~~...##,,,,,,#######",
	"RHPD..k.kk....x....~~~...##,,,,,,#######",
	"RHHH.k.kk....xx....~~~...##,,oo,,#######",
	"RR...kk.k..a..x...~~~~...##,,,,,,#######",
	"R..k.k..L.........~~~~...##,a,,,,###c###",
	"R.kk..k...RR......~~~....##,,,,,,##____#",
	"RR.k.k....RRR.....~~~....##c#_#####____#",
	"R...kk.......k....~~~~...#________#____#",
	"R.SS.........L....XXXX...G_______lT__B_#",
	"R.SS.k..RR....k...~~~~...#________#____#",
	"RR....k.RR.........~~~...######_###____#",
	"R..k.....x...k.....~~~...##______##____#",
	"R.kk.kk..xx.......~~~~...##______####c##",
	"RR..k.k.......RR..~~~~.a.##__ss__#######",
	"R....k....k...RR..~~~....##__ss_l#######",
	"RR.......kk.......~~~....##______#######",
	"RRR..k..x........R~~~~..R##______#######",
	"RRRRRRRRRRRRRRRRRRRRRRRRR#####C#########",
	"RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
]

## 潮听者：[格 x, 格 z, 苏醒阶段]。阶段 0 开局就在；之后随流程推进一批批醒来
const SPAWN := [[6, 16, 0], [16, 7, 1], [23, 5, 1], [28, 3, 2], [28, 17, 2], [33, 11, 3], [26, 9, 4], [31, 5, 5], [31, 15, 5], [23, 12, 6], [9, 8, 6]]

const LORE := {
	"L0": "回声日志 01 · 长庚号声呐测绘记录：「第 3 次主动脉冲后 0.4 秒，海面以下传回了不属于我们的回波。」",
	"L1": "残骸信标 · 求生舱 03：舱门已从内部打开。舱内无人。无声。",
	"l0": "壁刻译文（置信 54%）：「井只为齐声而开。向南北两块耳石各喊一声，让它们一起醒着。」",
	"l1": "壁刻译文（置信 61%）：「我们学会了不出声。于是海里只剩下它们的声音。」",
}

var MH := 0
var NC := 0
var wall_m := PackedByteArray()
var wall_h := PackedFloat32Array()
var floor_t := PackedByteArray()
var ceil_t := PackedByteArray()
var prim := PackedFloat32Array()
var cp_start := PackedInt32Array()
var cp_idx := PackedInt32Array()
var keys: Array[Vector2i] = []            # 两块耳石所在的格
var key_face: Array[Vector3] = []        # 耳石朝向房间的那一面（它发声的位置）
var door_k := -1
var door_p := Vector2.ZERO
var ambients: Array[Vector2] = []
var lores: Array = []                    # [x, z, 文本]
var pod_c := Vector2i(2, 3)
var hatch_k := 0
var gate_p := Vector2.ZERO
var core_p := Vector2.ZERO
var PX := 0.0
var PZ := 0.0
# 声呐深度色阶：回波延迟（距离，米）→ 颜色。从骨白一路沉到暗青，不出现紫和品红——血海里没有好看的颜色
var ds := PackedFloat32Array([0, 1, .96, .86,  3, .78, .92, .84,  8, .42, .78, .76,  16, .2, .55, .6,  28, .11, .36, .45,  45, .07, .24, .33])
var _cells: Array = []


static func hsh(x: float, z: float) -> float:
	var s := sin(x * 127.1 + z * 311.7) * 43758.5453
	return s - floor(s)


static func th(x: float, z: float) -> float:
	return 0.22 * (sin(x * 0.55 + 1.3) * cos(z * 0.47) + 1.0) + 0.05 * (sin(x * 1.9 + z * 1.3) + 1.0)


static func relief(u: float, y: float) -> int:
	if fposmod(u, 1.5) < 0.09 or fposmod(y, 1.2) < 0.07:
		return -1
	if y > 1.25 and y < 2.35 and hsh(floor(u / 0.25) * 1.7, floor(y / 0.25) * 2.3 + floor(u / 1.5)) > 0.62:
		return 1
	return 0


func depth_col(t: float) -> Color:
	var i := 0
	while i < 4 and t > ds[(i + 1) * 4]:
		i += 1
	var a := i * 4
	var k := clampf((t - ds[a]) / (ds[a + 4] - ds[a]), 0.0, 1.0)
	return Color(lerpf(ds[a + 1], ds[a + 5], k), lerpf(ds[a + 2], ds[a + 6], k), lerpf(ds[a + 3], ds[a + 7], k))


# ---------- 图元登记 ----------
func _reg(idx: int, x: float, z: float, r: float) -> void:
	r += 0.01
	for cz in range(floori((z - r) / CS), floori((z + r) / CS) + 1):
		for cx in range(floori((x - r) / CS), floori((x + r) / CS) + 1):
			if cx < 0 or cz < 0 or cx >= MW or cz >= MH:
				continue
			(_cells[cz * MW + cx] as Array).append(idx)


func _push(a: Array) -> int:
	@warning_ignore("integer_division")
	var idx := prim.size() / PST
	for v in a:
		prim.append(float(v))
	return idx


func add_sphere(x: float, y: float, z: float, r: float, mat: int) -> void:
	_reg(_push([0.0, mat, x, y, z, r, 0.0, 0.0, 0.0, 0.0, x, y, z, r * r]), x, z, r)


func add_cyl(x: float, z: float, r: float, y0: float, y1: float, mat: int, solid := false) -> void:
	_reg(_push([1.0, mat, x, z, r, y0, y1, 0.0, 1.0 if solid else 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]), x, z, r)


func add_box(x0: float, y0: float, z0: float, x1: float, y1: float, z1: float, mat: int, solid := false) -> void:
	var r := sqrt((x1 - x0) * (x1 - x0) + (z1 - z0) * (z1 - z0)) / 2.0
	_reg(_push([2.0, mat, x0, y0, z0, x1, y1, z1, 1.0 if solid else 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]), (x0 + x1) / 2.0, (z0 + z1) / 2.0, r)


## 胶囊：a → b 两点之间，半径 r
func add_cap(ax: float, ay: float, az: float, bx: float, by: float, bz: float, r: float, mat: int) -> void:
	var hl := sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az)) / 2.0
	var br := sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay) + (bz - az) * (bz - az)) / 2.0 + r
	_reg(_push([3.0, mat, ax, ay, az, bx, by, bz, 0.0, r, (ax + bx) / 2.0, (ay + by) / 2.0, (az + bz) / 2.0, br * br]), (ax + bx) / 2.0, (az + bz) / 2.0, hl + r)


## 椭球。tag：脏器 = 心跳相位延迟；骨 = 100 + 朝向角时表示颅骨（射线着色时挖出眼窝、鼻孔和牙缝）
func add_ell(x: float, y: float, z: float, rx: float, ry: float, rz: float, mat: int, tag := 0.0) -> void:
	var br := maxf(rx, maxf(ry, rz))
	_reg(_push([4.0, mat, x, y, z, rx, ry, rz, 0.0, tag, x, y, z, br * br]), x, z, maxf(rx, rz))


## 脉管林：从海床升起的血管，沿途鼓着瓣膜结节
func _vessels(wx: float, wz: float, x: int, z: int) -> void:
	for i in 4:
		var px := wx + (hsh(x + i, z) - .5) * 2.4
		var pz := wz + (hsh(x, z + i * 3) - .5) * 2.4
		var py := 0.0
		var h := 3.0 + hsh(x * 3 + i, z * 7) * 5.0
		for j in 4:
			var ny := h * (j + 1) / 4.0
			var nx := px + (hsh(x * 7 + i, z + j * 5) - .5) * .8
			var nz := pz + (hsh(x + j * 3, z * 5 + i) - .5) * .8
			add_cap(px, py, pz, nx, ny, nz, .1 - .017 * j, 6)
			if j < 3 and hsh(x * 2 + i * 5, z * 3 + j) > .3:
				var r := .17 + hsh(x + i, z + j * 7) * .09
				add_ell(nx, ny, nz, r, r * 1.35, r, 8, ny * .11)
			px = nx
			py = ny
			pz = nz


## 巨兽的肋骨笼：脊椎铺在地上，肋骨从两侧升起、在头顶合拢但不闭合。ns = 肋骨沿 z 张开（通道沿 x）
func _ribcage(wx: float, wz: float, ns: bool, x: int, z: int) -> void:
	for v in 3:
		var o := (v - 1) * 1.0
		var vx := wx + (o if ns else 0.0)
		var vz := wz + (0.0 if ns else o)
		add_ell(vx, .15, vz, .42 if ns else .34, .2, .34 if ns else .42, 5)
		for sg: float in [-1.0, 1.0]:
			if ns:
				add_cap(vx, .2, vz + sg * .25, vx, .3, vz + sg * .62, .07, 5)
			else:
				add_cap(vx + sg * .25, .2, vz, vx + sg * .62, .3, vz, .07, 5)
	for kk in 2:
		var o := -.75 + kk * 1.5
		for si in 2:
			var sg := -1.0 if si == 0 else 1.0
			var cut := 1.0
			if hsh(x * 13 + kk * 3, z * 17 + si * 5) > .76:
				cut = .35 + hsh(x + kk, z + si) * .3          # 折断的肋骨
			var pl := 0.0
			var ph := 0.0
			var pa := 0.0
			for j in 8:
				var s := j / 7.0
				if s > cut:
					break
				var th2 := PI * s * .92
				var lat := .42 + sin(th2)
				var hgt := .14 + 1.575 * (1.0 - cos(th2))
				var al := o + .3 * s
				if j > 0:
					var r := lerpf(.15, .05, s)
					if ns:
						add_cap(wx + pa, ph, wz + sg * pl, wx + al, hgt, wz + sg * lat, r, 5)
					else:
						add_cap(wx + sg * pl, ph, wz + pa, wx + sg * lat, hgt, wz + al, r, 5)
				pl = lat
				ph = hgt
				pa = al


## 心囊：一颗还在跳的巨大心脏。主室 + 两个心房 + 主动脉弓 + 贴地的根脉
func _heart(wx: float, wz: float, x: int, z: int) -> void:
	add_ell(wx, 1.45, wz, .92, 1.0, .82, 8, 0.0)                    # 心室
	add_ell(wx + .12, .6, wz + .05, .6, .62, .55, 8, 0.0)           # 心尖，朝下扎进沙里
	add_ell(wx + .5, 2.3, wz - .25, .5, .46, .48, 8, .05)           # 两个心房
	add_ell(wx - .45, 2.35, wz + .3, .46, .42, .44, 8, .05)
	add_cyl(wx, wz, .7, 0, .12, 8, true)                            # 贴地的一圈组织，兼作碰撞
	add_cap(wx - .3, 2.5, wz + .2, wx - .5, 3.5, wz + .35, .16, 6)  # 两根向上的大血管残端
	add_cap(wx + .35, 2.5, wz - .3, wx + .45, 3.2, wz - .6, .13, 6)
	var a0 := hsh(x, z) * TAU
	var px := wx
	var py := 2.45
	var pz := wz
	for j in range(1, 7):
		var s := j / 6.0
		var nx := wx + cos(a0) * 2.6 * s
		var nz := wz + sin(a0) * 2.6 * s
		var ny := maxf(0.0, 2.45 + 1.6 * sin(PI * s) - 2.45 * s * s)
		add_cap(px, py, pz, nx, ny, nz, lerpf(.22, .12, s), 6)
		px = nx
		py = ny
		pz = nz
	for i in 4:
		var a := a0 + 1.1 + i * 1.25 + hsh(i, x) * .5
		px = wx + cos(a) * .6
		pz = wz + sin(a) * .6
		py = .3
		for j in range(1, 4):
			var d := .6 + j * (.6 + hsh(i * 3, z + j) * .25)
			var aa := a + (hsh(i + j * 5, x) - .5) * .7
			var nx := wx + cos(aa) * d
			var nz := wz + sin(aa) * d
			var ny := maxf(.05, .3 - j * .1)
			add_cap(px, py, pz, nx, ny, nz, .15 - j * .03, 6)
			px = nx
			py = ny
			pz = nz


## 海床上的骨骸：巨型颅骨 / 齿列 / 长骨 / 椎骨串
func _remains(wx: float, wz: float, x: int, z: int) -> void:
	var kind := hsh(x * 11, z * 13)
	var bx := wx + (hsh(z, x) - .5) * 1.4
	var bz := wz + (hsh(x * 2, z) - .5) * 1.4
	var yaw := hsh(x * 3, z * 11) * TAU
	var c := cos(yaw)
	var s := sin(yaw)
	if kind < .3:
		# 颅骨：半埋在沙里，脸略微朝上。眼窝、鼻孔、牙缝是着色时挖出来的
		var r := .48 + hsh(x, z * 9) * .34
		add_ell(bx, r * .78, bz, r, r * .9, r, 5, 100.0 + yaw)
		add_cyl(bx, bz, r * .68, 0, .08, 5, true)        # 藏在颅骨底下，只负责挡住玩家
	elif kind < .52:
		# 齿列：一圈从沙里戳出来的牙
		for i in 9:
			var a := yaw + (i - 4) * .4
			var tx := bx + cos(a) * .75
			var tz := bz + sin(a) * .75
			var th2 := .2 + hsh(x + i, z * 3) * .16
			add_cap(tx, 0, tz, tx - cos(a) * .04, th2, tz - sin(a) * .04, .075, 5)
			add_cap(tx - cos(a) * .04, th2, tz - sin(a) * .04, tx - cos(a) * .12, th2 * 2.1, tz - sin(a) * .12, .035, 5)
			if i > 0:
				var a1 := yaw + (i - 5) * .4
				add_cap(bx + cos(a1) * .8, .04, bz + sin(a1) * .8, bx + cos(a) * .8, .04, bz + sin(a) * .8, .09, 5)
	elif kind < .8:
		# 长骨：两根交叠，一根斜插着
		for i in 2:
			var a := yaw + i * 1.9
			var l := .7 + hsh(x + i * 7, z) * .5
			var ca := cos(a)
			var sa := sin(a)
			var y0 := .1
			var y1 := .1 + i * (.35 + hsh(x, z + i) * .5)
			var ox := bx + i * .3
			add_cap(ox - ca * l, y0, bz - sa * l, ox + ca * l, y1, bz + sa * l, .085, 5)
			for e2: float in [-1.0, 1.0]:
				var ex := ox + ca * l * e2
				var ez := bz + sa * l * e2
				var ey := y0 if e2 < 0.0 else y1
				add_sphere(ex - sa * .09, ey, ez + ca * .09, .14, 5)
				add_sphere(ex + sa * .09, ey, ez - ca * .09, .14, 5)
	else:
		# 椎骨串：一截弯曲的脊柱
		for i in 6:
			var t := (i - 2.5) * .36
			var vx := bx + c * t - s * t * t * .25
			var vz := bz + s * t + c * t * t * .25
			add_ell(vx, .13, vz, .2, .15, .2, 5)
			add_cap(vx, .2, vz, vx - s * .1, .5, vz + c * .1, .045, 5)


func _obelisk(x: float, z: float, h: float, w: float) -> void:
	add_box(x - w, 0, z - w, x + w, h * .12, z + w, 1, true)
	add_box(x - w * .75, h * .12, z - w * .75, x + w * .75, h * .7, z + w * .75, 1)
	add_box(x - w * .55, h * .7, z - w * .55, x + w * .55, h * .93, z + w * .55, 1)
	add_box(x - w * .3, h * .93, z - w * .3, x + w * .3, h, z + w * .3, 3)


func _w1(x: int, z: int) -> bool:
	return in_b(x, z) and wall_m[z * MW + x] == 1


func _init() -> void:
	MH = MAP.size()
	NC = MW * MH
	wall_m.resize(NC)
	wall_h.resize(NC)
	floor_t.resize(NC)
	ceil_t.resize(NC)
	_cells.resize(NC)
	for k in NC:
		_cells[k] = []
	var n_l := 0
	var n_s := 0
	for z in MH:
		var row: String = MAP[z]
		for x in MW:
			var ch := row[x]
			var k := z * MW + x
			var wx := (x + 0.5) * CS
			var wz := (z + 0.5) * CS
			if ch == "R":
				wall_m[k] = 4
				wall_h[k] = 4.5 + hsh(x, z) * 5.5
			elif ch == "H" or ch == "D":
				wall_m[k] = 7
				wall_h[k] = HT
				if ch == "D":
					hatch_k = k
			elif ch == "#":
				wall_m[k] = 1
				var q := hsh(x * 3, z * 5)
				wall_h[k] = 11.0 if q > .62 else (8.5 if q > .3 else 6.5)
			elif ch == "o":
				wall_m[k] = 2
				wall_h[k] = 6.5
			elif ch == "c" or ch == "C" or ch == "T":
				wall_m[k] = 3
				wall_h[k] = 6.5
				if ch == "C":
					keys.append(Vector2i(x, z))
				if ch == "T":
					door_k = k
					door_p = Vector2(wx, wz)
			elif ch == "~":
				floor_t[k] = 0
			elif ch == "P":
				floor_t[k] = 5
				ceil_t[k] = 3
			elif "_GBle".contains(ch):
				floor_t[k] = 2
				ceil_t[k] = 1
			elif ch == ",":
				floor_t[k] = 3
				ceil_t[k] = 2
			elif ch == "s":
				floor_t[k] = 4
				ceil_t[k] = 1
			elif ch == "S":
				floor_t[k] = 4
			else:
				floor_t[k] = 1
			if ch == "P":
				pod_c = Vector2i(x, z)
			if ch == "G":
				gate_p = Vector2(wx, wz)
			if ch == "B":
				core_p = Vector2(wx, wz)
			if ch == "a":
				ambients.append(Vector2(wx, wz))
			if ch == "L":
				lores.append([wx, wz, LORE["L%d" % n_l]])
				n_l += 1
			if ch == "l":
				lores.append([wx, wz, LORE["l%d" % n_s]])
				n_s += 1
			# 生态道具
			if ch == "k":
				_vessels(wx, wz, x, z)
			if ch == "x" or ch == "X":
				_ribcage(wx, wz, ch == "X" or hsh(x, z) > .5, x, z)
			if ch == "a":
				_heart(wx, wz, x, z)
			if ch == "." and hsh(x * 5, z * 3) > .74:
				_remains(wx, wz, x, z)
			if ch == ",":
				# 巢室：从顶上垂下来的卵囊
				for i in 4:
					var hx := wx + (hsh(x + i, z * 2) - .5) * 2.4
					var hz := wz + (hsh(x * 2, z + i) - .5) * 2.4
					var r := .25 + hsh(x + i * 3, z) * .13
					var y0 := 1.95 + hsh(i, x + z) * .35 + r * 1.6      # 囊心高度：囊底始终在头顶之上，人从下面走过
					add_cyl(hx, hz, .04, y0 + r * 1.4, HT, 6)
					add_ell(hx, y0, hz, r, r * 1.6, r, 8, hsh(x * 5 + i, z * 3))
	PX = (pod_c.x + .5) * CS
	PZ = (pod_c.y + .5) * CS
	for kc in keys:
		for d: Vector2i in [Vector2i(0, 1), Vector2i(0, -1), Vector2i(1, 0), Vector2i(-1, 0)]:
			if walk(kc.x + d.x, kc.y + d.y):
				key_face.append(Vector3((kc.x + .5 + d.x * .68) * CS, 1.7, (kc.y + .5 + d.y * .68) * CS))
				break
	for sp: Array in SPAWN:
		if not walk(sp[0], sp[1]):
			push_error("潮听者出生点不可走：%s" % str(sp))
	_build_ruins()
	# 压成 CSR，方便线程里无锁读取
	cp_start.resize(NC + 1)
	for k in NC:
		cp_start[k] = cp_idx.size()
		for idx: int in _cells[k]:
			cp_idx.append(idx)
	cp_start[NC] = cp_idx.size()
	_cells.clear()


## 遗迹建筑：壁柱、拱梁、立柱、外扶壁、方尖碑大道、唱诗井
func _build_ruins() -> void:
	for z in MH:
		for x in MW:
			var k := z * MW + x
			var wx := x * CS
			var wz := z * CS
			var cx := wx + 1.5
			var cz := wz + 1.5
			var f := floor_t[k]
			if (f == 2 or f == 4) and ceil_t[k] == 1 and wall_m[k] == 0:
				var n := _w1(x, z - 1)
				var s := _w1(x, z + 1)
				var w := _w1(x - 1, z)
				var e := _w1(x + 1, z)
				if n:
					add_box(cx - .35, 0, wz, cx + .35, HT, wz + .22, 1)
					add_box(cx - .5, 0, wz, cx + .5, .35, wz + .34, 1)
					add_box(cx - .5, HT - .4, wz, cx + .5, HT, wz + .4, 1)
				if s:
					add_box(cx - .35, 0, wz + CS - .22, cx + .35, HT, wz + CS, 1)
					add_box(cx - .5, 0, wz + CS - .34, cx + .5, .35, wz + CS, 1)
					add_box(cx - .5, HT - .4, wz + CS - .4, cx + .5, HT, wz + CS, 1)
				if w:
					add_box(wx, 0, cz - .35, wx + .22, HT, cz + .35, 1)
					add_box(wx, 0, cz - .5, wx + .34, .35, cz + .5, 1)
					add_box(wx, HT - .4, cz - .5, wx + .4, HT, cz + .5, 1)
				if e:
					add_box(wx + CS - .22, 0, cz - .35, wx + CS, HT, cz + .35, 1)
					add_box(wx + CS - .34, 0, cz - .5, wx + CS, .35, cz + .5, 1)
					add_box(wx + CS - .4, HT - .4, cz - .5, wx + CS, HT, cz + .5, 1)
				if n and s and (x & 1) == 1:
					add_box(cx - .25, 2.85, wz, cx + .25, 3.3, wz + CS, 1)
					add_box(cx - .2, 2.4, wz + .22, cx + .2, 2.85, wz + .6, 1)
					add_box(cx - .2, 2.4, wz + CS - .6, cx + .2, 2.85, wz + CS - .22, 1)
				elif w and e and (z & 1) == 1:
					add_box(wx, 2.85, cz - .25, wx + CS, 3.3, cz + .25, 1)
					add_box(wx + .22, 2.4, cz - .2, wx + .6, 2.85, cz + .2, 1)
					add_box(wx + CS - .6, 2.4, cz - .2, wx + CS - .22, 2.85, cz + .2, 1)
				elif not n and not s and not w and not e and hsh(x * 7, z * 3) > .4:
					add_cyl(wx, wz, .36, 0, HT, 1, true)
					add_box(wx - .5, 0, wz - .5, wx + .5, .3, wz + .5, 1)
					add_box(wx - .5, HT - .35, wz - .5, wx + .5, HT, wz + .5, 1)
				elif hsh(x * 5, z * 9) > .5:
					add_box(wx, 3.25, cz - .18, wx + CS, HT, cz + .18, 1)
			if f == 1 and wall_m[k] == 0 and _w1(x + 1, z):
				var h := wall_h[k + 1]
				add_box(wx + CS - .9, 0, cz - .45, wx + CS, h * .45, cz + .45, 1)
				add_box(wx + CS - .5, h * .45, cz - .3, wx + CS, h * .8, cz + .3, 1)
				add_box(wx + CS - .22, h * .8, cz - .18, wx + CS, h, cz + .18, 1)
	# 方尖碑大道：从桥头一路夹着通向遗迹入口的那一行
	var gcx := floori(gate_p.x / CS)
	var gcz := floori(gate_p.y / CS)
	for o: Array in [[0, 0, 11.0], [0, 1, 11.0], [-1, 0, 8.0], [-1, 1, 8.0], [0, -2, 6.0], [0, 3, 6.0]]:
		_obelisk((gcx + o[0]) * CS, (gcz + o[1]) * CS, o[2], .55)
	# 桥两头的断柱
	for o: Array in [[18, 10, 2.2], [18, 11, 3.6], [22, 10, 3.0], [22, 11, 1.6], [16, 6, 1.4]]:
		var gx: float = o[0] * CS
		var gz: float = o[1] * CS
		add_cyl(gx, gz, .4, 0, o[2], 1, true)
		add_box(gx - .55, 0, gz - .55, gx + .55, .3, gz + .55, 1)
	var ax := gate_p.x - 1.5
	var az := gate_p.y
	add_box(ax, 0, az - 1.5, ax + CS, HT, az - 1.0, 1)
	add_box(ax, 0, az + 1.0, ax + CS, HT, az + 1.5, 1)
	add_box(ax, 2.8, az - 1.5, ax + CS, HT, az + 1.5, 1)
	add_cyl(core_p.x, core_p.y, .28, 0, HT, 1, true)
	add_box(core_p.x - .7, 0, core_p.y - .7, core_p.x + .7, .25, core_p.y + .7, 1)
	for y: float in [1.0, 1.8, 2.6]:
		for i in 14:
			var a := i / 14.0 * TAU + y
			add_sphere(core_p.x + cos(a) * .95, y, core_p.y + sin(a) * .95, .09, 3)


# ---------- 查询 ----------
func in_b(x: int, z: int) -> bool:
	return x >= 0 and z >= 0 and x < MW and z < MH


func walk(x: int, z: int) -> bool:
	return x >= 0 and z >= 0 and x < MW and z < MH and wall_m[z * MW + x] == 0 and floor_t[z * MW + x] != 0


func blocked(x: int, z: int) -> bool:
	return not (x >= 0 and z >= 0 and x < MW and z < MH) or wall_m[z * MW + x] != 0


func cell_of(v: float) -> int:
	return floori(v / CS)


func floor_at(x: float, z: float) -> int:
	var cx := floori(x / CS)
	var cz := floori(z / CS)
	return floor_t[cz * MW + cx] if in_b(cx, cz) else 0


func solid_at(x: float, z: float) -> bool:
	var cx := floori(x / CS)
	var cz := floori(z / CS)
	if not in_b(cx, cz):
		return false
	var k := cz * MW + cx
	for q in range(cp_start[k], cp_start[k + 1]):
		var b := cp_idx[q] * PST
		if prim[b + 8] == 0.0:
			continue
		if prim[b] == 1.0:
			var dx := x - prim[b + 2]
			var dz := z - prim[b + 3]
			var rr := prim[b + 4] + .32
			if dx * dx + dz * dz < rr * rr:
				return true
		elif prim[b] == 2.0:
			if x > prim[b + 2] - .32 and x < prim[b + 5] + .32 and z > prim[b + 4] - .32 and z < prim[b + 7] + .32:
				return true
	return false


func _near(b: int, ox: float, oy: float, oz: float, dx: float, dy: float, dz: float) -> bool:
	var lx := ox - prim[b + 10]
	var ly := oy - prim[b + 11]
	var lz := oz - prim[b + 12]
	var bb := lx * dx + ly * dy + lz * dz
	return bb * bb - (lx * lx + ly * ly + lz * lz - prim[b + 13]) >= 0.0


## 格内图元求交。返回最近的 t（没有则 1e9），命中材质写入 out[4]。
func prim_hit(p0: int, p1: int, ox: float, oy: float, oz: float, dx: float, dy: float, dz: float, out: PackedFloat32Array) -> float:
	var best := 1e9
	for q in range(p0, p1):
		var b := cp_idx[q] * PST
		var ty := prim[b]
		var t := 0.0
		if ty == 0.0:
			var lx := ox - prim[b + 2]
			var ly := oy - prim[b + 3]
			var lz := oz - prim[b + 4]
			var r := prim[b + 5]
			var bb := lx * dx + ly * dy + lz * dz
			var d := bb * bb - (lx * lx + ly * ly + lz * lz - r * r)
			if d < 0.0:
				continue
			t = -bb - sqrt(d)
		elif ty == 1.0:
			var a := dx * dx + dz * dz
			if a < 1e-6:
				continue
			var lx := ox - prim[b + 2]
			var lz := oz - prim[b + 3]
			var r := prim[b + 4]
			var bb := (lx * dx + lz * dz) / a
			var d := bb * bb - (lx * lx + lz * lz - r * r) / a
			if d < 0.0:
				continue
			t = -bb - sqrt(d)
			var y := oy + dy * t
			if y < prim[b + 5] or y > prim[b + 6]:
				continue
		elif ty == 2.0:
			var ix := 1.0 / dx
			var iy := 1.0 / dy
			var iz := 1.0 / dz
			var a := (prim[b + 2] - ox) * ix
			var c := (prim[b + 5] - ox) * ix
			var tn := minf(a, c)
			var tf := maxf(a, c)
			a = (prim[b + 3] - oy) * iy
			c = (prim[b + 6] - oy) * iy
			tn = maxf(tn, minf(a, c))
			tf = minf(tf, maxf(a, c))
			a = (prim[b + 4] - oz) * iz
			c = (prim[b + 7] - oz) * iz
			tn = maxf(tn, minf(a, c))
			tf = minf(tf, maxf(a, c))
			if not (tf >= tn):
				continue
			t = tn
		elif ty == 3.0:
			if not _near(b, ox, oy, oz, dx, dy, dz):
				continue
			var o := Vector3(ox, oy, oz)
			var rd := Vector3(dx, dy, dz)
			var pa := Vector3(prim[b + 2], prim[b + 3], prim[b + 4])
			var pb := Vector3(prim[b + 5], prim[b + 6], prim[b + 7])
			var r := prim[b + 9]
			var ba := pb - pa
			var oa := o - pa
			var baba := ba.dot(ba)
			var bard := ba.dot(rd)
			var baoa := ba.dot(oa)
			var ka := baba - bard * bard
			var kb := baba * rd.dot(oa) - baoa * bard
			var kh := kb * kb - ka * (baba * oa.dot(oa) - baoa * baoa - r * r * baba)
			if kh < 0.0:
				continue
			var yy := -1.0 if bard > 0.0 else baba + 1.0
			if ka > 1e-9:
				t = (-kb - sqrt(kh)) / ka
				yy = baoa + t * bard
			if yy <= 0.0 or yy >= baba:
				var oc := oa if yy <= 0.0 else o - pb
				var cb := rd.dot(oc)
				var ch := cb * cb - (oc.dot(oc) - r * r)
				if ch < 0.0:
					continue
				t = -cb - sqrt(ch)
		else:
			var ir := Vector3(1.0 / prim[b + 5], 1.0 / prim[b + 6], 1.0 / prim[b + 7])
			var eo := Vector3(ox - prim[b + 2], oy - prim[b + 3], oz - prim[b + 4]) * ir
			var ed := Vector3(dx, dy, dz) * ir
			var ea := ed.dot(ed)
			var eb := eo.dot(ed)
			var eh := eb * eb - ea * (eo.dot(eo) - 1.0)
			if eh < 0.0:
				continue
			t = (-eb - sqrt(eh)) / ea
		if t > 0.02 and t < best:
			best = t
			out[4] = prim[b + 1]
	return best


## 射线求交。返回材质号（>0 命中，out[0]=t，out[1]=命中面：0 地/顶 1/2 墙轴 3 图元，out[2..3]=墙格）；
## 0 = 超出量程；-1 = 被吞没或飞出（血海、黏液、越过墙顶、开阔水体），此时 out[0] 是射线终止处的 t。
func trace(ox: float, oy: float, oz: float, dx: float, dy: float, dz: float, max_t: float, out: PackedFloat32Array) -> int:
	var cx := floori(ox / CS)
	var cz := floori(oz / CS)
	out[0] = 0.0
	if cx < 0 or cz < 0 or cx >= MW or cz >= MH:
		return -1
	if absf(dx) < 1e-7:
		dx = 1e-7
	if absf(dy) < 1e-7:
		dy = 1e-7
	if absf(dz) < 1e-7:
		dz = 1e-7
	var sx := 1 if dx > 0.0 else -1
	var sz := 1 if dz > 0.0 else -1
	var up := dy > 0.0
	var tdx := absf(CS / dx)
	var tdz := absf(CS / dz)
	var tmx := (((cx + 1) * CS if dx > 0.0 else cx * CS) - ox) / dx
	var tmz := (((cz + 1) * CS if dz > 0.0 else cz * CS) - oz) / dz
	var ty := (HT - oy) / dy if up else -oy / dy
	var open_sky := false
	for i in 140:
		var k := cz * MW + cx
		var tn := minf(tmx, tmz)
		var p0 := cp_start[k]
		var p1 := cp_start[k + 1]
		if p1 > p0:
			var tp := prim_hit(p0, p1, ox, oy, oz, dx, dy, dz, out)
			if tp < tn + .001 and tp < ty and tp <= max_t:
				out[0] = tp
				out[1] = 3.0
				return int(out[4])
		if ty <= tn:
			if ty > max_t:
				return 0
			if up:
				var c := ceil_t[k]
				if c != 0:
					out[0] = ty
					out[1] = 0.0
					return 2 if c == 2 else (7 if c == 3 else 1)
				ty = 1e9            # 无顶：开阔水体
				open_sky = true
			else:
				var f := floor_t[k]
				out[0] = ty
				if f == 0 or f == 4:
					return -1       # 血海 / 黏液：吞声
				out[1] = 0.0
				return 4 if f == 1 else (1 if f == 2 else (7 if f == 5 else 2))
		if tn > max_t:
			return 0
		var ax := 1
		if tmx < tmz:
			cx += sx
			tmx += tdx
		else:
			cz += sz
			tmz += tdz
			ax = 2
		out[0] = tn
		if cx < 0 or cz < 0 or cx >= MW or cz >= MH:
			return -1
		var k2 := cz * MW + cx
		if wall_m[k2] != 0:
			if oy + dy * tn > wall_h[k2]:
				return -1
			out[1] = ax
			out[2] = cx
			out[3] = cz
			return wall_m[k2]
		if open_sky and ceil_t[k2] != 0:
			return -1
	return -1


## 平面视线（只看墙）
func los(x0: float, z0: float, x1: float, z1: float) -> bool:
	var dx := x1 - x0
	var dz := z1 - z0
	var l := sqrt(dx * dx + dz * dz)
	if l < 1e-4:
		return true
	dx /= l
	dz /= l
	if absf(dx) < 1e-7:
		dx = 1e-7
	if absf(dz) < 1e-7:
		dz = 1e-7
	var cx := floori(x0 / CS)
	var cz := floori(z0 / CS)
	var sx := 1 if dx > 0.0 else -1
	var sz := 1 if dz > 0.0 else -1
	var tdx := absf(CS / dx)
	var tdz := absf(CS / dz)
	var tmx := (((cx + 1) * CS if dx > 0.0 else cx * CS) - x0) / dx
	var tmz := (((cz + 1) * CS if dz > 0.0 else cz * CS) - z0) / dz
	for i in 120:
		if minf(tmx, tmz) > l:
			return true
		if tmx < tmz:
			cx += sx
			tmx += tdx
		else:
			cz += sz
			tmz += tdz
		if blocked(cx, cz):
			return false
	return true
