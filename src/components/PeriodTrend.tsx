// design.md §11, same four rules as the bridge: a title, the unit once, a
// direct label on the point that matters, and a summary that doubles as the
// accessible description. `brian` §4 (ii) to (iv) asks for three of these.
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis,
} from "recharts";

export interface TrendPoint {
  label: string;
  value: number;
}

interface Props {
  title: string;
  unit: string;
  points: TrendPoint[];
}

const compact = (n: number) =>
  new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(n);

const full = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 0 });

export function PeriodTrend({ title, unit, points }: Props) {
  if (points.length < 2) {
    return (
      <figure className="m-0 flex flex-col gap-2">
        <figcaption className="text-[1rem] font-medium text-on-surface">{title}</figcaption>
        <p className="text-[0.875rem] leading-6 text-on-surface-variant max-w-[68ch]">
          One period only. Add the comparative and this becomes a direction rather than a dot.
        </p>
      </figure>
    );
  }

  const first = points[0];
  const last = points[points.length - 1];
  const change = first.value === 0 ? null : (last.value - first.value) / Math.abs(first.value);
  const summary =
    `${title}: ${full(first.value)} in ${first.label} to ${full(last.value)} in ${last.label}` +
    (change === null ? "." : `, ${change >= 0 ? "up" : "down"} ${Math.abs(change * 100).toFixed(1)}%.`);

  return (
    <figure className="m-0 flex flex-col gap-3">
      <figcaption className="flex flex-col gap-1">
        <h3 className="text-[1rem] font-medium tracking-[0.001em] text-on-surface">{title}</h3>
        <span className="text-[0.75rem] tracking-[0.03em] text-on-surface-variant">{unit}</span>
      </figcaption>

      <div className="h-48 w-full" role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--md-outline-variant)" strokeOpacity={0.5} />
            <XAxis
              dataKey="label" axisLine={false} tickLine={false} tickMargin={12} interval={0}
              tick={{ fill: "var(--md-on-surface-variant)", fontSize: 12 }}
            />
            <YAxis
              axisLine={false} tickLine={false} tickCount={4} width={52}
              tickFormatter={compact}
              tick={{ fill: "var(--md-on-surface-variant)", fontSize: 12 }}
            />
            <Line
              type="linear" dataKey="value" stroke="var(--md-primary)" strokeWidth={2}
              dot={{ r: 3, fill: "var(--md-primary)" }} isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[0.875rem] leading-6 text-on-surface-variant max-w-[68ch]">{summary}</p>

      <table className="sr-only">
        <caption>{title}</caption>
        <thead><tr><th scope="col">Period</th><th scope="col">{unit}</th></tr></thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.label}><th scope="row">{p.label}</th><td>{full(p.value)}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
