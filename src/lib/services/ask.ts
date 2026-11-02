/** Answer questions with verified database queries. */
import type { User } from "@prisma/client";
import { prisma } from "../db";
import { parseQuestion, type AskEntities, type QuerySpec } from "../engine/ask";
import { byCategory, byMerchant, compareGroups, detectRecurring, groupSpending, spendOf, summarize } from "../engine/analytics";
import { formatMoney, formatPct, pctChange } from "../engine/money";
import { isoDate } from "../engine/dates";
import type { Filters } from "../filters";
import { loadAnalytic } from "./query";
import { aiEnabled, interpretWithAI } from "./ai";

export interface AnswerRow { label: string; amountCents: number; secondaryCents?: number; changePct?: number | null; link: Partial<Filters>; href?: string; sub?: string }
export interface Answer {
  headline: string;
  explanation: string[];
  rows: AnswerRow[];
  rowsTitle?: string;
  /** Filters that reproduce exactly the transactions behind the answer. */
  sourceFilters: Partial<Filters>;
  compareFilters?: Partial<Filters>;
  understood: string;
  interpretedBy: "rules" | "ai";
  warnings: string[];
}

export async function loadEntities(userId: string): Promise<AskEntities> {
  const [merchants, categories, accounts] = await Promise.all([
    prisma.merchant.findMany({ where: { userId }, select: { id: true, name: true } }),
    prisma.category.findMany({ where: { userId }, select: { id: true, name: true, parent: { select: { name: true } } } }),
    prisma.account.findMany({ where: { userId }, select: { id: true, name: true, institution: true, type: true, mask: true } }),
  ]);
  return { merchants, categories: categories.map((c) => ({ id: c.id, name: c.name, parent: c.parent?.name ?? null })), accounts };
}

function describe(spec: QuerySpec, e: AskEntities): string {
  const parts: string[] = [spec.flow === "income" ? "Money received" : "Spending"];
  const names = (ids: string[], pool: { id: string; name: string }[]) => ids.map((id) => pool.find((p) => p.id === id)?.name).filter(Boolean).join(" or ");
  if (spec.merchantIds.length) parts.push(`at ${names(spec.merchantIds, e.merchants)}`);
  if (spec.categoryIds.length) parts.push(`on ${names(spec.categoryIds, e.categories)}`);
  if (spec.accountIds.length) parts.push(`using ${e.accounts.filter((a) => spec.accountIds.includes(a.id)).map((a) => `${a.institution} ${a.name}`).join(" or ")}`);
  parts.push(spec.rangeLabel);
  if (spec.compareLabel) parts.push(`compared with ${spec.compareLabel}`);
  return parts.join(" ");
}

