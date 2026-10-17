# Dynasty System (Godot 4)

A Dynasty is an economic/political group with a shared treasury and member
characters. One data model covers two types:

- Dynasty.Kind.REGULAR: player-controlled or AI-opponent dynasty.
- Dynasty.Kind.SHADOW: a supporting shadow dynasty.

Player/AI control and behavior are game rules, not separate data types.
Dynasties are not biological families. Ordinary workers, guards and
passers-by can have no dynasty whatsoever. Every character still has a
first and last name.

## Setup

Place one DynastyRegistry node alongside CharacterRegistry, and configure it:

    var characters: CharacterRegistry = $CharacterRegistry
    var dynasties: DynastyRegistry = $DynastyRegistry
    dynasties.configure(characters)

    var house := Dynasty.new(&"house_muller", "Müller",
        Dynasty.Kind.REGULAR, 1000)
    var shadow := Dynasty.new(&"house_schmidt", "Schmidt",
        Dynasty.Kind.SHADOW, 200)
    dynasties.register_dynasty(house)
    dynasties.register_dynasty(shadow)

    dynasties.assign_member(&"citizen_42", &"house_muller")

One character may belong to at most ONE dynasty. Assigning a new dynasty
atomically transfers them from the old one; removing membership leaves
them dynasty-free. These changes never edit parent/spouse links or
surnames. Characters must exist in CharacterRegistry before joining.

Useful APIs: register_dynasty, get_dynasty, get_dynasties, assign_member,
remove_member, get_dynasty_id_for, get_dynasty_for, get_members. Member lists
are returned as copies.

An explicit CharacterRegistry.unregister_character() removes its dynasty
membership; simply detaching the physical PlaceActor does not destroy
the character or its membership.

## Common money belongs to the dynasty

    house.deposit(500)   # 1000 -> 1500
    house.spend(200)     # 1500 -> 1300
    print(house.get_treasury())

Character has no personal wallet. Money can be deposited/spent only in
positive amounts; spending beyond the available funds or overflowing a
64-bit signed balance fails without changing the treasury. Dynasty emits
treasury_changed(new_balance).

DynastyRegistry signals: dynasty_registered(dynasty),
membership_changed(character_id, old_dynasty_id, new_dynasty_id).

No ownership, AI, trading, tax, inheritance distribution, individual
wages or production logic is implemented here.

## Deploy

Requires CharacterSystem (which requires PlaceSystem). Add
"dynasty_system": "DynastySystem" to the game project's packages mapping,
and run tools/deploy.py normally. No autoload is necessary.
