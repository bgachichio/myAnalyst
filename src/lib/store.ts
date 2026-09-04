/**
 * What the app remembers between visits.
 *
 * The browser's own storage, on Brian's own device. No account, no server, no
 * synchronisation: the watchlist and the saved memos are his and they stay
 * where he put them. Every read is defensive, because storage can be full,
 * disabled, or hold something an older version of the app wrote.
 */

const PREFIX = "myanalyst:";

export function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(fallback) === Array.isArray(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;   // private browsing, a full disk, or a shape we no longer read
  }
}

export function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Enough to distinguish two rows added in the same second. */
export const newId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
