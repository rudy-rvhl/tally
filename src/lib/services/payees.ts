/** Payee tracker: did I pay (or receive from) this payee every month? */
import type { Prisma, User } from "@prisma/client";
import { prisma } from "../db";
import { buildWhere, latestMonth, loadAnalytic } from "./query";
import { accountCoverage, lastNMonths } from "./options";
import { addMonths, isoDate, monthKey, monthRange } from "../engine/dates";
import { FREQUENCIES, FREQUENCY_LABEL, isFrequency, payeeMonths, type PayeeFrequency, type PayeeSummary } from "../engine/payees";

export type Direction = "out" | "in";

export async function loadPayee(user: Pick<User, "id" | "baseCurrency">, opts: { payee?: string; q?: string; dir: Direction; n: number; freq?: PayeeFrequency | null }) {
  const latest = await latestMonth(user.id);
  const months = lastNMonths(latest, opts.n);
  const sign: Prisma.TransactionWhereInput = opts.dir === "out" ? { amountCents: { lt: 0 }, kind: { not: "CARD_PAYMENT" } } : { amountCents: { gt: 0 } };
  const base = await buildWhere(user.id, { merchant: opts.payee || undefined, q: opts.q?.trim() || undefined });
  const inWindow = await buildWhere(user.id, { merchant: opts.payee || undefined, q: opts.q?.trim() || undefined, from: isoDate(monthRange(months[0]).start), to: isoDate(monthRange(latest).end) });
  const [rows, history, merchant] = await Promise.all([
    prisma.transaction.findMany({ where: { AND: [inWindow, sign] }, include: { account: { select: { id: true, name: true, institution: true } } }, orderBy: { date: "desc" } }),
    // Every payment on record: how often it's paid is judged on the whole history, not only the months shown.
    prisma.transaction.findMany({ where: { AND: [base, sign] }, select: { date: true, amountCents: true }, orderBy: { date: "asc" } }),
    opts.payee ? prisma.merchant.findFirst({ where: { id: opts.payee, userId: user.id }, select: { id: true, name: true, paymentFrequency: true } }) : null,
  ]);
  // Months with no statement for the accounts this payee is paid from (or received into): unknown, not missed.
  const accountIds = [...new Set(rows.map((r) => r.accountId))];
  const cov = accountIds.length ? (await accountCoverage(user.id, months)).filter((c) => accountIds.includes(c.accountId)) : [];
  const noStatement = new Set(months.filter((_, i) => cov.length > 0 && cov.every((c) => c.cells[i].status === "MISSING" || c.cells[i].status === "NOT_STARTED")));
  const saved = isFrequency(merchant?.paymentFrequency) ? merchant!.paymentFrequency as PayeeFrequency : null;
  const payments = history.filter((h) => h.date <= monthRange(latest).end).map((r) => ({ date: r.date, cents: Math.abs(r.amountCents) }));
  const summary: PayeeSummary = payeeMonths(payments, months, noStatement, history[0]?.date ?? null, opts.freq ?? saved);
  return { label: merchant?.name ?? opts.q?.trim() ?? "", merchantId: merchant?.id ?? null, saved, months, rows, summary };
}

/** Remember how often a payee is paid (null = detect it). */
export async function setPayeeFrequency(userId: string, merchantId: string, freq: string | null) {
  const value = freq && isFrequency(freq) ? freq : null;
  const r = await prisma.merchant.updateMany({ where: { id: merchantId, userId }, data: { paymentFrequency: value } });
  if (!r.count) throw new Error("Payee not found.");
  return value;
}

/** Payees to choose from: those with payments (or money received) in the last 2 years, most used first. */
export async function payeeOptions(userId: string, dir: Direction) {
  const since = new Date(Date.now() - 730 * 86400000);
  const grouped = await prisma.transaction.groupBy({ by: ["merchantId"], where: { userId, excluded: false, merchantId: { not: null }, date: { gte: since }, ...(dir === "out" ? { amountCents: { lt: 0 } } : { amountCents: { gt: 0 } }) }, _count: { _all: true } });
  const names = await prisma.merchant.findMany({ where: { id: { in: grouped.map((g) => g.merchantId!) } }, select: { id: true, name: true } });
  const count = new Map(grouped.map((g) => [g.merchantId!, g._count._all]));
  return names.map((m) => ({ id: m.id, name: m.name, count: count.get(m.id) ?? 0 })).sort((a, b) => a.name.localeCompare(b.name));
}

