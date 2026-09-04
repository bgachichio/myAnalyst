#!/usr/bin/env python3
"""Build the .xlsx fixture from the statement fixture, so there is one source.

The spreadsheet reader is tested by round trip: this writes the same statement
as a real workbook, the reader reads it back, and the extractor is required to
reach the same twelve figures it reaches from the plain text. A hand-built
binary fixture nobody can regenerate is a fixture nobody can correct.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from openpyxl import Workbook

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "fixtures" / "statement-lines.json"
TARGET = ROOT / "fixtures" / "statement.xlsx"

NUMBER = re.compile(r"^\(?-?[\d,]+(?:\.\d+)?\)?$")


def cell(text: str):
    """A cell that looks like a figure is written as one, brackets and all."""
    if not NUMBER.match(text) or not any(c.isdigit() for c in text):
        return text
    negative = text.startswith("(")
    value = float(text.strip("()").replace(",", ""))
    if negative:
        value = -value
    return int(value) if value.is_integer() else value


def main() -> None:
    pages = json.loads(SOURCE.read_text())["pages"]
    book = Workbook()
    book.remove(book.active)
    for page in pages:
        sheet = book.create_sheet(title=page["page"][:31])
        for line in page["lines"]:
            sheet.append([cell(part.strip()) for part in re.split(r" {2,}", line.strip())])
    book.save(TARGET)
    print(f"wrote {TARGET.relative_to(ROOT)}: {len(pages)} sheets")


if __name__ == "__main__":
    main()
