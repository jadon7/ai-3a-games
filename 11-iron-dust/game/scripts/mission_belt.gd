extends "res://scripts/mission.gd"
# FLASH IN THE BELT: a zero-g fleet action in three phases.
#   1 护卫  enemy frame squads leave the asteroid belt in three waves and go for the
#           friendly cruiser 白桦号; hold until the waves are beaten.
#   2 推进  the cruiser gets under way along the lane through the belt; ambush squads and
#           gun platforms bolted to the rocks hit it on the way.
#   3 击沉  the cruiser duels the enemy battleship 獠牙号 at the anchorage and slowly loses;
#           strip the battleship's turrets, then kill its bridge and engines.
# Fails when the cruiser is destroyed, or (before the duel) loses its bridge or all engines.

const Warship = preload("res://scripts/warship.gd")
const Part = preload("res://scripts/warship_part.gd")
const SpaceEnv = preload("res://scripts/space_env.gd")

const C_SHIP := Color(0.62, 0.86, 1.0)
const C_AMBER := Color(1.0, 0.72, 0.25)
const C_RED := Color(1.0, 0.3, 0.2)
const SHIP_KINDS := ["turret", "pd", "engine", "bridge"]
const CRUISER_FRAME_DMG := 0.35
const MAX_RAIDERS := 6
# [frame id, loadout overrides]
const WAVE_DEFS := [
	[["hound"], ["hound"], ["hound", {"L": "s_spike"}], ["ripper"]],
	[["hound"], ["hound", {"R1": "e_crl"}], ["mauler"], ["ripper"], ["reaver"]],
	[["hound"], ["hound", {"L": "s_spike"}], ["hound", {"R1": "e_lance"}], ["mauler"], ["brute"], ["ripper"]],
]
const AMBUSH_DEFS := [
	[["hound"], ["hound", {"L": "s_spike"}], ["ripper"]],
	[["mauler"], ["hound"], ["hound"], ["ripper"]],
	[["hound", {"R1": "e_lance"}], ["brute"], ["ripper"], ["reaver"]],
	[["hound"], ["hound", {"R1": "e_crl"}], ["mauler"]],
]
const AMBUSH_Z := [-140.0, -540.0, -940.0, -1260.0]
const GUARD_DEF := [["hound"], ["hound", {"L": "s_spike"}], ["mauler"], ["reaver"]]
const ACE_DEFS := [["reaver_ace"], ["brute_ace"]]
const ACE_NAMES := ["紫棘 1", "紫棘 2"]
const REINF_DEFS := [[["hound"], ["ripper"]], [["mauler"], ["hound", {"R1": "e_crl"}]], [["hound", {"L": "s_spike"}], ["ripper"]]]

var pts: Dictionary = {}
var ship = null             # friendly cruiser 白桦号
# `boss` (declared in mission.gd) is the enemy battleship 獠牙号
var escort = null           # enemy frigate
var allies: Array = []
var raiders: Array = []     # every enemy frame this mission spawned
var platforms: Array = []
var lane: Array = []
var lane_i := 0
var lane_len := 1.0
var wave_n := 0
var wave_t := 8.0
var wave_age := 0.0
var ambush_done := [false, false, false, false]
var phase_t := 0.0
var reinf_t := 50.0
var reinf_n := 0
var parts_killed := 0
var win_t := -1.0
var aces: Array = []        # the battleship's ace pair
var ace_out := false
var ace_kills := 0


func _init(g) -> void:
	super(g)
	title = "FLASH IN THE BELT"
	time_limit = 900.0


# mission points: the map's own, with space_env's constants behind them
func _points() -> Dictionary:
	var d: Dictionary = SpaceEnv.default_points()
	var w = game.world
	if w != null and w.get("points") is Dictionary:
		var wp: Dictionary = w.points
		for k in wp:
			d[k] = wp[k]
	if d.get("spawn3") is Vector3:
		d["spawn"] = d["spawn3"]
	elif not (d.get("spawn") is Vector3):
		d["spawn"] = SpaceEnv.SPAWN
	if (d.get("platforms", []) as Array).is_empty():
		# no rock data: float the platforms beside the lane instead
		var ps: Array = []
		var ups: Array = []
		for p in SpaceEnv.PLATFORM_ROCKS:
			ps.append(p)
			ups.append(Vector3.UP)
		d["platforms"] = ps
		d["platform_up"] = ups
	return d


