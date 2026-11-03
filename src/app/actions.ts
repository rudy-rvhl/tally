"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { TxnKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createSession, destroySession, hashPassword, requireUser, verifyPassword } from "@/lib/auth";
import { setupNewUser } from "@/lib/services/setup";
import { audit } from "@/lib/services/audit";
import * as edits from "@/lib/services/edits";
import { unlinkTransfer, linkTransfers } from "@/lib/services/transfers";
import { addAdjustment, evaluateStatement } from "@/lib/services/reconciliation";
import { parseAmountToCents } from "@/lib/engine/money";
import { clearFailures, isLocked, recordFailure } from "@/lib/ratelimit";

export interface ActionState { ok?: boolean; error?: string; message?: string; /** Client navigates here on success. */ redirectTo?: string }

const refresh = () => revalidatePath("/", "layout");
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// ---------- auth
const Creds = z.object({ email: z.string().email("Please enter a valid email address."), password: z.string().min(10, "Use at least 10 characters for your password.") });

export async function registerAction(_: ActionState, f: FormData): Promise<ActionState> {
  const parsed = Creds.safeParse({ email: str(f, "email").toLowerCase(), password: String(f.get("password") ?? "") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (await prisma.user.findUnique({ where: { email: parsed.data.email } })) return { error: "An account with this email already exists. Try signing in." };
  const user = await prisma.user.create({ data: { email: parsed.data.email, name: str(f, "name") || null, passwordHash: await hashPassword(parsed.data.password) } });
  await setupNewUser(user.id);
  await createSession(user.id);
  return { ok: true, redirectTo: "/" };
}

export async function loginAction(_: ActionState, f: FormData): Promise<ActionState> {
  const email = str(f, "email").toLowerCase();
  if (isLocked(email)) return { error: "Too many sign-in attempts. For your security, please wait 15 minutes and try again." };
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(String(f.get("password") ?? ""), user.passwordHash))) {
    recordFailure(email);
    return { error: "That email and password don't match. Please try again." };
  }
  clearFailures(email);
  await createSession(user.id);
  return { ok: true, redirectTo: "/" };
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

// ---------- preferences
export async function setModeAction(f: FormData) {
  const u = await requireUser();
  const mode = f.get("mode") === "ACCOUNTANT" ? "ACCOUNTANT" : "SIMPLE";
  await prisma.user.update({ where: { id: u.id }, data: { mode } });
  refresh();
}

export async function saveCompanyAction(_: ActionState, f: FormData): Promise<ActionState> {
  const u = await requireUser();
  const companyName = str(f, "companyName").slice(0, 120) || null;
  const month = Number(str(f, "fiscalYearStartMonth"));
  if (!(month >= 1 && month <= 12)) return { error: "Choose the month your fiscal year starts." };
  await prisma.user.update({ where: { id: u.id }, data: { companyName, fiscalYearStartMonth: month } });
  await audit(prisma, u.id, "User", u.id, "company.update", { companyName: u.companyName, fiscalYearStartMonth: u.fiscalYearStartMonth }, { companyName, fiscalYearStartMonth: month });
  refresh();
  return { ok: true, message: "Saved." };
}

export async function setBaseCurrencyAction(f: FormData) {
  const u = await requireUser();
  const c = str(f, "currency");
  if (c === "CAD" || c === "USD") await prisma.user.update({ where: { id: u.id }, data: { baseCurrency: c } });
  refresh();
}

export async function saveRateAction(_: ActionState, f: FormData): Promise<ActionState> {
  const u = await requireUser();
  const month = str(f, "month");
  const rate = Number(str(f, "rate"));
  const currency = str(f, "currency");
  if (!/^\d{4}-\d{2}$/.test(month)) return { error: "Choose a month." };
  if (!(rate > 0 && rate < 100)) return { error: "Enter the rate as a number, e.g. 1.3650." };
  if (currency === u.baseCurrency) return { error: `Amounts in ${currency} don't need converting.` };
  const r = await prisma.exchangeRate.upsert({
    where: { userId_currency_month: { userId: u.id, currency, month } },
    update: { rate, source: str(f, "source") || "Entered by user" }, create: { userId: u.id, currency, month, rate, source: str(f, "source") || "Entered by user" },
  });
  await audit(prisma, u.id, "ExchangeRate", r.id, "rate.save", undefined, r);
  refresh();
  return { ok: true, message: `Saved: 1 ${currency} = ${rate} ${u.baseCurrency} for ${month}.` };
}

// ---------- accounts
const AccountSchema = z.object({
  institution: z.string().min(1, "Which bank or card company is this?").max(80),
  name: z.string().min(1, "Give the account a name you'll recognise.").max(80),
  type: z.enum(["PERSONAL_CHEQUING", "PERSONAL_SAVINGS", "CREDIT_CARD", "BUSINESS_CHEQUING", "BUSINESS_CREDIT_CARD", "LINE_OF_CREDIT", "CASH", "OTHER"]),
  currency: z.enum(["CAD", "USD"]),
  mask: z.string().regex(/^\d{0,4}$/, "Enter only the last 4 digits.").optional(),
  ownership: z.enum(["PERSONAL", "BUSINESS"]),
});

export async function saveAccountAction(_: ActionState, f: FormData): Promise<ActionState> {
  const u = await requireUser();
  const parsed = AccountSchema.safeParse({
    institution: str(f, "institution"), name: str(f, "name"), type: str(f, "type"), currency: str(f, "currency") || "CAD",
    mask: str(f, "mask").replace(/\D/g, "").slice(-4) || undefined, ownership: str(f, "ownership") || "BUSINESS",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const opening = str(f, "openingBalance") ? parseAmountToCents(str(f, "openingBalance")) : null;
  const openingDate = str(f, "openingBalanceDate") ? new Date(`${str(f, "openingBalanceDate")}T00:00:00Z`) : null;
  const id = str(f, "id");
  const bookNumber = str(f, "bookNumber").replace(/[^\w -]/g, "").slice(0, 20) || null;
  const data = { ...parsed.data, mask: parsed.data.mask ?? null, bookNumber, openingBalanceCents: opening, openingBalanceDate: openingDate, status: (str(f, "status") === "CLOSED" ? "CLOSED" : "ACTIVE") as "CLOSED" | "ACTIVE" };
  if (id) {
    const before = await prisma.account.findFirst({ where: { id, userId: u.id } });
    if (!before) return { error: "Account not found." };
    await prisma.account.update({ where: { id }, data });
    await audit(prisma, u.id, "Account", id, "account.update", before, data);
  } else {
    const a = await prisma.account.create({ data: { ...data, userId: u.id } });
    await audit(prisma, u.id, "Account", a.id, "account.create", undefined, data);
    // No revalidatePath here: the client navigates to a dynamic page that is always fresh,
    // and revalidating the current route would race with (and cancel) that navigation.
    const next = str(f, "next");
    return { ok: true, redirectTo: next === "import" ? `/import?account=${a.id}` : `/accounts/${a.id}` };
  }
  refresh();
  return { ok: true, message: "Saved." };
}

// ---------- transactions
const KINDS = ["PURCHASE", "REFUND", "INCOME", "TRANSFER", "CARD_PAYMENT", "LOAN_PAYMENT", "INTEREST", "FEE", "REVERSAL", "ADJUSTMENT"] as const;

async function safely(fn: () => Promise<unknown>, success?: string): Promise<ActionState> {
  try {
    await fn();
    refresh();
    return { ok: true, message: success };
  } catch (e) {
    return { error: (e as Error).message || "Something went wrong. Nothing was changed." };
  }
}

export async function setCategoryAction(_: ActionState, f: FormData): Promise<ActionState> {
  const u = await requireUser();
  const scope = (["this", "merchant", "rule"].includes(str(f, "scope")) ? str(f, "scope") : "this") as edits.ApplyScope;
  let updated = 0;
  const r = await safely(async () => { updated = (await edits.setCategory(u.id, str(f, "txnId"), str(f, "categoryId"), scope)).updated; });
  if (r.ok) r.message = updated ? `Saved. We also updated ${updated} other transaction${updated === 1 ? "" : "s"} from this supplier.` : "Saved.";
  return r;
}

export async function setKindAction(_: ActionState, f: FormData): Promise<ActionState> {
  const u = await requireUser();
  const kind = str(f, "kind");
  if (!KINDS.includes(kind as (typeof KINDS)[number])) return { error: "Unknown type." };
  return safely(() => edits.setKind(u.id, str(f, "txnId"), kind as TxnKind), "Saved.");
}

export async function setDetailsAction(_: ActionState, f: FormData): Promise<ActionState> {
  const u = await requireUser();
  return safely(() => edits.setDetails(u.id, str(f, "txnId"), {
    description: f.has("description") ? str(f, "description") : undefined,
    notes: f.has("notes") ? str(f, "notes") : undefined,
    taxCode: f.has("taxCode") ? str(f, "taxCode") : undefined,
  }), "Saved.");
}

export async function setMerchantAction(_: ActionState, f: FormData): Promise<ActionState> {
  const u = await requireUser();
  return safely(() => edits.setMerchant(u.id, str(f, "txnId"), str(f, "merchant")), "Supplier updated. Future imports will use it too.");
}

export async function excludeAction(f: FormData) {
  const u = await requireUser();
  await edits.excludeTxn(u.id, str(f, "txnId"), str(f, "reason") || "Marked as a duplicate");
  refresh();
}

export async function restoreAction(f: FormData) {
  const u = await requireUser();
  await edits.restoreTxn(u.id, str(f, "txnId"));
  refresh();
}

export async function splitAction(_: ActionState, f: FormData): Promise<ActionState> {
  const u = await requireUser();
  const cats = f.getAll("splitCategory").map(String);
  const amounts = f.getAll("splitAmount").map((a) => parseAmountToCents(String(a)) ?? 0);
  const memos = f.getAll("splitMemo").map(String);
  const parts = cats.map((categoryId, i) => ({ categoryId, amountCents: amounts[i] ?? 0, memo: memos[i] || undefined })).filter((p) => p.categoryId && p.amountCents);
  return safely(() => edits.setSplits(u.id, str(f, "txnId"), parts), parts.length ? "Split saved." : "Split removed.");
}

export async function receiptAction(_: ActionState, f: FormData): Promise<ActionState> {
  const u = await requireUser();
  const file = f.get("receipt");
  if (!(file instanceof File) || !file.size) return { error: "Choose a receipt or invoice file first." };
  return safely(async () => edits.addReceipt(u.id, str(f, "txnId"), { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) }), "Receipt attached.");
}

export async function unlinkTransferAction(f: FormData) {
  const u = await requireUser();
  await unlinkTransfer(u.id, str(f, "groupId"));
  refresh();
}

// ---------- suppliers
export async function renameMerchantAction(_: ActionState, f: FormData): Promise<ActionState> {
  const u = await requireUser();
  const name = str(f, "name");
  if (!name) return { error: "Enter a name." };
  return safely(() => edits.renameMerchant(u.id, str(f, "merchantId"), name), "Supplier renamed.");
}

export async function combineMerchantsAction(_: ActionState, f: FormData): Promise<ActionState> {
  const u = await requireUser();
  const from = f.getAll("from").map(String).filter(Boolean);
  if (!from.length) return { error: "Choose at least one supplier name to combine." };
  return safely(() => edits.combineMerchants(u.id, str(f, "into"), from), `Combined ${from.length} supplier name${from.length > 1 ? "s" : ""}. Nothing was deleted from your transactions.`);
}

// ---------- review
export async function reviewAction(f: FormData) {
  const u = await requireUser();
  const item = await prisma.reviewItem.findFirst({ where: { id: str(f, "itemId"), userId: u.id } });
  if (!item) return;
  const action = str(f, "action");
  const close = (status: "RESOLVED" | "DISMISSED", resolution: string) =>
    prisma.reviewItem.update({ where: { id: item.id }, data: { status, resolution, resolvedAt: new Date() } });
  if (item.type === "DUPLICATE") {
    if (action === "confirm" && item.txnId) await edits.excludeTxn(u.id, item.txnId, "Confirmed duplicate in review");
    if (action === "not_duplicate") await close("DISMISSED", "Not a duplicate");
  } else if (item.type === "TRANSFER") {
    if (action === "confirm" && item.txnId && item.relatedTxnId) await edits.confirmTransfer(u.id, item.txnId, item.relatedTxnId);
    else if (action === "income" && item.txnId) { await edits.setKind(u.id, item.txnId, "INCOME"); await close("RESOLVED", "Marked as money received"); }
    else if (action === "purchase" && item.txnId) { await edits.setKind(u.id, item.txnId, "PURCHASE"); await close("RESOLVED", "Marked as a purchase"); }
    else await close("DISMISSED", action === "reject" ? "Not a transfer" : "Acknowledged");
  } else if (item.type === "CATEGORY") {
    if (action === "accept") {
      if (item.txnId) {
        const t = await prisma.transaction.findFirst({ where: { id: item.txnId, userId: u.id } });
        if (t?.categoryId) await edits.setCategory(u.id, t.id, t.categoryId, "this");
        if (t) await edits.setKind(u.id, t.id, t.kind);
      }
      await close("RESOLVED", "Suggestion accepted");
    } else await close("DISMISSED", "Skipped");
  } else {
    await close("DISMISSED", "Acknowledged");
  }
  await audit(prisma, u.id, "ReviewItem", item.id, `review.${action}`, { status: item.status }, { action });
  refresh();
}

export async function rerunMatchingAction() {
  const u = await requireUser();
  await linkTransfers(u.id);
  refresh();
}

// ---------- categories & rules
export async function addCategoryAction(_: ActionState, f: FormData): Promise<ActionState> {
  const u = await requireUser();
  const name = str(f, "name").slice(0, 60);
  if (!name) return { error: "Enter a category name." };
  const parentId = str(f, "parentId") || null;
  const parent = parentId ? await prisma.category.findFirst({ where: { id: parentId, userId: u.id } }) : null;
  if (parentId && !parent) return { error: "Parent category not found." };
  try {
    const c = await prisma.category.create({ data: { userId: u.id, name, parentId, kind: parent?.kind ?? "EXPENSE", ledgerCode: parent?.ledgerCode } });
    await audit(prisma, u.id, "Category", c.id, "category.create", undefined, c);
  } catch {
    return { error: "A category with that name already exists here." };
  }
  refresh();
  return { ok: true, message: `Added "${name}".` };
}

export async function updateCategoryAction(_: ActionState, f: FormData): Promise<ActionState> {
  const u = await requireUser();
  const c = await prisma.category.findFirst({ where: { id: str(f, "id"), userId: u.id } });
  if (!c) return { error: "Category not found." };
  const name = str(f, "name").slice(0, 60);
  const data = { ledgerCode: str(f, "ledgerCode") || null, taxTreatment: str(f, "taxTreatment") || null, bookCode: str(f, "bookCode").slice(0, 12) || null, ...(name ? { name } : {}) };
  try {
    await prisma.category.update({ where: { id: c.id }, data });
  } catch {
    return { error: "Another category here already has that name." };
  }
  await audit(prisma, u.id, "Category", c.id, "category.update", { name: c.name, ledgerCode: c.ledgerCode, taxTreatment: c.taxTreatment, bookCode: c.bookCode }, data);
  refresh();
  return { ok: true, message: "Saved." };
}

export async function addRuleAction(_: ActionState, f: FormData): Promise<ActionState> {
  const u = await requireUser();
  const pattern = str(f, "pattern");
  const cat = await prisma.category.findFirst({ where: { id: str(f, "categoryId"), userId: u.id } });
  if (pattern.length < 2 || !cat) return { error: "Enter some words to match and choose a category." };
  const r = await prisma.categoryRule.create({ data: { userId: u.id, pattern, categoryId: cat.id } });
  await audit(prisma, u.id, "CategoryRule", r.id, "rule.create", undefined, r);
  // Also apply it to transactions already imported, except ones the user categorised themselves.
  const matches = await prisma.transaction.findMany({
    where: { userId: u.id, categoryConfirmed: false, OR: [{ description: { contains: pattern, mode: "insensitive" } }, { originalDescription: { contains: pattern, mode: "insensitive" } }, { merchant: { name: { contains: pattern, mode: "insensitive" } } }] },
    select: { id: true, categoryId: true },
  });
  for (const t of matches) {
    await prisma.transaction.update({ where: { id: t.id }, data: { categoryId: cat.id, categorySource: "RULE", categoryConfidence: 1 } });
    await audit(prisma, u.id, "Transaction", t.id, "category.reclassify", { categoryId: t.categoryId }, { categoryId: cat.id, rule: r.id });
  }
  refresh();
  return { ok: true, message: `Transactions containing "${pattern}" now go to ${cat.name}${matches.length ? `, including ${matches.length} already imported` : ""}.` };
}

export async function deleteRuleAction(f: FormData) {
  const u = await requireUser();
  const r = await prisma.categoryRule.findFirst({ where: { id: str(f, "id"), userId: u.id } });
  if (r) {
    await prisma.categoryRule.delete({ where: { id: r.id } });
    await audit(prisma, u.id, "CategoryRule", r.id, "rule.delete", r, undefined);
  }
  refresh();
}

// ---------- reconciliation (Accountant View)
export async function saveStatementAction(_: ActionState, f: FormData): Promise<ActionState> {
  const u = await requireUser();
  const account = await prisma.account.findFirst({ where: { id: str(f, "accountId"), userId: u.id } });
  if (!account) return { error: "Account not found." };
  const opening = parseAmountToCents(str(f, "opening"));
  const closing = parseAmountToCents(str(f, "closing"));
  const start = str(f, "periodStart"), end = str(f, "periodEnd");
  if (opening === null || closing === null) return { error: "Enter both the opening and closing balance from the statement." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) return { error: "Enter the statement's start and end dates." };
  const st = await prisma.statement.create({ data: { accountId: account.id, periodStart: new Date(`${start}T00:00:00Z`), periodEnd: new Date(`${end}T00:00:00Z`), openingBalanceCents: opening, closingBalanceCents: closing } });
  await audit(prisma, u.id, "Statement", st.id, "statement.create", undefined, st);
  const r = await evaluateStatement(u.id, st.id);
  refresh();
  return r.balanced ? { ok: true, message: "The statement balances." } : { ok: true, message: `Saved. The statement is off by ${(Math.abs(r.differenceCents) / 100).toFixed(2)}. See the details below.` };
}

export async function recheckStatementAction(f: FormData) {
  const u = await requireUser();
  await evaluateStatement(u.id, str(f, "statementId"));
  refresh();
}

export async function adjustmentAction(_: ActionState, f: FormData): Promise<ActionState> {
  const u = await requireUser();
  const memo = str(f, "memo");
  if (memo.length < 3) return { error: "Explain why this correction is needed. It's kept in the audit log." };
  return safely(() => addAdjustment(u.id, str(f, "statementId"), memo), "Balance correction recorded.");
}

export async function journalAction(_: ActionState, f: FormData): Promise<ActionState> {
  const u = await requireUser();
  const codes = f.getAll("code").map(String);
  const debits = f.getAll("debit").map((v) => parseAmountToCents(String(v)) ?? 0);
  const credits = f.getAll("credit").map((v) => parseAmountToCents(String(v)) ?? 0);
  const lines = codes.map((ledgerCode, i) => ({ ledgerCode, debitCents: Math.abs(debits[i] ?? 0), creditCents: Math.abs(credits[i] ?? 0) })).filter((l) => l.ledgerCode && (l.debitCents || l.creditCents));
  const date = str(f, "date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Enter a date." };
  if (lines.length < 2) return { error: "A journal entry needs at least two lines." };
  const dr = lines.reduce((s, l) => s + l.debitCents, 0), cr = lines.reduce((s, l) => s + l.creditCents, 0);
  if (dr !== cr) return { error: `Debits (${(dr / 100).toFixed(2)}) must equal credits (${(cr / 100).toFixed(2)}).` };
  const known = await prisma.ledgerAccount.count({ where: { userId: u.id, code: { in: lines.map((l) => l.ledgerCode) } } });
  if (known !== new Set(lines.map((l) => l.ledgerCode)).size) return { error: "Unknown ledger account code." };
  const e = await prisma.journalEntry.create({ data: { userId: u.id, date: new Date(`${date}T00:00:00Z`), memo: str(f, "memo") || "Manual entry", lines: { create: lines } }, include: { lines: true } });
  await audit(prisma, u.id, "JournalEntry", e.id, "journal.create", undefined, e);
  refresh();
  return { ok: true, message: "Journal entry posted." };
}
