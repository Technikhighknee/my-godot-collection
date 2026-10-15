# Dev Tool

## Testing with the permanent CI branch

The permanently reusable `CI` branch runs typechecking and all Node.js tests
without adding active GitHub Actions workflows to development branches.
The authoritative workflow template and the exact reset/overlay procedure are
in [the isolated CI documentation](docs/ci/README.md).
Do not manually edit `.github/workflows/isolated-ci.yml` on `CI`;
it is copied from the tracked documentation template for each run.

## Shared project textures

Project textures are ordinary, seed-reproducible project assets, independently
saved under the Studio *Textures* section. The generator catalog offers
**Textures → Roofs → Thatch** and **Clay tiles**, each with inspectable albedo,
normal and roughness channels. No downloaded textures or baked sunlight.

The building generator exposes reusable physical material slots for
foundations, plaster, structural timber and the two roof types. In particular,
**Thatch (level 1)** and **Clay tiles (levels 2 and 3)** are independently
assignable shared project materials. Each slot can select an existing saved
compatible texture, create a new project texture, open its texture editor or
reseed the shared asset (with revision conflict protection). Reassignments
belong to the building recipe: save the building to persist the reference.
Reseeding a texture modifies its single saved source and updates *all*
referencing buildings, including other open Studio asset tabs.

References are stored as validated `asset:<id>` material bindings and tracked
in the project dependency graph. A wrong generator type, missing texture,
unknown slot or cyclic dependency is rejected. The geometry preview defaults
to deterministic built-in textures until a project texture is assigned.
Texture baking/export to Godot is intentionally not part of this change.

## Building families

**Architecture → Buildings → Timber frame** opens the first building-family
generator. Each editable recipe stores the base dimensions, starting number
of storeys, roof pitch, structure/material seeds, and whether it has an
empty interior shell. The Level 1–3 selector previews related upgrades of
the same recipe; preview level is not a separate saved asset. A single source
can regenerate each level.

The exterior and optional **separate, unfurnished interior room shell**
are generated from the same immutable door/window opening plan. The
interior shows a ground-floor room only; upper floors may be visible
externally but are not modeled as interiors. Interior windows never
appear on a wall where the exterior has none. Windows are opaque: no
line-of-sight between exterior and interior scenes is implied.

The revised preview uses structurally plausible half-timber bay framing,
projecting storeys, differentiated gables, an attached service wing on
higher levels, dormers and procedurally textured plaster/wood/roof tiles.
The empty interior is displayed as an open-top cutaway: ground-level
openings follow the exterior plan, with timber roof joists and, at the
highest level, an architectural gallery. This is an artistic medieval
building grammar, not a historically accurate reconstruction.

The generated building is a source/preview with separate GLB exports for its levels and optional interiors.
No automatic furniture, stairs, room decoration or linked Godot scene is
provided. Building assets are saved alongside other project recipes and
listed under *Buildings* in the Studio explorer.

## Exporting project assets to Godot

Save a procedural or imported resource in Asset ProcGen, select it under
**Saved sources** and choose **Export selected to Godot package**. The action
builds that resource and its linked material assets once, then publishes an
import-ready file collection at:

```text
dev_tool/projects/<project-id>/exports/godot/<asset-id>/
  manifest.json
  assets/
    <asset-id>/model.glb
    <referenced-material-id>/albedo.png
```

The filenames in `assets/` remain stable across recipe reseeds even though
the internal build-cache keys change. Copy the **contents** of the package's `assets/` folder into your Godot
project's `res://assets/` folder. Godot then imports the GLB/PNG files. Multi-level building assets
carry several named `.glb` files; image resources carry their baked maps.
A resource with no linked materials only gets its own outputs.

CLI alternative (from `dev_tool`):

```bash
npm run export:godot -- <asset-id>
```

Packages for different root resources coexist. Repeated exports reuse
verified build artifacts and preserve unchanged packages. The publisher
rejects manually modified package files rather than silently deleting
your edits. This exports files for Godot; it does not write into an external
Godot project or generate `.tscn` scenes automatically.

## Offline-built maps (current architecture)

The Map Editor's JSON, heightmap, surface map, roads and water are **editable
source inputs**, not something the game must convert to geometry on load.
A scene build now bakes glTF meshes under `geometry/`:

