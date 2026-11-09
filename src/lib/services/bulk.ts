/**
 * Bulk import, step 1: read a statement file WITHOUT saving anything and work out which account
 * it belongs to (bank, account number, type, currency) and which period it covers. Step 2 reuses
 * the normal import (commitImport) for each file, so duplicate protection and review are identical.
 */
import { createHash } from "node:crypto";
import { prisma } from "../db";
import { parseStatement, type FileKind } from "../engine/parsers";
import { detectAccountType, fileNameHints, labelOf, proposeAccount, routeStatement, type AccountLite, type RouteResult } from "../engine/routing";
import { isLiability } from "../engine/classify";
import { isoDate } from "../engine/dates";
import type { AccountTypeName } from "../engine/types";
import { MAX_FILE_BYTES } from "./import";

export interface DetectedStatement {
  fileName: string;
  fileKind: FileKind;
  fileSha256: string;
  /** For statements covering several accounts, one entry per account section. */
  section: number | null;
  sectionName: string | null;
  institution: string | null;
  last4: string | null;
  type: AccountTypeName | null;
  typeLabel: string | null;
  ownership: "BUSINESS" | "PERSONAL" | null;
  currency: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  transactions: number;
  openingBalanceCents: number | null;
  closingBalanceCents: number | null;
  /** Does opening + transactions = closing? */
  balances: "match" | "differ" | "unknown";
  differenceCents: number | null;
  route: RouteResult;
  proposal: ReturnType<typeof proposeAccount>;
  alreadyUploaded: { at: string; account: string } | null;
  /** An imported statement for the matched account already covers part of this period. */
  overlap: string | null;
  notes: string[];
  error: string | null;
}

async function accountsOf(userId: string): Promise<AccountLite[]> {
  return prisma.account.findMany({ where: { userId }, select: { id: true, name: true, institution: true, type: true, mask: true, currency: true, ownership: true, status: true }, orderBy: { createdAt: "asc" } });
}

export async function detectStatement(userId: string, fileName: string, buf: Buffer): Promise<DetectedStatement[]> {
  const sha = createHash("sha256").update(buf).digest("hex");
  const base = { fileName, fileSha256: sha };
  const fail = (fileKind: FileKind, error: string): DetectedStatement[] => [{
    ...base, fileKind, section: null, sectionName: null, institution: null, last4: null, type: null, typeLabel: null, ownership: null, currency: null,
    periodStart: null, periodEnd: null, transactions: 0, openingBalanceCents: null, closingBalanceCents: null, balances: "unknown", differenceCents: null,
    route: { accountId: null, confidence: "none", reason: error, candidates: [] }, proposal: proposeAccount({ institution: null, last4: null, type: null, ownership: null, currency: null }, fileName),
    alreadyUploaded: null, overlap: null, notes: [], error,
  }];
  if (buf.length > MAX_FILE_BYTES) return fail("UNKNOWN", "This file is larger than 10 MB.");

  // Read once as a bank account; a card or credit line statement is read again with the card sign convention.
  let parsed = await parseStatement(fileName, buf, "BUSINESS_CHEQUING");
  if (parsed.accountTypeHint && isLiability(parsed.accountTypeHint)) parsed = await parseStatement(fileName, buf, parsed.accountTypeHint);
  if (parsed.fileKind === "UNKNOWN") return fail(parsed.fileKind, parsed.notes[0] ?? "We don't recognise this file type.");
  if (!parsed.transactions.length && !parsed.sections?.length) return fail(parsed.fileKind, parsed.notes.find((n) => /couldn't|password|scanned|recognise/i.test(n)) ?? "We couldn't find any transactions in this file.");

  const fromName = fileNameHints(fileName);
  const [accounts, prior] = await Promise.all([
    accountsOf(userId),
    prisma.importBatch.findFirst({ where: { userId, fileSha256: sha }, orderBy: { createdAt: "desc" }, include: { account: { select: { name: true } } } }),
  ]);
  const sections = parsed.sections?.length ? parsed.sections : [null];
  const out: DetectedStatement[] = [];
  for (const sec of sections) {
    const p = sec ? await parseStatement(fileName, buf, parsed.accountTypeHint ?? "BUSINESS_CHEQUING", undefined, sec.index) : parsed;
    // In a multi-account statement, each section's name says what it is ("Compte d'opérations", "Épargne stable").
    const secKind = sec ? detectAccountType(sec.name) : { type: null, ownership: null };
    const type = secKind.type ?? (sec ? null : p.accountTypeHint) ?? fromName.type ?? null;
    const ownership = secKind.ownership ?? p.ownershipHint ?? fromName.ownership ?? null;
    const last4 = (sec ? sec.name.match(/(\d{4})\D*$/)?.[1] : null) ?? (sec ? null : p.accountHint ?? fromName.last4) ?? null;
    const facts = { institution: p.institution, last4, type, ownership, currency: p.currency };
    const route = routeStatement(facts, accounts);
    const sum = p.transactions.reduce((a, t) => a + t.amountCents, 0);
    let balances: DetectedStatement["balances"] = "unknown", differenceCents: number | null = null;
    if (p.openingBalanceCents !== null && p.closingBalanceCents !== null) {
      const liability = isLiability(type ?? "BUSINESS_CHEQUING");
      differenceCents = p.closingBalanceCents - (liability ? p.openingBalanceCents - sum : p.openingBalanceCents + sum);
      balances = Math.abs(differenceCents) <= 1 ? "match" : "differ";
    }
    let overlap: string | null = null;
    if (route.accountId && p.periodStart && p.periodEnd) {
      const st = await prisma.statement.findFirst({ where: { accountId: route.accountId, periodStart: { lte: p.periodEnd }, periodEnd: { gte: p.periodStart } } });
      if (st) overlap = `A statement from ${isoDate(st.periodStart)} to ${isoDate(st.periodEnd)} is already imported for this account. Transactions already there will be skipped.`;
    }
    out.push({
      ...base, fileKind: parsed.fileKind, section: sec?.index ?? null, sectionName: sec?.name ?? null,
      institution: p.institution, last4, type, typeLabel: type ? labelOf(type) : null, ownership, currency: p.currency,
      periodStart: p.periodStart ? isoDate(p.periodStart) : null, periodEnd: p.periodEnd ? isoDate(p.periodEnd) : null,
      transactions: p.transactions.length, openingBalanceCents: p.openingBalanceCents, closingBalanceCents: p.closingBalanceCents, balances, differenceCents,
      route, proposal: proposeAccount(facts, sec?.name ?? fileName),
      alreadyUploaded: prior && !sec ? { at: prior.createdAt.toISOString(), account: prior.account.name } : null,
      overlap, notes: p.notes.filter((n) => !/This statement covers \d+ accounts/.test(n)), error: null,
    });
  }
  return out;
}
