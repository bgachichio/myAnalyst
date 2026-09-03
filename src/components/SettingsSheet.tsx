// design.md §12.3. One entry point, one sheet, containing lighting mode, font
// size and nothing else the app does not need. Bottom sheet on mobile, centred
// panel from 640px.
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { IconButton } from "./ui/button";
import { Segmented } from "./ui/segmented";
import { SCALES, THEMES, type Scale, type Theme } from "../hooks/useAppearance";

const SCALE_LABEL: Record<Scale, string> = {
  compact: "Compact",
  default: "Default",
  large: "Large",
  xlarge: "Larger",
};

const THEME_LABEL: Record<Theme, string> = {
  system: "Auto",
  light: "Light",
  dark: "Dark",
};

interface Props {
  open: boolean;
  onClose: () => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  fontScale: Scale;
  setFontScale: (s: Scale) => void;
}

export function SettingsSheet({
  open, onClose, theme, setTheme, fontScale, setFontScale,
}: Props) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    panel.current?.querySelector<HTMLElement>("button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div
        className="absolute inset-0 bg-inverse-surface/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="relative w-full sm:w-[min(560px,calc(100vw-32px))] bg-surface-container-low
                   rounded-t-[28px] sm:rounded-[28px] p-5 md:p-6 pb-8
                   shadow-[var(--md-elevation-3)]"
      >
        {/* Drag handle, 32x4, mobile only */}
        <div className="sm:hidden mx-auto mb-5 h-1 w-8 rounded-full bg-outline-variant" />

        <div className="flex items-start justify-between gap-4 mb-6">
          <h2 className="headline-sm text-on-surface">Settings</h2>
          <IconButton aria-label="Close settings" onClick={onClose}>
            <X size={20} strokeWidth={1.75} />
          </IconButton>
        </div>

        <div className="flex flex-col gap-10">
          <Segmented
            label="Appearance"
            value={theme}
            options={THEMES}
            onChange={setTheme}
            format={(t) => THEME_LABEL[t]}
          />
          <Segmented
            label="Text size"
            value={fontScale}
            options={SCALES}
            onChange={setFontScale}
            format={(s) => SCALE_LABEL[s]}
          />
        </div>

        <p className="mt-10 text-[0.75rem] leading-5 text-on-surface-variant">
          Appearance follows your device unless you choose otherwise. Both settings
          are stored on this device only.
        </p>
      </div>
    </div>
  );
}
