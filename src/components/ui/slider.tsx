// design.md §10. A native range input, restyled: 44px of grab area, the track
// and thumb on the primary colour, and the value always visible beside the
// label because a slider whose value you cannot read is a guess.
import { useId } from "react";

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  hint?: string;
  onValue: (value: number) => void;
}

export function Slider({ label, value, min, max, step, format, hint, onValue }: Props) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="text-[0.875rem] text-on-surface-variant">{label}</label>
        <span className="text-[0.9375rem] tabular-nums text-on-surface">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onValue(Number(e.target.value))}
        className="w-full h-11 bg-transparent appearance-none cursor-pointer
                   focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary
                   [&::-webkit-slider-runnable-track]:h-1
                   [&::-webkit-slider-runnable-track]:rounded-full
                   [&::-webkit-slider-runnable-track]:bg-surface-container-highest
                   [&::-webkit-slider-thumb]:appearance-none
                   [&::-webkit-slider-thumb]:size-5
                   [&::-webkit-slider-thumb]:-mt-2
                   [&::-webkit-slider-thumb]:rounded-full
                   [&::-webkit-slider-thumb]:bg-primary
                   [&::-moz-range-track]:h-1
                   [&::-moz-range-track]:rounded-full
                   [&::-moz-range-track]:bg-surface-container-highest
                   [&::-moz-range-thumb]:size-5
                   [&::-moz-range-thumb]:border-0
                   [&::-moz-range-thumb]:rounded-full
                   [&::-moz-range-thumb]:bg-primary"
      />
      {hint && <span className="text-[0.6875rem] leading-5 text-on-surface-variant">{hint}</span>}
    </div>
  );
}
