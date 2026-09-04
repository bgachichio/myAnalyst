#!/usr/bin/env python3
"""Build the .pdf fixture from the statement fixture, so there is one source.

Written by hand rather than by a library: a PDF page is a stream of text
positioning operators, the fixture needs nothing else, and a fixture the build
cannot regenerate is a fixture nobody can correct. Each cell is placed at its
own column so the reader has to group runs back into rows to read anything -
which is the part of the PDF path worth testing.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "fixtures" / "statement-lines.json"
TARGET = ROOT / "fixtures" / "statement.pdf"

FONT_SIZE = 9
TOP = 780
LEADING = 18
LABEL_X = 40
COLUMN_X = [250, 320, 420, 500]


def escape(text: str) -> str:
    return text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def content_stream(lines: list[str]) -> bytes:
    out = ["BT", f"/F1 {FONT_SIZE} Tf"]
    for row, line in enumerate(lines):
        y = TOP - row * LEADING
        cells = re.split(r" {2,}", line.strip())
        for index, cell in enumerate(cells):
            if not cell:
                continue
            x = LABEL_X if index == 0 else COLUMN_X[min(index - 1, len(COLUMN_X) - 1)]
            out.append(f"1 0 0 1 {x} {y} Tm ({escape(cell)}) Tj")
    out.append("ET")
    return "\n".join(out).encode("latin-1", "replace")


def build(pages: list[list[str]]) -> bytes:
    objects: list[bytes] = []

    def add(body: bytes) -> int:
        objects.append(body)
        return len(objects)          # object numbers are 1-based

    catalog = add(b"")               # placeholder, filled once the tree is known
    tree = add(b"")
    font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

    page_ids: list[int] = []
    for lines in pages:
        stream = content_stream(lines)
        content = add(b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream))
        page_ids.append(add(
            b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 595 842] "
            b"/Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>"
            % (tree, font, content)
        ))

    kids = b" ".join(b"%d 0 R" % i for i in page_ids)
    objects[catalog - 1] = b"<< /Type /Catalog /Pages %d 0 R >>" % tree
    objects[tree - 1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, len(page_ids))

    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (number, body)

    xref_at = len(out)
    out += b"xref\n0 %d\n" % (len(objects) + 1)
    out += b"0000000000 65535 f \n"
    for offset in offsets[1:]:
        out += b"%010d 00000 n \n" % offset
    out += b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1, catalog, xref_at,
    )
    return bytes(out)


def main() -> None:
    pages = [page["lines"] for page in json.loads(SOURCE.read_text())["pages"]]
    TARGET.write_bytes(build(pages))
    print(f"wrote {TARGET.relative_to(ROOT)}: {len(pages)} pages, {TARGET.stat().st_size} bytes")


if __name__ == "__main__":
    main()
