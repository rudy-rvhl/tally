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
import { isStatementInfo } from "../engine/parsers/pdf";
import { fingerprints } from "../engine/dedupe";
import { isoDate } from "../engine/dates";
import { classify, loadClassifierContext } from "./classifier";
import { audit } from "./audit";
import { evaluateStatement } from "./reconciliation";

const REASON = "Information printed on the statement (a balance or a limit), not a transaction (corrected automatically)";
/** Bump when the reader improves in a way that should re-check imported statements once. */
const REPAIR_VERSION = "v2";

export async function repairBalanceRows(): Promise<{ batches: number; excluded: number; flipped: number; statements: number }> {
  const total = { batches: 0, excluded: 0, flipped: 0, statements: 0 };
  // Cheap trigger: imported rows that are only a balance label and still count in totals.
  const suspects = await prisma.transaction.findMany({
    where: { excluded: false, importBatchId: { not: null }, OR: ["balance", "solde", "report", "limit", "available", "disponible", "minimum", "due", "points", "rate", "taux", "total"].map((w) => ({ originalDescription: { contains: w, mode: "insensitive" as const } })) },
    select: { id: true, importBatchId: true, originalDescription: true },
  });
  // Also: PDF statements that don't balance (e.g. a limit read as the previous balance), checked once per reader version.
  const unbalanced = await prisma.statement.findMany({ where: { status: "DIFFERENCE", importBatch: { parserName: { startsWith: "PDF" } } }, select: { importBatchId: true } });
  const checked = new Set((await prisma.auditLog.findMany({ where: { entityType: "ImportBatch", action: `repair.checked.${REPAIR_VERSION}` }, select: { entityId: true } })).map((a) => a.entityId));
  // …and statements that were made to balance with a correction (which may only hide a misread balance).
  const adjusted = await prisma.transaction.findMany({ where: { kind: "ADJUSTMENT", excluded: false, fingerprint: { startsWith: "adj:" } }, select: { fingerprint: true } });
  const adjustedStatements = await prisma.statement.findMany({ where: { id: { in: [...new Set(adjusted.map((t) => t.fingerprint.split(":")[1]))] }, importBatch: { parserName: { startsWith: "PDF" } } }, select: { importBatchId: true } });
  const batchIds = [...new Set([
    ...adjustedStatements.map((x) => x.importBatchId!).filter((id) => id && !checked.has(id)),
    ...suspects.filter((t) => isStatementInfo(t.originalDescription)).map((t) => t.importBatchId!),
    ...unbalanced.map((x) => x.importBatchId!).filter((id) => id && !checked.has(id)),
  ])];
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
    console.log(`\n  LedgerIQ checked ${total.batches} imported statement(s): ${total.excluded} line(s) that were a balance or a limit no longer counted as money, ${total.flipped} transaction(s) corrected (money in/out or type), ${total.statements} statement balance(s) added or corrected. Details are in Review.\n`);
  }
  return total;
}

async function repairBatch(batchId: string) {
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId }, omit: { encryptedFile: false }, include: { account: true, statements: { select: { id: true } } } });
  const { userId, account } = batch;
  const rows = await prisma.transaction.findMany({ where: { importBatchId: batchId, excluded: false } });
  let excluded = 0, flipped = 0, statement: string | null = null;

  // 1. Balance lines: excluded, not deleted.
  for (const t of rows.filter((x) => isStatementInfo(x.originalDescription))) {
    await prisma.$transaction(async (db) => {
      await db.transaction.update({ where: { id: t.id }, data: { excluded: true, excludedReason: REASON } });
      await db.reviewItem.updateMany({ where: { txnId: t.id, status: "OPEN" }, data: { status: "RESOLVED", resolution: "Balance line excluded", resolvedAt: new Date() } });
      await audit(db, userId, "Transaction", t.id, "repair.exclude_balance_line", { excluded: false, amountCents: t.amountCents }, { excluded: true, reason: REASON });
      await db.reviewItem.create({ data: { userId, type: "RECONCILIATION", txnId: t.id, message: `"${t.originalDescription}" (${isoDate(t.date)}, ${account.name}) was information printed on the statement (a balance or a limit), not money in or out. It no longer counts in your totals. Nothing was deleted: you can restore it from the transaction's page.` } });
    });
    excluded++;
  }

  // 2. Read the original file again with the current reader.
  if (!batch.encryptedFile) return { excluded, flipped, statement };
  const parsed = await parseStatement(batch.fileName, decrypt(batch.encryptedFile), account.type);
  const fps = fingerprints(parsed.transactions);
  const kept = rows.filter((x) => !isStatementInfo(x.originalDescription));
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

  // 4. A statement whose balances were misread (e.g. the previous balance taken from the limit beside it).
  const st = await prisma.statement.findFirst({ where: { importBatchId: batch.id } });
  if (st && st.id !== statement && parsed.openingBalanceCents !== null && parsed.closingBalanceCents !== null &&
      (st.openingBalanceCents !== parsed.openingBalanceCents || st.closingBalanceCents !== parsed.closingBalanceCents)) {
    const money = (c: number) => (c / 100).toLocaleString("en-CA", { style: "currency", currency: account.currency });
    const before = { opening: st.openingBalanceCents, closing: st.closingBalanceCents };
    await prisma.statement.update({ where: { id: st.id }, data: { openingBalanceCents: parsed.openingBalanceCents, closingBalanceCents: parsed.closingBalanceCents } });
    await audit(prisma, userId, "Statement", st.id, "repair.statement_balances", before, { opening: parsed.openingBalanceCents, closing: parsed.closingBalanceCents });
    // Corrections added to make the misread statement balance: set aside if it now balances without them.
    const adjustments = await prisma.transaction.findMany({ where: { accountId: account.id, kind: "ADJUSTMENT", excluded: false, fingerprint: { startsWith: `adj:${st.id}:` } } });
    if (adjustments.length) await prisma.transaction.updateMany({ where: { id: { in: adjustments.map((x) => x.id) } }, data: { excluded: true, excludedReason: "Correction no longer needed: the statement's balance had been misread (corrected automatically)" } });
    await evaluateStatement(userId, st.id);
    const now = await prisma.statement.findUniqueOrThrow({ where: { id: st.id } });
    if (adjustments.length && now.status !== "BALANCED") {
      await prisma.transaction.updateMany({ where: { id: { in: adjustments.map((x) => x.id) } }, data: { excluded: false, excludedReason: null } });
      await evaluateStatement(userId, st.id);
    } else for (const adj of adjustments) {
      await audit(prisma, userId, "Transaction", adj.id, "repair.exclude_adjustment", { excluded: false }, { excluded: true });
      await prisma.reviewItem.create({ data: { userId, type: "RECONCILIATION", txnId: adj.id, message: `The ${money(Math.abs(adj.amountCents))} balance correction on ${account.name} was only needed because the statement's previous balance had been misread (a limit printed next to it). The statement now balances without it, so it no longer counts. You can restore it from its page.` } });
    }
    await prisma.reviewItem.create({ data: { userId, type: "RECONCILIATION", statementId: st.id, message: `We re-read the ${account.name} statement ending ${isoDate(st.periodEnd)}: its opening balance is ${money(parsed.openingBalanceCents)}, not ${money(before.opening)} (that was a limit printed beside it), and its closing balance is ${money(parsed.closingBalanceCents)}. Corrected.` } });
    statement = st.id;
  }
  await audit(prisma, userId, "ImportBatch", batch.id, `repair.checked.${REPAIR_VERSION}`, undefined, undefined);
  return { excluded, flipped, statement };
}