- `terrain.glb`: world-space vertices, embedded categorical surface
  albedo, and a Godot-recognized static collision import tag
- `roads.glb`: clipped, terrain-conforming road surfaces, if present
- `water.glb`: already triangulated, source-connected water, if present

The same geometry files are embedded in the exported Godot scene package.
The `.tscn` instances the GLBs as ordinary PackedScenes alongside the
already-baked model placements. **No Godot MapSystem loader or runtime map
mesh generator is required** for these exported scenes. Source JSON and
images are included for provenance/editing only. Terrain's current palette
material is a basic baked baseline, not yet final art-directed terrain
texturing. The engine is exercised in CI, including import-time collision.

## Export a Godot 4 placement scene

Use **Export Godot** beside a saved map in Studio, or from `dev_tool/`:

```bash
npm run export:godot-scene -- world
npm run export:godot-scene -- world --projects-dir /path/to/projects
```

The tool builds/reuses the existing portable scene, then publishes a Godot
4 `.tscn` under `projects/<project>/exports/godot-scenes/<map-id>/`.
Copy the **whole** exported directory into a Godot 4 project's `res://`
filesystem. Relative GLB references continue to work when moved together,
after Godot finishes importing them. Generated model instances already have
their map positions and rotations. The scene includes metadata referencing
the original map and its terrain image files. Unresolved game-definition
placements appear as explicitly identified `Marker3D` nodes.

The `.tscn` is a placement scene; the existing Godot Map System must still
render terrain, roads and water from the included portable map data. It is
not a second terrain generator, nor a gameplay-building registry.

## Build portable map scenes

Studio has a **Build scene** action beside each saved map. It snapshots
validated map JSON, terrain EXR/PNG, all required prebuilt models/materials
and reproducible placement bindings. Only `asset:<id>` models present
in the map are built. Other game-definition IDs remain semantic.

CLI from `dev_tool/`:

```bash
npm run build:scene -- world
npm run build:scene -- world --projects-dir /path/to/projects
```

Scene bundles are produced at
`projects/<project>/build/scenes/<map-id>/<fingerprint>/` with a
`manifest.json` containing placement transforms, selected GLB files,
resource keys and verified file hashes. Godot scene generation and the
Map System installation remain separate steps.

## Build all project assets

Use **Build project assets** in the Studio overview, or run from `dev_tool/`:

```bash
npm run build:project
npm run build:project -- --projects-dir /path/to/project-root
```

The command builds all saved procedural and imported assets in the active
project, resolving shared material dependencies once and reusing verified
cached outputs. It reports the project plan key, generated versus reused
resources and each output directory. The project-wide build does not yet
assemble map placements into a Godot scene; single-resource Godot export and
sync remain separate operations.

## Synchronizing directly to Godot

In **Asset ProcGen → Project assets**, select a saved resource and enter the
absolute folder of the Godot project (the folder containing `project.godot`).
Click **Sync selected to Godot project**. Studio remembers that target path
for this authoring project in the local browser. No separate file copying
is needed.

CLI alternative (from `dev_tool`):

```bash
npm run sync:godot -- oak-market-square --target "C:\\Games\\MyGodotGame"
```

Files are published under
`res://assets/1400/<devtool-project>/<asset-id>/assets/<resource-id>/`,
with the Godot GLB/PNG filenames preserved. The tool validates the
`project.godot` destination and manages **only this resource-specific
folder**. Other scenes, imported resources, assets, and project settings
are not modified. Godot's `.import` sidecars are kept for files that
survive a refresh, protecting existing importer settings and UIDs.
Unmanaged edits, unexpected files and symlink redirections cause a
visible error rather than a silent overwrite.

Automatic reimport is handled by Godot itself; the Dev Tool does not
modify `.godot` caches or start the Godot editor.

## Studio workbench

The launcher at `/` creates and opens projects. Editing takes place in
`/studio.html`, a persistent workbench with project resources, search (Ctrl+K),
a generator catalog and editor tabs. Switching tabs preserves the browser
editor session; sessionStorage restores open documents after reload, but
**unsaved edits do not survive a full page reload**.

- Browse **Worlds**, **Models**, **Images & Materials**. Open a saved
  source in its specialized editor, or create one from the generator catalog.
- Asset ProcGen saves, loads and updates project-owned recipes. Saving
  refreshes the project explorer.
