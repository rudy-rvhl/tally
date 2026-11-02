import { prisma } from "../db";
import { reconcile } from "../engine/reconcile";
import { formatMoney } from "../engine/money";
import { formatDate } from "../engine/dates";
import { audit } from "./audit";

export async function statementResult(userId: string, statementId: string) {
  const st = await prisma.statement.findFirst({ where: { id: statementId, account: { userId } }, include: { account: true } });
  if (!st) throw new Error("Statement not found.");
  const txns = await prisma.transaction.findMany({
    where: { accountId: st.accountId, date: { gte: st.periodStart, lte: st.periodEnd } },
    select: { id: true, amountCents: true, description: true, date: true, status: true, excluded: true },
  });
  const r = reconcile(st.account.type, st.openingBalanceCents, st.closingBalanceCents,
    txns.map((t) => ({ ...t, pending: t.status === "PENDING" })));
  return { statement: st, result: r };
}

/** Recompute a statement's status and open/close its review item. */
export async function evaluateStatement(userId: string, statementId: string) {
  const { statement: st, result: r } = await statementResult(userId, statementId);
  await prisma.statement.update({
    where: { id: st.id },
    data: { status: r.balanced ? "BALANCED" : "DIFFERENCE", differenceCents: r.differenceCents, reconciledAt: r.balanced ? new Date() : null },
  });
  const open = await prisma.reviewItem.findFirst({ where: { userId, type: "RECONCILIATION", statementId: st.id, status: "OPEN" } });
  if (r.balanced && open) {
    await prisma.reviewItem.update({ where: { id: open.id }, data: { status: "RESOLVED", resolution: "Statement balances", resolvedAt: new Date() } });
  } else if (!r.balanced && !open) {
    await prisma.reviewItem.create({
      data: {
        userId, type: "RECONCILIATION", statementId: st.id,
        message: `${st.account.name}: the ${formatDate(st.periodStart)} – ${formatDate(st.periodEnd)} statement is off by ${formatMoney(Math.abs(r.differenceCents), st.account.currency)}. ${r.hints[0] ?? ""}`,
      },
    });
  }
  return r;
}

/** Accountant action: book a balance correction so a statement reconciles. Fully audited. */
export async function addAdjustment(userId: string, statementId: string, memo: string) {
  const { statement: st, result: r } = await statementResult(userId, statementId);
  if (r.balanced) return null;
  // For liabilities, a positive difference (more owed than calculated) means a missing charge (money out).
  const amount = r.liability ? -r.differenceCents : r.differenceCents;
  const fp = `adj:${st.id}:${Date.now()}`;
  const cat = await prisma.category.findFirst({ where: { userId, name: "Balance corrections" } });
  const t = await prisma.transaction.create({
    data: {
      userId, accountId: st.accountId, date: st.periodEnd, amountCents: amount, currency: st.account.currency,
      originalDescription: `Reconciliation adjustment: ${memo}`, description: `Balance correction: ${memo}`, fingerprint: fp,
      kind: "ADJUSTMENT", kindConfirmed: true, categoryId: cat?.id, categorySource: "USER", categoryConfirmed: true, categoryConfidence: 1,
    },
  });
  await audit(prisma, userId, "Transaction", t.id, "reconciliation.adjustment", undefined, { statementId, amountCents: amount, memo });
  await evaluateStatement(userId, statementId);
  return t;
}
