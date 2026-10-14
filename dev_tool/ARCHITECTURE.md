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
- Imported GLB models and PNG images have a distinct `devtool-asset`
  source contract (`version: 2`, `origin: imported`) and share the project's
  stable asset IDs, resource index and dependency graph. Binary payloads are
  stored in project `assets/imports`, fingerprinted with SHA-256 and
  validated on retrieval. Import never fabricates a generator recipe.
- The local project API accepts same-origin, project-bound binary uploads
  (32 MiB maximum). The project asset editor can create imports. Rendering,
  material channels and editing imported content require dedicated
  capabilities; a PNG is **not** implicitly a complete PBR material.


### Headless material build — working scope

The shared project build path is now wired through `planAssetBuild`,
`produceBuild` and `ProjectLibrary.buildAsset`. It does not introduce a
second material generator.

- The plan resolves dependencies in stable topological order. Each cache key
  hashes effective input seeds, options, generator recipe version, material
  bindings and transitive dependency keys. Renaming a resource or changing
  only its master-seed label does not rebake unchanged pixels.
- Registered generators declare `headlessBake` when their existing
  `paint(canvas, view, profile)` implementation needs only the RGBA image-data
  subset of Canvas. The Node baker captures those exact pixels and writes
  RGBA8 PNGs, including available material views and profiles.
- The current baking capability covers thatch, clay, oak timber, lime plaster,
  rubble masonry and oak bark. Imported PNG and GLB assets pass through as
  verified source bytes. Unsupported procedural models and canvas-vector
  foliage fail explicitly rather than producing fake artifacts.
- Generated outputs live under
  `<project>/build/assets/<resource-id>/<content-key>/`.
  Each directory has a manifest with output SHA-256 hashes and dependency keys.
  Existing output checksums and imported original bytes are validated before
  a cached result can be reused. Staging directories are renamed atomically.
- The editor offers **Bake selected resource**, and the project API exposes
  `GET /api/projects/active/build-plan?asset=<id>` plus
  `POST /api/projects/active/builds/<id>` (same-origin, active-project check).
  CLI: from `dev_tool`, run
  `npm run build:asset -- <asset-id>`. The `--projects-dir` option can
  override the default project root.

These outputs are intermediate authoring artifacts, not Godot-ready materials
or a general-purpose imported-model editor. Baked channels are captured from
the same resource implementation seen in the editor; future target adapters
will consume them.

### Canonical 3D mesh and GLB output — working scope

- Model-capable generators may declare `modelBake`: named variants with a
  `canonicalize` adapter. It extracts the **existing** generated geometry,
  without rerunning or changing growth or construction algorithms.
- `canonical-model.mjs` validates raw indexed meshes, normal/UV/vertex-color
  channels, material slots, and finite bounds. The same original typed arrays
  remain authoritative; UV origin conversion happens in the glTF encoder,
  not in generator geometry.
- `build-glb.ts` writes deterministic glTF 2.0 binary assets (`.glb`) with
  mesh attributes, vertex colors, indices, named materials and embedded PNG
  images for assigned shared project PBR maps. GLB material metadata retains
  the resource slot and texture profile. The result is usable by glTF-capable
  tools including Godot, pending actual in-engine visual validation.
- Fir wood exports as `model.glb`. Timber-frame buildings export three
  variants of `level-*-exterior.glb`, plus `level-*-interior.glb` when the
  recipe enables the interior shell. Both views reuse one generated level.
- Only *explicitly assigned* project materials get baked PBR maps.
  Unassigned surfaces use authored fallback colors; this is not equivalent
  to the procedural fallback textures currently visible in the editor.
  Oak foliage and mature bark still lack a complete integrated model export
  adapter and are rejected, not silently exported with missing leaf cards.

This is the beginning of the canonical scene contract, not a generalized
runtime scene graph or a final Godot-specific import preset.

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

Legacy version-1 source records remain procedural; new imported resources
have a separate version-2 source shape within the same asset index. Imported
files can be persisted, verified and copied into derived build artifacts,
but they do not yet have an imported-model preview or PBR interpretation.
Procedural material maps now have a headless, cached PNG build.
Fir wood and three-level timber-frame building families have canonical GLB
model output, optionally embedding assigned project texture maps. Oak trees,
vector-painted foliage and other incomplete model material systems still
lack lossless end-to-end production support.

A complete scene graph, runtime placement metadata, historical generator
version resolver, style-aware production recipes, importable texture defaults
for unassigned materials, verified Godot scene imports and generic
target-engine export adapters remain future work. Browser painting still
defines the current image generator contract; the headless baker implements
only its pixel-data subset.
