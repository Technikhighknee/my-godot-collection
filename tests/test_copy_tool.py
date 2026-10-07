from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


TOOLS = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))

import package_copy  # noqa: E402


SPEC = importlib.util.spec_from_file_location("collection_copy_cli", TOOLS / "copy.py")
assert SPEC is not None and SPEC.loader is not None
copy_cli = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(copy_cli)


class SelectionTests(unittest.TestCase):
    def test_accepts_unsorted_duplicates_spaces_and_ranges(self) -> None:
        self.assertEqual(
            copy_cli.parse_selection(
                "1, 2, 6, 7,8,3,    9, 2, 18, 20-35",
                35,
            ),
            {0, 1, 2, 5, 6, 7, 8, 17, *range(19, 35)},
        )

    def test_rejects_invalid_selection(self) -> None:
        for value in ("", "1, potato, 7", "0", "6-3", "1,,2", "1-99"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                copy_cli.parse_selection(value, 10)


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

    def test_plan_splits_new_identical_and_changed_files(self) -> None:
        target = self.root / "target"
        target.mkdir()
        (target / "one.txt").write_bytes(b"one-old")
        (target / "same.txt").write_bytes(b"same")

        plan = package_copy.build_plan(
            self.repo,
            (("example", target),),
        )

        self.assertEqual([item.destination.name for item in plan.changed], ["one.txt"])
        self.assertEqual([item.destination.name for item in plan.identical], ["same.txt"])
        self.assertEqual([item.destination.name for item in plan.new], ["two.bin"])

    def test_only_selected_changed_files_are_overwritten(self) -> None:
        target = self.root / "target"
        target.mkdir()
        (target / "one.txt").write_bytes(b"one-old")
        (target / "nested").mkdir()
        (target / "nested" / "two.bin").write_bytes(b"old-two")

        plan = package_copy.build_plan(
            self.repo,
            (("example", target),),
        )
        result = package_copy.apply_plan(plan, {1})

        self.assertEqual((target / "one.txt").read_bytes(), b"one-old")
        self.assertEqual((target / "nested" / "two.bin").read_bytes(), b"\x00\x01\x02")
        self.assertEqual((target / "same.txt").read_bytes(), b"same")
        self.assertEqual(result, (1, 1, 0, 1))

    def test_project_targets_are_relative_to_project_manifest(self) -> None:
        project = self.root / "project"
        project.mkdir()
        manifest = project / "manifest.json"
        manifest.write_text(
            json.dumps({"packages": {"example": "src/example"}}),
            encoding="utf-8",
        )

        self.assertEqual(
            package_copy.read_project_manifest(manifest),
            (("example", (project / "src/example").resolve()),),
        )

    def test_package_manifest_cannot_escape_package(self) -> None:
        (self.repo / "outside.txt").write_text("nope", encoding="utf-8")
        (self.package / "manifest.json").write_text(
            json.dumps({"files": ["../outside.txt"]}),
            encoding="utf-8",
        )

        with self.assertRaises(package_copy.CopyError):
            package_copy.read_package(self.repo, "example")

    def test_duplicate_destinations_are_rejected(self) -> None:
        other = self.repo / "other"
        other.mkdir()
        (other / "one.txt").write_text("other", encoding="utf-8")
        (other / "manifest.json").write_text(
            json.dumps({"files": ["one.txt"]}),
            encoding="utf-8",
        )

        target = self.root / "target"
        with self.assertRaises(package_copy.CopyError):
            package_copy.build_plan(
                self.repo,
                (("example", target), ("other", target)),
            )

    def test_no_cancels_before_any_write(self) -> None:
        target = self.root / "target"
        target.mkdir()
        (target / "one.txt").write_bytes(b"one-old")

        plan = package_copy.build_plan(
            self.repo,
            (("example", target),),
        )

        with patch("builtins.input", return_value=""):
            selected = copy_cli.ask_what_to_overwrite(
                plan,
                assume_yes=False,
                display_base=self.root,
            )

        self.assertIsNone(selected)
        self.assertEqual((target / "one.txt").read_bytes(), b"one-old")
        self.assertFalse((target / "nested" / "two.bin").exists())


if __name__ == "__main__":
    unittest.main()
