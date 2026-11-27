extends Node
## 声音。所有音效在启动时用代码合成（振荡器 + 滤波噪声 + 指数包络），没有外部音频文件。
## 总线：Master 上挂低通（头盔里、液体中的闷感）；Echo 总线挂延迟反馈，给大声的声音留尾巴。

const SR := 22050
const BEAT := 1.6                # 血海的心跳周期（秒）
const ECHO := ["active", "shot1", "shot2", "hatch", "wake", "impact", "flood", "i_run", "i_door", "i_groan1", "i_groan2", "i_launch"]

var streams := {}
var mic_on := false
var mic_lvl := 0.0

var _defs := {}
var _names: Array = []
var _raw: Array = []
var _p2: Array[AudioStreamPlayer] = []
var _p3: Array[AudioStreamPlayer3D] = []
var _i2 := 0
var _i3 := 0
var _drone: AudioStreamPlayer
var _vents: Array[AudioStreamPlayer3D] = []      # 心囊的循环声
var _mic_player: AudioStreamPlayer
var _cap: AudioEffectCapture
var _mic_floor := 0.02
var _mic_cal := 0.0
var _lp: AudioEffectLowPassFilter


# 层定义。振荡器：波形 0 正弦 1 方波 2 锯齿 3 三角；噪声：滤波 0 带通 1 低通
func T(f0: float, f1: float, d: float, v: float, ty := 0, att := 0.008, dl := 0.0) -> Array:
	return [0, f0, f1, d, v, ty, att, dl]


func N(d: float, f: float, v: float, ft := 0, f1 := 0.0, q := 1.0, att := 0.005, dl := 0.0) -> Array:
	return [1, d, f, v, ft, f1, q, att, dl]