export interface PayeeOverview {
  id: string; name: string; frequency: PayeeFrequency; saved: boolean; usualCents: number | null; payments: number;
  totalCents: number; lastPaid: Date | null; missing: string[]; nextDue: string | null;
}

/**
 * Every payee of the last 12 months, sorted by how often it's paid: monthly bills, every 3 months,
 * once a year (insurance, taxes), one-time, and no fixed schedule. Two years of history are read so a
 * yearly payment is recognised; missed payments are looked for in the last 12 months.
 */
export async function payeesByType(user: Pick<User, "id" | "baseCurrency">, dir: Direction) {
  const latest = await latestMonth(user.id);
  const months = lastNMonths(latest, 12);
  const { txns } = await loadAnalytic(user, { from: isoDate(monthRange(addMonths(latest, -35)).start), to: isoDate(monthRange(latest).end) });
  const groups = new Map<string, { name: string; pays: { date: Date; cents: number }[]; accounts: Set<string> }>();
  for (const t of txns) {
    if (!t.merchantId || (dir === "out" ? t.amountCents >= 0 || t.kind === "CARD_PAYMENT" : t.amountCents <= 0)) continue;
    const g = groups.get(t.merchantId) ?? { name: t.merchant ?? "", pays: [], accounts: new Set<string>() };
    g.pays.push({ date: t.date, cents: Math.abs(t.amountCents) });
    g.accounts.add(t.accountId);
    groups.set(t.merchantId, g);
  }
  // A month with no statement for the accounts a payee is paid from is unknown, not missed.
  const cov = new Map((await accountCoverage(user.id, months)).map((c) => [c.accountId, c.cells]));
  const unknownMonths = (accounts: Set<string>) => {
    const cells = [...accounts].map((a) => cov.get(a)).filter((c) => !!c);
    return new Set(months.filter((_, i) => cells.length > 0 && cells.every((c) => c[i].status === "MISSING" || c[i].status === "NOT_STARTED")));
  };
  const savedFreq = new Map((await prisma.merchant.findMany({ where: { userId: user.id, id: { in: [...groups.keys()] }, paymentFrequency: { not: null } }, select: { id: true, paymentFrequency: true } }))
    .map((m) => [m.id, m.paymentFrequency]));
  const byType = Object.fromEntries(FREQUENCIES.map((f) => [f, [] as PayeeOverview[]])) as Record<PayeeFrequency, PayeeOverview[]>;
  const start = months[0];
  for (const [id, g] of groups) {
    const lastPaid = g.pays.reduce((a, p) => (p.date > a ? p.date : a), g.pays[0].date);
    const saved = savedFreq.get(id);
    const first = g.pays.reduce((a, p) => (p.date < a ? p.date : a), g.pays[0].date);
    const s = payeeMonths(g.pays, months, unknownMonths(g.accounts), first, isFrequency(saved) ? saved : null);
    // Nothing paid in the last 12 months: listed only if it's a recurring payment that stopped lately
    // (a yearly premium not renewed); older ones and finished one-off jobs are left out.
    if (monthKey(lastPaid) < start && (!FREQUENCY_LABEL[s.frequency].recurring || monthKey(lastPaid) < addMonths(start, -(s.frequency === "YEARLY" ? 3 : 2)))) continue;
    byType[s.frequency].push({ id, name: g.name, frequency: s.frequency, saved: isFrequency(saved), usualCents: s.usualCents, payments: s.payments,
      totalCents: s.totalCents, lastPaid: s.lastPaid, missing: s.missing, nextDue: s.nextDue });
  }
  for (const f of FREQUENCIES) byType[f].sort((a, b) => b.missing.length - a.missing.length || (f === "ONE_TIME" || f === "IRREGULAR" ? b.totalCents - a.totalCents : (b.usualCents ?? 0) - (a.usualCents ?? 0)));
  const missed = FREQUENCIES.flatMap((f) => byType[f]).filter((p) => p.missing.length);
  return { byType, missed };
}
