// design.md §10 and §8.3. Surface tint carries separation; never a border and a
// shadow together, and never a shadow at all in dark mode.
export function Card({
  className = "",
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={
        "rounded-[20px] bg-surface-container-low p-5 md:p-6 border-0 " +
        "shadow-[var(--md-elevation-1)] dark:shadow-none dark:bg-surface-container " +
        className
      }
      {...rest}
    />
  );
}

/** A group has a heading or it does not exist (§8.4). */
export function CardHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[0.875rem] font-medium tracking-[0.006em] text-on-surface-variant">
      {children}
    </h2>
  );
}
