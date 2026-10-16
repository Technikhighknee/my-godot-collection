# Character System (Godot 4)

One Character is one named person. Every person, including a guard, worker
or market seller, has a first AND last name. Sharing a surname does not
establish a relationship. There is no Family entity, and no automatically
generated parents, partners or children.

A Character is a persistent identity record (RefCounted). The live physical
representation is a bound PlaceActor with the same ID and a real
CharacterBody3D in the Place System. This package never simulates hidden
NPCs or duplicates movement.

## Setup

Add a CharacterRegistry Node alongside PlaceManager3D and GameActors.
After the game physically spawns and binds an actor (for example via
PlaceActorSpawner.spawn):

    var person := Character.new(&"citizen_42", "Heinrich", "Müller")
    $CharacterRegistry.register_character(person, actor)

The actor must already be bound and its actor_id must match the person's
ID. An empty first/last name, missing body, duplicate ID or wrong actor
is rejected. Merely having a surname never creates a family.

CharacterRegistry API:

- register_character(character, actor) -> bool
- get_character(id) -> Character
- get_actor(id) -> PlaceActor (or null if detached)
- get_character_for_actor(actor) -> Character
- attach_actor(id, actor) -> bool, for explicitly restoring physical presence
- unregister_character(id) -> bool, intentionally deletes identity and links
- get_characters() -> Array[Character]

If the game unbinds or removes an actor, the identity and genealogical
links remain but get_actor returns null. That record represents history
or data awaiting explicit game-controlled restoration, not an active NPC.
All living NPCs must still have physically bound PlaceActors; this system
does not decide birth/death/save/load rules.

## Family relationships without a Family entity

    characters.set_parents(&"daughter", [&"parent_a", &"parent_b"])
    characters.marry(&"parent_a", &"parent_b")
    var parents := characters.get_parents(&"daughter")
    var children := characters.get_character_children(&"parent_a")
    var spouse := characters.get_spouse(&"parent_a")
    characters.divorce(&"parent_a")

Parentage is optional (0, 1 or 2 parents); links must refer to registered
characters and cannot contain duplicates, self-parenting or ancestry cycles.
Marriage is reciprocal. It changes neither surnames nor dynasty membership.
A person's name can be changed explicitly with Character.rename(first, last).

Relationship collection getters return copies, not mutable registry state.

Signals: character_registered(character), character_removed(id),
actor_attached(id), actor_detached(id), relationships_changed(id).
Character emits name_changed() when explicitly renamed.

Does not implement inheritance, ageing, occupations, reproduction, NPC
behavior, personal money, or life/death game rules.

## Deploy

Requires PlaceSystem (PlaceActor and its dependencies). In the game project
manifest's packages object, add "character_system": "CharacterSystem" alongside
"place_system": "PlaceSystem". Run tools/deploy.py normally.
