/** Money helpers. All amounts are integer cents; never floats for arithmetic. */

export function parseAmountToCents(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    return Math.round(raw * 100);
  }
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  // (123.45) accounting negatives, trailing minus "123.45-", CR/DR suffixes
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (/-$/.test(s)) { negative = true; s = s.slice(0, -1); }
  if (/\bCR$/i.test(s)) { s = s.replace(/\s*CR$/i, ""); }
  if (/\bDR$/i.test(s)) { negative = true; s = s.replace(/\s*DR$/i, ""); }
  if (s.startsWith("-")) { negative = !negative; s = s.slice(1); }
  if (s.startsWith("+")) s = s.slice(1);
  s = s.replace(/[$€£\s]|CAD|USD/gi, "");
  // French-Canadian format: 1 234,56 or 1.234,56
  if (/^\d{1,3}([.\s]\d{3})*,\d{2}$/.test(s)) s = s.replace(/[.\s]/g, "").replace(",", ".");
  else if (/^\d+,\d{2}$/.test(s)) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const cents = parseInt(whole || "0", 10) * 100 + parseInt((frac + "00").slice(0, 2), 10);
  // round third decimal
  const third = frac.length > 2 ? parseInt(frac[2], 10) : 0;
  const total = cents + (third >= 5 ? 1 : 0);
  return negative ? -total : total;
}

export function formatMoney(cents: number, currency = "CAD", opts: { signed?: boolean; compact?: boolean } = {}): string {
  const value = cents / 100;
  const fmt = new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    currencyDisplay: currency === "CAD" ? "narrowSymbol" : "symbol",
    notation: opts.compact ? "compact" : "standard",
    maximumFractionDigits: opts.compact ? 1 : 2,
    minimumFractionDigits: opts.compact ? 0 : 2,
  });
  const out = fmt.format(Math.abs(value));
  if (cents < 0) return `-${out}`;
  if (opts.signed && cents > 0) return `+${out}`;
  return out;
}

export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function formatPct(p: number | null, digits = 1): string {
  if (p === null || !Number.isFinite(p)) return "—";
  return `${p > 0 ? "+" : ""}${p.toFixed(digits)}%`;
}

export function sum(values: number[]): number {
  let t = 0;
  for (const v of values) t += v;
  return t;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
