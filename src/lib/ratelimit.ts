/**
 * Limits failed sign-in attempts per key (email). In-memory, so it applies per
 * server process; put a shared store (e.g. Redis) behind it when running several.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;
const failures = new Map<string, number[]>();

export function isLocked(key: string, now = Date.now()): boolean {
  const recent = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  failures.set(key, recent);
  return recent.length >= MAX_FAILURES;
}

export function recordFailure(key: string, now = Date.now()) {
  failures.set(key, [...(failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS), now]);
}

export function clearFailures(key: string) {
  failures.delete(key);
}
