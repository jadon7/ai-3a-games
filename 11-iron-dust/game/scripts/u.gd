extends RefCounted

static func ang_diff(a: float, b: float) -> float:
	return wrapf(b - a, -PI, PI)


static func turn_to(cur: float, tgt: float, max_step: float) -> float:
	return cur + clampf(wrapf(tgt - cur, -PI, PI), -max_step, max_step)


static func damp(a: float, b: float, k: float, dt: float) -> float:
	return lerpf(a, b, 1.0 - exp(-k * dt))


static func yaw_of(dir: Vector3) -> float:
	return atan2(-dir.x, -dir.z)


static func fwd(yaw: float) -> Vector3:
	return Vector3(-sin(yaw), 0.0, -cos(yaw))
