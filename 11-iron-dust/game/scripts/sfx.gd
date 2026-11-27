extends Node
# Every sound has an id. At start-up each id takes the recording in res://audio/<id>.ogg (or
# .wav) if there is one and otherwise a buffer synthesised here, so the game always has sound.
# Sources and licences of the recordings: audio/CREDITS.md.

const SR := 22050
const AUDIO_DIR := "res://audio/"
const MAX_BOOST_DB := 4.0     # a call may ask for more than unity gain, but only this much

var streams := {}
var pool3d: Array[AudioStreamPlayer3D] = []
var pool2d: Array[AudioStreamPlayer] = []
var i3 := 0
var i2 := 0
var thr: AudioStreamPlayer
var wind: AudioStreamPlayer
var drone: AudioStreamPlayer
var muted := false
var thr_v := 0.0
var world_bus := -1
var lowpass: AudioEffectLowPassFilter
var _cut := 20000.0
var _vol := 0.0
var music: AudioStreamPlayer


var real := {}


func _load_real(id: String) -> AudioStream:
	for ext in [".ogg", ".wav"]:
		var path: String = AUDIO_DIR + id + ext
		if ResourceLoader.exists(path):
			var s: AudioStream = load(path)
			if s != null:
				if id.ends_with("_loop"):
					if s is AudioStreamOggVorbis:
						s.loop = true
					elif s is AudioStreamWAV:
						s.loop_mode = AudioStreamWAV.LOOP_FORWARD
						s.loop_end = s.data.size() / 2
				return s
	return null


