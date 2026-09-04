// design.md §10: Material filled field. No border box, a 2px underline that
// takes the primary colour on focus, 48px tall so it clears the touch floor.
import { useId } from "react";

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  label: string;
  hint?: string;
  suffix?: string;
  onValue: (value: string) => void;
}

export function Field({ label, hint, suffix, onValue, className = "", ...rest }: Props) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[0.75rem] tracking-[0.03em] text-on-surface-variant">
        {label}
      </label>
      <div className="relative flex items-center">
        <input
          id={id}
          onChange={(e) => onValue(e.target.value)}
          className={
            "w-full rounded-[12px] h-12 px-4 bg-surface-container-highest text-on-surface " +
            "border-0 border-b-2 border-outline focus:border-primary focus-visible:ring-0 " +
            "focus-visible:outline-none tabular-nums " +
            (suffix ? "pr-14 " : "") + className
          }
          {...rest}
        />
        {suffix && (
          <span className="absolute right-4 text-[0.8125rem] text-on-surface-variant">{suffix}</span>
        )}
      </div>
      {hint && <span className="text-[0.6875rem] text-on-surface-variant">{hint}</span>}
    </div>
  );
}

export function Select({
  label, value, options, onValue,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onValue: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[0.75rem] tracking-[0.03em] text-on-surface-variant">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onValue(e.target.value)}
        className="w-full rounded-[12px] h-12 px-4 bg-surface-container-highest text-on-surface
                   border-0 border-b-2 border-outline focus:border-primary
                   focus-visible:outline-none appearance-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
