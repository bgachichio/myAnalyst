/**
 * The rest of the memo in the browser, run against the same fixtures as Python.
 * If the two implementations drift, this fails.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { assess, value } from "../dist/kernel.js";
import { BUY, HOLD, SELL, energyScore, hurdles, irr, multiples, verdict } from "../dist/analysis.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, "..", "fixtures", "kernel-fixtures.json"), "utf8"));
const macro = fixtures.macro;
const round = (x, dp = 2) => Number(x.toFixed(dp));

function memo(c) {
  const raw = c.inputs;
  const v = value(raw, c.price, fixtures.params);
  const f = assess(raw, c.sector_profile, fixtures.params);
  const m = multiples({
    entryPrice: v.entryPrice,
    shares: raw.shares_issued,
    cash: raw.cash_and_securities,
    debt: raw.current_liabilities + raw.non_current_liabilities,
    totalIncome: raw.total_income,
    totalExpenses: raw.total_expenses,
    netCapital: v.netCapital,
  });
  const h = hurdles({
    entryPrice: v.entryPrice,
    dividendPerShare: raw.dividend_per_share_proposed,
    withholding: fixtures.params.w,
    inflation: macro.inflation,
    usdRate: macro.usd_kes,
    btcUsd: macro.btc_usd,
  });
  const s = energyScore({
    margin: v.margin,
    netYield: h.netYield,
    inflation: macro.inflation,
    surplus: f.surplus,
    stressedSurplus: f.stressedSurplus,
    liquidityRatio: f.liquidityRatio,
  });
  return { v, f, m, h, s };
}

for (const c of fixtures.cases) {
  test(`${c.ticker} memo figures hold`, () => {
    const { v, m, h, s } = memo(c);
    const e = c.expect.analysis;

    assert.equal(verdict(v.margin), e.verdict);
    assert.equal(round(m.marketCap), e.market_cap);
    assert.equal(round(m.enterpriseValue), e.enterprise_value);
    assert.equal(round(m.ebitda), e.ebitda);
    assert.equal(round(m.evEbitda, 4), e.ev_ebitda);
    assert.equal(round(m.priceToBook, 4), e.price_to_book);

    assert.equal(round(h.grossYield, 4), e.gross_yield);
    assert.equal(round(h.netYield, 4), e.net_yield);
    assert.equal(h.beatsInflation, e.beats_inflation);
    assert.equal(round(h.realYield, 4), e.real_yield);
    assert.equal(round(h.entryInUsd, 4), e.entry_in_usd);

    assert.equal(s.valuation, e.energy.valuation);
    assert.equal(s.yield, e.energy.yield);
    assert.equal(s.growthQuality, e.energy.growth_quality);
    assert.equal(s.total, e.energy.total);
    assert.equal(s.band, e.energy.band);
    assert.ok(s.reasons.length >= 3, "a score with no reasons is a number nobody can argue with");
  });
}

for (const row of fixtures.analysis_cases.verdicts) {
  test(`margin ${row.margin} reads ${row.expect}`, () => {
    assert.equal(verdict(row.margin), row.expect);
  });
}

test("the hold floor moves the verdict", () => {
  assert.equal(verdict(0.10), HOLD);
  assert.equal(verdict(0.10, 0.05), BUY);
  assert.equal(verdict(-0.001), SELL);
});

for (const row of fixtures.analysis_cases.irr) {
  test(`irr ${row.entry} to ${row.exit} over ${row.years}y`, () => {
    const got = irr(row.entry, row.exit, row.years, row.income);
    if (row.expect === null) assert.equal(got, null, "a total loss has no finite rate");
    else assert.equal(round(got, 4), row.expect);
  });
}

test("the irr actually zeroes the npv", () => {
  const [entry, exitValue, years, income] = [28.0, 56.0, 5, 1.0];
  const rate = irr(entry, exitValue, years, income);
  let npv = -entry;
  for (let y = 1; y <= years; y += 1) npv += income / Math.pow(1 + rate, y);
  npv += exitValue / Math.pow(1 + rate, years);
  assert.ok(Math.abs(npv) < 1e-6, `npv was ${npv}`);
});

test("a loss-making company gets no multiple", () => {
  const m = multiples({
    entryPrice: 10, shares: 100, cash: 0, debt: 0,
    totalIncome: 100, totalExpenses: 140, netCapital: -50,
  });
  assert.equal(m.evEbitda, null);
  assert.equal(m.priceToBook, null);
  assert.ok(m.ebitdaNote.includes("EBITA in substance"));
});

test("the currency check never vetoes", () => {
  const base = { entryPrice: 28, dividendPerShare: 1, withholding: 0.05, inflation: 0.079 };
  const withBtc = hurdles({ ...base, usdRate: 103.4, btcUsd: 2200 });
  const without = hurdles(base);
  assert.equal(withBtc.netYield, without.netYield);
  assert.equal(withBtc.beatsInflation, without.beatsInflation);
  assert.equal(without.entryInBtc, null);
  assert.equal(without.entryInUsd, null);
});

test("the score bands span the range", () => {
  const high = energyScore({ margin: 0.5, netYield: 0.15, inflation: 0.079, surplus: 0.2, stressedSurplus: 0.05, liquidityRatio: 2.0 });
  const low = energyScore({ margin: -0.2, netYield: 0, inflation: 0.079, surplus: -0.1, stressedSurplus: -0.3, liquidityRatio: 0.4 });
  assert.equal(high.total, 7);
  assert.equal(high.band, "High energy");
  assert.equal(low.total, 0);
  assert.equal(low.band, "High entropy");
});
