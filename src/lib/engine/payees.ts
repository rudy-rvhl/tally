/**
 * Payee tracker (pure): for one payee, what was paid each month, how often it's normally paid
 * (every month, every 3 months, once a year, one time, or no fixed schedule), and which expected
 * payments are missing. A yearly insurance premium isn't "missed" in the 11 months in between;
 * a monthly bill (a contractor, utilities) is.
 */
import { addMonths, monthKey } from "./dates";

export type PayeeMonthStatus = "PAID" | "MISSING" | "LOW" | "HIGH" | "NO_STATEMENT" | "NOT_STARTED" | "NOT_DUE";
export type PayeeFrequency = "MONTHLY" | "QUARTERLY" | "YEARLY" | "ONE_TIME" | "IRREGULAR";
export const FREQUENCIES: PayeeFrequency[] = ["MONTHLY", "QUARTERLY", "YEARLY", "ONE_TIME", "IRREGULAR"];
export const isFrequency = (s: unknown): s is PayeeFrequency => FREQUENCIES.includes(s as PayeeFrequency);

export const FREQUENCY_LABEL: Record<PayeeFrequency, { name: string; every: string; recurring: boolean }> = {
  MONTHLY: { name: "Monthly bill", every: "every month", recurring: true },
  QUARTERLY: { name: "Every 3 months", every: "every 3 months", recurring: true },
  YEARLY: { name: "Once a year", every: "once a year", recurring: true },
  ONE_TIME: { name: "One-time payment", every: "once", recurring: false },
  IRREGULAR: { name: "No fixed schedule", every: "now and then", recurring: false },
};
const PERIOD: Partial<Record<PayeeFrequency, number>> = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };
/** How far (in months) a payment can be early or late and still count for its due month. */
const SLACK: Partial<Record<PayeeFrequency, number>> = { MONTHLY: 0, QUARTERLY: 1, YEARLY: 1 };

