/**
 * The tool. A report in, a memo out.
 *
 * Twelve figures, a price, a sector and the world outside the company, all
 * computed by the same kernel the fixtures pin, entirely in the browser. The
 * report reader fills the figures in; nothing here requires it, and nothing
 * here requires a network either.
 */
import { useEffect, useMemo, useState } from "react";
import { type Inputs, type Origin, type SectorProfile } from "../lib/kernel";
import type { Model } from "../hooks/useModel";
import { DEFAULT_MACRO, buildMemo, periodsFromReport, type Macro, type Period } from "../lib/memo";
import { ageInDays, loadCollected, loadSeries, type Collected, type Observation } from "../lib/collected";
import { Card, CardHeading } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Field, Select } from "../components/ui/field";
import { ReportReader } from "../components/ReportReader";
import { BLANK_FACTORS, DecisionFactors, type Factors } from "../components/DecisionFactors";
import { MemoView } from "../components/MemoView";
import { newId, read, write } from "../lib/store";
import type { SavedMemo } from "../lib/compare";

const BLANK: Inputs = {
  net_profit_from_operations: 0, dividend_per_share_proposed: 0, cash_and_bank: 0,
  shares_issued: 1, current_assets: 0, current_liabilities: 1, cash_and_securities: 0,
  non_current_assets: 0, non_current_liabilities: 0, total_income: 0,
  total_expenses: 1, income_tax_expense: 0,
};

const UNGA: Inputs = {
  net_profit_from_operations: 508_816_000, dividend_per_share_proposed: 1,
  cash_and_bank: 1_102_359_000, shares_issued: 75_706_986,
  current_assets: 5_819_762_000, current_liabilities: 2_531_888_000,
  cash_and_securities: 1_102_359_000, non_current_assets: 3_380_021_000,
  non_current_liabilities: 971_166_000, total_income: 19_864_152_000,
  total_expenses: 19_079_843_000, income_tax_expense: 225_585_000,
};

const FIELDS: { key: keyof Inputs; label: string; group: string }[] = [
  { key: "net_profit_from_operations", label: "Net profit from operations", group: "Earnings" },
  { key: "dividend_per_share_proposed", label: "Dividend per share proposed", group: "Earnings" },
  { key: "shares_issued", label: "Shares issued", group: "Earnings" },
  { key: "cash_and_bank", label: "Cash and bank", group: "Balance sheet" },
  { key: "current_assets", label: "Current assets", group: "Balance sheet" },
  { key: "current_liabilities", label: "Current liabilities", group: "Balance sheet" },
  { key: "cash_and_securities", label: "Cash and securities held", group: "Balance sheet" },
  { key: "non_current_assets", label: "Non-current assets", group: "Balance sheet" },
  { key: "non_current_liabilities", label: "Non-current liabilities", group: "Balance sheet" },
  { key: "total_income", label: "Total income", group: "Income and expense" },
  { key: "total_expenses", label: "Total expenses", group: "Income and expense" },
  { key: "income_tax_expense", label: "Income tax expense", group: "Income and expense" },
];

const SECTORS: { value: SectorProfile; label: string }[] = [
  { value: "industrial", label: "Industrial" },
  { value: "insurer", label: "Insurer" },
  { value: "bank", label: "Bank" },
  { value: "property", label: "Property" },
  { value: "telco", label: "Telco" },
];

const ORIGINS: { value: Origin; label: string }[] = [
  { value: "nse-feed", label: "NSE feed" },
  { value: "manual", label: "Typed by hand" },
  { value: "private-deal", label: "Private deal" },
  { value: "foreign-listed", label: "Foreign listed" },
  { value: "foreign-private", label: "Foreign private" },
];

const latest = (series: Record<string, Observation[]> | null, id: string): number | null => {
  const rows = series?.[id];
  if (!rows?.length) return null;
  return rows[rows.length - 1].value;
};