func _build_defs() -> void:
	var d := _defs
	d["lore"] = [T(1320, 1980, .25, .06)]
	d["resonate"] = [T(1760, 1740, 1.6, .5), T(2640, 2600, 1.2, .25)]
	d["key_idle"] = [T(1760, 1750, .5, .22, 0, .02)]                                  # 没醒的耳石：一声很轻的滴答
	d["key_ring"] = [T(1760, 1740, 1.3, .4, 0, .03), T(2640, 2600, 1.0, .2, 0, .03)]      # 醒着的耳石：长鸣
	d["lured"] = [T(700, 1050, .2, .12, 3)]
	d["whisper"] = [T(950, 720, .14, .07)]
	d["active"] = [T(1500, 480, .55, .3), T(750, 240, .7, .12)]
	d["absorb"] = [T(300, 1400, .5, .1, 3)]
	d["dry"] = [T(190, 165, .08, .17, 1)]
	d["mend"] = [T(92, 128, .42, .2, 3, .08), N(.4, 320, .1, 1, 0.0, 1.0, .1)]      # 修复结构时的低鸣
	d["decoy_throw"] = [N(.25, 900, .15, 0, 300)]
	d["shot0"] = [N(.09, 2600, .16, 0, 0, 2), T(500, 220, .08, .1)]
	d["shot1"] = [N(.22, 900, .55, 0, 200), T(190, 45, .25, .6)]
	d["shot2"] = [N(.8, 300, .8, 1, 70), T(110, 28, .9, .8, 2)]
	d["overload"] = [T(2400, 3300, 1.5, .28, 0, .5), T(3150, 2900, 1.5, .14, 0, .3)]
	d["hit"] = [T(1300, 900, .06, .12, 1)]
	d["e_die"] = [N(.9, 700, .9, 0, 120), T(600, 60, 1, .6, 2)]
	d["e_hurt"] = [N(.25, 1500, .6, 0, 0, 3)]
	d["e_ping"] = [T(1900, 380, .6, 1, 3), T(950, 190, .7, .5)]
	d["absorbed"] = [T(500, 1900, .3, .2, 3)]
	d["slime_miss"] = [T(260, 120, .25, .12)]
	d["located"] = [T(140, 90, .3, .3, 1)]
	d["hurt"] = [N(.3, 400, .9, 0, 120), T(90, 40, .4, .7, 2)]
	d["e_hunt"] = [T(220, 330, .5, .8, 2)]
	# 怒吼：先是一口倒吸的气，然后三股压下来的低吼叠着一层撕裂的噪声
	d["e_roar"] = [N(.4, 2400, .35, 0, 600, 2, .3), T(150, 52, 1.6, 1, 2, .06, .4), T(228, 74, 1.5, .7, 3, .08, .42), T(76, 30, 1.7, .9, 0, .1, .4),
		N(1.5, 420, 1, 1, 80, 1, .08, .4), N(1.3, 2800, .55, 0, 900, 3, .05, .45)]
	d["e_attack"] = [T(700, 1100, .6, 1, 2), N(.6, 3000, .6, 0, 0, 4)]
	var wind := []
	for i in 6:
		wind.append(N(.04, 1800 + i * 350, .7, 0, 0, 6, .005, i * i * .022 + i * .06))
	d["e_wind"] = wind
	d["click_hunt"] = [N(.03, 900, .6, 0, 0, 5)]
	d["click_sus"] = [N(.03, 2200, .6, 0, 0, 5)]
	d["click_drift"] = [N(.03, 2200, .35, 0, 0, 5)]
	d["hatch"] = [N(.5, 500, 1, 1, 90), T(140, 30, .7, .9)]
	d["beacon"] = [T(220, 220, 1.8, 1, 3), T(330, 331, 1.8, .6), T(110, 109, 2, .8)]
	d["step"] = [N(.07, 160, .25, 1)]
	d["decoy_beep"] = [T(1200, 1150, .18, .6, 1)]
	d["heart"] = [T(62, 40, .12, .65), T(58, 38, .12, .48, 0, .008, .14)]
	d["breath"] = [N(1.14, 1500, .07, 0, 0, .7, .6), N(1.26, 700, .06, 0, 0, .7, .36, 1.35)]
	d["groan_a"] = [T(85, 40, 4, .9, 2, 1.0)]
	d["groan_b"] = [T(180, 120, 2.5, .7, 0, .8), T(120, 170, 2, .5, 0, .6, 2.2)]
	d["charge"] = [T(60, 240, 1.4, .2, 2)]
	d["boot_tick"] = [T(1800, 1700, .012, .03, 1)]
	d["boot_fail"] = [T(160, 120, .15, .12, 1)]
	d["boot_ok"] = [T(900, 1400, .15, .1)]
	d["wake"] = [T(1500, 480, .55, .2)]
	d["impact"] = [N(1.2, 140, 1, 1), T(70, 24, 1.3, 1)]
	var fl := [N(.15, 3200, .7), N(.4, 5200, .3, 0, 0, 3, .005, .1), T(50, 26, .8, 1),
		N(3.8, 2600, .3, 0, 500, 1, .2, .15), N(3.6, 500, .6, 1, 110, 1, 1.2, .15)]
	for i in 5:
		fl.append(T(980, 980, .09, .12, 1, .008, .45 + i * .28))      # 舱内告警
	d["flood"] = fl
	# 实机开场的音效
	var run := [N(5, 90, .5, 1, 0, 1, .5)]
	for i in 10:
		run.append(T(620, 620, .24, .1, 1, .008, i * .5))             # 双音警报
		run.append(T(465, 465, .24, .1, 1, .008, i * .5 + .25))
	for i in 9:
		run.append(N(.06, 240, .5, 1, 0, 1, .005, i * .34))           # 奔跑的脚步
	d["i_run"] = run
	d["i_swish1"] = [N(.5, 700, .3, 0, 200)]
	d["i_swish2"] = [N(.5, 1200, .25, 0, 300)]
	d["i_door"] = [N(.3, 300, 1, 1), T(120, 45, .35, .9)]
	d["i_bar"] = [N(.25, 2400, .2, 0, 900), T(240, 150, .12, .3, 0, .008, .2)]
	d["i_lever"] = [T(900, 650, .06, .3, 1)]
	d["i_launch"] = [N(1.4, 180, 1, 0, 1400), T(55, 28, 1.2, .8, 2), N(3.8, 900, .35, 0, 0, .5, .8)]
	var hm := []
	for i in 4:
		hm.append(N(.3, 1300, .14, 0, 0, 1, .12, i * .42))
	d["i_helm"] = hm
	d["i_seal"] = [N(.5, 5200, .2, 0, 0, 2)]
	d["i_visor"] = [T(300, 190, .1, .4), T(1200, 1900, .14, .12, 0, .008, .12)]
	d["i_groan1"] = [T(95, 60, 1.6, .3, 2, .5)]
	d["i_groan2"] = [T(80, 52, 1.4, .3, 2, .4)]
	d["i_sparks"] = [N(.1, 4200, .4), N(.08, 3800, .4, 0, 0, 1, .005, .22), N(.14, 4500, .4, 0, 0, 1, .005, .45)]
	d["drone"] = []          # 循环：低频噪声 + 两个次低音
	d["heartloop"] = []      # 循环：心囊的搏动，一拍 BEAT 秒
	_names = d.keys()