func setup() -> void:
	var N := "n"
	var S := "s"
	var Q := "q"
	# layer: [type, gain, decay, f0/lp0, f1/lp1, hp, attack, delay]
	_add("rifle", 0.3, [[N, 0.9, 22.0, 3200.0, 500.0, 300.0, 0.001, 0.0], [S, 0.8, 26.0, 150.0, 55.0, 0.0, 0.001, 0.0]])
	_add("gatling", 0.16, [[N, 0.8, 40.0, 4200.0, 900.0, 500.0, 0.001, 0.0], [S, 0.5, 45.0, 190.0, 80.0, 0.0, 0.001, 0.0]])
	_add("smg", 0.2, [[N, 0.85, 34.0, 3800.0, 700.0, 400.0, 0.001, 0.0], [S, 0.6, 36.0, 170.0, 70.0, 0.0, 0.001, 0.0]])
	_add("cannon", 1.1, [[N, 1.0, 5.5, 1800.0, 140.0, 0.0, 0.002, 0.0], [S, 1.0, 6.5, 95.0, 30.0, 0.0, 0.002, 0.0], [N, 0.5, 30.0, 5000.0, 2000.0, 800.0, 0.001, 0.0]])
	_add("shotgun", 0.6, [[N, 1.0, 10.0, 2600.0, 300.0, 100.0, 0.001, 0.0], [S, 0.8, 12.0, 120.0, 40.0, 0.0, 0.001, 0.0]])
	_add("missile", 0.9, [[N, 0.7, 3.5, 500.0, 2600.0, 200.0, 0.05, 0.0], [S, 0.3, 9.0, 120.0, 60.0, 0.0, 0.01, 0.0]])
	_add("explosion", 2.0, [[N, 1.0, 2.6, 2600.0, 90.0, 0.0, 0.003, 0.0], [S, 1.0, 3.4, 75.0, 24.0, 0.0, 0.003, 0.0], [N, 0.35, 5.0, 900.0, 300.0, 0.0, 0.2, 0.15]])
	_add("hit", 0.14, [[N, 0.7, 45.0, 6000.0, 3000.0, 1800.0, 0.001, 0.0], [S, 0.4, 40.0, 2100.0, 1500.0, 0.0, 0.001, 0.0], [S, 0.5, 30.0, 240.0, 120.0, 0.0, 0.001, 0.0]])
	_add("ric", 0.3, [[S, 0.5, 12.0, 2600.0, 900.0, 0.0, 0.001, 0.0], [N, 0.3, 40.0, 6000.0, 4000.0, 2500.0, 0.001, 0.0]])
	_add("step", 0.4, [[S, 1.0, 13.0, 62.0, 34.0, 0.0, 0.004, 0.0], [N, 0.5, 20.0, 500.0, 120.0, 0.0, 0.004, 0.0], [N, 0.15, 30.0, 4000.0, 2500.0, 1500.0, 0.002, 0.03]])
	_add("land", 0.8, [[S, 1.0, 6.0, 70.0, 26.0, 0.0, 0.004, 0.0], [N, 0.8, 8.0, 800.0, 100.0, 0.0, 0.004, 0.0], [N, 0.2, 14.0, 3500.0, 1500.0, 900.0, 0.002, 0.05]])
	_add("boost", 0.6, [[N, 0.9, 6.0, 400.0, 2400.0, 150.0, 0.02, 0.0], [S, 0.5, 8.0, 60.0, 110.0, 0.0, 0.02, 0.0]])
	_add("qb", 0.4, [[N, 1.0, 9.0, 3000.0, 600.0, 300.0, 0.005, 0.0], [S, 0.5, 12.0, 140.0, 60.0, 0.0, 0.005, 0.0]])
	_add("swing", 0.3, [[N, 0.8, 10.0, 600.0, 3600.0, 400.0, 0.06, 0.0]])
	_add("whiff", 0.25, [[N, 0.6, 12.0, 2600.0, 500.0, 300.0, 0.02, 0.0]])
	_add("clang", 0.9, [[S, 0.5, 6.0, 523.0, 517.0, 0.0, 0.001, 0.0], [S, 0.4, 7.0, 1187.0, 1170.0, 0.0, 0.001, 0.0], [S, 0.3, 9.0, 1730.0, 1700.0, 0.0, 0.001, 0.0], [S, 0.25, 11.0, 2410.0, 2380.0, 0.0, 0.001, 0.0], [N, 0.9, 18.0, 5000.0, 600.0, 200.0, 0.001, 0.0], [S, 0.9, 9.0, 90.0, 35.0, 0.0, 0.001, 0.0]])
	_add("stagger", 0.7, [[S, 0.5, 7.0, 310.0, 180.0, 0.0, 0.001, 0.0], [S, 0.35, 9.0, 743.0, 500.0, 0.0, 0.001, 0.0], [N, 0.9, 10.0, 3000.0, 300.0, 100.0, 0.001, 0.0], [S, 0.8, 8.0, 80.0, 30.0, 0.0, 0.001, 0.0]])
	_add("lock", 0.16, [[Q, 0.25, 30.0, 1500.0, 1500.0, 0.0, 0.002, 0.0], [Q, 0.25, 30.0, 1500.0, 1500.0, 0.0, 0.002, 0.08]])
	_add("warn", 0.5, [[Q, 0.22, 6.0, 880.0, 880.0, 0.0, 0.004, 0.0], [Q, 0.22, 6.0, 660.0, 660.0, 0.0, 0.004, 0.22]])
	_add("alarm", 0.7, [[Q, 0.2, 3.0, 520.0, 780.0, 0.0, 0.01, 0.0], [Q, 0.2, 3.0, 520.0, 780.0, 0.0, 0.01, 0.35]])
	_add("radio", 0.2, [[N, 0.35, 16.0, 4000.0, 2500.0, 1400.0, 0.002, 0.0], [Q, 0.12, 30.0, 1050.0, 1050.0, 0.0, 0.002, 0.1]])
	_add("click", 0.06, [[Q, 0.2, 60.0, 1300.0, 900.0, 0.0, 0.001, 0.0]])
	_add("confirm", 0.3, [[Q, 0.18, 12.0, 700.0, 700.0, 0.0, 0.003, 0.0], [Q, 0.18, 10.0, 1050.0, 1050.0, 0.0, 0.003, 0.09]])
	_add("repair", 0.7, [[S, 0.35, 4.0, 300.0, 900.0, 0.0, 0.05, 0.0], [N, 0.25, 6.0, 1200.0, 3000.0, 600.0, 0.05, 0.0]])
	_add("reload", 0.2, [[N, 0.5, 40.0, 5000.0, 2500.0, 1500.0, 0.001, 0.0], [S, 0.4, 30.0, 320.0, 220.0, 0.0, 0.001, 0.0], [N, 0.5, 40.0, 5000.0, 2500.0, 1500.0, 0.001, 0.1]])
	_add("hurt", 0.3, [[N, 0.9, 16.0, 1800.0, 300.0, 0.0, 0.001, 0.0], [S, 0.8, 14.0, 110.0, 50.0, 0.0, 0.001, 0.0]])
	_add("banner", 0.9, [[S, 0.3, 3.0, 196.0, 196.0, 0.0, 0.02, 0.0], [S, 0.3, 3.0, 293.6, 293.6, 0.0, 0.02, 0.0], [S, 0.2, 3.5, 392.0, 392.0, 0.0, 0.02, 0.12]])
	_add("charge", 1.5, [[S, 0.3, 0.3, 180.0, 1500.0, 0.0, 0.3, 0.0], [N, 0.2, 0.4, 800.0, 6000.0, 500.0, 0.5, 0.0], [Q, 0.06, 0.3, 90.0, 750.0, 0.0, 0.3, 0.0]])
	_add("rail", 0.9, [[N, 1.0, 14.0, 7000.0, 900.0, 600.0, 0.001, 0.0], [S, 0.9, 9.0, 220.0, 40.0, 0.0, 0.001, 0.0], [Q, 0.22, 12.0, 1800.0, 300.0, 0.0, 0.001, 0.0], [N, 0.4, 4.0, 3000.0, 500.0, 200.0, 0.02, 0.05]])
	_add("beam", 0.3, [[Q, 0.16, 2.0, 110.0, 112.0, 0.0, 0.01, 0.0], [S, 0.22, 2.0, 880.0, 860.0, 0.0, 0.01, 0.0], [N, 0.3, 2.0, 5000.0, 5000.0, 2500.0, 0.01, 0.0]])
	_add("od_on", 1.4, [[S, 0.45, 1.2, 80.0, 640.0, 0.0, 0.05, 0.0], [N, 0.5, 1.5, 300.0, 5000.0, 200.0, 0.1, 0.0], [Q, 0.1, 3.0, 330.0, 990.0, 0.0, 0.02, 0.3]])
	_add("od_off", 1.2, [[S, 0.4, 2.5, 500.0, 60.0, 0.0, 0.01, 0.0], [N, 0.6, 3.0, 4000.0, 300.0, 100.0, 0.01, 0.0]])
	_add("shield", 0.35, [[S, 0.5, 12.0, 410.0, 395.0, 0.0, 0.001, 0.0], [S, 0.35, 14.0, 980.0, 940.0, 0.0, 0.001, 0.0], [N, 0.8, 22.0, 4500.0, 800.0, 300.0, 0.001, 0.0]])
	_add("shield_break", 1.0, [[N, 1.0, 5.0, 5000.0, 200.0, 100.0, 0.001, 0.0], [S, 0.6, 6.0, 300.0, 90.0, 0.0, 0.001, 0.0], [S, 0.4, 8.0, 1320.0, 700.0, 0.0, 0.001, 0.0], [S, 0.35, 7.0, 1870.0, 900.0, 0.0, 0.001, 0.04]])
	_add("jet", 2.6, [[N, 0.8, 0.9, 300.0, 4200.0, 150.0, 0.9, 0.0], [N, 0.6, 1.4, 3800.0, 350.0, 100.0, 0.2, 1.1]])
	_add("siren", 3.2, [[S, 0.26, 0.25, 300.0, 640.0, 0.0, 0.5, 0.0], [S, 0.18, 0.25, 303.0, 646.0, 0.0, 0.5, 0.0], [S, 0.2, 0.9, 640.0, 300.0, 0.0, 0.2, 1.7]])
	_add("bigboom", 5.0, [[N, 1.0, 0.9, 1500.0, 40.0, 0.0, 0.01, 0.0], [S, 1.0, 1.0, 60.0, 18.0, 0.0, 0.01, 0.0], [N, 0.6, 1.5, 600.0, 100.0, 0.0, 0.5, 0.4]])
	_add("cannon_big", 2.5, [[N, 1.0, 2.2, 4000.0, 100.0, 0.0, 0.003, 0.0], [S, 1.0, 2.6, 70.0, 22.0, 0.0, 0.003, 0.0], [Q, 0.25, 5.0, 900.0, 120.0, 0.0, 0.001, 0.0], [N, 0.5, 3.0, 6000.0, 1500.0, 800.0, 0.3, 0.1]])
	_add("thr_loop", 1.5, [[N, 0.9, 0.0, 700.0, 700.0, 90.0, 0.0, 0.0], [N, 0.4, 0.0, 2600.0, 2600.0, 1200.0, 0.0, 0.0]], true)
	_add("wind_loop", 3.0, [[N, 0.8, 0.0, 420.0, 420.0, 60.0, 0.0, 0.0]], true)
	_add("drone_loop", 4.0, [[S, 0.5, 0.0, 55.0, 55.0, 0.0, 0.0, 0.0], [S, 0.3, 0.0, 82.5, 82.5, 0.0, 0.0, 0.0], [S, 0.18, 0.0, 110.5, 110.5, 0.0, 0.0, 0.0]], true)
	# ids that have no synthesis recipe: the recording, or failing that a close relative
	for pr in [["beam_rifle", "rail"], ["plasma_swing", "swing"], ["heat_hit", "ric"], ["grenade", "cannon"], ["flak", "explosion"],
			["hook", "qb"], ["swap", "reload"], ["brace", "step"], ["servo", "click"], ["touch", "click"], ["scan", "confirm"],
			["jam", "radio"], ["ram", "boost"], ["focus", "confirm"], ["collapse", "bigboom"]]:
		var rr := _load_real(pr[0])
		real[pr[0]] = rr != null
		streams[pr[0]] = rr if rr != null else streams[pr[1]]
	# everything heard from outside goes through its own bus so it can be muffled
	AudioServer.add_bus()
	world_bus = AudioServer.bus_count - 1
	AudioServer.set_bus_name(world_bus, "World")
	AudioServer.set_bus_send(world_bus, "Master")
	lowpass = AudioEffectLowPassFilter.new()
	lowpass.cutoff_hz = 20000.0
	AudioServer.add_bus_effect(world_bus, lowpass)
	# Many sounds stack in a fight. A limiter on the master bus rides the sum down instead of
	# letting it clip (the files themselves are mastered to a -2 dBFS ceiling: tools/audio/master.py).
	var lim := AudioEffectHardLimiter.new()
	lim.ceiling_db = -1.0
	lim.pre_gain_db = 0.0
	lim.release = 0.12
	AudioServer.add_bus_effect(0, lim)
	_play_music()
	var loaded := []
	for k in real:
		if real[k]:
			loaded.append(k)
	print("SFX: ", loaded.size(), " real recordings, ", real.size() - loaded.size(), " synthesised")
	if loaded.size() > 0:
		print("  real: ", loaded)
	for i in 26:
		var p := AudioStreamPlayer3D.new()
		p.bus = "World"
		p.unit_size = 34.0
		p.max_distance = 1300.0
		p.attenuation_model = AudioStreamPlayer3D.ATTENUATION_INVERSE_DISTANCE
		p.max_db = 4.0
		add_child(p)
		pool3d.append(p)
	for i in 8:
		var p := AudioStreamPlayer.new()
		add_child(p)
		pool2d.append(p)
	thr = _loop("thr_loop", -60.0)
	wind = _loop("wind_loop", -22.0)
	drone = _loop("drone_loop", -60.0)


