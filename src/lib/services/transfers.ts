/**
 * Link money moving between the user's own accounts.
 * - Both sides already look like transfers/card payments: link automatically
 *   (no amounts or types change; the link is audited and can be undone).
 * - One side looks like ordinary income/spending: ask the user first.
 * - A card payment with no matching side: explain that a statement may be missing.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import { matchTransfers } from "../engine/transfers";
import { formatMoney } from "../engine/money";
import { formatDate } from "../engine/dates";
import { audit } from "./audit";
import { MOVE_KINDS } from "./query";

export async function linkTransfers(userId: string): Promise<number> {
  const txns = await prisma.transaction.findMany({
    where: { userId, excluded: false, transferGroupId: null },
    select: { id: true, accountId: true, date: true, amountCents: true, currency: true, kind: true, description: true, account: { select: { name: true } } },
  });
  const pairs = matchTransfers(txns);
  const byId = new Map(txns.map((t) => [t.id, t]));
  let linked = 0;
  const pairedIds = new Set<string>();
  for (const p of pairs) {
    const o = byId.get(p.outId)!, i = byId.get(p.inId)!;
    pairedIds.add(o.id); pairedIds.add(i.id);
    const bothMovement = MOVE_KINDS.includes(o.kind) && MOVE_KINDS.includes(i.kind);
    if (bothMovement) {
      const group = randomUUID();
      await prisma.transaction.updateMany({ where: { id: { in: [o.id, i.id] }, userId }, data: { transferGroupId: group } });
      await audit(prisma, userId, "Transaction", o.id, "transfer.link", undefined, { transferGroupId: group, with: i.id, confidence: p.confidence });
      await prisma.reviewItem.updateMany({ where: { userId, status: "OPEN", type: "TRANSFER", txnId: { in: [o.id, i.id] } }, data: { status: "RESOLVED", resolution: "Matching transfer found automatically", resolvedAt: new Date() } });
      linked++;
    } else {
      const exists = await prisma.reviewItem.findFirst({ where: { userId, type: "TRANSFER", txnId: o.id, relatedTxnId: i.id } });
      if (!exists) await prisma.reviewItem.create({
        data: {
          userId, type: "TRANSFER", txnId: o.id, relatedTxnId: i.id,
          message: `${formatMoney(-o.amountCents, o.currency)} left ${o.account.name} on ${formatDate(o.date)} and the same amount arrived in ${i.account.name}. Is this money moving between your own accounts? If so, it won't be counted as spending or income.`,
        },
      });
    }
  }
  // Card payments / transfers with no counterpart.
  const lonely = txns.filter((t) => !pairedIds.has(t.id) && (t.kind === "CARD_PAYMENT" || t.kind === "TRANSFER"));
  for (const t of lonely) {
    const exists = await prisma.reviewItem.findFirst({ where: { userId, type: "TRANSFER", txnId: t.id } });
    if (exists) continue;
    const what = t.kind === "CARD_PAYMENT" ? "credit card payment" : "transfer";
    await prisma.reviewItem.create({
      data: {
        userId, type: "TRANSFER", txnId: t.id,
        message: t.amountCents < 0
          ? `We found a ${formatMoney(-t.amountCents, t.currency)} ${what} from ${t.account.name} on ${formatDate(t.date)}, but not where it arrived. If it went to an account you track, import that account's statement and we'll link them. Either way, it isn't counted as spending.`
          : `${formatMoney(t.amountCents, t.currency)} arrived in ${t.account.name} on ${formatDate(t.date)} as a ${what}, but we can't see where it came from. Import the other account's statement to link them, or mark it as income if it was money received.`,
      },
    });
  }
  return linked;
}

export async function unlinkTransfer(userId: string, groupId: string) {
  const txns = await prisma.transaction.findMany({ where: { userId, transferGroupId: groupId }, select: { id: true } });
  await prisma.transaction.updateMany({ where: { userId, transferGroupId: groupId }, data: { transferGroupId: null } });
  for (const t of txns) await audit(prisma, userId, "Transaction", t.id, "transfer.unlink", { transferGroupId: groupId }, { transferGroupId: null });
}
