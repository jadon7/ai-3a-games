extends "res://scripts/mission.gd"
# Operation DESCENT: hold the anti-orbit gun line against an orbital landing.
# Phase 1 air assault (fighters + VTOL transports), phase 2 orbital drop pods while the
# guns charge, phase 3 bring down the landing ship by destroying its descent engines.

const Carrier = preload("res://scripts/carrier.gd")

const C_SKY := Color(1.0, 0.72, 0.25)
const SALVO := 1000.0
const TRANSPORTS := 12
const MEGA_PATH := "res://scripts/megastructure.gd"

var cannons: Array = []
var aas: Array = []
var allies: Array = []
var transports: Array = []
var landed: Array = []
var pods_left: Array = []
var carrier = null
var gun_charge := 0.0
var salvo_t := 14.0
var pod_t := 4.0
var fighter_t := 40.0
var ship_pod_t := 10.0
var shot_down := 0
var crash_t := -1.0
var mega = null
var strike_t := -1.0
var strike_fx := 0.0


func _init(g) -> void:
	super(g)
	title = "OPERATION DESCENT"
	time_limit = 960.0


func start() -> void:
	var w = game.world
	time_left = time_limit
	var p = game.player
	# wingmen
	var defs := [["kestrel", Vector3(-26, 0, 18), "砂砾 2", {}], ["bastion", Vector3(28, 0, 22), "砂砾 3", {"R1": "gat35", "L": "s_tower"}]]
	for d in defs:
		var off: Vector3 = d[1]
		var pos: Vector3 = p.global_position + off
		var wm = game.spawn_mech(d[0], 0, Vector3(pos.x, w.height(pos.x, pos.z) + 0.5, pos.z), 0.0, true, d[3])
		wm.callsign = d[2]
		wm.dmg_mul = 0.4
		wm.ap_max *= 1.5
		wm.ap = wm.ap_max
		wm.ai.follow = p
		wm.ai.follow_off = off
		wm.ai.sense = 460.0
		allies.append(wm)
	wingman = allies[0]
	# the gun line
	var ci := 0
	for cp in w.points["cannons"]:
		ci += 1
		var c = game.spawn_emplacement("cannon", 0, Vector3(cp.x, w.height(cp.x, cp.y) + 0.9, cp.y), 0.0)
		c.callsign = "AO-%d" % ci
		c.unit_name = "对轨炮 AO-%d" % ci
		c.aim_at(Vector3(cp.x * 0.3, 900.0, -1500.0))
		cannons.append(c)
		# garrison frame and tank at each gun
		var gx: float = cp.x + (34.0 if ci % 2 == 0 else -34.0)
		var gz: float = cp.y - 110.0
		var gm = game.spawn_mech("kestrel" if ci != 2 else "bastion", 0, Vector3(gx, w.height(gx, gz) + 0.5, gz), 0.0, true, {"R2": "", "S2": ""})
		gm.callsign = "守备 %d" % ci
		gm.dmg_mul = 0.3
		gm.ai.sense = 520.0
		allies.append(gm)
		for s in [-1.0, 1.0]:
			var tx: float = cp.x + s * 70.0
			var tz: float = cp.y - 130.0
			var tk = game.spawn_vehicle("tank", 0, Vector3(tx, w.height(tx, tz) + 1.0, tz), 0.0)
			tk.callsign = "装甲"
			tk.dmg_mul = 0.5
	for ap in w.points["aa"]:
		var a = game.spawn_emplacement("aa", 0, Vector3(ap.x, w.height(ap.x, ap.y) + 0.8, ap.y), 0.0)
		a.callsign = "高炮"
		aas.append(a)
	# the megastructure in the ruined town; an orbital strike brings it down in phase 2
	if ResourceLoader.exists(MEGA_PATH):
		var ms = load(MEGA_PATH)
		if ms != null and ms.can_instantiate():
			mega = ms.new()
			game.add_extra(mega)
			mega.setup(game, Vector3(-560.0, w.height(-560.0, -760.0), -760.0))
	game.hud.show_banner("MISSION START", "守住对轨炮阵地 · 击落敌空降部队", C_CP, 5.0)
	game.sfx.play2d("siren", 0.5)
	say(1.0, "铁砧", "全体注意，轨道上的敌登陆舰队开始降下。对轨炮阵地是他们的第一目标。", C_CP)
	say(8.0, "铁砧", "先遣是攻击机和运输机。运输机悬停投放时最脆弱，在它卸货前打下来！", C_CP)
	say(16.0, "砂砾 2", "北面天上全是火线……砂砾 2 就位。", C_WING)
	say(24.0, "砂砾 3", "砂砾 3 就位。按住 SHIFT 可以升空，对空用导弹和蓄力炮。", C_WING)
	# wave schedule: fighters and transports
	at(6.0, func(): _fighters(4))
	at(20.0, func(): _transports([[0, [["hound"], ["hound"]]], [2, [["hound"], ["hound", {"L": "s_spike"}]]], [3, [["mauler"], ["ripper"]]]]))
	at(50.0, func(): _fighters(4))
	at(62.0, func(): _transports([[1, [["hound"], ["mauler"]]], [4, [["hound", {"L": "s_spike"}], ["hound"], ["hound"]]], [0, [["hound", {"R1": "e_crl"}], ["reaver"]]]]))
	at(96.0, func(): _fighters(5))
	at(106.0, func(): _transports([[2, [["brute"], ["hound", {"R1": "e_lance"}]]], [3, [["hound"], ["hound"], ["hound", {"L": "s_spike"}]]], [1, [["ripper"], ["reaver"]]]]))
	at(142.0, func(): _fighters(4))
	at(152.0, func(): _transports([[4, [["hound"], ["hound", {"L": "s_spike"}], ["hound"]]], [0, [["mauler"], ["brute"]]], [2, [["hound", {"R1": "e_crl"}], ["hound"], ["hound"]]]]))