- Map placements with a saved `asset:<id>` reference can open their source.
  The studio can select a saved model to place as a **point marker**. The
  full generated mesh is not yet previewed inside the map.
- The project explorer's **+** action opens the Map Editor's create-map
  interface. Creating or switching maps refreshes resource names in the studio.
- Map documents still use one globally active map from the existing Map
  Workspace API. The studio therefore keeps one map editor session but
  supports multiple asset editor tabs. Changing the map prompts if there
  are unsaved edits.
- Editor tabs signal unsaved state to the studio. Switching projects
  invalidates stale sessions; project asset writes require the matching
  project identity as well as same-origin protection.

The standalone editor routes remain for compatibility. This workbench
reuses their rendering and edit functionality rather than duplicating
procedural geometry or adding a new runtime renderer.

## Projects (source workspaces)

The Dev Tool is now **project-centric**. Start with `npm start` from
`dev_tool/` and open <http://127.0.0.1:4371/>. Create or select a project
in the home screen. Local projects live under `dev_tool/projects/` by
default (ignored by Git). Override the location with `--projects-dir DIR`.

A new project is a standalone source directory, not a Godot project.
It initially contains:

```text
project.json
maps/
  world.map.json
  assets/world.height.exr
  assets/world.surface.png
assets/
  <stable-id>.asset.json
```

- `project.json` identifies the source project (format/version, stable ID,
  human-readable name).
- `maps/` contains editable maps and their source height/surface images.
  The existing Map Editor can open, create and edit these maps.
- `assets/` contains editable procedural **recipes**. A recipe stores
  its stable ID, generator ID/version, master seed, component seeds and
  eventual dependencies. Saved trees, textures and sprites are recipes,
  not exported GLB/PNG artifacts.
- Asset IDs such as `asset:market-oak` can be used in Map Editor object
  definitions. The map preserves these references. The project dependency
  graph derives edges from actual map placements and saved asset sources.
  Missing asset references are reported by the graph endpoint.

Asset ProcGen now has a **Project Assets** panel: select a generator,
choose seeds, save a new named recipe, load one or update a loaded recipe
using revision conflict protection. Editing generator defaults does not
silently alter saved recipes.

Source files are authoritative. Exporting GLB, maps, scenes and engine-specific
artifacts is **not implemented yet**. Existing placement markers do not yet
render the referenced generated models in the Map Editor. This is a first
real production-workspace slice, not a claim of finished asset builds.
Likewise, the generator-version field introduces a compatibility contract;
future algorithm changes will need explicit version migrations or frozen
generator implementations to preserve identical output.

API: `GET/POST /api/projects`, `GET/PUT /api/projects/active`,
`GET/POST /api/projects/active/assets`,
`GET/PUT /api/projects/active/assets/<id>` and
`GET /api/projects/active/graph`. The server accepts write requests
only from the local same-origin interface, validates IDs and recipes,
and uses optimistic revision checks when updating asset sources.
Source data remains portable; the project API is only a local workspace
controller.

To keep working with an existing standalone map without moving it,
`npm start -- ../map_system/coastal_relief.map.json` still starts the
legacy single-map workspace. That mode does not provide project asset
storage. No existing maps or Godot files were migrated or modified.

## Tools

- **Home:** the project launcher lives at `/`; opening a project enters `/studio.html`.
- **Map Editor:** open from the home screen or directly at `/tools/map-editor/`. It remains a Node.js / TypeScript browser editor for the Godot map format in `../map_system/`.
- **Asset ProcGen:** available at `/tools/asset-procgen/`. A searchable Asset Library groups oak/fir models, bark and leaf images by asset family; the preview automatically selects 3D or 2D rendering. Master and component seeds are independent. Project assets support deterministic builds; supported procedural textures bake to PNG and the fir, complete oak, and building adapters export GLB.

The tool navigation is shared visually; existing map editing, saving and API operations are unchanged. Returning home from the Map Editor triggers the browser's unsaved-changes warning when necessary.

## Structure

The Dev Tool itself owns the HTTP host and startup in `src/server.ts` and
`src/serve.ts`. `web/` contains the shared landing page. Each tool stays
under `tools/<tool-name>/`:

- `tools/map-editor/src/` owns map validation, workspace persistence, and
  the Map Editor API handler. Its `createEditorServer` helper still works for
  existing tests and integrations, but delegates HTTP hosting to the shared
  server. Editor-specific web files remain in `tools/map-editor/web/`.