func player_spawn() -> Array:
	var d := _points()
	return [d["spawn"], 0.0]


func start() -> void:
	time_left = time_limit
	pts = _points()
	lane = pts["lane"]
	lane_len = 0.0
	for i in lane.size() - 1:
		lane_len += (lane[i] as Vector3).distance_to(lane[i + 1])
	lane_len = maxf(lane_len, 1.0)
	var p = game.player
	# wingmen
	var defs := [["kestrel", Vector3(-30, 6, 24), "砂砾 2", {}], ["bastion", Vector3(32, -6, 28), "砂砾 3", {"R1": "gat35", "L": "s_tower"}]]
	for d in defs:
		var off: Vector3 = d[1]
		var wm = game.spawn_mech(d[0], 0, p.global_position + off, 0.0, true, d[3])
		if wm == null:
			continue
		wm.callsign = d[2]
		wm.dmg_mul = 0.4
		wm.ap_max *= 1.5
		wm.ap = wm.ap_max
		if wm.ai != null:
			wm.ai.follow = p
			wm.ai.follow_off = off
			wm.ai.sense = 520.0
		allies.append(wm)
	if not allies.is_empty():
		wingman = allies[0]
	# the fleets: extras are ticked and freed by main
	ship = Warship.new()
	game.add_extra(ship)
	# frame weapons do reduced damage to the cruiser: a dozen raiders would otherwise strip it in a minute
	ship.setup(game, 0, pts["ally_ship"], 0.0, {"cls": "cruiser", "frame_dmg": CRUISER_FRAME_DMG})
	var es: Array = pts["enemy_ships"]
	boss = Warship.new()
	game.add_extra(boss)
	boss.setup(game, 1, es[0], PI, {"cls": "battleship"})
	boss.arm(false)
	boss.set_hidden(true)
	if es.size() > 1:
		escort = Warship.new()
		game.add_extra(escort)
		escort.setup(game, 1, es[1], PI * 0.9, {"cls": "frigate"})
		escort.arm(false)
		escort.set_hidden(true)
	game.hud.show_banner("MISSION START", "护卫巡洋舰「白桦号」 · 击退来袭敌机架", C_CP, 5.0)
	game.sfx.play2d("siren", 0.5)
	say(1.0, "铁砧", "砂砾小队，这里是铁砧。白桦号正在小行星带南缘整备，主机预热还需要几分钟。", C_CP)
	say(7.5, "白桦号", "这里是白桦号舰长。雷达上全是石头的回波，但有东西在动——敌机架，从带内出来了！", C_SHIP)
	say(14.0, "铁砧", "它们的目标是白桦号的舰桥和引擎。点防御炮只能牵制，靠你们把敌机挡在外面。", C_CP)
	say(21.0, "砂砾 2", "砂砾 2 就位。没有上下之分的战场……别被石头撞上。", C_WING)
	say(28.0, "砂砾 3", "砂砾 3 就位。SHIFT 上升、CTRL 下降、空格推进，贴着舰体打，借它的炮火。", C_WING)


# ------------------------------------------------------------------ helpers
func _alive(list: Array) -> int:
	var n := 0
	for u in list:
		if is_instance_valid(u) and u.alive:
			n += 1
	return n


func _spawn_squad(list: Array, origin: Vector3, toward: Vector3, hunters: bool) -> Array:
	var out: Array = []
	var i := 0
	for e in list:
		var row := i / 3
		var pos := origin + Vector3(float(i % 3 - 1) * 36.0, float(row % 2) * 28.0 - 12.0 + randf_range(-6.0, 6.0), float(row) * 34.0 + randf_range(-8.0, 8.0))
		var dd := toward - pos
		var lo: Dictionary = e[1] if e.size() > 1 else {}
		var u = game.spawn_mech(e[0], 1, pos, atan2(-dd.x, -dd.z), true, lo)
		i += 1
		if u == null:
			continue
		u.alert_t = 9999.0
		if u.ai != null:
			u.ai.sense = 3000.0
			# every other frame ignores the escorts and goes for the bridge / engines
			if hunters and i % 2 == 0:
				u.ai.hunt_objectives = true
		out.append(u)
		raiders.append(u)
	return out


