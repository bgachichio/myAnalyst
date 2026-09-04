/**
 * The four factors the 2017 notes settled on: Price, Tailwind, Moat, Leadership.
 *
 * Price is arithmetic and is scored here. The other three are judgements, and
 * the tool's job is to make Brian write them down before the verdict rather
 * than after it - a judgement recorded after the fact is a rationalisation.
 */
import { Segmented } from "./ui/segmented";
import { Card, CardHeading } from "./ui/card";

export type Judgement = "Weak" | "Even" | "Strong";
export const JUDGEMENTS: readonly Judgement[] = ["Weak", "Even", "Strong"];

export interface Factors {
  tailwind: Judgement;
  tailwindNote: string;
  moat: Judgement;
  moatNote: string;
  leadership: Judgement;
  leadershipNote: string;
}

export const BLANK_FACTORS: Factors = {
  tailwind: "Even", tailwindNote: "",
  moat: "Even", moatNote: "",
  leadership: "Even", leadershipNote: "",
};

const SCORE: Record<Judgement, number> = { Weak: 0, Even: 1, Strong: 2 };

/** Zero to eight. Price scores on the margin; the other three on the judgement. */
export function scoreFactors(factors: Factors, margin: number): { total: number; price: number } {
  const price = margin >= 0.4 ? 2 : margin >= 0.15 ? 1 : 0;
  return {
    price,
    total: price + SCORE[factors.tailwind] + SCORE[factors.moat] + SCORE[factors.leadership],
  };
}

interface Props {
  factors: Factors;
  margin: number;
  onChange: (factors: Factors) => void;
}

export function DecisionFactors({ factors, margin, onChange }: Props) {
  const { price, total } = scoreFactors(factors, margin);
  const written = [factors.tailwindNote, factors.moatNote, factors.leadershipNote].filter((n) => n.trim()).length;

  return (
    <Card>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <CardHeading>The four factors</CardHeading>
          <p className="text-[0.8125rem] leading-6 text-on-surface-variant max-w-[68ch]">
            {total} of 8. Price is arithmetic and scores itself. The other three are yours, and the
            verdict is worth less until they are written down: {written} of 3 have a reason attached.
          </p>
        </div>

        <div className="flex items-baseline justify-between gap-4 min-h-11">
          <span className="text-[0.875rem] text-on-surface">Price</span>
          <span className="text-[0.9375rem] tabular-nums text-on-surface">
            {price}/2 — a margin of {(margin * 100).toFixed(1)}%
          </span>
        </div>

        <Factor
          name="Tailwind" hint="Is the sector's current at its back, or against it?"
          value={factors.tailwind} note={factors.tailwindNote}
          onValue={(tailwind) => onChange({ ...factors, tailwind })}
          onNote={(tailwindNote) => onChange({ ...factors, tailwindNote })}
        />
        <Factor
          name="Moat" hint="What stops the next entrant taking this?"
          value={factors.moat} note={factors.moatNote}
          onValue={(moat) => onChange({ ...factors, moat })}
          onNote={(moatNote) => onChange({ ...factors, moatNote })}
        />
        <Factor
          name="Leadership" hint="Is the chairman's statement driving a vector, or managing entropy?"
          value={factors.leadership} note={factors.leadershipNote}
          onValue={(leadership) => onChange({ ...factors, leadership })}
          onNote={(leadershipNote) => onChange({ ...factors, leadershipNote })}
        />
      </div>
    </Card>
  );
}

function Factor({
  name, hint, value, note, onValue, onNote,
}: {
  name: string;
  hint: string;
  value: Judgement;
  note: string;
  onValue: (v: Judgement) => void;
  onNote: (n: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Segmented label={name} value={value} options={JUDGEMENTS} onChange={onValue} />
      <input
        aria-label={`Why ${name.toLowerCase()} scores that`}
        placeholder={hint}
        value={note}
        onChange={(e) => onNote(e.target.value)}
        className="w-full rounded-[12px] h-12 px-4 bg-surface-container-highest text-on-surface
                   border-0 border-b-2 border-outline focus:border-primary focus-visible:outline-none
                   text-[0.875rem] placeholder:text-on-surface-variant"
      />
    </div>
  );
}
