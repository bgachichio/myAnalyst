/**
 * Comparing counters that were priced in different worlds.
 *
 * A multiple is not a number you can carry across a border. A Johannesburg
 * company trades on a rand discount rate and a Nairobi one on a shilling rate,
 * and the gap between those two rates is most of the gap between the two
 * multiples. Comparing them raw is the most common way to conclude that Kenyan
 * equities are cheap.
 *
 * So both are shown: the multiple as quoted, and the multiple restated at one
 * common discount rate, with the arithmetic printed rather than implied.
 */

/** One analysis, kept so it can be argued with next to another. */
export interface SavedMemo {
  id: string;
  savedAt: string;
  name: string;
  sector: string;
  currency: string;
  /** The exchange or the fact that there wasn't one. */
  origin: string;
  price: number;
  /** The discount rate this memo used. A shilling rate prices shilling cash flows. */
  discountRate: number;
  growth: number;
  verdict: string;
  margin: number;
  evEbitda: number | null;
  priceToBook: number | null;
  trailingPe: number;
  netYield: number;
  realYield: number;
  energyTotal: number;
  energyBand: string;
  irr: number | null;
}

export interface Restated {
  raw: number | null;
  /** The same multiple at the common rate, or null with a reason it could not be. */
  adjusted: number | null;
  factor: number | null;
  note: string;
}

/**
 * A perpetuity multiple moves with 1/(r - g). Restating one from its own
 * discount rate to a common one is that ratio and nothing more: a rough
 * adjustment, stated as rough, and far closer than no adjustment at all.
 */
export function restateMultiple(args: {
  multiple: number | null;
  fromRate: number;
  toRate: number;
  growth: number;
}): Restated {
  const { multiple, fromRate, toRate, growth } = args;
  const from = fromRate - growth;
  const to = toRate - growth;

  if (multiple === null) {
    return { raw: null, adjusted: null, factor: null, note: "No multiple to restate: EBITDA is not positive." };
  }
  if (from <= 0 || to <= 0) {
    return {
      raw: multiple, adjusted: null, factor: null,
      note: "Growth is at or above a discount rate, so the multiple has no finite value to restate to.",
    };
  }
  if (Math.abs(fromRate - toRate) < 1e-9) {
    return { raw: multiple, adjusted: multiple, factor: 1, note: "Already on the common rate; nothing to restate." };
  }

  const factor = from / to;
  return {
    raw: multiple,
    adjusted: multiple * factor,
    factor,
    note:
      `Restated by (${(fromRate * 100).toFixed(1)}% − ${(growth * 100).toFixed(1)}%) ÷ ` +
      `(${(toRate * 100).toFixed(1)}% − ${(growth * 100).toFixed(1)}%) = ${factor.toFixed(3)}. ` +
      "A perpetuity multiple moves with one over the rate less growth; this is rough, and it is far " +
      "closer than comparing the two as quoted.",
  };
}

export interface Comparison {
  memo: SavedMemo;
  evEbitda: Restated;
  /** True where this memo's own rate is the one everything is being restated to. */
  isBenchmark: boolean;
}

/** Every saved memo restated onto one discount rate, cheapest adjusted multiple first. */
export function compare(memos: SavedMemo[], commonRate: number, growth: number): Comparison[] {
  return memos
    .map((memo) => ({
      memo,
      evEbitda: restateMultiple({ multiple: memo.evEbitda, fromRate: memo.discountRate, toRate: commonRate, growth }),
      isBenchmark: Math.abs(memo.discountRate - commonRate) < 1e-9,
    }))
    .sort((a, b) => (a.evEbitda.adjusted ?? Infinity) - (b.evEbitda.adjusted ?? Infinity));
}

/** What the table is saying, in one sentence, for the reader who reads one sentence. */
export function summarise(rows: Comparison[], commonRate: number): string {
  const priced = rows.filter((r) => r.evEbitda.adjusted !== null);
  if (priced.length === 0) return "Nothing here has a multiple to compare yet.";
  if (priced.length === 1) return `Only ${priced[0].memo.name} has a multiple. One counter is not a comparison.`;

  const cheapest = priced[0];
  const dearest = priced[priced.length - 1];
  return (
    `At a common ${(commonRate * 100).toFixed(2)}% discount rate, ${cheapest.memo.name} is the cheapest ` +
    `at ${cheapest.evEbitda.adjusted!.toFixed(1)}× and ${dearest.memo.name} the dearest at ` +
    `${dearest.evEbitda.adjusted!.toFixed(1)}×. Both restated from the rate each was analysed on.`
  );
}
