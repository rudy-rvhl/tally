/**
 * One-time repair of statements imported with an older PDF reader that took balance lines
 * ("REPORT", "Balance forward", …) for money in or out. Runs at server start; does nothing once repaired.
 *
 * For each affected import, the original statement file (stored encrypted) is read again with the
 * current reader, then:
 *  - balance lines are excluded from totals (kept and restorable, never deleted),
 *  - transactions whose money-in/out direction was read wrongly are corrected,
 *  - the statement's opening and closing balances are saved so it can be reconciled.
 * Every change is written to the audit log and explained in Review.
 */
import { prisma } from "../db";
import { decrypt } from "../crypto";
import { log } from "../log";
import { parseStatement } from "../engine/parsers";
import { isBalanceLine } from "../engine/parsers/pdf";
import { fingerprints } from "../engine/dedupe";
import { isoDate } from "../engine/dates";
import { classify, loadClassifierContext } from "./classifier";
import { audit } from "./audit";
import { evaluateStatement } from "./reconciliation";

const REASON = "Balance line on the statement, not a transaction (corrected automatically)";

export async function repairBalanceRows(): Promise<{ batches: number; excluded: number; flipped: number; statements: number }> {
  const total = { batches: 0, excluded: 0, flipped: 0, statements: 0 };
  // Cheap trigger: imported rows that are only a balance label and still count in totals.
  const suspects = await prisma.transaction.findMany({
    where: { excluded: false, importBatchId: { not: null }, OR: [{ originalDescription: { contains: "balance", mode: "insensitive" } }, { originalDescription: { contains: "solde", mode: "insensitive" } }, { originalDescription: { contains: "report", mode: "insensitive" } }] },
    select: { id: true, importBatchId: true, originalDescription: true },
  });
  const batchIds = [...new Set(suspects.filter((t) => isBalanceLine(t.originalDescription)).map((t) => t.importBatchId!))];
  for (const batchId of batchIds) {
    try {
      const r = await repairBatch(batchId);
      total.batches++; total.excluded += r.excluded; total.flipped += r.flipped; total.statements += r.statement ? 1 : 0;
    } catch (e) {
      log("warn", "repair.batch.failed", { batchId, error: (e as Error).message.slice(0, 300) });
    }
  }
  if (total.batches) {
    log("info", "repair.balance_rows", total);
    console.log(`\n  LedgerIQ corrected ${total.batches} imported statement(s): ${total.excluded} balance line(s) no longer counted as money, ${total.flipped} transaction(s) corrected (money in/out or type), ${total.statements} statement balance(s) added. Details are in Review.\n`);
  }
  return total;
}

