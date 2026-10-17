# Building System

Persistent building records with IDs, types, placements, properties and upgrade levels.

`Building` is a value record; `BuildingRegistry` handles registration and updates. Registrations and queries use detached copies.

## Usage

```gdscript
var building := Building.new(&"bakery_1", &"bakery", &"city", Transform3D.IDENTITY)
registry.register_building(building)
registry.set_property_value(&"bakery_1", &"condition", 0.85)
registry.set_upgrade_level(&"bakery_1", &"storage", 2)
```

- IDs, type IDs and place IDs must be nonempty.
- Property keys use `StringName`. Values must be persistable Godot data; an existing property's type stays consistent.
- Upgrade levels are positive integers; setting a level to `0` removes it.
- Optional `type_validator`, `property_validator` and `upgrade_validator` Callables validate proposed changes.
- `place_id` and `Transform3D` record placement. Building scenes and upgrade effects can be resolved from this state.

## API

`register_building`, `unregister_building`, `get_building`, `get_buildings`, `has_building`, `set_type`, `set_placement`, `set_property_value`, `erase_property`, `set_upgrade_level`, `export_state`, `restore_state`.

Signals: `building_registered`, `building_removed`, `building_type_changed`, `building_placement_changed`, `building_property_changed`, `building_upgrade_changed`, `state_restored`.

Snapshots are versioned. Restore validates the complete snapshot before replacing registered state and emits `state_restored`.
