/**
 * What the collector left for the app.
 *
 * Served from the same origin as the app, so there is no cross-origin problem
 * and NSE data never reaches a public CDN. Absence is normal, not an error:
 * the app works with no feed at all, on a hand-typed price.
 */
export interface Counter {
  ticker: string;
  trade_date: string;
  close: number;
  isin: string | null;
  sector: string | null;
  source: string | null;
  fetched_at: string | null;
}

export interface Collected {
  generated_at: string;
  counters: Counter[];
  series: Record<string, string>;
}

export interface Observation { date: string; value: number }

const DATA = "/data";

async function load<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${DATA}/${path}`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;   // offline, or no collector on this host. Both are fine.
  }
}

export const loadCollected = () => load<Collected>("latest.json");
export const loadSeries = () => load<Record<string, Observation[]>>("series-observations.json");

/** Trading days old, or null when we have no date to judge. */
export function ageInDays(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const days = (Date.now() - Date.parse(iso)) / 86_400_000;
  return Number.isFinite(days) ? Math.floor(days) : null;
}
