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

## Characters: persistent logic, spatial body

The physical body lives in its place's World3D, but **gameplay identity,
ActionController, Inventory, cooldowns and long-running actions must remain
outside that physical body's subtree.** A Godot `reparent()` necessarily
causes `_exit_tree()` on the body subtree; our existing ActionController
cancels ongoing actions in `_exit_tree()`. Put it under a persistent game
actor instead. Example:

```text
GameActors (Node)                      # remains in exterior game tree
└── Citizen42 (Node)                   # persistent identity
    ├── ActionController (Node)
    └── Inventory (Node)

PlaceManager3D
└── Room_tavern_42_hall (SubViewport, own_world_3d)
    └── Hall (Node3D)
        └── PlaceActors (Node3D)
            └── Citizen42Body (CharacterBody3D)
                └── MovementAgent3D
```

Register the spatial body **after** it has entered the correct world:

```gdscript
places.register_physical_body(citizen_body, &"city")
```

The game owns the association between the persistent actor and the body;
this package does not implement character identity or duplicate gameplay
components. Physical bodies must never contain persistent ActionControllers.

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

The game must finish/stop the current movement goal before transferring;
a movement goal from the old World3D is not meaningful in the new one.
The persistent actor and all its running gameplay remain intact, but
a particular action may intentionally replace its movement segment after
the portal transition. Physics interpolation is reset on teleport.

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
there). The **outdoor** camera should be disabled for player input while an
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


## Scope of the first implementation

This package supplies independent, always-active room scene instances,
per-instance portals, room-graph routing and one texture-based interior view.
It does not yet automate multi-portal movement orders, spawn/configure actors,
save/load active worlds, synchronize cameras between exterior and interior,
or connect the ActionController to travel tasks. Those are game integrations or
separate milestones. The exact Godot runtime performance and physics behavior
must be checked in an actual Godot project before increasing the number of
active rooms.

## API

`PlaceManager3D`

- `register_exterior(id, root) -> bool`
- `create_room(place_id, building_id, PackedScene) -> bool`
- `get_place(id) -> PlaceInstance`
- `get_body_place(body) -> StringName`
- `register_physical_body(body, place_id) -> bool`
- `unregister_physical_body(body)`
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
`tools/deploy.py`. No autoload, manually assigned resource UID, or
interior-specific game rule is required.