func _progress() -> float:
	if lane.size() < 2 or ship == null:
		return 0.0
	var left: float = (ship.center() as Vector3).distance_to(lane[mini(lane_i, lane.size() - 1)])
	for i in range(lane_i, lane.size() - 1):
		left += (lane[i] as Vector3).distance_to(lane[i + 1])
	return clampf(1.0 - left / lane_len, 0.0, 1.0)


func _state(n: int, total: int) -> String:
	return "%d / %d" % [total - n, total]


# ------------------------------------------------------------------ HUD / result
func objective_lines() -> Array:
	var out: Array = []
	if ship != null:
		out.append(["护卫巡洋舰「白桦号」  舰体 %d%%" % int(ceil(ship.hull_ratio() * 100.0)), false])
	if phase == 1:
		out.append(["击退敌机架  第 %d / %d 波  残敌 %d" % [wave_n, WAVE_DEFS.size(), _alive(raiders)], false])
	elif phase == 2:
		out.append(["护送白桦号穿越小行星带  %d%%" % int(_progress() * 100.0), false])
		if not platforms.is_empty():
			out.append(["沿途浮游炮台  %s 已摧毁" % _state(_alive(platforms), platforms.size()), _alive(platforms) == 0])
	elif phase >= 3 and boss != null:
		out.append(["击沉战列舰「獠牙号」  舰体 %d%%" % int(ceil(boss.hull_ratio() * 100.0)), not boss.alive])
		out.append(["  舰桥 %s" % ("已摧毁" if boss.parts_alive("bridge") == 0 else "健在"), boss.parts_alive("bridge") == 0])
		out.append(["  引擎 %s 已摧毁" % _state(boss.parts_alive("engine"), boss.parts_total("engine")), boss.parts_alive("engine") == 0])
		out.append(["  主炮 %s 已摧毁" % _state(boss.parts_alive("turret"), boss.parts_total("turret")), boss.parts_alive("turret") == 0])
		if ace_out:
			out.append(["敌王牌机「紫棘」  %s 击坠" % _state(_alive(aces), aces.size()), _alive(aces) == 0])
	return out


func result_rows() -> Array:
	var rows: Array = []
	if ship != null:
		rows.append(["白桦号舰体", "%d%%" % int(ceil(ship.hull_ratio() * 100.0))])
		rows.append(["白桦号主炮存活", "%d / %d" % [ship.parts_alive("turret"), ship.parts_total("turret")]])
	rows.append(["击毁舰船部件", str(parts_killed)])
	if ace_out:
		rows.append(["击坠王牌机", "%d / %d" % [ace_kills, aces.size()]])
	return rows


func score_bonus() -> float:
	if ship == null:
		return 0.0
	return (ship.hull_ratio() - 0.5) * 20.0 + minf(float(parts_killed), 12.0) * 0.5 + 4.0 + float(ace_kills) * 1.5


# ------------------------------------------------------------------ flow
func _update(dt: float) -> void:
	phase_t += dt
	if ship == null or not is_instance_valid(ship):
		return
	if not ship.alive:
		_end(false, "巡洋舰「白桦号」被击沉")
		return
	var hr: float = ship.hull_ratio()
	if hr < 0.6 and once("h60"):
		game.hud.radio("白桦号", "舰体受损四成！砂砾小队，把贴上来的敌机清掉！", C_SHIP)
	if hr < 0.3 and once("h30"):
		game.hud.radio("白桦号", "损管跟不上了，舰体只剩三成——再挨下去就要解体！", C_SHIP)
		game.sfx.play2d("alarm", 0.6)
	if ship.parts_alive("turret") < ship.parts_total("turret") and once("st1"):
		game.hud.radio("白桦号", "一座主炮被打哑了，火力下降。", C_SHIP)
	if phase < 3:
		if ship.disabled:
			_end(false, "白桦号舰桥被毁 · 丧失指挥")
			return
		if ship.parts_alive("engine") == 0:
			_end(false, "白桦号引擎全毁 · 无法航行")
			return
		if ship.parts_alive("engine") < ship.parts_total("engine") and once("se1"):
			game.hud.radio("白桦号", "一台引擎熄火！别让它们绕到舰尾！", C_SHIP)
	if phase == 1:
		_update_defend(dt)
	elif phase == 2:
		_update_escort(dt)
	else:
		_update_sink(dt)


