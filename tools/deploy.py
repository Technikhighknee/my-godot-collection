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


class CopyError(Exception):
    pass


@dataclass(frozen=True)
class FileCopy:
    source: Path
    destination: Path


def read_manifest(path: Path, key: str) -> object:
    if path.is_dir():
        raise CopyError(f"Expected a manifest file, got a directory: {path}")

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise CopyError(f"Manifest not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise CopyError(
            f"Invalid JSON in {path} at line {exc.lineno}, column {exc.colno}: {exc.msg}"
        ) from exc

    if not isinstance(data, dict) or set(data) != {key}:
        raise CopyError(f"{path}: expected exactly one key: {key!r}.")

    return data[key]


def package_files(repo: Path, name: str, target: Path) -> list[FileCopy]:
    if not name or name in {".", ".."} or Path(name).name != name:
        raise CopyError(f"Invalid package name: {name!r}")

    package = repo / name
    if package.is_symlink():
        raise CopyError(f"Package directory may not be a symlink: {name}")

    package = package.resolve()
    if not package.is_dir():
        raise CopyError(f"Unknown package: {name}")

    declared = read_manifest(package / "manifest.json", "files")
    if not isinstance(declared, list) or not declared:
        raise CopyError(f"{package / 'manifest.json'}: 'files' must be a non-empty array.")

    result: list[FileCopy] = []
    seen: set[Path] = set()

    for entry in declared:
        if not isinstance(entry, str) or not entry.strip():
            raise CopyError(f"{package / 'manifest.json'}: every file must be a non-empty string.")

        relative = Path(entry)
        source = package / relative

        if relative.is_absolute():
            raise CopyError(f"{package / 'manifest.json'}: file must be relative: {entry}")
        if source.is_symlink():
            raise CopyError(f"{package / 'manifest.json'}: symlinks are not allowed: {entry}")

        source = source.resolve()
        try:
            relative = source.relative_to(package)
        except ValueError as exc:
            raise CopyError(f"{package / 'manifest.json'}: file escapes package: {entry}") from exc

        if relative in seen:
            raise CopyError(f"{package / 'manifest.json'}: duplicate file: {entry}")
        if not source.is_file():
            raise CopyError(f"{package / 'manifest.json'}: file does not exist: {entry}")

        seen.add(relative)
        result.append(FileCopy(source, target / relative))

    return result


def project_packages(path: Path) -> list[tuple[str, Path]]:
    path = path.resolve()
    declared = read_manifest(path, "packages")

    if not isinstance(declared, dict) or not declared:
        raise CopyError(f"{path}: 'packages' must be a non-empty object.")

    result: list[tuple[str, Path]] = []
    for name, target in declared.items():
        if not isinstance(name, str) or not name:
            raise CopyError(f"{path}: package names must be non-empty strings.")
        if not isinstance(target, str) or not target.strip():
            raise CopyError(f"{path}: target for {name!r} must be a non-empty string.")

        destination = Path(target).expanduser()
        if not destination.is_absolute():
            destination = path.parent / destination

        result.append((name, destination.resolve()))

    return result


def collect_files(repo: Path, packages: list[tuple[str, Path]]) -> list[FileCopy]:
    result: list[FileCopy] = []
    destinations: set[Path] = set()

    for name, target in packages:
        for item in package_files(repo, name, target):
            destination = item.destination.resolve(strict=False)
            if destination in destinations:
                raise CopyError(f"Multiple package files map to: {item.destination}")

            destinations.add(destination)
            result.append(item)

    return result


def classify(files: list[FileCopy]) -> tuple[list[FileCopy], list[FileCopy], list[FileCopy]]:
    new: list[FileCopy] = []
    identical: list[FileCopy] = []
    changed: list[FileCopy] = []

    for item in files:
        target = item.destination

        if target.is_symlink():
            raise CopyError(f"Destination is a symlink: {target}")
        if not target.exists():
            new.append(item)
        elif not target.is_file():
            raise CopyError(f"Destination exists and is not a file: {target}")
        elif same_contents(item.source, target):
            identical.append(item)
        else:
            changed.append(item)

    return new, identical, changed


def same_contents(left: Path, right: Path) -> bool:
    if left.stat().st_size != right.stat().st_size:
        return False

    with left.open("rb") as a, right.open("rb") as b:
        while chunk := a.read(1024 * 1024):
            if chunk != b.read(len(chunk)):
                return False
        return not b.read(1)