- `tools/asset-procgen/web/` owns the asset generators and their preview.
  Each tool's `web/` directory is exposed automatically at `/tools/<tool-name>/`;
  no per-module or per-tool static routes are registered.

The shared HTTP host can run without a Map Editor API. Tool scripts use
canonical URLs within their owning directory, while project and map APIs are
mounted separately. The server rejects traversal, private file types and
symlinks escaping public directories. The standard Dev Tool entrypoint
initializes the project workspace.

## Run

Requires Node.js >= 22.10, npm, and a WebGL2 browser.

```sh
cd dev_tool
npm ci
npm test
npm run typecheck
npm start
```

Open <http://127.0.0.1:4371/> to create or choose a project.
Opening a project enters the **Studio** at <http://127.0.0.1:4371/studio.html>,
where project resources, generators and editor tabs share one workspace.
The Map Editor's existing **Maps** panel can create or open maps; the
Studio's project explorer also offers a create-map shortcut.

Existing standalone maps can still be edited in the compatibility mode:

```sh
npm start -- ../map_system/example.map.json --port 4372
```

## Asset ProcGen — searchable Asset Library

The left navigation groups generators by asset family, not their output
format. For example, **Vegetation → Oak** contains Tree (3D), Bark
(texture), Leaf spray (sprite) and Leaf atlas. **Vegetation → Fir**
currently contains Tree. Generator metadata (`libraryPath`, `navLabel`,
`navType`) defines this hierarchy; registering additional generators
automatically creates new categories and subgroups.

The search box accepts multiple words (e.g. `oak bark`), including
category and type names. **Ctrl+K** (or **Cmd+K**) focuses search; Esc
clears it. **All**, **3D Models**, and **2D Assets** are optional filters.
Groups can be collapsed. The star control marks favorites; recently
selected assets appear near the top. Favorites and history persist via
localStorage when supported; failure to access storage is harmless.
At narrow widths, a native generator selector remains available.

The generator registry still selects the output kind (`model` or `image`).
Three.js is used only for 3D previews; 2D generators use a Canvas inspector.
Changing generators automatically switches the active preview without losing
their individual seed states. The existing 1024×1024 oak leaf atlas remains
experimental and unchanged.

The standalone atlas has its own `leaves` seed and uses the same
default as the oak model's atlas seed (21749). Changing the seed in
one generator does **not** implicitly mutate the other generator.
Explicit asset linking and sprite/atlas editing are future work.

### 2D asset inspector

2D images retain their full-resolution original canvas independently of
the preview. Mouse wheel zooms around the cursor, left/middle drag pans,
**Fit** centers the image, **100%** restores native pixel scale, and the
plus/minus controls adjust zoom incrementally (5%–1600%). Pixelated
magnification begins at 200% to make cutout edges inspectable.

**RGBA** displays the checkerboard through transparency; **RGB** displays
color without transparency; **Alpha** displays opacity in grayscale
(black transparent, white opaque). Channel changes never modify the
generator's source image.

An image with explicit atlas layout metadata can isolate one tile using
the **Tile** selector, or by clicking a cell in the full atlas. **All
tiles** returns to the full texture. The tile view preserves native
pixels and supports the same zoom and channel controls. Seed changes
retain the inspected tile when its layout is still valid. Non-atlas
images have no tile selection. The tile inspector itself does not write export files or modify the oak model;
standalone atlases and leaf sprays can be baked from their saved recipes.

Each generated part has its own unsigned 32-bit seed. The oak has
**Wood geometry**, **Foliage placement**, **Leaf atlas**, **Bark fissures**,
**Bark surface** and **Bark pigmentation**; the fir has **Wood geometry**.
The Oak Tree's three bark seeds match the independent Bark generator's
three default seed values, but edits in either generator do not silently
change the other generator's seeds. A bark seed changes the material,
never the established wood geometry or the leaf-card positions.
Changing the geometry seed repositions the attached foliage and
rebuilds its UV render mesh; it does not change the bark's relief recipe.
Component states persist across generator switching.

The **Master seed** applies a deterministic combination to all
components of the selected generator; component fields and their
reseed buttons then override individual components independently.
Component IDs, rather than list positions, determine derived seeds.
The initial defaults deliberately preserve the previous results
(wood and foliage use the old tree seed; the atlas uses 21749).
The accepted oak and fir wood generators remain unchanged.