func _loop(id: String, db: float) -> AudioStreamPlayer:
	var p := AudioStreamPlayer.new()
	p.stream = streams[id]
	p.volume_db = db
	add_child(p)
	p.play()
	return p


func _add(id: String, dur: float, layers: Array, loop: bool = false) -> void:
	var rr := _load_real(id)
	real[id] = rr != null
	var n := int(dur * SR)
	var buf := PackedFloat32Array()
	buf.resize(n)
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(id)
	for ly in layers:
		var type: String = ly[0]
		var gain: float = ly[1]
		var dec: float = ly[2]
		var a0: float = ly[3]
		var a1: float = ly[4]
		var hp: float = ly[5]
		var att: float = ly[6]
		var delay: int = int(float(ly[7]) * SR)
		var lp := 0.0
		var hl := 0.0
		var ph := 0.0
		var hpa := 1.0 - exp(-TAU * hp / SR)
		var ratio := a1 / a0
		for i in range(delay, n):
			var t := float(i - delay) / SR
			var u := float(i - delay) / float(n - delay)
			var env := exp(-t * dec)
			if att > 0.0:
				env *= minf(1.0, t / att)
			var y := 0.0
			if type == "n":
				var cut := a0 * pow(ratio, u)
				var a := 1.0 - exp(-TAU * cut / SR)
				lp += a * (rng.randf() * 2.0 - 1.0 - lp)
				y = lp
				if hp > 0.0:
					hl += hpa * (y - hl)
					y -= hl
				y *= 2.2
			else:
				ph += TAU * a0 * pow(ratio, u) / SR
				y = sin(ph)
				if type == "q":
					y = 1.0 if y > 0.0 else -1.0
			buf[i] += y * env * gain
	if loop:
		# crossfade tail into head for a seamless loop
		var xf := int(0.25 * SR)
		for i in xf:
			var k := float(i) / xf
			buf[i] = buf[i] * k + buf[n - xf + i] * (1.0 - k)
		n -= xf
	var data := PackedByteArray()
	data.resize(n * 2)
	for i in n:
		var v := clampf(buf[i], -1.5, 1.5)
		v = v / (1.0 + absf(v) * 0.4)
		data.encode_s16(i * 2, int(clampf(v, -1.0, 1.0) * 17000.0))  # level with the mastered recordings
	var st := AudioStreamWAV.new()
	st.format = AudioStreamWAV.FORMAT_16_BITS
	st.mix_rate = SR
	st.stereo = false
	st.data = data
	if loop:
		st.loop_mode = AudioStreamWAV.LOOP_FORWARD
		st.loop_begin = 0
		st.loop_end = n
	streams[id] = rr if rr != null else st


