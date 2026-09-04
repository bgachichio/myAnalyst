/**
 * The eight parts, on screen.
 *
 * Renders what lib/memo.ts computed and decides nothing. Order follows
 * `brian` §4: the verdict first, because a memo whose recommendation is on
 * page four is a memo nobody reads to page four.
 */
import { lazy, Suspense } from "react";
import type { Memo } from "../lib/memo";
import { Card, CardHeading } from "./ui/card";

const ValuationBridge = lazy(() =>
  import("./ValuationBridge").then((m) => ({ default: m.ValuationBridge })));
const PeriodTrend = lazy(() =>
  import("./PeriodTrend").then((m) => ({ default: m.PeriodTrend })));

const money = (n: number) =>
  Number.isFinite(n) ? n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
const big = (n: number | null) =>
  n === null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-GB", { maximumFractionDigits: 0 });
const pct = (n: number | null) => (n === null || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(1)}%`);
const times = (n: number | null) => (n === null || !Number.isFinite(n) ? "—" : `${n.toFixed(2)}×`);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 min-h-11">
      <span className="text-[0.875rem] text-on-surface-variant">{label}</span>
      <span className="text-[0.9375rem] tabular-nums text-on-surface">{children}</span>
    </div>
  );
}

const ChartFallback = () => (
  <div className="h-48 rounded-[12px] bg-surface-container-high" aria-hidden="true" />
);

export function MemoView({ memo, sector }: { memo: Memo; sector: string }) {
  const { base, worst, deal, energy, hurdles, multiples: m } = memo;

  return (
    <div className="flex flex-col gap-10">
      {/* (viii) the recommendation, with its bullets */}
      <Card>
        <div className="flex flex-col gap-4">
          <CardHeading>Recommendation</CardHeading>
          <p className="display-sm text-on-surface">{memo.verdict}</p>
          <ul className="flex flex-col gap-3">
            {memo.rationale.map((line) => (
              <li key={line} className="text-[0.9375rem] leading-7 text-on-surface-variant max-w-[68ch]
                                        border-l-2 border-outline pl-3">
                {line}
              </li>
            ))}
          </ul>
          {base.valuation.warnings.map((w) => (
            <p key={w} className="text-[0.8125rem] leading-6 text-error max-w-[68ch]">{w}</p>
          ))}
        </div>
      </Card>

      {/* (i) base case and worst case, assumptions printed */}
      <div className="grid gap-6 md:grid-cols-2">
        {[base, worst].map((c) => (
          <Card key={c.name}>
            <div className="flex flex-col gap-3">
              <CardHeading>{c.name}</CardHeading>
              <p className="headline-sm text-on-surface">{c.verdict}</p>
              <Row label="Margin">{pct(c.margin)}</Row>
              <Row label="Value of future earnings">{money(c.valuation.myValuation)}</Row>
              <Row label="Market's price of them">{money(c.valuation.marketPriceFe)}</Row>
              <Row label="Under a squeeze">{c.fragility.verdict}</Row>
              <ul className="flex flex-col gap-2 pt-2">
                {c.assumptions.map((a) => (
                  <li key={a} className="text-[0.8125rem] leading-6 text-on-surface-variant max-w-[68ch]">{a}</li>
                ))}
              </ul>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <Suspense fallback={<ChartFallback />}>
          <ValuationBridge
            title="What the earnings are worth, against what the market charges"
            unit="KES per share"
            summary={`The market charges ${money(base.valuation.marketPriceFe)} for earnings this model values at ${money(base.valuation.myValuation)} after the margin of safety.`}
            rows={[
              { name: "Future EPS", value: base.valuation.myFutureEps, key: false },
              { name: "My valuation", value: base.valuation.myValuation, key: true },
              { name: "Market's price", value: base.valuation.marketPriceFe, key: false },
            ]}
          />
        </Suspense>
      </Card>

      {/* (ii) (iii) (iv) the three graphs */}
      <Card>
        <div className="flex flex-col gap-8">
          <CardHeading>Direction of travel</CardHeading>
          <Suspense fallback={<ChartFallback />}>
            <PeriodTrend title="Revenue" unit="KES"
                         points={memo.periods.map((p) => ({ label: p.label, value: p.totalIncome }))} />
            <PeriodTrend title="Profit after tax" unit="KES"
                         points={memo.periods.map((p) => ({ label: p.label, value: p.profit }))} />
            <PeriodTrend title="Net assets" unit="KES"
                         points={memo.periods.map((p) => ({ label: p.label, value: p.netAssets }))} />
          </Suspense>
        </div>
      </Card>

      {/* (v) the private equity view */}
      <Card>
        <div className="flex flex-col gap-3">
          <CardHeading>The deal, priced as a private equity deal</CardHeading>
          <Row label="Market capitalisation">{big(m.marketCap)}</Row>
          <Row label="Enterprise value">{big(m.enterpriseValue)}</Row>
          <Row label="EBITDA">{big(m.ebitda)}</Row>
          <Row label="Entry EV/EBITDA">{times(deal.entryEvEbitda)}</Row>
          <Row label="Price to book">{times(m.priceToBook)}</Row>
          <Row label="Trailing P/E">{times(base.valuation.trailingPe)}</Row>
          <Row label="Exit price per share">{money(deal.exitPricePs ?? NaN)}</Row>
          <Row label="Return to that exit">{pct(deal.irr)}</Row>
          <Row label="Worst case return">{pct(deal.worstIrr)}</Row>
          <Row label="Debt capacity to 2.5× EBITDA">{big(deal.debtCapacity)}</Row>
          <Row label="Interest cover">{times(deal.interestCover)}</Row>
          <p className="text-[0.8125rem] leading-6 text-on-surface-variant pt-2 max-w-[68ch]">
            {m.ebitdaNote} The exit assumes the entry multiple and the same growth the valuation uses:
            a statement of what has to hold, not a forecast.
          </p>
        </div>
      </Card>

      {/* (vi) where the upside would come from */}
      <Card>
        <div className="flex flex-col gap-5">
          <CardHeading>Where the upside would have to come from</CardHeading>
          {memo.levers.map((lever) => (
            <div key={lever.title} className="flex flex-col gap-1">
              <p className="text-[0.875rem] font-medium text-on-surface">{lever.title}</p>
              <p className="text-[0.8125rem] leading-6 text-on-surface-variant max-w-[68ch]">{lever.finding}</p>
              <p className="text-[0.8125rem] leading-6 text-on-surface max-w-[68ch]">{lever.action}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* the hurdles: inflation, and bitcoin stated explicitly */}
      <Card>
        <div className="flex flex-col gap-3">
          <CardHeading>The hurdles</CardHeading>
          <Row label="Gross yield">{pct(hurdles.grossYield)}</Row>
          <Row label={`Net yield, after ${pct(hurdles.withholdingRate)} withheld`}>{pct(hurdles.netYield)}</Row>
          <Row label="Inflation">{pct(hurdles.inflationRate)}</Row>
          <Row label="Real yield">{pct(hurdles.realYield)}</Row>
          <Row label="Entry in dollars">{hurdles.entryInUsd === null ? "—" : money(hurdles.entryInUsd)}</Row>
          <Row label="Entry in bitcoin">
            {hurdles.entryInBtc === null ? "—" : hurdles.entryInBtc.toFixed(8)}
          </Row>
          <Row label="Return against bitcoin">
            {deal.beatsBitcoin === null ? "—" : deal.beatsBitcoin ? "Clears" : "Falls short"}
          </Row>
          <p className="text-[0.8125rem] leading-6 text-on-surface-variant pt-2 max-w-[68ch]">
            Bitcoin is the opportunity cost, compared at {pct(deal.btcAssumedReturn)} a year because
            nobody can forecast it and an unstated assumption is not a hurdle. Inflation is the hurdle
            the income has to clear; the currency lines restate the entry and never overturn the verdict.
          </p>
        </div>
      </Card>

      {/* (vii) the score */}
      <Card>
        <div className="flex flex-col gap-3">
          <CardHeading>Economic energy</CardHeading>
          <p className="headline-sm text-on-surface">{energy.total} of 7 — {energy.band}</p>
          <Row label="Valuation">{energy.valuation}/3</Row>
          <Row label="Yield">{energy.yield}/2</Row>
          <Row label="Growth quality">{energy.growthQuality}/2</Row>
          <ul className="flex flex-col gap-2 pt-2">
            {energy.reasons.map((r) => (
              <li key={r} className="text-[0.8125rem] leading-6 text-on-surface-variant max-w-[68ch]">{r}</li>
            ))}
          </ul>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-3">
          <CardHeading>Fragility, at a {pct(0.1)} squeeze</CardHeading>
          <Row label="Liquidity ratio">{times(base.fragility.liquidityRatio)}</Row>
          <Row label="Excess cash over current liabilities">{pct(base.fragility.excessCash)}</Row>
          <Row label="Surplus over obligations">{pct(base.fragility.surplus)}</Row>
          <Row label="Under stress">{pct(base.fragility.stressedSurplus)}</Row>
          <Row label="Verdict">{base.fragility.verdict}</Row>
          <Row label="Net asset value per share">{money(base.valuation.navPs)}</Row>
          {base.valuation.cigarButt && (
            <p className="text-[0.8125rem] leading-6 text-on-surface-variant max-w-[68ch]">
              Trading below net assets: a cigar butt.
            </p>
          )}
          <p className="text-[0.8125rem] leading-6 text-on-surface-variant pt-2 max-w-[68ch]">
            Read as a {sector}. {base.fragility.focusModelNote}
            {base.fragility.focusModelRatio !== null && ` Ratio ${pct(base.fragility.focusModelRatio)}.`}
          </p>
        </div>
      </Card>
    </div>
  );
}
