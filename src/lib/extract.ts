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

/** Mirrors the kernel's sector profiles; a statement's shape follows from it. */
export type Profile = "industrial" | "insurer" | "bank" | "property" | "telco";

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

/**
 * The label a rule is matched against: normalised, then stripped of the note
 * reference that numbers the row.
 *
 * A Kenyan bank's statement numbers every line - "21 TOTALASSETS", "6.8 Total
 * Other Operating Expenses", "10 Current tax". Matching those against a rule
 * anchored at the start of the label fails on every one of them, which is most
 * of why the first real bank report read three figures out of twelve.
 */
export function labelOf(text: string): string {
  return normalise(text)
    .replace(/^[a-z] /, "")                 // a section marker: "A ASSETS"
    .replace(/^\d+(?:\.\d+)? /, "")         // a note reference: "21 ", "6.8 "
    .trim();
}

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
  // A figure is negative in brackets, or with a minus touching the digits.
  // A dash standing on its own is a nil marker - "DIVIDEND PER SHARE - (KSHS)
  // - 3.75 - -" pays 3.75, not minus 3.75, and reading it as negative flips
  // the sign on a real dividend.
  //
  // Commas group thousands; a space never does. Two columns of a table are
  // separated by spaces, so allowing a space as a separator glues them into
  // one wrong number.
  const GROUPED = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?`;
  const PLAIN = String.raw`\d+(?:\.\d+)?`;
  const re = new RegExp(
    String.raw`\(\s*(?:${GROUPED}|${PLAIN})\s*\)` +   // (1,234) - negative
    String.raw`|-(?:${GROUPED}|${PLAIN})` +              // -1,234  - negative
    String.raw`|(?:${GROUPED}|${PLAIN})%?`,              // 1,234   - plain
    "g",
  );
  let match: RegExpExecArray | null;
  let column = 0;
  while ((match = re.exec(text)) !== null) {
    const raw = match[0].trim();
    if (raw.endsWith("%")) continue;               // a ratio is not a figure
    const negative = raw.startsWith("(") || raw.startsWith("-");
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

/** Currency markers that turn a word like "millions" into a units declaration. */
const CURRENCY_NEAR = /\b(kshs?|ksh|kes|shs|sh|usd|eur|gbp|figures|amounts|stated|expressed|all)\b/;

/**
 * Is this line declaring the units, or just using the word?
 *
 * "Connecting millions of Kenyans to what matters most" is a sentence from a
 * results booklet, and reading it as a units declaration multiplied every
 * figure in the document by a million. A declaration is short, or it sits
 * beside a currency marker. A sentence is neither.
 */
function declaresUnits(text: string, re: RegExp): boolean {
  if (text.length <= 30) return true;               // "in thousands", "kshs '000"
  const at = text.search(re);
  if (at < 0) return false;
  const window = text.slice(Math.max(0, at - 20), at + 20);
  return CURRENCY_NEAR.test(window);
}

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
      if (s.re.test(t) && declaresUnits(t, s.re)) {
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

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun",
                "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Which column is the current period, and how many columns there are.
 *
 * Reading the prior year as the current one is a silent, total failure of the
 * whole tool, and the header that gives it away is rarely two bare years. A
 * Kenyan bank's half-year statement heads its columns
 * "JUN 2025 · DEC 2025 · MAR 2026 · JUN 2026" - oldest first, years repeating,
 * four of them, and eight once the company and the group are side by side. So
 * the header is read as a sequence and its direction inferred, rather than
 * matched against a shape.
 */
/**
 * Which way a run of period keys points, or null if it says nothing.
 *
 * A statement that prints the company and the group side by side repeats its
 * whole header - four columns, then the same four again - so the sequence is
 * not monotonic overall and reads as noise unless the repeat is recognised.
 */
function readDirection(keys: number[]): "newest first" | "oldest first" | null {
  const rising = keys.every((k, i) => i === 0 || k >= keys[i - 1]);
  const falling = keys.every((k, i) => i === 0 || k <= keys[i - 1]);
  if (rising !== falling) return falling ? "newest first" : "oldest first";
  if (rising && falling) return null;                       // every key equal

  // Not monotonic: split into maximal runs and accept only if they are all the
  // same length and all point the same way.
  const runs: number[][] = [[keys[0]]];
  for (let i = 1; i < keys.length; i += 1) {
    const run = runs[runs.length - 1];
    const grew = keys[i] >= run[run.length - 1];
    const runGrows = run.length === 1 ? grew : run[1] >= run[0];
    if (grew === runGrows) run.push(keys[i]);
    else runs.push([keys[i]]);
  }
  if (runs.length < 2) return null;
  const size = runs[0].length;
  if (size < 2 || !runs.every((r) => r.length === size)) return null;
  const directions = new Set(runs.map((r) => (r[r.length - 1] >= r[0] ? "oldest first" : "newest first")));
  if (directions.size !== 1) return null;
  return [...directions][0] as "newest first" | "oldest first";
}

export function detectPeriods(lines: Line[]): { years: number[]; currentIsFirst: boolean } {
  let best: { years: number[]; currentIsFirst: boolean } | null = null;

  for (const line of lines.slice(0, 400)) {
    const years = line.numbers.filter((n) => n.looksLikeYear).map((n) => n.value);
    if (years.length < 2) continue;

    // Months disambiguate columns inside the same year.
    const months = [...normalise(line.text).matchAll(/\b([a-z]{3})[a-z]*\b/g)]
      .map((m) => MONTHS.indexOf(m[1]))
      .filter((i) => i >= 0);
    const keys = years.map((y, i) => y * 12 + (months[i] ?? 0));

    const direction = readDirection(keys);
    if (direction === null) continue;          // flat or unordered: says nothing

    const found = { years, currentIsFirst: direction === "newest first" };
    // The header with the most columns is the one describing the table.
    if (!best || years.length > best.years.length) best = found;
  }
  return best ?? { years: [], currentIsFirst: true };
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

/**
 * What a bank's statement calls things, and what it does not have at all.
 *
 * A bank has no current assets and no non-current assets: it publishes TOTAL
 * ASSETS and TOTAL LIABILITIES and stops. Reading a bank with the industrial
 * label table finds three figures out of twelve, which is what happened to the
 * first real report put through this.
 *
 * The mapping is deliberate and is printed on the memo: total assets stand in
 * for current assets, total liabilities for current liabilities, and the
 * non-current pair is zero. Net capital then comes out as total assets less
 * total liabilities, which is the bank's equity - the figure net asset value
 * per share actually needs. The liquidity ratio it also produces is
 * meaningless for a bank, and the fragility sheet already suppresses the ratio
 * that would mislead.
 */
const SECTOR_RULES: Partial<Record<Profile, Partial<Record<FigureKey, Rule[]>>>> = {
  bank: {
    net_profit_from_operations: [
      { re: /^profit after tax,? exceptional items and non[- ]?controlling interest/, score: 0.97 },
      { re: /^profit after tax and exceptional items/, score: 0.93 },
      { re: /^profit after exceptional items/, score: 0.9 },
      { re: /\bprofit after tax\b/, score: 0.88 },
    ],
    total_income: [
      { re: /^total operating income/, score: 0.97 },
      { re: /^total interest income/, score: 0.7 },
      { re: /^\d+(?:\.\d+)? total operating income/, score: 0.95 },
    ],
    total_expenses: [
      { re: /^total other operating expenses/, score: 0.97 },
      { re: /^total operating expenses/, score: 0.95 },
      { re: /^\d+(?:\.\d+)? total other operating expenses/, score: 0.95 },
    ],
    current_assets: [
      { re: /^total ?assets\b/, score: 0.95 },
      { re: /^\d+ total ?assets\b/, score: 0.93 },
    ],
    current_liabilities: [
      { re: /^total liabilities\b/, score: 0.95 },
      { re: /^\d+ total liabilities\b/, score: 0.93 },
    ],
    cash_and_bank: [
      { re: /^cash both local and foreign/, score: 0.95 },
      { re: /^cash and balances (?:due from|with) (?:the )?central bank/, score: 0.93 },
      { re: /^balances due from central bank/, score: 0.85 },
    ],
    cash_and_securities: [
      { re: /^kenya government (?:and other )?securities/, score: 0.9 },
      { re: /^investment securities/, score: 0.85 },
    ],
    income_tax_expense: [
      { re: /^current tax\b/, score: 0.9 },
    ],
  },
  insurer: {
    total_income: [
      { re: /^gross (?:written )?premium/, score: 0.9 },
      { re: /^total income/, score: 0.95 },
    ],
    total_expenses: [
      { re: /^total (?:claims and )?(?:benefits and )?expenses/, score: 0.95 },
    ],
  },
};

/** Figures a sector genuinely does not report. Taken as zero, and said so. */
const SECTOR_ZEROES: Partial<Record<Profile, FigureKey[]>> = {
  bank: ["non_current_assets", "non_current_liabilities"],
};

/** Earnings per share, used only to derive a share count nobody printed. */
const EPS_RULES: Rule[] = [
  { re: /^earnings? per share/, score: 0.95 },
  { re: /^basic (?:and diluted )?earnings? per share/, score: 0.95 },
  { re: /\bearnings? per share\b/, score: 0.85 },
];

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
  let usable = line.numbers.filter((n) => !n.looksLikeYear);

  // The note reference that was stripped off the label is still sitting in the
  // numbers. Drop it, and if nothing is left the line is a note heading -
  // "11 CASH AND CASH EQUIVALENTS" - which has a label and no figure at all.
  if (startsWithNoteReference(line.text) && usable.length > 0) usable = usable.slice(1);
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

/** Does the line open with the number that enumerates it, rather than a figure? */
export const startsWithNoteReference = (text: string): boolean =>
  /^\s*(?:[A-Za-z]\s+)?\d+(?:\.\d+)?\s+\D/.test(text);

const isNoteReference = (token: NumberToken): boolean =>
  Number.isInteger(token.value) &&
  Math.abs(token.value) < 1000 &&
  !/[,.]/.test(token.raw);

/** Read every figure the label table can find, with a confidence on each. */
export function extract(lines: Line[], profile: Profile = "industrial"): Extraction {
  const { scale, note: scaleNote } = detectScale(lines);
  const { years, currentIsFirst } = detectPeriods(lines);
  // Two columns is the shape of every statement that states a comparative.
  const periods = Math.max(years.length, 2);
  const notes: string[] = [];

  const overlay = SECTOR_RULES[profile] ?? {};
  const zeroes = new Set(SECTOR_ZEROES[profile] ?? []);

  const hits: Record<string, Hit[]> = {};
  const epsHits: Hit[] = [];
  for (const line of lines) {
    const label = labelOf(line.text);
    if (!label) continue;

    let epsBest = 0;
    for (const rule of EPS_RULES) if (rule.re.test(label)) epsBest = Math.max(epsBest, rule.score);
    if (epsBest > 0 && !/dividend/.test(label)) {
      const picked = pickNumber(line, currentIsFirst, periods);
      // A per-share figure is small. Anything large on that line is a note
      // reference or a total that wandered in.
      if (picked && Math.abs(picked.current.value) > 0 && Math.abs(picked.current.value) < 1000) {
        epsHits.push({ score: epsBest, value: picked.current.value, prior: null,
                       label: line.text.trim(), page: line.page, column: picked.current.column });
      }
    }

    for (const key of FIGURE_KEYS) {
      if (zeroes.has(key)) continue;
      const spec = SPECS[key];
      if (spec.reject?.some((r) => r.test(label))) continue;
      let best = 0;
      for (const rule of spec.rules) if (rule.re.test(label)) best = Math.max(best, rule.score);
      for (const rule of overlay[key] ?? []) if (rule.re.test(label)) best = Math.max(best, rule.score);
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
    if (zeroes.has(key)) {
      candidates[key] = {
        key, value: 0, rawValue: 0, priorValue: 0, scale: 1, confidence: 1,
        label: `A ${profile} does not report this; taken as zero.`,
        page: "by sector", column: 0, alternatives: [],
      };
      continue;
    }
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

  // A bank publishes earnings per share and not the share count. Profit
  // divided by earnings per share recovers it, and the memo says that is where
  // it came from rather than presenting it as something that was read.
  if (!candidates.shares_issued && epsHits.length > 0) {
    const profit = candidates.net_profit_from_operations?.value;
    const eps = epsHits.sort((a, b) => b.score - a.score)[0];
    if (profit && eps.value !== 0) {
      const shares = Math.round(profit / eps.value);
      if (shares > 0 && Number.isFinite(shares)) {
        candidates.shares_issued = {
          key: "shares_issued", value: shares, rawValue: shares, priorValue: null,
          scale: 1, confidence: 0.55,
          label: `Derived: profit ÷ ${eps.value} earnings per share, from "${eps.label}"`,
          page: eps.page, column: eps.column, alternatives: [],
        };
        const at = missing.indexOf("shares_issued");
        if (at >= 0) missing.splice(at, 1);
        notes.push(
          `Shares issued was not printed, so it is profit divided by earnings per share ` +
          `of ${eps.value}: ${shares.toLocaleString("en-GB")}. Check it against the register.`,
        );
      }
    }
  }

  // Always say which column was taken. The reader can check it in one glance,
  // and reading the wrong period is the one failure that looks like an answer.
  if (years.length >= 2) {
    notes.push(
      `${years.length} period columns detected (${years.join(", ")}); the ` +
      `${currentIsFirst ? "first" : "last"} was read as the current one.`,
    );
  }

  if (!currentIsFirst && years.length >= 2) {
    notes.push(`Columns run oldest first (${years.join(", ")}), so the last column was read as the current period.`);
  }
  notes.push(...reconcile(candidates));

  return { candidates, missing, notes, scale, scaleNote,
           currentIsFirstColumn: currentIsFirst, periodYears: years };
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