def parse_selection(text: str, maximum: int) -> set[int]:
    if not text.strip():
        raise ValueError("Selection cannot be empty.")

    selected: set[int] = set()

    for raw in text.split(","):
        part = raw.strip()
        if not part:
            raise ValueError("Empty selection item.")

        if "-" in part:
            if part.count("-") != 1:
                raise ValueError(f"Invalid range: {part}")

            start_text, end_text = map(str.strip, part.split("-", 1))
            if not start_text.isdigit() or not end_text.isdigit():
                raise ValueError(f"Invalid range: {part}")

            start, end = int(start_text), int(end_text)
            if start > end:
                raise ValueError(f"Range start is greater than range end: {part}")
            numbers = range(start, end + 1)
        else:
            if not part.isdigit():
                raise ValueError(f"Invalid selection: {part}")
            numbers = (int(part),)

        for number in numbers:
            if not 1 <= number <= maximum:
                raise ValueError(f"Selection out of range 1-{maximum}: {number}")
            selected.add(number - 1)

    return selected


def choose_overwrites(changed: list[FileCopy], yes: bool, display_base: Path) -> set[int] | None:
    if not changed:
        return set()
    if yes:
        return set(range(len(changed)))

    print("Files that would be overwritten:\n")
    for number, item in enumerate(changed, 1):
        print(f"  {number}. {display_path(item.destination, display_base)}")

    while True:
        try:
            answer = input("\nOverwrite these files? [y/N/p]: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            return None

        if answer in {"", "n", "no"}:
            return None
        if answer in {"y", "yes"}:
            return set(range(len(changed)))
        if answer in {"p", "pick"}:
            return pick_files(len(changed))

        print("Please enter y, N, or p.")


def pick_files(maximum: int) -> set[int] | None:
    while True:
        try:
            text = input("Pick files to overwrite (e.g. 1, 3, 7-12): ")
        except (EOFError, KeyboardInterrupt):
            print()
            return None

        try:
            return parse_selection(text, maximum)
        except ValueError as exc:
            print(f"Invalid selection: {exc}")


def display_path(path: Path, base: Path) -> str:
    try:
        return str(path.resolve(strict=False).relative_to(base.resolve()))
    except ValueError:
        return str(path)


def copy_file(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)

    temp: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as handle:
            temp = Path(handle.name)

        shutil.copy2(source, temp)
        os.replace(temp, destination)
        temp = None
    finally:
        if temp is not None:
            temp.unlink(missing_ok=True)


def validate_parents(files: list[FileCopy]) -> None:
    for item in files:
        parent = item.destination.parent
        while not parent.exists() and parent != parent.parent:
            parent = parent.parent
        if parent.exists() and not parent.is_dir():
            raise CopyError(f"Cannot create directory below a file: {item.destination.parent}")


def arguments(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("-y", "--yes", action="store_true")
    parser.add_argument("source")
    parser.add_argument("destination", nargs="?")
    return parser.parse_args(argv)


def run(argv: list[str] | None = None) -> int:
    args = arguments(argv)
    repo = Path(__file__).resolve().parent.parent

    if args.destination:
        packages = [(args.source, Path(args.destination).expanduser().resolve())]
        display_base = Path.cwd()
    else:
        package = repo / args.source
        if package.is_dir() and (package / "manifest.json").is_file():
            raise CopyError(
                f"Destination missing for package {args.source!r}. "
                f"Usage: deploy.py {args.source} <destination>"
            )

        manifest = Path(args.source).expanduser().resolve()
        packages = project_packages(manifest)
        display_base = manifest.parent

    new, identical, changed = classify(collect_files(repo, packages))
    overwrite = choose_overwrites(changed, args.yes, display_base)

    if overwrite is None:
        print("Cancelled. No files were changed.")
        return 0

    selected = [item for index, item in enumerate(changed) if index in overwrite]
    validate_parents([*new, *selected])

    for item in [*new, *selected]:
        copy_file(item.source, item.destination)

    print(
        f"Copied: {len(new)}\n"
        f"Overwritten: {len(selected)}\n"
        f"Skipped identical: {len(identical)}\n"
        f"Skipped by user: {len(changed) - len(selected)}"
    )
    return 0


def main() -> None:
    try:
        raise SystemExit(run())
    except (CopyError, OSError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
