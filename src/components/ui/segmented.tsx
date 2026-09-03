// A settings control, not a shadcn Tabs. Material segmented button: one row of
// options, the chosen one filled, 44px targets, keyboard reachable.
import { useRipple } from "../../hooks/useRipple";

interface Props<T extends string> {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  format?: (value: T) => string;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  format = (v) => v,
}: Props<T>) {
  const ripple = useRipple();
  return (
    <div className="flex flex-col gap-3">
      <span id={`${label}-label`} className="text-[0.875rem] text-on-surface-variant">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${label}-label`}
        className="flex rounded-full bg-surface-container-highest p-1"
      >
        {options.map((option) => {
          const active = option === value;
          return (
            <button
              key={option}
              role="radio"
              aria-checked={active}
              onPointerDown={ripple}
              onClick={() => onChange(option)}
              className={
                "state-layer flex-1 min-h-11 px-3 rounded-full text-[0.875rem] font-medium " +
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary " +
                (active
                  ? "bg-primary text-on-primary"
                  : "text-on-surface-variant")
              }
            >
              {format(option)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