func _ready() -> void:
	_setup_buses()
	_build_defs()
	_raw.resize(_names.size())
	var gid := WorkerThreadPool.add_group_task(_gen, _names.size(), -1, true, "sfx synth")
	WorkerThreadPool.wait_for_group_task_completion(gid)
	for i in _names.size():
		var w := AudioStreamWAV.new()
		w.format = AudioStreamWAV.FORMAT_16_BITS
		w.mix_rate = SR
		w.stereo = false
		w.data = _raw[i]
		if _names[i] == "drone" or _names[i] == "heartloop":
			w.loop_mode = AudioStreamWAV.LOOP_FORWARD
			w.loop_begin = 0
			@warning_ignore("integer_division")
			w.loop_end = (_raw[i] as PackedByteArray).size() / 2
		streams[_names[i]] = w
	_raw.clear()
	for i in 14:
		var p := AudioStreamPlayer.new()
		add_child(p)
		_p2.append(p)
	for i in 20:
		var p := AudioStreamPlayer3D.new()
		p.attenuation_model = AudioStreamPlayer3D.ATTENUATION_INVERSE_DISTANCE
		p.unit_size = 3.0
		p.max_db = 3.0
		p.bus = &"Echo"
		add_child(p)
		_p3.append(p)
	_drone = AudioStreamPlayer.new()
	_drone.stream = streams["drone"]
	add_child(_drone)


func _setup_buses() -> void:
	if AudioServer.get_bus_index("Echo") >= 0:
		return
	_lp = AudioEffectLowPassFilter.new()
	_lp.cutoff_hz = 3600.0
	AudioServer.add_bus_effect(0, _lp)
	AudioServer.set_bus_volume_db(0, linear_to_db(.85))
	AudioServer.add_bus()
	var e := AudioServer.bus_count - 1
	AudioServer.set_bus_name(e, "Echo")
	AudioServer.set_bus_send(e, "Master")
	var dl := AudioEffectDelay.new()
	dl.dry = 1.0
	dl.tap1_active = true
	dl.tap1_delay_ms = 310.0
	dl.tap1_level_db = -7.0
	dl.tap1_pan = 0.0
	dl.tap2_active = false
	dl.feedback_active = true
	dl.feedback_delay_ms = 310.0
	dl.feedback_level_db = -6.0
	dl.feedback_lowpass = 1100.0
	AudioServer.add_bus_effect(e, dl)
	AudioServer.add_bus()
	var m := AudioServer.bus_count - 1
	AudioServer.set_bus_name(m, "Mic")
	AudioServer.set_bus_send(m, "Master")
	_cap = AudioEffectCapture.new()
	AudioServer.add_bus_effect(m, _cap)
	AudioServer.set_bus_volume_db(m, -80.0)      # 只采集音量，不回放自己的声音


func set_muffle(hz: float) -> void:
	if _lp:
		_lp.cutoff_hz = hz


# ---------- 合成（工作线程） ----------
func _gen(idx: int) -> void:
	var nm: String = _names[idx]
	var mix := PackedFloat32Array()
	var rg := RandomNumberGenerator.new()
	rg.seed = hash(nm)
	if nm == "drone":
		mix = _loop_noise(rg, 4.0, 110.0, 1, 1.0, 2.2)
		for i in mix.size():
			var t := i / float(SR)
			mix[i] = mix[i] + .11 * sin(TAU * 38.0 * t) + .05 * sin(TAU * 57.25 * t)
	elif nm == "heartloop":
		# 血流的低频底噪随每一拍涌起，上面叠"咚—咚"两下；拍点与点云着色器里的鼓动曲线一致
		mix = _loop_noise(rg, BEAT, 170.0, 1, 1.0, 1.5)
		for i in mix.size():
			var ph := i / float(mix.size())
			var dub := exp(-(ph - .2) * 11.0) if ph > .2 else 0.0
			mix[i] = mix[i] * (.3 + 1.4 * exp(-ph * 9.0) + 1.0 * dub)
		_tone(mix, 54.0, 27.0, .28, 1.0, 0, .012, 0.0)
		_tone(mix, 108.0, 52.0, .16, .35, 0, .01, 0.0)
		_tone(mix, 48.0, 25.0, .24, .75, 0, .012, BEAT * .2)
		_tone(mix, 96.0, 48.0, .13, .24, 0, .01, BEAT * .2)
	else:
		var layers: Array = _defs[nm]
		var total := 0.0
		for l: Array in layers:
			total = maxf(total, (l[3] + l[7]) if l[0] == 0 else (l[1] + l[8]))
		mix.resize(int((total + .04) * SR))
		for l: Array in layers:
			if l[0] == 0:
				_tone(mix, l[1], l[2], l[3], l[4], l[5], l[6], l[7])
			else:
				_noise(mix, rg, l[1], l[2], l[3], l[4], l[5], l[6], l[7], l[8])
	var bytes := PackedByteArray()
	bytes.resize(mix.size() * 2)
	for i in mix.size():
		var v := mix[i]
		v = v / (1.0 + absf(v) * .35)                     # 软削波
		bytes.encode_s16(i * 2, int(clampf(v, -1.0, 1.0) * 32000.0))
	_raw[idx] = bytes