func _update_defend(dt: float) -> void:
	var left := _alive(raiders)
	wave_age += dt
	if wave_n < WAVE_DEFS.size():
		wave_t -= dt
		if wave_t <= 0.0 or (wave_n > 0 and left <= 1 and wave_age > 12.0):
			_wave()
	elif left == 0 or wave_age > 110.0:
		if left == 0 and once("p1clear"):
			game.hud.radio("砂砾 2", "最后一架也掉了。周围干净了。", C_WING)
		_phase2()


func _wave() -> void:
	var def: Array = WAVE_DEFS[wave_n]
	var gates: Array = pts["waves"]
	var origin: Vector3 = gates[wave_n % gates.size()]
	wave_n += 1
	wave_t = 70.0
	wave_age = 0.0
	# the last wave splits and comes from two sides
	if wave_n == WAVE_DEFS.size() and gates.size() > 1:
		var half := def.size() / 2
		_spawn_squad(def.slice(0, half), origin, ship.center(), true)
		_spawn_squad(def.slice(half), gates[(wave_n + 1) % gates.size()], ship.center(), true)
	else:
		_spawn_squad(def, origin, ship.center(), true)
	game.sfx.play2d("alarm", 0.5)
	if wave_n == 1:
		game.hud.note("敌机架接近  第 1 波", C_AMBER, 3.0)
		game.hud.radio("铁砧", "第一波，四架，正面出带。猎犬三、裂爪一。", C_CP)
	elif wave_n == 2:
		game.hud.note("敌机架接近  第 2 波", C_AMBER, 3.0)
		game.hud.radio("白桦号", "右舷又有热源！这一波带着重锤，注意它的火箭筒和导弹。", C_SHIP)
	else:
		game.hud.note("敌机架接近  第 3 波", C_AMBER, 3.0)
		game.hud.radio("铁砧", "第三波分两路包抄。撑过这一波，白桦号的主机就热好了。", C_CP)


func _phase2() -> void:
	phase = 2
	phase_t = 0.0
	game.hud.show_banner("MISSION UPDATE", "护送白桦号穿越小行星带", C_AMBER, 5.0)
	game.hud.radio("白桦号", "主机预热完毕，白桦号起航。航道很窄，全舰保持航向——护卫就拜托了。", C_SHIP)
	say(6.0, "铁砧", "带内的石头后面藏着浮游炮台和伏击小队。炮台射程六百，先手敲掉；蓝色航标就是航道。", C_CP)
	say(13.0, "砂砾 3", "石头能挡子弹，也能挡我们的。别离白桦号太远。", C_WING)
	lane_i = mini(1, lane.size() - 1)
	ship.move_to(lane[lane_i])
	var ps: Array = pts["platforms"]
	var ups: Array = pts.get("platform_up", [])
	for i in ps.size():
		var pf = Part.new()
		game.add_unit(pf)
		pf.setup_platform(game, 1, ps[i], ups[i] if i < ups.size() else Vector3.UP, i + 1)
		platforms.append(pf)
	game._rebuild_rids()


