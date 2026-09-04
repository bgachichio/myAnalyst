/**
 * A private deal, held against two lenses that are allowed to disagree.
 *
 * An information memorandum arrives with an asking price and a projection. The
 * screen's job is to make the asking price argue with today's earnings and
 * with the exit separately, and to print the gap rather than average it.
 */
import { useMemo, useState } from "react";
import {
  capitalStack, committee, privateEquityView, qualityOfEarnings, ventureView,
  type Anchor, type Projection, type Terms, type Today,
} from "../lib/private";
import { Card, CardHeading } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Field } from "../components/ui/field";

const money = (n: number) =>
  Number.isFinite(n) ? n.toLocaleString("en-GB", { maximumFractionDigits: 0 }) : "—";
const pct = (n: number | null) =>
  n === null || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(1)}%`;
const times = (n: number | null) =>
  n === null || !Number.isFinite(n) ? "—" : `${n.toFixed(2)}×`;

/**
 * A worked example chosen so the two lenses disagree, because that is the case
 * the screen exists for. The deck grows revenue at a defensible rate and the
 * margin at an aggressive one: the exit carries the price and today's earnings
 * do not.
 */
const EXAMPLE = {
  name: "A distribution business",
  today: {
    revenue: 300_000_000, ebitda: 45_000_000, netDebt: 20_000_000,
    cashFromOperations: 36_000_000, receivables: 50_000_000,
    largestCustomerShare: 0.18, relatedPartyShare: 0.04,
  } satisfies Today,
  terms: { investment: 100_000_000, preMoney: 280_000_000, dilutionRetention: 0.7 } satisfies Terms,
  projection: {
    years: 5, exitRevenue: 900_000_000, exitEbitda: 300_000_000,
    exitMultiple: 8, netDebtAtExit: 100_000_000,
  } satisfies Projection,
  anchor: { name: "the closest NSE peer", evEbitda: 7.5, illiquidityDiscount: 0.3 } satisfies Anchor,
  hurdle: 0.30,
  debtShare: 0,
  rate: 0.16,
  amortYears: 5,
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 min-h-11">
      <span className="text-[0.875rem] text-on-surface-variant">{label}</span>
      <span className="text-[0.9375rem] tabular-nums text-on-surface">{children}</span>
    </div>
  );
}

export function Private() {
  const [name, setName] = useState(EXAMPLE.name);
  const [today, setToday] = useState<Today>(EXAMPLE.today);
  const [terms, setTerms] = useState<Terms>(EXAMPLE.terms);
  const [projection, setProjection] = useState<Projection>(EXAMPLE.projection);
  const [anchor, setAnchor] = useState<Anchor>(EXAMPLE.anchor);
  const [hurdle, setHurdle] = useState(EXAMPLE.hurdle);
  const [debtShare, setDebtShare] = useState(EXAMPLE.debtShare);
  const [rate, setRate] = useState(EXAMPLE.rate);
  const [amortYears, setAmortYears] = useState(EXAMPLE.amortYears);

  const result = useMemo(() => {
    if (!(terms.investment > 0) || !(today.ebitda !== 0) || !(projection.years > 0)) return null;
    const vc = ventureView(projection, terms, hurdle);
    const pe = privateEquityView(today, anchor, terms);
    const qoe = qualityOfEarnings(today, projection);
    const stack = capitalStack({
      investment: terms.investment, debtShare, rate, amortYears, ebitda: today.ebitda,
    });
    return { vc, pe, qoe, stack, ic: committee(vc, pe, qoe, stack) };
  }, [today, terms, projection, anchor, hurdle, debtShare, rate, amortYears]);

  const num = (raw: string) => {
    const n = Number(raw.replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  const nullableNum = (raw: string) => (raw.trim() === "" ? null : num(raw));
  const str = (n: number | null) => (n === null ? "" : String(n));

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4 pt-4">
        <p className="text-[0.75rem] tracking-[0.03em] uppercase text-on-surface-variant">
          {name || "Untitled deal"}
        </p>
        <p className="display-sm text-on-surface">
          {result ? result.ic.recommendation : "Enter the deal"}
        </p>
        {result && (
          <p className="text-[0.9375rem] leading-7 text-on-surface-variant max-w-[68ch]">
            {result.ic.finding}
          </p>
        )}
        <div className="flex flex-wrap gap-3 pt-2">
          <Button variant="outlined" onClick={() => {
            setName(EXAMPLE.name); setToday(EXAMPLE.today); setTerms(EXAMPLE.terms);
            setProjection(EXAMPLE.projection); setAnchor(EXAMPLE.anchor);
            setHurdle(EXAMPLE.hurdle); setDebtShare(EXAMPLE.debtShare);
            setRate(EXAMPLE.rate); setAmortYears(EXAMPLE.amortYears);
          }}>
            Reset to the worked example
          </Button>
        </div>
      </section>

      <Card>
        <div className="flex flex-col gap-5">
          <CardHeading>The company today</CardHeading>
          <Field label="What it is called" value={name} onValue={setName} placeholder="Name the deal" />
          <Field label="Revenue" value={String(today.revenue)} inputMode="decimal" suffix="KES"
                 onValue={(v) => setToday({ ...today, revenue: num(v) })} />
          <Field label="EBITDA" value={String(today.ebitda)} inputMode="decimal" suffix="KES"
                 onValue={(v) => setToday({ ...today, ebitda: num(v) })} />
          <Field label="Net debt" value={String(today.netDebt)} inputMode="decimal" suffix="KES"
                 onValue={(v) => setToday({ ...today, netDebt: num(v) })} />
          <Field label="Cash from operations" value={str(today.cashFromOperations)} inputMode="decimal" suffix="KES"
                 hint="Leave blank if the deck does not give it. Blank is a finding, not a pass."
                 onValue={(v) => setToday({ ...today, cashFromOperations: nullableNum(v) })} />
          <Field label="Receivables" value={str(today.receivables)} inputMode="decimal" suffix="KES"
                 onValue={(v) => setToday({ ...today, receivables: nullableNum(v) })} />
          <Field label="Largest customer" value={str(today.largestCustomerShare === null ? null : today.largestCustomerShare * 100)}
                 inputMode="decimal" suffix="% of revenue"
                 onValue={(v) => setToday({ ...today, largestCustomerShare: v.trim() === "" ? null : num(v) / 100 })} />
          <Field label="Related parties" value={str(today.relatedPartyShare === null ? null : today.relatedPartyShare * 100)}
                 inputMode="decimal" suffix="% of revenue"
                 onValue={(v) => setToday({ ...today, relatedPartyShare: v.trim() === "" ? null : num(v) / 100 })} />
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-5">
          <CardHeading>What is being asked</CardHeading>
          <Field label="The cheque" value={String(terms.investment)} inputMode="decimal" suffix="KES"
                 onValue={(v) => setTerms({ ...terms, investment: num(v) })} />
          <Field label="Pre-money valuation" value={String(terms.preMoney)} inputMode="decimal" suffix="KES"
                 onValue={(v) => setTerms({ ...terms, preMoney: num(v) })} />
          <Field label="Share still held at exit" value={String(terms.dilutionRetention * 100)}
                 inputMode="decimal" suffix="%"
                 hint="After later rounds. A hundred per cent means no further raise, which almost never happens."
                 onValue={(v) => setTerms({ ...terms, dilutionRetention: num(v) / 100 })} />
          <Field label="Required return" value={String(hurdle * 100)} inputMode="decimal" suffix="% a year"
                 onValue={(v) => setHurdle(num(v) / 100)} />
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-5">
          <CardHeading>What the deck projects</CardHeading>
          <Field label="Years to exit" value={String(projection.years)} inputMode="numeric" suffix="years"
                 onValue={(v) => setProjection({ ...projection, years: Math.max(1, num(v)) })} />
          <Field label="Revenue at exit" value={String(projection.exitRevenue)} inputMode="decimal" suffix="KES"
                 onValue={(v) => setProjection({ ...projection, exitRevenue: num(v) })} />
          <Field label="EBITDA at exit" value={String(projection.exitEbitda)} inputMode="decimal" suffix="KES"
                 onValue={(v) => setProjection({ ...projection, exitEbitda: num(v) })} />
          <Field label="EV/EBITDA paid at exit" value={String(projection.exitMultiple)} inputMode="decimal" suffix="×"
                 onValue={(v) => setProjection({ ...projection, exitMultiple: num(v) })} />
          <Field label="Net debt at exit" value={String(projection.netDebtAtExit)} inputMode="decimal" suffix="KES"
                 onValue={(v) => setProjection({ ...projection, netDebtAtExit: num(v) })} />
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-5">
          <CardHeading>The listed anchor</CardHeading>
          <p className="text-[0.8125rem] leading-6 text-on-surface-variant max-w-[68ch]">
            A listed company standing in for this one. Analyse it first if you have its report:
            the multiple should come from a memo, not from memory.
          </p>
          <Field label="Which company" value={anchor.name} onValue={(v) => setAnchor({ ...anchor, name: v })} />
          <Field label="Its EV/EBITDA" value={String(anchor.evEbitda)} inputMode="decimal" suffix="×"
                 onValue={(v) => setAnchor({ ...anchor, evEbitda: num(v) })} />
          <Field label="Illiquidity discount" value={String(anchor.illiquidityDiscount * 100)}
                 inputMode="decimal" suffix="%"
                 hint="What comes off for the fact that this cannot be sold on a Tuesday."
                 onValue={(v) => setAnchor({ ...anchor, illiquidityDiscount: num(v) / 100 })} />
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-5">
          <CardHeading>How the cheque is funded</CardHeading>
          <Field label="Borrowed" value={String(debtShare * 100)} inputMode="decimal" suffix="% of the cheque"
                 onValue={(v) => setDebtShare(num(v) / 100)} />
          <Field label="Interest rate" value={String(rate * 100)} inputMode="decimal" suffix="%"
                 onValue={(v) => setRate(num(v) / 100)} />
          <Field label="Repaid over" value={String(amortYears)} inputMode="numeric" suffix="years"
                 onValue={(v) => setAmortYears(Math.max(1, num(v)))} />
        </div>
      </Card>

      {result && (
        <>
          <Card>
            <div className="flex flex-col gap-4">
              <CardHeading>The committee</CardHeading>
              {/* The finding leads the screen; repeating it here would be filler. */}
              <p className="text-[0.875rem] leading-6 text-on-surface-variant border-l-2 border-outline pl-3 max-w-[68ch]">
                Venture lens: {result.ic.ventureSays}
              </p>
              <p className="text-[0.875rem] leading-6 text-on-surface-variant border-l-2 border-outline pl-3 max-w-[68ch]">
                Private equity lens: {result.ic.privateEquitySays}
              </p>
            </div>
          </Card>

          <Card>
            <div className="flex flex-col gap-3">
              <CardHeading>Are the earnings real</CardHeading>
              <p className="headline-sm text-on-surface">{result.qoe.score} of {result.qoe.outOf}</p>
              <p className="text-[0.875rem] leading-6 text-on-surface max-w-[68ch]">{result.qoe.verdict}</p>
              <ul className="flex flex-col gap-3 pt-2">
                {result.qoe.flags.map((flag) => (
                  <li key={flag.test} className="flex flex-col gap-1">
                    <span className={"text-[0.875rem] font-medium " + (flag.failed ? "text-error" : "text-on-surface")}>
                      {flag.test}
                    </span>
                    <span className="text-[0.8125rem] leading-6 text-on-surface-variant max-w-[68ch]">
                      {flag.finding}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          <Card>
            <div className="flex flex-col gap-3">
              <CardHeading>The venture lens: buying the exit</CardHeading>
              <Row label="Equity at exit">{money(result.vc.exitEquity)}</Row>
              <Row label="Share bought now">{pct(result.vc.offeredOwnershipNow)}</Row>
              <Row label="Share left at exit">{pct(result.vc.ownershipAtExit)}</Row>
              <Row label="Proceeds">{money(result.vc.proceeds)}</Row>
              <Row label="Return">{pct(result.vc.impliedIrr)}</Row>
              <Row label="Against a hurdle of">{pct(result.vc.targetIrr)}</Row>
              <Row label="Pre-money this supports">{money(result.vc.supportedValuationToday)}</Row>
              <Row label="Asking price against it">{pct(result.vc.askVersusSupported)}</Row>
              <p className="text-[0.8125rem] leading-6 text-on-surface-variant pt-2 max-w-[68ch]">
                The supported price is what may be paid today for the hurdle to be met exactly, after
                the dilution above. Everything here rests on the deck's own projection.
              </p>
            </div>
          </Card>

          <Card>
            <div className="flex flex-col gap-3">
              <CardHeading>The private equity lens: buying today's earnings</CardHeading>
              <Row label="Anchor">{result.pe.anchor}</Row>
              <Row label="Its multiple">{times(result.pe.quotedMultiple)}</Row>
              <Row label="Illiquidity discount">{pct(result.pe.illiquidityDiscount)}</Row>
              <Row label="Multiple actually paid">{times(result.pe.appliedMultiple)}</Row>
              <Row label="Enterprise value">{money(result.pe.enterpriseValue)}</Row>
              <Row label="Equity value">{money(result.pe.equityValue)}</Row>
              <Row label="Asking price against it">{pct(result.pe.askVersusValue)}</Row>
            </div>
          </Card>

          <Card>
            <div className="flex flex-col gap-3">
              <CardHeading>The capital stack</CardHeading>
              <Row label="Equity in">{money(result.stack.equityIn)}</Row>
              <Row label="Borrowed">{money(result.stack.debtIn)}</Row>
              <Row label="Interest a year">{money(result.stack.interest)}</Row>
              <Row label="Interest cover">{times(result.stack.interestCover)}</Row>
              <Row label="Full service a year">{money(result.stack.annualService)}</Row>
              <Row label="Service cover">{times(result.stack.serviceCover)}</Row>
              <p className="text-[0.8125rem] leading-6 text-on-surface pt-2 max-w-[68ch]">
                {result.stack.finding}
              </p>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
