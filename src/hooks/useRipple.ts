// design.md §16.1, verbatim behaviour, typed for this project.
import { useCallback } from "react";

export function useRipple() {
  return useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const host = e.currentTarget;
    const rect = host.getBoundingClientRect();
    const size = Math.hypot(rect.width, rect.height) * 2;
    const x = (e.clientX ?? rect.left + rect.width / 2) - rect.left;
    const y = (e.clientY ?? rect.top + rect.height / 2) - rect.top;

    const span = document.createElement("span");
    span.className = "ripple";
    span.style.width = span.style.height = `${size}px`;
    span.style.left = `${x - size / 2}px`;
    span.style.top = `${y - size / 2}px`;
    host.appendChild(span);
    span.addEventListener("animationend", () => span.remove());
  }, []);
}
