# my-godot-collection

Some Godot bits and bobs.

## Collection

- [Strategy Camera](strategy_camera/) — 3D strategy / city-builder camera.

## Copy tool

>You're probably thinking, “Jason... why don't you just copy them by hand?”
>No. That primitive act of manually moving files is personally insulting to me. I need manifest files, byte-by-byte comparison, selective conflict resolution, and atomic writes.

Each package declares its files in a local `manifest.json`.

Copy one package to any directory:

```bash
python tools/copy_collection.py strategy_camera "D:\\Projects\\MyGame\\camera"
```

If existing destination files differ, the tool lists only those files and asks:

```text
Overwrite these files? [y/N/p]:
```

- `y` overwrites all listed files.
- `N` cancels without changing anything.
- `p` lets you pick individual files using numbers and ranges such as `1, 2, 6-9, 14`.
- `-y` skips the prompt and overwrites all differing existing files.

Identical files are skipped.

A project can also contain a manifest that maps packages to target directories:

```json
{
  "packages": {
    "strategy_camera": "src/camera"
  }
}
```

Then copy everything declared there with:

```bash
python tools/copy_collection.py "D:\\Projects\\MyGame\\manifest.json"
```

Relative target paths are resolved from the project manifest's directory.

---

## Repository Notice

This repository is mainly for me.

I put stuff here because GitHub is convenient, version control is useful, and apparently saving random code in folders called `final_final_v2_really_final` is considered bad practice.

Why is the repo public?

Free CI, baby!

**Yes, the repository is public.**

**Yes, you can see the code.**

**No, that does not magically make it open source.**

A fair amount of the code in here was written with AI assistance, and there are parts I have not even properly read myself. So before you consider using any of this in something important (which, licensing-wise, you don't have permission to do in the first place), please remember that I am apparently comfortable publishing code that I have occasionally inspected with the rigorous engineering methodology known as "looks fine to me."

[MSG from several-hours-older-Jason: I did eventually read it. Calm down.]

[MSG from that same Jason: Also, my job here is not to manually type every implementation detail. I design the systems, make the decisions, review the results, reject the stupid versions, and decide what actually ships. AI does a lot of the implementation work. That's the arrangement. Somehow, it works out.]

You are welcome to look around.

You may learn something.

You may find something useful.

You may also find something deeply questionable that survived because it happened to work once.

Such is software.

Anyway, because visibility and permission are two completely different things:

## Copyright and Usage Notice

**Copyright © 2026 Jason Posch. All rights reserved.**

The source code in this repository is publicly available for inspection.

Except for rights arising from GitHub's Terms of Service and GitHub's platform functionality, no license or permission is granted to use, copy, modify, distribute, sublicense, sell, incorporate into another work, or create derivative works from this software without prior written permission from Jason Posch.

This repository is not open-source software. Its public availability does not grant permission to use the software.
