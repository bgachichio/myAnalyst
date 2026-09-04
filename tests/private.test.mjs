/**
 * The private deal, held against two lenses.
 *
 * The thing worth testing is not that either lens computes: it is that they
 * are allowed to disagree, and that the disagreement reaches the reader
 * instead of being averaged into a number no one holds.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  capitalStack, committee, privateEquityView, qualityOfEarnings, ventureView,
} from "../dist-kernel/private.js";

const PROJECTION = {
  years: 5, exitRevenue: 900_000_000, exitEbitda: 180_000_000,
  exitMultiple: 8, netDebtAtExit: 100_000_000,
};
const TERMS = { investment: 100_000_000, preMoney: 400_000_000, dilutionRetention: 0.7 };
const TODAY = {
  revenue: 300_000_000, ebitda: 45_000_000, netDebt: 20_000_000,
  cashFromOperations: 36_000_000, receivables: 50_000_000,
  largestCustomerShare: 0.18, relatedPartyShare: 0.04,
};
const ANCHOR = { name: "a listed peer", evEbitda: 7.5, illiquidityDiscount: 0.3 };

test("the venture lens backs out what may be paid today", () => {
  const v = ventureView(PROJECTION, TERMS, 0.30);
  assert.equal(v.exitEquity, 180_000_000 * 8 - 100_000_000);
  assert.equal(v.offeredOwnershipNow, 100_000_000 / 500_000_000);
  assert.ok(Math.abs(v.ownershipAtExit - 0.14) < 1e-9);
  assert.ok(Math.abs(v.proceeds - 0.14 * v.exitEquity) < 1e-6);
});

test("clearing the hurdle and beating it are the same statement", () => {
  for (const target of [0.15, 0.25, 0.30, 0.45, 0.60]) {
    const v = ventureView(PROJECTION, TERMS, target);
    assert.equal(v.clears, v.impliedIrr >= target - 1e-9,
      `at ${target}: clears=${v.clears} but irr=${v.impliedIrr}`);
  }
});

test("the supported valuation is the price at which the hurdle is exactly met", () => {
  const target = 0.30;
  const v = ventureView(PROJECTION, TERMS, target);
  const atSupported = ventureView(PROJECTION, { ...TERMS, preMoney: v.supportedValuationToday }, target);
  assert.ok(Math.abs(atSupported.impliedIrr - target) < 1e-6,
    `paying the supported price should return exactly the hurdle, got ${atSupported.impliedIrr}`);
  assert.ok(atSupported.clears);
});

test("dilution is charged to the investor, not ignored", () => {
  const undiluted = ventureView(PROJECTION, { ...TERMS, dilutionRetention: 1 }, 0.30);
  const diluted = ventureView(PROJECTION, TERMS, 0.30);
  assert.ok(diluted.proceeds < undiluted.proceeds);
  assert.ok(diluted.supportedValuationToday < undiluted.supportedValuationToday);
});

test("the illiquidity discount is applied and printed, never folded in", () => {
  const p = privateEquityView(TODAY, ANCHOR, TERMS);
  assert.equal(p.quotedMultiple, 7.5);
  assert.ok(Math.abs(p.appliedMultiple - 5.25) < 1e-12);
  assert.ok(Math.abs(p.enterpriseValue - 236_250_000) < 1e-6, String(p.enterpriseValue));
  assert.equal(p.equityValue, p.enterpriseValue - 20_000_000);
  assert.equal(p.illiquidityDiscount, 0.3);

  const none = privateEquityView(TODAY, { ...ANCHOR, illiquidityDiscount: 0 }, TERMS);
  assert.ok(none.equityValue > p.equityValue, "a discount that changes nothing is not a discount");
});

test("the two lenses are allowed to disagree, and the disagreement is the finding", () => {
  // The exit is rich and today is thin: the venture lens says yes, the other no.
  const vc = ventureView({ ...PROJECTION, exitEbitda: 400_000_000 }, TERMS, 0.30);
  const pe = privateEquityView(TODAY, ANCHOR, TERMS);
  const qoe = qualityOfEarnings(TODAY, PROJECTION);
  const stack = capitalStack({ investment: 100_000_000, debtShare: 0, rate: 0.14, amortYears: 5, ebitda: TODAY.ebitda });

  assert.equal(vc.clears, true);
  assert.equal(pe.clears, false);
  const c = committee(vc, pe, qoe, stack);
  assert.equal(c.agree, false);
  assert.equal(c.recommendation, "HOLD");
  assert.match(c.finding, /rests on the projection/);
  assert.ok(c.ventureSays.length > 0 && c.privateEquitySays.length > 0);
});

test("both lenses clearing is a buy, and neither is a sell", () => {
  const qoe = qualityOfEarnings(TODAY, PROJECTION);
  const stack = capitalStack({ investment: 100_000_000, debtShare: 0, rate: 0.14, amortYears: 5, ebitda: TODAY.ebitda });
  const cheap = { ...TERMS, preMoney: 100_000_000 };
  const both = committee(
    ventureView(PROJECTION, cheap, 0.30), privateEquityView(TODAY, ANCHOR, cheap), qoe, stack);
  assert.equal(both.recommendation, "BUY");

  const dear = { ...TERMS, preMoney: 5_000_000_000 };
  const neither = committee(
    ventureView(PROJECTION, dear, 0.30), privateEquityView(TODAY, ANCHOR, dear), qoe, stack);
  assert.equal(neither.recommendation, "SELL");
});

test("earnings that fail the tests override both lenses", () => {
  const bad = {
    ...TODAY, cashFromOperations: 5_000_000, receivables: 200_000_000,
    largestCustomerShare: 0.6, relatedPartyShare: 0.4,
  };
  const qoe = qualityOfEarnings(bad, PROJECTION);
  assert.ok(qoe.score <= 1, `score was ${qoe.score}`);
  assert.match(qoe.verdict, /not established/);

  const cheap = { ...TERMS, preMoney: 100_000_000 };
  const stack = capitalStack({ investment: 100_000_000, debtShare: 0, rate: 0.14, amortYears: 5, ebitda: bad.ebitda });
  const c = committee(ventureView(PROJECTION, cheap, 0.30), privateEquityView(bad, ANCHOR, cheap), qoe, stack);
  assert.equal(c.recommendation, "SELL", "a cheap price for earnings that are not real is not a buy");
});

test("a missing figure is a finding, not a pass", () => {
  const silent = { ...TODAY, cashFromOperations: null, receivables: null, largestCustomerShare: null, relatedPartyShare: null };
  const qoe = qualityOfEarnings(silent, PROJECTION);
  assert.equal(qoe.score, 1, "four unanswered tests must not read as four passes");
  for (const flag of qoe.flags.slice(0, 4)) assert.equal(flag.failed, true);
});

test("a projection nobody has ever achieved is flagged as one", () => {
  const moonshot = qualityOfEarnings(TODAY, { ...PROJECTION, exitRevenue: 10_000_000_000 });
  const growth = moonshot.flags.find((f) => f.test === "Projected growth");
  assert.equal(growth.failed, true);
  assert.match(growth.finding, /Almost nothing does this/);
});

test("debt is tested against today's earnings, never against the deck", () => {
  const light = capitalStack({ investment: 100_000_000, debtShare: 0.2, rate: 0.14, amortYears: 7, ebitda: 45_000_000 });
  assert.equal(light.debtIn, 20_000_000);
  assert.equal(light.equityIn, 80_000_000);
  assert.ok(light.sustainable);

  const heavy = capitalStack({ investment: 100_000_000, debtShare: 0.9, rate: 0.18, amortYears: 3, ebitda: 45_000_000 });
  assert.equal(heavy.sustainable, false);
  assert.match(heavy.finding, /not a plan/);

  const none = capitalStack({ investment: 100_000_000, debtShare: 0, rate: 0.14, amortYears: 5, ebitda: 45_000_000 });
  assert.equal(none.sustainable, true);
  assert.match(none.finding, /All equity/);
});

test("unserviceable debt holds the verdict back whatever the lenses say", () => {
  const cheap = { ...TERMS, preMoney: 100_000_000 };
  const qoe = qualityOfEarnings(TODAY, PROJECTION);
  const heavy = capitalStack({ investment: 100_000_000, debtShare: 0.9, rate: 0.18, amortYears: 3, ebitda: TODAY.ebitda });
  const c = committee(ventureView(PROJECTION, cheap, 0.30), privateEquityView(TODAY, ANCHOR, cheap), qoe, heavy);
  assert.equal(c.recommendation, "HOLD");
});
