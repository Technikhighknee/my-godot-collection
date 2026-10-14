# Procedural material design

Material quality is not a color-filter problem. A convincing surface describes
**what it is made of**, **how it is assembled**, and **what happened to it**.
An art direction decides how much of that information is rendered, not whether
the underlying material is a different substance.

## Shared vocabulary

Each material recipe has seven concerns, in this order:

1. **Arrangement** — courses, overlap, board direction, stones or fibers.
2. **Shape and relief** — silhouettes, thickness, curvature, chips, joints.
3. **Substance** — ceramic pores, wood grain, stone minerals, plaster aggregate.
4. **Per-element variation** — different pieces must not look cloned.
5. **Aging** — moisture, deposits, fading, cracks and erosion belong to
   plausible places on individual pieces; not arbitrary whole-image noise.
6. **Art direction** — shape simplification, palette, pigment language, edge
   treatment and detail budget vary by style.
7. **Output** — albedo, height-derived normal and roughness come from
   consistent material facts, without baked scene lighting in albedo.

These are design responsibilities, **not seven mandatory rendering passes**.

## Implementation contract

The small shared module
[web/material-language.mjs](web/material-language.mjs) provides:

- materialSeedStreams(material, seeds) — semantic form/pigment/aging streams;
- materialElementTraits(column, row, columns, rows, streams) — periodic
  per-piece identity and independent structural/pigment/damage values;
- materialElementWear(traits, u, v) — local moisture, erosion and crack
  masks. These are **where** damage exists, not a color or particular style.

The individual material generator remains responsible for the real element
layout, UVs, thickness, palette and resulting PBR. This is deliberately **not**
a generic roof/stone/wood painter.

Two-component materials derive a stable aging seed from their **form** seed.
This keeps recoloring from moving cracks. Plaster and stone already have
separate aging inputs. A future explicit aging control can replace the derived
seed without changing the material model.

### Status

- **Naturalistic study:** thatch, timber and plaster now receive material-directed
  fiber/grain/trowel detail with restrained weathering instead of sharing a
  largely generic surface-noise grade. Stone uses its separate masonry grammar.
- **Watercolor study:** each supported material uses pigment density over a
  warm paper ground, drying-front accumulation and intermittent granulation;
  stone and clay preserve their element-specific outlines. This is a procedural
  watercolor approximation, not a fluid simulation or photographed paper.

- **Roof clay** uses the shared per-element traits for Naturalistic and
  Watercolor ceramic wear. The existing Hand-Painted and Retro output paths are
  left alone.
- **Rubble stone** uses the same traits and wear masks but renders them in
  its own masonry geometry for Naturalistic and Watercolor.
- **Thatch, timber and plaster** have registered semantic seed roles. Their
  generators still own their existing surface details; migrate only when a
  specific quality improvement benefits from shared per-element information.
- **Current** assets, saved project materials and default generator output
  are not changed by this non-persistent study work.

## Art direction constraints

- **Naturalistic:** physically plausible silhouettes and aging, material
  variation at the level of individual elements, restrained baked contrast.
- **Hand-Painted Fantasy:** simplify and exaggerate useful shapes without
  changing the material's identity.
- **Retro 3D:** budget geometry and palette at the source resolution;
  pixel scale must be consistent across all PBR channels.
- **Watercolor:** washes, pigment pooling, dry grain and selective edges
  should follow material geometry, not generic contour bands.
- **Classic PC Strategy:** currently an experimental surface treatment,
  not yet an independent native generator grammar.

Do not claim all art directions are physically realistic; keep a coherent
material language within each style.

## Minimum checks for the next material

- Form, pigment and aging seeds are reproducible and can be varied
  independently.
- Structure survives recoloring, including normals and cracks.
- Neighboring pieces have meaningful shape and wear differences.
- 2×2 repetition shows neither sharp discontinuities nor flattened seam bands.
- Albedo, normal and roughness agree, and are inspected in an actual
  lit 3D preview before treating the material as finished.
- A comparison image can look good while the game UV scale looks wrong.
  Judge the model at its intended world size too.

The goal is a small, extendable set of **material truths** translated through
clear art-direction rules, not a single heavily parameterized universal shader.

## Evaluation note

The two revised directions still need side-by-side 2×2 visual inspection on
actual models, particularly the relative scale of thatch strands and the
visibility of mortar after downsampling. Existing unit tests cover channel
contracts, repeatability and seed independence; they are not substitutes for
an art-direction review. Never silently promote these experimental studies
into saved default texture recipes.
