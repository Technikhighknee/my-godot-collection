from __future__ import annotations

import importlib.util
import io
import json
import sys
import tempfile
import unittest
import zipfile
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "tools" / "deploy.py"
SPEC = importlib.util.spec_from_file_location("collection_deploy", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
deploy = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = deploy
SPEC.loader.exec_module(deploy)


class DeployTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.project = self.root / "project"
        (self.repo / "tools").mkdir(parents=True)
        self.project.mkdir()
        for name, files in {
            "strategy_camera": {"StrategyCamera.gd": b"camera"},
            "map_system": {"core/GameMap.gd": b"map", "assets/example.surface.png": b"\x89PNG"},
        }.items():
            folder = self.repo / name
            folder.mkdir()
            for path, data in files.items():
                f = folder / path
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_bytes(data)
            (folder / "manifest.json").write_text(json.dumps({"files": list(files)}))
        self.manifest = self.project / "manifest.json"
        self.write_manifest({"strategy_camera": "StrategyCamera", "map_system": "MapSystem"})
        self.backup_patch = patch.object(deploy, "BACKUP_ROOT", self.root / "backups")
        self.file_patch = patch.object(deploy, "__file__", str(self.repo / "tools" / "deploy.py"))
        self.backup_patch.start()
        self.file_patch.start()
        self.addCleanup(self.backup_patch.stop)
        self.addCleanup(self.file_patch.stop)

    def write_manifest(self, values: dict[str, str]) -> None:
        self.manifest.write_text(json.dumps({"packages": values}))

    def execute(self, *args: str) -> int:
        with redirect_stdout(io.StringIO()):
            return deploy.run(list(args))

    def test_exact_manifest_names_and_nested_files(self) -> None:
        self.execute("-y", str(self.manifest))
        self.assertEqual((self.project / "packages" / "StrategyCamera" / "StrategyCamera.gd").read_bytes(), b"camera")
        self.assertEqual((self.project / "packages" / "MapSystem" / "core" / "GameMap.gd").read_bytes(), b"map")
        self.assertEqual((self.project / "packages" / "MapSystem" / "assets" / "example.surface.png").read_bytes(), b"\x89PNG")
        self.assertFalse((self.project / "packages" / "map_system").exists())

    def test_modified_local_files_and_legacy_folder_are_backed_up(self) -> None:
        old = self.project / "MapSystem"
        old.mkdir()
        (old / "custom.gd").write_text("private changes")
        self.execute("-y", str(self.manifest))
        self.assertFalse(old.exists())
        backup = next((self.root / "backups").glob("MapSystem-*.zip"))
        with zipfile.ZipFile(backup) as z:
            self.assertEqual(z.read("MapSystem/custom.gd"), b"private changes")
        installed = self.project / "packages" / "MapSystem"
        (installed / "my_file.gd").write_text("my own file")
        self.execute("-y", str(self.manifest))
        self.assertFalse((installed / "my_file.gd").exists())
        self.assertEqual((installed / "core" / "GameMap.gd").read_bytes(), b"map")
        self.assertTrue(any(
            z.read("MapSystem/my_file.gd") == b"my own file"
            for path in (self.root / "backups").glob("MapSystem-*.zip")
            for z in [zipfile.ZipFile(path)]
            if "MapSystem/my_file.gd" in z.namelist()
        ))

    def test_cancel_preserves_all_files_and_does_not_make_backups(self) -> None:
        old = self.project / "MapSystem"
        old.mkdir()
        (old / "mine.txt").write_text("mine")
        with patch("builtins.input", return_value=""):
            self.execute(str(self.manifest))
        self.assertEqual((old / "mine.txt").read_text(), "mine")
        self.assertFalse((self.project / "packages").exists())
        self.assertFalse((self.root / "backups").exists())

    def test_path_traversal_and_case_insensitive_target_collision_rejected(self) -> None:
        for folder in ("../bad", "foo/bar", "C:\\Windows", "..", "NUL", "packages", ""):
            with self.subTest(folder=folder):
                self.write_manifest({"map_system": folder})
                with self.assertRaises(deploy.CopyError):
                    self.execute("-y", str(self.manifest))
        self.write_manifest({"strategy_camera": "MapSystem", "map_system": "mapsystem"})
        with self.assertRaisesRegex(deploy.CopyError, "overlaps"):
            self.execute("-y", str(self.manifest))
        self.assertFalse((self.project / "packages").exists())

    def test_package_manifest_cannot_escape_or_request_remove(self) -> None:
        path = self.repo / "map_system" / "manifest.json"
        path.write_text(json.dumps({"files": ["../tools/deploy.py"]}))
        with self.assertRaises(deploy.CopyError):
            self.execute("-y", str(self.manifest))
        path.write_text(json.dumps({"files": ["core/GameMap.gd"], "remove": ["mine.txt"]}))
        with self.assertRaises(deploy.CopyError):
            self.execute("-y", str(self.manifest))
        self.assertFalse((self.project / "packages").exists())

    def test_backup_failure_makes_no_deployment_changes(self) -> None:
        old = self.project / "MapSystem"
        old.mkdir()
        (old / "mine.txt").write_text("mine")
        with patch.object(deploy, "_backup", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                self.execute("-y", str(self.manifest))
        self.assertEqual((old / "mine.txt").read_text(), "mine")
        self.assertFalse((self.project / "packages" / "MapSystem").exists())
        self.assertFalse(list((self.project / "packages").glob(".deploy-stage-*")))

    def test_failed_second_swap_rolls_back_both_packages(self) -> None:
        self.execute("-y", str(self.manifest))
        cam = self.project / "packages" / "StrategyCamera"
        mapdir = self.project / "packages" / "MapSystem"
        (cam / "custom.txt").write_text("camera-change")
        (mapdir / "custom.txt").write_text("map-change")
        original = deploy.os.replace
        def fail(source, target):
            if ".deploy-stage-" in str(source) and Path(target) == mapdir:
                raise OSError("simulated second install failure")
            return original(source, target)
        with patch.object(deploy.os, "replace", side_effect=fail):
            with self.assertRaises(OSError):
                self.execute("-y", str(self.manifest))
        self.assertEqual((cam / "custom.txt").read_text(), "camera-change")
        self.assertEqual((mapdir / "custom.txt").read_text(), "map-change")
        self.assertFalse(list((self.project / "packages").glob(".deploy-old-*")))

    def test_direct_deployment_uses_exact_destination_and_protects_project_root(self) -> None:
        target = self.project / "MyCamera"
        self.execute("-y", "strategy_camera", str(target))
        self.assertEqual((target / "StrategyCamera.gd").read_bytes(), b"camera")
        (self.project / "project.godot").write_text("project")
        with self.assertRaisesRegex(deploy.CopyError, "Refusing to replace"):
            self.execute("-y", "map_system", str(self.project))


if __name__ == "__main__":
    unittest.main()