func _fighters(n: int) -> void:
	if over:
		return
	var w = game.world
	var bx := randf_range(-500.0, 500.0)
	for i in n:
		var pos := Vector3(bx + (i - n * 0.5) * 60.0, 260.0 + i * 14.0, -w.bound - 500.0 - i * 40.0)
		game.spawn_aircraft("fighter", pos, Vector3(bx * 0.4, 150.0, 0))
	if once("ftr"):
		game.hud.radio("铁砧", "攻击机群进入空域！高炮会牵制它们，别在开阔地站桩。", C_CP)
	game.sfx.play2d("jet", 0.5)


func _transports(list: Array) -> void:
	if over:
		return
	var w = game.world
	for e in list:
		var lz: Vector2 = w.points["lz"][int(e[0])]
		var pos := Vector3(lz.x * 1.6 + randf_range(-80, 80), 230.0, -w.bound - 520.0)
		var tr = game.spawn_aircraft("transport", pos, Vector3(lz.x, 0, lz.y), e[1])
		tr.on_drop = _on_landed
		transports.append(tr)
	if once("trn"):
		game.hud.radio("砂砾 2", "运输机编队，三架！肚子里装的全是机架。", C_WING)


func _on_landed(u) -> void:
	landed.append(u)
	u.ai.hunt_objectives = true
	u.dmg_mul = 1.25
	if u.def_id != "revenant":
		u.ap_max *= 1.25
		u.ap = u.ap_max


func _pod(dest: Vector3, load: Array, from_ship: bool = false) -> void:
	var start: Vector3
	if from_ship and carrier != null:
		start = carrier.bay_pos()
	else:
		start = dest + Vector3(randf_range(-260.0, 260.0), 1500.0, -randf_range(700.0, 1100.0))
	var pd = game.spawn_aircraft("pod", start, dest, load)
	pd.on_drop = _on_landed
	if from_ship:
		pd.speed = 70.0


func _pod_site() -> Vector3:
	var w = game.world
	var alive_c := []
	for c in cannons:
		if c.alive:
			alive_c.append(c)
	var base: Vector3 = game.player.global_position
	if not alive_c.is_empty() and randf() < 0.75:
		base = alive_c[randi() % alive_c.size()].global_position
	var a := randf_range(-2.4, -0.7)
	var d := randf_range(150.0, 280.0)
	var x := clampf(base.x + cos(a) * d, -w.bound + 100.0, w.bound - 100.0)
	var z := clampf(base.z + sin(a) * d, -w.bound + 100.0, 60.0)
	return Vector3(x, w.height(x, z), z)


