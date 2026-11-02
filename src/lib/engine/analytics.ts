/**
 * Analytics engine. Pure functions over already-filtered, already-converted transactions.
 *
 * Definitions (the same everywhere in the app, in both modes):
 *   Spending   = purchases + fees + interest, minus refunds and reversals.
 *                Shown as a positive number.
 *   Received   = INCOME transactions.
 *   Net cash flow = received - spending.
 *   Money movement (transfers, card payments, loan payments) is reported separately
 *   and never counted as spending or income.
 */
import { median, pctChange, sum } from "./money";
import { addMonths, monthKey } from "./dates";
import type { AnalyticTxn, TxnKindName } from "./types";

const SPEND: TxnKindName[] = ["PURCHASE", "FEE", "INTEREST", "REFUND", "REVERSAL"];
const MOVE: TxnKindName[] = ["TRANSFER", "CARD_PAYMENT", "LOAN_PAYMENT"];

export const isSpending = (t: AnalyticTxn) => SPEND.includes(t.kind);
export const isIncome = (t: AnalyticTxn) => t.kind === "INCOME";
export const isMovement = (t: AnalyticTxn) => MOVE.includes(t.kind);
/** Spending contribution: purchases positive, refunds negative. */
export const spendOf = (t: AnalyticTxn) => (isSpending(t) ? -t.amountCents : 0);

export interface Summary {
  spendingCents: number;
  incomeCents: number;
  netCashFlowCents: number;
  refundsCents: number;
  feesAndInterestCents: number;
  movementCents: { transfers: number; cardPayments: number; loanPayments: number };
  purchaseCount: number;
  transactionCount: number;
  averagePurchaseCents: number;
  medianPurchaseCents: number;
  merchantCount: number;
  accountCount: number;
}

export function summarize(txns: AnalyticTxn[]): Summary {
  const spend = txns.filter(isSpending);
  const purchases = txns.filter((t) => t.kind === "PURCHASE");
  const pAmounts = purchases.map((t) => -t.amountCents);
  const spending = sum(spend.map(spendOf));
  const income = sum(txns.filter(isIncome).map((t) => t.amountCents));
  const absOut = (k: TxnKindName) => sum(txns.filter((t) => t.kind === k && t.amountCents < 0).map((t) => -t.amountCents));
  return {
    spendingCents: spending,
    incomeCents: income,
    netCashFlowCents: income - spending,
    refundsCents: sum(txns.filter((t) => t.kind === "REFUND" || t.kind === "REVERSAL").map((t) => t.amountCents)),
    feesAndInterestCents: sum(txns.filter((t) => t.kind === "FEE" || t.kind === "INTEREST").map(spendOf)),
    movementCents: { transfers: absOut("TRANSFER"), cardPayments: absOut("CARD_PAYMENT"), loanPayments: absOut("LOAN_PAYMENT") },
    purchaseCount: purchases.length,
    transactionCount: txns.length,
    averagePurchaseCents: pAmounts.length ? Math.round(sum(pAmounts) / pAmounts.length) : 0,
    medianPurchaseCents: median(pAmounts),
    merchantCount: new Set(spend.map((t) => t.merchantId ?? t.merchant).filter(Boolean)).size,
    accountCount: new Set(txns.map((t) => t.accountId)).size,
  };
}

export interface Group { key: string; label: string; spendCents: number; count: number; share: number }

export function groupSpending(txns: AnalyticTxn[], keyOf: (t: AnalyticTxn) => { key: string; label: string } | null): Group[] {
  const m = new Map<string, Group>();
  let total = 0;
  for (const t of txns) {
    if (!isSpending(t)) continue;
    const k = keyOf(t);
    if (!k) continue;
    const g = m.get(k.key) ?? { key: k.key, label: k.label, spendCents: 0, count: 0, share: 0 };
    g.spendCents += spendOf(t);
    if (t.kind === "PURCHASE") g.count++;
    m.set(k.key, g);
    total += spendOf(t);
  }
  const out = [...m.values()].sort((a, b) => b.spendCents - a.spendCents);
  for (const g of out) g.share = total ? g.spendCents / total : 0;
  return out;
}

export const byMerchant = (t: AnalyticTxn) => ({ key: t.merchantId ?? `name:${t.merchant ?? "Unknown"}`, label: t.merchant ?? "Unknown supplier" });
export const byCategory = (t: AnalyticTxn) => ({ key: t.category ?? "Uncategorized", label: t.category ?? "Uncategorized" });
export const bySubcategory = (t: AnalyticTxn) => ({ key: t.categoryId ?? "none", label: t.subcategory ? `${t.category} › ${t.subcategory}` : t.category ?? "Uncategorized" });
export const byMonth = (t: AnalyticTxn) => ({ key: monthKey(t.date), label: monthKey(t.date) });

export interface MonthPoint { month: string; spendingCents: number; incomeCents: number; netCents: number; count: number }

export function monthlySeries(txns: AnalyticTxn[], months: string[]): MonthPoint[] {
  const m = new Map(months.map((k) => [k, { month: k, spendingCents: 0, incomeCents: 0, netCents: 0, count: 0 }]));
  for (const t of txns) {
    const p = m.get(monthKey(t.date));
    if (!p) continue;
    p.spendingCents += spendOf(t);
    if (isIncome(t)) p.incomeCents += t.amountCents;
    if (t.kind === "PURCHASE") p.count++;
  }
  for (const p of m.values()) p.netCents = p.incomeCents - p.spendingCents;
  return [...m.values()];
}

export function rollingAverage(points: number[], window: number): (number | null)[] {
  return points.map((_, i) => (i + 1 < window ? null : Math.round(sum(points.slice(i + 1 - window, i + 1)) / window)));
}

