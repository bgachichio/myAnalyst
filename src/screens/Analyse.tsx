/**
 * The tool. Eleven figures off a financial statement, a price, a sector, and a
 * verdict that updates as you type - computed by the same kernel the fixtures
 * pin, entirely in the browser.
 *
 * A price may be collected, typed, or describe a private company. Nothing here
 * needs a network: the feed fills the price in when it can, and never blocks
 * the work when it cannot.
 */
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { assess, value, type Inputs, type Origin, type Parameters, type SectorProfile } from "../lib/kernel";
import { ageInDays, loadCollected, type Collected } from "../lib/collected";
import { Card, CardHeading } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Field, Select } from "../components/ui/field";
// Recharts is the heaviest thing in the bundle and the chart only appears once
// there is a verdict. Split, so the form opens without waiting for it.
const ValuationBridge = lazy(() =>
  import("../components/ValuationBridge").then((m) => ({ default: m.ValuationBridge })),
);

const DEFAULTS: Parameters = { r: 0.1375, g: 0.04, k: 0.35, n: 15, c: 0.026, w: 0.05, stress: 0.1 };

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

const money = (n: number) =>
  Number.isFinite(n) ? n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 min-h-11">
      <span className="text-[0.875rem] text-on-surface-variant">{label}</span>
      <span className="text-[0.9375rem] tabular-nums text-on-surface">{children}</span>
    </div>
  );
}

export function Analyse() {
  const [name, setName] = useState("UNGA Group Limited");
  const [sector, setSector] = useState<SectorProfile>("industrial");
  const [inputs, setInputs] = useState<Inputs>(UNGA);
  const [price, setPrice] = useState("28");
  const [origin, setOrigin] = useState<Origin>("manual");
  const [note, setNote] = useState("");
  const [collected, setCollected] = useState<Collected | null>(null);

  useEffect(() => {
    loadCollected().then(setCollected);
  }, []);

  const parsed = Number(price.replace(/,/g, ""));
  const result = useMemo(() => {
    if (!(parsed > 0) || !(inputs.shares_issued > 0)) return null;
    try {
      return {
        v: value(inputs, { amount: parsed, origin, note: note || undefined }, DEFAULTS),
        f: assess(inputs, sector, DEFAULTS),
      };
    } catch {
      return null;   // a half-typed number is not an error worth shouting about
    }
  }, [inputs, parsed, origin, note, sector]);

  const set = (key: keyof Inputs) => (raw: string) => {
    const n = Number(raw.replace(/,/g, ""));
    setInputs((prev) => ({ ...prev, [key]: Number.isFinite(n) ? n : 0 }));
  };

  const groups = [...new Set(FIELDS.map((f) => f.group))];

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4 pt-4">
        <p className="text-[0.75rem] tracking-[0.03em] uppercase text-on-surface-variant">
          {name || "Untitled"}
        </p>
        <p className="display-sm text-on-surface">{result ? result.v.decision : "Enter the figures"}</p>
        {result && (
          <p className="text-[0.9375rem] leading-7 text-on-surface-variant max-w-[68ch]">
            Buying {money(result.v.myFutureEps)} of future earnings for{" "}
            {money(result.v.marketPriceFe)}, a margin of {(result.v.margin * 100).toFixed(1)}%.
            Priced at {result.v.provenance}.
          </p>
        )}
        {result?.v.warnings.map((w) => (
          <p key={w} className="text-[0.8125rem] leading-6 text-on-surface-variant max-w-[68ch]
                                border-l-2 border-outline pl-3">
            {w}
          </p>
        ))}
        <div className="flex flex-wrap gap-3 pt-2">
          <Button onClick={() => { setInputs(UNGA); setPrice("28"); setName("UNGA Group Limited"); setSector("industrial"); }}>
            Load worked example
          </Button>
          <Button variant="outlined" onClick={() => { setInputs(BLANK); setPrice(""); setName(""); setNote(""); }}>
            Start blank
          </Button>
        </div>
      </section>

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
              {ageInDays(collected.generated_at)! > 4 && " — stale"}
              {collected.counters.length > 0 && `, holding ${collected.counters.length} counters`}.
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
              />
            ))}
          </div>
        </Card>
      ))}

      {result && (
        <>
          <Card>
            <Suspense fallback={<div className="h-56 rounded-[12px] bg-surface-container-high" aria-hidden="true" />}>
            <ValuationBridge
              title="What the earnings are worth, against what the market charges"
              unit="KES per share"
              summary={`The market charges ${money(result.v.marketPriceFe)} for earnings this model values at ${money(
                result.v.myValuation,
              )} after a ${(DEFAULTS.k * 100).toFixed(0)}% margin of safety.`}
              rows={[
                { name: "Future EPS", value: result.v.myFutureEps, key: false },
                { name: "My valuation", value: result.v.myValuation, key: true },
                { name: "Market's price", value: result.v.marketPriceFe, key: false },
              ]}
            />
            </Suspense>
          </Card>

          <Card>
            <div className="flex flex-col gap-3">
              <CardHeading>The decision</CardHeading>
              <Row label="Entry price, including costs">{money(result.v.entryPrice)}</Row>
              <Row label="Future earnings per share">{money(result.v.myFutureEps)}</Row>
              <Row label="My valuation of them">{money(result.v.myValuation)}</Row>
              <Row label="Present value of dividends">{money(result.v.pvDividendsPs)}</Row>
              <Row label="Cash per share">{money(result.v.cashPs)}</Row>
              <Row label="Market's price of future earnings">{money(result.v.marketPriceFe)}</Row>
              <Row label="Trailing P/E">{result.v.trailingPe.toFixed(2)}</Row>
              <Row label="Net asset value per share">{money(result.v.navPs)}</Row>
              <Row label="Net dividend per share">{money(result.v.netDividendPs)}</Row>
              {result.v.cigarButt && (
                <p className="text-[0.8125rem] leading-6 text-on-surface-variant pt-2 max-w-[68ch]">
                  Trading below net assets: a cigar butt.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <div className="flex flex-col gap-3">
              <CardHeading>Fragility, at a 10% squeeze</CardHeading>
              <Row label="Liquidity ratio">{result.f.liquidityRatio.toFixed(2)}</Row>
              <Row label="Surplus over obligations">{(result.f.surplus * 100).toFixed(2)}%</Row>
              <Row label="Under stress">{(result.f.stressedSurplus * 100).toFixed(2)}%</Row>
              <Row label="Verdict">{result.f.verdict}</Row>
              <p className="text-[0.8125rem] leading-6 text-on-surface-variant pt-2 max-w-[68ch]">
                {result.f.focusModelNote}
                {result.f.focusModelRatio !== null && ` Ratio ${(result.f.focusModelRatio * 100).toFixed(1)}%.`}
              </p>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
