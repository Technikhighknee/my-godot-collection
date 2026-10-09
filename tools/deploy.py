#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import uuid
import zipfile
from datetime import datetime
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

    package_root = repo / name
    if package_root.is_symlink():
        raise CopyError(f"Package directory may not be a symlink: {name}")

    # Each deployable package owns a manifest.json at its root.
    package = package_root
    if package.is_symlink():
        raise CopyError(f"Package directory may not be a symlink: {package}")

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


def _name(value: str) -> bool:
    if not isinstance(value, str) or not value or value != value.strip():
        return False
    if value in {".", ".."} or value.endswith(".") or any(c in value for c in '<>:"/\\|?*'):
        return False
    if any(ord(c) < 32 for c in value):
        return False
    return value.split(".", 1)[0].upper() not in {"CON", "PRN", "AUX", "NUL", *[f"COM{i}" for i in range(1, 10)], *[f"LPT{i}" for i in range(1, 10)]}


def project_packages(path: Path) -> list[tuple[str, Path, Path]]:
    path = path.resolve()
    values = read_manifest(path, "packages")
    if not isinstance(values, dict) or not values:
        raise CopyError(f"{path}: 'packages' must be a non-empty object.")
    root = path.parent / "packages"
    if root.is_symlink():
        raise CopyError(f"Package root cannot be a symlink: {root}")
    result = []
    for name, folder in values.items():
        if not _name(name) or not _name(folder) or folder.casefold() == "packages":
            raise CopyError(f"Invalid package/folder: {name!r}: {folder!r}")
        result.append((name, root / folder, path.parent / folder))
    return result


BACKUP_ROOT = Path.home() / ".my-godot-collection" / "backups"


def _backup(folder: Path) -> Path:
    BACKUP_ROOT.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    archive_path = BACKUP_ROOT / f"{folder.name}-{stamp}-{uuid.uuid4().hex[:12]}.zip"
    try:
        with zipfile.ZipFile(archive_path, "x", zipfile.ZIP_DEFLATED) as archive:
            for root, dirs, files in os.walk(folder, followlinks=False):
                for entry in [*dirs, *files]:
                    item = Path(root) / entry
                    if item.is_symlink():
                        raise CopyError(f"Refusing to back up symlink: {item}")
                    rel = item.relative_to(folder.parent).as_posix()
                    if item.is_dir():
                        archive.writestr(rel + "/", "")
                    else:
                        archive.write(item, rel)
    except Exception:
        archive_path.unlink(missing_ok=True)
        raise
    return archive_path


def _plans(repo: Path, specs: list[tuple[str, Path, Path | None]]) -> list[tuple[str, Path, Path | None, list[FileCopy]]]:
    result = []
    used: set[str] = set()
    for name, target, legacy in specs:
        if not _name(name):
            raise CopyError(f"Invalid package name: {name!r}")
        if target == repo.resolve() or target == Path(target.anchor) or (target / "project.godot").is_file():
            raise CopyError(f"Refusing to replace project, repository, or filesystem root: {target}")
        if target.is_symlink() or (target.exists() and not target.is_dir()):
            raise CopyError(f"Destination is not a normal directory: {target}")
        if legacy is not None and (legacy.is_symlink() or (legacy.exists() and not legacy.is_dir())):
            raise CopyError(f"Legacy destination is not a normal directory: {legacy}")
        legacy = legacy if legacy is not None and legacy.exists() else None
        for location in [target, legacy]:
            if location is None:
                continue
            norm = str(location.resolve(strict=False)).casefold()
            if norm in used:
                raise CopyError(f"Package destination overlaps another: {location}")
            used.add(norm)
        result.append((name, target, legacy, package_files(repo, name, target)))
    return result


def _stage(files: list[FileCopy], target: Path) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".deploy-stage-", dir=target.parent))
    try:
        for item in files:
            relative = item.destination.relative_to(target)
            output = stage / relative
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item.source, output)
    except Exception:
        shutil.rmtree(stage)
        raise
    return stage


def _install(plans: list[tuple[str, Path, Path | None, list[FileCopy]]], yes: bool) -> bool:
    print("Installing whole packages (these destination folders are managed):")
    for name, target, old, _ in plans:
        print(f"  {name} -> {target}")
        if old is not None:
            print(f"    retire legacy folder: {old}")
    if not yes:
        try:
            answer = input("Back up and replace these folders? [y/N]: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            return False
        if answer not in {"y", "yes"}:
            return False

    stages: dict[Path, Path] = {}
    moved: list[tuple[Path, Path]] = []
    installed: list[Path] = []
    try:
        for _, target, _, files in plans:
            stages[target] = _stage(files, target)
        # Every existing folder gets a complete off-project backup BEFORE the first swap.
        for _, target, old, _ in plans:
            for folder in [target, old]:
                if folder is not None and folder.exists():
                    print(f"  Backup: {_backup(folder)}")
        try:
            for _, target, old, _ in plans:
                for folder in [target, old]:
                    if folder is not None and folder.exists():
                        rollback = Path(tempfile.mkdtemp(prefix=".deploy-old-", dir=folder.parent))
                        rollback.rmdir()
                        os.replace(folder, rollback)
                        moved.append((folder, rollback))
            for _, target, _, _ in plans:
                os.replace(stages[target], target)
                installed.append(target)
        except Exception:
            for target in reversed(installed):
                shutil.rmtree(target)
            for original, rollback in reversed(moved):
                os.replace(rollback, original)
            raise
    finally:
        for stage in stages.values():
            if stage.exists():
                shutil.rmtree(stage)

    for _, rollback in moved:
        shutil.rmtree(rollback)
    print(f"Deployed {len(plans)} package(s).")
    return True


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
        specs = [(args.source, Path(args.destination).expanduser().resolve(), None)]
    else:
        if (repo / args.source / "manifest.json").is_file():
            raise CopyError(f"Destination missing for package {args.source!r}.")
        specs = project_packages(Path(args.source).expanduser())
    plans = _plans(repo, specs)
    if not _install(plans, args.yes):
        print("Cancelled. No package directories changed.")
    return 0


def main() -> None:
    try:
        raise SystemExit(run())
    except (CopyError, OSError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
