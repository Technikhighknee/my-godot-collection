class_name StrategyCameraGroundTracker
extends Node

# A failed probe returns NAN and retains the last valid ground reference.
func sample_ground_height(
	world: World3D, focus: Vector3, collision_mask: int,
	probe_up: float, probe_down: float
) -> float:
	if world == null:
		return NAN
	var from := focus + Vector3.UP * probe_up
	var to := focus - Vector3.UP * probe_down
	var query := PhysicsRayQueryParameters3D.create(from, to, collision_mask)
	var hit := world.direct_space_state.intersect_ray(query)
	if hit.is_empty():
		return NAN
	return (hit["position"] as Vector3).y
