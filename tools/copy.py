#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from package_copy import CopyError, CopyPlan, apply_plan, build_plan, read_project_manifest


def parse_selection(text: str, maximum: int) -> set[int]:
    """Parse '1, 3, 7-10' into zero-based indexes."""
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
            if number < 1 or number > maximum:
                raise ValueError(f"Selection out of range 1-{maximum}: {number}")
            selected.add(number - 1)

    return selected


def ask_what_to_overwrite(
    plan: CopyPlan,
    *,
    assume_yes: bool,
    display_base: Path,
) -> set[int] | None:
    if not plan.changed:
        return set()
    if assume_yes:
        return set(range(len(plan.changed)))

    print("Files that would be overwritten:\n")
    for number, item in enumerate(plan.changed, start=1):
        print(f"  {number}. {_display_path(item.destination, display_base)}")

    while True:
        try:
            answer = input("\nOverwrite these files? [y/N/p]: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            return None

        if answer in {"", "n", "no"}:
            return None
        if answer in {"y", "yes"}:
            return set(range(len(plan.changed)))
        if answer in {"p", "pick"}:
            return _pick_files(len(plan.changed))

        print("Please enter y, N, or p.")


def _pick_files(maximum: int) -> set[int] | None:
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


def _display_path(path: Path, base: Path) -> str:
    try:
        return str(path.resolve(strict=False).relative_to(base.resolve()))
    except ValueError:
        return str(path)


def _arguments(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Copy a collection package to a directory, or copy packages from a project manifest."
    )
    parser.add_argument(
        "-y",
        "--yes",
        action="store_true",
        help="overwrite changed existing files without prompting",
    )
    parser.add_argument(
        "source",
        help="package name, or project manifest when destination is omitted",
    )
    parser.add_argument(
        "destination",
        nargs="?",
        help="destination directory for a single package",
    )
    return parser.parse_args(argv)


def run(argv: list[str] | None = None) -> int:
    args = _arguments(argv)
    repo_root = Path(__file__).resolve().parent.parent

    if args.destination:
        packages = ((args.source, Path(args.destination).expanduser().resolve()),)
        display_base = Path.cwd()
    else:
        manifest = Path(args.source).expanduser().resolve()
        packages = read_project_manifest(manifest)
        display_base = manifest.parent

    plan = build_plan(repo_root, packages)
    overwrite = ask_what_to_overwrite(
        plan,
        assume_yes=args.yes,
        display_base=display_base,
    )

    if overwrite is None:
        print("Cancelled. No files were changed.")
        return 0

    copied, overwritten, identical, skipped = apply_plan(plan, overwrite)
    print(
        f"Copied: {copied}\n"
        f"Overwritten: {overwritten}\n"
        f"Skipped identical: {identical}\n"
        f"Skipped by user: {skipped}"
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
