extends CharacterBody3D
# Base for anything that can be shot: frames, turrets, tanks, aircraft, ship parts.

var game
var team := 0
var alive := true
var ap := 1.0
var ap_max := 1.0
var unit_name := ""
var callsign := ""
var kind := "mech"
var hit_h := 17.0
var radius := 3.0
var airborne := false
var hidden := false
var objective := false
var impact := 0.0
var poise := 100.0
var state := "normal"
var last_hit_by = null
var alert_t := 0.0
var is_player := false
var ai = null
# shared fire-control fields used by weapons
var c_lock = null
var c_lock_t := 0.0
var c_aim_point := Vector3.ZERO
var spread_mul := 1.0
var lead_k := 1.0
var dmg_mul := 1.0
var od_dmg := 1.0
# weak-point scan: while mark_t > 0 every hit on this unit is multiplied by mark_mul
var mark_t := 0.0
var mark_mul := 1.0


func vuln() -> float:
	return mark_mul if mark_t > 0.0 else 1.0


func center() -> Vector3:
	return global_position + Vector3(0, hit_h * 0.55, 0)


func muzzle(_mount: String) -> Vector3:
	return center()


func aim_dir() -> Vector3:
	return Vector3.FORWARD


func on_fired(_d: Dictionary, _mount: String = "M", _power: float = 1.0) -> void:
	pass


func fire_hook(_d: Dictionary, _from: Vector3, _dir: Vector3) -> void:
	pass


func take_damage(_dmg: float, _imp: float, _from, _how: String, _pos: Vector3) -> void:
	pass


func tick(_dt: float) -> void:
	pass
