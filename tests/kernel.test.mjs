/**
 * The TypeScript kernel, run against the same fixtures as the Python one.
 * If the two implementations drift, this fails.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { assess, value } from "../dist/kernel.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, "..", "fixtures", "kernel-fixtures.json"), "utf8"));
const round = (x, dp = 2) => Number(x.toFixed(dp));

for (const c of fixtures.cases) {
  test(`${c.ticker} reproduces the workbook`, () => {
    const v = value(c.inputs, c.price, fixtures.params);
    const f = assess(c.inputs, c.sector_profile, fixtures.params);
    const e = c.expect;

    assert.equal(round(v.myFutureEps), e.my_future_eps);
    assert.equal(round(v.myValuation), e.my_valuation);
    assert.equal(round(v.pvDividendsPs), e.pv_dividends_ps);
    assert.equal(round(v.cashPs), e.cash_ps);
    assert.equal(round(v.marketPriceFe), e.market_price_fe);
    assert.equal(v.decision, e.decision);
    assert.equal(round(v.margin, 4), e.margin);
    assert.equal(round(v.eps), e.eps);
    assert.equal(round(v.trailingPe), e.trailing_pe);
    assert.equal(round(v.navPs), e.nav_ps);
    assert.equal(v.cigarButt, e.cigar_butt);

    assert.equal(round(f.liquidityRatio), e.liquidity_ratio);
    assert.equal(round(f.excessCash, 4), e.excess_cash);
    assert.equal(round(f.surplus, 4), e.surplus);
    assert.equal(round(f.stressedSurplus, 4), e.stressed_surplus);
    assert.equal(f.verdict, e.fragility);
  });
}

test("the two sectors take different paths", () => {
  const unga = fixtures.cases.find((c) => c.sector_profile === "industrial");
  const lbty = fixtures.cases.find((c) => c.sector_profile === "insurer");
  assert.notEqual(assess(unga.inputs, "industrial", fixtures.params).focusModelRatio, null);
  assert.equal(assess(lbty.inputs, "insurer", fixtures.params).focusModelRatio, null);
});

test("the transaction cost loads the entry and never the valuation", () => {
  const c = fixtures.cases[0];
  const free = value(c.inputs, c.price, { ...fixtures.params, c: 0 });
  const loaded = value(c.inputs, c.price, { ...fixtures.params, c: 0.026 });
  assert.equal(round(loaded.entryPrice, 6), round(c.price * 1.026, 6));
  assert.ok(loaded.marketPriceFe > free.marketPriceFe);
  assert.equal(loaded.myValuation, free.myValuation);
});

test("parameters refuse nonsense", () => {
  const c = fixtures.cases[0];
  for (const bad of [{ r: 0 }, { k: 1 }, { c: 0.11 }, { w: 1 }, { n: 0 }]) {
    assert.throws(() => value(c.inputs, c.price, { ...fixtures.params, ...bad }), RangeError);
  }
});

test("a hand-typed price reaches the same verdict and says so", () => {
  const c = fixtures.cases[0];
  const fed = value(c.inputs, c.price, fixtures.params);
  const typed = value(c.inputs, { amount: c.price, origin: "manual" }, fixtures.params);
  assert.equal(typed.decision, fed.decision);
  assert.equal(typed.myValuation, fed.myValuation);
  assert.ok(typed.warnings.some((w) => w.includes("entered by hand")));
  assert.equal(fed.warnings.length, 0);
});

test("a foreign price against a shilling rate is flagged", () => {
  const c = fixtures.cases[0];
  const v = value(c.inputs, { amount: c.price, currency: "USD", origin: "foreign-listed" }, fixtures.params);
  assert.ok(v.warnings.some((w) => w.includes("discount rate is a KES rate")));
});

test("a private-deal price must say what it is", () => {
  const c = fixtures.cases[0];
  assert.throws(
    () => value(c.inputs, { amount: c.price, origin: "private-deal" }, fixtures.params),
    RangeError,
  );
  const named = value(c.inputs, { amount: c.price, origin: "private-deal", note: "Series A" }, fixtures.params);
  assert.ok(named.warnings.some((w) => w.includes("not a market price")));
});

test("an unknown currency is refused", () => {
  const c = fixtures.cases[0];
  assert.throws(() => value(c.inputs, { amount: c.price, currency: "XYZ" }, fixtures.params), RangeError);
});
