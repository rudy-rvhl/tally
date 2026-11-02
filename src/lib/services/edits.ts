/**
 * All user edits to financial data. Every change is audited with before/after
 * values and can be reversed. Nothing here deletes a transaction.
 */
import { randomUUID } from "node:crypto";
import type { TxnKind } from "@prisma/client";
import { prisma } from "../db";
import { encrypt } from "../crypto";
import { audit } from "./audit";
import { cleanDescriptor } from "../engine/merchants";
import { KIND_DEFAULT_CATEGORY } from "../engine/classify";
import { MOVE_KINDS } from "./query";

async function own(userId: string, txnId: string) {
  const t = await prisma.transaction.findFirst({ where: { id: txnId, userId } });
  if (!t) throw new Error("Transaction not found.");
  return t;
}

async function resolveReviews(userId: string, txnId: string, types: ("CATEGORY" | "DUPLICATE" | "TRANSFER" | "MERCHANT")[], resolution: string) {
  await prisma.reviewItem.updateMany({
    where: { userId, status: "OPEN", type: { in: types }, OR: [{ txnId }, { relatedTxnId: txnId }] },
    data: { status: "RESOLVED", resolution, resolvedAt: new Date() },
  });
}

export type ApplyScope = "this" | "merchant" | "rule";

/** Change a category. Optionally remember it for the supplier (future + unconfirmed past) or as a rule. */
export async function setCategory(userId: string, txnId: string, categoryId: string, scope: ApplyScope = "this") {
  const t = await own(userId, txnId);
  const cat = await prisma.category.findFirst({ where: { id: categoryId, userId } });
  if (!cat) throw new Error("Category not found.");
  await prisma.transaction.update({ where: { id: t.id }, data: { categoryId, categorySource: "USER", categoryConfirmed: true, categoryConfidence: 1 } });
  await audit(prisma, userId, "Transaction", t.id, "category.set", { categoryId: t.categoryId, categorySource: t.categorySource }, { categoryId, scope });
  let updated = 0;
  if (scope !== "this" && t.merchantId) {
    if (scope === "merchant") await prisma.merchant.update({ where: { id: t.merchantId }, data: { defaultCategoryId: categoryId } });
    if (scope === "rule") {
      const m = await prisma.merchant.findUnique({ where: { id: t.merchantId } });
      const rule = await prisma.categoryRule.create({ data: { userId, pattern: m!.name, categoryId, createdFrom: "CORRECTION" } });
      await audit(prisma, userId, "CategoryRule", rule.id, "rule.create", undefined, rule);
    }
    // Re-classify other transactions from this supplier that the user hasn't confirmed.
    const others = await prisma.transaction.findMany({ where: { userId, merchantId: t.merchantId, categoryConfirmed: false, id: { not: t.id }, kind: { notIn: MOVE_KINDS } }, select: { id: true, categoryId: true } });
    for (const o of others) {
      await prisma.transaction.update({ where: { id: o.id }, data: { categoryId, categorySource: scope === "rule" ? "RULE" : "HISTORY", categoryConfidence: 0.95 } });
      await audit(prisma, userId, "Transaction", o.id, "category.reclassify", { categoryId: o.categoryId }, { categoryId, cause: txnId });
      await resolveReviews(userId, o.id, ["CATEGORY"], "Category applied from a similar transaction");
      updated++;
    }
  }
  await resolveReviews(userId, t.id, ["CATEGORY"], "Category chosen");
  return { updated };
}

export async function setKind(userId: string, txnId: string, kind: TxnKind) {
  const t = await own(userId, txnId);
  const data: { kind: TxnKind; kindConfirmed: boolean; categoryId?: string | null; categorySource?: "PATTERN" } = { kind, kindConfirmed: true };
  const path = KIND_DEFAULT_CATEGORY[kind];
  if (path && !t.categoryConfirmed) {
    const [parent, child] = path.split(" > ");
    const c = await prisma.category.findFirst({ where: { userId, name: child, parent: { name: parent } } });
    if (c) { data.categoryId = c.id; data.categorySource = "PATTERN"; }
  }
  await prisma.transaction.update({ where: { id: t.id }, data });
  await audit(prisma, userId, "Transaction", t.id, "kind.set", { kind: t.kind }, { kind });
  await resolveReviews(userId, t.id, ["CATEGORY"], "Type confirmed");
}

