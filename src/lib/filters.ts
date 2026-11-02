/**
 * Filters live in the URL so every view is linkable, the back button restores the
 * previous view exactly, and drill-downs keep the context they came from.
 */
export interface Filters {
  from?: string; // YYYY-MM-DD
  to?: string;
  month?: string; // YYYY-MM shortcut
  account?: string;
  accountType?: string;
  institution?: string;
  merchant?: string; // merchant id
  category?: string; // category id (parent or child)
  kind?: string; // TxnKind or "spending" | "income" | "movement"
  ownership?: string; // PERSONAL | BUSINESS
  currency?: string;
  q?: string;
  review?: string;
  sort?: string;
  page?: string;
}

export const FILTER_KEYS: (keyof Filters)[] = ["from", "to", "month", "account", "accountType", "institution", "merchant", "category", "kind", "ownership", "currency", "q", "review", "sort", "page"];

export function readFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const f: Filters = {};
  for (const k of FILTER_KEYS) {
    const v = sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    if (s) f[k] = s;
  }
  return f;
}

export function toQuery(f: Filters, overrides: Partial<Filters> = {}): string {
  const merged: Filters = { ...f, ...overrides };
  const p = new URLSearchParams();
  for (const k of FILTER_KEYS) {
    const v = merged[k];
    if (v) p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function txnLink(f: Filters, overrides: Partial<Filters> = {}): string {
  return `/transactions${toQuery(f, { ...overrides, page: undefined })}`;
}