async function repairBatch(batchId: string) {
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId }, omit: { encryptedFile: false }, include: { account: true, statements: { select: { id: true } } } });
  const { userId, account } = batch;
  const rows = await prisma.transaction.findMany({ where: { importBatchId: batchId, excluded: false } });
  let excluded = 0, flipped = 0, statement: string | null = null;

  // 1. Balance lines: excluded, not deleted.
  for (const t of rows.filter((x) => isBalanceLine(x.originalDescription))) {
    await prisma.$transaction(async (db) => {
      await db.transaction.update({ where: { id: t.id }, data: { excluded: true, excludedReason: REASON } });
      await db.reviewItem.updateMany({ where: { txnId: t.id, status: "OPEN" }, data: { status: "RESOLVED", resolution: "Balance line excluded", resolvedAt: new Date() } });
      await audit(db, userId, "Transaction", t.id, "repair.exclude_balance_line", { excluded: false, amountCents: t.amountCents }, { excluded: true, reason: REASON });
      await db.reviewItem.create({ data: { userId, type: "RECONCILIATION", txnId: t.id, message: `"${t.originalDescription}" (${isoDate(t.date)}, ${account.name}) was the statement's balance, not money in or out. It no longer counts in your totals. Nothing was deleted: you can restore it from the transaction's page.` } });
    });
    excluded++;
  }

  // 2. Read the original file again with the current reader.
  if (!batch.encryptedFile) return { excluded, flipped, statement };
  const parsed = await parseStatement(batch.fileName, decrypt(batch.encryptedFile), account.type);
  const fps = fingerprints(parsed.transactions);
  const kept = rows.filter((x) => !isBalanceLine(x.originalDescription));
  const ctx = await loadClassifierContext(userId);
  const used = new Set<number>();
  for (const t of kept) {
    const day = isoDate(t.date);
    const same = parsed.transactions.map((p, i) => ({ p, i })).filter(({ p, i }) => !used.has(i) && isoDate(p.date) === day && Math.abs(p.amountCents) === Math.abs(t.amountCents));
    const match = same.find(({ p }) => p.description === t.originalDescription) ?? (same.length === 1 ? same[0] : undefined);
    if (!match) continue;
    used.add(match.i);
    if (match.p.amountCents === t.amountCents) {
      // Direction was right; check the type again with the current rules (e.g. wires are money movement).
      const c = classify(ctx, t.description, t.amountCents, account.type, account.id);
      if (!t.kindConfirmed && c.kind !== t.kind) {
        await prisma.$transaction(async (db) => {
          await db.transaction.update({ where: { id: t.id }, data: { kind: c.kind, ...(t.categoryConfirmed ? {} : { categoryId: c.category.categoryId, categorySource: c.category.source, categoryConfidence: c.category.confidence }) } });
          await audit(db, userId, "Transaction", t.id, "repair.kind", { kind: t.kind }, { kind: c.kind });
          if (c.kindConfidence < 0.7) await db.reviewItem.create({ data: { userId, type: "CATEGORY", txnId: t.id, message: `Is "${t.description}" (${day}) ${c.kind === "TRANSFER" ? "money moved between your own accounts or companies" : `a ${c.kind.toLowerCase().replace("_", " ")}`}? We changed it from "${t.kind.toLowerCase().replace("_", " ")}". Please confirm.` } });
        });
        flipped++;
      }
      continue;
    }
    // Same date and amount, opposite direction: the old reader got money in / out backwards.
    const c = classify(ctx, match.p.description, match.p.amountCents, account.type, account.id);
    const data = {
      amountCents: match.p.amountCents, fingerprint: fps[match.i],
      originalDescription: match.p.description, ...(t.description === t.originalDescription ? { description: match.p.description } : {}),
      ...(t.kindConfirmed ? {} : { kind: c.kind }),
      ...(t.categoryConfirmed ? {} : { categoryId: c.category.categoryId, categorySource: c.category.source, categoryConfidence: c.category.confidence }),
    };
    if (await prisma.transaction.findFirst({ where: { accountId: account.id, fingerprint: data.fingerprint, id: { not: t.id } } })) continue;
    await prisma.$transaction(async (db) => {
      await db.transaction.update({ where: { id: t.id }, data });
      await audit(db, userId, "Transaction", t.id, "repair.direction", { amountCents: t.amountCents, kind: t.kind }, { amountCents: data.amountCents, kind: data.kind ?? t.kind });
      const f = (v: number) => (v / 100).toLocaleString("en-CA", { style: "currency", currency: account.currency });
      await db.reviewItem.create({ data: { userId, type: "CATEGORY", txnId: t.id, message: `We re-read your statement: "${match.p.description}" on ${day} was money ${match.p.amountCents > 0 ? "in" : "out"} (${f(Math.abs(match.p.amountCents))}), not money ${match.p.amountCents > 0 ? "out" : "in"}. It's been corrected. Does it look right now?` } });
    });
    flipped++;
  }

  // 3. Missing statement balances: add them so the statement can be reconciled.
  if (!batch.statements.length && parsed.periodStart && parsed.periodEnd && parsed.openingBalanceCents !== null && parsed.closingBalanceCents !== null) {
    const st = await prisma.statement.create({ data: { accountId: account.id, importBatchId: batch.id, periodStart: parsed.periodStart, periodEnd: parsed.periodEnd, openingBalanceCents: parsed.openingBalanceCents, closingBalanceCents: parsed.closingBalanceCents } });
    await audit(prisma, userId, "Statement", st.id, "repair.statement_added", undefined, { batchId, opening: parsed.openingBalanceCents, closing: parsed.closingBalanceCents });
    await evaluateStatement(userId, st.id);
    statement = st.id;
  }
  return { excluded, flipped, statement };
}
