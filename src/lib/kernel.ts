/**
 * The valuation kernel, mirrored for the browser.
 *
 * This is the second implementation of the same arithmetic. Both are tested
 * against fixtures/kernel-fixtures.json, which is what stops them drifting
 * apart: a change to one that is not made to the other fails the shared suite.
 */

export type SectorProfile = "industrial" | "insurer" | "bank" | "property" | "telco";

export const BUY = "BUY";
export const WALK = "SMILE AND WALK AWAY";

/** Where EBITA over net working capital means anything. */
const FOCUS_MODEL_SECTORS: ReadonlySet<SectorProfile> = new Set(["industrial", "property", "telco"]);
const FOCUS_MODEL_FLOOR = 0.45;

export interface Parameters {
  r: number;          // discount rate for the tenor actually used
  g: number;          // long-run growth
  k: number;          // margin of safety
  n: number;          // horizon, years
  c: number;          // NSE transaction cost, entry only
  w: number;          // dividend withholding
  stress: number;
  rTenorYears?: number;
  rAuctionDate?: string;
}

export interface Inputs {
  net_profit_from_operations: number;
  dividend_per_share_proposed: number;
  cash_and_bank: number;
  shares_issued: number;
  current_assets: number;
  current_liabilities: number;
  cash_and_securities: number;
  non_current_assets: number;
  non_current_liabilities: number;
  total_income: number;
  total_expenses: number;
  income_tax_expense: number;
}

export function checkParameters(p: Parameters): void {
  if (p.r <= 0) throw new RangeError("discount rate must be positive");
  if (p.n <= 0) throw new RangeError("horizon must be at least one year");
  if (p.k < 0 || p.k >= 1) throw new RangeError("margin of safety must be in [0, 1)");
  if (p.c < 0 || p.c > 0.1) throw new RangeError("transaction cost slider runs 0% to 10%");
  if (p.w < 0 || p.w >= 1) throw new RangeError("withholding rate must be in [0, 1)");
}

/** Excel FV(rate, nper, -payment). */
export const fvAnnuity = (rate: number, nper: number, payment: number): number =>
  payment * ((Math.pow(1 + rate, nper) - 1) / rate);

/** Excel PV(rate, nper, 0, -futureValue). */
export const pvLump = (rate: number, nper: number, futureValue: number): number =>
  futureValue / Math.pow(1 + rate, nper);

export interface Valuation {
  entryPrice: number;
  myFutureEps: number;
  myValuation: number;
  pvDividendsPs: number;
  cashPs: number;
  marketPriceFe: number;
  decision: string;
  margin: number;
  eps: number;
  trailingPe: number;
  netCapital: number;
  navPs: number;
  cigarButt: boolean;
  myNavValuePs: number;
  netDividendPs: number;
}

export function value(inputs: Inputs, price: number, p: Parameters): Valuation {
  checkParameters(p);
  if (price <= 0) throw new RangeError("price must be positive");
  if (inputs.shares_issued <= 0) throw new RangeError("shares issued must be positive");

  const entryPrice = price * (1 + p.c);
  const shares = inputs.shares_issued;

  const pvEarnings = pvLump(p.r, p.n, fvAnnuity(p.g, p.n, inputs.net_profit_from_operations));
  const pvDividendsPs = pvLump(p.r, p.n, fvAnnuity(p.g, p.n, inputs.dividend_per_share_proposed));
  const cashPs = inputs.cash_and_bank / shares;

  const myFutureEps = pvEarnings / shares;
  const myValuation = (1 - p.k) * myFutureEps;
  const marketPriceFe = entryPrice - pvDividendsPs - cashPs;

  const eps = inputs.net_profit_from_operations / shares;
  const netCapital =
    inputs.current_assets - inputs.current_liabilities +
    (inputs.non_current_assets - inputs.non_current_liabilities);
  const navPs = netCapital / shares;

  return {
    entryPrice,
    myFutureEps,
    myValuation,
    pvDividendsPs,
    cashPs,
    marketPriceFe,
    decision: myValuation >= marketPriceFe ? BUY : WALK,
    margin: (myValuation - marketPriceFe) / myValuation,
    eps,
    trailingPe: entryPrice / eps,
    netCapital,
    navPs,
    cigarButt: navPs >= entryPrice,
    myNavValuePs: (1 - p.k) * navPs,
    netDividendPs: inputs.dividend_per_share_proposed * (1 - p.w),
  };
}

export interface Fragility {
  sectorProfile: SectorProfile;
  workingCapital: number;
  liquidityRatio: number;
  excessCash: number;
  surplus: number;
  stressedSurplus: number;
  verdict: "ANTIFRAGILE" | "FRAGILE";
  focusModelRatio: number | null;
  focusModelNote: string;
}

export function assess(inputs: Inputs, profile: SectorProfile, p: Parameters): Fragility {
  const workingCapital = inputs.current_assets - inputs.current_liabilities;
  const obligations = inputs.total_expenses + inputs.income_tax_expense;
  const stressedRevenue = (1 - p.stress) * inputs.total_income;
  const stressedObligations = (1 + p.stress) * obligations;
  const stressedSurplus = (stressedRevenue - stressedObligations) / stressedObligations;

  let focusModelRatio: number | null = null;
  let focusModelNote: string;
  if (!FOCUS_MODEL_SECTORS.has(profile)) {
    focusModelNote = `Suppressed: a ${profile} has no net working capital in this sense.`;
  } else if (workingCapital <= 0) {
    focusModelNote = "Suppressed: net working capital is zero or negative, so the ratio is undefined.";
  } else {
    focusModelRatio = (inputs.total_income - inputs.total_expenses) / workingCapital;
    const verdict = focusModelRatio >= FOCUS_MODEL_FLOOR ? "clears" : "below";
    focusModelNote = `EBITA over net working capital ${verdict} the 45% floor.`;
  }

  return {
    sectorProfile: profile,
    workingCapital,
    liquidityRatio: inputs.current_assets / inputs.current_liabilities,
    excessCash: (inputs.cash_and_securities - inputs.current_liabilities) / inputs.current_liabilities,
    surplus: (inputs.total_income - obligations) / obligations,
    stressedSurplus,
    verdict: stressedSurplus > 0 ? "ANTIFRAGILE" : "FRAGILE",
    focusModelRatio,
    focusModelNote,
  };
}
