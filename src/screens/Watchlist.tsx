/**
 * The counters being held or waited on, and the day each one has to be bought by.
 *
 * The failure this exists to stop is silent: buying on the closure date,
 * settling three trading days later, and learning about it from the absence of
 * a payment.
 */
import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Trash2 } from "lucide-react";
import {
  SETTLEMENT_DAYS, deadlines, gazettedHolidays, type Holding,
} from "../lib/calendar";
import { newId, read, write } from "../lib/store";
import { Card, CardHeading } from "../components/ui/card";
import { Button, IconButton } from "../components/ui/button";
import { Field } from "../components/ui/field";

const WITHHOLDING = 0.05;   // resident, holdings under 12.5%

const money = (n: number) =>
  n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TONE = {
  passed: "bg-surface-container-highest text-on-surface-variant",
  today: "bg-error-container text-on-error-container",
  urgent: "bg-error-container text-on-error-container",
  ahead: "bg-secondary-container text-on-secondary-container",
} as const;

function countdown(daysLeft: number, tradingDaysLeft: number): string {
  if (daysLeft < 0) return "Passed";
  if (daysLeft === 0) return "Today";
  return `${tradingDaysLeft} trading ${tradingDaysLeft === 1 ? "day" : "days"} left`;
}

/** The date the browser thinks it is, as a plain UTC date. */
const todayIso = (): string => new Date().toISOString().slice(0, 10);