func objective_lines() -> Array:
	var alive_c := 0
	for c in cannons:
		if c.alive:
			alive_c += 1
	var out := [["保卫对轨炮  %d / %d 存活" % [alive_c, cannons.size()], false]]
	if phase == 1:
		var done := 0
		for tr in transports:
			if not tr.alive:
				done += 1
		out.append(["迎击空降先遣  运输机 %d / %d" % [done, TRANSPORTS], false])
	if phase >= 2:
		out.append(["对轨炮充能  %d%%" % int(gun_charge * 100.0), gun_charge >= 1.0])
	if phase == 2:
		out.append(["歼灭空降舱投放的敌机架", false])
	if phase >= 3 and carrier != null:
		out.append(["摧毁登陆舰下降引擎  %d / 4" % (4 - carrier.alive_engines()), carrier.alive_engines() == 0])
		if carrier.mode == "hold":
			out.append(["登陆舰高度  %d m" % int(carrier.altitude()), false])
	return out


func result_rows() -> Array:
	var alive_c := 0
	for c in cannons:
		if c.alive:
			alive_c += 1
	return [["对轨炮存活", "%d / %d" % [alive_c, cannons.size()]], ["空中目标击落", str(shot_down)]]


func score_bonus() -> float:
	var alive_c := 0
	for c in cannons:
		if c.alive:
			alive_c += 1
	return (alive_c - 3) * 9.0 + 10.0


func _enemy_ground() -> int:
	var n := 0
	for u in game.units:
		if u.alive and u.team == 1 and u.kind == "mech":
			n += 1
	return n


# orbital bombardment rakes the megastructure from the top down, then it gives way
func _strike_mega() -> void:
	if mega == null or mega.state != "intact" or strike_t >= 0.0:
		return
	strike_t = 0.0
	game.hud.show_banner("WARNING", "轨道炮击 · 远离城区西侧的缆塔", Color(1.0, 0.3, 0.2), 5.0)
	game.sfx.play2d("alarm", 0.7)
	game.hud.radio("铁砧", "侦测到轨道炮击！他们在清理降落场——目标是城区西侧的缆塔，所有人离开那一带！", C_CP)


func _tick_strike(dt: float) -> void:
	strike_t += dt
	var top: Vector3 = mega.top()
	var base: Vector3 = mega.global_position + Vector3(0, 70.0, 0)
	if strike_t < 3.0:
		var k := clampf(strike_t / 2.6, 0.0, 1.0)
		for i in 3:
			var tp := top.lerp(base, clampf(k * (0.75 + i * 0.12), 0.0, 1.0)) + Vector3(sin(strike_t * 9.0 + i * 2.1) * 14.0, 0, cos(strike_t * 7.0 + i) * 14.0)
			var sky := tp + Vector3(700.0 + i * 160.0, 2600.0, -1500.0 - i * 120.0)
			game.fx.beam(sky, tp, 11.0 + sin(strike_t * 40.0 + i) * 3.0, Color(1.0, 0.5, 0.32), 0.0, 2.2)
			strike_fx -= dt
			if strike_fx <= 0.0:
				strike_fx = 0.07
				game.fx.explosion(tp + Vector3(randf_range(-20, 20), randf_range(-20, 20), randf_range(-20, 20)), randf_range(2.0, 3.0))
				if randf() < 0.3:
					game.sfx.play2d("explosion", 0.35, randf_range(0.5, 0.8))
		game.shake(0.1)
	if strike_t >= 1.5 and mega.state == "intact":
		mega.collapse()
		say(3.0, "砂砾 2", "那座塔……整个倒下来了！", C_WING)
	if strike_t >= 3.2:
		strike_t = -1.0