### Oak bark PBR material

Under **Vegetation → Oak → Bark**, the generator synthesizes three
deterministic, tileable 1024 × 1024 material profiles from the same
seeds, inspired by *Quercus robur*: **Trunk**, **Limb**, and **Young**.
The bark starts with a weathered grey-brown cork skin and sparse,
irregular longitudinal fissures. Their paths are seeded wandering splines
with independently eroded banks, branching, uneven width, discontinuities,
worn shoulders and local depth variation. An independent, gently warped
cellular plate network adds natural-looking cross-breaks and flaky
material detail. The color map includes restrained dusty and lichen
mottling; relief, normal, AO and roughness share the same height field.
The Trunk, Limb and Young profiles reduce the extent and depth of
fracturing with wood maturity. The whole material is deterministic and
tiles continuously on both axes.

The existing wood growth geometry, branch intersections and UV mapping
are deliberately unchanged. No third-party textures, dependencies or
export support are added.

Its independent seeds are **Bark fissures**, **Surface detail** and
**Pigmentation**. All five maps originate from the same scalar relief
field: sRGB albedo, OpenGL tangent-space normal (+Y), grayscale
roughness (G channel), approximate local cavity AO and height.
The albedo is deliberately restrained so that deep fissures are
expressed primarily through normal/occlusion rather than black painted
stripes. AO is a local height-field approximation, not a world-space
light bake. Height is available for inspection; the mesh is **not**
displaced. The 2D inspector has **Bark profile** and **Material map**
selectors: changing only the map reuses the profile's previously
generated pixels; other profiles are generated lazily.

**Vegetation → Oak → Tree** uses three physically based
`MeshStandardMaterial` instances (albedo, normal, roughness, AO)
on one UV-mapped render mesh. Every connected woody chain gets a
stable maturity profile based on actual radius: the trunk remains
mature, strong limbs receive intermediate bark, fine twigs are young.
One draw group per chain ensures no dropped or duplicated triangles,
while preserving the accepted topology of the procedural wood generator.
UV distance continues along real axis continuations, U wraps at
duplicate seam vertices, and end caps use planar mapping. Physical
reference scales remain in `oak-bark-uv.mjs`. These profile boundaries
do not yet solve *geometric* branch collar transitions; that is a
separate mesh-shaping concern. The fir keeps its own wood material.

Bark map textures are cached between renders with unchanged seeds,
then explicitly disposed when their seed changes. This step **does
not** add export or a Godot material converter.

### Oak leaf spray prototype

In **Vegetation → Oak → Leaf spray**, a standalone generator grows one
small twig structure in 3D with four branching axes and eleven
individually shaped oak leaves. Each leaf has a seeded lobed blade,
curved surface, midrib, lateral veins and subtle material variation.
The twig structure and leaf appearance use **different seeds**.

The spray is projected from a fixed camera into a transparent
**768 × 768 RGBA image** with bounds-based framing. This is a
deterministic proof of the 3D-to-2D baking pipeline, not the final leaf
art, physically based 3D lighting or an export format. It does **not**
modify the accepted oak/fir geometry, the existing 16-tile atlas,
foliage cards or game materials. The sprite can be examined in the
existing 2D inspector, including the alpha channel.

This intentionally keeps the next steps small: improve a single
leaf-spray's appearance, then generate a coherent atlas from several
sprays, and only later attach crossed card clumps to the tree.

### Oak wood structure

The oak is generated from one numeric seed. Its wood skeleton has four
growth orders, including the main trunk. Each nonterminal wood axis
continues from its endpoint and develops a small number of lateral
offspring. The shorter supporting boughs divide into longer secondary
axes, while the final generation tapers into fine terminal shoots.

Each woody section preserves its local tangent and cross-sectional
orientation. Successive sections change direction through seeded,
radius-scaled angular deviations and a weak upward growth response.
A branch retains its newly grown direction rather than repeatedly
turning back toward its original heading. Lateral attachment heights
and compass directions are independently distributed across available
sectors.

The growth planner indexes existing wood segments as capsules. New axes
try alternate growth directions when their predicted path would cross
previously placed wood. The main supporting boughs keep their angular
spacing; finer branches can search a wider range of directions.
Secondary boughs start after their supporting axes have begun to clear
the central trunk. Immediate parent-child contact is intentional and
excluded from collision rejection near the fork.

