/**
 * The dividend deadline.
 *
 * The failure this guards against is silent and expensive: buying on the
 * closure date, settling three days later, and finding out from the absence of
 * a payment. Every date asserted here was checked against a calendar before it
 * was written down.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SETTLEMENT_DAYS, deadlines, easterSunday, gazettedHolidays, holidaySet,
  isTradingDay, minusTradingDays, tradingDaysBetween,
} from "../dist-kernel/calendar.js";

test("Easter lands where the calendar says it does", () => {
  assert.equal(easterSunday(2024), "2024-03-31");
  assert.equal(easterSunday(2025), "2025-04-20");
  assert.equal(easterSunday(2026), "2026-04-05");
  assert.equal(easterSunday(2027), "2027-03-28");
});

test("Good Friday and Easter Monday move with it", () => {
  const names = new Map(gazettedHolidays(2026).map((h) => [h.name, h.date]));
  assert.equal(names.get("Good Friday"), "2026-04-03");
  assert.equal(names.get("Easter Monday"), "2026-04-06");
  assert.equal(names.get("Madaraka Day"), "2026-06-01");
  assert.equal(names.get("Jamhuri Day"), "2026-12-12");
  assert.equal(gazettedHolidays(2026).length, 10);
});

test("a holiday on a Sunday is observed on the Monday", () => {
  // 1 June 2025 is a Sunday.
  const set = holidaySet(2025);
  assert.equal(set.get("2025-06-01"), "Madaraka Day");
  assert.equal(set.get("2025-06-02"), "Madaraka Day observed");
  // 12 December 2026 is a Saturday, and the Act moves only Sundays.
  assert.equal(holidaySet(2026).has("2026-12-13"), false);
});

test("weekends and holidays are not trading days", () => {
  const holidays = holidaySet(2026);
  assert.equal(isTradingDay("2026-06-12", holidays), true);    // a Friday
  assert.equal(isTradingDay("2026-06-13", holidays), false);   // a Saturday
  assert.equal(isTradingDay("2026-06-14", holidays), false);   // a Sunday
  assert.equal(isTradingDay("2026-06-01", holidays), false);   // Madaraka Day, a Monday
});

test("three trading days back inside one week", () => {
  // Closure Friday 12 June 2026: Thursday, Wednesday, Tuesday.
  assert.equal(minusTradingDays("2026-06-12", 3, holidaySet(2026)), "2026-06-09");
});

test("three trading days back across a weekend", () => {
  // Closure Tuesday 16 June 2026: Monday, then Friday and Thursday.
  assert.equal(minusTradingDays("2026-06-16", 3, holidaySet(2026)), "2026-06-11");
});

test("a public holiday extends the deadline backwards", () => {
  // Closure Thursday 4 June 2026: Wednesday, Tuesday, then Monday is Madaraka
  // Day and the weekend follows, so the third trading day back is the Friday.
  assert.equal(minusTradingDays("2026-06-04", 3, holidaySet(2026)), "2026-05-29");
});

test("counting forward and backward agree", () => {
  const holidays = holidaySet(2026);
  const back = minusTradingDays("2026-06-04", 3, holidays);
  assert.equal(tradingDaysBetween(back, "2026-06-04", holidays), 3);
});

test("a corrupt holiday list is refused rather than looped over", () => {
  // Every single day marked as a holiday: the walk can never terminate, so it
  // must say so instead of spinning.
  const everyDay = new Map();
  for (let ms = Date.UTC(2024, 0, 1); ms <= Date.UTC(2026, 5, 5); ms += 86_400_000) {
    everyDay.set(new Date(ms).toISOString().slice(0, 10), "x");
  }
  assert.throws(() => minusTradingDays("2026-06-05", 3, everyDay), RangeError);
});

const HOLDING = {
  id: "1", name: "UNGA Group Limited", ticker: "UNGA",
  booksClosure: "2026-06-04", dividendPerShare: 1.0, shares: 10_000, note: "",
};

test("the deadline is the settlement rule, stated", () => {
  const [d] = deadlines([HOLDING], "2026-05-20", 0.05);
  assert.equal(d.lastCumDividend, "2026-05-29");
  assert.equal(d.grossDividend, 10_000);
  assert.equal(d.netDividend, 9_500);
  assert.match(d.explanation, new RegExp(`settles ${SETTLEMENT_DAYS} trading`));
  assert.match(d.explanation, /2026-05-29/);
});

test("the countdown turns urgent, then passes", () => {
  assert.equal(deadlines([HOLDING], "2026-05-01", 0.05)[0].state, "ahead");
  assert.equal(deadlines([HOLDING], "2026-05-27", 0.05)[0].state, "urgent");
  assert.equal(deadlines([HOLDING], "2026-05-29", 0.05)[0].state, "today");
  assert.equal(deadlines([HOLDING], "2026-06-01", 0.05)[0].state, "passed");
  assert.ok(deadlines([HOLDING], "2026-06-04", 0.05)[0].daysLeft < 0);
});

test("holdings are ordered by which deadline arrives first", () => {
  const later = { ...HOLDING, id: "2", ticker: "LBTY", booksClosure: "2026-09-10" };
  const order = deadlines([later, HOLDING], "2026-05-01", 0.05).map((d) => d.holding.ticker);
  assert.deepEqual(order, ["UNGA", "LBTY"]);
});

test("a lunar holiday added by hand moves the deadline", () => {
  const before = deadlines([HOLDING], "2026-05-01", 0.05)[0].lastCumDividend;
  const after = deadlines([HOLDING], "2026-05-01", 0.05, ["2026-05-29"])[0].lastCumDividend;
  assert.equal(before, "2026-05-29");
  assert.equal(after, "2026-05-28", "Idd cannot be computed, so adding it must change the answer");
});

test("a closure early in January reaches back into the previous year", () => {
  const newYear = { ...HOLDING, booksClosure: "2027-01-05" };
  // 1 January 2027 is a Friday, so the trading days back are 4 Jan, then
  // 31 and 30 December.
  assert.equal(deadlines([newYear], "2026-12-01", 0.05)[0].lastCumDividend, "2026-12-30");
});