export interface ComparisonRow { key: string; label: string; currentCents: number; previousCents: number; changeCents: number; changePct: number | null }

export function compareGroups(current: Group[], previous: Group[]): ComparisonRow[] {
  const keys = new Map<string, string>();
  for (const g of [...current, ...previous]) keys.set(g.key, g.label);
  const c = new Map(current.map((g) => [g.key, g.spendCents]));
  const p = new Map(previous.map((g) => [g.key, g.spendCents]));
  return [...keys].map(([key, label]) => {
    const cur = c.get(key) ?? 0, prev = p.get(key) ?? 0;
    return { key, label, currentCents: cur, previousCents: prev, changeCents: cur - prev, changePct: pctChange(cur, prev) };
  }).sort((a, b) => Math.abs(b.changeCents) - Math.abs(a.changeCents));
}

export interface RecurringItem {
  merchantKey: string; merchant: string; months: number; typicalCents: number; lastCents: number;
  lastDate: Date; priceChangeCents: number; priceChangePct: number | null; cadence: "monthly" | "irregular";
}

/** Merchants charged in at least 3 distinct months with stable amounts. */
export function detectRecurring(txns: AnalyticTxn[]): RecurringItem[] {
  const groups = new Map<string, AnalyticTxn[]>();
  for (const t of txns) if (t.kind === "PURCHASE") {
    const k = byMerchant(t).key;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const out: RecurringItem[] = [];
  for (const [k, list] of groups) {
    const sorted = [...list].sort((a, b) => a.date.getTime() - b.date.getTime());
    const months = new Set(sorted.map((t) => monthKey(t.date)));
    if (months.size < 3) continue;
    // one charge per month, stable amount
    if (sorted.length > months.size * 1.5) continue;
    const amounts = sorted.map((t) => -t.amountCents);
    const med = median(amounts);
    const stable = amounts.filter((a) => Math.abs(a - med) <= Math.max(med * 0.25, 100)).length / amounts.length;
    if (stable < 0.75) continue;
    const last = sorted[sorted.length - 1];
    const lastAmt = -last.amountCents;
    const prior = amounts.slice(0, -1);
    const recentPrior = prior.slice(-3);
    const priorTypical = median(recentPrior);
    // Only call it a price change when earlier charges were a fixed price (like a subscription).
    const fixedPrice = recentPrior.length >= 2 && Math.max(...recentPrior) - Math.min(...recentPrior) <= Math.max(1, priorTypical * 0.01);
    const gaps = sorted.slice(1).map((t, i) => (t.date.getTime() - sorted[i].date.getTime()) / 86400000);
    const monthly = gaps.every((g) => g >= 20 && g <= 40);
    out.push({
      merchantKey: k, merchant: last.merchant ?? "Unknown", months: months.size, typicalCents: med, lastCents: lastAmt, lastDate: last.date,
      priceChangeCents: fixedPrice ? lastAmt - priorTypical : 0, priceChangePct: fixedPrice ? pctChange(lastAmt, priorTypical) : null, cadence: monthly ? "monthly" : "irregular",
    });
  }
  return out.sort((a, b) => b.typicalCents - a.typicalCents);
}

export interface Anomaly { id: string; reason: string; amountCents: number }

/** Unusually large purchases relative to the same merchant or category history. */
export function detectAnomalies(history: AnalyticTxn[], target: AnalyticTxn[]): Anomaly[] {
  const byM = new Map<string, number[]>();
  for (const t of history) if (t.kind === "PURCHASE") {
    const k = byMerchant(t).key;
    byM.set(k, [...(byM.get(k) ?? []), -t.amountCents]);
  }
  const out: Anomaly[] = [];
  for (const t of target) {
    if (t.kind !== "PURCHASE") continue;
    const amt = -t.amountCents;
    const hist = byM.get(byMerchant(t).key) ?? [];
    if (hist.length >= 3) {
      const med = median(hist);
      if (amt > med * 3 && amt - med > 5000) out.push({ id: t.id, amountCents: amt, reason: `About ${Math.round(amt / med)}× your usual ${t.merchant} purchase` });
    } else if (hist.length === 0 && amt >= 100000) {
      out.push({ id: t.id, amountCents: amt, reason: `Large first-time purchase from ${t.merchant ?? "a new supplier"}` });
    }
  }
  return out.sort((a, b) => b.amountCents - a.amountCents);
}

/** NOT_STARTED = before the account's first statement (not a gap). */
export interface CoverageCell { month: string; status: "COMPLETE" | "PARTIAL" | "MISSING" | "NOT_STARTED"; coveredDays: number; daysInMonth: number }

/** Which months each account has statements for. Periods are [start, end] inclusive dates. */
export function coverage(periods: { start: Date; end: Date }[], months: string[]): CoverageCell[] {
  const first = periods.length ? Math.min(...periods.map((p) => p.start.getTime())) : Infinity;
  return months.map((m) => {
    const [y, mo] = m.split("-").map(Number);
    const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const covered = new Set<number>();
    for (const p of periods) {
      for (let d = 1; d <= days; d++) {
        const t = Date.UTC(y, mo - 1, d);
        if (t >= p.start.getTime() && t <= p.end.getTime()) covered.add(d);
      }
    }
    const monthEnd = Date.UTC(y, mo - 1, days);
    const status = covered.size >= days ? "COMPLETE" : covered.size > 0 ? "PARTIAL" : monthEnd < first ? "NOT_STARTED" : "MISSING";
    return { month: m, status, coveredDays: covered.size, daysInMonth: days };
  });
}

export function previousMonth(key: string) { return addMonths(key, -1); }
