extends RefCounted
# Loads Blender-authored .glb part hierarchies from res://models and swaps their
# materials for the game's shaders. Mesh nodes are named "<joint>_m<KEY>".

static var _scenes := {}
static var _tpl := {}


static func has(name: String) -> bool:
	return ResourceLoader.exists("res://models/%s.glb" % name)


static func instance(name: String) -> Node3D:
	if not _scenes.has(name):
		if not has(name):
			return null
		_scenes[name] = load("res://models/%s.glb" % name)
	var ps: PackedScene = _scenes[name]
	if ps == null:
		return null
	return ps.instantiate() as Node3D


# a detached copy of one named sub-tree of a library file (e.g. one weapon out of equip.glb)
static func part(lib: String, item: String) -> Node3D:
	if not _tpl.has(lib):
		_tpl[lib] = instance(lib)
	var t: Node3D = _tpl[lib]
	if t == null:
		return null
	var src := t.find_child(item, true, false)
	if src == null:
		return null
	var n := src.duplicate() as Node3D
	n.transform = Transform3D.IDENTITY
	return n


static func free_templates() -> void:
	for k in _tpl:
		if _tpl[k] != null:
			_tpl[k].free()
	_tpl.clear()


static func key_of(mi: MeshInstance3D) -> String:
	var nm := String(mi.name)
	var i := nm.rfind("_m")
	if i >= 0 and i + 2 < nm.length():
		var k := nm.substr(i + 2).rstrip("0123456789_")
		if k != "":
			return k
	if mi.mesh != null and mi.mesh.get_surface_count() > 0:
		var m := mi.mesh.surface_get_material(0)
		if m != null:
			return m.resource_name
	return "A"


static func find(root: Node, name: String) -> Node3D:
	if root == null:
		return null
	if String(root.name) == name:
		return root as Node3D
	return root.find_child(name, true, false) as Node3D


# mats: key -> {"mat": Material, "params": {instance uniform: value}}
static func skin(root: Node, mats: Dictionary, layer: int = 1, out: Array = []) -> Array:
	var list: Array = root.find_children("*", "MeshInstance3D", true, false)
	if root is MeshInstance3D:
		list.append(root)
	for mi in list:
		var key := key_of(mi)
		if not mats.has(key):
			key = "A" if mats.has("A") else str(mats.keys()[0])
		var spec: Dictionary = mats[key]
		mi.material_override = spec["mat"]
		var params: Dictionary = spec.get("params", {})
		for k in params:
			mi.set_instance_shader_parameter(k, params[k])
		mi.set_meta("key", key)
		mi.layers = layer
		out.append(mi)
	return out
