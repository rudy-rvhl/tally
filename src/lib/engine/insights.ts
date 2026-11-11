/**
 * Plain-language explanations. Every insight carries the filters that reproduce
 * the transactions behind it, so the user can click through and verify.
 */
import { formatMoney, formatPct, pctChange } from "./money";
import { bySubcategory, byMerchant, compareGroups, groupSpending, summarize, type RecurringItem, type Anomaly } from "./analytics";
import { monthLabel } from "./dates";
import type { AnalyticTxn } from "./types";
import type { Filters } from "../filters";

export interface Insight { text: string; tone: "up" | "down" | "neutral" | "warning"; link?: Partial<Filters>; href?: string }

const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/**
 * Plain-language summary of a period against the one before. A month by default; pass `period`
 * for any other span (e.g. a year): its labels and the date range the links should open.
 */
export function explainMonth(current: AnalyticTxn[], previous: AnalyticTxn[], month: string, prevMonth: string, currency: string,
  period?: { cur: string; prev: string; from: string; to: string }): Insight[] {
  const out: Insight[] = [];
  const c = summarize(current), p = summarize(previous);
  const cur = period?.cur ?? monthLabel(month, "long").split(" ")[0], prev = period?.prev ?? monthLabel(prevMonth, "long").split(" ")[0];
  const at = (extra: Partial<Filters>): Partial<Filters> => (period ? { from: period.from, to: period.to, ...extra } : { month, ...extra });
  const delta = c.spendingCents - p.spendingCents;
  if (p.spendingCents > 0 && Math.abs(delta) >= 100) {
    const merchants = compareGroups(groupSpending(current, byMerchant), groupSpending(previous, byMerchant));
    const cats = compareGroups(groupSpending(current, bySubcategory), groupSpending(previous, bySubcategory));
    const drivers = (delta > 0 ? merchants.filter((r) => r.changeCents > 0) : merchants.filter((r) => r.changeCents < 0)).slice(0, 2);
    const catDrivers = (delta > 0 ? cats.filter((r) => r.changeCents > 0) : cats.filter((r) => r.changeCents < 0)).slice(0, 1);
    const catName = (label: string) => {
      const sub = (label.split(" › ")[1] ?? label).toLowerCase();
      return sub === "uncategorized" ? "uncategorized purchases" : sub;
    };
    const names = [...drivers.map((d) => d.label), ...catDrivers.map((d) => catName(d.label))].filter((v, i, a) => a.indexOf(v) === i);
    const why = names.length ? ` Most of the ${delta > 0 ? "increase" : "decrease"} came from ${list(names)}.` : "";
    out.push({
      text: `You spent ${formatMoney(Math.abs(delta), currency)} ${delta > 0 ? "more" : "less"} in ${cur} than in ${prev} (${formatPct(pctChange(c.spendingCents, p.spendingCents))}).${why}`,
      tone: delta > 0 ? "up" : "down", link: at({ kind: "spending" }),
    });
    for (const d of drivers) {
      if (Math.abs(d.changeCents) < 2000) continue;
      out.push({
        text: `${d.label}: ${formatMoney(d.currentCents, currency)} in ${cur}, compared with ${formatMoney(d.previousCents, currency)} in ${prev}.`,
        tone: d.changeCents > 0 ? "up" : "down", link: d.key.startsWith("name:") ? at({ q: d.label }) : at({ merchant: d.key }),
      });
    }
  } else if (c.spendingCents > 0 && p.spendingCents === 0) {
    out.push({ text: `You spent ${formatMoney(c.spendingCents, currency)} in ${cur}. There's no ${prev} data to compare with yet.`, tone: "neutral", link: at({ kind: "spending" }) });
  }
  if (c.incomeCents > 0) {
    out.push({
      text: c.netCashFlowCents >= 0
        ? `You received ${formatMoney(c.incomeCents, currency)} and kept ${formatMoney(c.netCashFlowCents, currency)} after spending.`
        : `You received ${formatMoney(c.incomeCents, currency)}, which is ${formatMoney(-c.netCashFlowCents, currency)} less than you spent.`,
      tone: c.netCashFlowCents >= 0 ? "down" : "warning", link: at({ kind: "income" }),
    });
  }
  const top = groupSpending(current, byMerchant).slice(0, 5);
  const topShare = top.reduce((s, g) => s + g.share, 0);
  if (top.length >= 5 && topShare > 0.6) {
    out.push({ text: `${Math.round(topShare * 100)}% of your spending went to just five suppliers: ${list(top.map((t) => t.label))}.`, tone: "neutral", link: at({ kind: "spending" }) });
  }
  const moved = c.movementCents.cardPayments + c.movementCents.transfers + c.movementCents.loanPayments;
  if (moved > 0) {
    out.push({ text: `${formatMoney(moved, currency)} moved between your own accounts or paid down cards and loans. That isn't counted as spending, so nothing is counted twice.`, tone: "neutral", link: at({ kind: "movement" }) });
  }
  return out;
}

export function recurringInsights(items: RecurringItem[], currency: string): Insight[] {
  const increased = items.filter((r) => r.priceChangeCents > 0 && (r.priceChangePct ?? 0) >= 2);
  const out: Insight[] = [];
  if (increased.length) {
    out.push({
      text: `${increased.length === 1 ? "One regular charge has" : `${increased.length} regular charges have`} gone up: ${list(increased.slice(0, 3).map((r) => `${r.merchant} (${formatMoney(r.typicalCents, currency)} → ${formatMoney(r.lastCents, currency)})`))}.`,
      tone: "warning", link: { q: increased[0].merchant },
    });
  }
  return out;
}

export function anomalyInsights(items: Anomaly[], currency: string): Insight[] {
  return items.slice(0, 3).map((a) => ({ text: `${a.reason}: ${formatMoney(a.amountCents, currency)}.`, tone: "warning" as const, href: `/transactions/${a.id}` }));
}
