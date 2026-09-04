// design.md §12.3. One entry point, one sheet, containing lighting mode, font
// size and nothing else the app does not need. Bottom sheet on mobile, centred
// panel from 640px.
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button, IconButton } from "./ui/button";
import { Segmented } from "./ui/segmented";
import { Slider } from "./ui/slider";
import { SCALES, THEMES, type Scale, type Theme } from "../hooks/useAppearance";
import type { Model } from "../hooks/useModel";

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
  model: Model;
  setModel: <K extends keyof Model>(key: K, value: Model[K]) => void;
  resetModel: () => void;
}

const percent = (x: number) => `${(x * 100).toFixed(1)}%`;

export function SettingsSheet({
  open, onClose, theme, setTheme, fontScale, setFontScale, model, setModel, resetModel,
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
                   max-h-[85dvh] overflow-y-auto overscroll-contain
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

          <div className="flex flex-col gap-6">
            <h3 className="text-[0.875rem] font-medium text-on-surface-variant">The model</h3>

            <Slider
              label="NSE transaction costs" value={model.c} min={0} max={0.1} step={0.001}
              format={percent} onValue={(c) => setModel("c", c)}
              hint="Charged on entry only, never on exit. It loads the price you pay and never the valuation."
            />
            <Slider
              label="Dividend withholding" value={model.w} min={0} max={0.3} step={0.005}
              format={percent} onValue={(w) => setModel("w", w)}
              hint="Five per cent for a resident holding under 12.5%."
            />
            <Slider
              label="Discount rate" value={model.r} min={0.01} max={0.3} step={0.0025}
              format={percent} onValue={(r) => setModel("r", r)}
              hint="The government bond yield at the tenor you are holding to."
            />
            <Slider
              label="Long-run growth" value={model.g} min={0} max={0.3} step={0.0025}
              format={percent} onValue={(g) => setModel("g", g)}
            />
            <Slider
              label="Margin of safety" value={model.k} min={0} max={0.7} step={0.01}
              format={percent} onValue={(k) => setModel("k", k)}
            />
            <Slider
              label="Horizon" value={model.n} min={1} max={30} step={1}
              format={(n) => `${n} years`} onValue={(n) => setModel("n", n)}
            />
            <Slider
              label="Stress applied to both sides" value={model.stress} min={0} max={0.5} step={0.01}
              format={percent} onValue={(stress) => setModel("stress", stress)}
              hint="Income down and obligations up by this much, to see what survives."
            />
            <Slider
              label="Margin below which a buy becomes a hold" value={model.holdFloor}
              min={0} max={0.5} step={0.01} format={percent}
              onValue={(holdFloor) => setModel("holdFloor", holdFloor)}
            />

            <div>
              <Button variant="outlined" onClick={resetModel}>Back to the defaults</Button>
            </div>
          </div>
        </div>

        <p className="mt-10 text-[0.75rem] leading-5 text-on-surface-variant">
          Appearance follows your device unless you choose otherwise. Everything here is
          stored on this device only, and every verdict in the app is computed from it.
        </p>
      </div>
    </div>
  );
}