func _update_escort(_dt: float) -> void:
	var c: Vector3 = ship.center()
	var last := lane.size() - 1
	if lane_i < last and c.distance_to(lane[lane_i]) < 110.0:
		lane_i += 1
		ship.move_to(lane[lane_i])
	elif not ship.moving and not ship.arrived:
		ship.move_to(lane[lane_i])
	for i in AMBUSH_Z.size():
		if not ambush_done[i] and c.z < float(AMBUSH_Z[i]):
			ambush_done[i] = true
			if _alive(raiders) < MAX_RAIDERS:
				var spots: Array = pts["ambush"]
				_spawn_squad(AMBUSH_DEFS[i], spots[i % spots.size()], c, true)
				game.sfx.play2d("alarm", 0.5)
				if i == 0:
					game.hud.radio("砂砾 2", "石头后面有动静——伏击！左舷！", C_WING)
				elif i == 1:
					game.hud.radio("白桦号", "右舷下方又一队！点防御炮自由射击！", C_SHIP)
				elif i == 2:
					game.hud.radio("铁砧", "带内第三队伏兵。过了这一段就是出口。", C_CP)
				else:
					game.hud.radio("砂砾 3", "出口还有人守着。清掉它们，前面就是船坞。", C_WING)
	if _progress() > 0.45 and once("half"):
		game.hud.radio("白桦号", "航程过半。前方那个大家伙是旧环形船坞……敌舰就停在它旁边。", C_SHIP)
	if (ship.arrived and lane_i >= last) or c.distance_to(lane[last]) < 90.0:
		_phase3()


func _phase3() -> void:
	phase = 3
	phase_t = 0.0
	ship.hold()
	boss.set_hidden(false)
	boss.arm(true)
	if escort != null:
		escort.set_hidden(false)
		escort.arm(true)
	game.hud.show_banner("WARNING", "敌战列舰「獠牙号」 · 摧毁舰桥与引擎", C_RED, 6.0)
	game.sfx.play2d("alarm", 0.7)
	game.hud.radio("白桦号", "出带了！正前方，战列舰一艘、护卫舰一艘——全主炮，开火！", C_SHIP)
	say(6.0, "铁砧", "单凭白桦号打不过那艘战列舰。舰体装甲打不穿，瞄准部件：主炮、点防御、引擎、舰桥各自独立。", C_CP)
	say(13.0, "铁砧", "先拆它的主炮给白桦号减压，再毁掉舰桥和全部引擎，它就完了。两侧的熔切炮只打战舰，不用管。", C_CP)
	say(20.0, "砂砾 2", "船坞的桁架能挡它的点防御炮。贴着骨架进去！", C_WING)
	_spawn_squad(GUARD_DEF if _alive(raiders) < 3 else GUARD_DEF.slice(0, 2), boss.center() + Vector3(-150, 70, 230), ship.center(), false)
	reinf_t = 50.0


# the battleship's own pair, in pale pink-violet over white: a sabre duellist and its heavy
func _spawn_aces() -> void:
	ace_out = true
	var sq := _spawn_squad(ACE_DEFS, boss.center() + Vector3(0, 90, 260), game.player.global_position, false)
	for i in sq.size():
		var u = sq[i]
		u.callsign = ACE_NAMES[i % ACE_NAMES.size()]
		u.dmg_mul = 1.3
		aces.append(u)
	game.hud.show_banner("WARNING", "敌王牌机 ×2 · 粉紫涂装的掠袭者与蛮牛", C_RED, 5.0)
	game.sfx.play2d("alarm", 0.7)
	game.hud.radio("铁砧", "獠牙号放出了两架涂装不同的机架——粉紫色，是它的王牌搭档。掠袭者贴身，蛮牛在后面架炮。", C_CP)
	say(6.0, "砂砾 2", "那个颜色……是「紫棘」。别让掠袭者近身，先集中打掉一架。", C_WING)


