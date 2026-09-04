/**
 * Reading the twelve figures off a financial statement.
 *
 * No model, no service, no key: a label table and arithmetic. That makes it
 * deterministic, which is the point - the same report gives the same figures
 * every time, and every figure it offers carries the line it came from and the
 * page it was on, so it can be checked in seconds rather than trusted.
 *
 * Nothing here touches a file format. `pdf.ts` and `xlsx.ts` turn a document
 * into `Line[]`; this turns `Line[]` into figures. That split is what lets the
 * hard part be tested without a browser.
 */

/** One number as it appeared, with what it read as. */
export interface NumberToken {
  raw: string;
  value: number;
  /** Position in the line, 0-based. Financial statements column by period. */
  column: number;
  /** A bare four-digit number in a plausible range is more likely a year. */
  looksLikeYear: boolean;
}

/** One row of a document: a page or sheet name, the text, and the numbers on it. */
export interface Line {
  page: string;
  text: string;
  numbers: NumberToken[];
}

export type FigureKey =
  | "net_profit_from_operations"
  | "dividend_per_share_proposed"
  | "cash_and_bank"
  | "shares_issued"
  | "current_assets"
  | "current_liabilities"
  | "cash_and_securities"
  | "non_current_assets"
  | "non_current_liabilities"
  | "total_income"
  | "total_expenses"
  | "income_tax_expense";

export const FIGURE_KEYS: FigureKey[] = [
  "net_profit_from_operations", "dividend_per_share_proposed", "cash_and_bank",
  "shares_issued", "current_assets", "current_liabilities", "cash_and_securities",
  "non_current_assets", "non_current_liabilities", "total_income",
  "total_expenses", "income_tax_expense",
];

/** A figure the reader is offering, and how sure it is. */
export interface Candidate {
  key: FigureKey;
  value: number;
  /** The figure before the reporting scale was applied. Shown so the multiplier is visible. */
  rawValue: number;
  /**
   * The same line's comparative column, scaled the same way. Free to read and
   * it is what turns a single verdict into a direction of travel.
   */
  priorValue: number | null;
  scale: number;
  confidence: number;
  /** The line it was read off, verbatim. */
  label: string;
  page: string;
  column: number;
  /** Runners-up, in case the reader picked the wrong line. */
  alternatives: { value: number; label: string; page: string; confidence: number }[];
}

export interface Extraction {
  candidates: Partial<Record<FigureKey, Candidate>>;
  missing: FigureKey[];
  /** Everything the reader wants a human to look at before the verdict is believed. */
  notes: string[];
  scale: number;
  scaleNote: string;
  /** True when the current period is the leftmost number column. */
  currentIsFirstColumn: boolean;
  periodYears: number[];
}

/** Above this a figure is filled in; below it, it is offered and must be confirmed. */
export const CONFIDENT = 0.75;
/** Below this the reader does not offer the figure at all. */
export const FLOOR = 0.4;

// ---------------------------------------------------------------- text

/** Lower case, single spaces, no punctuation that changes nothing. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/[’'`]/g, "'")
    .replace(/[^a-z0-9'\-/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Numbers as accountants write them: thousands separated, negatives in
 * brackets, dashes for nil. A dash is a real zero and is read as one.
 */
