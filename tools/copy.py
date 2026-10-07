#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


MANIFEST_NAME = "manifest.json"


class CopyToolError(Exception):
    pass


@dataclass(frozen=True)
class CopyOperation:
    package: str
    source: Path
    destination: Path


@dataclass(frozen=True)
class CopyPlan:
    new: tuple[CopyOperation, ...]
    identical: tuple[CopyOperation, ...]
    conflicts: tuple[CopyOperation, ...]


@dataclass(frozen=True)
class CopyResult:
    copied: int
    overwritten: int
    skipped_identical: int
    skipped_by_user: int


def load_json(path: Path) -> object:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError as exc:
        raise CopyToolError(f"Manifest not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise CopyToolError(
            f"Invalid JSON in {path}: line {exc.lineno}, column {exc.colno}: {exc.msg}"
        ) from exc
    except OSError as exc:
        raise CopyToolError(f"Could not read {path}: {exc}") from exc


def require_object(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise CopyToolError(f"{label} must contain a JSON object.")
    return value


def package_directory(repo_root: Path, package: str) -> Path:
    if not package or package in {".", ".."} or Path(package).name != package:
        raise CopyToolError(f"Invalid package name: {package!r}")

    directory = repo_root / package
    if not directory.is_dir():
        raise CopyToolError(f"Unknown package: {package}")
    return directory


def load_package_files(repo_root: Path, package: str) -> tuple[Path, ...]:
    directory = package_directory(repo_root, package)
    manifest_path = directory / MANIFEST_NAME
    data = require_object(load_json(manifest_path), f"Package manifest {manifest_path}")

    if set(data) != {"files"}:
        unexpected = sorted(set(data) - {"files"})
        missing = [] if "files" in data else ["files"]
        details: list[str] = []
        if missing:
            details.append("missing " + ", ".join(missing))
        if unexpected:
            details.append("unexpected " + ", ".join(unexpected))
        raise CopyToolError(
            f"Invalid package manifest {manifest_path}: " + "; ".join(details)
        )

    files = data["files"]
    if not isinstance(files, list) or not files:
        raise CopyToolError(f"{manifest_path}: 'files' must be a non-empty array.")

    resolved_root = directory.resolve()
    seen: set[Path] = set()
    result: list[Path] = []

    for index, entry in enumerate(files, start=1):
        if not isinstance(entry, str) or not entry.strip():
            raise CopyToolError(
                f"{manifest_path}: files[{index - 1}] must be a non-empty string."
            )

        relative = Path(entry)
        if relative.is_absolute():
            raise CopyToolError(f"{manifest_path}: file path must be relative: {entry}")

        declared_source = directory / relative
        if declared_source.is_symlink():
            raise CopyToolError(f"{manifest_path}: symlinks are not allowed: {entry}")

        source = declared_source.resolve()
        try:
            source.relative_to(resolved_root)
        except ValueError as exc:
            raise CopyToolError(
                f"{manifest_path}: file escapes the package directory: {entry}"
            ) from exc

        normalized = source.relative_to(resolved_root)
        if normalized in seen:
            raise CopyToolError(f"{manifest_path}: duplicate file entry: {entry}")
        seen.add(normalized)

        if not source.is_file():
            raise CopyToolError(f"{manifest_path}: listed file does not exist: {entry}")

        result.append(normalized)

    return tuple(result)


def load_project_packages(manifest_path: Path) -> tuple[tuple[str, Path], ...]:
    data = require_object(load_json(manifest_path), f"Project manifest {manifest_path}")
    if set(data) != {"packages"}:
        unexpected = sorted(set(data) - {"packages"})
        missing = [] if "packages" in data else ["packages"]
        details: list[str] = []
        if missing:
            details.append("missing " + ", ".join(missing))
        if unexpected:
            details.append("unexpected " + ", ".join(unexpected))
        raise CopyToolError(
            f"Invalid project manifest {manifest_path}: " + "; ".join(details)
        )

    packages = data["packages"]
    if not isinstance(packages, dict) or not packages:
        raise CopyToolError(f"{manifest_path}: 'packages' must be a non-empty object.")

    result: list[tuple[str, Path]] = []
    base = manifest_path.parent.resolve()

    for package, target in packages.items():
        if not isinstance(package, str) or not package:
            raise CopyToolError(f"{manifest_path}: package names must be non-empty strings.")
        if not isinstance(target, str) or not target.strip():
            raise CopyToolError(
                f"{manifest_path}: target for {package!r} must be a non-empty string."
            )

        target_path = Path(target).expanduser()
        if not target_path.is_absolute():
            target_path = base / target_path
        result.append((package, target_path.resolve()))

    return tuple(result)


def make_operations(
    repo_root: Path, package_targets: Iterable[tuple[str, Path]]
) -> tuple[CopyOperation, ...]:
    operations: list[CopyOperation] = []
    destinations: dict[Path, CopyOperation] = {}

    for package, target_root in package_targets:
        package_root = package_directory(repo_root, package).resolve()
        for relative in load_package_files(repo_root, package):
            operation = CopyOperation(
                package=package,
                source=package_root / relative,
                destination=target_root / relative,
            )
            destination_key = operation.destination.resolve(strict=False)
            previous = destinations.get(destination_key)
            if previous is not None:
                raise CopyToolError(
                    "Multiple package files map to the same destination: "
                    f"{previous.package}:{previous.source.name} and "
                    f"{operation.package}:{operation.source.name} -> {operation.destination}"
                )
            destinations[destination_key] = operation
            operations.append(operation)

    return tuple(operations)


def files_equal(left: Path, right: Path) -> bool:
    if left.stat().st_size != right.stat().st_size:
        return False

    chunk_size = 1024 * 1024
    with left.open("rb") as left_handle, right.open("rb") as right_handle:
        while True:
            left_chunk = left_handle.read(chunk_size)
            right_chunk = right_handle.read(chunk_size)
            if left_chunk != right_chunk:
                return False
            if not left_chunk:
                return True


def build_plan(operations: Iterable[CopyOperation]) -> CopyPlan:
    new: list[CopyOperation] = []
    identical: list[CopyOperation] = []
    conflicts: list[CopyOperation] = []

    for operation in operations:
        destination = operation.destination
        if destination.is_symlink():
            raise CopyToolError(f"Destination is a symlink: {destination}")
        if destination.exists():
            if not destination.is_file():
                raise CopyToolError(
                    f"Destination exists and is not a file: {destination}"
                )
            if files_equal(operation.source, destination):
                identical.append(operation)
            else:
                conflicts.append(operation)
        else:
            new.append(operation)

    return CopyPlan(tuple(new), tuple(identical), tuple(conflicts))


def parse_selection(value: str, maximum: int) -> tuple[int, ...]:
    if maximum < 1:
        raise ValueError("There are no files to select.")

    stripped = value.strip()
    if not stripped:
        raise ValueError("Selection cannot be empty.")

    selected: set[int] = set()
    for raw_part in stripped.split(","):
        part = raw_part.strip()
        if not part:
            raise ValueError("Empty selection item.")

        if "-" in part:
            if part.count("-") != 1:
                raise ValueError(f"Invalid range: {part}")
            start_text, end_text = (piece.strip() for piece in part.split("-", 1))
            if not start_text.isdigit() or not end_text.isdigit():
                raise ValueError(f"Invalid range: {part}")
            start = int(start_text)
            end = int(end_text)
            if start > end:
                raise ValueError(f"Range start is greater than range end: {part}")
            if start < 1 or end > maximum:
                raise ValueError(f"Selection out of range 1-{maximum}: {part}")
            selected.update(range(start, end + 1))
        else:
            if not part.isdigit():
                raise ValueError(f"Invalid selection: {part}")
            number = int(part)
            if number < 1 or number > maximum:
                raise ValueError(f"Selection out of range 1-{maximum}: {part}")
            selected.add(number)

    return tuple(sorted(selected))


def display_path(path: Path, base: Path | None) -> str:
    if base is not None:
        try:
            return str(path.resolve(strict=False).relative_to(base.resolve()))
        except ValueError:
            pass
    return str(path)


def choose_conflicts(
    conflicts: tuple[CopyOperation, ...],
    *,
    assume_yes: bool,
    display_base: Path | None,
) -> tuple[set[int] | None, bool]:
    if not conflicts:
        return set(), False
    if assume_yes:
        return set(range(len(conflicts))), False

    print("Files that would be overwritten:\n")
    for index, operation in enumerate(conflicts, start=1):
        print(f"  {index}. {display_path(operation.destination, display_base)}")

    while True:
        try:
            answer = input("\nOverwrite these files? [y/N/p]: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            return None, True

        if answer in {"", "n", "no"}:
            return None, True
        if answer in {"y", "yes"}:
            return set(range(len(conflicts))), False
        if answer in {"p", "pick"}:
            while True:
                try:
                    raw = input("Pick files to overwrite (e.g. 1, 3, 7-12): ")
                except (EOFError, KeyboardInterrupt):
                    print()
                    return None, True
                try:
                    numbers = parse_selection(raw, len(conflicts))
                except ValueError as exc:
                    print(f"Invalid selection: {exc}")
                    continue
                return {number - 1 for number in numbers}, False

        print("Please enter y, N, or p.")


def validate_destination_parents(operations: Iterable[CopyOperation]) -> None:
    for operation in operations:
        current = operation.destination.parent
        while not current.exists():
            parent = current.parent
            if parent == current:
                break
            current = parent
        if current.exists() and not current.is_dir():
            raise CopyToolError(
                f"Cannot create destination directory below a file: {operation.destination.parent}"
            )


def copy_file_atomic(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=destination.parent,
            prefix=f".{destination.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temp_path = Path(handle.name)
        shutil.copy2(source, temp_path)
        os.replace(temp_path, destination)
        temp_path = None
    finally:
        if temp_path is not None:
            try:
                temp_path.unlink()
            except FileNotFoundError:
                pass


def execute_plan(plan: CopyPlan, selected_conflicts: set[int]) -> CopyResult:
    to_write = list(plan.new)
    selected = [
        operation
        for index, operation in enumerate(plan.conflicts)
        if index in selected_conflicts
    ]
    to_write.extend(selected)
    validate_destination_parents(to_write)

    copied = 0
    overwritten = 0

    for operation in plan.new:
        copy_file_atomic(operation.source, operation.destination)
        copied += 1

    for index, operation in enumerate(plan.conflicts):
        if index not in selected_conflicts:
            continue
        copy_file_atomic(operation.source, operation.destination)
        overwritten += 1

    return CopyResult(
        copied=copied,
        overwritten=overwritten,
        skipped_identical=len(plan.identical),
        skipped_by_user=len(plan.conflicts) - overwritten,
    )


def create_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Copy one collection package, or all packages listed in a project manifest."
    )
    parser.add_argument(
        "-y",
        "--yes",
        action="store_true",
        help="overwrite differing existing files without prompting",
    )
    parser.add_argument(
        "source",
        help="package name, or a project manifest path when destination is omitted",
    )
    parser.add_argument(
        "destination",
        nargs="?",
        help="destination directory when copying a single package",
    )
    return parser


def run(argv: list[str] | None = None) -> int:
    args = create_parser().parse_args(argv)
    repo_root = Path(__file__).resolve().parent.parent

    if args.destination is None:
        project_manifest = Path(args.source).expanduser().resolve()
        package_targets = load_project_packages(project_manifest)
        display_base: Path | None = project_manifest.parent
    else:
        target = Path(args.destination).expanduser().resolve()
        package_targets = ((args.source, target),)
        display_base = Path.cwd()

    operations = make_operations(repo_root, package_targets)
    plan = build_plan(operations)

    selected, cancelled = choose_conflicts(
        plan.conflicts,
        assume_yes=args.yes,
        display_base=display_base,
    )
    if cancelled or selected is None:
        print("Cancelled. No files were changed.")
        return 0

    result = execute_plan(plan, selected)
    print(
        f"Copied: {result.copied}\n"
        f"Overwritten: {result.overwritten}\n"
        f"Skipped identical: {result.skipped_identical}\n"
        f"Skipped by user: {result.skipped_by_user}"
    )
    return 0


def main() -> None:
    try:
        raise SystemExit(run())
    except CopyToolError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
    except OSError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