func _tone(mix: PackedFloat32Array, f0: float, f1: float, dur: float, vol: float, ty: int, att: float, dl: float) -> void:
	var n0 := int(dl * SR)
	var n := int(dur * SR)
	var na := maxi(1, int(minf(att, dur * .6) * SR))
	var vv := maxf(.0002, vol)
	var g := .0001
	var up := pow(vv / .0001, 1.0 / na)
	var down := pow(.0001 / vv, 1.0 / maxi(1, n - na))
	var f := f0
	var fr := pow(maxf(20.0, f1) / f0, 1.0 / n)
	var ph := 0.0
	for i in n:
		g *= up if i < na else down
		ph += f / SR
		f *= fr
		var p := ph - floorf(ph)
		var s := 0.0
		if ty == 0:
			s = sin(TAU * p)
		elif ty == 1:
			s = 1.0 if p < .5 else -1.0
		elif ty == 2:
			s = 2.0 * p - 1.0
		else:
			s = 1.0 - 4.0 * absf(p - .5)
		mix[n0 + i] += s * g


func _noise(mix: PackedFloat32Array, rg: RandomNumberGenerator, dur: float, freq: float, vol: float, ft: int, f1: float, q: float, att: float, dl: float) -> void:
	var n0 := int(dl * SR)
	var n := int(dur * SR)
	var na := maxi(1, int(minf(att, dur * .6) * SR))
	var vv := maxf(.0002, vol)
	var g := .0001
	var up := pow(vv / .0001, 1.0 / na)
	var down := pow(.0001 / vv, 1.0 / maxi(1, n - na))
	var b0 := 0.0
	var b1 := 0.0
	var b2 := 0.0
	var a1 := 0.0
	var a2 := 0.0
	var x1 := 0.0
	var x2 := 0.0
	var y1 := 0.0
	var y2 := 0.0
	for i in n:
		if (i & 15) == 0:
			var fc := freq
			if f1 > 0.0:
				fc = freq * pow(f1 / freq, i / float(n))
			fc = minf(fc, SR * .45)
			var w0 := TAU * fc / SR
			var cs := cos(w0)
			var sn := sin(w0)
			if ft == 0:
				var al := sn / (2.0 * q)
				var a0 := 1.0 + al
				b0 = al / a0
				b1 = 0.0
				b2 = -al / a0
				a1 = -2.0 * cs / a0
				a2 = (1.0 - al) / a0
			else:
				var al := sn / (2.0 * pow(10.0, q / 20.0))
				var a0 := 1.0 + al
				b0 = (1.0 - cs) * .5 / a0
				b1 = (1.0 - cs) / a0
				b2 = b0
				a1 = -2.0 * cs / a0
				a2 = (1.0 - al) / a0
		var x := rg.randf() * 2.0 - 1.0
		var y := b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
		x2 = x1
		x1 = x
		y2 = y1
		y1 = y
		g *= up if i < na else down
		mix[n0 + i] += y * g