Descendants of low primary supports grow within a gently constrained
lower-crown envelope. Their entire paths, including continued segments,
respond to available lateral space and groundward clearance. Lower
secondary shoots are moderately shorter and turn gradually away from
crowded or downward-reaching regions. The constraint fades with the
attachment height, retaining the broader upper crown and the original
short primary supports.

The lower trunk stays slender, with a restrained asymmetric root flare
and slight longitudinal variation in its cross-section. The terminal
shoots have deliberately uneven lengths and a broader range of
departure angles; some end early instead of filling the crown with
parallel upright tips.

Continuing axes become one continuous meshed wood tube. The beginning
of larger lateral shoots sits inside the supporting wood and gradually
reaches its full section radius. Side-branch junctions remain intersecting
surfaces rather than a fully fused wood volume.

### Oak crown — procedural foliage cards

The seeded oak retains its real trunk, boughs and terminal wood. Leaf
blades are no longer generated as individual triangle meshes: the
former method could reach more than a million triangles without making
recognizable clusters.

Each secondary support anchors a larger inner canopy lobe and a
smaller outer satellite, built from accepted branch and terminal
centerlines. Rather than two isolated round tufts, the lobes overlap
into an elongated, irregular mass; neighboring groups can overlap
as well. A lobe carries approximately 19–39 curved alpha-cutout
cards oriented outward, upward and at crossed angles. Each card
depicts many overlapping leaves with a dense, scalloped silhouette.
The wood mesh is unchanged. Seeded variation affects lobe shape,
card position, orientation and color.

The browser and headless Skia painter produce a seeded 1024 × 1024 RGBA atlas with
sixteen oak sprays using Canvas 2D. Each spray layers broad
*Quercus robur* leaf silhouettes into a filled clump, with unobtrusive
fine branchlets; every tile is clipped to prevent atlas bleeding. The existing
oak-leaf.mjs profiles supply the rounded lobes and basal ears.
oak-atlas.mjs handles painting; oak-foliage.mjs returns one indexed
mesh with positions, normals, colors, UVs, and cushion metadata.
No external textures or dependencies are introduced.

The preview caches the atlas for the selected leaf seed and reuses
the texture when only wood or foliage placement changes. **Inspect leaf card** enlarges the actual atlas tile;
**Inspect clump** isolates one real lobe of the generated tree, while
Whole tree and Inspect crown restore the normal geometry draw range. Alpha cutout writes depth and casts shadows, while
double-sided cards and alpha-to-coverage preserve a solid crown at
oblique viewing angles. Hide leaves, Silhouette, Turntable and camera
controls still work.

The detailed leaf-card mesh contains roughly 3,400–3,600 triangles,
in addition to 6,444 existing wood triangles. There are **no LOD levels**
and no runtime wind animation yet. The production builder exports the existing
bark and foliage together as a GLB; runtime wind remains future work. Tests verify seeded output, connected group structure, correct
UV tile boundaries, finite indexed geometry and the triangle budget.

### Young fir wood structure

The fir has a single upright leader and eleven offset annual whorls.
Longer, mostly horizontal boughs make the lower crown; younger, shorter
boughs slope more upward toward the top. Branch lengths and attachment
heights vary within each whorl, so the crown does not consist of
perfectly repeated rings.

The whorl rhythm remains recognizable because it is characteristic
of fir growth; the organic variation is mainly *within* each whorl.
Primary limbs begin inside the trunk's shell with a thicker collar,
taper early, and follow gently bowed trajectories with recovering outer
tips. The bow is stronger in older lower limbs.

Second-order shoots spread forward and sideways in flattened woody
fans. Every primary bough receives its own correlated vigor, lateral
station spacing, and uneven side exposure. Opposing ranks are no longer
exact mirrors: shoots can be missing, shorter, or unusually vigorous.
Terminal twigs vary between zero and three per lateral; their attachment
positions and divergence are deliberately not repeated in pairs. The
variation acts within the characteristic annual whorls, rather than
randomizing away the fir's overall architecture.

