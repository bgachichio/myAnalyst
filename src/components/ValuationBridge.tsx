// design.md §11. Every chart ships with four things or it does not ship: a
// title, a unit stated once, a direct label on the point that matters, and a
// one-sentence summary that doubles as the accessible description.
import {
  Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, XAxis, YAxis,
} from "recharts";

export interface BridgeRow {
  name: string;
  value: number;
  key: boolean;   // the point worth labelling directly
}

interface Props {
  title: string;
  unit: string;
  summary: string;
  rows: BridgeRow[];
}

const money = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ValuationBridge({ title, unit, summary, rows }: Props) {
  return (
    <figure className="m-0 flex flex-col gap-3">
      <figcaption className="flex flex-col gap-1">
        <h3 className="text-[1rem] font-medium tracking-[0.001em] text-on-surface">{title}</h3>
        <span className="text-[0.75rem] tracking-[0.03em] text-on-surface-variant">{unit}</span>
      </figcaption>

      {/* Bars start at zero, always. Single series, so --md-primary. */}
      <div className="h-56 w-full" role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 24, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--md-outline-variant)" strokeOpacity={0.5} />
            <XAxis
              dataKey="name" axisLine={false} tickLine={false} tickMargin={12}
              tick={{ fill: "var(--md-on-surface-variant)", fontSize: 12 }}
              interval={0}
            />
            <YAxis
              axisLine={false} tickLine={false} tickCount={5} width={40}
              tick={{ fill: "var(--md-on-surface-variant)", fontSize: 12 }}
            />
            <Bar dataKey="value" fill="var(--md-primary)" radius={[8, 8, 0, 0]} isAnimationActive={false}>
              <LabelList
                dataKey="value"
                position="top"
                content={({ x, y, width, value, index }) => {
                  if (index === undefined || !rows[index as number]?.key) return null;
                  return (
                    <text
                      x={Number(x) + Number(width) / 2}
                      y={Number(y) - 8}
                      textAnchor="middle"
                      className="fill-[var(--md-on-surface)]"
                      fontSize={13}
                      fontWeight={500}
                    >
                      {money(Number(value))}
                    </text>
                  );
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[0.875rem] leading-6 text-on-surface-variant max-w-[68ch]">{summary}</p>

      <div className="sr-only">
      <table>
        <caption>{title}</caption>
        <thead>
          <tr><th scope="col">Measure</th><th scope="col">{unit}</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}><th scope="row">{r.name}</th><td>{money(r.value)}</td></tr>
          ))}
        </tbody>
      </table>
      </div>
    </figure>
  );
}
