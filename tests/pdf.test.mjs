/**
 * The PDF reader, end to end, on a real PDF.
 *
 * fixtures/statement.pdf is written from fixtures/statement-lines.json by
 * scripts/make-statement-pdf.py, with each cell placed at its own column, so
 * the reader has to group positioned runs back into rows before any label
 * means anything. The bar is the same as the other two paths: the twelve UNGA
 * figures, to the shilling.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { extract } from "../dist-kernel/extract.js";
import { readPdf } from "../dist-kernel/pdf.js";

const here = dirname(fileURLToPath(import.meta.url));
const kernel = JSON.parse(readFileSync(join(here, "..", "fixtures", "kernel-fixtures.json"), "utf8"));
const UNGA = kernel.cases.find((c) => c.ticker === "UNGA").inputs;

const buffer = () => {
  const b = readFileSync(join(here, "..", "fixtures", "statement.pdf"));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

test("the reader opens a PDF and reports its progress by page", async () => {
  const seen = [];
  const lines = await readPdf(buffer(), (p) => seen.push(p));
  assert.deepEqual(seen, [{ page: 1, pages: 3 }, { page: 2, pages: 3 }, { page: 3, pages: 3 }]);
  assert.ok(lines.length > 30, `only ${lines.length} lines`);
  assert.ok(lines.every((l) => /^page \d+$/.test(l.page)));
});

test("columns come back as one row, not as separate lines", async () => {
  const lines = await readPdf(buffer());
  const income = lines.find((l) => l.text.startsWith("Total income"));
  assert.ok(income, "the income line was not found at all");
  assert.deepEqual(income.numbers.map((n) => n.value), [3, 19864152, 18341006]);
});

test("the extractor reaches the UNGA figures from the PDF alone", async () => {
  const got = extract(await readPdf(buffer()));
  assert.equal(got.scale, 1000);
  for (const [key, expected] of Object.entries(UNGA)) {
    const c = got.candidates[key];
    assert.ok(c, `${key} was not found`);
    assert.equal(c.value, expected, `${key} read as ${c.value} off "${c.label}" on ${c.page}`);
  }
  assert.deepEqual(got.missing, []);
});
