extends RefCounted
# Operation RUST CORRIDOR: three-phase assault on the refinery base.

const World = preload("res://scripts/world.gd")

const C_CP := Color(0.66, 0.96, 0.74)
const C_WING := Color(0.45, 0.8, 1.0)
const C_FOE := Color(1.0, 0.4, 0.3)

var title := "OPERATION RUST CORRIDOR"
var time_limit := 720.0
var game
var phase := 1
var t := 0.0
var time_left := 720.0
var over := false
var won := false
var fail_reason := ""
var turrets: Array = []
var wave: Array = []
var boss = null
var wingman = null
var events: Array = []
var said := {}
var end_t := -1.0


func _init(g) -> void:
	game = g


func at(delay: float, fn: Callable) -> void:
	events.append({"t": t + delay, "fn": fn})


func say(delay: float, who: String, text: String, col: Color) -> void:
	at(delay, func(): game.hud.radio(who, text, col))


func once(key: String) -> bool:
	if said.has(key):
		return false
	said[key] = true
	return true


func player_spawn() -> Array:
	var sp: Vector2 = game.world.points["spawn"]
	return [Vector3(sp.x, game.world.height(sp.x, sp.y) + 0.5, sp.y), 0.0]


func result_rows() -> Array:
	return []


func score_bonus() -> float:
	return 0.0


func start() -> void:
	var w = game.world
	time_left = time_limit
	var wm = game.spawn_mech("kestrel", 0, Vector3(-26, w.height(-26, 578) + 0.5, 578), 0.0, true)
	wm.callsign = "砂砾 2"
	wm.dmg_mul = 0.55
	wm.ap_max *= 1.4
	wm.ap = wm.ap_max
	wm.ai.follow = game.player
	wm.ai.sense = 420.0
	wingman = wm
	for bp in World.BATTERY_POS:
		var tu = game.spawn_vehicle("turret", 1, Vector3(bp.x, w.height(bp.x, bp.y) + 0.8, bp.y), PI)
		turrets.append(tu)
	for tp in [Vector2(-38, 200), Vector2(40, 204), Vector2(-52, 104), Vector2(128, 30)]:
		game.spawn_vehicle("tank", 1, Vector3(tp.x, w.height(tp.x, tp.y) + 1.0, tp.y), PI)
	for hp in [Vector2(8, 118), Vector2(132, -60), Vector2(-80, -150)]:
		game.spawn_mech("hound", 1, Vector3(hp.x, w.height(hp.x, hp.y) + 0.5, hp.y), PI, true)
	game.hud.show_banner("MISSION START", "突入基地 · 摧毁全部榴弹炮台", C_CP, 4.5)
	say(1.0, "铁砧", "砂砾小队，这里是铁砧。目标是基地内的三座榴弹炮台。", C_CP)
	say(6.0, "铁砧", "炮台射程覆盖整条进场路线，别停下，用推进器压上去。", C_CP)
	say(12.0, "砂砾 2", "砂砾 2 就位。沙尘很大，目视距离不足六百。", C_WING)
	say(18.0, "铁砧", "敌方守备为猎犬级与坦克。重火力打出硬直后，贴上去用格斗解决。", C_CP)


func objective_lines() -> Array:
	var alive_t := 0
	for tu in turrets:
		if tu.alive:
			alive_t += 1
	var out := [["摧毁榴弹炮台  %d / %d" % [turrets.size() - alive_t, turrets.size()], phase > 1]]
	if phase >= 2:
		var n := 0
		for u in wave:
			if u.alive:
				n += 1
		out.append(["歼灭敌增援机架  %d / %d" % [wave.size() - n, wave.size()], phase > 2])
	if phase >= 3:
		out.append(["击毁王牌机「亡灵」", won])
	return out


func tick(dt: float) -> void:
	t += dt
	if not over:
		time_left -= dt
	var i := 0
	while i < events.size():
		if events[i]["t"] <= t:
			var fn: Callable = events[i]["fn"]
			events.remove_at(i)
			fn.call()
		else:
			i += 1
	if over:
		if end_t >= 0.0 and t >= end_t:
			end_t = -1.0
			game.finish_mission()
		return
	var p = game.player
	if not p.alive:
		_end(false, "机体被击毁")
		return
	if time_left <= 0.0:
		_end(false, "作战时间耗尽")
		return
	if p.ap / p.ap_max < 0.35 and once("low"):
		game.hud.radio("铁砧", "砂砾 1，机体损伤严重！按 R 使用维修套件。", C_CP)
	if time_left < 120.0 and once("time"):
		game.hud.radio("铁砧", "剩余两分钟，加快进度！", C_CP)
	if p.od >= 1.0 and not p.od_on and once("od"):
		game.hud.radio("铁砧", "技能核心蓄能完毕。按 V 启动。", C_CP)
	if wingman != null and not wingman.alive and once("wing"):
		game.hud.radio("铁砧", "砂砾 2 信号丢失……砂砾 1，继续任务。", C_CP)
	_update(dt)


