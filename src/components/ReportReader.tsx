/**
 * Reading a report, and showing its working.
 *
 * The reader never fills a figure in silently. Every number it offers carries
 * the line it was read off and the page it was on, and anything it is less
 * than sure about is marked for checking before the verdict is believed. The
 * whole path runs in the browser: the report is never uploaded anywhere.
 */
import { useRef, useState } from "react";
import { AlertTriangle, Check, FileText, X } from "lucide-react";
import {
  CONFIDENT, FIGURE_KEYS, extract, labelFor,
  type Candidate, type Extraction, type FigureKey, type Profile,
} from "../lib/extract";
import type { Inputs } from "../lib/kernel";
import { Button } from "./ui/button";
import { Card, CardHeading } from "./ui/card";

type Phase =
  | { at: "idle" }
  | { at: "reading"; what: string }
  | { at: "failed"; why: string }
  | { at: "review"; from: string; got: Extraction; chosen: Record<string, number> };

/** What the reader hands over: the latest period, its comparative, and what to call them. */
export interface ReadFigures {
  current: Partial<Inputs>;
  prior: Partial<Inputs>;
  labels: { current: string; prior: string };
}

interface Props {
  onApply: (figures: ReadFigures, source: string) => void;
  /** A bank's statement has no current assets and calls its income something else. */
  profile: Profile;
}

/** The report's own year headings where it gave them, and honest placeholders where it did not. */
function periodLabels(got: Extraction): { current: string; prior: string } {
  const [first, second] = got.periodYears;
  if (first === undefined || second === undefined) return { current: "Latest", prior: "Prior" };
  return got.currentIsFirstColumn
    ? { current: String(first), prior: String(second) }
    : { current: String(second), prior: String(first) };
}

const money = (n: number) =>
  n.toLocaleString("en-GB", { maximumFractionDigits: Math.abs(n) < 1000 ? 2 : 0 });

export function ReportReader({ onApply, profile }: Props) {
  const [phase, setPhase] = useState<Phase>({ at: "idle" });
  const input = useRef<HTMLInputElement>(null);

  async function read(file: File) {
    setPhase({ at: "reading", what: file.name });
    try {
      const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
      const lines = isPdf
        ? await (await import("../lib/pdf")).readPdf(file, (p) =>
            setPhase({ at: "reading", what: `${file.name}, page ${p.page} of ${p.pages}` }))
        : await (await import("../lib/xlsx")).readXlsx(file);

      const got = extract(lines, profile);
      const chosen: Record<string, number> = {};
      for (const c of Object.values(got.candidates) as Candidate[]) chosen[c.key] = c.value;

      if (Object.keys(chosen).length === 0) {
        setPhase({
          at: "failed",
          why: `Nothing in ${file.name} matched a line the reader knows. If it is a scan rather than ` +
               "a text PDF there is no text to read, and the figures have to be typed.",
        });
        return;
      }
      setPhase({ at: "review", from: file.name, got, chosen });
    } catch (error) {
      setPhase({ at: "failed", why: error instanceof Error ? error.message : String(error) });
    }
  }

  if (phase.at === "review") return (
    <Review
      phase={phase}
      onChange={(key, value) =>
        setPhase({ ...phase, chosen: { ...phase.chosen, [key]: value } })}
      onCancel={() => setPhase({ at: "idle" })}
      onApply={() => {
        const prior: Partial<Inputs> = {};
        for (const c of Object.values(phase.got.candidates) as Candidate[]) {
          if (c.priorValue !== null) (prior as Record<string, number>)[c.key] = c.priorValue;
        }
        onApply(
          { current: phase.chosen as Partial<Inputs>, prior, labels: periodLabels(phase.got) },
          phase.from,
        );
        setPhase({ at: "idle" });
      }}
    />
  );

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <CardHeading>Read a report</CardHeading>
        <p className="text-[0.875rem] leading-6 text-on-surface-variant max-w-[68ch]">
          A published annual report, half-year statement, or a spreadsheet. It is read here, in the
          browser: nothing is uploaded, and every figure it offers shows the line it came from.
          Set the sector first — a bank's statement has no current assets and calls its income
          something else, and reading one as a miller finds three figures out of twelve.
        </p>

        <input
          ref={input}
          type="file"
          accept=".pdf,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";           // so the same file can be chosen twice
            if (file) void read(file);
          }}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="tonal"
            disabled={phase.at === "reading"}
            onClick={() => input.current?.click()}
          >
            <FileText size={18} strokeWidth={1.75} />
            {phase.at === "reading" ? "Reading…" : "Choose a PDF or spreadsheet"}
          </Button>
          {phase.at === "reading" && (
            <span className="text-[0.8125rem] text-on-surface-variant" role="status">{phase.what}</span>
          )}
        </div>

        {phase.at === "failed" && (
          <p role="alert" className="text-[0.8125rem] leading-6 text-error border-l-2 border-error pl-3 max-w-[68ch]">
            {phase.why}
          </p>
        )}
      </div>
    </Card>
  );
}

