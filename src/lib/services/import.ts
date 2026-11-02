/**
 * Statement import: preview (no writes) and commit (single DB transaction).
 *
 * Commit re-parses the uploaded file with the same mapping, so the rows the user
 * reviewed are exactly the rows imported; the user's corrections are applied by
 * row index. Nothing is ever deleted: duplicates are skipped or flagged.
 */
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { encrypt } from "../crypto";
import { log } from "../log";
import { parseStatement } from "../engine/parsers";
import { checkDuplicates, fingerprints, type DuplicateVerdict } from "../engine/dedupe";
import { REVIEW_CONFIDENCE_THRESHOLD, KIND_LABELS } from "../engine/classify";
import { isoDate } from "../engine/dates";
import type { ColumnMapping, TxnKindName } from "../engine/types";
import { classify, loadClassifierContext } from "./classifier";
import { audit } from "./audit";
import { linkTransfers } from "./transfers";
import { evaluateStatement } from "./reconciliation";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface PreviewRow {
  index: number;
  sourceRow: number;
  date: string;
  amountCents: number;
  description: string;
  kind: TxnKindName;
  kindLabel: string;
  kindConfidence: number;
  merchantName: string | null;
  merchantConfidence: number;
  categoryId: string | null;
  categoryLabel: string;
  categoryConfidence: number;
  duplicate: DuplicateVerdict;
  warnings: string[];
  needsAttention: boolean;
}

export interface ImportPreview {
  fileName: string;
  fileKind: string;
  fileSha256: string;
  alreadyUploaded: { at: string; rows: number } | null;
  institution: string | null;
  currency: string | null;
  accountHint: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  openingBalanceCents: number | null;
  closingBalanceCents: number | null;
  notes: string[];
  accountWarnings: string[];
  headers?: string[];
  mapping?: ColumnMapping;
  sections?: { index: number; name: string; transactions: number }[];
  section?: number;
  loanSplits: { date: string; interestCents: number; principalCents: number; loan: string }[];
  rows: PreviewRow[];
  counts: { total: number; new: number; alreadyImported: number; possibleDuplicates: number; needsAttention: number };
}

export interface RowDecision {
  skip?: boolean;
  flip?: boolean;
  description?: string;
  categoryId?: string;
  kind?: TxnKindName;
}

const NO_MERCHANT: TxnKindName[] = ["TRANSFER", "CARD_PAYMENT", "LOAN_PAYMENT", "ADJUSTMENT"];

async function build(userId: string, accountId: string, fileName: string, buf: Buffer, mapping?: ColumnMapping, section?: number) {
  const account = await prisma.account.findFirst({ where: { id: accountId, userId } });
  if (!account) throw new Error("That account wasn't found.");
  const parsed = await parseStatement(fileName, buf, account.type, mapping, section);
  const ctx = await loadClassifierContext(userId);
  const valid = parsed.transactions.filter((t) => t.date.getTime() > 0);
  const range = valid.length
    ? { gte: new Date(Math.min(...valid.map((t) => t.date.getTime())) - 5 * 86400000), lte: new Date(Math.max(...valid.map((t) => t.date.getTime())) + 5 * 86400000) }
    : undefined;
  const existing = range
    ? await prisma.transaction.findMany({ where: { accountId, date: range }, select: { id: true, date: true, amountCents: true, originalDescription: true, externalId: true, fingerprint: true } })
    : [];
  const verdicts = checkDuplicates(parsed.transactions, existing.map((e) => ({ ...e, description: e.originalDescription })));
  return { account, parsed, ctx, verdicts };
}