func _update(dt: float) -> void:
	if strike_t >= 0.0 and mega != null:
		_tick_strike(dt)
	var alive_c := 0
	for c in cannons:
		if c.alive:
			alive_c += 1
		c.charge = gun_charge
	if alive_c == 0:
		_end(false, "对轨炮阵地全灭")
		return
	if alive_c < cannons.size() and once("c1"):
		game.hud.radio("铁砧", "一座对轨炮被摧毁！剩下的绝不能再丢！", C_CP)
	if alive_c == 1 and once("c2"):
		game.hud.radio("铁砧", "只剩最后一座炮了，砂砾小队，回防！", C_CP)
	for c in cannons:
		if c.alive and c.ap < c.ap_max * 0.5 and once("ch" + c.callsign):
			game.hud.radio("铁砧", "%s 受损过半，敌机架正在攻击炮座！" % c.callsign, C_CP)
	if phase == 1:
		var done := 0
		for tr in transports:
			if not tr.alive:
				done += 1
		if (transports.size() >= TRANSPORTS and done >= TRANSPORTS and _enemy_ground() <= 3) or t > 255.0:
			_phase2()
	elif phase == 2:
		gun_charge = minf(1.0, gun_charge + dt / 125.0 * (0.4 + 0.2 * alive_c))
		pod_t -= dt
		if pod_t <= 0.0 and not pods_left.is_empty() and _enemy_ground() < 12:
			# pods come down in pairs on the same gun
			pod_t = randf_range(8.0, 11.0)
			var site := _pod_site()
			for q in 2:
				if not pods_left.is_empty():
					_pod(site + Vector3(randf_range(-50.0, 50.0), 0, randf_range(-50.0, 50.0)), [pods_left.pop_front()])
		fighter_t -= dt
		if fighter_t <= 0.0:
			fighter_t = 40.0
			_fighters(4)
		if gun_charge > 0.3 and once("mega"):
			_strike_mega()
		if gun_charge > 0.5 and once("half"):
			game.hud.radio("铁砧", "充能过半。登陆舰本体进入大气层了——北面，抬头。", C_CP)
		if gun_charge >= 1.0:
			_phase3()
	elif phase == 3:
		if carrier.mode == "hold":
			salvo_t -= dt
			if salvo_t <= 0.0:
				salvo_t = 16.0
				_salvo()
			ship_pod_t -= dt
			if ship_pod_t <= 0.0 and _enemy_ground() < 10:
				ship_pod_t = randf_range(9.0, 13.0)
				var cargo: Array = ["hound"]
				if not pods_left.is_empty():
					cargo = pods_left.pop_front()
				elif randf() < 0.25:
					cargo = ["mauler"]
				elif randf() < 0.4:
					cargo = ["hound", {"L": "s_spike"}]
				_pod(_pod_site(), [cargo], true)
			fighter_t -= dt
			if fighter_t <= 0.0:
				fighter_t = 45.0
				_fighters(3)
			var n: int = carrier.alive_engines()
			if n == 3 and once("e1"):
				game.hud.radio("砂砾 2", "一号引擎熄火！它在往下掉！", C_WING)
			if n == 1 and once("e3"):
				game.hud.radio("铁砧", "只剩最后一台引擎，集中火力！", C_CP)
			if carrier.altitude() < carrier.land_y + 60.0 and once("low_ship"):
				game.hud.radio("铁砧", "登陆舰快要着陆了！再不打下来就来不及了！", C_CP)
			if carrier.altitude() <= carrier.land_y:
				_end(false, "登陆舰着陆 · 阵地失守")
		elif carrier.mode == "fall" and once("falling"):
			game.hud.show_banner("TARGET DESTROYED", "登陆舰失去升力 · 正在坠落", C_CP, 6.0)
			game.hud.radio("砂砾 3", "引擎全灭！它掉下去了——所有人离开坠落区！", C_WING)
			for u in game.units:
				if u.alive and u.team == 1 and u.kind == "fighter":
					u.take_damage(99999.0, 0.0, null, "test", u.center())
		elif carrier.mode == "crashed" and crash_t < 0.0:
			crash_t = t
			game.hud.radio("铁砧", "登陆舰坠毁确认。……干得漂亮，砂砾小队。", C_CP)
		if crash_t >= 0.0 and t > crash_t + 5.0:
			_end(true, "")


