from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "tools" / "copy.py"
SPEC = importlib.util.spec_from_file_location("collection_copy", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
copy_tool = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = copy_tool
SPEC.loader.exec_module(copy_tool)


class SelectionTests(unittest.TestCase):
    def test_accepts_unsorted_duplicates_spaces_and_ranges(self) -> None:
        self.assertEqual(
            copy_tool.parse_selection("1, 2, 6, 7,8,3,    9, 2, 18, 20-35", 35),
            (1, 2, 3, 6, 7, 8, 9, 18, *range(20, 36)),
        )

    def test_rejects_invalid_selection_atomically(self) -> None:
        for value in ("", "1, potato, 7", "0", "6-3", "1,,2", "1-99"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                copy_tool.parse_selection(value, 10)


class CopyToolTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.package = self.repo / "example"
        self.package.mkdir(parents=True)
        (self.repo / "tools").mkdir()

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

    def test_plan_distinguishes_new_identical_and_conflicting(self) -> None:
        target = self.root / "target"
        target.mkdir()
        (target / "one.txt").write_bytes(b"one-old")
        (target / "same.txt").write_bytes(b"same")

        operations = copy_tool.make_operations(self.repo, (("example", target),))
        plan = copy_tool.build_plan(operations)

        self.assertEqual([op.destination.name for op in plan.conflicts], ["one.txt"])
        self.assertEqual([op.destination.name for op in plan.identical], ["same.txt"])
        self.assertEqual([op.destination.name for op in plan.new], ["two.bin"])

    def test_pick_overwrites_only_selected_conflicts_and_copies_new_files(self) -> None:
        target = self.root / "target"
        target.mkdir()
        (target / "one.txt").write_bytes(b"one-old")
        (target / "nested").mkdir()
        (target / "nested" / "two.bin").write_bytes(b"old-two")

        operations = copy_tool.make_operations(self.repo, (("example", target),))
        plan = copy_tool.build_plan(operations)
        result = copy_tool.execute_plan(plan, {1})

        self.assertEqual((target / "one.txt").read_bytes(), b"one-old")
        self.assertEqual((target / "nested" / "two.bin").read_bytes(), b"\x00\x01\x02")
        self.assertEqual((target / "same.txt").read_bytes(), b"same")
        self.assertEqual(result.copied, 1)
        self.assertEqual(result.overwritten, 1)
        self.assertEqual(result.skipped_by_user, 1)

    def test_project_manifest_targets_are_relative_to_manifest(self) -> None:
        project = self.root / "project"
        project.mkdir()
        manifest = project / "manifest.json"
        manifest.write_text(
            json.dumps({"packages": {"example": "src/example"}}), encoding="utf-8"
        )

        targets = copy_tool.load_project_packages(manifest)
        self.assertEqual(targets, (("example", (project / "src/example").resolve()),))

    def test_package_manifest_cannot_escape_package_directory(self) -> None:
        (self.repo / "outside.txt").write_text("nope", encoding="utf-8")
        (self.package / "manifest.json").write_text(
            json.dumps({"files": ["../outside.txt"]}), encoding="utf-8"
        )

        with self.assertRaises(copy_tool.CopyToolError):
            copy_tool.load_package_files(self.repo, "example")

    def test_duplicate_destinations_across_packages_are_rejected(self) -> None:
        second = self.repo / "other"
        second.mkdir()
        (second / "one.txt").write_text("other", encoding="utf-8")
        (second / "manifest.json").write_text(
            json.dumps({"files": ["one.txt"]}), encoding="utf-8"
        )

        with self.assertRaises(copy_tool.CopyToolError):
            copy_tool.make_operations(
                self.repo,
                (("example", self.root / "target"), ("other", self.root / "target")),
            )

    def test_no_cancels_without_writing(self) -> None:
        target = self.root / "target"
        target.mkdir()
        (target / "one.txt").write_bytes(b"one-old")

        operations = copy_tool.make_operations(self.repo, (("example", target),))
        plan = copy_tool.build_plan(operations)

        with patch("builtins.input", return_value=""):
            selected, cancelled = copy_tool.choose_conflicts(
                plan.conflicts, assume_yes=False, display_base=self.root
            )

        self.assertIsNone(selected)
        self.assertTrue(cancelled)
        self.assertEqual((target / "one.txt").read_bytes(), b"one-old")
        self.assertFalse((target / "nested" / "two.bin").exists())


if __name__ == "__main__":
    unittest.main()
