// design.md §10. The overrides live here, in the component, never per usage.
import { forwardRef } from "react";
import { useRipple } from "../../hooks/useRipple";

type Variant = "primary" | "tonal" | "outlined" | "text";

const BASE =
  "state-layer inline-flex items-center justify-center gap-2 font-medium select-none " +
  "disabled:opacity-38 disabled:pointer-events-none " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

// h-11 is 44px, the minimum touch target. Primary actions get h-12 (48px).
const VARIANTS: Record<Variant, string> = {
  primary:
    "rounded-full h-12 px-6 bg-primary text-on-primary shadow-[var(--md-elevation-1)] " +
    "hover:shadow-[var(--md-elevation-2)] active:shadow-[var(--md-elevation-1)] " +
    "text-[0.875rem] tracking-[0.006em]",
  tonal:
    "rounded-full h-11 px-6 bg-primary-container text-on-primary-container shadow-none " +
    "text-[0.875rem] tracking-[0.006em]",
  outlined:
    "rounded-full h-11 px-6 border border-outline bg-transparent text-primary " +
    "text-[0.875rem] tracking-[0.006em]",
  text: "rounded-[12px] h-10 px-3 text-primary text-[0.875rem] tracking-[0.006em]",
};

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = "primary", className = "", onPointerDown, ...rest }, ref) => {
    const ripple = useRipple();
    return (
      <button
        ref={ref}
        className={`${BASE} ${VARIANTS[variant]} ${className}`}
        onPointerDown={(e) => {
          ripple(e);
          onPointerDown?.(e);
        }}
        {...rest}
      />
    );
  },
);
Button.displayName = "Button";

/** 44px target, 20px icon. Never without an aria-label. */
export const IconButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { "aria-label": string }
>(({ className = "", onPointerDown, ...rest }, ref) => {
  const ripple = useRipple();
  return (
    <button
      ref={ref}
      className={`${BASE} rounded-full size-11 text-on-surface-variant ${className}`}
      onPointerDown={(e) => {
        ripple(e);
        onPointerDown?.(e);
      }}
      {...rest}
    />
  );
});
IconButton.displayName = "IconButton";
