/**
 * Comparing counters priced in different worlds.
 *
 * The failure worth guarding against is the comfortable one: comparing a
 * Johannesburg multiple with a Nairobi multiple as quoted, and concluding that
 * Nairobi is cheap when what is cheap is the rand's discount rate.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { compare, restateMultiple, summarise } from "../dist-kernel/compare.js";

const memo = (over) => ({
  id: "x", savedAt: "2026-09-04T00:00:00Z", name: "A counter", sector: "industrial",
  currency: "KES", origin: "nse-feed", price: 28, discountRate: 0.1375, growth: 0.04,
  verdict: "HOLD", margin: 0.11, evEbitda: 6, priceToBook: 0.4, trailingPe: 4.2,
  netYield: 0.034, realYield: -0.045, energyTotal: 3, energyBand: "Mixed", irr: 0.12,
  ...over,
});

test("a multiple on a lower discount rate is worth less once restated up", () => {
  // A rand rate of 9% against a shilling rate of 13.75%, both growing at 4%.
  const r = restateMultiple({ multiple: 10, fromRate: 0.09, toRate: 0.1375, growth: 0.04 });
  assert.equal(r.raw, 10);
  assert.ok(Math.abs(r.factor - 0.05 / 0.0975) < 1e-12);
  assert.ok(Math.abs(r.adjusted - 10 * (0.05 / 0.0975)) < 1e-12);
  assert.ok(r.adjusted < r.raw, "restating to a higher rate must lower the multiple");
  assert.match(r.note, /9\.0% − 4\.0/);
  assert.match(r.note, /13\.8% − 4\.0/);
});

test("the arithmetic is printed, not implied", () => {
  const r = restateMultiple({ multiple: 10, fromRate: 0.09, toRate: 0.1375, growth: 0.04 });
  assert.match(r.note, /0\.513/);
  assert.match(r.note, /rough/);
});

test("restating onto its own rate changes nothing and says so", () => {
  const r = restateMultiple({ multiple: 7.5, fromRate: 0.1375, toRate: 0.1375, growth: 0.04 });
  assert.equal(r.adjusted, 7.5);
  assert.equal(r.factor, 1);
  assert.match(r.note, /nothing to restate/);
});

test("growth at or above a discount rate has no finite multiple", () => {
  const r = restateMultiple({ multiple: 10, fromRate: 0.04, toRate: 0.1375, growth: 0.04 });
  assert.equal(r.adjusted, null);
  assert.match(r.note, /no finite value/);

  const above = restateMultiple({ multiple: 10, fromRate: 0.09, toRate: 0.03, growth: 0.04 });
  assert.equal(above.adjusted, null);
});

test("no EBITDA, no multiple, and the reason is given", () => {
  const r = restateMultiple({ multiple: null, fromRate: 0.09, toRate: 0.1375, growth: 0.04 });
  assert.equal(r.raw, null);
  assert.equal(r.adjusted, null);
  assert.match(r.note, /not positive/);
});

test("the table orders by the adjusted multiple, never the quoted one", () => {
  const nairobi = memo({ id: "1", name: "Nairobi counter", evEbitda: 6, discountRate: 0.1375 });
  const joburg = memo({ id: "2", name: "Joburg counter", currency: "ZAR", origin: "foreign-listed",
                        evEbitda: 10, discountRate: 0.09 });
  const rows = compare([nairobi, joburg], 0.1375, 0.04);
  // Quoted, Johannesburg looks dearer at 10x. Restated it is cheaper at 5.1x.
  assert.deepEqual(rows.map((r) => r.memo.name), ["Joburg counter", "Nairobi counter"]);
  assert.ok(rows[0].evEbitda.adjusted < rows[1].evEbitda.adjusted);
  assert.equal(rows[1].isBenchmark, true);
  assert.equal(rows[0].isBenchmark, false);
});

test("a counter with no multiple sorts last rather than first", () => {
  const rows = compare([memo({ id: "1", name: "No EBITDA", evEbitda: null }),
                        memo({ id: "2", name: "Has one", evEbitda: 6 })], 0.1375, 0.04);
  assert.deepEqual(rows.map((r) => r.memo.name), ["Has one", "No EBITDA"]);
});

test("one counter is not a comparison, and the summary says so", () => {
  assert.match(summarise(compare([memo({})], 0.1375, 0.04), 0.1375), /not a comparison/);
  assert.match(summarise([], 0.1375), /Nothing here/);
  const both = summarise(compare([memo({ id: "1", name: "A", evEbitda: 6 }),
                                  memo({ id: "2", name: "B", evEbitda: 10, discountRate: 0.09 })], 0.1375, 0.04), 0.1375);
  assert.match(both, /cheapest/);
  assert.match(both, /restated from the rate each was analysed on/);
});