func play(id: String, pos: Vector3, vol: float = 1.0, pitch: float = 1.0) -> void:
	if muted or not streams.has(id):
		return
	var p := pool3d[i3]
	i3 = (i3 + 1) % pool3d.size()
	p.stream = streams[id]
	p.global_position = pos
	p.volume_db = minf(linear_to_db(maxf(vol, 0.001)), MAX_BOOST_DB)
	p.pitch_scale = pitch
	p.play()


# outside sound: vacuum carries nothing, so in space only what comes through the frame's own
# structure is heard (dull and quiet); the cockpit dulls it further
func set_outside(space: bool, cockpit: bool, dt: float) -> void:
	var cut := 20000.0
	var vol := 0.0
	if space:
		cut = 650.0 if cockpit else 1100.0
		vol = -9.0 if cockpit else -6.0
	elif cockpit:
		cut = 3200.0
		vol = -3.0
	var k := 1.0 - exp(-4.0 * dt)
	_cut = lerpf(_cut, cut, k)
	_vol = lerpf(_vol, vol, k)
	lowpass.cutoff_hz = _cut
	AudioServer.set_bus_volume_db(world_bus, _vol)


func play2d(id: String, vol: float = 1.0, pitch: float = 1.0) -> void:
	if muted or not streams.has(id):
		return
	var p := pool2d[i2]
	i2 = (i2 + 1) % pool2d.size()
	p.stream = streams[id]
	p.volume_db = minf(linear_to_db(maxf(vol, 0.001)), MAX_BOOST_DB)
	p.pitch_scale = pitch
	p.play()


func set_muted(v: bool) -> void:
	muted = v
	AudioServer.set_bus_mute(0, v)


func _play_music() -> void:
	for ext in [".ogg", ".wav"]:
		var path: String = AUDIO_DIR + "bgm_battle" + ext
		if not ResourceLoader.exists(path):
			continue
		var s: AudioStream = load(path)
		if s == null:
			continue
		if s is AudioStreamOggVorbis:
			s.loop = true
		elif s is AudioStreamWAV:
			s.loop_mode = AudioStreamWAV.LOOP_FORWARD
			s.loop_end = s.data.size() / 2
		music = AudioStreamPlayer.new()
		music.stream = s
		music.volume_db = -13.0
		add_child(music)
		music.play()
		print("SFX: bgm_battle.ogg playing")
		return
	print("SFX: no BGM file (audio/bgm_battle.ogg)")


func tick(dt: float, thrust_amt: float, combat: float) -> void:
	thr_v = lerpf(thr_v, thrust_amt, 1.0 - exp(-10.0 * dt))
	thr.volume_db = linear_to_db(maxf(thr_v * 0.5, 0.0001))
	thr.pitch_scale = 0.8 + thr_v * 0.4
	drone.volume_db = linear_to_db(maxf(combat * 0.22, 0.0001))



