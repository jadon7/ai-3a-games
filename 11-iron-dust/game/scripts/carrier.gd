extends Node3D
# The enemy orbital landing ship: descends through the haze, hovers on four engines
# (each a destroyable unit), releases drop pods, and crashes once the engines are gone.

const Glb = preload("res://scripts/glb_kit.gd")
const MeshKit = preload("res://scripts/mesh_kit.gd")
const Tex = preload("res://scripts/tex.gd")
const FX = preload("res://scripts/fx.gd")
const ShipPart = preload("res://scripts/ship_part.gd")

var game
var root: Node3D
var meshes: Array = []
var glow: StandardMaterial3D
var engines: Array = []
var hover: Array = []
var bays: Array = []
var hold := Vector3.ZERO
var from := Vector3.ZERO
var mode := "descend"      # descend / hold / fall / crashed
var t := 0.0
var descend_time := 110.0
var sink := 1.0
var land_y := 150.0
var vel := Vector3.ZERO
var tilt := Vector3.ZERO
var tilt_v := Vector3.ZERO
var fx_t := 0.0
var boom_t := 0.0
var half := Vector3(85, 45, 230)
var body: StaticBody3D


func setup(g, start: Vector3, hold_pos: Vector3) -> void:
	game = g
	from = start
	hold = hold_pos
	glow = StandardMaterial3D.new()
	glow.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	glow.albedo_color = Color(1.0, 0.5, 0.2) * 2.2
	var am := Tex.plating
	var mats := {
		"A": {"mat": am, "params": {"tint": Color(0.33, 0.31, 0.3), "metal": 0.4, "wear": 1.2}},
		"B": {"mat": am, "params": {"tint": Color(0.17, 0.17, 0.18), "metal": 0.45, "wear": 1.2}},
		"C": {"mat": am, "params": {"tint": Color(0.42, 0.12, 0.08), "metal": 0.3}},
		"F": {"mat": am, "params": {"tint": Color(0.07, 0.072, 0.078), "metal": 0.7}},
		"W": {"mat": am, "params": {"tint": Color(0.06, 0.065, 0.07), "metal": 0.75}},
		"T": {"mat": am, "params": {"tint": Color(0.012, 0.012, 0.014), "metal": 0.4, "wear": 0.4}},
		"H": {"mat": am, "params": {"tint": Color(0.7, 0.5, 0.06), "metal": 0.2, "stripes": 1.0}},
		"G": {"mat": glow},
	}
	root = Glb.instance("carrier")
	var enodes: Array = []
	if root != null:
		add_child(root)
		Glb.skin(root, mats, 2, meshes)
		for i in range(1, 5):
			var e := Glb.find(root, "engine_%d" % i)
			if e != null:
				enodes.append([e, Glb.find(root, "noz_engine_%d" % i)])
		for i in range(1, 7):
			var hn := Glb.find(root, "noz_%d" % i)
			if hn != null:
				hover.append({"n": hn, "pm": FX.plume(hn, 9.0, 44.0, 2)})
		for i in range(1, 5):
			var b := Glb.find(root, "bay_%d" % i)
			if b != null:
				bays.append(b)
	if enodes.size() < 4:
		if root != null:
			root.queue_free()
			meshes.clear()
			hover.clear()
			bays.clear()
		enodes = _build_proc(mats)
	for m in meshes:
		m.extra_cull_margin = 400.0
	# size from the meshes so the hull collider fits whatever model is loaded
	var box := AABB()
	var first := true
	for m in meshes:
		var mi: MeshInstance3D = m
		var bb: AABB = mi.global_transform * mi.mesh.get_aabb() if is_inside_tree() else mi.mesh.get_aabb()
		box = bb if first else box.merge(bb)
		first = false
	global_position = start
	if not first:
		half = box.size * 0.5
	var ey := 0.0
	for en in enodes:
		ey = minf(ey, (en[0] as Node3D).global_position.y - global_position.y)
	body = StaticBody3D.new()
	body.collision_layer = 1
	body.collision_mask = 0
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	var bottom := maxf(ey + 30.0, -half.y)
	bs.size = Vector3(half.x * 1.7, half.y - bottom, half.z * 1.8)
	cs.shape = bs
	cs.position = Vector3(0, (half.y + bottom) * 0.5, 0)
	body.add_child(cs)
	add_child(body)
	var idx := 0
	for en in enodes:
		idx += 1
		var sp = ShipPart.new()
		game.add_unit(sp)
		sp.setup(game, en[0], en[1], idx)
		for c in (en[0] as Node3D).find_children("*", "MeshInstance3D", true, false):
			if c.material_override != FX._pl_mat:
				sp.meshes.append(c)
		engines.append(sp)
	game._rebuild_rids()


