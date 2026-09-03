/**
 * The valuation kernel, mirrored for the browser.
 *
 * This is the second implementation of the same arithmetic. Both are tested
 * against fixtures/kernel-fixtures.json, which is what stops them drifting
 * apart: a change to one that is not made to the other fails the shared suite.
 */

export type SectorProfile = "industrial" | "insurer" | "bank" | "property" | "telco";

/** How the price was arrived at. Printed on every memo. */
export type Origin =
  | "nse-feed"          // collected automatically, dated by the exchange
  | "manual"            // typed in, usually because the feed failed
  | "private-deal"      // an offer or a round price, not a market price
  | "foreign-listed"    // quoted on another exchange
  | "foreign-private";  // unquoted, outside Kenya

const MARKET_PRICES: ReadonlySet<Origin> = new Set(["nse-feed", "manual", "foreign-listed"]);

export const KES = "KES";
export const KNOWN_CURRENCIES: ReadonlySet<string> = new Set([
  "KES", "USD", "ZAR", "GBP", "EUR", "TZS", "UGX", "RWF", "NGN",
]);

export interface PriceInput {
  amount: number;
  currency?: string;
  origin?: Origin;
  asOf?: string;   // ISO date
  note?: string;
}

function coercePrice(price: PriceInput | number): Required<Pick<PriceInput, "amount" | "currency" | "origin">> & PriceInput {
  const p = typeof price === "number" ? { amount: price } : price;
  const resolved = { currency: KES, origin: "nse-feed" as Origin, ...p };
  if (!(resolved.amount > 0)) throw new RangeError("price must be positive");
  if (!KNOWN_CURRENCIES.has(resolved.currency)) {
    throw new RangeError(`${resolved.currency} is not a currency this tool knows; add it deliberately`);
  }
  if (resolved.origin === "private-deal" && !resolved.note) {
    throw new RangeError("a private-deal price must say what it is: an offer, a round, a valuation");
  }
  return resolved;
}

function isStale(asOf?: string): boolean {
  if (!asOf) return false;
  const days = (Date.now() - Date.parse(asOf)) / 86_400_000;
  return days > 4;
}

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
  /** The currency the discount rate belongs to. A shilling rate prices shilling cash flows. */
  currency?: string;
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
  provenance: string;
  warnings: string[];
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

export function value(inputs: Inputs, price: PriceInput | number, p: Parameters): Valuation {
  checkParameters(p);
  if (inputs.shares_issued <= 0) throw new RangeError("shares issued must be positive");

  const quote = coercePrice(price);
  const rateCurrency = p.currency ?? KES;
  const warnings: string[] = [];

  if (quote.currency !== rateCurrency) {
    warnings.push(
      `price is in ${quote.currency} but the discount rate is a ${rateCurrency} rate; ` +
      "use a rate matching the currency of the cash flows, or state the deviation",
    );
  }
  if (!MARKET_PRICES.has(quote.origin)) {
    warnings.push(
      `${quote.origin}: this is not a market price, so the margin of safety is doing more work than usual`,
    );
  }
  if (quote.origin === "manual") warnings.push("price was entered by hand, not collected");
  if (isStale(quote.asOf)) warnings.push(`price is dated ${quote.asOf} and may be stale`);
  if (quote.currency !== KES && p.c) {
    warnings.push("NSE transaction costs are being applied to a non-KES price; check they apply");
  }

  const entryPrice = quote.amount * (1 + p.c);
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

  const provenance =
    `${quote.amount.toLocaleString("en-GB", { minimumFractionDigits: 2 })} ${quote.currency}, ${quote.origin}` +
    (quote.asOf ? ` as at ${quote.asOf}` : "") + (quote.note ? ` - ${quote.note}` : "");

  return {
    entryPrice,
    provenance,
    warnings,
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
