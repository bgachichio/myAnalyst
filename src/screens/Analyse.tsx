// The worked example, computed live by the same kernel the tests pin. Nothing
// on this screen is typed in: every figure comes out of value() and assess().
import { assess, value, type Inputs, type Parameters } from "../lib/kernel";
import { Card, CardHeading } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { lazy, Suspense } from "react";

// Recharts is the heaviest thing in the bundle and only one screen needs it.
// Split so the shell opens without waiting for it.
const ValuationBridge = lazy(() =>
  import("../components/ValuationBridge").then((m) => ({ default: m.ValuationBridge })),
);

const PARAMS: Parameters = { r: 0.1375, g: 0.04, k: 0.35, n: 15, c: 0, w: 0.05, stress: 0.1 };

const UNGA: Inputs = {
  net_profit_from_operations: 508_816_000,
  dividend_per_share_proposed: 1,
  cash_and_bank: 1_102_359_000,
  shares_issued: 75_706_986,
  current_assets: 5_819_762_000,
  current_liabilities: 2_531_888_000,
  cash_and_securities: 1_102_359_000,
  non_current_assets: 3_380_021_000,
  non_current_liabilities: 971_166_000,
  total_income: 19_864_152_000,
  total_expenses: 19_079_843_000,
  income_tax_expense: 225_585_000,
};

const money = (n: number) =>
  n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 min-h-11">
      <span className="text-[0.875rem] text-on-surface-variant">{label}</span>
      <span className="text-[0.9375rem] tabular-nums text-on-surface">{children}</span>
    </div>
  );
}

export function Analyse() {
  const v = value(UNGA, { amount: 28, asOf: "2017-05-25", note: "worked example" }, PARAMS);
  const f = assess(UNGA, "industrial", PARAMS);

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4 pt-4">
        <p className="text-[0.75rem] tracking-[0.03em] uppercase text-on-surface-variant">
          Worked example · UNGA Group · FY2016
        </p>
        <p className="display-sm text-on-surface">
          {v.decision}
        </p>
        <p className="text-[0.9375rem] leading-7 text-on-surface-variant max-w-[68ch]">
          Buying {money(v.myFutureEps)} of future earnings for {money(v.marketPriceFe)},
          a margin of {(v.margin * 100).toFixed(1)}%. Priced at {v.provenance}.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Button>New analysis</Button>
          <Button variant="outlined">Enter a price</Button>
        </div>
      </section>

      <Card>
        <Suspense
          fallback={
            <div className="h-56 rounded-[12px] bg-surface-container-high" aria-hidden="true" />
          }
        >
        <ValuationBridge
          title="What the earnings are worth, against what the market charges"
          unit="KES per share"
          summary={`The market charges ${money(v.marketPriceFe)} for earnings this model values at ${money(
            v.myValuation,
          )} after a 35% margin of safety, so the price clears the test.`}
          rows={[
            { name: "Future EPS", value: v.myFutureEps, key: false },
            { name: "My valuation", value: v.myValuation, key: true },
            { name: "Market's price", value: v.marketPriceFe, key: false },
          ]}
        />
        </Suspense>
      </Card>

      <Card>
        <div className="flex flex-col gap-3">
          <CardHeading>The decision</CardHeading>
          <Row label="Future earnings per share">{money(v.myFutureEps)}</Row>
          <Row label="My valuation of them">{money(v.myValuation)}</Row>
          <Row label="Present value of dividends">{money(v.pvDividendsPs)}</Row>
          <Row label="Cash per share">{money(v.cashPs)}</Row>
          <Row label="Market's price of future earnings">{money(v.marketPriceFe)}</Row>
          <Row label="Trailing P/E">{v.trailingPe.toFixed(2)}</Row>
          <Row label="Net asset value per share">{money(v.navPs)}</Row>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-3">
          <CardHeading>Fragility, at a 10% squeeze</CardHeading>
          <Row label="Liquidity ratio">{f.liquidityRatio.toFixed(2)}</Row>
          <Row label="Surplus over obligations">{(f.surplus * 100).toFixed(2)}%</Row>
          <Row label="Under stress">{(f.stressedSurplus * 100).toFixed(2)}%</Row>
          <Row label="Verdict">{f.verdict}</Row>
          <p className="text-[0.8125rem] leading-6 text-on-surface-variant pt-2 max-w-[68ch]">
            {f.focusModelNote}
            {f.focusModelRatio !== null && ` Ratio ${(f.focusModelRatio * 100).toFixed(1)}%.`}
          </p>
        </div>
      </Card>
    </div>
  );
}
