#!/usr/bin/env python3
"""Run Godot package tests in an isolated temporary project, not in 1400."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PACKAGES = ("building_system", "inventory_system", "production_system", "movement_system", "place_system")


def main() -> int:
    godot = os.environ.get("GODOT_BIN") or shutil.which("godot") or shutil.which("godot4")
    if godot is None:
        print("Godot runtime not found. Set GODOT_BIN or install Godot 4 to execute tests.")
        return 2

    with tempfile.TemporaryDirectory(prefix="collection-godot-tests-") as temporary:
        project = Path(temporary)
        (project / "project.godot").write_text(
            'config_version=5\n[application]\nconfig/name="Collection Runtime Tests"\n',
            encoding="utf-8",
        )
        for package in PACKAGES:
            folder = ROOT / package
            manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
            for file in manifest["files"]:
                destination = project / package / file
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(folder / file, destination)
        (project / "tests").mkdir()
        shutil.copy2(ROOT / "tests" / "godot_systems.gd", project / "tests" / "godot_systems.gd")
        for extra in (["--editor", "--quit"], ["--script", "res://tests/godot_systems.gd"]):
            command = [str(godot), "--headless", "--path", str(project), *extra]
            print("Running:", " ".join(command), flush=True)
            result = subprocess.run(command, timeout=120, check=False)
            if result.returncode:
                return result.returncode
    return 0


if __name__ == "__main__":
    sys.exit(main())
