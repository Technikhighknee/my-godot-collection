from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "tools" / "deploy.py"
SPEC = importlib.util.spec_from_file_location("collection_copy", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
copy_tool = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(copy_tool)


class SelectionTests(unittest.TestCase):
    def test_accepts_unsorted_duplicates_spaces_and_ranges(self) -> None:
        self.assertEqual(
            copy_tool.parse_selection(
                "1, 2, 6, 7,8,3,    9, 2, 18, 20-35",
                35,
            ),
            {0, 1, 2, 5, 6, 7, 8, 17, *range(19, 35)},
        )

    def test_rejects_invalid_selection(self) -> None:
        for value in ("", "1, potato, 7", "0", "6-3", "1,,2", "1-99"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                copy_tool.parse_selection(value, 10)


class CopyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.package = self.repo / "example"
        self.package.mkdir(parents=True)

        (self.package / "one.txt").write_bytes(b"one-new")
        (self.package / "nested").mkdir()
        (self.package / "nested" / "two.bin").write_bytes(b"\x00\x01\x02")
        (self.package / "same.txt").write_bytes(b"same")
        (self.package / "manifest.json").write_text(
            json.dumps({"files": ["one.txt", "nested/two.bin", "same.txt"]}),
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_classifies_new_identical_and_changed_files(self) -> None:
        target = self.root / "target"
        target.mkdir()
        (target / "one.txt").write_bytes(b"one-old")
        (target / "same.txt").write_bytes(b"same")

        files = copy_tool.package_files(self.repo, "example", target)
        new, identical, changed = copy_tool.classify(files)

        self.assertEqual([item.destination.name for item in changed], ["one.txt"])
        self.assertEqual([item.destination.name for item in identical], ["same.txt"])
        self.assertEqual([item.destination.name for item in new], ["two.bin"])

    def test_only_selected_changed_files_are_overwritten(self) -> None:
        target = self.root / "target"
        target.mkdir()
        (target / "one.txt").write_bytes(b"one-old")
        (target / "nested").mkdir()
        (target / "nested" / "two.bin").write_bytes(b"old-two")

        files = copy_tool.package_files(self.repo, "example", target)
        new, _, changed = copy_tool.classify(files)
        selected = [item for index, item in enumerate(changed) if index in {1}]

        copy_tool.validate_parents([*new, *selected])
        for item in [*new, *selected]:
            copy_tool.copy_file(item.source, item.destination)

        self.assertEqual((target / "one.txt").read_bytes(), b"one-old")
        self.assertEqual((target / "nested" / "two.bin").read_bytes(), b"\x00\x01\x02")
        self.assertEqual((target / "same.txt").read_bytes(), b"same")

    def test_project_targets_are_relative_to_project_manifest(self) -> None:
        project = self.root / "project"
        project.mkdir()
        manifest = project / "manifest.json"
        manifest.write_text(
            json.dumps({"packages": {"example": "src/example"}}),
            encoding="utf-8",
        )

        self.assertEqual(
            copy_tool.project_packages(manifest),
            [("example", (project / "src/example").resolve())],
        )

    def test_package_manifest_cannot_escape_package(self) -> None:
        (self.repo / "outside.txt").write_text("nope", encoding="utf-8")
        (self.package / "manifest.json").write_text(
            json.dumps({"files": ["../outside.txt"]}),
            encoding="utf-8",
        )

        with self.assertRaises(copy_tool.CopyError):
            copy_tool.package_files(self.repo, "example", self.root / "target")

    def test_nested_files_and_obsolete_cleanup(self) -> None:
        target = self.root / "target"
        target.mkdir()
        (target / "GameMap.gd").write_text("old", encoding="utf-8")
        (self.package / "manifest.json").write_text(
            json.dumps({"files": ["one.txt", "nested/two.bin"], "remove": ["GameMap.gd"]}),
            encoding="utf-8",
        )
        planned = copy_tool.collect_files(self.repo, [("example", target)])
        self.assertEqual(
            copy_tool.collect_obsolete_files(self.repo, [("example", target)], planned),
            [target / "GameMap.gd"],
        )
        with patch.object(copy_tool, "__file__", str(self.repo / "tools" / "deploy.py")):
            self.assertEqual(copy_tool.run(["-y", "example", str(target)]), 0)
        self.assertFalse((target / "GameMap.gd").exists())
        self.assertEqual((target / "nested" / "two.bin").read_bytes(), bytes([0, 1, 2]))

    def test_obsolete_cleanup_rejects_traversal(self) -> None:
        (self.package / "manifest.json").write_text(
            json.dumps({"files": ["one.txt"], "remove": ["../outside.txt"]}),
            encoding="utf-8",
        )
        target = self.root / "target"
        planned = copy_tool.collect_files(self.repo, [("example", target)])
        with self.assertRaises(copy_tool.CopyError):
            copy_tool.collect_obsolete_files(self.repo, [("example", target)], planned)

    def test_obsolete_cleanup_can_be_cancelled(self) -> None:
        target = self.root / "target"
        target.mkdir()
        (target / "old.gd").write_text("keep", encoding="utf-8")
        (self.package / "manifest.json").write_text(
            json.dumps({"files": ["one.txt"], "remove": ["old.gd"]}),
            encoding="utf-8",
        )
        with patch.object(copy_tool, "__file__", str(self.repo / "tools" / "deploy.py")):
            with patch("builtins.input", return_value=""):
                self.assertEqual(copy_tool.run(["example", str(target)]), 0)
        self.assertTrue((target / "old.gd").exists())
        self.assertFalse((target / "one.txt").exists())

    def test_duplicate_destinations_are_rejected(self) -> None:
        other = self.repo / "other"
        other.mkdir()
        (other / "one.txt").write_text("other", encoding="utf-8")
        (other / "manifest.json").write_text(
            json.dumps({"files": ["one.txt"]}),
            encoding="utf-8",
        )

        target = self.root / "target"
        with self.assertRaises(copy_tool.CopyError):
            copy_tool.collect_files(
                self.repo,
                [("example", target), ("other", target)],
            )

    def test_package_without_destination_has_clear_error(self) -> None:
        with self.assertRaisesRegex(copy_tool.CopyError, "Destination missing"):
            copy_tool.run(["strategy_camera"])

    def test_directory_is_not_treated_as_manifest_file(self) -> None:
        directory = self.root / "project"
        directory.mkdir()

        with self.assertRaisesRegex(copy_tool.CopyError, "Expected a manifest file"):
            copy_tool.project_packages(directory)

    def test_no_cancels_before_any_write(self) -> None:
        target = self.root / "target"
        target.mkdir()
        (target / "one.txt").write_bytes(b"one-old")

        changed = copy_tool.classify(
            copy_tool.package_files(self.repo, "example", target)
        )[2]

        with patch("builtins.input", return_value=""):
            selected = copy_tool.choose_overwrites(changed, False, self.root)

        self.assertIsNone(selected)
        self.assertEqual((target / "one.txt").read_bytes(), b"one-old")
        self.assertFalse((target / "nested" / "two.bin").exists())


if __name__ == "__main__":
    unittest.main()
