extends RefCounted
## 声脉冲求交。一个脉冲 = 一批射线，在工作线程里一次算完；
## 每个回波点带"到达时间"(t0 + 距离/声速)，由点云着色器按时间显形，所以主线程没有逐帧推进的开销。
##
## 性能注意：run_chunk 故意写成一个不调用任何脚本函数的大函数。
## GDScript 每次函数调用都会给共享的脚本资源加减引用计数，多个线程同时这样做会互相拖慢，
## 实测把调用内联后才能随线程数正常加速。每个工作线程用一个独立的 Tracer 实例（见 sonar_view）。

const WorldData := preload("res://scripts/world.gd")
const PF := 20                 # MultiMesh 每实例浮点数：12 变换 + 4 颜色 + 4 自定义
const CS := 3.0
const HT := 3.6
const MW := 40
const PST := 14

var world: WorldData
var mh := 0
var wall_m: PackedByteArray
var wall_h: PackedFloat32Array
var floor_t: PackedByteArray
var ceil_t: PackedByteArray
var prim: PackedFloat32Array
var cp_start: PackedInt32Array
var cp_idx: PackedInt32Array
var dsc: PackedFloat32Array
# 潮听者的身体：4 个球 (前向偏移, 高度, 侧向偏移, 半径)
var sph := PackedFloat32Array([0, 1.25, 0, .58,  .5, 1.8, 0, .34,  -.1, .55, .32, .34,  -.1, .55, -.32, .34])


class Job extends RefCounted:
	var x := 0.0
	var y := 0.0
	var z := 0.0
	var cone := false
	var cdx := 0.0
	var cdy := 0.0
	var cdz := 0.0
	var ux := 0.0
	var uy := 0.0
	var uz := 0.0
	var vx := 0.0
	var vy := 0.0
	var vz := 0.0
	var ang := 0.0
	var rng := 10.0            # 量程（米）
	var rays := 100
	var n := 100               # 射线总数（含悬浮物射线和擦边射线）
	var snow_b := .16          # 悬浮物回波的亮度。怒吼的声浪把它调高：水体本身被填满，声呐被淹没
	var rim := 0               # 擦边射线数：贴着每只潮听者的轮廓擦过去，把它投在身后的声影描一圈亮边
	var cr := 1.0
	var cg := 1.0
	var cb := 1.0
	var life := 4.0
	var sp := 24.0             # 声速（米/秒）
	var player := false        # 玩家发出的脉冲按深度着色
	var loud := false
	var t0 := 0.0
	var en := PackedFloat32Array()   # 敌人快照：x, z, yaw
	var results: Array = []
	var chunk := 1024
	var gid := -1
	var seed := 0
	var epoch := 0
	var t_us := 0


func bind_world(w: WorldData) -> void:
	world = w
	mh = w.MH
	wall_m = w.wall_m
	wall_h = w.wall_h
	floor_t = w.floor_t
	ceil_t = w.ceil_t
	prim = w.prim
	cp_start = w.cp_start
	cp_idx = w.cp_idx
	dsc = w.ds.duplicate()


## 射线与一只潮听者求交（主线程用：开火判定）
func ray_sph(ex: float, ez: float, eyaw: float, ox: float, oy: float, oz: float, dx: float, dy: float, dz: float) -> float:
	var best := 1e9
	var c := sin(eyaw)
	var s := -cos(eyaw)
	for j in 4:
		var f := sph[j * 4]
		var sd := sph[j * 4 + 2]
		var r := sph[j * 4 + 3]
		var lx := ox - (ex + c * f - s * sd)
		var ly := oy - sph[j * 4 + 1]
		var lz := oz - (ez + s * f + c * sd)
		var b := lx * dx + ly * dy + lz * dz
		var d := b * b - (lx * lx + ly * ly + lz * lz - r * r)
		if d < 0.0:
			continue
		var t := -b - sqrt(d)
		if t > 0.0 and t < best:
			best = t
	return best