The young wood is also not perfectly cylindrical: larger axes use
slightly irregular cross sections, gently winding longitudinal ridges,
and restrained changes of section thickness. All surface variation is
seeded and radius-relative; the slenderest twigs remain nearly smooth.
This is geometric form, not a painted bark material. Needles are not
simulated, so the bare wood will appear much more open than a living
evergreen crown. This is an intentionally different architecture, not
a resized oak; it retains the same in-memory mesh interface.

Both meshes currently use closed tubes for individual woody axes;
parent-child intersections are not fused into one watertight volume.
Needles, leaf meshes, bark materials, asset exports and extra user
parameters are deferred.

The Master seed and independent component seeds control each generated
asset. Whole tree, Inspect base, Inspect crown, Silhouette and Turntable
are inspection views. The Map Editor and game assets remain unchanged.


## Map workspace

- **Open:** choose an existing `*.map.json` from the active map folder; opening another map reloads the editor. Unsaved changes require confirmation.
- **Create:** provide a new lowercase filename slug, name, physical dimensions, height-sample grid, height range and surface palette. New maps start with flat terrain at elevation 0 (clamped to the configured range), and the first palette entry across every cell. The editor writes EXR/PNG/JSON without overwriting existing paths and registers all three files in a present Godot deployment manifest.
- **Settings:** rename a map, adjust its height range or change surface definition IDs. Changing the height range changes world-space elevations without modifying normalized EXR samples; changing palette labels changes the meaning of saved surface indices. Both require deliberate confirmation of unsaved edits and a reload. Map width/depth and sample resolution remain fixed after creation.
- **Active assets:** inspect the current EXR and PNG paths in the panel. Terrain painting and sculpting continue to manage immutable generated revisions. The editor does not automatically delete older asset versions.

The workspace is intentionally limited to one directory and does **not** expose an arbitrary file browser or delete maps. The map picker verifies linked EXR/PNG assets before marking entries valid. Changes from another process are detected by revision and asset integrity checks. Creating a map uses a final JSON publish point; if interrupted before publication, unused generated assets or manifest entries may remain, but existing maps are not replaced.

## Controls

- **Grid (`G` toggles; Grid button opens settings):** optional coordinate grid (0.25–100 m), hold `Alt` while placing or dragging to bypass it. Grid affects points/markers, not brush strokes. Numerical X/Z point, vertex, and marker fields support precise placement.
- **Multi-select markers:** `Shift`+click or `Ctrl`+click to toggle; `Ctrl+A` selects all markers of the current type; drag one selected marker to move the group. Each group operation is one Undo step.
- **Duplicate:** `D` or Duplicate selection starts a cursor-aligned preview for selected markers or a road. Hover to position it; green is valid, red is invalid. `LMB` commits one undoable duplicate, `Esc` cancels. `R` rotates marker duplicates in 15° steps. No changes occur until placement succeeds.
- **Hotbar:** `1–5` selects Select, Sculpt, Paint, Draw, or Place. `Q/E` cycles the current tool’s modes (sculpt, surfaces, roads/areas, entities/lakes). Context settings replace the long sidebar. Tools remember their last mode. Hotkeys never intercept focused form controls.
- **Camera (every tool):** middle drag to orbit, right drag or hold `Space` and left-drag to pan, wheel to zoom **toward the cursor**. `F` focuses the selected marker/road/build area or resets the map view if nothing is selected.
- **Edit roads:** select, create, move points, insert/append, delete or change width.
- **Water:** set a single global sea level and click the terrain to place lake sources with independent water levels. Ocean water only reaches terrain below sea level connected to a submerged boundary; lakes flood terrain reachable from their point. Shorelines derive from the triangular heightmap and react to Sculpt edits. No freehand water polygons. A lake source must remain below its water level. Existing polygon-water maps must be migrated.
- **Settlements:** draw closed build-area polygons, edit/insert/remove vertices, create settlements with multiple build areas, rename or remove areas. Finish with `Enter` (or click the first point), `Esc` cancels. Invalid and self-intersecting polygons cannot be committed.
- **Buildings & objects:** select visible markers, drag them to new positions, change definition/rotation, place or delete markers. `R` rotates placed or selected markers by 15° (`Shift+R` reverses); `Delete` removes the current selection (including roads/areas when selected). New IDs are generated automatically; type a real definition ID before placing.
- **Sculpt:** raise, lower, smooth or flatten with a circular brush. Hold `Shift` to reverse raise/lower, `Ctrl` to temporarily smooth (takes precedence over `Shift`), even mid-stroke. `Shift+wheel` changes brush radius, `Ctrl+wheel` changes brush strength; neither zooms the camera. Releasing modifiers restores the chosen sculpt mode. One drag is one undo entry. Flatten samples the height at stroke start.
- **Paint:** choose a surface definition or hold `I` and click an existing surface to sample it without painting. `Q/E` cycles definitions, `Shift+wheel` resizes the brush, and `Ctrl+wheel` changes its strength.
- **Undo/Redo:** `Ctrl+Z`, `Ctrl+Shift+Z` / `Ctrl+Y` (one history across all tools).
- **Save map:** `Ctrl+S`. Nothing changes on disk before saving.

