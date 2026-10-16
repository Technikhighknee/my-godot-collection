# Place System (Godot 4)

Continuous, **fully active** independent 3D worlds for interiors, with shared
room templates, per-building room graphs and portal transitions. Exterior
places can be registered from existing world scenes.

**Not** an unloaded-room simulation, interior-specific AI, movement simulator
or renderer. A room does not stop processing because it is not being viewed.

## Model

- **Place ID:** every room instance has a unique `StringName`, e.g.
  `&"tavern_42_hall"` vs. `&"tavern_78_hall"`.
- **Building ID:** optional owner grouping, supplied by the game.
- **Template:** a reusable `PackedScene` with geometry, static navigation,
  collision, optional scripts and named `PlacePortal3D` marker nodes.
- **Runtime:** every room instance is a live SubViewport using its *own*
  `World3D` (physics space, navigation map, scenario). All room nodes,
  physics and gameplay continue running independently of whether anyone
  is watching. Meshes/materials/resources are shared by Godot when the
  same `PackedScene` is instantiated repeatedly; physics state is not shared.
- **Presentation:** only the viewed room's render target is updated; a
  `PlaceView` may display that viewport's texture. Looking elsewhere
  never recreates, reparents, pauses or resets the room.

An interior can contain **multiple independently instantiated room scenes**.
The building entrance links to its entrance room; portals inside link to
other rooms. A kitchen or cellar added by an upgrade is another place in
the building's graph, not an override of the entrance scene.

## Layout authoring

Each room is a `Node3D` scene, e.g.:

```text
Hall (Node3D)                    # reusable Hall.tscn
├── StaticBody3D / geometry
├── NavigationRegion3D          # baked NavMesh in this layout
├── Camera3D                     # required to render this room in PlaceView
├── DoorOutside (PlacePortal3D)   portal_id = "outside"
└── DoorKitchen (PlacePortal3D)   portal_id = "kitchen"
```

Give every portal in one scene a **unique, nonempty** `portal_id`. Its
transform marks the arrival position and orientation; place it safely
inside the reachable navigation area, not embedded in a wall.

No destination, building ID, role, progression state or upgrade tier is
hardcoded into the scene template. The game binds those per instance.

## Registering worlds and their connections

Put the manager in the scene tree as a sibling of the exterior, **not**
inside a reusable room template:

```text
Game (Node)
├── Exterior (Node3D)               # existing normal world
├── PlaceManager3D (Node)            # creates live room viewports
└── UI
    └── PlaceView (TextureRect)     # optional, above exterior rendering
```

In game code:

```gdscript
@onready var places: PlaceManager3D = $PlaceManager3D
const HALL = preload("res://scenes/Hall.tscn")
const KITCHEN = preload("res://scenes/Kitchen.tscn")

func _ready() -> void:
    places.register_exterior(&"city", $Exterior)
    places.create_room(&"tavern_42_hall", &"tavern_42", HALL)
    places.create_room(&"tavern_42_kitchen", &"tavern_42", KITCHEN)

    # Each link is bidirectional. Per-instance access is game-owned:
    places.connect_portals(
        &"city", &"tavern_42_front",
        &"tavern_42_hall", &"outside"
    )
    places.connect_portals(
        &"tavern_42_hall", &"kitchen",
        &"tavern_42_kitchen", &"hall",
        func(_body: Node3D) -> bool:
            return tavern_42_has_kitchen_upgrade
    )
```

The exterior needs a `PlacePortal3D` marker with ID
`tavern_42_front`; the hall needs `outside`, the kitchen needs
`hall`. Another tavern can instantiate the **same** Hall.tscn with
different place IDs and links, while retaining completely independent
characters and physics state.

Upgrade rules live in the game. The game may add new rooms and connect
their portals upon an upgrade, or call
`set_portal_enabled(place_id, portal_id, enabled)` to open an existing
connection. Optional access callbacks are rechecked at traversal time.

## Persistent actors and cross-place travel

`PlaceActor` is a stable gameplay node that remains in the ordinary game
scene tree. It owns the game's `ActionController`, `Inventory`, AI and
any other persistent gameplay components.

Its physical `CharacterBody3D` lives in exactly one place at a time and
is **not** the parent of any persistent gameplay components. Only the body
is reparented during transitions. A character is not cloned, recreated,
or assigned a new identity on entering a room.

```text
GameActors (Node)
└── Citizen42 (PlaceActor)
    ├── ActionController (Node)
    ├── Inventory (Node)
    └── PlaceTraveler (Node)

PlaceManager3D (Node)
└── Room_tavern_42_hall (SubViewport; own_world_3d)
    └── Hall (Node3D)
        └── PlaceActors (Node3D)
            └── Citizen42Body (CharacterBody3D)
                └── MovementAgent3D (NavigationAgent3D)
```

Create/spawn the physical body in the target place **first**, then bind:

```gdscript
var place := places.get_place(&"tavern_42_hall")
var body := BODY_SCENE.instantiate() as CharacterBody3D
place.actors_root.add_child(body)
body.global_position = Vector3(3, 0, 2)

var actor := PlaceActor.new()
actor.actor_id = &"citizen_42"
$GameActors.add_child(actor)

var traveler := PlaceTraveler.new()
actor.add_child(traveler)
assert(actor.bind_body(places, body, &"tavern_42_hall"))
```

