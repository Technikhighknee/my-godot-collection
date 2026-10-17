# Ownership System

Ownership records for buildings, including the person assigned to represent a dynasty-owned building.

## Ownership types

- `OwnershipRegistry.OwnerType.NONE`: unowned.
- `OwnershipRegistry.OwnerType.DYNASTY`: a registered dynasty, with an optional assigned member.
- `OwnershipRegistry.OwnerType.CITY`: a city identified by its ID.

Configure `OwnershipRegistry` with an existing `DynastyRegistry`:

```gdscript
ownership.configure(dynasties)
ownership.set_building_owner(
    &"bakery_1", OwnershipRegistry.OwnerType.DYNASTY,
    &"hansen", &"citizen_1"
)
ownership.assign_character(&"bakery_1", &"citizen_2")
```

A dynasty assignee must be a member of the owning dynasty. If that character leaves, the assignment is cleared while the ownership record remains. A city owner has a city ID and no assignee. Setting `NONE` clears ownership.

`get_owned_buildings(type, owner_id)` returns matching building IDs. The building IDs and city IDs are supplied by the caller.

## API

`configure`, `set_building_owner`, `assign_character`, `get_owner_type`, `get_owner_id`, `get_assigned_character_id`, `get_owned_buildings`.

Signals: `ownership_changed(building_id, old_type, old_owner_id, new_type, new_owner_id)`, `assigned_character_changed(building_id, old_character_id, new_character_id)`.
