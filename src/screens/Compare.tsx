/**
 * Saved memos, side by side, on one discount rate.
 *
 * Comparing a Johannesburg multiple with a Nairobi one as quoted is the most
 * comfortable way to conclude that Nairobi is cheap. Both are shown here: as
 * quoted, and restated onto one rate with the arithmetic printed.
 */
import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { compare, summarise, type SavedMemo } from "../lib/compare";
import { read, write } from "../lib/store";
import { Card, CardHeading } from "../components/ui/card";
import { IconButton } from "../components/ui/button";
import { Field } from "../components/ui/field";

const pct = (n: number | null) => (n === null || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(1)}%`);
const times = (n: number | null) => (n === null || !Number.isFinite(n) ? "—" : `${n.toFixed(2)}×`);

export function Compare() {
  const [memos, setMemos] = useState<SavedMemo[]>(() => read<SavedMemo[]>("memos", []));
  const [commonRate, setCommonRate] = useState(13.75);
  const [growth, setGrowth] = useState(4);

  useEffect(() => { write("memos", memos); }, [memos]);

  const rows = useMemo(
    () => compare(memos, commonRate / 100, growth / 100),
    [memos, commonRate, growth],
  );

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4 pt-4">
        <p className="text-[0.75rem] tracking-[0.03em] uppercase text-on-surface-variant">Compare</p>
        <p className="display-sm text-on-surface">
          {memos.length === 0 ? "Nothing saved yet" : `${memos.length} saved`}
        </p>
        <p className="text-[0.9375rem] leading-7 text-on-surface-variant max-w-[68ch]">
          {memos.length === 0
            ? "Analyse a company and save the memo. Two or more, and they can be held against each other on one discount rate."
            : summarise(rows, commonRate / 100)}
        </p>
      </section>

      <Card>
        <div className="flex flex-col gap-5">
          <CardHeading>The common rate</CardHeading>
          <Field label="Discount rate everything is restated to" value={String(commonRate)}
                 inputMode="decimal" suffix="%" onValue={(v) => setCommonRate(Number(v) || 0)}
                 hint="Brian's shilling rate, so a foreign multiple is restated into what it would be worth here." />
          <Field label="Long-run growth" value={String(growth)} inputMode="decimal" suffix="%"
                 onValue={(v) => setGrowth(Number(v) || 0)} />
        </div>
      </Card>

      {rows.map(({ memo, evEbitda, isBenchmark }) => (
        <Card key={memo.id}>
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-[0.75rem] tracking-[0.03em] uppercase text-on-surface-variant">
                  {memo.currency} · {memo.origin} · {memo.sector}
                </span>
                <h2 className="headline-sm text-on-surface">{memo.name}</h2>
              </div>
              <span className="rounded-full px-3 py-1 text-[0.6875rem] tracking-[0.03em] uppercase
                               bg-secondary-container text-on-secondary-container">
                {memo.verdict}
              </span>
            </div>

            <Row label="EV/EBITDA as quoted">{times(evEbitda.raw)}</Row>
            <Row label={`EV/EBITDA at ${commonRate}%`}>
              {evEbitda.adjusted === null ? "—" : times(evEbitda.adjusted)}
              {isBenchmark && " (own rate)"}
            </Row>
            <Row label="Analysed on a rate of">{pct(memo.discountRate)}</Row>
            <Row label="Price to book">{times(memo.priceToBook)}</Row>
            <Row label="Trailing P/E">{times(memo.trailingPe)}</Row>
            <Row label="Net yield">{pct(memo.netYield)}</Row>
            <Row label="Real yield">{pct(memo.realYield)}</Row>
            <Row label="Return to the assumed exit">{pct(memo.irr)}</Row>
            <Row label="Economic energy">{memo.energyTotal}/7 — {memo.energyBand}</Row>

            <p className="text-[0.8125rem] leading-6 text-on-surface-variant max-w-[68ch]">
              {evEbitda.note}
            </p>
            <div className="flex items-center justify-between gap-4">
              <span className="text-[0.6875rem] text-on-surface-variant">
                Saved {memo.savedAt.slice(0, 10)}
              </span>
              <IconButton aria-label={`Remove ${memo.name}`}
                          onClick={() => setMemos((prev) => prev.filter((m) => m.id !== memo.id))}>
                <Trash2 size={20} strokeWidth={1.75} />
              </IconButton>
            </div>
          </div>
        </Card>
      ))}

      <Card>
        <div className="flex flex-col gap-3">
          <CardHeading>What this does not do</CardHeading>
          <p className="text-[0.8125rem] leading-6 text-on-surface-variant max-w-[68ch]">
            It compares companies you have analysed. It does not go looking for peers on the JSE or
            anywhere else: that needs a data source this app does not have, and inventing one would
            put numbers in this table that nobody checked. Analyse a foreign company from its own
            report, tell the memo which rate priced it, and it belongs here like any other.
          </p>
        </div>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 min-h-11">
      <span className="text-[0.875rem] text-on-surface-variant">{label}</span>
      <span className="text-[0.9375rem] tabular-nums text-on-surface">{children}</span>
    </div>
  );
}