Attach `ActionController` and `Inventory` to the persistent actor,
not the physical body. Each bound actor needs a **unique, nonempty**
`actor_id`. The manager maintains both body-to-actor and ID-to-actor
lookups, independent of the room the character occupies.

`PlaceActor` exposes:

- `bind_body(manager, body, place_id) -> bool` (once per binding)
- `unbind_body()` (call before deliberately freeing the physical body)
- `is_bound() -> bool`
- `get_physical_body() -> CharacterBody3D`
- `get_place_manager() -> PlaceManager3D`
- `get_place_id() -> StringName`
- `get_place_position() -> Vector3` (position *within* that place)

Signals: `body_bound(body, place_id)`, `body_unbound()`,
`place_changed(from_place, to_place)`.

The actor's identity and the physical body remain the same across portal
transitions. The place ID changes; the gameplay nodes never leave the tree,
so ongoing actions, cooldowns and inventories continue normally.

SelectionSystem sees physical `Node3D` subjects. Resolve the persistent
gameplay actor when handling selection and targeting:

```gdscript
var selected_actor := places.get_actor_for_body(selected_body) as PlaceActor
if selected_actor != null:
    var actions: ActionController = selected_actor.get_node("ActionController")
```

That association survives portal transfers without maintaining a separate
mapping per room. Unbinding removes the association.

### Travel over multiple rooms

`PlaceTraveler` is an **optional** persistent child of `PlaceActor`.
It connects our existing `MovementAgent3D` to the portal graph:

```gdscript
var traveler: PlaceTraveler = actor.get_node("PlaceTraveler")
traveler.travel_to(&"tavern_42_kitchen", Vector3(5, 0, 4))
```

It follows the portal route one room at a time, walking to each doorway
using the existing MovementAgent3D, transferring the same body into the
next World3D, and finally walking to the requested destination position.

`travel_to(place_id, position) -> bool` returns whether the journey
started. `cancel()` interrupts it. `is_traveling()` indicates a live
journey. Signals:

- `travel_started(place_id, position)`
- `travel_arrived(place_id, position)`
- `travel_failed(reason)`
- `travel_canceled()`

Failure reasons include `no_portal_route`, `portal_unavailable`,
`missing_movement_agent`, `movement_interrupted`, and native reasons
from `MovementAgent3D` such as `unreachable` or `stuck`.

Call `traveler.travel_to()` for ordinary movement orders; neither a UI
right-click nor an NPC travel command needs an `ActionExecution`.
A traveler's destination is a **place ID plus a position**; a plain
`Vector3` does not identify a room. Gameplay actions may call the
traveler as a subordinate step, but the traveler is not an Action.

MovementAgent3D may also be used directly for movement **within the
current place**. Its agent navigation map is initialized on registration
and explicitly reassigned after each portal transfer, using Godot's
`NavigationAgent3D.set_navigation_map()`. The portal transition itself
does not wipe persistent ActionController state or inventory contents.

The physical body must be registered in the correct viewport before
binding. Do not put another persistent Actor/ActionController under it,
and do not reparent it between places behind PlaceManager3D's back.

## Spawning persistent actors

`PlaceLocation` represents a validated destination: unique `place_id`
and a `position` in that place's own World3D coordinates. It is **not**
relative to the `Node3D` room root unless that root is at the origin.
For the exterior, the position uses the exterior world's coordinates.

`PlaceActorSpawner.spawn()` creates both the **persistent** actor from a
game-provided PackedScene and its **physical** CharacterBody3D from another
game-provided PackedScene. It places the body inside the requested active
world and binds them, or returns `null` if validation fails. No character
types, item values or buildings are hardcoded.

```gdscript
var location := PlaceLocation.new(&"tavern_42_hall", Vector3(3, 0, 2))
var actor: PlaceActor = PlaceActorSpawner.spawn(
    places, $GameActors,
    preload("res://scenes/CitizenLogic.tscn"),
    preload("res://scenes/CitizenBody.tscn"),
    &"citizen_42", location
)
if actor == null:
    push_error("Could not spawn citizen")
```

`CitizenLogic.tscn` must have a `PlaceActor` root, typically containing
`ActionController`, `Inventory` and `PlaceTraveler`. The `CitizenBody`
scene must have a `CharacterBody3D` root and (for walking) a direct-child
`MovementAgent3D`. Both scene choices and all numeric values belong to
the game.

The same actor instance keeps its Actions, cooldowns and inventories after
crossing every portal. The manager provides
`get_actor_by_id(&"citizen_42")` and
`get_actor_for_body(selected_physical_body)`.

### Interaction with gameplay actions

Movement and travel are **not Actions**. PlaceTraveler has its own lifecycle
and may be commanded directly by the player, AI, or game logic.

A gameplay Action that requires the character to reach a workstation may
use PlaceTraveler to reach it, wait for `travel_arrived`, and then execute
the actual gameplay work. That ActionExecution is owned by the gameplay
ActionController and lasts until that work completes. If the Action is
canceled, its executor should cancel any outstanding travel and disconnect
its listeners. The Place System itself never registers a travel measure.

