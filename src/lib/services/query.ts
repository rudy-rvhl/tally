/**
 * The single query layer behind every total, chart and table. Pages never sum
 * money themselves from ad-hoc queries; they call loadAnalytic() with the same
 * filters that the "see transactions" links carry, so a number and its drill-down
 * always come from the same rows.
 */
import type { Prisma, TxnKind, User } from "@prisma/client";
import { prisma } from "../db";
import type { Filters } from "../filters";
import { monthKey, monthRange } from "../engine/dates";
import type { AnalyticTxn } from "../engine/types";

export const SPEND_KINDS: TxnKind[] = ["PURCHASE", "FEE", "INTEREST", "REFUND", "REVERSAL"];
export const MOVE_KINDS: TxnKind[] = ["TRANSFER", "CARD_PAYMENT", "LOAN_PAYMENT"];

export function dateBounds(f: Filters): { gte?: Date; lte?: Date } {
  if (f.month && /^\d{4}-\d{2}$/.test(f.month)) {
    const r = monthRange(f.month);
    return { gte: r.start, lte: r.end };
  }
  const out: { gte?: Date; lte?: Date } = {};
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) out.gte = new Date(`${f.from}T00:00:00Z`);
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) out.lte = new Date(`${f.to}T00:00:00Z`);
  return out;
}

async function categoryIdsIncludingChildren(userId: string, id: string): Promise<string[]> {
  const kids = await prisma.category.findMany({ where: { userId, parentId: id }, select: { id: true } });
  return [id, ...kids.map((k) => k.id)];
}

export async function buildWhere(userId: string, f: Filters, opts: { includeExcluded?: boolean } = {}): Promise<Prisma.TransactionWhereInput> {
  const where: Prisma.TransactionWhereInput = { userId };
  if (!opts.includeExcluded) where.excluded = false;
  const d = dateBounds(f);
  if (d.gte || d.lte) where.date = d;
  const account: Prisma.AccountWhereInput = {};
  if (f.account) where.accountId = f.account;
  if (f.accountType) account.type = f.accountType as Prisma.EnumAccountTypeFilter["equals"];
  if (f.institution) account.institution = f.institution;
  if (f.ownership === "PERSONAL" || f.ownership === "BUSINESS") account.ownership = f.ownership;
  if (Object.keys(account).length) where.account = account;
  if (f.currency) where.currency = f.currency;
  if (f.merchant) where.merchantId = f.merchant === "none" ? null : f.merchant;
  if (f.category) {
    const ids = await categoryIdsIncludingChildren(userId, f.category);
    where.OR = [{ categoryId: { in: ids } }, { splits: { some: { categoryId: { in: ids } } } }];
  }
  if (f.kind === "spending") where.kind = { in: SPEND_KINDS };
  else if (f.kind === "income") where.kind = "INCOME";
  else if (f.kind === "movement") where.kind = { in: MOVE_KINDS };
  else if (f.kind) where.kind = f.kind as TxnKind;
  if (f.q) {
    const q = f.q.trim();
    const textMatch: Prisma.TransactionWhereInput[] = [
      { description: { contains: q, mode: "insensitive" } },
      { originalDescription: { contains: q, mode: "insensitive" } },
      { merchant: { name: { contains: q, mode: "insensitive" } } },
      { notes: { contains: q, mode: "insensitive" } },
    ];
    where.AND = [...((where.AND as Prisma.TransactionWhereInput[]) ?? []), { OR: textMatch }];
  }
  if (f.review === "open") {
    const items = await prisma.reviewItem.findMany({ where: { userId, status: "OPEN", txnId: { not: null } }, select: { txnId: true } });
    where.id = { in: items.map((i) => i.txnId!) };
  }
  return where;
}

export const txnInclude = {
  account: { select: { id: true, name: true, institution: true, type: true, currency: true, mask: true, ownership: true } },
  merchant: { select: { id: true, name: true } },
  category: { select: { id: true, name: true, parent: { select: { id: true, name: true } } } },
  splits: { include: { category: { select: { id: true, name: true, parent: { select: { id: true, name: true } } } } } },
} satisfies Prisma.TransactionInclude;