export async function previewImport(userId: string, accountId: string, fileName: string, buf: Buffer, mapping?: ColumnMapping, section?: number): Promise<ImportPreview> {
  if (buf.length > MAX_FILE_BYTES) throw new Error("This file is larger than 10 MB. Please upload one statement at a time.");
  const { account, parsed, ctx, verdicts } = await build(userId, accountId, fileName, buf, mapping, section);
  const sha = createHash("sha256").update(buf).digest("hex");
  const prior = await prisma.importBatch.findFirst({ where: { userId, fileSha256: sha }, orderBy: { createdAt: "desc" } });
  const accountWarnings: string[] = [];
  if (parsed.accountHint && account.mask && parsed.accountHint !== account.mask)
    accountWarnings.push(`This statement is for an account ending in ${parsed.accountHint}, but "${account.name}" ends in ${account.mask}. Check you picked the right account.`);
  if (parsed.currency && parsed.currency !== account.currency)
    accountWarnings.push(`This statement looks like it's in ${parsed.currency}, but "${account.name}" is a ${account.currency} account.`);
  if (parsed.institution && account.institution && !parsed.institution.toLowerCase().includes(account.institution.toLowerCase().split(" ")[0]) && !account.institution.toLowerCase().includes(parsed.institution.toLowerCase().split(" ")[0]))
    accountWarnings.push(`This looks like a ${parsed.institution} statement, but "${account.name}" is at ${account.institution}.`);

  const rows: PreviewRow[] = parsed.transactions.map((t, index) => {
    const c = classify(ctx, t.description, t.amountCents, account.type, account.id);
    const warnings = [...t.warnings];
    if (c.kindConfidence < REVIEW_CONFIDENCE_THRESHOLD) warnings.push(`We're not sure what type of transaction this is. We guessed "${KIND_LABELS[c.kind].simple}".`);
    if (c.category.confidence < REVIEW_CONFIDENCE_THRESHOLD && !NO_MERCHANT.includes(c.kind) && c.kind !== "INCOME" && c.kind !== "REVERSAL") warnings.push("Please choose an expense category.");
    const v = verdicts[index];
    return {
      index, sourceRow: t.sourceRow, date: t.date.getTime() > 0 ? isoDate(t.date) : "", amountCents: t.amountCents, description: t.description,
      kind: c.kind, kindLabel: KIND_LABELS[c.kind].simple, kindConfidence: c.kindConfidence,
      merchantName: NO_MERCHANT.includes(c.kind) ? null : c.merchant.name, merchantConfidence: c.merchant.confidence,
      categoryId: c.category.categoryId, categoryLabel: ctx.categoryLabel(c.category.categoryId), categoryConfidence: c.category.confidence,
      duplicate: v, warnings, needsAttention: warnings.length > 0 || v.status === "POSSIBLE_DUPLICATE",
    };
  });
  return {
    fileName, fileKind: parsed.fileKind, fileSha256: sha,
    alreadyUploaded: prior ? { at: prior.createdAt.toISOString(), rows: prior.rowsImported } : null,
    institution: parsed.institution, currency: parsed.currency, accountHint: parsed.accountHint,
    periodStart: parsed.periodStart ? isoDate(parsed.periodStart) : null, periodEnd: parsed.periodEnd ? isoDate(parsed.periodEnd) : null,
    openingBalanceCents: parsed.openingBalanceCents, closingBalanceCents: parsed.closingBalanceCents,
    notes: parsed.notes, accountWarnings, headers: parsed.headers, mapping: parsed.mapping, rows,
    sections: parsed.sections, section,
    loanSplits: (parsed.loanPayments ?? []).map((l) => ({ date: isoDate(l.date), interestCents: l.interestCents, principalCents: l.principalCents, loan: l.loan })),
    counts: {
      total: rows.length,
      new: rows.filter((r) => r.duplicate.status !== "ALREADY_IMPORTED").length,
      alreadyImported: rows.filter((r) => r.duplicate.status === "ALREADY_IMPORTED").length,
      possibleDuplicates: rows.filter((r) => r.duplicate.status === "POSSIBLE_DUPLICATE").length,
      needsAttention: rows.filter((r) => r.needsAttention).length,
    },
  };
}

export interface CommitInput {
  userId: string;
  accountId: string;
  fileName: string;
  buf: Buffer;
  mapping?: ColumnMapping;
  decisions: Record<number, RowDecision>;
  periodStart?: string | null;
  periodEnd?: string | null;
  openingBalanceCents?: number | null;
  closingBalanceCents?: number | null;
  /** Import rows the system thinks were already imported (user override). */
  includeAlreadyImported?: number[];
  /** For statements covering several accounts: which section to import. */
  section?: number;
}

export interface CommitResult { batchId: string; imported: number; skippedDuplicates: number; skippedByUser: number; flagged: number; transfersLinked: number; statementId: string | null; months: string[] }

