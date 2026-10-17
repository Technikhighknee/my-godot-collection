# Dynasty System

Dynasty identities, shared treasuries and exclusive character memberships.

Two `Dynasty.Kind` values are supported: `REGULAR` and `SHADOW`. Membership is keyed by the character's ID.

## Usage

Add a `DynastyRegistry` node and configure it with the existing `CharacterRegistry`:

```gdscript
dynasties.configure(characters)
var house := Dynasty.new(&"hansen", "Hansen", Dynasty.Kind.REGULAR, 1000)
dynasties.register_dynasty(house)
dynasties.assign_member(&"citizen_1", &"hansen")
house.spend(200)
```

A character belongs to at most one dynasty. `assign_member` transfers membership; `remove_member` clears it. Character removal clears the membership automatically. Member-list queries return copies.

The treasury accepts positive deposits and withdrawals, rejects overdrafts and guards against integer overflow.

## API

`Dynasty`: `get_id`, `get_name`, `get_kind`, `is_shadow`, `get_treasury`, `deposit`, `spend`.

`DynastyRegistry`: `configure`, `register_dynasty`, `get_dynasty`, `get_dynasties`, `assign_member`, `remove_member`, `get_dynasty_id_for`, `get_dynasty_for`, `get_members`.

Signals: `treasury_changed` on `Dynasty`; `dynasty_registered` and `membership_changed` on the registry.