export async function answerQuestion(user: User, question: string, today = new Date()): Promise<Answer> {
  const entities = await loadEntities(user.id);
  let spec = parseQuestion(question, entities, today);
  let interpretedBy: "rules" | "ai" = "rules";
  const ruleFoundSomething = spec.merchantIds.length + spec.categoryIds.length + spec.accountIds.length > 0 || spec.intent !== "total";
  if (aiEnabled() && !ruleFoundSomething) {
    const ai = await interpretWithAI(question, entities, isoDate(today));
    if (ai) { spec = ai; interpretedBy = "ai"; }
  }
  const currency = user.baseCurrency;
  const topCat = (name: string) => entities.categories.find((c) => c.name === name && c.parent === null)?.id;
  // Multiple merchants/categories/accounts: the filter model holds one of each, so we take the first and say so.
  const warnings: string[] = [];
  if (spec.merchantIds.length > 1 || spec.categoryIds.length > 1 || spec.accountIds.length > 1)
    warnings.push("Your question matched more than one supplier, category or account. We used the first match. Refine the filters on the transactions page to adjust.");
  const filters: Partial<Filters> = {
    from: spec.from, to: spec.to,
    merchant: spec.merchantIds[0], category: spec.categoryIds[0], account: spec.accountIds[0],
    kind: spec.flow === "income" ? "income" : spec.flow === "spending" ? "spending" : undefined,
  };
  const { txns, conversion } = await loadAnalytic(user, filters);
  for (const m of conversion.missing) warnings.push(`${m.count} ${m.currency} transaction(s) from ${m.month} aren't included because there's no exchange rate for that month. Add one in Settings.`);
  const s = summarize(txns);
  const understood = describe(spec, entities);
  const base = { understood, interpretedBy, warnings, sourceFilters: filters } as const;
  const total = spec.flow === "income" ? s.incomeCents : s.spendingCents;

  switch (spec.intent) {
    case "compare": {
      const cf: Partial<Filters> = { ...filters, from: spec.compareFrom ?? undefined, to: spec.compareTo ?? undefined };
      const prev = await loadAnalytic(user, cf);
      const p = summarize(prev.txns);
      const cur = spec.flow === "income" ? s.incomeCents : s.spendingCents;
      const old = spec.flow === "income" ? p.incomeCents : p.spendingCents;
      const rows = compareGroups(groupSpending(txns, byCategory), groupSpending(prev.txns, byCategory)).slice(0, 10).map((r) => ({
        label: r.label, amountCents: r.currentCents, secondaryCents: r.previousCents, changePct: r.changePct,
        link: { ...filters, category: topCat(r.key) }, sub: `${formatMoney(r.changeCents, currency, { signed: true })}`,
      }));
      const verb = cur >= old ? "more" : "less";
      return {
        ...base, compareFilters: cf, rows, rowsTitle: `By category: ${spec.rangeLabel} vs ${spec.compareLabel}`,
        headline: `${formatMoney(cur, currency)} ${spec.rangeLabel} vs ${formatMoney(old, currency)} ${spec.compareLabel}`,
        explanation: [`That's ${formatMoney(Math.abs(cur - old), currency)} ${verb} (${formatPct(pctChange(cur, old))}).`],
      };
    }
    case "top": {
      const items = txns.filter((t) => t.kind === "PURCHASE").sort((a, b) => a.amountCents - b.amountCents).slice(0, spec.limit ?? 5);
      return {
        ...base, rowsTitle: `Largest purchases ${spec.rangeLabel}`,
        headline: items.length ? `Your ${items.length} largest purchases ${spec.rangeLabel} add up to ${formatMoney(items.reduce((a, t) => a + spendOf(t), 0), currency)}` : `No purchases found ${spec.rangeLabel}.`,
        explanation: [], rows: items.map((t) => ({ label: t.merchant ?? "Unknown supplier", sub: `${isoDate(t.date)} · ${t.subcategory ?? t.category ?? "Uncategorized"}`, amountCents: spendOf(t), link: {}, href: `/transactions/${t.id}` })),
      };
    }
    case "price_increases": {
      const all = await loadAnalytic(user, { ...filters, from: undefined, to: spec.to, kind: undefined });
      const rec = detectRecurring(all.txns).filter((r) => r.priceChangeCents > 0 && (r.priceChangePct ?? 0) >= 2);
      return {
        ...base, rowsTitle: "Regular charges that went up",
        headline: rec.length ? `${rec.length} regular charge${rec.length > 1 ? "s" : ""} went up in price` : "We didn't find any regular charges that went up in price.",
        explanation: rec.length ? [] : ["We look for suppliers that charge you about the same amount every month, and flag when the latest charge is higher."],
        rows: rec.map((r) => ({ label: r.merchant, amountCents: r.lastCents, secondaryCents: r.typicalCents, changePct: r.priceChangePct, sub: `was ${formatMoney(r.typicalCents, currency)}, now ${formatMoney(r.lastCents, currency)}`, link: r.merchantKey.startsWith("name:") ? { q: r.merchant } : { merchant: r.merchantKey } })),
      };
    }
    case "count":
      return { ...base, rows: [], headline: `${s.purchaseCount} purchase${s.purchaseCount === 1 ? "" : "s"} ${spec.rangeLabel}`, explanation: [`Total: ${formatMoney(s.spendingCents, currency)}.`] };
    case "by_category":
    case "by_supplier":
    case "list":
    case "total":
    default: {
      const groups = spec.intent === "by_category" || (spec.merchantIds.length && !spec.categoryIds.length) ? groupSpending(txns, byCategory) : groupSpending(txns, byMerchant);
      const isCat = spec.intent === "by_category" || (spec.merchantIds.length > 0 && !spec.categoryIds.length);
      const explanation: string[] = [];
      if (spec.flow !== "income") {
        explanation.push(`${s.purchaseCount} purchase${s.purchaseCount === 1 ? "" : "s"}${s.refundsCents ? `, minus ${formatMoney(s.refundsCents, currency)} in refunds` : ""}.`);
        if (s.accountCount > 1) explanation.push(`Across ${s.accountCount} accounts.`);
      }
      return {
        ...base,
        headline: spec.flow === "income" ? `You received ${formatMoney(total, currency)} ${spec.rangeLabel}` : `You spent ${formatMoney(total, currency)} ${spec.rangeLabel}`,
        explanation, rowsTitle: isCat ? "By category" : "By supplier",
        rows: spec.flow === "income" ? [] : groups.slice(0, 8).map((g) => ({
          label: g.label, amountCents: g.spendCents, sub: `${g.count} purchase${g.count === 1 ? "" : "s"}`,
          link: isCat ? { ...filters, category: topCat(g.key) } : g.key.startsWith("name:") ? { ...filters, q: g.label } : { ...filters, merchant: g.key },
        })),
      };
    }
  }
}