func _update(_dt: float) -> void:
	if phase == 1:
		var left := 0
		for tu in turrets:
			if tu.alive:
				left += 1
		if left == 2 and once("t1"):
			game.hud.radio("砂砾 2", "一号炮台沉默。还剩两座。", C_WING)
		if left == 1 and once("t2"):
			game.hud.radio("铁砧", "干得好，还有最后一座。", C_CP)
		if left == 0:
			_phase2()
	elif phase == 2:
		var n := 0
		for u in wave:
			if u.alive:
				n += 1
		if n == 0 and once("p2done"):
			game.hud.radio("砂砾 2", "增援全灭。这片空域干净了——", C_WING)
			at(4.0, _phase3)
	elif phase == 3:
		if boss != null and not boss.alive:
			_end(true, "")


func _phase2() -> void:
	phase = 2
	var w = game.world
	game.hud.show_banner("MISSION UPDATE", "敌机架增援接近 · 全部歼灭", Color(1.0, 0.72, 0.25), 4.5)
	game.hud.radio("铁砧", "炮台全部沉默。警告，北侧出现多个热源，敌机架小队正在接近！", C_CP)
	var px: float = game.player.global_position.x
	for sp in [["hound", -90.0], ["ripper", -30.0], ["reaver", 40.0], ["brute", 100.0]]:
		var x: float = clampf(px * 0.3 + float(sp[1]), -200.0, 200.0)
		var z := -420.0 - randf() * 40.0
		var u = game.spawn_mech(sp[0], 1, Vector3(x, w.height(x, z) + 0.5, z), PI, true)
		u.alert_t = 9999.0
		u.ai.sense = 2000.0
		wave.append(u)
	say(7.0, "砂砾 2", "两架猎犬、一架裂爪、一架重锤。裂爪会贴上来，重锤的火箭筒别硬吃。", C_WING)


func _phase3() -> void:
	phase = 3
	var w = game.world
	game.hud.show_banner("WARNING", "高速目标接近 · 王牌机「亡灵」", Color(1.0, 0.3, 0.2), 5.0)
	game.sfx.play2d("alarm", 0.7)
	game.hud.radio("铁砧", "高空高速目标！识别信号……EX-9「亡灵」。砂砾 1，那是王牌。", C_CP)
	var pp: Vector3 = game.player.global_position
	var x := clampf(pp.x + 60.0, -200.0, 200.0)
	var z := clampf(pp.z - 170.0, -300.0, 120.0)
	boss = game.spawn_mech("revenant", 1, Vector3(x, w.height(x, z) + 170.0, z), PI, true)
	boss.alert_t = 9999.0
	boss.ai.sense = 3000.0
	boss.dmg_mul = 1.0
	say(6.0, "亡灵", "……就是你，一个人拆了整个炮兵阵地？", C_FOE)
	say(12.0, "亡灵", "让我看看，你的机架还剩多少稳定值。", C_FOE)


func on_kill(u, by) -> void:
	if by == game.player and u.kind == "mech" and u != boss and once("firstkill"):
		game.hud.radio("砂砾 2", "确认击坠。漂亮。", C_WING)
	if u == boss:
		game.hud.radio("亡灵", "……哈，原来如此。这片沙尘……归你了。", C_FOE)


func _end(win: bool, reason: String) -> void:
	over = true
	won = win
	fail_reason = reason
	if win:
		game.hud.show_banner("MISSION ACCOMPLISHED", "作战目标达成", C_CP, 6.0)
		game.hud.radio("铁砧", "确认亡灵击毁。砂砾小队，任务完成，返航。", C_CP)
		end_t = t + 6.0
	else:
		game.hud.show_banner("MISSION FAILED", reason, Color(1.0, 0.3, 0.2), 5.0)
		end_t = t + 4.5
