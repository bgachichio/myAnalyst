/**
 * The eight parts, assembled.
 *
 * Only in TypeScript. The kernel is mirrored in Python because both languages
 * compute it; the memo is composition over that kernel and runs only in the
 * browser, so a Python copy would be untested code pretending to be a check.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DEFAULT_MACRO, buildMemo, periodsFromReport } from "../dist-kernel/memo.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, "..", "fixtures", "kernel-fixtures.json"), "utf8"));
const UNGA = fixtures.cases.find((c) => c.ticker === "UNGA");
const MACRO = { ...DEFAULT_MACRO, inflation: fixtures.macro.inflation, usdKes: fixtures.macro.usd_kes, btcUsd: fixtures.macro.btc_usd, cbr: 0.10 };

const memo = (over = {}) => buildMemo({
  inputs: UNGA.inputs,
  price: { amount: UNGA.price, origin: "manual" },
  params: fixtures.params,
  profile: UNGA.sector_profile,
  macro: MACRO,
  periods: [],
  ...over,
});

test("the base case is the parameters as set, and says so", () => {
  const m = memo();
  assert.equal(m.base.verdict, "BUY");
  assert.equal(m.base.valuation.margin, m.base.margin);
  assert.ok(m.base.assumptions.length >= 4);
  assert.ok(m.base.assumptions.some((a) => a.includes("4.0%")), "the growth rate must appear");
  assert.ok(m.base.assumptions.some((a) => a.includes("13.8%") || a.includes("13.7%")), "the discount rate must appear");
});

test("the worst case moves every assumption against the position", () => {
  const m = memo();
  assert.ok(m.worst.margin < m.base.margin, "a worst case that is not worse is a base case in a hat");
  assert.ok(m.worst.assumptions.length >= 3);
  assert.ok(m.worst.assumptions.some((a) => a.includes("2.0%")), "growth cut by two points");
  assert.ok(m.worst.assumptions.some((a) => a.includes("15.8%") || a.includes("15.7%")), "rate raised by two points");
});

test("the deal prices an entry, an exit and the return between them", () => {
  const m = memo();
  assert.ok(m.deal.entryEvEbitda > 0);
  assert.ok(m.deal.exitPricePs > 0);
  assert.ok(m.deal.irr !== null);
  assert.ok(m.deal.worstIrr !== null);
  assert.ok(m.deal.worstIrr < m.deal.irr, "the worst case must return less");
});

test("bitcoin is compared explicitly and the assumption is carried with it", () => {
  const generous = memo({ macro: { ...MACRO, btcAssumedReturn: 0.90 } });
  const meagre = memo({ macro: { ...MACRO, btcAssumedReturn: 0.01 } });
  assert.equal(generous.deal.beatsBitcoin, false);
  assert.equal(meagre.deal.beatsBitcoin, true);
  assert.equal(generous.deal.btcAssumedReturn, 0.90);
  assert.ok(generous.rationale.some((r) => r.includes("bitcoin hurdle")));
  // The comparison is reported; it does not overturn the valuation.
  assert.equal(generous.verdict, meagre.verdict);
});

test("leverage is refused when interest cover is thin", () => {
  const heavy = memo({
    inputs: { ...UNGA.inputs, non_current_liabilities: 40_000_000_000 },
  });
  const lever = heavy.levers.find((l) => l.title === "Leverage");
  assert.ok(lever.action.includes("No case for borrowing"));
  assert.ok(heavy.deal.interestCover < 3);
});

test("every lever names a figure, not a feeling", () => {
  const m = memo();
  assert.ok(m.levers.length >= 4);
  for (const lever of m.levers) {
    assert.ok(/\d/.test(lever.finding), `${lever.title}: the finding cites no number`);
    assert.ok(lever.action.length > 20, `${lever.title}: the action says nothing`);
  }
  assert.deepEqual(
    m.levers.map((l) => l.title).sort(),
    ["Balance sheet", "Cost", "Income", "Leverage", "Multiple"],
  );
});

test("the rationale carries the worst case, the multiple, the hurdle and the score", () => {
  const m = memo();
  assert.ok(m.rationale.some((r) => r.includes("Worst case")));
  assert.ok(m.rationale.some((r) => r.includes("EBITDA")));
  assert.ok(m.rationale.some((r) => r.includes("inflation")));
  assert.ok(m.rationale.some((r) => r.includes("economic energy") || r.includes("of 7")));
  assert.ok(m.rationale.every((r) => /\d/.test(r)), "a bullet with no figure is a feeling");
});

test("the hold floor is what separates the three verdicts", () => {
  const m = memo();
  assert.equal(m.verdict, "BUY");
  assert.equal(memo({ holdFloor: 0.9 }).verdict, "HOLD");
});

test("the three graphs get their periods from the report's own two columns", () => {
  const periods = periodsFromReport("2016", "2015", UNGA.inputs, {
    total_income: 18_341_006_000,
    net_profit_from_operations: 492_781_000,
    current_assets: 5_300_436_000, current_liabilities: 2_305_776_000,
    non_current_assets: 3_085_679_000, non_current_liabilities: 929_433_000,
  });
  assert.deepEqual(periods.map((p) => p.label), ["2015", "2016"]);
  assert.equal(periods[1].totalIncome, UNGA.inputs.total_income);
  assert.equal(periods[0].netAssets, 5_300_436_000 - 2_305_776_000 + 3_085_679_000 - 929_433_000);
  assert.ok(periods[1].netAssets > periods[0].netAssets);
});

test("one period is enough to draw nothing rather than to crash", () => {
  const periods = periodsFromReport("2016", "2015", UNGA.inputs, {});
  assert.equal(periods.length, 1);
  assert.equal(periods[0].label, "2016");
});

test("a company with no dividend is told what that costs it", () => {
  const m = memo({ inputs: { ...UNGA.inputs, dividend_per_share_proposed: 0 } });
  const income = m.levers.find((l) => l.title === "Income");
  assert.ok(income.finding.includes("No dividend"));
  assert.ok(income.action.includes("exit"));
});
