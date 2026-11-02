import type { Account } from "@prisma/client";
import { prisma } from "../db";
import { isLiability } from "../engine/classify";

export interface Balance { cents: number; asOf: Date; basis: string; owed: boolean }

/**
 * Best-known balance: start from the latest statement closing balance (or the
 * opening balance the user entered) and apply posted transactions after it.
 * Liabilities are shown as the amount owed.
 */
export async function accountBalance(a: Account): Promise<Balance | null> {
  const st = await prisma.statement.findFirst({ where: { accountId: a.id }, orderBy: { periodEnd: "desc" } });
  let start: { cents: number; date: Date; basis: string } | null = null;
  if (st) start = { cents: st.closingBalanceCents, date: st.periodEnd, basis: "statement" };
  else if (a.openingBalanceCents !== null && a.openingBalanceDate) start = { cents: a.openingBalanceCents, date: new Date(a.openingBalanceDate.getTime() - 86400000), basis: "opening balance" };
  if (!start) return null;
  const after = await prisma.transaction.aggregate({ where: { accountId: a.id, excluded: false, status: "POSTED", date: { gt: start.date } }, _sum: { amountCents: true }, _max: { date: true } });
  const delta = after._sum.amountCents ?? 0;
  const owed = isLiability(a.type);
  return { cents: owed ? start.cents - delta : start.cents + delta, asOf: after._max.date ?? start.date, basis: start.basis, owed };
}
