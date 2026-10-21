# Character System

Character identities and family relationships, optionally associated with persistent PlaceActors.

`Character` stores an ID, first name and last name. `CharacterRegistry` keeps identities independent of scene objects: a character may be registered without an actor or physical body. An actor may be attached later, and its `actor_id` must match the character ID.

## Usage

```gdscript
var character := Character.new(&"citizen_1", "Anna", "Hansen")
characters.register_character(character)
character.rename("Anna", "Kaufmann")

# Later, once a persistent actor has a valid PlaceLocation:
characters.attach_actor(character.get_id(), actor)
```

A `PlaceActor` does not need a bound `CharacterBody3D` to be attached. Unbinding or unloading the physical body does not remove the character or its actor. When replacing an actor itself, use `detach_actor` before attaching another one; actor deletion automatically detaches it.

Parents are specified explicitly, with up to two registered parents per character. The registry checks parent duplicates and ancestry cycles. Marriage and divorce maintain reciprocal spouse links.

## API

`Character`: `get_id`, `get_first_name`, `get_last_name`, `get_full_name`, `rename`, `is_valid`.

`CharacterRegistry`: `register_character(character, actor = null)`, `unregister_character`, `get_character`, `get_characters`, `get_actor`, `get_character_for_actor`, `attach_actor`, `detach_actor`, `set_parents`, `get_parents`, `get_character_children`, `marry`, `divorce`, `get_spouse`.

Signals: `character_registered`, `character_removed`, `actor_attached`, `actor_detached`, `relationships_changed`. `Character` emits `name_changed`.
