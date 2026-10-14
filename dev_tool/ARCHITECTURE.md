# Dev Tool — architecture direction

The Dev Tool is an **offline-first asset authoring and production environment**.
Its source projects are authoritative; previews and exports are disposable
outputs. Godot is the first target, not the authoring engine.

This document records implementation decisions, not a replacement for the
long-term product requirements. The migration is incremental; working
generators, their seed behavior, project documents and maps must survive.

## Ownership boundaries

| Owner | Knows | Must not own |
| --- | --- | --- |
| Generator definition | ID, recipe version, inputs, seed roles, supported output capabilities, slots and compatibility | Editor DOM, stored project instances, engine runtime |
| Specialized generator | Material/mesh construction, its own physical semantics, output-part material bindings | UI widgets, serialization policy, scene renderer |
| Project resource system | Source identity, versions, references, revisions, dependencies, cycles | How to paint stone or build a roof |
| Style implementation | Translation of a supported material/form to an art direction | A second project resource model |
| Preview | Lighting, camera, inspection, sampling and disposable renderer resources | Seed meaning, compatibility inferred from names, authoritative output |
| Production build | Resolve a validated resource graph, generate reproducibly, publish artifacts | Alternative generator algorithms |
| Export adapter | Map built artifacts to a target format | Independent material/model generation |

A registered generator is a capability, **not** a UI page. Importers are
resource producers too; imported assets do not have to pretend to be procedural
generator recipes. A scene refers to assets by stable resource identity.

### Current executable contracts

- `GENERATORS` contains the canonical generator descriptions, including
  `recipeVersion` and compatible material slots. New shared material UI
  actions discover slots from the descriptor rather than maintaining a second
  list of slot-to-generator mappings.
- A generated building part carries explicit `surface` data: the reusable
  material slot (when any), texture profile, preview category and optional
  visual tint. No preview may infer these from part names. Parts without a
  resource slot can still use non-persistent authoring preview materials.
- A saved procedural asset pins `generator.version`. The current format-1
  files are compatible with registered recipe version 1. An unknown version
  fails **without rewriting the source**. Supporting multiple versions and
  explicit migrations remains future work.
- The project's asset graph remains responsible for dependency validation,
  update revisions and prevention of cycles.

### Version policy

Recipe versions name **output compatibility**, not package releases or schema
versions. Never change the output of a released recipe version unexpectedly.
A material/style algorithm that changes existing saved results needs its own
new version. A future resolver may keep multiple versions installed; when it
cannot resolve a saved version it must preserve the original document and
show a specific incompatibility, not replace it with defaults.

A style implementation needs an independently versioned identity once it is
available to saved resources. Experimental styles are not automatically
production styles. Material identity, variation and project art direction
must be independent of a particular viewport.

### Generated data pipeline

```text
project source + compatible capability versions + dependencies
                  |
             validate graph
                  |
       deterministic authoring generation
                  |
       canonical asset/material result
          /             |             \
    preview          quality tests      production build
                                         |
                                  export adapters
```

The same canonical result must serve previews and export. Painting albedo,
normal and roughness for one resource must not require a separate semantic
generation for each channel. Discardable caching and incremental builds must
be based on versions, input semantics and transitive dependencies.

## Migration sequence and gates

1. **Remove hidden material meaning from consumers (started).** Generated
   parts declare what resource they use. Keep output meshes byte-for-byte
   compatible, validate slots, and reject missing source references.
2. **Make resource origins orthogonal.** Give imported and procedurally
   generated assets a shared identity, dependency and lifecycle model, while
   preserving their different edit capabilities. Legacy `devtool-asset`
   sources require a read-only-compatible upgrade path, not rewriting on load.
3. **Unify canonical results.** Decouple generation from painting into canvases
   and eliminate generator-specific preview/export branches. Output maps,
   geometry, metadata and bindings become independent of the browser.
4. **First-class art direction and variation.** Versioned style capabilities
   translate the specialized material grammar; a project can choose a visual
   identity without creating a copy of each generator.
5. **Scenes and builds.** Resolve resource graphs for placements, reproducible
   headless builds, individual resource export, and adapters for Godot and
   other consumers. Only rebuild changed subgraphs.
6. **Scale and operational safety.** Job isolation/cancellation, bounded caches,
   atomic artifact publication, explicit migrations and performance budgets.

Each migration stage must preserve project data, avoid new cross-module ID
switches, pass existing tests, and ship regression tests for its boundary.
Do not add generic frameworks before a real second consumer needs them.

## Regression gates

- The current building geometry, UVs, normals, indices and colors are
  unchanged by adding part-level surface declarations.
- Every emitted shared binding exists in the owning generator descriptor.
- A pigment-only reseed does not silently alter unrelated physical structure.
- Missing/incompatible saved versions or references fail closed.
- Experimental style results do not mutate stored production recipes.
- Technical tests and visual art reviews remain distinct quality gates.

## Known remaining work

Existing source records currently require a procedural generator. Renderer
fallback colors are still presentation-only mappings for the current building
family. The general model result contract, import pipeline, canonical
material output, version resolver for historical implementations, build graph
and target-engine exports are not yet implemented. This migration must not
claim those capabilities until exercised by end-to-end tests.
