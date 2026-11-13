/** Payee tracker: did I pay (or receive from) this payee every month? */
import type { Prisma, User } from "@prisma/client";
import { prisma } from "../db";
import { buildWhere, latestMonth, loadAnalytic } from "./query";
import { accountCoverage, lastNMonths } from "./options";
import { isoDate, monthKey, monthRange } from "../engine/dates";
import { payeeMonths, type PayeeSummary } from "../engine/payees";

export type Direction = "out" | "in";

export async function loadPayee(user: Pick<User, "id" | "baseCurrency">, opts: { payee?: string; q?: string; dir: Direction; n: number }) {
  const latest = await latestMonth(user.id);
  const months = lastNMonths(latest, opts.n);
  const sign: Prisma.TransactionWhereInput = opts.dir === "out" ? { amountCents: { lt: 0 }, kind: { not: "CARD_PAYMENT" } } : { amountCents: { gt: 0 } };
  const base = await buildWhere(user.id, { merchant: opts.payee || undefined, q: opts.q?.trim() || undefined });
  const inWindow = await buildWhere(user.id, { merchant: opts.payee || undefined, q: opts.q?.trim() || undefined, from: isoDate(monthRange(months[0]).start), to: isoDate(monthRange(latest).end) });
  const [rows, first, merchant] = await Promise.all([
    prisma.transaction.findMany({ where: { AND: [inWindow, sign] }, include: { account: { select: { id: true, name: true, institution: true } } }, orderBy: { date: "desc" } }),
    prisma.transaction.findFirst({ where: { AND: [base, sign] }, orderBy: { date: "asc" }, select: { date: true } }),
    opts.payee ? prisma.merchant.findFirst({ where: { id: opts.payee, userId: user.id }, select: { name: true } }) : null,
  ]);
  // Months with no statement for the accounts this payee is paid from (or received into): unknown, not missed.
  const accountIds = [...new Set(rows.map((r) => r.accountId))];
  const cov = accountIds.length ? (await accountCoverage(user.id, months)).filter((c) => accountIds.includes(c.accountId)) : [];
  const noStatement = new Set(months.filter((_, i) => cov.length > 0 && cov.every((c) => c.cells[i].status === "MISSING" || c.cells[i].status === "NOT_STARTED")));
  const summary: PayeeSummary = payeeMonths(rows.map((r) => ({ date: r.date, cents: Math.abs(r.amountCents) })), months, noStatement, first?.date ?? null);
  return { label: merchant?.name ?? opts.q?.trim() ?? "", months, rows, summary };
}

/** Payees to choose from: those with payments (or money received) in the last 2 years, most used first. */
export async function payeeOptions(userId: string, dir: Direction) {
  const since = new Date(Date.now() - 730 * 86400000);
  const grouped = await prisma.transaction.groupBy({ by: ["merchantId"], where: { userId, excluded: false, merchantId: { not: null }, date: { gte: since }, ...(dir === "out" ? { amountCents: { lt: 0 } } : { amountCents: { gt: 0 } }) }, _count: { _all: true } });
  const names = await prisma.merchant.findMany({ where: { id: { in: grouped.map((g) => g.merchantId!) } }, select: { id: true, name: true } });
  const count = new Map(grouped.map((g) => [g.merchantId!, g._count._all]));
  return names.map((m) => ({ id: m.id, name: m.name, count: count.get(m.id) ?? 0 })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Regular payees (paid in at least 3 of the last 12 months) with a month missed since they started. */
export async function payeesWithGaps(user: Pick<User, "id" | "baseCurrency">, dir: Direction) {
  const latest = await latestMonth(user.id);
  const months = lastNMonths(latest, 12);
  const { txns } = await loadAnalytic(user, { from: isoDate(monthRange(months[0]).start), to: isoDate(monthRange(latest).end) });
  const groups = new Map<string, { name: string; pays: { date: Date; cents: number }[] }>();
  for (const t of txns) {
    if (!t.merchantId || (dir === "out" ? t.amountCents >= 0 || t.kind === "CARD_PAYMENT" : t.amountCents <= 0)) continue;
    const g = groups.get(t.merchantId) ?? { name: t.merchant ?? "", pays: [] };
    g.pays.push({ date: t.date, cents: Math.abs(t.amountCents) });
    groups.set(t.merchantId, g);
  }
  const out: { id: string; name: string; missing: string[]; usualCents: number | null; paidMonths: number }[] = [];
  for (const [id, g] of groups) {
    const paidMonths = new Set(g.pays.map((p) => monthKey(p.date))).size;
    if (paidMonths < 3) continue;
    const first = g.pays.reduce((a, p) => (p.date < a ? p.date : a), g.pays[0].date);
    const s = payeeMonths(g.pays, months, new Set(), first);
    if (s.missing.length) out.push({ id, name: g.name, missing: s.missing, usualCents: s.usualCents, paidMonths });
  }
  return out.sort((a, b) => b.missing.length - a.missing.length || (b.usualCents ?? 0) - (a.usualCents ?? 0)).slice(0, 12);
}
