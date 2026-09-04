#!/usr/bin/env python3
"""Remove the myAnalyst site block from a Caddyfile, exactly and idempotently.

Used by both setup-remote.sh (to sanitise a backup) and rollback-remote.sh (to
undo). Braces are matched rather than guessed, so a block containing nested
braces - which this one does - comes out whole and nothing after it is lost.
"""
from __future__ import annotations

import sys

SITE = "analyst.gachichio.org"
HEADER = f"# myAnalyst — {SITE}"


def strip(text: str) -> tuple[str, int]:
    """Return the text without any myAnalyst block, and how many were removed."""
    removed = 0
    while True:
        lines = text.split("\n")
        start = next((i for i, l in enumerate(lines) if l.startswith(f"{SITE} {{")), None)
        if start is None:
            return text, removed

        # Walk back over the comment block that introduces it, if it is there.
        first = start
        while first > 0 and (lines[first - 1].startswith("#") or lines[first - 1].strip() == ""):
            first -= 1
        if not any(l.startswith(HEADER) for l in lines[first:start]):
            first = start          # unrelated comments: leave them alone

        depth = 0
        end = None
        for i in range(start, len(lines)):
            depth += lines[i].count("{") - lines[i].count("}")
            if depth == 0:
                end = i
                break
        if end is None:
            raise SystemExit(f"!! the {SITE} block has no closing brace; refusing to guess")

        # Take the blank lines that followed it too, so repeated runs do not
        # leave a growing stack of empty lines behind.
        after = end + 1
        while after < len(lines) and lines[after].strip() == "":
            after += 1
        text = "\n".join(lines[:first] + lines[after:])
        removed += 1


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: caddyfile-block.py <path-to-Caddyfile>", file=sys.stderr)
        return 2
    path = sys.argv[1]
    with open(path) as handle:
        original = handle.read()
    cleaned, removed = strip(original)
    if removed:
        if not cleaned.endswith("\n"):
            cleaned += "\n"
        with open(path, "w") as handle:
            handle.write(cleaned)
    print(f"    {removed} myAnalyst block(s) removed from {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
