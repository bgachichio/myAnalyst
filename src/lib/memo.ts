/**
 * The whole memo, assembled in one place.
 *
 * `brian` §4 requires eight parts, and a screen that computes them inline is a
 * screen nobody can test. Everything here is arithmetic over the kernel: the
 * screen renders what this returns and decides nothing.
 *
 * Every assumption that moves a number is carried out with it. A worst case
 * whose assumptions are not printed is a base case wearing a hat.
 */
import {
  assess, value,
  type Fragility, type Inputs, type Parameters, type PriceInput, type SectorProfile, type Valuation,
} from "./kernel.js";
import {
  DEFAULT_HOLD_FLOOR, energyScore, hurdles, irr, multiples, verdict,
  type EnergyScore, type Hurdles, type Multiples,
} from "./analysis.js";

/** What the world outside the company is doing. Collected where possible, typed where not. */
export interface Macro {
  /** Kenyan CPI, year on year. The hurdle the income has to clear. */
  inflation: number;
  usdKes: number | null;
  btcUsd: number | null;
  /**
   * The annual return assumed for bitcoin over the holding period. Nobody can
   * forecast it; stating it is what makes the comparison arguable rather than
   * decorative.
   */
  btcAssumedReturn: number;
  /** Central Bank Rate, the floor under any borrowing. */
  cbr: number | null;
  /** What Brian pays over the CBR. `brian` §4 puts it at three to five points. */
  borrowingSpread: number;
  /** Years to the assumed exit. */
  holdYears: number;
}

export const DEFAULT_MACRO: Macro = {
  inflation: 0.07,
  usdKes: null,
  btcUsd: null,
  btcAssumedReturn: 0.20,
  cbr: null,
  borrowingSpread: 0.04,
  holdYears: 5,
};

/** One reporting period, for the three graphs §4 (ii) to (iv) require. */
export interface Period {
  label: string;
  totalIncome: number;
  profit: number;
  netAssets: number;
}

/** A case is a set of assumptions and what the kernel makes of them. */
export interface Case {
  name: string;
  assumptions: string[];
  valuation: Valuation;
  fragility: Fragility;
  verdict: string;
  margin: number;
}

export interface Lever {
  title: string;
  /** What the figures say. */
  finding: string;
  /** What would have to happen, and what it is worth. */
  action: string;
}