## 工作线程入口：算第 c 段射线，结果写进 J.results[c] = [点缓冲, 水晶命中数, 格x, 格z, 距离]
func run_chunk(c: int, J: Job) -> void:
	var i0 := c * J.chunk
	var i1 := mini(J.n, i0 + J.chunk)
	var rg := RandomNumberGenerator.new()
	rg.seed = J.seed + c * 7919 + 13
	var buf := PackedFloat32Array()
	buf.resize(maxi(0, i1 - i0) * 3 * PF)
	var n := 0
	var ox := J.x
	var oy := J.y
	var oz := J.z
	var rays := J.rays
	var rmax := J.rng
	var sp := J.sp
	var t0 := J.t0
	var jlife := J.life
	var jr := J.cr
	var jg := J.cg
	var jb := J.cb
	var player := J.player
	var loud := J.loud
	var snow_b := J.snow_b
	var flood := snow_b > .2
	var en := J.en
	@warning_ignore("integer_division")
	var en_n := en.size() / 3
	var cone := J.cone
	var ang := J.ang
	var cdx := J.cdx
	var cdy := J.cdy
	var cdz := J.cdz
	var ux := J.ux
	var uy := J.uy
	var uz := J.uz
	var vx := J.vx
	var vy := J.vy
	var vz := J.vz
	var cn := 0
	var ckx := 0
	var ckz := 0
	var ckt := 0.0
	var ocx := floori(ox / CS)
	var ocz := floori(oz / CS)
	if ocx < 0 or ocz < 0 or ocx >= MW or ocz >= mh:
		J.results[c] = [PackedFloat32Array(), 0, 0, 0, 0.0]
		return
	var rim0 := J.n - J.rim
	@warning_ignore("integer_division")
	var rim_per := maxi(1, J.rim / maxi(1, en_n * 4))
	for i in range(i0, i1):
		# ---------- 方向 ----------
		var dx := 0.0
		var dy := 0.0
		var dz := 0.0
		var rim_l := 0.0                      # >0：擦边射线，值 = 到那只潮听者的距离
		if i >= rim0:
			# 朝某只潮听者身上的某个球，刚好从它边缘外侧一点擦过去
			var rm_r := i - rim0
			@warning_ignore("integer_division")
			var rm_k := mini(rm_r / (rim_per * 4), en_n - 1)
			@warning_ignore("integer_division")
			var rm_j := (rm_r / rim_per) % 4
			var rm_yw := en[rm_k * 3 + 2]
			var rm_c := sin(rm_yw)
			var rm_s := -cos(rm_yw)
			var rm_ax := en[rm_k * 3] + rm_c * sph[rm_j * 4] - rm_s * sph[rm_j * 4 + 2] - ox
			var rm_ay := sph[rm_j * 4 + 1] - oy
			var rm_az := en[rm_k * 3 + 1] + rm_s * sph[rm_j * 4] + rm_c * sph[rm_j * 4 + 2] - oz
			rim_l = sqrt(rm_ax * rm_ax + rm_ay * rm_ay + rm_az * rm_az)
			var rm_sr := sph[rm_j * 4 + 3]
			if rim_l < rm_sr + .5:
				continue
			rm_ax /= rim_l
			rm_ay /= rim_l
			rm_az /= rim_l
			var rm_bl := sqrt(rm_ax * rm_ax + rm_az * rm_az)
			if rm_bl < 1e-4:
				continue
			var rm_ux := -rm_az / rm_bl
			var rm_uz := rm_ax / rm_bl
			var rm_vx := rm_ay * rm_uz
			var rm_vy := rm_az * rm_ux - rm_ax * rm_uz
			var rm_vz := -rm_ay * rm_ux
			var rm_be := asin(rm_sr / rim_l) + (.015 + rg.randf() * .09) / rim_l
			var rm_ph := rg.randf() * TAU
			var rm_sb := sin(rm_be)
			var rm_cb := cos(rm_be)
			var rm_cp := cos(rm_ph) * rm_sb
			var rm_sp := sin(rm_ph) * rm_sb
			dx = rm_ax * rm_cb + rm_ux * rm_cp + rm_vx * rm_sp
			dy = rm_ay * rm_cb + rm_vy * rm_sp
			dz = rm_az * rm_cb + rm_uz * rm_cp + rm_vz * rm_sp
		elif cone:
			var a := ang * sqrt(rg.randf())
			var ph := rg.randf() * TAU
			var st := sin(a)
			var ca := cos(a)
			var cp := cos(ph) * st
			var sn := sin(ph) * st
			dx = cdx * ca + ux * cp + vx * sn
			dy = cdy * ca + uy * cp + vy * sn
			dz = cdz * ca + uz * cp + vz * sn
		else:
			var u := (rg.randf() * 2.0 - 1.0) * .86
			var a := rg.randf() * TAU
			var qq := sqrt(1.0 - u * u)
			dx = qq * cos(a)
			dy = u
			dz = qq * sin(a)
		if absf(dx) < 1e-7:
			dx = 1e-7
		if absf(dy) < 1e-7:
			dy = 1e-7
		if absf(dz) < 1e-7:
			dz = 1e-7
		var ix := 1.0 / dx
		var iy := 1.0 / dy
		var iz := 1.0 / dz
		var snow := i >= rays and i < rim0    # 悬浮物射线：没撞到东西就在水里留一粒很暗的"雪"
		var max_t := rmax
		if snow:
			max_t = rmax * .8 * pow(rg.randf(), 1.0 / 3.0)
		# ---------- 敌人（包围球预筛 + 4 个球） ----------
		var te := 1e9
		if not snow:
			for k in en_n:
				var ex := en[k * 3]
				var ez := en[k * 3 + 1]
				var lx := ox - ex
				var ly := oy - 1.2
				var lz := oz - ez
				var bb := lx * dx + ly * dy + lz * dz
				if bb * bb - (lx * lx + ly * ly + lz * lz - 1.6) < 0.0:
					continue
				var yw := en[k * 3 + 2]
				var ec := sin(yw)
				var es := -cos(yw)
				for j in 4:
					var sf := sph[j * 4]
					var sd := sph[j * 4 + 2]
					var sr := sph[j * 4 + 3]
					var mx := ox - (ex + ec * sf - es * sd)
					var my := oy - sph[j * 4 + 1]
					var mz := oz - (ez + es * sf + ec * sd)
					var mb := mx * dx + my * dy + mz * dz
					var md := mb * mb - (mx * mx + my * my + mz * mz - sr * sr)
					if md < 0.0:
						continue
					var mt := -mb - sqrt(md)
					if mt > 0.0 and mt < te:
						te = mt
		# ---------- 网格步进 + 格内图元 ----------
		var cx := ocx
		var cz := ocz
		var sx := 1 if dx > 0.0 else -1
		var sz := 1 if dz > 0.0 else -1
		var up := dy > 0.0
		var tdx := absf(CS / dx)
		var tdz := absf(CS / dz)
		var tmx := (((cx + 1) * CS if dx > 0.0 else cx * CS) - ox) / dx
		var tmz := (((cz + 1) * CS if dz > 0.0 else cz * CS) - oz) / dz
		var ty := (HT - oy) / dy if up else -oy / dy
		var open_sky := false
		var m := -1            # >0 材质；0 超出量程；-1 被吞没/飞出
		var th := 0.0          # 命中或终止处的距离
		var hn := 0            # 0 地/顶，1/2 墙轴，3 图元
		var hcx := 0
		var hcz := 0
		var hb := 0             # 命中的图元在 prim 里的起始下标
		var steps := 0
		while steps < 140:
			steps += 1
			var k := cz * MW + cx
			var tn := tmx if tmx < tmz else tmz
			var p0 := cp_start[k]
			var p1 := cp_start[k + 1]
			if p1 > p0:
				var best := 1e9
				var bm := 0
				var bq := 0
				for q in range(p0, p1):
					var b := cp_idx[q] * PST
					var pty := prim[b]
					var pt := 0.0
					if pty == 0.0:
						var lx := ox - prim[b + 2]
						var ly := oy - prim[b + 3]
						var lz := oz - prim[b + 4]
						var r := prim[b + 5]
						var bb := lx * dx + ly * dy + lz * dz
						var d := bb * bb - (lx * lx + ly * ly + lz * lz - r * r)
						if d < 0.0:
							continue
						pt = -bb - sqrt(d)
					elif pty == 1.0:
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
						pt = -bb - sqrt(d)
						var py := oy + dy * pt
						if py < prim[b + 5] or py > prim[b + 6]:
							continue
					elif pty == 2.0:
						var a := (prim[b + 2] - ox) * ix
						var e := (prim[b + 5] - ox) * ix
						var bn := a if a < e else e
						var bf := e if a < e else a
						a = (prim[b + 3] - oy) * iy
						e = (prim[b + 6] - oy) * iy
						var lo := a if a < e else e
						var hi := e if a < e else a
						if lo > bn:
							bn = lo
						if hi < bf:
							bf = hi
						a = (prim[b + 4] - oz) * iz
						e = (prim[b + 7] - oz) * iz
						lo = a if a < e else e
						hi = e if a < e else a
						if lo > bn:
							bn = lo
						if hi < bf:
							bf = hi
						if not (bf >= bn):
							continue
						pt = bn
					elif pty == 3.0:
						# 先过包围球：绝大多数射线在这里就被排除
						var slx := ox - prim[b + 10]
						var sly := oy - prim[b + 11]
						var slz := oz - prim[b + 12]
						var sbb := slx * dx + sly * dy + slz * dz
						if sbb * sbb - (slx * slx + sly * sly + slz * slz - prim[b + 13]) < 0.0:
							continue
						# 胶囊：先求无限长圆柱，落在两端之外再求端球
						var cax := prim[b + 2]
						var cay := prim[b + 3]
						var caz := prim[b + 4]
						var bax := prim[b + 5] - cax
						var bay := prim[b + 6] - cay
						var baz := prim[b + 7] - caz
						var oax := ox - cax
						var oay := oy - cay
						var oaz := oz - caz
						var cr := prim[b + 9]
						var baba := bax * bax + bay * bay + baz * baz
						var bard := bax * dx + bay * dy + baz * dz
						var baoa := bax * oax + bay * oay + baz * oaz
						var ka := baba - bard * bard
						var kb := baba * (dx * oax + dy * oay + dz * oaz) - baoa * bard
						var kh := kb * kb - ka * (baba * (oax * oax + oay * oay + oaz * oaz) - baoa * baoa - cr * cr * baba)
						if kh < 0.0:
							continue
						var yy := -1.0 if bard > 0.0 else baba + 1.0
						if ka > 1e-9:
							pt = (-kb - sqrt(kh)) / ka
							yy = baoa + pt * bard
						if yy <= 0.0 or yy >= baba:
							if yy > 0.0:
								oax -= bax
								oay -= bay
								oaz -= baz
							var qb := dx * oax + dy * oay + dz * oaz
							var qh := qb * qb - (oax * oax + oay * oay + oaz * oaz - cr * cr)
							if qh < 0.0:
								continue
							pt = -qb - sqrt(qh)
					else:
						# 椭球：缩放到单位球里求交
						var irx := 1.0 / prim[b + 5]
						var iry := 1.0 / prim[b + 6]
						var irz := 1.0 / prim[b + 7]
						var eox := (ox - prim[b + 2]) * irx
						var eoy := (oy - prim[b + 3]) * iry
						var eoz := (oz - prim[b + 4]) * irz
						var edx := dx * irx
						var edy := dy * iry
						var edz := dz * irz
						var eqa := edx * edx + edy * edy + edz * edz
						var eqb := eox * edx + eoy * edy + eoz * edz
						var eqh := eqb * eqb - eqa * (eox * eox + eoy * eoy + eoz * eoz - 1.0)
						if eqh < 0.0:
							continue
						pt = (-eqb - sqrt(eqh)) / eqa
					if pt > .02 and pt < best:
						best = pt
						bm = int(prim[b + 1])
						bq = b
				if best < tn + .001 and best < ty and best <= max_t:
					m = bm
					th = best
					hn = 3
					hb = bq
					break
			if ty <= tn:
				if ty > max_t:
					m = 0
					break
				if up:
					var cl := ceil_t[k]
					if cl != 0:
						m = 2 if cl == 2 else (7 if cl == 3 else 1)
						th = ty
						hn = 0
						break
					ty = 1e9               # 无顶：开阔水体
					open_sky = true
				else:
					var fl := floor_t[k]
					th = ty
					hn = 0
					if fl == 0 or fl == 4:
						m = -1             # 血海 / 黏液：吞声
					else:
						m = 4 if fl == 1 else (1 if fl == 2 else (7 if fl == 5 else 2))
					break
			if tn > max_t:
				m = 0
				break
			var ax := 1
			if tmx < tmz:
				cx += sx
				tmx += tdx
			else:
				cz += sz
				tmz += tdz
				ax = 2
			th = tn
			if cx < 0 or cz < 0 or cx >= MW or cz >= mh:
				m = -1
				break
			var k2 := cz * MW + cx
			var wm := wall_m[k2]
			if wm != 0:
				if oy + dy * tn > wall_h[k2]:
					m = -1
				else:
					m = wm
					hn = ax
					hcx = cx
					hcz = cz
				break
			if open_sky and ceil_t[k2] != 0:
				m = -1
				break
		# ---------- 结果 ----------
		if snow:
			if m == 0:
				buf[n] = 1.0
				buf[n + 3] = ox + dx * max_t
				buf[n + 5] = 1.0
				buf[n + 7] = oy + dy * max_t
				buf[n + 10] = 1.0
				buf[n + 11] = oz + dz * max_t
				buf[n + 12] = jr * snow_b
				buf[n + 13] = jg * snow_b
				buf[n + 14] = jb * snow_b
				buf[n + 15] = 1.0
				buf[n + 16] = t0 + max_t / sp
				buf[n + 17] = (jlife * (.45 + rg.randf() * .55)) if flood else (.9 + rg.randf() * .9)
				buf[n + 18] = .055 if flood else .03
				n += PF
			continue
		if te <= (rmax if m == 0 else th):
			continue        # 被怪物挡住：这条射线到此为止（身后留下声影），轮廓由主线程从模型取点
		if m <= 0:
			continue
		if rim_l > 0.0 and th < rim_l + .3:
			continue        # 墙在它前面，或者它就贴着墙：没有声影可描
		# ---------- 回波点：按材质决定形态 ----------
		var et := th
		var birth := t0 + et / sp
		var ring := fmod(et, 4.0) < 0.3                      # 每 4 米一道距离环
		var ct := (3.0 if ring else 1.0) * (1.0 - 0.3 * et / rmax)
		if rim_l > 0.0:
			ct = 2.6        # 声影的亮边：先看见它挡住了什么，再看见它
		var c0 := jr * ct
		var c1 := jg * ct
		var c2 := jb * ct
		if player:
			# 深度色阶：回波延迟 → 颜色
			var di := 0
			while di < 4 and et > dsc[(di + 1) * 4]:
				di += 1
			var da := di * 4
			var dk := clampf((et - dsc[da]) / (dsc[da + 4] - dsc[da]), 0.0, 1.0)
			c0 = lerpf(dsc[da + 1], dsc[da + 5], dk) * ct
			c1 = lerpf(dsc[da + 2], dsc[da + 6], dk) * ct
			c2 = lerpf(dsc[da + 3], dsc[da + 7], dk) * ct
		et -= 0.05
		var q2 := 3 if ring else 1
		while q2 > 0:
			q2 -= 1
			var jt := 0.16 if q2 > 0 else 0.0
			var x := ox + dx * et + (rg.randf() - .5) * jt
			var y := oy + dy * et + (rg.randf() - .5) * jt
			var z := oz + dz * et + (rg.randf() - .5) * jt
			var pl := jlife
			var pr := c0
			var pg := c1
			var pb := c2
			var ps := .04
			var pw := 0.0          # ≥1 表示这个点跟着心跳鼓动，小数部分是相位延迟
			var gx := 0.0          # 鼓动时的位移（沿表面法线）
			var gy := 0.0
			var gz := 0.0
			if m == 1:
				# 遗迹：点阵对齐 + 接缝 + 字符浮雕
				pl = jlife * 1.25
				if hn == 0:
					x = roundf(x * 10.0) * 0.1
					z = roundf(z * 10.0) * 0.1
					if fposmod(x, 1.5) < .1 or fposmod(z, 1.5) < .1:
						continue
					pr = c0 * .8
					pg = c1 * .8
					pb = c2 * .8
					ps = .036
				elif hn != 3:
					var u := roundf((z if hn == 1 else x) * 10.0) * 0.1
					y = roundf(y * 10.0) * 0.1
					if fposmod(u, 1.5) < .09 or fposmod(y, 1.2) < .07:
						continue
					var rl := 0.0
					if y > 1.25 and y < 2.35:
						var hv := sin(floorf(u / .25) * 1.7 * 127.1 + (floorf(y / .25) * 2.3 + floorf(u / 1.5)) * 311.7) * 43758.5453
						if hv - floorf(hv) > .62:
							rl = 1.0
					if hn == 1:
						z = u
						x -= signf(dx) * rl * .12
					else:
						x = u
						z -= signf(dz) * rl * .12
					var kk := .7 + rl * .7
					pr = c0 * kk
					pg = c1 * kk
					pb = c2 * kk
					ps = .036
			elif m == 7:
				pl = jlife * 1.25
				ps = .042
			elif m == 2:
				# 有机：吸音模糊
				x += (rg.randf() - .5) * .24
				y += (rg.randf() - .5) * .24
				z += (rg.randf() - .5) * .24
				pl = jlife * .5
				pr = c0 * .35
				pg = c1 * .42
				pb = c2 * .35
				ps = .11
			elif m == 3:
				# 水晶：发亮；被大声激发时记录下来，主线程据此触发共鸣
				pr = .45 * ct + c0 * .6
				pg = .45 * ct + c1 * .6
				pb = .45 * ct + c2 * .6
				ps = .065
				if loud and hn != 3:
					cn += 1
					ckx = hcx
					ckz = hcz
					ckt = et
			elif m == 4:
				# 岩与沙：暗、粗糙；海床贴着起伏的地形
				if y < .12:
					y = .22 * (sin(x * .55 + 1.3) * cos(z * .47) + 1.0) + .05 * (sin(x * 1.9 + z * 1.3) + 1.0) + .02
				else:
					var bp := .45 * (.5 + .5 * sin(x * 2.3 + y * 1.7) * sin(z * 2.1 + y * 1.3))
					x -= dx * bp
					y -= dy * bp
					z -= dz * bp
				pl = jlife * .85
				pr = c0 * .6
				pg = c1 * .62
				pb = c2 * .8
				ps = .075 if ring else .055
			elif m == 5:
				# 骨：苍白、硬，回波清晰
				pl = jlife * 1.15
				ps = .046
				var bk := 1.0
				if hn == 3 and prim[hb] == 4.0 and prim[hb + 9] >= 50.0:
					# 颅骨：按脸的朝向挖出眼窝、鼻孔和牙缝——不出点的地方就是黑洞
					bk = 1.2
					var syw := prim[hb + 9] - 100.0
					var kx := (x - prim[hb + 2]) / prim[hb + 5]
					var ky := (y - prim[hb + 3]) / prim[hb + 6]
					var kz := (z - prim[hb + 4]) / prim[hb + 7]
					var kl := 1.0 / (sqrt(kx * kx + ky * ky + kz * kz) + 1e-6)
					kx *= kl
					ky *= kl
					kz *= kl
					var kf0 := kx * cos(syw) + kz * sin(syw)
					var ksd := kz * cos(syw) - kx * sin(syw)
					var kf := kf0 * .978 + ky * .208             # 脸仰起约 12°
					var ku := ky * .978 - kf0 * .208
					var eye := kf * .86 + ku * .237 + absf(ksd) * .452
					if eye > .972 or kf * .975 - ku * .22 > .987:
						continue
					if eye > .94:
						bk = 1.7                                  # 眶缘更亮，洞才读得出来
					elif ku > -.7 and ku < -.44 and kf > .1:
						if fposmod(atan2(ksd, kf) * 7.0, 1.0) < .32:
							continue
						bk = 1.4
				pr = (.5 * ct + c0 * .18) * bk
				pg = (.42 * ct + c1 * .18) * bk
				pb = (.25 * ct + c2 * .16) * bk
			elif m == 8:
				# 脏器：湿软，表面爬着血管；整体跟着心跳鼓动（位移方向和相位交给点云着色器）
				x += (rg.randf() - .5) * .05
				y += (rg.randf() - .5) * .05
				z += (rg.randf() - .5) * .05
				pl = jlife * .8
				ps = .075
				pw = 1.0
				var vk := .8
				if hn == 3 and prim[hb] == 4.0:
					var enx := (x - prim[hb + 2]) / prim[hb + 5]
					var eny := (y - prim[hb + 3]) / prim[hb + 6]
					var enz := (z - prim[hb + 4]) / prim[hb + 7]
					if absf(sin(enx * 9.0 + sin(eny * 7.0) * 1.6) * sin(enz * 8.0 + eny * 3.0)) < .2:
						vk = 2.1
						ps = .05
					enx /= prim[hb + 5]
					eny /= prim[hb + 6]
					enz /= prim[hb + 7]
					var ea := minf(prim[hb + 5], 1.0) * .085 / (sqrt(enx * enx + eny * eny + enz * enz) + 1e-6)
					gx = enx * ea
					gy = eny * ea
					gz = enz * ea
					pw = 1.0 + fposmod(prim[hb + 9], 1.0)
				pr = (.48 * ct + c0 * .2) * vk
				pg = (.18 * ct + c1 * .2) * vk
				pb = (.13 * ct + c2 * .2) * vk
			else:
				# 脉管：细、软，亮度沿着管子一节一节地传
				pw = 1.0 + fposmod(y * .11 + (x + z) * .05, 1.0)
				if hn == 3 and prim[hb] == 3.0:
					var wax := prim[hb + 5] - prim[hb + 2]
					var way := prim[hb + 6] - prim[hb + 3]
					var waz := prim[hb + 7] - prim[hb + 4]
					var wt := clampf(((x - prim[hb + 2]) * wax + (y - prim[hb + 3]) * way + (z - prim[hb + 4]) * waz) / (wax * wax + way * way + waz * waz), 0.0, 1.0)
					gx = x - prim[hb + 2] - wax * wt
					gy = y - prim[hb + 3] - way * wt
					gz = z - prim[hb + 4] - waz * wt
					var wl := .03 / (sqrt(gx * gx + gy * gy + gz * gz) + 1e-6)
					gx *= wl
					gy *= wl
					gz *= wl
				x += (rg.randf() - .5) * .04
				z += (rg.randf() - .5) * .04
				pl = jlife * .75
				pr = .3 * ct + c0 * .25
				pg = .12 * ct + c1 * .25
				pb = .1 * ct + c2 * .25
				ps = .06
			if pw > 0.0:
				buf[n] = gx        # 变换矩阵的第一列没人用，借来放位移向量
				buf[n + 4] = gy
				buf[n + 8] = gz
			else:
				buf[n] = 1.0
			buf[n + 3] = x
			buf[n + 5] = 1.0
			buf[n + 7] = y
			buf[n + 10] = 1.0
			buf[n + 11] = z
			buf[n + 12] = pr
			buf[n + 13] = pg
			buf[n + 14] = pb
			buf[n + 15] = 1.0
			buf[n + 16] = birth
			buf[n + 17] = pl
			buf[n + 18] = ps
			buf[n + 19] = pw
			n += PF
	buf.resize(n)
	J.results[c] = [buf, cn, ckx, ckz, ckt]
