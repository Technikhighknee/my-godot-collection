# Ownership System (Godot 4)

Small ownership registry for buildings. It records **economic ownership** and,
for dynasty-owned buildings, a separate **character assignment**. It neither
implements buildings nor ownership rules for inventory items.

## Owner types

- `OwnershipRegistry.OwnerType.DYNASTY` — a registered dynasty owns the
  building. A character from that dynasty is assigned as the in-game
  displayed owner.
- `OwnershipRegistry.OwnerType.CITY` — a city owns the building. The
  city ID is supplied by the game; no City System is required yet.
- `OwnershipRegistry.OwnerType.NONE` — the building is unowned.

`NONE` is **absence of an owner**, not a separate city, person or entity.
The game owns the building list; looking up an unknown building returns NONE.

## Setup

Add an `OwnershipRegistry` node and configure it using the existing
`DynastyRegistry` before using it. That registry must already be configured
and contain the referenced dynasty and character members.

```gdscript
var ownership: OwnershipRegistry = $OwnershipRegistry
ownership.configure($DynastyRegistry)

ownership.set_building_owner(
    &"tavern_42", OwnershipRegistry.OwnerType.DYNASTY,
    &"dynasty_muller", &"heinrich"
)
ownership.set_building_owner(
    &"town_hall", OwnershipRegistry.OwnerType.CITY, &"luebeck"
)

# Get the legal/economic owner and the person shown as owner.
var kind := ownership.get_owner_type(&"tavern_42")
var dynasty_id := ownership.get_owner_id(&"tavern_42")
var displayed_owner_id := ownership.get_assigned_character_id(&"tavern_42")

# Transfer the building, atomically, to a different dynasty/member.
ownership.set_building_owner(
    &"tavern_42", OwnershipRegistry.OwnerType.DYNASTY,
    &"dynasty_schmidt", &"anna"
)

# Just change the displayed person; economic ownership is untouched.
ownership.assign_character(&"tavern_42", &"friedrich")

# Look up the properties economically owned by a dynasty or city.
var buildings := ownership.get_owned_buildings(
    OwnershipRegistry.OwnerType.DYNASTY, &"dynasty_schmidt"
)

# Make it unowned.
ownership.set_building_owner(&"tavern_42", OwnershipRegistry.OwnerType.NONE)
```

## Guarantees and lifecycle

- The building ID must be nonempty. `CITY` requires a nonempty city ID
  and never accepts a character assignment.
- `DYNASTY` requires an existing dynasty and a character who **currently
  belongs to that dynasty**. Assigning a character from another dynasty
  (or a dynasty-free worker) is rejected with no changes.
- Only dynasty-owned buildings can use `assign_character`. A character
  assignment can be explicitly cleared with `&""` to represent a temporary
  vacancy; the next assignee must belong to the owning dynasty.
- If the assignee changes/leaves their dynasty or their character is
  unregistered, the assignment is automatically cleared via the Dynasty
  System's membership signal. **The building is not transferred.**
- Unbinding a character's physical `PlaceActor` does not remove
  membership or ownership: identity and physical presence are separate.
- `get_owned_buildings` returns a copy of matching IDs, not mutable state.

Signals:

- `ownership_changed(building_id, old_type, old_owner_id, new_type, new_owner_id)`
- `assigned_character_changed(building_id, old_character_id, new_character_id)`

This package has **no building registry, city registry, individual
property wallets, inheritance logic, taxes, AI, UI or jobs**. Cities are
addressed by stable game-supplied IDs until the game defines them.

## Deploy

Requires DynastySystem, CharacterSystem and PlaceSystem. Add
`"ownership_system": "OwnershipSystem"` to the project's `manifest.json`
packages mapping, then deploy using `tools/deploy.py`.
