/**
 * The parameters the model runs on, kept where they can be changed.
 *
 * These were constants in the code, which meant the only way to ask "what if
 * the bond yield were two points higher" was to edit a file. They live here
 * now, on the device, and every screen reads the same ones.
 */
import { useEffect, useState } from "react";
import type { Parameters } from "../lib/kernel";
import { DEFAULT_HOLD_FLOOR } from "../lib/analysis";
import { read, write } from "../lib/store";

export interface Model extends Parameters {
  /** The margin below which a BUY becomes a HOLD. */
  holdFloor: number;
}

export const DEFAULT_MODEL: Model = {
  // The long bond, as at the last auction the collector saw. Overridden below
  // when it has a fresher figure.
  r: 0.1375,
  g: 0.04,
  k: 0.35,
  n: 15,
  // NSE charges, entry only. Brian's figure; the slider runs 0% to 10%.
  c: 0.026,
  // Resident, holdings under 12.5%.
  w: 0.05,
  stress: 0.1,
  holdFloor: DEFAULT_HOLD_FLOOR,
};

/** The fields this hook owns. `Parameters` also carries labels the model does not use. */
type Dial = "r" | "g" | "k" | "n" | "c" | "w" | "stress" | "holdFloor";

/** Every field is a number in a sane range, or the default. A stored file can be old. */
function clean(stored: Partial<Model>): Model {
  const pick = (key: Dial, min: number, max: number): number => {
    const value = stored[key];
    return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
      ? value
      : DEFAULT_MODEL[key];
  };
  return {
    r: pick("r", 0.0001, 1), g: pick("g", 0, 0.99), k: pick("k", 0, 0.99),
    n: Math.round(pick("n", 1, 50)), c: pick("c", 0, 0.1), w: pick("w", 0, 0.99),
    stress: pick("stress", 0, 0.9), holdFloor: pick("holdFloor", 0, 0.99),
  };
}

export function useModel() {
  const [model, setModel] = useState<Model>(() => clean(read<Partial<Model>>("model", {})));
  useEffect(() => { write("model", model); }, [model]);

  const set = <K extends keyof Model>(key: K, value: Model[K]) =>
    setModel((prev) => clean({ ...prev, [key]: value }));

  return { model, set, reset: () => setModel(DEFAULT_MODEL) };
}