## 可无缝循环的滤波噪声：多生成半秒，把尾巴交叉淡入到开头
func _loop_noise(rg: RandomNumberGenerator, dur: float, freq: float, ft: int, q: float, gain: float) -> PackedFloat32Array:
	var n := int(dur * SR)
	var x := int(.5 * SR)
	var tmp := PackedFloat32Array()
	tmp.resize(n + x + 8)
	# 借用 _noise：att 很短、vol 恒定不合适（它带衰减包络），这里单独滤一遍
	var w0 := TAU * freq / SR
	var cs := cos(w0)
	var sn := sin(w0)
	var b0 := 0.0
	var b1 := 0.0
	var b2 := 0.0
	var a1 := 0.0
	var a2 := 0.0
	if ft == 0:
		var al := sn / (2.0 * q)
		var a0 := 1.0 + al
		b0 = al / a0
		b2 = -al / a0
		a1 = -2.0 * cs / a0
		a2 = (1.0 - al) / a0
	else:
		var al := sn / (2.0 * pow(10.0, q / 20.0))
		var a0 := 1.0 + al
		b0 = (1.0 - cs) * .5 / a0
		b1 = (1.0 - cs) / a0
		b2 = b0
		a1 = -2.0 * cs / a0
		a2 = (1.0 - al) / a0
	var x1 := 0.0
	var x2 := 0.0
	var y1 := 0.0
	var y2 := 0.0
	for i in n + x:
		var s := rg.randf() * 2.0 - 1.0
		var y := b0 * s + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
		x2 = x1
		x1 = s
		y2 = y1
		y1 = y
		tmp[i] = y * gain
	var out := PackedFloat32Array()
	out.resize(n)
	for i in n:
		if i < x:
			var k := i / float(x)
			out[i] = tmp[i] * k + tmp[n + i] * (1.0 - k)
		else:
			out[i] = tmp[i]
	return out


# ---------- 播放 ----------
func play(nm: String, vol := 1.0, pitch := 1.0) -> void:
	var p := _p2[_i2]
	_i2 = (_i2 + 1) % _p2.size()
	p.stream = streams[nm]
	p.volume_db = linear_to_db(maxf(vol, .0001))
	p.pitch_scale = pitch
	p.bus = &"Echo" if nm in ECHO else &"Master"
	p.play()


func play_at(nm: String, pos: Vector3, vol := 1.0, pitch := 1.0) -> void:
	var p := _p3[_i3]
	_i3 = (_i3 + 1) % _p3.size()
	p.stream = streams[nm]
	p.position = pos
	p.volume_db = linear_to_db(maxf(vol, .0001))
	p.pitch_scale = pitch
	p.play()


func start_drone() -> void:
	if _drone.playing:
		return
	_drone.volume_db = -40.0
	_drone.play()
	create_tween().tween_property(_drone, "volume_db", -3.0, 4.0)


## 心囊：所有心囊同相位地跳——整片血海共用一个脉搏
func start_hearts(pts: Array[Vector2]) -> void:
	if not _vents.is_empty():
		return
	for v in pts:
		var p := AudioStreamPlayer3D.new()
		p.attenuation_model = AudioStreamPlayer3D.ATTENUATION_INVERSE_DISTANCE
		p.unit_size = 3.0
		p.max_db = 3.0
		p.stream = streams["heartloop"]
		p.position = Vector3(v.x, 1.0, v.y)
		add_child(p)
		p.play()
		_vents.append(p)


## 心跳相位 0–1；没有心囊在响时返回 -1（调用方改用游戏时间）
func beat_phase() -> float:
	if _vents.is_empty() or not _vents[0].playing:
		return -1.0
	return fposmod((_vents[0].get_playback_position() + AudioServer.get_time_since_last_mix()) / BEAT, 1.0)


func stop_loops() -> void:
	_drone.stop()
	for p in _vents:
		p.queue_free()
	_vents.clear()


# ---------- 麦克风：玩家自己的声音 = 主动声呐 ----------
func start_mic() -> void:
	if mic_on:
		return
	_mic_player = AudioStreamPlayer.new()
	_mic_player.stream = AudioStreamMicrophone.new()
	_mic_player.bus = &"Mic"
	add_child(_mic_player)
	_mic_player.play()
	var m := AudioServer.get_bus_index("Mic")
	if m >= 0 and _cap == null:
		_cap = AudioServer.get_bus_effect(m, 0) as AudioEffectCapture
	mic_on = _cap != null
	_mic_cal = 0.0


func read_mic(dt: float) -> float:
	if not mic_on:
		return 0.0
	var n := _cap.get_frames_available()
	if n <= 0:
		return mic_lvl
	var buf := _cap.get_buffer(n)
	var m := mini(n, 1024)
	var s := 0.0
	for i in range(n - m, n):
		var v := buf[i]
		s += v.x * v.x
	var rms := sqrt(s / m)
	if _mic_cal < 1.5:
		_mic_cal += dt
		_mic_floor = lerpf(_mic_floor, rms, .1)
		return 0.0
	_mic_floor = minf(lerpf(_mic_floor, rms, .002), .08)
	var lv := clampf((rms - _mic_floor * 1.6 - .006) / .22, 0.0, 1.0)
	mic_lvl = lerpf(mic_lvl, lv, .6) if lv > mic_lvl else lerpf(mic_lvl, lv, .12)
	return mic_lvl
