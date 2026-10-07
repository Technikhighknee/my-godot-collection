from __future__ import annotations

import json
import os
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path


MANIFEST_NAME = "manifest.json"


class CopyError(Exception):
    pass


@dataclass(frozen=True)
class FileCopy:
    package: str
    source: Path
    destination: Path


@dataclass(frozen=True)
class CopyPlan:
    new: tuple[FileCopy, ...]
    identical: tuple[FileCopy, ...]
    changed: tuple[FileCopy, ...]


def read_package(repo_root: Path, name: str) -> tuple[Path, tuple[Path, ...]]:
    if not name or Path(name).name != name or name in {".", ".."}:
        raise CopyError(f"Invalid package name: {name!r}")

    root = (repo_root / name).resolve()
    if not root.is_dir():
        raise CopyError(f"Unknown package: {name}")

    manifest = _read_manifest(root / MANIFEST_NAME, "files")
    files = manifest["files"]
    if not isinstance(files, list) or not files:
        raise CopyError(f"{root / MANIFEST_NAME}: 'files' must be a non-empty array.")

    relative_files: list[Path] = []
    seen: set[Path] = set()

    for entry in files:
        if not isinstance(entry, str) or not entry.strip():
            raise CopyError(f"{root / MANIFEST_NAME}: every file must be a non-empty string.")

        relative = Path(entry)
        source = root / relative

        if relative.is_absolute():
            raise CopyError(f"{root / MANIFEST_NAME}: file must be relative: {entry}")
        if source.is_symlink():
            raise CopyError(f"{root / MANIFEST_NAME}: symlinks are not allowed: {entry}")

        resolved = source.resolve()
        try:
            normalized = resolved.relative_to(root)
        except ValueError as exc:
            raise CopyError(f"{root / MANIFEST_NAME}: file escapes package: {entry}") from exc

        if normalized in seen:
            raise CopyError(f"{root / MANIFEST_NAME}: duplicate file: {entry}")
        if not resolved.is_file():
            raise CopyError(f"{root / MANIFEST_NAME}: file does not exist: {entry}")

        seen.add(normalized)
        relative_files.append(normalized)

    return root, tuple(relative_files)


def read_project_manifest(path: Path) -> tuple[tuple[str, Path], ...]:
    path = path.resolve()
    manifest = _read_manifest(path, "packages")
    packages = manifest["packages"]

    if not isinstance(packages, dict) or not packages:
        raise CopyError(f"{path}: 'packages' must be a non-empty object.")

    result: list[tuple[str, Path]] = []
    for name, target in packages.items():
        if not isinstance(name, str) or not name:
            raise CopyError(f"{path}: package names must be non-empty strings.")
        if not isinstance(target, str) or not target.strip():
            raise CopyError(f"{path}: target for {name!r} must be a non-empty string.")

        destination = Path(target).expanduser()
        if not destination.is_absolute():
            destination = path.parent / destination
        result.append((name, destination.resolve()))

    return tuple(result)


def build_plan(repo_root: Path, packages: tuple[tuple[str, Path], ...]) -> CopyPlan:
    files = _collect_files(repo_root, packages)

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
        elif _same_contents(item.source, target):
            identical.append(item)
        else:
            changed.append(item)

    return CopyPlan(tuple(new), tuple(identical), tuple(changed))


def apply_plan(plan: CopyPlan, overwrite: set[int]) -> tuple[int, int, int, int]:
    selected = [
        item
        for index, item in enumerate(plan.changed)
        if index in overwrite
    ]

    _validate_parent_paths((*plan.new, *selected))

    for item in plan.new:
        _copy_atomic(item.source, item.destination)

    for item in selected:
        _copy_atomic(item.source, item.destination)

    return (
        len(plan.new),
        len(selected),
        len(plan.identical),
        len(plan.changed) - len(selected),
    )


def _collect_files(
    repo_root: Path,
    packages: tuple[tuple[str, Path], ...],
) -> tuple[FileCopy, ...]:
    result: list[FileCopy] = []
    destinations: dict[Path, FileCopy] = {}

    for name, target_root in packages:
        package_root, relative_files = read_package(repo_root, name)

        for relative in relative_files:
            item = FileCopy(name, package_root / relative, target_root / relative)
            key = item.destination.resolve(strict=False)

            previous = destinations.get(key)
            if previous:
                raise CopyError(
                    f"Two package files map to the same destination: "
                    f"{previous.package}:{previous.source.name} and "
                    f"{item.package}:{item.source.name} -> {item.destination}"
                )

            destinations[key] = item
            result.append(item)

    return tuple(result)


def _read_manifest(path: Path, required_key: str) -> dict[str, object]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise CopyError(f"Manifest not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise CopyError(
            f"Invalid JSON in {path} at line {exc.lineno}, column {exc.colno}: {exc.msg}"
        ) from exc
    except OSError as exc:
        raise CopyError(f"Could not read {path}: {exc}") from exc

    if not isinstance(data, dict):
        raise CopyError(f"{path}: manifest must be a JSON object.")
    if set(data) != {required_key}:
        raise CopyError(f"{path}: expected exactly one key: {required_key!r}.")

    return data


def _same_contents(left: Path, right: Path) -> bool:
    if left.stat().st_size != right.stat().st_size:
        return False

    with left.open("rb") as a, right.open("rb") as b:
        while True:
            left_chunk = a.read(1024 * 1024)
            if left_chunk != b.read(1024 * 1024):
                return False
            if not left_chunk:
                return True


def _validate_parent_paths(files: tuple[FileCopy, ...]) -> None:
    for item in files:
        parent = item.destination.parent
        while not parent.exists() and parent != parent.parent:
            parent = parent.parent
        if parent.exists() and not parent.is_dir():
            raise CopyError(f"Cannot create directory below a file: {item.destination.parent}")


def _copy_atomic(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)

    temp: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=destination.parent,
            prefix=f".{destination.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temp = Path(handle.name)

        shutil.copy2(source, temp)
        os.replace(temp, destination)
        temp = None
    finally:
        if temp is not None:
            temp.unlink(missing_ok=True)