Terrain saves create immutable content-addressed EXR/PNG assets. The map JSON is
published last; the original files stay intact. If `../map_system/manifest.json` exists,
new assets are included for deployment. Old generated assets are not removed
automatically. External file changes cause a save conflict.

The editor is bound to `127.0.0.1`; writes require same-origin requests. Binary map reads use conditional revisions to avoid mixing map assets across workspace switches. Preview colors and road ribbons approximate Godot rendering;
height geometry, triangular interpolation and stored surface indices use its map contract.
Building/object markers are placeholders, not actual game assets. The editor validates
known building definitions against footprints, build areas, slopes, roads and water
both in the browser and before saving. Rules depend on the supplied definition
catalog; Godot remains authoritative for final geometric placement decisions.

Copyright © 2026 Jason Posch. All rights reserved. See [NOTICE.md](NOTICE.md).

## M6 — building placement checks

The Godot map still stores only `id`, `definition`, `[x,z]`, and clockwise
`rotation` for each building. Building **definitions are not embedded in maps**.
For local preview and save-time checks, the editor reads
[`placement-definitions.json`](tools/map-editor/placement-definitions.json) at startup. The two
included definitions (`building.house` and `building.workshop`) are **editable
examples**, not canonical game content. Supply your own file with:

```sh
npm start -- ../map_system/coastal_relief.map.json --definitions ./tools/map-editor/placement-definitions.json
```

Each `buildings` entry contains `id` and `footprint` `[width,depth]` (meters),
with optional `requires_build_area` (default `true`), `max_slope` (degrees,
less than 90), `entrance` (local `[x,z]`), and `max_road_distance` (meters).
Road distance is measured from the transformed entrance to the *nearest road
edge*, not its centerline. All fields correspond to Godot's
`BuildingPlacement.check()` definition parameters. This registry is an
**editor-only** aid; the eventual game must provide its own building definitions
when using the Godot placement API.

Choose **Building**, enter a known definition ID (autocomplete), then press
**Place marker** and move over the terrain. The footprint is green when the
placement check succeeds and red otherwise. Click to place; select and drag
to relocate. Invalid new/changed building positions are rejected in the
browser **and again by the Node server before saving**. Undo/Redo remains
shared with all other edits. Terrain editing can invalidate an existing
building: a save rechecks known buildings when roads, water, build areas or
heightmap change. Pre-existing markers with definitions missing from the
catalogue are shown as unverified, retained unchanged, and cannot be moved
until their definitions are supplied. Unknown neighboring footprints block
new placement to avoid pretending no collision exists.

The browser/server checks use the same map coordinates, rectangle rotation,
triangle-based slope and definition contract as Godot. Road collision in the
Node tool is a **centerline-buffer approximation**, whereas
Godot uses `Geometry2D.offset_polyline` miter geometry. The Godot runtime is
still authoritative at this boundary; the preview is not a pixel-exact
replacement for Godot geometry. Editor preview is geometry, not a rendered
building model. This feature does **not** make the editor a building modeller.

## Terrain-derived water format

```json
"water": [
  { "id": "sea", "definition": "water.sea", "height": 0 },
  { "id": "hill_lake", "definition": "water.lake", "height": 18, "source": [140, 90] }
]
```

The lake coordinate is illustrative: it must lie strictly below its water level in the actual map. Maps may omit the sea (`"water": []`). Coastline geometry and water collision are derived, never serialized as polygons. Sea flooding starts from submerged map boundaries; lakes from their source triangle. Lakes and seas are static and require no fluid simulation. Water levels do not sculpt terrain. **Legacy `water[].polygon` maps are not backward-compatible** and require an explicit migration. Rivers are a future separate feature.