func _build_proc(mats: Dictionary) -> Array:
	root = Node3D.new()
	add_child(root)
	var k := MeshKit.new(7)
	k.dust = 0.1
	var b := k.bone(root)
	k.box(b, "A", Vector3(150, 60, 440), Vector3(0, 0, 0), Vector3.ZERO, {"tx": 0.7, "tz": 0.9, "bx": 0.85, "bz": 0.92})
	k.box(b, "B", Vector3(170, 22, 300), Vector3(0, -20, 10), Vector3.ZERO, {"bx": 0.8})
	k.box(b, "T", Vector3(120, 4, 380), Vector3(0, -32, 0))
	k.box(b, "A", Vector3(60, 36, 70), Vector3(0, 46, 120), Vector3.ZERO, {"tx": 0.6, "tz": 0.6})
	k.box(b, "G", Vector3(40, 3, 2), Vector3(0, 52, 84.5))
	for s in [-1.0, 1.0]:
		k.box(b, "B", Vector3(26, 30, 260), Vector3(s * 82, -4, 0), Vector3.ZERO, {"tz": 0.85})
		k.box(b, "G", Vector3(1, 2, 180), Vector3(s * 95.3, 2, 0))
	var out := []
	var i := 0
	for e in [[-70.0, -170.0], [70.0, -170.0], [-70.0, 170.0], [70.0, 170.0]]:
		i += 1
		var en := k.bone(root, Vector3(e[0], -44, e[1]))
		en.name = "engine_%d" % i
		k.cyl(en, "F", 24.0, 22.0, 26.0, Vector3(0, 4, 0), Vector3.ZERO, 14)
		k.cyl(en, "T", 16.0, 22.0, 10.0, Vector3(0, -12, 0), Vector3.ZERO, 14)
		k.cyl(en, "H", 24.6, 24.6, 2.0, Vector3(0, 12, 0), Vector3.ZERO, 14)
		var nz := Node3D.new()
		nz.position = Vector3(0, -17, 0)
		en.add_child(nz)
		out.append([en, nz])
		var bn := Node3D.new()
		bn.position = Vector3(e[0] * 0.4, -36, e[1] * 0.5)
		root.add_child(bn)
		bays.append(bn)
	for m in k.bake(mats):
		m.layers = 2
		meshes.append(m)
	return out


func alive_engines() -> int:
	var n := 0
	for e in engines:
		if e.alive:
			n += 1
	return n


func altitude() -> float:
	return global_position.y - game.world.height(global_position.x, global_position.z)


func bay_pos() -> Vector3:
	if bays.is_empty():
		return global_position + Vector3(randf_range(-40, 40), -half.y, randf_range(-120, 120))
	return (bays[randi() % bays.size()] as Node3D).global_position


func arm(on: bool) -> void:
	for e in engines:
		e.armed = on


func tick(dt: float) -> void:
	t += dt
	var n := alive_engines()
	if mode == "descend":
		var k := clampf(t / descend_time, 0.0, 1.0)
		var e := 1.0 - pow(1.0 - k, 2.2)
		global_position = from.lerp(hold, e)
		if k >= 1.0:
			mode = "hold"
	elif mode == "hold":
		# steady sink toward the landing altitude; four dead engines means free fall
		var rate := sink
		global_position += Vector3(0, -rate * dt, 0)
		tilt_v = tilt_v.lerp(Vector3(sin(t * 0.21) * 0.012, 0, sin(t * 0.17) * 0.02 + (4 - n) * 0.02), dt)
		tilt = tilt_v
		if n == 0:
			mode = "fall"
			t = 0.0
			vel = Vector3(0, -3.0, -5.0)
	elif mode == "fall":
		vel.y -= 8.0 * dt
		global_position += vel * dt
		tilt += Vector3(0.05, 0.0, 0.07) * dt
		boom_t -= dt
		if boom_t <= 0.0:
			boom_t = randf_range(0.12, 0.3)
			var p := global_position + Vector3(randf_range(-half.x, half.x), randf_range(-half.y, half.y * 0.5), randf_range(-half.z, half.z))
			game.fx.explosion(p, randf_range(1.8, 2.5))
			if randf() < 0.4:
				game.sfx.play2d("explosion", randf_range(0.2, 0.45), randf_range(0.5, 0.8))
				game.shake(0.12)
		var gy: float = game.world.height(global_position.x, global_position.z)
		if global_position.y - half.y * 0.6 <= gy:
			mode = "crashed"
			t = 0.0
			game.sfx.play2d("bigboom", 1.0)
			game.shake(1.0)
			for i in 26:
				var p := global_position + Vector3(randf_range(-half.x, half.x) * 1.4, randf_range(-half.y, 10.0), randf_range(-half.z, half.z) * 1.1)
				p.y = maxf(p.y, game.world.height(p.x, p.z) + 4.0)
				game.fx.explosion(p, 2.5)
			game.fx.flash(global_position, 400.0, 1.6)
	elif mode == "crashed":
		boom_t -= dt
		if boom_t <= 0.0 and t < 12.0:
			boom_t = randf_range(0.2, 0.5)
			var p := global_position + Vector3(randf_range(-half.x, half.x) * 1.3, 0, randf_range(-half.z, half.z))
			p.y = game.world.height(p.x, p.z) + randf_range(4.0, 40.0)
			game.fx.explosion(p, randf_range(1.5, 2.5))
			game.shake(0.2)
	root.rotation = tilt
	# hover nozzles + heat wash
	var pw := 1.0 if (mode == "descend" or mode == "hold") else 0.0
	for h in hover:
		FX.set_plume(h["pm"], 9.0, 44.0 * pw * randf_range(0.9, 1.1), 0.3 * pw)
	for e in engines:
		e.power = 1.0 + (4 - n) * 0.25
	if mode == "hold" or mode == "descend":
		fx_t -= dt
		if fx_t <= 0.0:
			fx_t = 0.12
			var p := global_position + Vector3(randf_range(-half.x, half.x), -half.y - randf_range(20.0, 90.0), randf_range(-half.z, half.z))
			game.fx.emit("haze", p, Vector3(randf_range(-10, 10), randf_range(-30, -12), randf_range(-10, 10)))