func _update_sink(dt: float) -> void:
	if not boss.alive:
		# hold the clock while the battleship breaks up
		time_left += dt
		if win_t < 0.0:
			win_t = t
			game.hud.show_banner("TARGET DESTROYED", "战列舰「獠牙号」正在解体", C_CP, 6.0)
			game.hud.radio("白桦号", "命中弹药库！它断成两截了——全员，远离爆炸！", C_SHIP)
			if escort != null and escort.alive:
				escort.destroy(null)
			for u in raiders:
				if is_instance_valid(u) and u.alive:
					u.take_damage(99999.0, 0.0, null, "test", u.center())
		elif t > win_t + 9.0:
			_end(true, "")
		return
	if not ace_out and phase_t > 28.0:
		_spawn_aces()
	reinf_t -= dt
	if reinf_t <= 0.0 and reinf_n < REINF_DEFS.size() and _alive(raiders) < 4:
		_spawn_squad(REINF_DEFS[reinf_n], boss.center() + Vector3(140.0 if reinf_n % 2 == 0 else -140.0, -60, 200), game.player.global_position, false)
		reinf_n += 1
		reinf_t = 45.0
		if once("reinf"):
			game.hud.radio("铁砧", "獠牙号在放出舰载机架。别被缠住，目标是战舰。", C_CP)
	var nt: int = boss.parts_alive("turret")
	var tt: int = boss.parts_total("turret")
	if nt < tt and once("bt1"):
		game.hud.radio("砂砾 2", "一座主炮炸了！就这样，一座一座拆。", C_WING)
	if nt <= tt / 2 and once("bt2"):
		game.hud.radio("白桦号", "敌舰火力减半，我舰压力小多了。继续！", C_SHIP)
	if nt == 0 and once("bt3"):
		game.hud.radio("铁砧", "獠牙号主炮全灭。剩下的是舰桥和引擎。", C_CP)
	if boss.disabled and once("bb"):
		game.hud.radio("铁砧", "舰桥击毁，敌舰全武器停火！把引擎也打掉，送它上路。", C_CP)
	var ne: int = boss.parts_alive("engine")
	if ne < boss.parts_total("engine") and ne > 0 and once("be1"):
		game.hud.radio("砂砾 3", "一台引擎熄火。舰尾的点防御少，从后面进。", C_WING)
	if ne == 0 and not boss.disabled and once("be0"):
		game.hud.radio("铁砧", "引擎全灭，它动不了了。最后是舰桥——背上那个带尖刺的圆顶。", C_CP)
	if boss.hull_ratio() < 0.3 and once("bh"):
		game.hud.radio("白桦号", "敌舰舰体出现大面积诱爆，再加把劲！", C_SHIP)
	if escort != null and not escort.alive and once("esc"):
		game.hud.radio("砂砾 2", "护卫舰沉了。", C_WING)
	if phase_t > 150.0 and ship.hull_ratio() > 0.0 and ship.parts_alive("turret") == 0 and once("alone"):
		game.hud.radio("白桦号", "我舰主炮全灭，只能挨打了……砂砾小队，全靠你们。", C_SHIP)


func on_kill(u, by) -> void:
	if aces.has(u) and win_t < 0.0:
		ace_kills += 1
		if _alive(aces) > 0:
			game.hud.radio("砂砾 3", "一架「紫棘」击坠！还剩一架。", C_WING)
		else:
			game.hud.radio("铁砧", "两架王牌都掉了。獠牙号没有护卫了，放手去拆。", C_CP)
	if u.kind == "platform":
		if once("plat"):
			game.hud.radio("砂砾 3", "浮游炮台击毁。石头上还有，留神。", C_WING)
		if by == game.player:
			parts_killed += 1
	elif SHIP_KINDS.has(u.kind):
		if u.team != 0 and by == game.player:
			parts_killed += 1
			if once("part1"):
				game.hud.radio("铁砧", "部件击毁确认。舰体血量也跟着掉——每拆一处都算数。", C_CP)
	elif by == game.player and u.kind == "mech" and u.team != 0 and once("firstkill"):
		game.hud.radio("砂砾 2", "确认击坠。漂亮。", C_WING)


func _end(win: bool, reason: String) -> void:
	over = true
	won = win
	fail_reason = reason
	if win:
		game.hud.show_banner("MISSION ACCOMPLISHED", "敌战列舰击沉 · 小行星带航道打通", C_CP, 7.0)
		game.hud.radio("铁砧", "獠牙号击沉确认。干得漂亮，砂砾小队——回白桦号，返航。", C_CP)
		end_t = t + 7.0
	else:
		game.hud.show_banner("MISSION FAILED", reason, C_RED, 5.0)
		end_t = t + 4.5
