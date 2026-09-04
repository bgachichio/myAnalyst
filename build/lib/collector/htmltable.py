"""Extract tables from HTML with the standard library.

No new dependency: `html.parser` is enough for a table, and a scraper is not a
reason to take on a parser with its own CVE feed.

Returns each table as a list of rows of plain strings, so the caller maps
columns by header name rather than by position. A parser pinned to row 7 column
D breaks silently the first time a column moves, and a silent break stores
rubbish.
"""
from __future__ import annotations

import re
from html.parser import HTMLParser

WHITESPACE = re.compile(r"\s+")


class TableExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[str]]] = []
        self._table: list[list[str]] | None = None
        self._row: list[str] | None = None
        self._cell: list[str] | None = None
        self._depth = 0

    def handle_starttag(self, tag: str, _attrs) -> None:
        if tag == "table":
            self._depth += 1
            if self._depth == 1:
                self._table = []
        elif tag == "tr" and self._table is not None:
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []

    def handle_endtag(self, tag: str) -> None:
        if tag in ("td", "th") and self._cell is not None and self._row is not None:
            self._row.append(WHITESPACE.sub(" ", "".join(self._cell)).strip())
            self._cell = None
        elif tag == "tr" and self._row is not None and self._table is not None:
            if any(c for c in self._row):
                self._table.append(self._row)
            self._row = None
        elif tag == "table":
            if self._depth == 1 and self._table is not None:
                if self._table:
                    self.tables.append(self._table)
                self._table = None
            self._depth = max(0, self._depth - 1)

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)


def tables(html: str) -> list[list[list[str]]]:
    parser = TableExtractor()
    parser.feed(html)
    parser.close()
    return parser.tables
