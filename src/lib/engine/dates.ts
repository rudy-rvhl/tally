/** Date helpers. Transaction dates are calendar dates (no time zone); we keep them as UTC midnight. */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  janv: 1, fevr: 2, "févr": 2, mars: 3, avr: 4, mai: 5, juin: 6, juil: 7, "août": 8, aout: 8, "déc": 12,
};

export function utcDate(y: number, m: number, d: number): Date | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt;
}

export type DateOrder = "YMD" | "MDY" | "DMY";

/** Parse a bank date string. `order` disambiguates numeric dates like 03/04/2025. */
export function parseDate(raw: string, order: DateOrder = "MDY", fallbackYear?: number): Date | null {
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})/))) return utcDate(+m[1], +m[2], +m[3]); // OFX 20251002120000
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return utcDate(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) {
    let y = +m[3]; if (y < 100) y += 2000;
    const a = +m[1], b = +m[2];
    if (order === "DMY" || a > 12) return utcDate(y, b, a);
    return utcDate(y, a, b);
  }
  // "Oct 2, 2025", "Oct 02 2025", "02 Oct 2025", "2-Oct-25", "OCT 02"
  if ((m = s.match(/^([A-Za-zéû]{3,5})\.?\s+(\d{1,2}),?\s*(\d{4})?$/))) {
    const mo = MONTHS[m[1].toLowerCase()]; const y = m[3] ? +m[3] : fallbackYear;
    if (mo && y) return utcDate(y, mo, +m[2]);
  }
  if ((m = s.match(/^(\d{1,2})[\s-]([A-Za-zéû]{3,5})\.?[\s-](\d{2,4})$/))) {
    const mo = MONTHS[m[2].toLowerCase()]; let y = +m[3]; if (y < 100) y += 2000;
    if (mo) return utcDate(y, mo, +m[1]);
  }
  if ((m = s.match(/^(\d{1,2})\s+([A-Za-zéû]{3,5})\.?$/)) && fallbackYear) {
    const mo = MONTHS[m[2].toLowerCase()]; if (mo) return utcDate(fallbackYear, mo, +m[1]);
  }
  return null;
}

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthRange(key: string): { start: Date; end: Date } {
  const [y, m] = key.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 0)) };
}

export function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return monthKey(d);
}

export function monthsBetween(startKey: string, endKey: string): string[] {
  const out: string[] = [];
  let k = startKey;
  while (k <= endKey && out.length < 600) { out.push(k); k = addMonths(k, 1); }
  return out;
}

export function monthLabel(key: string, style: "long" | "short" = "long"): string {
  const { start } = monthRange(key);
  return start.toLocaleDateString("en-CA", { month: style, year: "numeric", timeZone: "UTC" });
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function formatDate(d: Date | string, style: "short" | "long" = "short"): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-CA", style === "short"
    ? { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }
    : { weekday: "short", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round(Math.abs(a.getTime() - b.getTime()) / 86400000);
}
