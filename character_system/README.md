# Character System

Named character identities and explicit family relationships, connected to physical actors from Place System.

`Character` stores an ID, first name and last name. `CharacterRegistry` maintains the association between a character and a bound `PlaceActor`. The actor ID must match the character ID.

## Usage

```gdscript
var character := Character.new(&"citizen_1", "Anna", "Hansen")
characters.register_character(character, actor)
character.rename("Anna", "Kaufmann")
```

The actor must already be in the scene tree and bound to a physical `CharacterBody3D`. Unbinding the actor detaches the physical reference while retaining the character record. Use `attach_actor` when a replacement actor is bound.

Parents are specified explicitly, with up to two registered parents per character. The registry checks parent duplicates and ancestry cycles. Marriage and divorce maintain reciprocal spouse links.

## API

`Character`: `get_id`, `get_first_name`, `get_last_name`, `get_full_name`, `rename`, `is_valid`.

`CharacterRegistry`: `register_character`, `unregister_character`, `get_character`, `get_characters`, `get_actor`, `get_character_for_actor`, `attach_actor`, `set_parents`, `get_parents`, `get_character_children`, `marry`, `divorce`, `get_spouse`.

Signals: `character_registered`, `character_removed`, `actor_attached`, `actor_detached`, `relationships_changed`. `Character` emits `name_changed`.