export function parseNumbers(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  const re = /\(?\s*-?\s*(?:\d{1,3}(?:[,\s]\d{3})+|\d+)(?:\.\d+)?\s*\)?%?/g;
  let match: RegExpExecArray | null;
  let column = 0;
  while ((match = re.exec(text)) !== null) {
    const raw = match[0].trim();
    if (raw.endsWith("%")) continue;               // a ratio is not a figure
    const negative = raw.startsWith("(") || /^-|\(\s*-/.test(raw);
    const digits = raw.replace(/[()%\s,]/g, "").replace(/^-/, "");
    if (digits === "") continue;
    const magnitude = Number(digits);
    if (!Number.isFinite(magnitude)) continue;
    const value = negative ? -magnitude : magnitude;
    out.push({
      raw,
      value,
      column: column++,
      looksLikeYear: /^\d{4}$/.test(digits) && magnitude >= 1900 && magnitude <= 2100,
    });
  }
  return out;
}

// ---------------------------------------------------------------- scale

const SCALES: { re: RegExp; scale: number; label: string }[] = [
  { re: /\b(?:kshs?|shs|ksh|kes|sh)\b[^a-z0-9]{0,4}(?:in )?bn\b|\bbillions?\b/, scale: 1e9, label: "billions" },
  { re: /\bmillions?\b|\b(?:kshs?|shs|ksh|kes|sh)\b[^a-z0-9]{0,4}m\b|\bmn\b/, scale: 1e6, label: "millions" },
  { re: /\bthousands?\b|'000\b|\b000s?\b/, scale: 1e3, label: "thousands" },
];

/**
 * Kenyan reports almost always state figures in thousands and say so once, in
 * small type above the first column. Missing that multiplies every figure by a
 * thousand, so it is detected rather than assumed, and always reported.
 */
export function detectScale(lines: Line[]): { scale: number; note: string } {
  const counts = new Map<number, { n: number; label: string; where: string }>();
  for (const line of lines.slice(0, 400)) {
    const t = normalise(line.text);
    if (t.length > 120) continue;                   // a paragraph, not a column header
    for (const s of SCALES) {
      if (s.re.test(t)) {
        const seen = counts.get(s.scale) ?? { n: 0, label: s.label, where: line.text.trim() };
        counts.set(s.scale, { ...seen, n: seen.n + 1 });
        break;
      }
    }
  }
  if (counts.size === 0) {
    return { scale: 1, note: "No reporting scale stated, so figures are read as written. Check the report's own units." };
  }
  const [scale, best] = [...counts.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  const others = [...counts.entries()].filter(([s]) => s !== scale);
  const note =
    `Figures read in ${best.label}, from "${best.where}".` +
    (others.length ? ` The document also mentions ${others.map(([, o]) => o.label).join(" and ")}; check the statement you want.` : "");
  return { scale, note };
}

/**
 * Which column is the current period. Reports usually put it first, but not
 * always, and reading the prior year as the current one is a silent, total
 * failure of the whole tool.
 */
export function detectPeriods(lines: Line[]): { years: number[]; currentIsFirst: boolean } {
  for (const line of lines) {
    const years = line.numbers.filter((n) => n.looksLikeYear).map((n) => n.value);
    if (years.length >= 2 && years[0] !== years[1]) {
      return { years, currentIsFirst: years[0] > years[1] };
    }
  }
  return { years: [], currentIsFirst: true };
}

// ---------------------------------------------------------------- labels

interface Rule {
  /** Matched against the normalised label. */
  re: RegExp;
  score: number;
}

interface Spec {
  rules: Rule[];
  /** A line matching any of these is not this figure, whatever else it matched. */
  reject?: RegExp[];
  /** Per-share figures are small; balances are large. Used only to break ties. */
  perShare?: boolean;
  /**
   * A count or a per-share amount. The reporting scale applies to money, and
   * a share register is stated in units even when the table beside it is in
   * thousands, so multiplying it by a thousand is a hundred-fold error.
   */
  unscaled?: boolean;
}

const SPECS: Record<FigureKey, Spec> = {
  net_profit_from_operations: {
    rules: [
      { re: /^profit for the (?:year|period)/, score: 0.95 },
      { re: /^profit after (?:income )?tax/, score: 0.92 },
      { re: /^(?:net )?profit attributable to (?:equity holders|owners|shareholders)/, score: 0.9 },
      { re: /^(?:total )?comprehensive income for the (?:year|period)/, score: 0.6 },
      { re: /\bnet profit\b/, score: 0.7 },
      { re: /\bprofit from operations\b/, score: 0.68 },
    ],
    reject: [/before (?:income )?tax/, /per share/, /discontinued/],
  },
  dividend_per_share_proposed: {
    rules: [
      { re: /^(?:proposed |final |total )?dividends? per share/, score: 0.95 },
      { re: /\bdividends? per share\b/, score: 0.85 },
      { re: /^dividends? (?:declared |proposed )?per (?:ordinary )?share/, score: 0.9 },
    ],
    reject: [/dividend cover/, /yield/],
    perShare: true,
    unscaled: true,
  },
  cash_and_bank: {
    rules: [
      { re: /^cash and bank balances/, score: 0.95 },
      { re: /^bank (?:and cash )?balances/, score: 0.88 },
      { re: /^cash (?:and cash equivalents|at bank(?: and in hand)?)/, score: 0.85 },
      { re: /\bcash and bank\b/, score: 0.8 },
    ],
    reject: [/restricted/, /movement in/, /net (?:increase|decrease)/],
  },
  shares_issued: {
    rules: [
      { re: /^(?:number of )?(?:issued )?(?:ordinary )?shares in issue/, score: 0.95 },
      { re: /^issued and fully paid/, score: 0.9 },
      { re: /\bnumber of (?:ordinary )?shares\b/, score: 0.88 },
      { re: /weighted average number of (?:ordinary )?shares/, score: 0.7 },
    ],
    reject: [/per share/, /treasury/, /option/],
    unscaled: true,
  },
  current_assets: {
    rules: [
      { re: /^total current assets/, score: 0.97 },
      { re: /^current assets$/, score: 0.6 },
      { re: /\btotal current assets\b/, score: 0.9 },
    ],
    reject: [/non[- ]?current/],
  },
  current_liabilities: {
    rules: [
      { re: /^total current liabilities/, score: 0.97 },
      { re: /^current liabilities$/, score: 0.6 },
      { re: /\btotal current liabilities\b/, score: 0.9 },
    ],
    reject: [/non[- ]?current/],
  },
  cash_and_securities: {
    rules: [
      { re: /^cash and cash equivalents/, score: 0.9 },
      { re: /^(?:government|investment|treasury) securities/, score: 0.85 },
      { re: /^cash and (?:short[- ]term )?(?:deposits|investments|securities)/, score: 0.88 },
      { re: /\bdeposits with banks?\b/, score: 0.7 },
    ],
    reject: [/movement in/, /net (?:increase|decrease)/],
  },
  non_current_assets: {
    rules: [
      { re: /^total non[- ]?current assets/, score: 0.97 },
      { re: /^non[- ]?current assets$/, score: 0.6 },
      { re: /\btotal non[- ]?current assets\b/, score: 0.9 },
    ],
  },
  non_current_liabilities: {
    rules: [
      { re: /^total non[- ]?current liabilities/, score: 0.97 },
      { re: /^non[- ]?current liabilities$/, score: 0.6 },
      { re: /\btotal non[- ]?current liabilities\b/, score: 0.9 },
    ],
  },
  total_income: {
    rules: [
      { re: /^total (?:income|revenue|revenues)\b/, score: 0.97 },
      { re: /^(?:revenue|turnover|gross earnings|gross premium(?: revenue| written)?)\b/, score: 0.85 },
      { re: /^total operating income/, score: 0.9 },
      { re: /\btotal income\b/, score: 0.88 },
    ],
    reject: [/comprehensive income/, /other income/, /expense/, /tax/],
  },
  total_expenses: {
    rules: [
      { re: /^total (?:expenses|operating expenses|costs and expenses|expenditure)\b/, score: 0.97 },
      { re: /^total (?:claims and )?(?:benefits and )?expenses\b/, score: 0.9 },
      { re: /\btotal (?:operating )?expenses\b/, score: 0.88 },
      { re: /^operating expenses$/, score: 0.6 },
    ],
    reject: [/income/, /finance income/],
  },
  income_tax_expense: {
    rules: [
      { re: /^income tax expense/, score: 0.97 },
      { re: /^tax(?:ation)? (?:expense|charge)/, score: 0.9 },
      { re: /^(?:income )?tax(?:ation)?$/, score: 0.7 },
      { re: /\bincome tax expense\b/, score: 0.88 },
    ],
    reject: [/deferred tax (?:asset|liabilit)/, /payable/, /recoverable/, /before/],
  },
};

// ---------------------------------------------------------------- reading

interface Hit {
  score: number;
  value: number;
  prior: number | null;
  label: string;
  page: string;
  column: number;
}

/**
 * Which number on the line is the figure.
 *
 * A statement line reads "Total income   3   19,864,152   18,341,006": a note
 * reference, then one column per period. Taking the first number gives the
 * note number, which is the difference between reading a company's revenue and
 * reading the digit 3.
 */
export function pickNumber(
  line: Line, currentIsFirst: boolean, periods: number,
): { current: NumberToken; prior: NumberToken | null } | null {
  const usable = line.numbers.filter((n) => !n.looksLikeYear);
  if (usable.length === 0) return null;

  // Bare small integers on the left, in excess of the period columns, are note
  // references. A figure written with a separator or a decimal never is.
  let start = 0;
  while (usable.length - start > periods && isNoteReference(usable[start])) start += 1;
  const columns = usable.slice(start);
  if (columns.length === 0) return { current: usable[0], prior: null };

  return currentIsFirst
    ? { current: columns[0], prior: columns[1] ?? null }
    : { current: columns[columns.length - 1], prior: columns[columns.length - 2] ?? null };
}

const isNoteReference = (token: NumberToken): boolean =>
  Number.isInteger(token.value) &&
  Math.abs(token.value) < 1000 &&
  !/[,.]/.test(token.raw);

/** Read every figure the label table can find, with a confidence on each. */
export function extract(lines: Line[]): Extraction {
  const { scale, note: scaleNote } = detectScale(lines);
  const { years, currentIsFirst } = detectPeriods(lines);
  // Two columns is the shape of every statement that states a comparative.
  const periods = Math.max(years.length, 2);
  const notes: string[] = [];

  const hits: Record<string, Hit[]> = {};
  for (const line of lines) {
    const label = normalise(line.text);
    if (!label) continue;
    for (const key of FIGURE_KEYS) {
      const spec = SPECS[key];
      if (spec.reject?.some((r) => r.test(label))) continue;
      let best = 0;
      for (const rule of spec.rules) if (rule.re.test(label)) best = Math.max(best, rule.score);
      if (best === 0) continue;
      const picked = pickNumber(line, currentIsFirst, periods);
      if (!picked) continue;
      (hits[key] ??= []).push({
        score: best,
        value: picked.current.value,
        prior: picked.prior?.value ?? null,
        label: line.text.trim(),
        page: line.page,
        column: picked.current.column,
      });
    }
  }

  const candidates: Partial<Record<FigureKey, Candidate>> = {};
  const missing: FigureKey[] = [];

  for (const key of FIGURE_KEYS) {
    const found = (hits[key] ?? []).slice().sort((a, b) => b.score - a.score);
    if (found.length === 0) {
      missing.push(key);
      continue;
    }
    const top = found[0];
    let confidence = top.score;

    // Two different lines matching almost as well is exactly the case where a
    // silent pick is dangerous. Say so by lowering the confidence.
    const rival = found.find((h) => h.value !== top.value && top.score - h.score < 0.15);
    if (rival) {
      confidence -= 0.25;
      notes.push(
        `${labelFor(key)}: "${top.label}" and "${rival.label}" both fit. Taking the first; check it.`,
      );
    }
    // A per-share figure in the millions, or a balance below ten, is a
    // mis-read, whatever the label said.
    const perShare = SPECS[key].perShare ?? false;
    if (perShare && Math.abs(top.value) > 1000) confidence -= 0.3;
    if (!perShare && key !== "shares_issued" && Math.abs(top.value) > 0 && Math.abs(top.value) < 10) {
      confidence -= 0.2;
    }

    confidence = Math.max(0, Math.min(1, confidence));
    if (confidence < FLOOR) {
      missing.push(key);
      continue;
    }

    const unscaled = SPECS[key].unscaled ?? false;
    candidates[key] = {
      key,
      value: unscaled ? top.value : top.value * scale,
      rawValue: top.value,
      priorValue: top.prior === null ? null : (unscaled ? top.prior : top.prior * scale),
      scale: unscaled ? 1 : scale,
      confidence,
      label: top.label,
      page: top.page,
      column: top.column,
      alternatives: found
        .slice(1, 4)
        .filter((h) => h.value !== top.value)
        .map((h) => ({
          value: unscaled ? h.value : h.value * scale,
          label: h.label,
          page: h.page,
          confidence: h.score,
        })),
    };
  }

  if (!currentIsFirst && years.length >= 2) {
    notes.push(`Columns run oldest first (${years.join(", ")}), so the last column was read as the current period.`);
  }
  notes.push(...reconcile(candidates));

  return { candidates, missing, notes, scale, scaleNote, currentIsFirstColumn: currentIsFirst, periodYears: years };
}

/**
 * Arithmetic the statement has to satisfy. A figure that reads plausibly on its
 * own and breaks the balance sheet is the one worth catching.
 */
export function reconcile(c: Partial<Record<FigureKey, Candidate>>): string[] {
  const out: string[] = [];
  const v = (k: FigureKey) => c[k]?.value;

  const ca = v("current_assets");
  const cash = v("cash_and_bank");
  if (ca !== undefined && cash !== undefined && cash > ca) {
    out.push("Cash and bank exceeds total current assets. One of the two was read off the wrong line.");
  }

  const income = v("total_income");
  const expenses = v("total_expenses");
  const tax = v("income_tax_expense");
  const profit = v("net_profit_from_operations");
  if (income !== undefined && expenses !== undefined && profit !== undefined) {
    const implied = income - expenses - (tax ?? 0);
    const gap = Math.abs(implied - profit);
    const scaleOf = Math.max(Math.abs(profit), 1);
    if (gap / scaleOf > 0.15) {
      out.push(
        `Income less expenses and tax gives ${fmt(implied)}, against a stated profit of ${fmt(profit)}. ` +
        "The three do not reconcile, so at least one is wrong or measured differently.",
      );
    }
  }

  const shares = v("shares_issued");
  if (shares !== undefined && shares > 0 && profit !== undefined) {
    const eps = profit / shares;
    if (Math.abs(eps) > 1000) {
      out.push("Earnings per share come out above 1,000, which usually means the share count was read in thousands. Check it.");
    }
  }
  return out;
}

const HUMAN: Record<FigureKey, string> = {
  net_profit_from_operations: "Net profit from operations",
  dividend_per_share_proposed: "Dividend per share proposed",
  cash_and_bank: "Cash and bank",
  shares_issued: "Shares issued",
  current_assets: "Current assets",
  current_liabilities: "Current liabilities",
  cash_and_securities: "Cash and securities held",
  non_current_assets: "Non-current assets",
  non_current_liabilities: "Non-current liabilities",
  total_income: "Total income",
  total_expenses: "Total expenses",
  income_tax_expense: "Income tax expense",
};

export const labelFor = (key: FigureKey): string => HUMAN[key];

const fmt = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 0 });