export async function commitImport(input: CommitInput): Promise<CommitResult> {
  const { userId, accountId, fileName, buf, mapping, decisions } = input;
  if (buf.length > MAX_FILE_BYTES) throw new Error("This file is larger than 10 MB.");
  const { account, parsed, ctx, verdicts } = await build(userId, accountId, fileName, buf, mapping, input.section);
  const sha = createHash("sha256").update(buf).digest("hex");
  const include = new Set(input.includeAlreadyImported ?? []);

  type Row = { i: number; date: Date; amountCents: number; description: string; original: string; externalId?: string; pending: boolean };
  const rows: Row[] = [];
  let skippedByUser = 0, skippedDuplicates = 0;
  parsed.transactions.forEach((t, i) => {
    const d = decisions[i] ?? {};
    if (d.skip) { skippedByUser++; return; }
    if (verdicts[i].status === "ALREADY_IMPORTED" && !include.has(i)) { skippedDuplicates++; return; }
    if (t.date.getTime() <= 0) { skippedByUser++; return; } // unreadable dates can't be imported
    rows.push({ i, date: t.date, amountCents: d.flip ? -t.amountCents : t.amountCents, description: d.description?.trim() || t.description, original: t.description, externalId: t.externalId, pending: !!t.pending });
  });
  // Fingerprints are computed on the ORIGINAL parsed rows so a re-upload always matches.
  const allFps = fingerprints(parsed.transactions);

  const periodStart = input.periodStart ? new Date(`${input.periodStart}T00:00:00Z`) : parsed.periodStart;
  const periodEnd = input.periodEnd ? new Date(`${input.periodEnd}T00:00:00Z`) : parsed.periodEnd;

  const result = await prisma.$transaction(async (db) => {
    const batch = await db.importBatch.create({
      data: {
        userId, accountId, fileName, fileType: parsed.fileKind, fileSha256: sha, detectedInstitution: parsed.institution, parserName: parsed.parser,
        periodStart, periodEnd, rowsDetected: parsed.transactions.length, rowsImported: 0, rowsSkippedDuplicate: skippedDuplicates, rowsFlagged: 0,
        encryptedFile: encrypt(buf),
      },
    });
    const merchantIds = new Map<string, string>();
    let imported = 0, flagged = 0;
    const months = new Set<string>();
    for (const r of rows) {
      const d = decisions[r.i] ?? {};
      const c = classify(ctx, r.description, r.amountCents, account.type, account.id);
      const kind = d.kind ?? c.kind;
      let merchantId: string | null = null;
      if (!NO_MERCHANT.includes(kind)) {
        merchantId = merchantIds.get(c.merchant.name) ?? null;
        if (!merchantId) {
          const m = await db.merchant.upsert({ where: { userId_name: { userId, name: c.merchant.name } }, update: {}, create: { userId, name: c.merchant.name } });
          merchantId = m.id;
          merchantIds.set(c.merchant.name, m.id);
        }
        if (c.merchant.source !== "ALIAS" && c.merchant.key)
          await db.merchantAlias.upsert({ where: { merchantId_pattern: { merchantId, pattern: c.merchant.key } }, update: {}, create: { merchantId, pattern: c.merchant.key, source: "SYSTEM" } });
      }
      const userCat = d.categoryId && ctx.categories.some((x) => x.id === d.categoryId) ? d.categoryId : undefined;
      const data: Prisma.TransactionUncheckedCreateInput = {
        userId, accountId, importBatchId: batch.id, date: r.date, amountCents: r.amountCents, currency: account.currency,
        originalDescription: r.original, description: r.description, externalId: r.externalId, fingerprint: allFps[r.i],
        kind, kindConfirmed: !!d.kind, status: r.pending ? "PENDING" : "POSTED",
        merchantId, merchantConfidence: c.merchant.confidence,
        categoryId: userCat ?? c.category.categoryId, categorySource: userCat ? "USER" : c.category.source,
        categoryConfidence: userCat ? 1 : c.category.confidence, categoryConfirmed: !!userCat,
      };
      // Unique (accountId, fingerprint) is the final guard against double import.
      const created = await db.transaction.upsert({ where: { accountId_fingerprint: { accountId, fingerprint: allFps[r.i] } }, update: {}, create: data, select: { id: true, createdAt: true, importBatchId: true } });
      if (created.importBatchId !== batch.id) { skippedDuplicates++; continue; }
      imported++;
      months.add(isoDate(r.date).slice(0, 7));
      const v = verdicts[r.i];
      if (v.status === "POSSIBLE_DUPLICATE" && v.matchId) {
        flagged++;
        await db.reviewItem.create({ data: { userId, type: "DUPLICATE", txnId: created.id, relatedTxnId: v.matchId, message: "We found two transactions that might be the same purchase. Would you like to review them?" } });
      } else if (!userCat && !NO_MERCHANT.includes(kind) && kind !== "INCOME" && kind !== "REVERSAL" && c.category.confidence < REVIEW_CONFIDENCE_THRESHOLD) {
        flagged++;
        await db.reviewItem.create({ data: { userId, type: "CATEGORY", txnId: created.id, message: `What was "${r.description}" for? Choose an expense category so it's counted correctly.` } });
      } else if (!d.kind && c.kindConfidence < REVIEW_CONFIDENCE_THRESHOLD) {
        flagged++;
        await db.reviewItem.create({ data: { userId, type: "CATEGORY", txnId: created.id, message: `Is "${r.description}" a ${KIND_LABELS[c.kind].simple.toLowerCase()}? Please confirm the type so totals are right.` } });
      }
    }
    // Loan payments: split into interest (an expense) and principal (paying down the loan),
    // using the loan section printed on the same statement. Explained in Review; editable.
    for (const lp of parsed.loanPayments ?? []) {
      const total = lp.interestCents + lp.principalCents;
      if (!total) continue;
      const t = await db.transaction.findFirst({
        where: { importBatchId: batch.id, kind: "LOAN_PAYMENT", amountCents: -total, date: { gte: new Date(lp.date.getTime() - 3 * 86400000), lte: new Date(lp.date.getTime() + 3 * 86400000) }, splits: { none: {} } },
      });
      if (!t) continue;
      const [interestCat, principalCat] = await Promise.all([
        db.category.findFirst({ where: { userId, name: "Interest expenses", parent: { name: "Financial" } } }),
        db.category.findFirst({ where: { userId, name: "Loan and mortgage payments" } }),
      ]);
      if (!interestCat || !principalCat) continue;
      const parts = [{ categoryId: interestCat.id, amountCents: -lp.interestCents, memo: `Interest (${lp.loan})` }, { categoryId: principalCat.id, amountCents: -lp.principalCents, memo: `Principal (${lp.loan})` }].filter((p) => p.amountCents);
      await db.split.createMany({ data: parts.map((p) => ({ ...p, transactionId: t.id })) });
      await audit(db, userId, "Transaction", t.id, "split.set", undefined, { source: "loan section of statement", parts });
      flagged++;
      const f = (c: number) => (c / 100).toLocaleString("en-CA", { style: "currency", currency: account.currency });
      await db.reviewItem.create({ data: { userId, type: "CATEGORY", txnId: t.id, message: `Your ${f(total)} loan payment was ${f(lp.interestCents)} of interest and ${f(lp.principalCents)} of principal, according to the loan section of your statement. We've split it so the interest counts as a business expense and the principal as paying down the loan. Does that look right?` } });
    }
    await db.importBatch.update({ where: { id: batch.id }, data: { rowsImported: imported, rowsSkippedDuplicate: skippedDuplicates, rowsFlagged: flagged } });
    await audit(db, userId, "ImportBatch", batch.id, "import", undefined, { fileName, accountId, imported, skippedDuplicates, skippedByUser, flagged });
    let statementId: string | null = null;
    const opening = input.openingBalanceCents ?? parsed.openingBalanceCents;
    const closing = input.closingBalanceCents ?? parsed.closingBalanceCents;
    if (periodStart && periodEnd && opening !== null && opening !== undefined && closing !== null && closing !== undefined) {
      const st = await db.statement.create({ data: { accountId, importBatchId: batch.id, periodStart, periodEnd, openingBalanceCents: opening, closingBalanceCents: closing } });
      statementId = st.id;
    }
    return { batchId: batch.id, imported, flagged, statementId, months: [...months].sort() };
  }, { timeout: 120000 });

  const transfersLinked = await linkTransfers(userId);
  if (result.statementId) await evaluateStatement(userId, result.statementId);
  log("info", "import.commit", { userId, accountId, imported: result.imported, skippedDuplicates, flagged: result.flagged, transfersLinked });
  return { ...result, skippedDuplicates, skippedByUser, transfersLinked };
}

export const newGroupId = () => randomUUID();