func _phase2() -> void:
	phase = 2
	game.hud.show_banner("WARNING", "轨道空降舱来袭 · 守住对轨炮直到充能完毕", C_SKY, 5.5)
	game.sfx.play2d("siren", 0.5)
	game.hud.radio("铁砧", "先遣被打退了。对轨炮开始充能——侦测到大量空降舱再入轨迹！", C_CP)
	say(7.0, "铁砧", "空降舱落地前可以击毁，落地后里面的机架会直扑炮座。", C_CP)
	pods_left = [["hound"], ["hound", {"L": "s_spike"}], ["hound"], ["mauler"], ["hound", {"R1": "e_lance"}], ["hound"],
		["hound", {"L": "s_spike"}], ["mauler"], ["hound", {"R1": "e_crl"}], ["hound"], ["brute"], ["hound", {"L": "s_spike"}],
		["ripper"], ["hound", {"R1": "e_lance"}], ["mauler"], ["reaver"], ["hound", {"R1": "e_crl"}], ["hound", {"L": "s_spike"}],
		["hound"], ["revenant", {"R1": "e_crl"}]]
	pod_t = 5.0
	fighter_t = 25.0
	# the ship starts its descent now so it looms larger as the guns charge
	var hold: Vector3 = game.world.points["carrier"]
	carrier = Carrier.new()
	game.add_extra(carrier)
	carrier.setup(game, hold + Vector3(0, 1500.0, -2300.0), hold)
	carrier.sink = 1.15
	for e in carrier.engines:
		e.hidden = true


func _phase3() -> void:
	phase = 3
	game.hud.show_banner("MISSION UPDATE", "登陆舰进入射程 · 摧毁四台下降引擎", Color(1.0, 0.3, 0.2), 6.0)
	game.sfx.play2d("alarm", 0.7)
	game.hud.radio("铁砧", "充能完毕！登陆舰进入射程。它的装甲太厚，瞄准舰底四角的下降引擎！", C_CP)
	say(7.0, "铁砧", "对轨炮的齐射打不穿全部四台引擎，剩下的要靠你们。向北推进或升空，注意舰底的点防御炮。", C_CP)
	carrier.arm(true)
	for e in carrier.engines:
		e.hidden = false
	salvo_t = 9.0


# every surviving gun fires at one of the ship's engines
func _salvo() -> void:
	var targets := []
	for e in carrier.engines:
		if e.alive:
			targets.append(e)
	if targets.is_empty():
		return
	var i := 0
	for c in cannons:
		if not c.alive:
			continue
		var e = targets[randi() % targets.size()]
		var delay := 1.3 + i * 0.5
		i += 1
		c.fire_at(e.center(), delay)
		at(delay, _salvo_hit.bind(c, e))
	if once("salvo"):
		game.hud.radio("铁砧", "对轨炮，齐射！", C_CP)


func _salvo_hit(c, e) -> void:
	if e.alive and c.alive:
		c.beam_to = e.center()
		e.take_damage(SALVO, 0.0, c, "salvo", e.center())
		game.fx.explosion(e.center() + Vector3(randf_range(-8, 8), randf_range(-8, 8), randf_range(-8, 8)), 2.4)
		game.sfx.play2d("explosion", 0.5, 0.6)


func on_kill(u, by) -> void:
	if u.kind == "fighter" or u.kind == "transport" or u.kind == "pod":
		shot_down += 1
		if u.kind == "transport" and not u.delivered and once("trk"):
			game.hud.radio("砂砾 3", "运输机击落！货还没卸，一锅端。", C_WING)
		if u.kind == "pod" and once("podk"):
			game.hud.radio("砂砾 2", "空降舱凌空打爆，里面那架省事了。", C_WING)
	elif by == game.player and u.kind == "mech" and once("firstkill"):
		game.hud.radio("砂砾 2", "确认击坠。漂亮。", C_WING)


func _end(win: bool, reason: String) -> void:
	over = true
	won = win
	fail_reason = reason
	if win:
		game.hud.show_banner("MISSION ACCOMPLISHED", "登陆舰击坠 · 降下作战粉碎", C_CP, 7.0)
		end_t = t + 7.0
	else:
		game.hud.show_banner("MISSION FAILED", reason, Color(1.0, 0.3, 0.2), 5.0)
		end_t = t + 4.5
