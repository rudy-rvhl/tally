/**
 * Check a supplier's statement against your bank transactions. The file is read on this computer
 * and isn't stored; only a line in the activity log records that a check was made.
 */
import Papa from "papaparse";
import { prisma } from "../db";
import { audit } from "./audit";
import { buildLines, pdfWords, type Word } from "../engine/parsers/pdf";
import { checkSupplierStatement, mentions, nameWords, readSupplierStatement, type BankTxn, type SourceLine, type SupplierStatement } from "../engine/supplier";

export async function readSupplierFile(fileName: string, buf: Buffer): Promise<SupplierStatement> {
  if (/\.(csv|txt)$/i.test(fileName)) {
    const rows = Papa.parse<string[]>(buf.toString("utf8").replace(/^﻿/, ""), { skipEmptyLines: true }).data;
    return readSupplierStatement(rows.map((r) => ({ text: r.join(" ").trim(), cells: r.map((str) => ({ str })) })));
  }
  if (/\.xlsx$/i.test(fileName)) {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const lines: SourceLine[] = [];
    wb.worksheets[0]?.eachRow((row) => {
      const cells = (row.values as unknown[]).slice(1).map((v) => {
        if (v instanceof Date) return { str: v.toISOString().slice(0, 10) };
        if (typeof v === "number") return { str: v.toFixed(2) };
        return { str: String((v as { text?: string; result?: unknown })?.text ?? (v as { result?: unknown })?.result ?? v ?? "") };
      });
      lines.push({ text: cells.map((c) => c.str).join(" ").trim(), cells });
    });
    return readSupplierStatement(lines);
  }
  let words: Word[] | null = null;
  try { words = (await pdfWords(buf))?.words ?? null; }
  catch (e) {
    if ((e as Error).name === "PasswordException" || /password/i.test((e as Error).message)) throw new Error("This PDF is password-protected. Save a copy without a password and upload that.");
    throw new Error("We couldn't open this PDF. It may be damaged.");
  }
  if (words) return readSupplierStatement(buildLines(words));
  const { ocrAvailable, ocrPdfWords } = await import("../engine/parsers/ocr");
  if (!(await ocrAvailable())) throw new Error("This PDF is a scanned image and the text-recognition component isn't installed.");
  const st = readSupplierStatement(buildLines(await ocrPdfWords(buf), 6, 4.5));
  st.notes.unshift("This is a scanned statement, read with text recognition. Please check the amounts.");
  return st;
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000);

export async function checkSupplierFile(userId: string, fileName: string, buf: Buffer, otherName?: string) {
  const st = await readSupplierFile(fileName, buf);
  if (!st.entries.length) return { fileName, statement: st, check: null, accounts: [] as { id: string; label: string }[] };
  const dates = st.entries.map((e) => e.date).sort();
  const from = shift(dates[0], -15), to = shift(st.statementDate && st.statementDate > dates[dates.length - 1] ? st.statementDate : dates[dates.length - 1], 40);
  const [txns, accounts] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId, excluded: false, amountCents: { lt: 0 }, date: { gte: from, lte: to } },
      select: { id: true, date: true, amountCents: true, description: true, accountId: true, merchant: { select: { name: true } } }, orderBy: { date: "asc" },
    }),
    prisma.account.findMany({ where: { userId }, select: { id: true, name: true, institution: true, mask: true, imports: { select: { periodStart: true, periodEnd: true } }, statements: { select: { periodStart: true, periodEnd: true } } } }),
  ]);
  const label = new Map(accounts.map((a) => [a.id, `${a.institution} · ${a.name}${a.mask && !a.name.includes(a.mask) ? ` ··${a.mask}` : ""}`]));
  const bank: BankTxn[] = txns.map((t) => ({ id: t.id, date: day(t.date), amountCents: t.amountCents, description: t.description, merchant: t.merchant?.name ?? null, account: label.get(t.accountId) ?? "", accountId: t.accountId }));

  // Which accounts you pay this supplier from (any payment naming them, ever); otherwise all of them.
  const words = nameWords(st.supplier, otherName);
  const named = words.length ? await prisma.transaction.findMany({
    where: { userId, amountCents: { lt: 0 }, OR: words.flatMap((w) => [{ description: { contains: w, mode: "insensitive" as const } }, { merchant: { name: { contains: w, mode: "insensitive" as const } } }]) },
    select: { accountId: true, description: true, merchant: { select: { name: true } } },
  }) : [];
  const payers = new Set(named.filter((t) => mentions(words, t.description) || (t.merchant && mentions(words, t.merchant.name))).map((t) => t.accountId));
  const relevant = accounts.filter((a) => !payers.size || payers.has(a.id));
  const periods = relevant.map((a) => [...a.imports, ...a.statements].filter((p) => p.periodStart && p.periodEnd).map((p) => [day(p.periodStart!), day(p.periodEnd!)] as const));
  const uncovered = (date: string) => !periods.some((ps) => ps.some(([s, e]) => date >= s && date <= e));

  const check = checkSupplierStatement(st, bank, uncovered, otherName ? [otherName] : []);
  await audit(prisma, userId, "SupplierStatement", "check", "supplier.check", undefined, {
    supplier: st.supplier, entries: st.entries.length, payments: check.payments.length,
    found: check.payments.filter((p) => p.status === "FOUND" || p.status === "FOUND_COMBINED").length,
  });
  return { fileName, statement: st, check, accounts: relevant.map((a) => ({ id: a.id, label: label.get(a.id)! })), payerAccounts: [...payers].map((id) => label.get(id) ?? "") };
}
