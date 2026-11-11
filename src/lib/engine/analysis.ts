/**
 * Property and account analysis (pure). Definitions, kept deliberately simple and stated on the page:
 *  - Income: money received that isn't a transfer between your accounts or a refund. Rent is income
 *    matched to a tenant on the rent roll.
 *  - Operating expenses: spending (purchases and fees, minus refunds), excluding interest.
 *  - NOI (net operating income) = income − operating expenses.
 *  - Debt payments = interest + loan principal. Cash flow = NOI − debt payments.
 */
import { byCategory, byMerchant, groupSpending, isSpending, spendOf } from "./analytics";
import { monthKey } from "./dates";
import type { AnalyticTxn } from "./types";

export interface PropertyMetrics {
  incomeCents: number;
  rentCents: number;
  otherIncomeCents: number;
  opexCents: number;
  interestCents: number;
  principalCents: number;
  noiCents: number;
  cashFlowCents: number;
  /** Operating expenses as a share of income (null without income). */
  expenseRatio: number | null;
  months: { month: string; incomeCents: number; opexCents: number; noiCents: number }[];
  categories: { key: string; label: string; spendCents: number; share: number }[];
  suppliers: { key: string; label: string; spendCents: number; count: number }[];
}

const isOpex = (t: AnalyticTxn) => isSpending(t) && t.kind !== "INTEREST";

export function propertyMetrics(txns: AnalyticTxn[], months: string[]): PropertyMetrics {
  const income = txns.filter((t) => t.kind === "INCOME");
  const incomeCents = income.reduce((a, t) => a + t.amountCents, 0);
  const rentCents = income.filter((t) => t.tenantId).reduce((a, t) => a + t.amountCents, 0);
  const opexCents = txns.filter(isOpex).reduce((a, t) => a + spendOf(t), 0);
  const interestCents = txns.filter((t) => t.kind === "INTEREST").reduce((a, t) => a + spendOf(t), 0);
  const principalCents = txns.filter((t) => t.kind === "LOAN_PAYMENT").reduce((a, t) => a - t.amountCents, 0);
  const noiCents = incomeCents - opexCents;
  const byMonth = new Map(months.map((m) => [m, { month: m, incomeCents: 0, opexCents: 0, noiCents: 0 }]));
  for (const t of txns) {
    const p = byMonth.get(monthKey(t.date));
    if (!p) continue;
    if (t.kind === "INCOME") p.incomeCents += t.amountCents;
    else if (isOpex(t)) p.opexCents += spendOf(t);
  }
  for (const p of byMonth.values()) p.noiCents = p.incomeCents - p.opexCents;
  return {
    incomeCents, rentCents, otherIncomeCents: incomeCents - rentCents, opexCents, interestCents, principalCents, noiCents,
    cashFlowCents: noiCents - interestCents - principalCents,
    expenseRatio: incomeCents > 0 ? opexCents / incomeCents : null,
    months: [...byMonth.values()],
    categories: groupSpending(txns.filter(isOpex), byCategory).slice(0, 8),
    suppliers: groupSpending(txns.filter(isOpex), byMerchant).slice(0, 8),
  };
}

export const pctChange = (now: number, before: number) => (before > 0 ? (now - before) / before : null);

/** Same supplier, same amount, within a few days: possibly paid twice. */
export function possibleDoublePayments(txns: AnalyticTxn[], minCents = 5000, days = 5) {
  const spend = txns.filter((t) => (t.kind === "PURCHASE" || t.kind === "FEE") && -t.amountCents >= minCents).sort((a, b) => a.date.getTime() - b.date.getTime());
  const out: { a: AnalyticTxn; b: AnalyticTxn }[] = [];
  for (let i = 0; i < spend.length; i++) {
    for (let j = i + 1; j < spend.length && spend[j].date.getTime() - spend[i].date.getTime() <= days * 86400000; j++) {
      const a = spend[i], b = spend[j];
      if (a.amountCents === b.amountCents && byMerchant(a).key === byMerchant(b).key && a.id !== b.id) out.push({ a, b });
    }
  }
  return out;
}

/** A supplier's latest charge well above its usual amount (utilities, insurance renewals). */
export function supplierSpikes(txns: AnalyticTxn[], factor = 1.5, minCents = 10000) {
  const groups = new Map<string, AnalyticTxn[]>();
  for (const t of txns) if (t.kind === "PURCHASE") groups.set(byMerchant(t).key, [...(groups.get(byMerchant(t).key) ?? []), t]);
  const out: { merchant: string; merchantKey: string; lastCents: number; usualCents: number; date: Date }[] = [];
  for (const [key, list] of groups) {
    if (list.length < 4) continue;
    const sorted = [...list].sort((a, b) => a.date.getTime() - b.date.getTime());
    const last = sorted[sorted.length - 1];
    const prior = sorted.slice(0, -1).map((t) => -t.amountCents).sort((a, b) => a - b);
    const usual = prior[Math.floor(prior.length / 2)];
    if (-last.amountCents >= usual * factor && -last.amountCents - usual >= minCents) out.push({ merchant: byMerchant(last).label, merchantKey: key, lastCents: -last.amountCents, usualCents: usual, date: last.date });
  }
  return out.sort((a, b) => b.lastCents - b.usualCents - (a.lastCents - a.usualCents));
}

/** Categories that grew most against the previous period. */
export function categoryJumps(now: AnalyticTxn[], before: AnalyticTxn[], minIncreaseCents = 50000, minPct = 0.25) {
  const a = groupSpending(now.filter(isOpex), byCategory), b = new Map(groupSpending(before.filter(isOpex), byCategory).map((g) => [g.key, g.spendCents]));
  return a.map((g) => ({ label: g.label, key: g.key, nowCents: g.spendCents, beforeCents: b.get(g.key) ?? 0 }))
    .filter((g) => g.beforeCents > 0 && g.nowCents - g.beforeCents >= minIncreaseCents && (g.nowCents - g.beforeCents) / g.beforeCents >= minPct)
    .sort((x, y) => y.nowCents - y.beforeCents - (x.nowCents - x.beforeCents));
}

/** Has anything in these categories/subcategories been paid in the period (e.g. insurance, property tax)? */
export const paidFor = (txns: AnalyticTxn[], re: RegExp) => txns.some((t) => isSpending(t) && re.test(`${t.category ?? ""} ${t.subcategory ?? ""} ${t.merchant ?? ""}`));