`PlaceLocation` is a place-aware movement destination and is also used
when spawning actors; it is not an Action target kind.

## Portal traversal

A character approaches a portal using the **existing** MovementAgent3D.
When the actor reaches it, game code calls:

```gdscript
places.use_portal(citizen_body, &"tavern_42_front")
```

The manager verifies that the body belongs to the source place, is within
the portal's `interaction_radius`, and is permitted to traverse. The
transition is deferred out of the physics callback, then moves the **body
only** to the destination's PlaceActors container and places it at the
destination portal. It emits `portal_traversed(body, from_id, to_id)`.
Invalid/locked/distant attempts emit `portal_rejected`.

The manager stops any previous local movement goal, reparents the **body
only**, assigns the destination NavigationServer map to NavigationAgent3D
children, and resets velocity and physics interpolation on teleport.
The persistent actor and its running gameplay stay intact. PlaceTraveler
automatically starts the next movement leg after the portal transition.

`find_portal_route(from_place, to_place, body)` finds a route of **door
transitions** through currently accessible places. It deliberately does not
replace per-place movement pathfinding or perform the travel itself.

## Interior display

Add `PlaceView.gd` to a TextureRect covering the viewport (e.g. full
rect anchors) and select the `PlaceManager3D` in the Inspector. Then:

```gdscript
places.view_place(&"tavern_42_hall")
places.view_place(&"tavern_42_kitchen")
places.view_place(&"city") # hides the overlay, shows normal exterior
```

The UI surface forwards mouse/keyboard input to the currently viewed
SubViewport (including the existing SelectionSystem and camera if placed
there). Use the exported `place_manager` Node reference in the Inspector.

The **outdoor** camera should be disabled for player input while an
interior is viewed, because global `Input.is_action_pressed()` polling
does not respect an input-consuming overlay. Camera state management and
cross-place selection are game integrations, not included here.

On every view switch, only the target viewport's render update changes.
`_physics_process`, Actions, timers, AI and collisions in every room
remain active. Rooms are not `hide()`n or unloaded.

## Important boundaries

- There is **no simulation LOD**, reduced background AI, fake movement,
  event replay, alternate inventory or interior-specific ActionController.
- This **does not make hundreds of physics worlds free**. It trades
  simplicity/correctness for RAM and CPU costs and must be profiled at scale.
- Room layouts are normal 3D scenes. If the game wants ongoing activity,
  those actors and systems must actually be added to the relevant world.
- Godot's different World3Ds do not collide or pathfind across one another.
  Portals are explicit scene-world transitions, not NavigationLinks.
- Only one interior texture is displayed at a time by PlaceView initially.
  Future multiple views can display multiple room viewports independently.


## Functional validation

The Godot smoke test passed on October 16, 2026, and manual testing confirmed
independent room instances, background gameplay processing, viewport switching
and actor travel in the tested two-building setup. The temporary test project
was removed after validation. This establishes the tested functionality,
not performance at scale or save/load behavior.

## Scope of the first implementation

This package supplies independent, always-active room scene instances,
per-instance portals, multi-portal travel via MovementAgent3D, actor spawning,
and a texture-based interior view.
It does not yet save/load active worlds, automatically manage game-specific
character attributes, or synchronize cameras between exterior and interior.
Those remain game integrations or separate milestones.

The exact Godot runtime performance and physics behavior must be checked in
a Godot project before increasing the number of active rooms.

## API

`PlaceActor` and `PlaceTraveler` are described above; they are persistent
character-side nodes, not components of an instanced room layout.


`PlaceManager3D`

- `register_exterior(id, root) -> bool`
- `create_room(place_id, building_id, PackedScene) -> bool`
- `get_place(id) -> PlaceInstance`
- `get_body_place(body) -> StringName`
- `get_actor_for_body(body) -> Node` (persistent actor or null)
- `get_actor_by_id(id) -> Node` (persistent actor or null)
- `register_physical_body(body, place_id) -> bool`
- `unregister_physical_body(body)`
- `cancel_pending_portal_transfer(body) -> bool`
- `connect_portals(place_a, portal_a, place_b, portal_b, allowed=Callable(), enabled=true) -> bool`
- `set_portal_enabled(place_id, portal_id, enabled) -> bool`
- `find_portal_route(from_place, to_place, body) -> Array[Dictionary]`
- `use_portal(body, portal_id) -> bool`
- `view_place(id) -> bool`
- `set_view_resolution(Vector2i)`

`PlaceInstance`: `id`, `building_id`, `root`, `actors_root`,
`viewport`, `get_portal(id)`, `get_navigation_map()`.

Signals: `place_registered(id)`, `place_view_changed(id)`,
`portal_traversed(body, from_id, to_id)`,
`portal_rejected(body, place_id, portal_id)`.

## Deployment

Add `"place_system": "PlaceSystem"` to the game manifest and run
`tools/deploy.py`. The Place System does not require the Action System.
No autoload or manually assigned resource UID is required.