export type TxnRow = Prisma.TransactionGetPayload<{ include: typeof txnInclude }>;

export interface ConversionReport {
  baseCurrency: string;
  /** Transactions left out of totals because no exchange rate exists for their month. */
  missing: { currency: string; month: string; count: number }[];
  converted: { currency: string; month: string; rate: number; count: number }[];
}

async function rateTable(userId: string) {
  const rates = await prisma.exchangeRate.findMany({ where: { userId } });
  return new Map(rates.map((r) => [`${r.currency}|${r.month}`, r.rate]));
}

function catNames(c: TxnRow["category"]): { category: string | null; subcategory: string | null } {
  if (!c) return { category: null, subcategory: null };
  return c.parent ? { category: c.parent.name, subcategory: c.name } : { category: c.name, subcategory: null };
}

/**
 * Load filtered transactions as analytics rows in the user's base currency.
 * Foreign-currency rows are converted only with an explicit user-entered rate;
 * otherwise they are left out of totals and reported in `conversion.missing`.
 */
export async function loadAnalytic(user: Pick<User, "id" | "baseCurrency">, f: Filters): Promise<{ txns: AnalyticTxn[]; conversion: ConversionReport }> {
  const where = await buildWhere(user.id, f);
  const rows = await prisma.transaction.findMany({ where, include: txnInclude, orderBy: { date: "asc" } });
  const rates = await rateTable(user.id);
  const missing = new Map<string, number>();
  const converted = new Map<string, { rate: number; count: number }>();
  const out: AnalyticTxn[] = [];
  const catFilter = f.category ? new Set(await categoryIdsIncludingChildren(user.id, f.category)) : null;
  for (const t of rows) {
    let rate = 1;
    if (t.currency !== user.baseCurrency) {
      const mk = `${t.currency}|${monthKey(t.date)}`;
      const r = rates.get(mk);
      if (!r) { missing.set(mk, (missing.get(mk) ?? 0) + 1); continue; }
      rate = r;
      const c = converted.get(mk) ?? { rate: r, count: 0 };
      c.count++; converted.set(mk, c);
    }
    const base = {
      id: t.id, date: t.date, kind: t.kind, accountId: t.accountId, merchant: t.merchant?.name ?? null,
      merchantId: t.merchantId, pending: t.status === "PENDING",
    };
    if (t.splits.length) {
      for (const s of t.splits) {
        if (catFilter && !catFilter.has(s.categoryId)) continue;
        out.push({ ...base, amountCents: Math.round(s.amountCents * rate), categoryId: s.categoryId, ...catNames(s.category as TxnRow["category"]) });
      }
    } else {
      out.push({ ...base, amountCents: Math.round(t.amountCents * rate), categoryId: t.categoryId, ...catNames(t.category) });
    }
  }
  return {
    txns: out,
    conversion: {
      baseCurrency: user.baseCurrency,
      missing: [...missing].map(([k, count]) => ({ currency: k.split("|")[0], month: k.split("|")[1], count })),
      converted: [...converted].map(([k, v]) => ({ currency: k.split("|")[0], month: k.split("|")[1], ...v })),
    },
  };
}

/** Most recent month with any transaction, or the current month. */
export async function latestMonth(userId: string): Promise<string> {
  const t = await prisma.transaction.findFirst({ where: { userId, excluded: false }, orderBy: { date: "desc" }, select: { date: true } });
  return monthKey(t?.date ?? new Date());
}

export async function dataRange(userId: string): Promise<{ first: string; last: string } | null> {
  const [a, b] = await Promise.all([
    prisma.transaction.findFirst({ where: { userId, excluded: false }, orderBy: { date: "asc" }, select: { date: true } }),
    prisma.transaction.findFirst({ where: { userId, excluded: false }, orderBy: { date: "desc" }, select: { date: true } }),
  ]);
  if (!a || !b) return null;
  return { first: monthKey(a.date), last: monthKey(b.date) };
}
