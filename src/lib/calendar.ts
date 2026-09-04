/**
 * The last day to buy and still be on the register.
 *
 * A dividend is announced with a books-closure date. To be on the register on
 * that date the trade has to have settled, and the NSE settles equities three
 * trading days after the trade. So the day that matters is not the closure
 * date: it is three trading days before it, and trading days are not calendar
 * days once Kenya's public holidays are counted.
 *
 * Everything here works in UTC on plain dates. A dividend deadline moved by an
 * hour of timezone arithmetic is a dividend missed.
 */

/** NSE equity settlement. Held here so it is one edit if the exchange changes it. */
export const SETTLEMENT_DAYS = 3;

export type IsoDate = string;   // YYYY-MM-DD

const DAY = 86_400_000;

export const toUtc = (iso: IsoDate): number => Date.parse(`${iso}T00:00:00Z`);
export const toIso = (ms: number): IsoDate => new Date(ms).toISOString().slice(0, 10);

/** Meeus's algorithm. Good Friday and Easter Monday are both public holidays here. */
export function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toIso(Date.UTC(year, month - 1, day));
}

const shift = (iso: IsoDate, days: number): IsoDate => toIso(toUtc(iso) + days * DAY);

/** The fixed and Easter-based holidays. Named so the list can be argued with. */
export function gazettedHolidays(year: number): { date: IsoDate; name: string }[] {
  const easter = easterSunday(year);
  const fixed: [number, number, string][] = [
    [1, 1, "New Year's Day"],
    [5, 1, "Labour Day"],
    [6, 1, "Madaraka Day"],
    [10, 10, "Utamaduni Day"],
    [10, 20, "Mashujaa Day"],
    [12, 12, "Jamhuri Day"],
    [12, 25, "Christmas Day"],
    [12, 26, "Boxing Day"],
  ];
  return [
    ...fixed.map(([month, day, name]) => ({ date: toIso(Date.UTC(year, month - 1, day)), name })),
    { date: shift(easter, -2), name: "Good Friday" },
    { date: shift(easter, 1), name: "Easter Monday" },
  ].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Every non-trading day in a year: weekends, the gazetted holidays, the Monday
 * that follows one falling on a Sunday, and whatever else is handed in.
 *
 * Idd-ul-Fitr and Idd-ul-Azha follow the lunar calendar and are declared on
 * sight of the moon, so no algorithm can place them. They are added by hand,
 * and the app says so rather than quietly getting a date wrong.
 */
export function holidaySet(year: number, extra: IsoDate[] = []): Map<IsoDate, string> {
  const out = new Map<IsoDate, string>();
  for (const { date, name } of gazettedHolidays(year)) {
    out.set(date, name);
    // Public Holidays Act: a holiday on a Sunday is observed on the Monday.
    if (new Date(toUtc(date)).getUTCDay() === 0) out.set(shift(date, 1), `${name} observed`);
  }
  for (const date of extra) out.set(date, "Added by hand");
  return out;
}

export const isWeekend = (iso: IsoDate): boolean => {
  const day = new Date(toUtc(iso)).getUTCDay();
  return day === 0 || day === 6;
};

export function isTradingDay(iso: IsoDate, holidays: Map<IsoDate, string>): boolean {
  return !isWeekend(iso) && !holidays.has(iso);
}

/** Walk back n trading days. The starting day is never counted. */
export function minusTradingDays(iso: IsoDate, n: number, holidays: Map<IsoDate, string>): IsoDate {
  let at = iso;
  let left = n;
  let guard = 0;
  while (left > 0) {
    at = shift(at, -1);
    if (isTradingDay(at, holidays)) left -= 1;
    // A year of holidays would be a corrupt calendar, not a long weekend.
    if ((guard += 1) > 400) throw new RangeError("no trading day found within a year; the holiday list is wrong");
  }
  return at;
}

/** Trading days from one date to another, counting the later one and not the earlier. */
export function tradingDaysBetween(from: IsoDate, to: IsoDate, holidays: Map<IsoDate, string>): number {
  if (to <= from) return 0;
  let count = 0;
  let at = from;
  while (at < to) {
    at = shift(at, 1);
    if (isTradingDay(at, holidays)) count += 1;
  }
  return count;
}

export interface Holding {
  id: string;
  name: string;
  ticker: string;
  /** The date the register closes. Off the announcement, not guessed. */
  booksClosure: IsoDate;
  dividendPerShare: number;
  /** Shares held, or intended. Used only to price the deadline. */
  shares: number;
  note: string;
}

export interface Deadline {
  holding: Holding;
  /** The last day a trade can be made and still settle before the register closes. */
  lastCumDividend: IsoDate;
  /** Trading days from today to that day. Negative once it has passed. */
  tradingDaysLeft: number;
  /** Calendar days, for the countdown a person reads. */
  daysLeft: number;
  state: "passed" | "today" | "urgent" | "ahead";
  grossDividend: number;
  netDividend: number;
  /** What the deadline is, in one sentence, with the settlement rule stated. */
  explanation: string;
}

/**
 * When each holding has to be bought by, and what the dividend is worth.
 *
 * `today` is passed in rather than read from the clock: a function that reads
 * the clock cannot be tested, and a deadline that cannot be tested is a
 * deadline that will be wrong on the day it matters.
 */
export function deadlines(
  holdings: Holding[], today: IsoDate, withholding: number, extraHolidays: IsoDate[] = [],
): Deadline[] {
  return holdings
    .map((holding) => {
      const year = Number(holding.booksClosure.slice(0, 4));
      // The window can cross a new year, so both years' holidays are in scope.
      const holidays = new Map([
        ...holidaySet(year - 1, extraHolidays),
        ...holidaySet(year, extraHolidays),
      ]);
      const lastCum = minusTradingDays(holding.booksClosure, SETTLEMENT_DAYS, holidays);
      const tradingLeft = lastCum >= today
        ? tradingDaysBetween(today, lastCum, holidays)
        : -tradingDaysBetween(lastCum, today, holidays);
      const daysLeft = Math.round((toUtc(lastCum) - toUtc(today)) / DAY);
      const gross = holding.dividendPerShare * holding.shares;

      return {
        holding,
        lastCumDividend: lastCum,
        tradingDaysLeft: tradingLeft,
        daysLeft,
        state: daysLeft < 0 ? "passed" : daysLeft === 0 ? "today" : tradingLeft <= 3 ? "urgent" : "ahead",
        grossDividend: gross,
        netDividend: gross * (1 - withholding),
        explanation:
          `The register closes on ${holding.booksClosure}. The NSE settles ${SETTLEMENT_DAYS} trading ` +
          `days after the trade, so the last day to buy and still be on it is ${lastCum}.`,
      } satisfies Deadline;
    })
    .sort((a, b) => a.lastCumDividend.localeCompare(b.lastCumDividend));
}
