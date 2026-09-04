/**
 * The spreadsheet reader, round-tripped.
 *
 * fixtures/statement.xlsx is written from fixtures/statement-lines.json by
 * scripts/make-statement-workbook.py, so the text fixture and the binary one
 * cannot disagree. The bar is the same as for the PDF path: the twelve UNGA
 * figures, to the shilling, off the file alone.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { extract } from "../dist-kernel/extract.js";
import { decodeXml, parseSharedStrings, parseSheet, parseSheetNames, readXlsx } from "../dist-kernel/xlsx.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "..", "fixtures", "statement.xlsx");
const kernel = JSON.parse(readFileSync(join(here, "..", "fixtures", "kernel-fixtures.json"), "utf8"));
const UNGA = kernel.cases.find((c) => c.ticker === "UNGA").inputs;

const buffer = () => {
  const b = readFileSync(fixture);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

test("xml entities come back as the characters they stand for", () => {
  assert.equal(decodeXml("Smith &amp; Co &lt;Ltd&gt;"), "Smith & Co <Ltd>");
  assert.equal(decodeXml("KShs &#8217;000"), "KShs ’000");
  assert.equal(decodeXml("&#x2019;"), "’");
  assert.equal(decodeXml("&unknown;"), "&unknown;");
});

test("shared strings are read in the order cells refer to them", () => {
  const xml = `<sst><si><t>Total income</t></si><si><r><t>Cash and </t></r><r><t>bank</t></r></si></sst>`;
  assert.deepEqual(parseSharedStrings(xml), ["Total income", "Cash and bank"]);
});

test("sheet names are read in workbook order", () => {
  const xml = `<sheets><sheet name="P&amp;L" sheetId="1"/><sheet name="Balance" sheetId="2"/></sheets>`;
  assert.deepEqual(parseSheetNames(xml), ["P&L", "Balance"]);
});

test("a row of cells becomes a line of text", () => {
  const shared = ["Total income"];
  const xml = `<sheetData><row r="1">` +
    `<c r="A1" t="s"><v>0</v></c><c r="B1"><v>19864152</v></c><c r="C1"><v>18341006</v></c>` +
    `</row><row r="2"><c r="A2" t="inlineStr"><is><t>Note</t></is></c></row></sheetData>`;
  assert.deepEqual(parseSheet(xml, shared), ["Total income   19864152   18341006", "Note"]);
});

test("empty cells are dropped rather than padded", () => {
  const xml = `<sheetData><row r="1"><c r="A1"/><c r="B1"><v>5</v></c></row></sheetData>`;
  assert.deepEqual(parseSheet(xml, []), ["5"]);
});

test("the reader opens a real workbook and names the sheet each line came from", async () => {
  const lines = await readXlsx(buffer());
  assert.ok(lines.length > 30, `only ${lines.length} lines`);
  assert.ok(lines.some((l) => l.page === "page 12"));
  assert.ok(lines.some((l) => l.page === "page 13"));
  assert.ok(lines.every((l) => l.text.trim() !== ""));
});

test("the extractor reaches the UNGA figures from the workbook alone", async () => {
  const got = extract(await readXlsx(buffer()));
  assert.equal(got.scale, 1000);
  for (const [key, expected] of Object.entries(UNGA)) {
    const c = got.candidates[key];
    assert.ok(c, `${key} was not found`);
    assert.equal(c.value, expected, `${key} read as ${c.value} off "${c.label}" on ${c.page}`);
  }
});

test("a file that is not a zip is refused by name, not by stack trace", async () => {
  await assert.rejects(
    () => readXlsx(new TextEncoder().encode("this is a csv, not a workbook").buffer),
    /not a zip archive/,
  );
});

test("a zip that is not a workbook says what is missing", async () => {
  // A minimal, valid, empty zip: end-of-central-directory record and nothing else.
  const empty = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]);
  await assert.rejects(() => readXlsx(empty.buffer), /xl\/workbook\.xml/);
});
