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
import { commitImport } from "./import";
import { descriptorSimilarity, identifyMerchant } from "../engine/merchants";

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

/**
 * Re-read statements an older reader got wrong (e.g. Wealthsimple: "–$92.00" missed, so the running
 * balance was taken as the amount). Done once per statement file, and only when the new reading
 * balances to the cent while what's stored doesn't, so statements you corrected yourself are kept.
 * Wrong rows are set aside (never deleted), with your category, notes, building and tenant carried over.
 */
const REREAD_VERSION = "v3";
export async function rereadMisreadStatements(): Promise<{ statements: number; replaced: number; added: number }> {
  const out = { statements: 0, replaced: 0, added: 0 };
  const done = new Set((await prisma.auditLog.findMany({ where: { entityType: "ImportBatch", action: `repair.reread.${REREAD_VERSION}` }, select: { entityId: true } })).map((a) => a.entityId));
  const batches = await prisma.importBatch.findMany({ where: { fileType: "PDF", encryptedFile: { not: null } }, select: { id: true }, orderBy: { createdAt: "asc" } });
  for (const { id } of batches.filter((b) => !done.has(b.id))) {
    try {
      const r = await rereadBatch(id);
      if (r) { out.statements++; out.replaced += r.replaced; out.added += r.added; }
    } catch (e) {
      log("warn", "repair.reread.failed", { batchId: id, error: (e as Error).message.slice(0, 300) });
    }
  }
  if (out.statements) console.log(`\n  LedgerIQ re-read ${out.statements} statement(s) that had been misread: ${out.replaced} wrong line(s) set aside and replaced (${out.added} added). Details are in Review.\n`);
  return out;
}

async function rereadBatch(batchId: string) {
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId }, omit: { encryptedFile: false }, include: { account: true, statements: true } });
  const { userId, account } = batch;
  const mark = () => audit(prisma, userId, "ImportBatch", batch.id, `repair.reread.${REREAD_VERSION}`, undefined, undefined);
  const buf = decrypt(batch.encryptedFile!);
  const parsed = await parseStatement(batch.fileName, buf, account.type);
  const liability = ["CREDIT_CARD", "BUSINESS_CREDIT_CARD", "LINE_OF_CREDIT"].includes(account.type);
  const flow = (rows: { amountCents: number }[]) => rows.reduce((a, t) => a + t.amountCents, 0);
  const expected = parsed.openingBalanceCents !== null && parsed.closingBalanceCents !== null
    ? (liability ? parsed.openingBalanceCents - parsed.closingBalanceCents : parsed.closingBalanceCents - parsed.openingBalanceCents) : null;
  // What's stored for this account over the statement's period (whichever import it came from).
  const inPeriod = parsed.periodStart && parsed.periodEnd
    ? await prisma.transaction.findMany({ where: { accountId: account.id, excluded: false, date: { gte: parsed.periodStart, lte: parsed.periodEnd } } }) : [];
  const stored = await prisma.transaction.findMany({ where: { importBatchId: batch.id, excluded: false } });
  // Only when the new reading is provably right and what's stored isn't.
  if (expected === null || Math.abs(flow(parsed.transactions) - expected) > 1 || Math.abs(flow(inPeriod) - expected) <= 1 || !stored.length) { await mark(); return null; }

  const key = (d: Date, c: number) => `${isoDate(d)}|${c}`;
  const fresh = new Map<string, number>();
  for (const t of parsed.transactions) fresh.set(key(t.date, t.amountCents), (fresh.get(key(t.date, t.amountCents)) ?? 0) + 1);
  const wrong = stored.filter((t) => { const k = key(t.date, t.amountCents); const n = fresh.get(k) ?? 0; if (n > 0) { fresh.set(k, n - 1); return false; } return true; });
  if (!wrong.length) { await mark(); return null; }

  // Import the correct reading (rows already stored correctly are recognised and skipped).
  const hadStatement = batch.statements[0] ?? null;
  const res = await commitImport({ userId, accountId: account.id, fileName: batch.fileName, buf, decisions: {} });
  await audit(prisma, userId, "ImportBatch", res.batchId, `repair.reread.${REREAD_VERSION}`, undefined, { from: batch.id }); // the corrected copy needs no re-read
  if (hadStatement && res.statementId) {
    await prisma.statement.delete({ where: { id: res.statementId } });
    await prisma.statement.update({ where: { id: hadStatement.id }, data: { openingBalanceCents: parsed.openingBalanceCents!, closingBalanceCents: parsed.closingBalanceCents!, periodStart: parsed.periodStart ?? hadStatement.periodStart, periodEnd: parsed.periodEnd ?? hadStatement.periodEnd } });
  }
  const added = await prisma.transaction.findMany({ where: { importBatchId: res.batchId } });
  for (const t of wrong) {
    // Carry your own choices to the corrected line (same day, similar wording).
    const twin = added.find((n) => +n.date === +t.date && descriptorSimilarity(n.originalDescription, t.originalDescription.replace(/[-–]?\$?[\d,]+\.\d{2}/g, "")) >= 0.4);
    await prisma.$transaction(async (db) => {
      await db.transaction.update({ where: { id: t.id }, data: { excluded: true, excludedReason: "Misread from the statement by an older version (corrected automatically)" } });
      await db.reviewItem.updateMany({ where: { txnId: t.id, status: "OPEN" }, data: { status: "RESOLVED", resolution: "Statement re-read", resolvedAt: new Date() } });
      if (twin) {
        const carry = {
          ...(t.categoryConfirmed ? { categoryId: t.categoryId, categorySource: t.categorySource, categoryConfirmed: true, categoryConfidence: 1 } : {}),
          ...(t.notes && !twin.notes ? { notes: t.notes } : {}), ...(t.buildingId && !twin.buildingId ? { buildingId: t.buildingId } : {}),
          ...(t.tenantConfirmed ? { tenantId: t.tenantId, tenantConfirmed: true } : {}),
        };
        if (Object.keys(carry).length) await db.transaction.update({ where: { id: twin.id }, data: carry });
      }
      await audit(db, userId, "Transaction", t.id, "repair.reread_exclude", { amountCents: t.amountCents, excluded: false }, { excluded: true, replacedBy: twin?.id ?? null });
    });
  }
  const st = hadStatement?.id ?? res.statementId;
  if (st) await evaluateStatement(userId, st);
  await prisma.reviewItem.create({ data: { userId, type: "RECONCILIATION", statementId: st ?? undefined, message: `We re-read your ${account.institution} statement (${batch.fileName}) with an improved reader: ${wrong.length} line${wrong.length === 1 ? " had" : "s had"} been misread (for example a balance taken as the amount, or money in shown as money out). ${wrong.length === 1 ? "It's" : "They're"} set aside and replaced by the correct amounts, which now match the statement's balances. Your categories and notes were carried over.` } });
  await mark();
  return { replaced: wrong.length, added: res.imported };
}