export async function setDetails(userId: string, txnId: string, d: { description?: string; notes?: string | null; taxCode?: string | null }) {
  const t = await own(userId, txnId);
  const data: { description?: string; notes?: string | null; taxCode?: string | null } = {};
  if (d.description !== undefined && d.description.trim()) data.description = d.description.trim().slice(0, 300);
  if (d.notes !== undefined) data.notes = d.notes?.slice(0, 2000) || null;
  if (d.taxCode !== undefined) data.taxCode = d.taxCode || null;
  await prisma.transaction.update({ where: { id: t.id }, data });
  await audit(prisma, userId, "Transaction", t.id, "details.set", { description: t.description, notes: t.notes, taxCode: t.taxCode }, data);
}

/** Mark as a duplicate: excluded from every total, kept for the audit trail, reversible. */
export async function excludeTxn(userId: string, txnId: string, reason: string) {
  const t = await own(userId, txnId);
  await prisma.transaction.update({ where: { id: t.id }, data: { excluded: true, excludedReason: reason } });
  await audit(prisma, userId, "Transaction", t.id, "exclude", { excluded: false }, { excluded: true, reason });
  await resolveReviews(userId, t.id, ["DUPLICATE"], "Confirmed duplicate");
}

export async function restoreTxn(userId: string, txnId: string) {
  const t = await own(userId, txnId);
  await prisma.transaction.update({ where: { id: t.id }, data: { excluded: false, excludedReason: null } });
  await audit(prisma, userId, "Transaction", t.id, "restore", { excluded: true, reason: t.excludedReason }, { excluded: false });
}

/** Move a transaction to a different (possibly new) supplier, and remember it for future imports. */
export async function setMerchant(userId: string, txnId: string, merchantName: string) {
  const t = await own(userId, txnId);
  const name = merchantName.trim().slice(0, 120);
  if (!name) throw new Error("Please enter a supplier name.");
  const m = await prisma.merchant.upsert({ where: { userId_name: { userId, name } }, update: {}, create: { userId, name } });
  const key = cleanDescriptor(t.originalDescription);
  await prisma.merchantAlias.deleteMany({ where: { pattern: key, merchant: { userId } } });
  await prisma.merchantAlias.create({ data: { merchantId: m.id, pattern: key, source: "USER" } });
  await prisma.transaction.updateMany({ where: { userId, merchantId: t.merchantId ?? undefined, originalDescription: t.originalDescription }, data: { merchantId: m.id, merchantConfidence: 1 } });
  await prisma.transaction.update({ where: { id: t.id }, data: { merchantId: m.id, merchantConfidence: 1 } });
  await audit(prisma, userId, "Transaction", t.id, "merchant.set", { merchantId: t.merchantId }, { merchantId: m.id, alias: key });
  return m;
}

/** "Combine supplier names": fold `fromIds` into `intoId`. Transactions move; amounts never change. */
export async function combineMerchants(userId: string, intoId: string, fromIds: string[]) {
  const into = await prisma.merchant.findFirst({ where: { id: intoId, userId } });
  if (!into) throw new Error("Supplier not found.");
  for (const id of fromIds.filter((x) => x !== intoId)) {
    const from = await prisma.merchant.findFirst({ where: { id, userId }, include: { aliases: true } });
    if (!from) continue;
    const moved = await prisma.transaction.updateMany({ where: { userId, merchantId: from.id }, data: { merchantId: into.id } });
    for (const a of from.aliases) {
      await prisma.merchantAlias.upsert({ where: { merchantId_pattern: { merchantId: into.id, pattern: a.pattern } }, update: {}, create: { merchantId: into.id, pattern: a.pattern, source: "USER" } });
    }
    await prisma.merchant.delete({ where: { id: from.id } });
    await audit(prisma, userId, "Merchant", into.id, "merchant.combine", { from: from.name, fromId: from.id }, { into: into.name, transactionsMoved: moved.count });
  }
}

