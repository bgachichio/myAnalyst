/**
 * The rest of the mandatory output, mirrored for the browser.
 *
 * Second implementation of the same arithmetic as kernel/analysis.py. Both run
 * against fixtures/kernel-fixtures.json, which is what stops them drifting.
 */

export const BUY = "BUY";
export const HOLD = "HOLD";
export const SELL = "SELL";

/**
 * Above this margin the price is clearly below value; below zero it is clearly
 * above. Between the two the answer is HOLD, which the workbook had no room
 * for: it printed BUY or "smile and walk away" and nothing in between.
 */
export const DEFAULT_HOLD_FLOOR = 0.15;

/** Three states, not two. A thin margin is not a buy and is not a sell. */
export function verdict(margin: number, holdFloor: number = DEFAULT_HOLD_FLOOR): string {
  if (margin >= holdFloor) return BUY;
  if (margin >= 0) return HOLD;
  return SELL;
}

export interface Multiples {
  marketCap: number;
  enterpriseValue: number;
  ebitda: number;
  evEbitda: number | null;
  priceToBook: number | null;
  ebitdaNote: string;
}

export interface MultiplesArgs {
  entryPrice: number;
  shares: number;
  cash: number;
  debt: number;
  totalIncome: number;
  totalExpenses: number;
  netCapital: number;
}

/**
 * Enterprise value over EBITDA, with the proxy stated rather than hidden.
 *
 * A published EBITDA is not among the figures the decision sheet takes, so
 * income less expenses stands in for it. That is EBITA in substance, and the
 * difference matters, so it is printed rather than assumed away.
 */
export function multiples(a: MultiplesArgs): Multiples {
  const marketCap = a.entryPrice * a.shares;
  const ev = marketCap + a.debt - a.cash;
  const ebitda = a.totalIncome - a.totalExpenses;
  return {
    marketCap,
    enterpriseValue: ev,
    ebitda,
    evEbitda: ebitda > 0 ? ev / ebitda : null,
    priceToBook: a.netCapital > 0 ? marketCap / a.netCapital : null,
    ebitdaNote:
      "EBITDA is total income less total expenses: EBITA in substance, " +
      "because depreciation is not among the figures the decision sheet takes.",
  };
}

/**
 * Internal rate of return on one entry, a stream of dividends, and one exit.
 *
 * Bisection rather than Newton: it cannot diverge, and a valuation tool that
 * silently fails to converge is worse than one that says it could not.
 */
export function irr(
  entry: number,
  exitValue: number,
  years: number,
  incomePerYear = 0,
): number | null {
  if (entry <= 0 || years <= 0) return null;

  const npv = (rate: number): number => {
    let total = -entry;
    for (let year = 1; year <= Math.trunc(years); year += 1) {
      total += incomePerYear / Math.pow(1 + rate, year);
    }
    return total + exitValue / Math.pow(1 + rate, years);
  };

  let low = -0.9999;
  let high = 10.0;
  if (npv(low) < 0 || npv(high) > 0) return null;
  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2;
    if (npv(mid) > 0) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

export interface Hurdles {
  grossYield: number;
  netYield: number;
  withholdingRate: number;
  inflationRate: number;
  beatsInflation: boolean;
  realYield: number;
  entryInUsd: number | null;
  usdRate: number | null;
  entryInBtc: number | null;
  btcUsd: number | null;
}

export interface HurdlesArgs {
  entryPrice: number;
  dividendPerShare: number;
  withholding: number;
  inflation: number;
  usdRate?: number | null;
  btcUsd?: number | null;
}

/**
 * The two hurdles, printed even when they embarrass the verdict.
 *
 * Inflation is a hurdle: a yield below it loses money in real terms. The
 * currency line is a check, not a hurdle - it says whether a shilling gain is
 * a real gain, and it never vetoes the verdict.
 */
export function hurdles(a: HurdlesArgs): Hurdles {
  const gross = a.entryPrice > 0 ? a.dividendPerShare / a.entryPrice : 0;
  const net = gross * (1 - a.withholding);
  const usdRate = a.usdRate ?? null;
  const btcUsd = a.btcUsd ?? null;
  const inUsd = usdRate ? a.entryPrice / usdRate : null;
  return {
    grossYield: gross,
    netYield: net,
    withholdingRate: a.withholding,
    inflationRate: a.inflation,
    beatsInflation: net > a.inflation,
    realYield: net - a.inflation,
    entryInUsd: inUsd,
    usdRate,
    entryInBtc: inUsd && btcUsd ? inUsd / btcUsd : null,
    btcUsd,
  };
}

export interface EnergyScore {
  valuation: number;
  yield: number;
  growthQuality: number;
  total: number;
  band: string;
  reasons: string[];
}

export interface EnergyScoreArgs {
  margin: number;
  netYield: number;
  inflation: number;
  surplus: number;
  stressedSurplus: number;
  liquidityRatio: number;
}

/**
 * `brian` §4 (vii). Zero to seven: valuation, yield, growth quality.
 *
 * Economic energy against entropy. Each component says why it scored what it
 * scored, because a score nobody can argue with is a score nobody trusts.
 */
export function energyScore(a: EnergyScoreArgs): EnergyScore {
  const reasons: string[] = [];

  let v: number;
  let why: string;
  if (a.margin >= 0.4) [v, why] = [3, "a wide margin, over 40%"];
  else if (a.margin >= DEFAULT_HOLD_FLOOR) [v, why] = [2, "a real margin, over 15%"];
  else if (a.margin >= 0) [v, why] = [1, "positive but thin"];
  else [v, why] = [0, "the market charges more than the earnings are worth"];
  reasons.push(`Valuation ${v}/3: ${why}.`);

  let y: number;
  if (a.netYield >= a.inflation * 1.5) [y, why] = [2, "comfortably ahead of inflation"];
  else if (a.netYield > a.inflation) [y, why] = [1, "ahead of inflation, narrowly"];
  else [y, why] = [0, "below inflation, so the income loses money in real terms"];
  reasons.push(`Yield ${y}/2: ${why}.`);

  let g = 0;
  if (a.stressedSurplus > 0) {
    g += 1;
    reasons.push("Growth 1: survives a 10% squeeze on both sides.");
  } else if (a.surplus > 0) {
    reasons.push("Growth 0: profitable, but a 10% squeeze erases it.");
  } else {
    reasons.push("Growth 0: obligations already exceed income.");
  }
  if (a.liquidityRatio >= 1.5) {
    g += 1;
    reasons.push("Growth +1: liquidity ratio at or above 1.5.");
  }

  const total = v + y + g;
  const band = total >= 5 ? "High energy" : total >= 3 ? "Mixed" : "High entropy";
  return { valuation: v, yield: y, growthQuality: g, total, band, reasons };
}