function Review({
  phase, onChange, onCancel, onApply,
}: {
  phase: Extract<Phase, { at: "review" }>;
  onChange: (key: FigureKey, value: number) => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const { got, chosen, from } = phase;
  const toCheck = FIGURE_KEYS.filter(
    (k) => got.candidates[k] && got.candidates[k]!.confidence < CONFIDENT,
  );
  const missing = got.missing;

  return (
    <Card>
      <div className="flex flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <CardHeading>Read from {from}</CardHeading>
            <p className="text-[0.8125rem] text-on-surface-variant">
              {FIGURE_KEYS.length - missing.length} of {FIGURE_KEYS.length} figures found
              {toCheck.length > 0 && `, ${toCheck.length} to check`}.
            </p>
          </div>
          <Button variant="text" onClick={onCancel} aria-label="Discard this reading">
            <X size={18} strokeWidth={1.75} />
          </Button>
        </div>

        <p className="text-[0.8125rem] leading-6 text-on-surface-variant border-l-2 border-outline pl-3 max-w-[68ch]">
          {got.scaleNote}
        </p>
        {got.notes.map((note) => (
          <p key={note} className="flex gap-2 text-[0.8125rem] leading-6 text-on-surface max-w-[68ch]">
            <AlertTriangle size={16} strokeWidth={1.75} className="shrink-0 mt-1 text-error" aria-hidden="true" />
            {note}
          </p>
        ))}

        <ul className="flex flex-col gap-5">
          {FIGURE_KEYS.map((key) => {
            const c = got.candidates[key];
            return (
              <li key={key} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-4">
                  <label htmlFor={`fig-${key}`} className="text-[0.875rem] text-on-surface">
                    {labelFor(key)}
                  </label>
                  {c ? <Confidence value={c.confidence} /> : (
                    <span className="text-[0.6875rem] tracking-[0.03em] uppercase text-on-surface-variant">
                      Not found
                    </span>
                  )}
                </div>
                <input
                  id={`fig-${key}`}
                  inputMode="decimal"
                  value={chosen[key] ?? ""}
                  placeholder={c ? "" : "Type it in"}
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(/,/g, ""));
                    onChange(key, Number.isFinite(n) ? n : 0);
                  }}
                  className="w-full rounded-[12px] h-12 px-4 bg-surface-container-highest text-on-surface
                             border-0 border-b-2 border-outline focus:border-primary
                             focus-visible:outline-none tabular-nums"
                />
                {c && (
                  <p className="text-[0.6875rem] leading-5 text-on-surface-variant">
                    “{c.label}” on {c.page}
                    {c.scale > 1 && `, read in ${money(c.rawValue)} × ${money(c.scale)}`}
                  </p>
                )}
                {c?.alternatives.map((alt) => (
                  <button
                    key={`${alt.page}-${alt.value}`}
                    type="button"
                    onClick={() => onChange(key, alt.value)}
                    className="state-layer self-start rounded-[12px] min-h-11 px-3 text-left
                               text-[0.75rem] leading-5 text-primary
                               focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    Use {money(alt.value)} from “{alt.label}” instead
                  </button>
                ))}
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap gap-3">
          <Button onClick={onApply}>
            <Check size={18} strokeWidth={1.75} />
            Use these figures
          </Button>
          <Button variant="outlined" onClick={onCancel}>Discard</Button>
        </div>
      </div>
    </Card>
  );
}

function Confidence({ value }: { value: number }) {
  const sure = value >= CONFIDENT;
  return (
    <span
      className={
        "rounded-full px-3 py-1 text-[0.6875rem] tracking-[0.03em] uppercase " +
        (sure ? "bg-secondary-container text-on-secondary-container" : "bg-error-container text-on-error-container")
      }
    >
      {sure ? "Read" : "Check this"}
    </span>
  );
}