export async function renameMerchant(userId: string, id: string, name: string) {
  const m = await prisma.merchant.findFirst({ where: { id, userId } });
  if (!m) throw new Error("Supplier not found.");
  const clash = await prisma.merchant.findFirst({ where: { userId, name: name.trim(), id: { not: id } } });
  if (clash) return combineMerchants(userId, clash.id, [id]);
  await prisma.merchant.update({ where: { id }, data: { name: name.trim().slice(0, 120) } });
  await audit(prisma, userId, "Merchant", id, "merchant.rename", { name: m.name }, { name });
}

/** Split one transaction across categories. Parts must add up exactly to the original. */
export async function setSplits(userId: string, txnId: string, parts: { categoryId: string; amountCents: number; memo?: string }[]) {
  const t = await own(userId, txnId);
  const clean = parts.filter((p) => p.amountCents !== 0);
  if (clean.length) {
    const sign = Math.sign(t.amountCents);
    const normalized = clean.map((p) => ({ ...p, amountCents: Math.abs(p.amountCents) * sign }));
    const total = normalized.reduce((s, p) => s + p.amountCents, 0);
    if (total !== t.amountCents) throw new Error(`The parts add up to ${(Math.abs(total) / 100).toFixed(2)}, but the transaction is ${(Math.abs(t.amountCents) / 100).toFixed(2)}.`);
    const cats = await prisma.category.count({ where: { userId, id: { in: normalized.map((p) => p.categoryId) } } });
    if (cats !== new Set(normalized.map((p) => p.categoryId)).size) throw new Error("Unknown category in split.");
    const before = await prisma.split.findMany({ where: { transactionId: t.id } });
    await prisma.$transaction([
      prisma.split.deleteMany({ where: { transactionId: t.id } }),
      prisma.split.createMany({ data: normalized.map((p) => ({ transactionId: t.id, categoryId: p.categoryId, amountCents: p.amountCents, memo: p.memo })) }),
    ]);
    await audit(prisma, userId, "Transaction", t.id, "split.set", before, normalized);
  } else {
    await prisma.split.deleteMany({ where: { transactionId: t.id } });
    await audit(prisma, userId, "Transaction", t.id, "split.clear");
  }
}

export const RECEIPT_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic"];

export async function addReceipt(userId: string, txnId: string, file: { name: string; type: string; bytes: Buffer }) {
  const t = await own(userId, txnId);
  if (!RECEIPT_TYPES.includes(file.type)) throw new Error("Receipts can be PDF, PNG, JPG, WEBP or HEIC files.");
  if (file.bytes.length > 8 * 1024 * 1024) throw new Error("Receipts must be smaller than 8 MB.");
  const r = await prisma.receipt.create({ data: { transactionId: t.id, fileName: file.name.slice(0, 200), mimeType: file.type, sizeBytes: file.bytes.length, data: encrypt(file.bytes) } });
  await audit(prisma, userId, "Transaction", t.id, "receipt.add", undefined, { receiptId: r.id, fileName: r.fileName });
  return r;
}

/** Review: confirm two transactions are money moving between the user's accounts. */
export async function confirmTransfer(userId: string, outId: string, inId: string) {
  const [o, i] = await Promise.all([own(userId, outId), own(userId, inId)]);
  const group = randomUUID();
  const cat = await prisma.category.findFirst({ where: { userId, name: "Transfers between my accounts" } });
  for (const t of [o, i]) {
    const kind: TxnKind = MOVE_KINDS.includes(t.kind) ? t.kind : "TRANSFER";
    await prisma.transaction.update({ where: { id: t.id }, data: { transferGroupId: group, kind, kindConfirmed: true, ...(t.categoryConfirmed ? {} : { categoryId: cat?.id, categorySource: "USER" as const }) } });
    await audit(prisma, userId, "Transaction", t.id, "transfer.confirm", { kind: t.kind, transferGroupId: t.transferGroupId }, { kind, transferGroupId: group });
  }
  await prisma.reviewItem.updateMany({ where: { userId, status: "OPEN", type: "TRANSFER", txnId: { in: [o.id, i.id] } }, data: { status: "RESOLVED", resolution: "Confirmed transfer", resolvedAt: new Date() } });
}