export interface PayeeMonth { month: string; totalCents: number; count: number; dates: Date[]; status: PayeeMonthStatus }
export interface PayeeSummary {
  months: PayeeMonth[]; frequency: PayeeFrequency; detected: PayeeFrequency;
  /** The usual amount of one period's payment (a month's total for monthly bills). */
  usualCents: number | null; paidMonths: number; expectedMonths: number; missing: string[];
  /** Next month a payment is expected, for recurring payees (null if one is already missing). */
  nextDue: string | null; totalCents: number; firstPaid: Date | null; lastPaid: Date | null; payments: number;
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const monthsApart = (a: string, b: string) => { const [ya, ma] = a.split("-").map(Number), [yb, mb] = b.split("-").map(Number); return (yb - ya) * 12 + (mb - ma); };

/**
 * How often this payee is paid, from every payment on record (not only the months shown).
 * Needs at least 3 payments to call something monthly or every 3 months, and 2 a year apart for yearly;
 * a single payment is one-time. Lots of payments in the same months (a hardware store) is no fixed schedule.
 */
export function detectFrequency(dates: Date[]): PayeeFrequency {
  const months = [...new Set(dates.map(monthKey))].sort();
  if (months.length <= 1) return "ONE_TIME";
  const gaps = months.slice(1).map((m, i) => monthsApart(months[i], m));
  const gap = median(gaps)!;
  const perMonth = dates.length / months.length;
  const share = (lo: number, hi: number) => gaps.filter((g) => g >= lo && g <= hi).length / gaps.length;
  if (months.length >= 3 && share(1, 1) >= 0.5 && share(1, 2) >= 0.7 && perMonth <= 2.5) return "MONTHLY";
  if (months.length >= 3 && share(1, 1) < 0.5 && gap >= 2 && gap <= 4 && share(2, 4) >= 0.7) return "QUARTERLY";
  if (gap >= 10 && gap <= 14 && share(10, 14) >= 0.7) return "YEARLY";
  return "IRREGULAR";
}

/**
 * Walk the payee's schedule from its first payment: each payment sets when the next one is due
 * (a month, 3 months or a year later). A due month passes with nothing paid (allowing a month early
 * or late for quarterly and yearly bills) → that month is missing, and the next one is due a period later.
 */
function schedule(paid: Set<string>, freq: PayeeFrequency, first: string, latest: string, unknown: Set<string>) {
  const period = PERIOD[freq], slack = SLACK[freq] ?? 0;
  const missing: string[] = [];
  if (!period) return { missing, nextDue: null as string | null };
  let cursor = first;
  for (let guard = 0; guard < 600; guard++) {
    const due = addMonths(cursor, period);
    if (due > latest) return { missing, nextDue: due };
    let hit: string | null = null;
    for (let k = -slack; k <= slack && !hit; k++) { const m = addMonths(due, k); if (m > cursor && paid.has(m)) hit = m; }
    if (hit) { cursor = hit; continue; }
    if (addMonths(due, slack) > latest) return { missing, nextDue: due }; // still within its grace month
    if (!unknown.has(due)) missing.push(due);
    cursor = due;
  }
  return { missing, nextDue: null };
}

/**
 * @param payments   absolute amounts (cents > 0) with their dates, ideally all of them (also before the months shown)
 * @param months     the months to show, oldest first
 * @param noStatement months for which no statement was imported for the accounts this payee is paid from
 * @param firstEver  the first payment ever: earlier months aren't "missed"
 * @param frequency  how often it's paid, if you said so (otherwise detected)
 */
export function payeeMonths(payments: { date: Date; cents: number }[], months: string[], noStatement: Set<string>, firstEver: Date | null, frequency?: PayeeFrequency | null): PayeeSummary {
  const byMonth = new Map<string, { date: Date; cents: number }[]>();
  for (const p of payments) byMonth.set(monthKey(p.date), [...(byMonth.get(monthKey(p.date)) ?? []), p]);
  const monthTotal = (m: string) => (byMonth.get(m) ?? []).reduce((a, p) => a + p.cents, 0);
  const detected = detectFrequency(payments.map((p) => p.date));
  const freq = frequency ?? detected;
  const recurring = FREQUENCY_LABEL[freq].recurring;
  const paidMonthsAll = [...byMonth.keys()].filter((m) => monthTotal(m) > 0).sort();
  const usual = median(paidMonthsAll.map(monthTotal).filter((t) => t > 0));
  const start = firstEver ? monthKey(firstEver) : paidMonthsAll[0] ?? null;
  const latest = months[months.length - 1];
  const { missing: missedAll, nextDue } = start ? schedule(new Set(paidMonthsAll), freq, start, latest, noStatement) : { missing: [], nextDue: null };
  const missedSet = new Set(missedAll);

  const out: PayeeMonth[] = months.map((m) => {
    const list = (byMonth.get(m) ?? []).sort((a, b) => a.date.getTime() - b.date.getTime());
    const total = monthTotal(m);
    let status: PayeeMonthStatus;
    if (total > 0) status = recurring && usual && total < usual * 0.85 ? "LOW" : recurring && usual && total > usual * 1.5 ? "HIGH" : "PAID";
    else if (!start || m < start) status = "NOT_STARTED";
    else if (noStatement.has(m) && (freq === "MONTHLY" || missedSet.has(m))) status = "NO_STATEMENT";
    else if (missedSet.has(m)) status = "MISSING";
    else status = noStatement.has(m) ? "NO_STATEMENT" : "NOT_DUE";
    return { month: m, totalCents: total, count: list.length, dates: list.map((p) => p.date), status };
  });
  // "Paid in X of Y": months a payment was expected (monthly) or made / due (other schedules).
  const shown = out.filter((m) => m.status !== "NOT_STARTED" && m.status !== "NO_STATEMENT");
  const expected = freq === "MONTHLY" ? shown : shown.filter((m) => m.totalCents > 0 || m.status === "MISSING");
  const all = [...payments].sort((a, b) => a.date.getTime() - b.date.getTime());
  const inWindow = new Set(months);
  return {
    months: out, frequency: freq, detected, usualCents: usual,
    paidMonths: expected.filter((m) => m.totalCents > 0).length, expectedMonths: expected.length,
    missing: missedAll.filter((m) => inWindow.has(m)),
    nextDue: recurring && !missedAll.some((m) => m >= addMonths(latest, -(PERIOD[freq] ?? 1))) ? nextDue : null,
    totalCents: out.reduce((a, m) => a + m.totalCents, 0), payments: all.length,
    firstPaid: all[0]?.date ?? null, lastPaid: all[all.length - 1]?.date ?? null,
  };
}
