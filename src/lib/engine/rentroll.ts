/**
 * Rent roll engine (pure): which deposit is which tenant's rent, and each tenant's month-by-month
 * payment record. Money in is matched to a tenant when the statement mentions them (their name or
 * the words you gave), or, when it doesn't (many statements only say "INTERAC E-TRANSFER"), when
 * the amount is exactly one tenant's rent. Two tenants with the same rent and no name on the
 * statement: we suggest, you decide.
 */
import { monthKey, monthRange } from "./dates";

export interface TenantLite {
  id: string;
  name: string;
  unit: string | null;
  buildingId: string | null;
  accountId: string | null;
  rentCents: number;
  dueDay: number;
  leaseStart: Date | null;
  leaseEnd: Date | null;
  matchText: string | null;
  status: "ACTIVE" | "PAST" | "VACANT";
}

export interface Deposit {
  id: string;
  date: Date;
  amountCents: number;
  description: string;
  accountId: string;
  /** Effective building of the deposit (its own, else its account's). */
  buildingId: string | null;
}

const DAY = 86400000;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const COMMON = new Set(["INC", "LTEE", "LTD", "CORP", "THE", "AND", "LES", "DES", "MME", "MR", "MRS", "MS", "M", "DE", "LA", "LE", "DU"]);

/** Words that identify a tenant on a statement: the words you gave, else each part of the name (3+ letters). */
export function tenantKeys(t: Pick<TenantLite, "name" | "matchText">): string[] {
  const given = (t.matchText ?? "").split(/[,;\n]/).map(norm).filter((w) => w.length >= 3);
  if (given.length) return given;
  return norm(t.name).split(" ").filter((w) => w.length >= 3 && !COMMON.has(w));
}

export function mentions(t: Pick<TenantLite, "name" | "matchText">, description: string): boolean {
  const d = ` ${norm(description)} `;
  const keys = tenantKeys(t);
  // Given words: any one of them. Name parts: the last name (or any part when the name is one word).
  if (t.matchText?.trim()) return keys.some((k) => d.includes(` ${k} `) || d.includes(k));
  const parts = keys;
  if (!parts.length) return false;
  const last = parts[parts.length - 1];
  return d.includes(` ${last} `) || (parts.length > 1 && parts.every((p) => d.includes(` ${p} `)));
}

/** Could this deposit be this tenant's rent? (Lease dates, account and building.) */
export function eligible(t: TenantLite, d: Deposit): boolean {
  if (t.status === "VACANT") return false;
  if (t.accountId && t.accountId !== d.accountId) return false;
  if (t.buildingId && d.buildingId && t.buildingId !== d.buildingId) return false;
  if (t.leaseStart && d.date.getTime() < t.leaseStart.getTime() - 31 * DAY) return false;
  if (t.leaseEnd && d.date.getTime() > t.leaseEnd.getTime() + 62 * DAY) return false;
  return true;
}

export interface MatchResult {
  matches: { depositId: string; tenantId: string; reason: string }[];
  /** Same amount as several tenants' rent, no name on the statement: you choose. */
  suggestions: { depositId: string; tenantIds: string[] }[];
}

export function matchDeposits(tenants: TenantLite[], deposits: Deposit[]): MatchResult {
  const out: MatchResult = { matches: [], suggestions: [] };
  for (const d of deposits) {
    if (d.amountCents <= 0) continue;
    const pool = tenants.filter((t) => eligible(t, d));
    const named = pool.filter((t) => mentions(t, d.description));
    if (named.length === 1) { out.matches.push({ depositId: d.id, tenantId: named[0].id, reason: "name on the statement" }); continue; }
    const byAmount = (named.length > 1 ? named : pool).filter((t) => t.rentCents === d.amountCents);
    if (byAmount.length === 1) { out.matches.push({ depositId: d.id, tenantId: byAmount[0].id, reason: named.length > 1 ? "name and amount" : "same amount as the rent" }); continue; }
    if (byAmount.length > 1) out.suggestions.push({ depositId: d.id, tenantIds: byAmount.map((t) => t.id) });
    else if (named.length > 1) out.suggestions.push({ depositId: d.id, tenantIds: named.map((t) => t.id) });
  }
  return out;
}