export function Analyse({ model }: { model: Model }) {
  const [name, setName] = useState("UNGA Group Limited");
  const [sector, setSector] = useState<SectorProfile>("industrial");
  const [inputs, setInputs] = useState<Inputs>(UNGA);
  const [prior, setPrior] = useState<Partial<Inputs>>({});
  const [periodLabels, setPeriodLabels] = useState({ current: "Latest", prior: "Prior" });
  const [price, setPrice] = useState("28");
  const [origin, setOrigin] = useState<Origin>("manual");
  const [note, setNote] = useState("");
  const [source, setSource] = useState<string | null>(null);
  const [macro, setMacro] = useState<Macro>(DEFAULT_MACRO);
  const [factors, setFactors] = useState<Factors>(BLANK_FACTORS);
  const [collected, setCollected] = useState<Collected | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);

  useEffect(() => {
    void loadCollected().then(setCollected);
    // Where the collector has a figure, it wins over the default; a typed
    // figure then wins over both, because the person looking at the report can
    // see something the feed cannot.
    void loadSeries().then((series) => {
      if (!series) return;
      setMacro((m) => ({
        ...m,
        inflation: (latest(series, "ke.inflation") ?? m.inflation * 100) / 100,
        usdKes: latest(series, "fx.usdkes") ?? m.usdKes,
        btcUsd: latest(series, "btc.usd") ?? m.btcUsd,
        cbr: (latest(series, "cbk.cbr") ?? (m.cbr === null ? null : m.cbr * 100)) === null
          ? null
          : (latest(series, "cbk.cbr") ?? m.cbr! * 100) / 100,
      }));
    });
  }, []);

  const parsed = Number(price.replace(/,/g, ""));

  const periods: Period[] = useMemo(
    () => periodsFromReport(periodLabels.current, periodLabels.prior, inputs, prior),
    [inputs, prior, periodLabels],
  );

  const memo = useMemo(() => {
    if (!(parsed > 0) || !(inputs.shares_issued > 0)) return null;
    try {
      return buildMemo({
        inputs,
        price: { amount: parsed, origin, note: note || undefined },
        params: model, profile: sector, macro, periods,
        holdFloor: model.holdFloor,
      });
    } catch {
      return null;   // a half-typed number is not an error worth shouting about
    }
  }, [inputs, parsed, origin, note, sector, macro, periods, model]);

  const set = (key: keyof Inputs) => (raw: string) => {
    const n = Number(raw.replace(/,/g, ""));
    setInputs((prev) => ({ ...prev, [key]: Number.isFinite(n) ? n : 0 }));
  };

  const setMacroNumber = (key: "inflation" | "btcAssumedReturn" | "borrowingSpread") => (raw: string) => {
    const n = Number(raw);
    setMacro((m) => ({ ...m, [key]: Number.isFinite(n) ? n / 100 : 0 }));
  };

  const groups = [...new Set(FIELDS.map((f) => f.group))];

  /** Keep the memo's headline figures so it can be held against another one. */
  const saveForComparison = () => {
    if (!memo) return;
    const row: SavedMemo = {
      id: newId(),
      savedAt: new Date().toISOString(),
      name: name || "Untitled",
      sector,
      currency: "KES",
      origin,
      price: parsed,
      discountRate: model.r,
      growth: model.g,
      verdict: memo.verdict,
      margin: memo.base.margin,
      evEbitda: memo.multiples.evEbitda,
      priceToBook: memo.multiples.priceToBook,
      trailingPe: memo.base.valuation.trailingPe,
      netYield: memo.hurdles.netYield,
      realYield: memo.hurdles.realYield,
      energyTotal: memo.energy.total,
      energyBand: memo.energy.band,
      irr: memo.deal.irr,
    };
    write("memos", [...read<SavedMemo[]>("memos", []), row]);
    setSavedName(row.name);
  };

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4 pt-4">
        <p className="text-[0.75rem] tracking-[0.03em] uppercase text-on-surface-variant">
          {name || "Untitled"}
        </p>
        <p className="display-sm text-on-surface">{memo ? memo.verdict : "Enter the figures"}</p>
        {memo && (
          <p className="text-[0.9375rem] leading-7 text-on-surface-variant max-w-[68ch]">
            {memo.rationale[0]} Priced at {memo.base.valuation.provenance}.
          </p>
        )}
        {source && (
          <p className="text-[0.75rem] text-on-surface-variant">Figures read from {source}.</p>
        )}
        <div className="flex flex-wrap gap-3 pt-2">
          <Button onClick={() => {
            setInputs(UNGA); setPrior({}); setPrice("28"); setName("UNGA Group Limited");
            setSector("industrial"); setSource(null);
          }}>
            Load worked example
          </Button>
          <Button variant="outlined" onClick={() => {
            setInputs(BLANK); setPrior({}); setPrice(""); setName(""); setNote(""); setSource(null);
            setFactors(BLANK_FACTORS); setSavedName(null);
          }}>
            Start blank
          </Button>
          {memo && (
            <Button variant="tonal" onClick={saveForComparison}>
              Save to compare
            </Button>
          )}
        </div>
        {savedName && (
          <p role="status" className="text-[0.8125rem] text-on-surface-variant">
            {savedName} saved. It is on the Compare screen, restated onto whatever rate you set there.
          </p>
        )}
      </section>

      <ReportReader
        onApply={(figures, from) => {
          setInputs((prev) => ({ ...prev, ...figures.current }));
          setPrior(figures.prior);
          setPeriodLabels(figures.labels);
          setSource(from);
        }}
      />

      <Card>
        <div className="flex flex-col gap-5">
          <CardHeading>The company and the price</CardHeading>
          <Field label="Company" value={name} onValue={setName} placeholder="Name it" />
          <Select label="Sector" value={sector} options={SECTORS} onValue={(v) => setSector(v as SectorProfile)} />
          <Field label="Price per share" value={price} onValue={setPrice} inputMode="decimal" suffix="KES" />
          <Select label="Where the price came from" value={origin} options={ORIGINS} onValue={(v) => setOrigin(v as Origin)} />
          {origin === "private-deal" && (
            <Field label="What this price is" value={note} onValue={setNote}
                   placeholder="An offer, a round, a valuation" hint="Required for a private deal" />
          )}
          {collected && (
            <p className="text-[0.75rem] text-on-surface-variant">
              Collector last ran {collected.generated_at.slice(0, 10)}
              {(ageInDays(collected.generated_at) ?? 0) > 4 && " — stale"}
              {collected.counters.length > 0 &&
                `, holding ${collected.counters.length} counter${collected.counters.length === 1 ? "" : "s"}`}.
            </p>
          )}
        </div>
      </Card>

      {groups.map((group) => (
        <Card key={group}>
          <div className="flex flex-col gap-5">
            <CardHeading>{group}</CardHeading>
            {FIELDS.filter((f) => f.group === group).map((f) => (
              <Field
                key={f.key}
                label={f.label}
                value={String(inputs[f.key] ?? "")}
                onValue={set(f.key)}
                inputMode="decimal"
                hint={prior[f.key] !== undefined
                  ? `${periodLabels.prior}: ${prior[f.key]!.toLocaleString("en-GB")}`
                  : undefined}
              />
            ))}
          </div>
        </Card>
      ))}

      <Card>
        <div className="flex flex-col gap-5">
          <CardHeading>The world outside the company</CardHeading>
          <Field label="Inflation" value={(macro.inflation * 100).toFixed(1)}
                 onValue={setMacroNumber("inflation")} inputMode="decimal" suffix="%"
                 hint="The hurdle the income has to clear. Filled from the collector where it has a figure." />
          <Field label="Assumed bitcoin return" value={(macro.btcAssumedReturn * 100).toFixed(0)}
                 onValue={setMacroNumber("btcAssumedReturn")} inputMode="decimal" suffix="% a year"
                 hint="The opportunity cost the return is compared against. Nobody can forecast it; stating it is what makes the comparison arguable." />
          <Field label="Borrowing spread over the CBR" value={(macro.borrowingSpread * 100).toFixed(0)}
                 onValue={setMacroNumber("borrowingSpread")} inputMode="decimal" suffix="%"
                 hint="Used only to test whether interest would be sustainable before entry." />
          <Field label="Years to the assumed exit" value={String(macro.holdYears)}
                 onValue={(raw) => setMacro((m) => ({ ...m, holdYears: Math.max(1, Number(raw) || 1) }))}
                 inputMode="numeric" suffix="years" />
          <div className="flex gap-4">
            <Field label="Latest period" value={periodLabels.current}
                   onValue={(v) => setPeriodLabels((p) => ({ ...p, current: v }))} />
            <Field label="Comparative" value={periodLabels.prior}
                   onValue={(v) => setPeriodLabels((p) => ({ ...p, prior: v }))} />
          </div>
        </div>
      </Card>

      {memo && (
        <>
          <DecisionFactors factors={factors} margin={memo.base.margin} onChange={setFactors} />
          <MemoView memo={memo} sector={sector} />
        </>
      )}
    </div>
  );
}
