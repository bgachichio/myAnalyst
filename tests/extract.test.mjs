/**
 * The reader, against a statement laid out the way Kenyan reports lay them out.
 *
 * The bar: from the statement fixture alone it must reproduce the UNGA inputs
 * in kernel-fixtures.json, to the shilling. A reader that is merely plausible
 * is a reader that quietly puts the wrong number into a verdict.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  CONFIDENT, FLOOR, detectPeriods, detectScale, extract, normalise, parseNumbers, reconcile,
} from "../dist-kernel/extract.js";
import { groupIntoRows } from "../dist-kernel/pdf.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => JSON.parse(readFileSync(join(here, "..", "fixtures", name), "utf8"));
const statement = read("statement-lines.json");
const kernel = read("kernel-fixtures.json");
const UNGA = kernel.cases.find((c) => c.ticker === "UNGA").inputs;

const LINES = statement.pages.flatMap((p) =>
  p.lines.map((text) => ({ page: p.page, text, numbers: parseNumbers(text) })),
);

test("numbers are read the way accountants write them", () => {
  assert.deepEqual(parseNumbers("Total income   3   19,864,152   18,341,006").map((n) => n.value),
    [3, 19864152, 18341006]);
  assert.deepEqual(parseNumbers("Loss for the year   (1,234)   (987)").map((n) => n.value),
    [-1234, -987]);
  assert.deepEqual(parseNumbers("Dividend per share   1.00   0.75").map((n) => n.value), [1, 0.75]);
  assert.deepEqual(parseNumbers("Return on equity   14.2%   12.8%").map((n) => n.value), []);
  assert.equal(parseNumbers("Note   2016   2015")[0].looksLikeYear, true);
  assert.equal(parseNumbers("Total income   19,864,152")[0].looksLikeYear, false);
});

test("labels normalise to something a pattern can match", () => {
  assert.equal(normalise("  TOTAL NON-CURRENT ASSETS  "), "total non-current assets");
  assert.equal(normalise("Cash and bank balances   11"), "cash and bank balances 11");
  assert.equal(normalise("KShs ’000"), "kshs '000");
});

test("the reporting scale is detected and reported, never assumed", () => {
  const { scale, note } = detectScale(LINES);
  assert.equal(scale, statement.expect_scale);
  assert.match(note, /thousands/);

  const silent = detectScale([{ page: "p1", text: "Total income 100", numbers: [] }]);
  assert.equal(silent.scale, 1);
  assert.match(silent.note, /No reporting scale stated/);
});

test("the current period column is found from the year header", () => {
  const { years, currentIsFirst } = detectPeriods(LINES);
  assert.deepEqual(years, [2016, 2015]);
  assert.equal(currentIsFirst, statement.expect_current_is_first);

  const reversed = detectPeriods([
    { page: "p1", text: "2015   2016", numbers: parseNumbers("2015   2016") },
  ]);
  assert.equal(reversed.currentIsFirst, false);
});

test("the reader reproduces the UNGA inputs from the statement alone", () => {
  const got = extract(LINES);
  for (const [key, expected] of Object.entries(UNGA)) {
    const c = got.candidates[key];
    assert.ok(c, `${key} was not found at all`);
    assert.equal(c.value, expected, `${key} read as ${c.value} off "${c.label}"`);
  }
  assert.deepEqual(got.missing, []);
});

test("every figure carries the line and the page it came from", () => {
  const got = extract(LINES);
  for (const c of Object.values(got.candidates)) {
    assert.ok(c.label.length > 0, "a figure with no label cannot be checked");
    assert.match(c.page, /^page \d+$/);
    assert.ok(c.confidence >= FLOOR && c.confidence <= 1);
  }
});

test("the balance sheet figures are read confidently; the ambiguous one is not", () => {
  const got = extract(LINES);
  for (const key of ["total_income", "total_expenses", "current_assets", "current_liabilities",
                     "non_current_assets", "non_current_liabilities", "income_tax_expense"]) {
    assert.ok(got.candidates[key].confidence >= CONFIDENT, `${key} should be confident`);
  }
});

test("a share count is never multiplied by the reporting scale", () => {
  const got = extract(LINES);
  assert.equal(got.scale, 1000);
  assert.equal(got.candidates.shares_issued.scale, 1);
  assert.equal(got.candidates.dividend_per_share_proposed.value, 1);
});

test("the prior year is read when the columns run the other way", () => {
  const flipped = LINES.map((l) => ({
    ...l,
    text: l.text.replace("Note   2016   2015", "Note   2015   2016"),
  })).map((l) => ({ ...l, numbers: parseNumbers(l.text) }));
  const got = extract(flipped);
  assert.equal(got.currentIsFirstColumn, false);
  assert.equal(got.candidates.total_income.value, 18_341_006_000);
  assert.ok(got.notes.some((n) => n.includes("oldest first")));
});

test("a statement that does not reconcile says so", () => {
  const notes = reconcile({
    total_income: { value: 100 }, total_expenses: { value: 20 },
    income_tax_expense: { value: 5 }, net_profit_from_operations: { value: 12 },
  });
  assert.ok(notes.some((n) => n.includes("do not reconcile")));

  const quiet = reconcile({
    total_income: { value: 100 }, total_expenses: { value: 80 },
    income_tax_expense: { value: 5 }, net_profit_from_operations: { value: 15 },
  });
  assert.deepEqual(quiet, []);
});

test("cash larger than current assets is caught", () => {
  const notes = reconcile({ current_assets: { value: 10 }, cash_and_bank: { value: 99 } });
  assert.ok(notes.some((n) => n.includes("wrong line")));
});

test("a share count read in thousands is caught by the earnings per share", () => {
  const notes = reconcile({
    net_profit_from_operations: { value: 508_816_000 }, shares_issued: { value: 75_707 },
  });
  assert.ok(notes.some((n) => n.includes("read in thousands")));
});

test("nothing is offered when nothing matches", () => {
  const got = extract([{ page: "p1", text: "Chairman's statement", numbers: [] }]);
  assert.deepEqual(Object.keys(got.candidates), []);
  assert.equal(got.missing.length, 12);
});

test("positioned runs are grouped back into table rows", () => {
  const rows = groupIntoRows([
    { text: "Total income", x: 40, y: 700, width: 60 },
    { text: "19,864,152", x: 300, y: 700.5, width: 50 },
    { text: "18,341,006", x: 400, y: 699, width: 50 },
    { text: "Total expenses", x: 40, y: 680, width: 70 },
    { text: "19,079,843", x: 300, y: 680, width: 50 },
  ]);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /^Total income\s+19,864,152\s+18,341,006$/);
  assert.deepEqual(parseNumbers(rows[0]).map((n) => n.value), [19864152, 18341006]);
});

test("the comparative column comes back with the current one", () => {
  const got = extract(LINES);
  assert.equal(got.candidates.total_income.value, 19_864_152_000);
  assert.equal(got.candidates.total_income.priorValue, 18_341_006_000);
  assert.equal(got.candidates.dividend_per_share_proposed.priorValue, 0.75);
  assert.equal(got.candidates.shares_issued.priorValue, 75_706_986);
});

test("a line with one column offers no comparative", () => {
  const got = extract([{ page: "p1", text: "Total income   19,864,152", numbers: parseNumbers("Total income   19,864,152") }]);
  assert.equal(got.candidates.total_income.value, 19_864_152);
  assert.equal(got.candidates.total_income.priorValue, null);
});