// ---------- ledger
export type MonthStatus = "PAID" | "LATE" | "PARTIAL" | "UNPAID" | "AHEAD" | "UPCOMING" | "NO_LEASE" | "NO_DATA";
export interface RentMonth { month: string; dueCents: number; paidCents: number; status: MonthStatus; dueDate: Date; firstPaid: Date | null }
export interface TenantLedger {
  months: RentMonth[];
  /** Rent due minus rent paid over the months we have statements for. Positive = owes you. */
  balanceCents: number;
  dueCents: number;
  paidCents: number;
  late: number;
  partial: number;
  unpaid: number;
  lastPayment: Date | null;
  /** Average days after the due date that rent arrives (negative = early). */
  avgDaysLate: number | null;
}

export const GRACE_DAYS = 5;
const dueDateOf = (month: string, dueDay: number) => { const s = monthRange(month).start; return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), Math.min(Math.max(dueDay, 1), 28))); };
/** The rent month a payment is for: up to 10 days before the due date counts for that month. */
export const rentMonthOf = (date: Date, dueDay: number) => monthKey(new Date(date.getTime() + (10 - (Math.min(Math.max(dueDay, 1), 28) - 1)) * DAY));

export function rentLedger(t: TenantLite, payments: { date: Date; amountCents: number }[], months: string[], asOf: Date, dataFrom: Date | null): TenantLedger {
  const byMonth = new Map<string, { date: Date; amountCents: number }[]>();
  for (const p of payments) {
    const k = rentMonthOf(p.date, t.dueDay);
    byMonth.set(k, [...(byMonth.get(k) ?? []), p]);
  }
  const res: TenantLedger = { months: [], balanceCents: 0, dueCents: 0, paidCents: 0, late: 0, partial: 0, unpaid: 0, lastPayment: null, avgDaysLate: null };
  const lateness: number[] = [];
  for (const m of months) {
    const { start, end } = monthRange(m);
    const due = dueDateOf(m, t.dueDay);
    const ps = (byMonth.get(m) ?? []).sort((a, b) => a.date.getTime() - b.date.getTime());
    const paid = ps.reduce((a, p) => a + p.amountCents, 0);
    const leased = t.status !== "VACANT" && (!t.leaseStart || t.leaseStart <= end) && (!t.leaseEnd || t.leaseEnd >= start) && (t.status === "ACTIVE" || !!t.leaseEnd);
    let status: MonthStatus;
    let dueCents = 0;
    if (leased && t.rentCents <= 0) status = paid ? "AHEAD" : "NO_LEASE"; // no rent on file ("No Lease")
    else if (!leased) status = paid ? "AHEAD" : "NO_LEASE";
    else if (dataFrom && end < dataFrom) status = "NO_DATA"; // before the first statement we have: unknown, not unpaid
    else if (due > asOf) status = paid >= t.rentCents ? "AHEAD" : "UPCOMING";
    else {
      dueCents = t.rentCents;
      // Full rent paid: on time if the payment that completed it arrived within the grace period.
      let run = 0, completedOn: Date | null = null;
      for (const p of ps) { run += p.amountCents; if (run >= dueCents) { completedOn = p.date; break; } }
      if (completedOn) status = completedOn.getTime() <= due.getTime() + GRACE_DAYS * DAY ? "PAID" : "LATE";
      else status = paid > 0 ? "PARTIAL" : "UNPAID";
      if (ps[0]) lateness.push(Math.round((ps[0].date.getTime() - due.getTime()) / DAY));
    }
    if (status === "LATE") res.late++;
    if (status === "PARTIAL") res.partial++;
    if (status === "UNPAID") res.unpaid++;
    if (dueCents || status === "AHEAD") { res.dueCents += dueCents; res.paidCents += paid; }
    res.months.push({ month: m, dueCents, paidCents: paid, status, dueDate: due, firstPaid: ps[0]?.date ?? null });
  }
  res.balanceCents = res.dueCents - res.paidCents;
  const all = [...payments].sort((a, b) => b.date.getTime() - a.date.getTime());
  res.lastPayment = all[0]?.date ?? null;
  res.avgDaysLate = lateness.length ? Math.round(lateness.reduce((a, b) => a + b, 0) / lateness.length) : null;
  return res;
}