export interface Memo {
  base: Case;
  worst: Case;
  periods: Period[];
  multiples: Multiples;
  hurdles: Hurdles;
  energy: EnergyScore;
  /** Entry, exit and the return between them, on the base case. */
  deal: {
    entryEvEbitda: number | null;
    exitEvEbitda: number | null;
    exitPricePs: number | null;
    irr: number | null;
    worstIrr: number | null;
    btcAssumedReturn: number;
    beatsBitcoin: boolean | null;
    debtCapacity: number | null;
    interestCover: number | null;
    borrowingCost: number | null;
  };
  levers: Lever[];
  verdict: string;
  rationale: string[];
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const money = (x: number) => x.toLocaleString("en-GB", { maximumFractionDigits: 0 });
const perShare = (x: number) => x.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The worst case is the base case with every assumption moved one step against you. */
export const WORST_GROWTH_HAIRCUT = 0.02;
export const WORST_RATE_PENALTY = 0.02;

function build(
  name: string, assumptions: string[], inputs: Inputs, price: PriceInput,
  params: Parameters, profile: SectorProfile, holdFloor: number,
): Case {
  const v = value(inputs, price, params);
  const f = assess(inputs, profile, params);
  return { name, assumptions, valuation: v, fragility: f, verdict: verdict(v.margin, holdFloor), margin: v.margin };
}

export function buildMemo(args: {
  inputs: Inputs;
  price: PriceInput;
  params: Parameters;
  profile: SectorProfile;
  macro: Macro;
  periods: Period[];
  holdFloor?: number;
}): Memo {
  const { inputs, price, params, profile, macro, periods } = args;
  const holdFloor = args.holdFloor ?? DEFAULT_HOLD_FLOOR;

  const base = build(
    "Base case",
    [
      `Earnings grow at ${pct(params.g)} for ${params.n} years and are discounted at ${pct(params.r)}.`,
      `A ${pct(params.k)} margin of safety is taken off the valuation.`,
      `Entry carries ${pct(params.c)} in transaction costs; ${pct(params.w)} is withheld on dividends.`,
      "The latest period's figures hold, unadjusted.",
    ],
    inputs, price, params, profile, holdFloor,
  );

  // The worst case moves growth, the discount rate and earnings against the
  // position at once. Any one of the three on its own flatters the answer.
  const worstParams: Parameters = {
    ...params,
    g: Math.max(0, params.g - WORST_GROWTH_HAIRCUT),
    r: params.r + WORST_RATE_PENALTY,
  };
  const worstInputs: Inputs = {
    ...inputs,
    net_profit_from_operations: inputs.net_profit_from_operations * (1 - params.stress),
    total_income: inputs.total_income * (1 - params.stress),
    total_expenses: inputs.total_expenses * (1 + params.stress),
  };
  const worst = build(
    "Worst case",
    [
      `Growth cut to ${pct(worstParams.g)} and the discount rate raised to ${pct(worstParams.r)}.`,
      `Earnings cut by ${pct(params.stress)}; income down and expenses up by the same.`,
      "The dividend, the cash and the share count are unchanged.",
    ],
    worstInputs, price, worstParams, profile, holdFloor,
  );

  const debt = inputs.current_liabilities + inputs.non_current_liabilities;
  const m = multiples({
    entryPrice: base.valuation.entryPrice,
    shares: inputs.shares_issued,
    cash: inputs.cash_and_securities,
    debt,
    totalIncome: inputs.total_income,
    totalExpenses: inputs.total_expenses,
    netCapital: base.valuation.netCapital,
  });

  const h = hurdles({
    entryPrice: base.valuation.entryPrice,
    dividendPerShare: inputs.dividend_per_share_proposed,
    withholding: params.w,
    inflation: macro.inflation,
    usdRate: macro.usdKes,
    btcUsd: macro.btcUsd,
  });

  const energy = energyScore({
    margin: base.valuation.margin,
    netYield: h.netYield,
    inflation: macro.inflation,
    surplus: base.fragility.surplus,
    stressedSurplus: base.fragility.stressedSurplus,
    liquidityRatio: base.fragility.liquidityRatio,
  });

  const deal = priceTheDeal(inputs, base, worst, m, macro, params, debt);
  const levers = findLevers(inputs, base, m, h, deal, macro);

  return {
    base, worst, periods, multiples: m, hurdles: h, energy, deal, levers,
    verdict: base.verdict,
    rationale: reason(base, worst, m, h, energy, deal, macro),
  };
}

/**
 * §4 (v). Exit at the multiple it was entered on, with EBITDA grown at the
 * same rate the valuation assumes. Not a forecast - a statement of what has to
 * hold for the entry to work, which is the only honest thing an exit
 * assumption can be.
 */
function priceTheDeal(
  inputs: Inputs, base: Case, worst: Case, m: Multiples,
  macro: Macro, params: Parameters, debt: number,
): Memo["deal"] {
  const years = macro.holdYears;
  const exitEbitda = m.ebitda * Math.pow(1 + params.g, years);
  const exitEv = m.evEbitda === null ? null : m.evEbitda * exitEbitda;
  const exitPricePs = exitEv === null
    ? null
    : (exitEv - debt + inputs.cash_and_securities) / inputs.shares_issued;

  const dividend = base.valuation.netDividendPs;
  const rate = exitPricePs === null ? null : irr(base.valuation.entryPrice, exitPricePs, years, dividend);

  const worstExitEbitda = m.ebitda * (1 - params.stress) * Math.pow(1 + Math.max(0, params.g - WORST_GROWTH_HAIRCUT), years);
  const worstExitEv = m.evEbitda === null ? null : m.evEbitda * worstExitEbitda;
  const worstExitPs = worstExitEv === null
    ? null
    : (worstExitEv - debt + inputs.cash_and_securities) / inputs.shares_issued;
  const worstRate = worstExitPs === null
    ? null
    : irr(worst.valuation.entryPrice, Math.max(0, worstExitPs), years, dividend);

  const borrowingCost = macro.cbr === null ? null : macro.cbr + macro.borrowingSpread;
  // Two and a half times EBITDA is the ceiling `brian` §4 works to before
  // interest sustainability has to be modelled rather than assumed.
  const debtCapacity = m.ebitda > 0 ? Math.max(0, 2.5 * m.ebitda - debt) : null;
  const interestCover = borrowingCost !== null && debt > 0 && m.ebitda > 0
    ? m.ebitda / (debt * borrowingCost)
    : null;

  return {
    entryEvEbitda: m.evEbitda,
    exitEvEbitda: m.evEbitda,
    exitPricePs,
    irr: rate,
    worstIrr: worstRate,
    btcAssumedReturn: macro.btcAssumedReturn,
    beatsBitcoin: rate === null ? null : rate > macro.btcAssumedReturn,
    debtCapacity,
    interestCover,
    borrowingCost,
  };
}

/** §4 (vi). Where the upside would have to come from, with the number that says so. */
function findLevers(
  inputs: Inputs, base: Case, m: Multiples, h: Hurdles, deal: Memo["deal"], macro: Macro,
): Lever[] {
  const levers: Lever[] = [];
  const margin = inputs.total_income > 0 ? m.ebitda / inputs.total_income : 0;
  const shares = inputs.shares_issued;

  if (margin < 0.15) {
    const gain = inputs.total_income * 0.01;
    levers.push({
      title: "Cost",
      finding: `EBITDA margin is ${pct(margin)} of income, thin enough that a squeeze on either side erases it.`,
      action: `One point of margin is KES ${money(gain)}, or ${perShare(gain / shares)} per share of EBITDA. ` +
              "This is the lever with the shortest path.",
    });
  } else {
    levers.push({
      title: "Cost",
      finding: `EBITDA margin is ${pct(margin)}, so there is no easy cost story here.`,
      action: "The return has to come from growth or from the multiple, not from the cost line.",
    });
  }

  if (deal.entryEvEbitda !== null) {
    levers.push({
      title: "Multiple",
      finding: `Entering at ${deal.entryEvEbitda.toFixed(1)}× EBITDA.`,
      action: `Exit at the same multiple and the return is the growth. Every turn of re-rating adds ` +
              `KES ${money(m.ebitda)} of enterprise value, or ${perShare(m.ebitda / shares)} per share.`,
    });
  }

  const cashShare = base.valuation.cashPs / base.valuation.entryPrice;
  if (cashShare > 0.2) {
    levers.push({
      title: "Balance sheet",
      finding: `${pct(cashShare)} of the entry price is cash on the balance sheet: ` +
               `${perShare(base.valuation.cashPs)} per share against a price of ${perShare(base.valuation.entryPrice)}.`,
      action: "A special dividend or a buyback releases it without touching operations. " +
              "With no board seat this is influence, not control: it is a reason to buy, not a plan.",
    });
  }

  if (h.netYield > 0) {
    levers.push({
      title: "Income",
      finding: `Net yield is ${pct(h.netYield)} against inflation of ${pct(macro.inflation)}: ` +
               (h.beatsInflation ? `${pct(h.realYield)} in real terms.` : `${pct(h.realYield)}, a real loss on the carry.`),
      action: h.beatsInflation
        ? "The position pays to be held while the thesis works."
        : "The whole return has to come from re-rating or growth. Nothing is being paid to wait.",
    });
  } else {
    levers.push({
      title: "Income",
      finding: "No dividend, so nothing is paid for holding.",
      action: "The entire return depends on the exit. Size the position accordingly.",
    });
  }

  if (deal.debtCapacity !== null && deal.interestCover !== null) {
    const safe = deal.interestCover >= 3;
    levers.push({
      title: "Leverage",
      finding: `Interest cover at ${deal.interestCover.toFixed(1)}× on existing obligations, ` +
               `borrowing at ${deal.borrowingCost === null ? "an unknown rate" : pct(deal.borrowingCost)}.`,
      action: safe
        ? `Headroom of KES ${money(deal.debtCapacity)} to 2.5× EBITDA. The company can carry more; ` +
          "Brian borrowing to buy it is a separate question with the same arithmetic."
        : "Below three times cover. No case for borrowing to enter, and the existing load is itself a risk.",
    });
  }

  return levers;
}

/** §4 (viii). The bullets under the verdict, each one a figure rather than a feeling. */
function reason(
  base: Case, worst: Case, m: Multiples, h: Hurdles,
  energy: EnergyScore, deal: Memo["deal"], macro: Macro,
): string[] {
  const out: string[] = [];
  out.push(
    `The market charges ${perShare(base.valuation.marketPriceFe)} for future earnings this model ` +
    `values at ${perShare(base.valuation.myValuation)}: a margin of ${pct(base.margin)}.`,
  );
  out.push(
    `Worst case, with growth and earnings cut and the discount rate raised, the verdict is ` +
    `${worst.verdict} at a margin of ${pct(worst.margin)}.`,
  );
  if (m.evEbitda !== null) out.push(`Entering at ${m.evEbitda.toFixed(1)}× EBITDA and ${m.priceToBook?.toFixed(2) ?? "—"}× book.`);
  out.push(
    h.beatsInflation
      ? `A net yield of ${pct(h.netYield)} clears inflation of ${pct(macro.inflation)}.`
      : `A net yield of ${pct(h.netYield)} does not clear inflation of ${pct(macro.inflation)}, so the income loses money in real terms.`,
  );
  if (deal.irr !== null) {
    out.push(
      `Held ${macro.holdYears} years and exited at the entry multiple, the return is ${pct(deal.irr)} ` +
      `(${deal.worstIrr === null ? "no solvable rate" : pct(deal.worstIrr)} in the worst case), against ` +
      `${pct(deal.btcAssumedReturn)} assumed for bitcoin over the same period. ` +
      (deal.beatsBitcoin ? "It clears the bitcoin hurdle on these assumptions." : "It does not clear the bitcoin hurdle on these assumptions."),
    );
  }
  out.push(`${base.fragility.verdict} under a ${pct(0.1)} squeeze; economic energy ${energy.total} of 7, ${energy.band.toLowerCase()}.`);
  return out;
}

/** The two periods a report always gives, ready for the three graphs. */
export function periodsFromReport(
  currentLabel: string, priorLabel: string,
  current: Inputs, prior: Partial<Inputs>,
): Period[] {
  const netAssets = (i: Partial<Inputs>) =>
    (i.current_assets ?? 0) - (i.current_liabilities ?? 0) +
    (i.non_current_assets ?? 0) - (i.non_current_liabilities ?? 0);

  const out: Period[] = [];
  if (Object.keys(prior).length > 0) {
    out.push({
      label: priorLabel,
      totalIncome: prior.total_income ?? 0,
      profit: prior.net_profit_from_operations ?? 0,
      netAssets: netAssets(prior),
    });
  }
  out.push({
    label: currentLabel,
    totalIncome: current.total_income,
    profit: current.net_profit_from_operations,
    netAssets: netAssets(current),
  });
  return out;
}
