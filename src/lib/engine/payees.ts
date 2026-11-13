/**
 * Payee tracker (pure): for one payee, what was paid each month, and which months are missing.
 * "Usual" is the typical monthly total (median of the months with a payment).
 */
import { monthKey } from "./dates";

export type PayeeMonthStatus = "PAID" | "MISSING" | "LOW" | "HIGH" | "NO_STATEMENT" | "NOT_STARTED";
export interface PayeeMonth { month: string; totalCents: number; count: number; dates: Date[]; status: PayeeMonthStatus }
export interface PayeeSummary { months: PayeeMonth[]; usualCents: number | null; paidMonths: number; expectedMonths: number; missing: string[]; totalCents: number; firstPaid: Date | null; lastPaid: Date | null }

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

/**
 * @param payments  absolute amounts (cents > 0) with their dates
 * @param months    the months to show, oldest first
 * @param noStatement months for which no statement was imported for the accounts this payee is paid from
 * @param firstEver the first payment ever (also before the window): earlier months aren't "missed"
 */
export function payeeMonths(payments: { date: Date; cents: number }[], months: string[], noStatement: Set<string>, firstEver: Date | null): PayeeSummary {
  const byMonth = new Map<string, { date: Date; cents: number }[]>();
  for (const p of payments) byMonth.set(monthKey(p.date), [...(byMonth.get(monthKey(p.date)) ?? []), p]);
  const totals = months.map((m) => (byMonth.get(m) ?? []).reduce((a, p) => a + p.cents, 0));
  const usual = median(totals.filter((t) => t > 0));
  const start = firstEver ? monthKey(firstEver) : null;
  const out: PayeeMonth[] = months.map((m, i) => {
    const list = (byMonth.get(m) ?? []).sort((a, b) => a.date.getTime() - b.date.getTime());
    const total = totals[i];
    let status: PayeeMonthStatus;
    if (total > 0) status = usual && total < usual * 0.85 ? "LOW" : usual && total > usual * 1.5 ? "HIGH" : "PAID";
    else if (!start || m < start) status = "NOT_STARTED";
    else if (noStatement.has(m)) status = "NO_STATEMENT";
    else status = "MISSING";
    return { month: m, totalCents: total, count: list.length, dates: list.map((p) => p.date), status };
  });
  const expected = out.filter((m) => m.status !== "NOT_STARTED" && m.status !== "NO_STATEMENT");
  const all = [...payments].sort((a, b) => a.date.getTime() - b.date.getTime());
  return {
    months: out, usualCents: usual, paidMonths: expected.filter((m) => m.totalCents > 0).length, expectedMonths: expected.length,
    missing: out.filter((m) => m.status === "MISSING").map((m) => m.month), totalCents: totals.reduce((a, b) => a + b, 0),
    firstPaid: all[0]?.date ?? null, lastPaid: all[all.length - 1]?.date ?? null,
  };
}