export function Watchlist() {
  const [holdings, setHoldings] = useState<Holding[]>(() => read<Holding[]>("watchlist", []));
  const [extra, setExtra] = useState<string[]>(() => read<string[]>("extra-holidays", []));
  const [saved, setSaved] = useState(true);
  const [draft, setDraft] = useState({ name: "", ticker: "", booksClosure: "", dividendPerShare: "", shares: "", note: "" });
  const [holidayDraft, setHolidayDraft] = useState("");
  const today = todayIso();

  useEffect(() => { setSaved(write("watchlist", holdings)); }, [holdings]);
  useEffect(() => { write("extra-holidays", extra); }, [extra]);

  const rows = useMemo(
    () => deadlines(holdings, today, WITHHOLDING, extra),
    [holdings, today, extra],
  );

  const canAdd = draft.name.trim() !== "" && /^\d{4}-\d{2}-\d{2}$/.test(draft.booksClosure);

  const add = () => {
    setHoldings((prev) => [...prev, {
      id: newId(),
      name: draft.name.trim(),
      ticker: draft.ticker.trim().toUpperCase() || draft.name.trim().slice(0, 6).toUpperCase(),
      booksClosure: draft.booksClosure,
      dividendPerShare: Number(draft.dividendPerShare) || 0,
      shares: Number(draft.shares.replace(/,/g, "")) || 0,
      note: draft.note.trim(),
    }]);
    setDraft({ name: "", ticker: "", booksClosure: "", dividendPerShare: "", shares: "", note: "" });
  };

  const next = rows.find((r) => r.state !== "passed");
  const thisYear = new Date().getUTCFullYear();

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4 pt-4">
        <p className="text-[0.75rem] tracking-[0.03em] uppercase text-on-surface-variant">Watchlist</p>
        <p className="display-sm text-on-surface">
          {next ? countdown(next.daysLeft, next.tradingDaysLeft) : "Nothing waiting"}
        </p>
        <p className="text-[0.9375rem] leading-7 text-on-surface-variant max-w-[68ch]">
          {next
            ? `${next.holding.name}: buy by ${next.lastCumDividend} to be on the register when it closes on ${next.holding.booksClosure}.`
            : `Add a counter and its books-closure date. The NSE settles ${SETTLEMENT_DAYS} trading days after a trade, so the day that matters is not the closure date.`}
        </p>
        {!saved && (
          <p role="alert" className="text-[0.8125rem] leading-6 text-error max-w-[68ch]">
            The browser refused to save this list. It will be gone when the tab closes.
          </p>
        )}
      </section>

      {rows.map((row) => (
        <Card key={row.holding.id}>
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-[0.75rem] tracking-[0.03em] uppercase text-on-surface-variant">
                  {row.holding.ticker}
                </span>
                <h2 className="headline-sm text-on-surface">{row.holding.name}</h2>
              </div>
              <span className={`rounded-full px-3 py-1 text-[0.6875rem] tracking-[0.03em] uppercase ${TONE[row.state]}`}>
                {countdown(row.daysLeft, row.tradingDaysLeft)}
              </span>
            </div>

            <div className="flex items-baseline justify-between gap-4 min-h-11">
              <span className="text-[0.875rem] text-on-surface-variant">Buy by</span>
              <span className="text-[0.9375rem] tabular-nums text-on-surface">{row.lastCumDividend}</span>
            </div>
            <div className="flex items-baseline justify-between gap-4 min-h-11">
              <span className="text-[0.875rem] text-on-surface-variant">Register closes</span>
              <span className="text-[0.9375rem] tabular-nums text-on-surface">{row.holding.booksClosure}</span>
            </div>
            <div className="flex items-baseline justify-between gap-4 min-h-11">
              <span className="text-[0.875rem] text-on-surface-variant">Dividend per share</span>
              <span className="text-[0.9375rem] tabular-nums text-on-surface">{money(row.holding.dividendPerShare)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-4 min-h-11">
              <span className="text-[0.875rem] text-on-surface-variant">
                Net of {(WITHHOLDING * 100).toFixed(0)}% withheld
              </span>
              <span className="text-[0.9375rem] tabular-nums text-on-surface">{money(row.netDividend)}</span>
            </div>

            <p className="text-[0.8125rem] leading-6 text-on-surface-variant max-w-[68ch]">
              {row.explanation}
            </p>
            {row.holding.note && (
              <p className="text-[0.8125rem] leading-6 text-on-surface max-w-[68ch]">{row.holding.note}</p>
            )}

            <div className="flex justify-end">
              <IconButton
                aria-label={`Remove ${row.holding.name}`}
                onClick={() => setHoldings((prev) => prev.filter((h) => h.id !== row.holding.id))}
              >
                <Trash2 size={20} strokeWidth={1.75} />
              </IconButton>
            </div>
          </div>
        </Card>
      ))}

      <Card>
        <div className="flex flex-col gap-5">
          <CardHeading>Add a counter</CardHeading>
          <Field label="Company" value={draft.name} onValue={(v) => setDraft({ ...draft, name: v })}
                 placeholder="As the announcement names it" />
          <Field label="Ticker" value={draft.ticker} onValue={(v) => setDraft({ ...draft, ticker: v })} />
          <Field label="Books closure date" value={draft.booksClosure} type="date"
                 onValue={(v) => setDraft({ ...draft, booksClosure: v })}
                 hint="Off the announcement. Everything else is derived from it." />
          <Field label="Dividend per share" value={draft.dividendPerShare} inputMode="decimal" suffix="KES"
                 onValue={(v) => setDraft({ ...draft, dividendPerShare: v })} />
          <Field label="Shares held or intended" value={draft.shares} inputMode="decimal"
                 onValue={(v) => setDraft({ ...draft, shares: v })} />
          <Field label="Note" value={draft.note} onValue={(v) => setDraft({ ...draft, note: v })}
                 placeholder="Why this one is on the list" />
          <div>
            <Button onClick={add} disabled={!canAdd}>
              <CalendarClock size={18} strokeWidth={1.75} />
              Add to the watchlist
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-5">
          <CardHeading>Holidays the app cannot work out</CardHeading>
          <p className="text-[0.8125rem] leading-6 text-on-surface-variant max-w-[68ch]">
            Idd-ul-Fitr and Idd-ul-Azha follow the lunar calendar and are declared on sight of the
            moon, so no algorithm places them. Add them here, along with any day gazetted at short
            notice, and every deadline above moves with them. The {thisYear} days it does know:{" "}
            {gazettedHolidays(thisYear).map((h) => h.name).join(", ")}.
          </p>
          <div className="flex flex-wrap gap-2">
            {extra.map((date) => (
              <button
                key={date}
                type="button"
                onClick={() => setExtra((prev) => prev.filter((d) => d !== date))}
                className="state-layer rounded-full min-h-11 px-4 bg-surface-container-highest
                           text-[0.8125rem] text-on-surface
                           focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {date} — remove
              </button>
            ))}
          </div>
          <Field label="Another non-trading day" value={holidayDraft} type="date" onValue={setHolidayDraft} />
          <div>
            <Button
              variant="outlined"
              disabled={!/^\d{4}-\d{2}-\d{2}$/.test(holidayDraft) || extra.includes(holidayDraft)}
              onClick={() => { setExtra((prev) => [...prev, holidayDraft].sort()); setHolidayDraft(""); }}
            >
              Add the day
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
