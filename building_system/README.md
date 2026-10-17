# Building System (Godot 4)

Persistent building identities, placements, game-defined properties, and installed upgrade levels.
No building kinds, game stats, recipes, effect engine, ownership, physics, rooms, inventory, AI or UI.

## Design

- `Building` (RefCounted) exposes read-only accessors for its stable identity, type ID, place ID, Transform3D, properties and upgrade levels.
- `BuildingRegistry` (Node) is the sole supported mutation surface. Registry stores a detached copy of each registered building and getters return detached copies; modifying one never changes the registry. IDs are unique; IDs, type IDs and place IDs must be nonempty.
- `type_id`, property IDs and upgrade IDs originate in the game. The registry never defines them.
- Properties are persistent **base state**, not computed stats. Keys must be StringNames. Values must be data-only Godot Variants (scalars, basic vectors/colors, arrays or dictionaries), with no Object/Resource/Callable references. An existing property's type cannot silently change.
- Optional `property_validator(building, property_id, value)`, `upgrade_validator(building, upgrade_id, level)` and `type_validator(building, type_id)` callbacks allow the game to enforce its schema/rules. Treat these as **pure validators**, not side-effecting commands.
- Upgrades are stored as `upgrade_id -> positive level`; setting level 0 removes an upgrade. Price, maximum level, prerequisites, stat effects, workstation/room unlocks, etc. remain exclusively in the game. The registry emits change notifications but **never applies an effect**.
- `place_id` and `Transform3D` record logical placement. No 3D scene reference is saved or owned.
- OwnershipRegistry keeps its own building owner records. Removing a building from this registry does not remove its ownership, inventories, characters or places: the game must coordinate removal and failure handling.

## Example

```gdscript
var registry: BuildingRegistry = $BuildingRegistry
var building := Building.new(&"tavern_42", &"tavern", &"city", Transform3D.IDENTITY,
    {&"condition": 1.0})
assert(registry.register_building(building))
assert(registry.set_upgrade_level(&"tavern_42", &"larger_storage", 2))
assert(registry.set_property_value(&"tavern_42", &"condition", 0.85))
assert(registry.get_building(&"tavern_42").get_upgrade_level(&"larger_storage") == 2)

# The *game* computes effective stats from content definitions and installed upgrades.
# The *game* then reconciles Inventory / Place / Production with those outcomes.
```

## Public API

- `register_building(building) -> bool`, `unregister_building(id) -> bool`
- `get_building(id) -> Building`, `has_building(id) -> bool`, `get_buildings() -> Array[Building]`
- `set_type(id, type_id) -> bool`, `set_placement(id, place_id, transform) -> bool`
- `set_property_value(id, key, value) -> bool`, `erase_property(id, key) -> bool`
- `set_upgrade_level(id, upgrade_id, level) -> bool`
- `export_state() -> Dictionary`, `restore_state(snapshot) -> bool`

`Building` getters: `get_id`, `get_type_id`, `get_place_id`, `get_transform`, `has_property`, `get_property_value`, `get_properties`, `has_upgrade`, `get_upgrade_level`, `get_upgrades`, `to_snapshot`.

Signals: `building_registered`, `building_removed`, `building_type_changed`, `building_placement_changed`, `building_property_changed`, `building_upgrade_changed`, `state_restored`.

Mutation failures leave the registry unchanged. Duplicate/no-op changes do not emit change signals.

## Persistence / loading

`export_state()` returns a versioned, data-only snapshot of all registered buildings. `restore_state()` validates the entire snapshot and then replaces the registry in one step, emitting only `state_restored`. Do not apply game effects in response to incremental registration while loading.

The game must resolve type/upgrade definitions, migrate obsolete IDs and reconcile derived effects **after** loading the relevant systems. Reconciliation must be idempotent; e.g. rebuilding desired workstation IDs rather than adding duplicate workstations on each load. Do not store computed upgrade buffs in building properties.

## Deployment

Add `"building_system": "BuildingSystem"` to the game project's package manifest and use `tools/deploy.py`. No autoload is required.
