# Place System

Independent 3D places with persistent actors, connected portals and cross-place travel.

## Places

`PlaceManager3D` registers an existing exterior `Node3D` or creates a room from a `PackedScene`. Each room gets a live `SubViewport` and its own `World3D`, navigation map and physics space. The same room template can be instantiated for different buildings.

A room scene can contain collision, a `NavigationRegion3D`, a `Camera3D` and named `PlacePortal3D` markers. Portal IDs must be unique within their place. Links are configured between instantiated places:

```gdscript
places.register_exterior(&"city", $Exterior)
places.create_room(&"bakery_interior", &"bakery_1", BAKERY_SCENE)
places.connect_portals(
    &"city", &"bakery_door",
    &"bakery_interior", &"entrance"
)
```

`connect_portals` supports an optional access predicate and initial enabled state. `set_portal_enabled` changes an existing connection. `remove_room` refuses rooms that are occupied, currently viewed or involved in a pending transfer.

## Persistent actors

`PlaceActor` stores a stable actor ID and `PlaceLocation` (place ID plus position), including when it has **no physical body**. The physical `CharacterBody3D` belongs to one place at a time. This is a world/placement concern, not a character's name, family or identity.

```gdscript
# An actor may exist before its physical body is instantiated.
var actor := PlaceActor.new()
actor.actor_id = &"citizen_1"
actor.set_location(PlaceLocation.new(&"city", Vector3(4, 0, 8)))
persistent_parent.add_child(actor)

# Later, after the body is placed in the correct world:
var place := places.get_place(&"city")
place.actors_root.add_child(body)
body.global_position = actor.get_place_position()
actor.bind_body(places, body, &"city")

# Before unloading the body, retain its actual location.
actor.unbind_body()
body.queue_free()
```

Use `get_location`, `get_place_id` and `get_place_position` with or without a body. `set_location` is available only when unbound, allowing the logical location to change without instantiating a body. `bind_body` checks that an existing logical place matches the physical body's place; unbinding snapshots its current position.

`PlaceActorSpawner.spawn(manager, persistent_parent, body_scene, actor_id, location)` is a convenience for creating one persistent actor **in code** and one physical body **from a PackedScene**. No actor scene is required.

## Portals and travel

`use_portal(body, portal_id)` validates the body's current place, interaction radius and access conditions. A successful crossing reparents the physical body into the destination place and updates its navigation map.

`PlaceTraveler`, attached to a `PlaceActor`, uses a child `MovementAgent3D` on the physical body to walk along a portal route:

- `travel_to(place_id, position) -> bool`
- `cancel()`
- `is_traveling() -> bool`

Signals: `travel_started`, `travel_arrived`, `travel_failed`, `travel_canceled`.

## Viewing interiors

`PlaceView` is a `TextureRect` configured with a `PlaceManager3D`. It displays the active room's viewport texture and forwards input. `view_place(place_id)` switches the displayed place. Room processing continues when another place is viewed.

## API

`PlaceManager3D`: `register_exterior`, `create_room`, `remove_room`, `get_place`, `get_viewed_place`, `get_body_place`, `register_physical_body`, `unregister_physical_body`, `get_actor_for_body`, `get_actor_by_id`, `cancel_pending_portal_transfer`, `connect_portals`, `set_portal_enabled`, `find_portal_route`, `use_portal`, `view_place`, `set_view_resolution`.

`PlaceActor`: `bind_body`, `unbind_body`, `is_bound`, `get_physical_body`, `get_place_manager`, `get_place_id`, `get_place_position`.

Manager signals: `place_registered`, `place_removed`, `place_view_changed`, `portal_traversed`, `portal_rejected`.

Rooms have independent physics and navigation maps. Use the package's portals to transfer characters between them.