/**
 * Older versions named every Wealthsimple e-transfer "Interac E Transfer" (the ® in "e-Transfer®"
 * hid the person's name), so a contractor, a tenant and everyone else were one payee. Give each
 * e-transfer its own payee (the person it went to or came from). Your categories are kept.
 * Cheap and idempotent: only transactions still filed under a generic e-transfer payee are looked at.
 */
export async function splitTransferPayees(): Promise<number> {
  const generic = await prisma.merchant.findMany({ where: { OR: [{ name: { startsWith: "Interac E", mode: "insensitive" } }, { name: { startsWith: "E Transfer", mode: "insensitive" } }, { name: { startsWith: "E-Transfer", mode: "insensitive" } }] }, select: { id: true, userId: true, name: true } });
  let moved = 0;
  for (const g of generic) {
    const txns = await prisma.transaction.findMany({ where: { merchantId: g.id }, select: { id: true, description: true } });
    const byName = new Map<string, { key: string; ids: string[] }>();
    for (const t of txns) {
      const m = identifyMerchant(t.description);
      if (!m.name || m.name.toLowerCase() === g.name.toLowerCase() || /^interac\b|^e-?\s?transfer\b/i.test(m.name)) continue;
      const e = byName.get(m.name) ?? { key: m.key, ids: [] };
      e.ids.push(t.id);
      byName.set(m.name, e);
    }
    for (const [name, { key, ids }] of byName) {
      const m = await prisma.merchant.upsert({ where: { userId_name: { userId: g.userId, name } }, update: {}, create: { userId: g.userId, name } });
      if (key) await prisma.merchantAlias.upsert({ where: { merchantId_pattern: { merchantId: m.id, pattern: key } }, update: {}, create: { merchantId: m.id, pattern: key, source: "SYSTEM" } });
      await prisma.transaction.updateMany({ where: { id: { in: ids } }, data: { merchantId: m.id } });
      moved += ids.length;
    }
    if (byName.size) await audit(prisma, g.userId, "Merchant", g.id, "repair.split-etransfer", undefined, { payees: [...byName.keys()], transactions: [...byName.values()].reduce((a, v) => a + v.ids.length, 0) });
  }
  if (moved) console.log(`  LedgerIQ: ${moved} e-transfer(s) are now listed under the person they were sent to or received from.`);
  return moved;
}
