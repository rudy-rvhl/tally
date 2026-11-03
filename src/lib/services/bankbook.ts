/**
 * Excel bank book export, laid out like a classic accountant's workbook:
 * one sheet per account, one block per month, a year-total row with live SUM formulas,
 * and a SUMMARY sheet whose figures are formulas pointing at each sheet's totals.
 */
import ExcelJS from "exceljs";
import type { User } from "@prisma/client";
import { prisma } from "../db";
import { buildMonths, fiscalYearLabel, type BookAnchor, type BookCategory, type BookMonth, type BookTxn } from "../engine/bankbook";
import { isLiability } from "../engine/classify";
import { addMonths, monthRange } from "../engine/dates";
import { ensureBankBookDefaults } from "./setup";

const DAY = 86400000;
const toCat = (c: { name: string; bookCode: string | null; kind: BookCategory["kind"]; parent: { name: string } | null } | null): BookCategory | null =>
  c ? { name: c.name, parent: c.parent?.name ?? null, bookCode: c.bookCode, kind: c.kind } : null;

export interface BankBookOptions { firstMonth: string; accountIds?: string[]; grouped: boolean }

export async function loadBankBook(user: Pick<User, "id" | "companyName" | "name">, opts: BankBookOptions) {
  await ensureBankBookDefaults(user.id);
  const { start } = monthRange(opts.firstMonth);
  const { end } = monthRange(addMonths(opts.firstMonth, 11));
  const accounts = await prisma.account.findMany({
    where: { userId: user.id, ...(opts.accountIds?.length ? { id: { in: opts.accountIds } } : {}) },
    include: { statements: true },
    orderBy: [{ institution: "asc" }, { name: "asc" }],
  });
  const catSel = { select: { name: true, bookCode: true, kind: true, parent: { select: { name: true } } } } as const;
  const result = [];
  for (const a of accounts) {
    // All posted history is needed to carry balances from the nearest statement into the year.
    const rows = await prisma.transaction.findMany({
      where: { accountId: a.id, excluded: false, status: "POSTED" },
      include: { merchant: { select: { name: true } }, category: catSel, splits: { include: { category: catSel } } },
      orderBy: { date: "asc" },
    });
    const groups = [...new Set(rows.map((r) => r.transferGroupId).filter(Boolean) as string[])];
    const others = groups.length ? await prisma.transaction.findMany({ where: { userId: user.id, transferGroupId: { in: groups }, accountId: { not: a.id } }, select: { transferGroupId: true, account: { select: { bookNumber: true, mask: true, name: true } } } }) : [];
    const counterpartOf = new Map(others.map((o) => [o.transferGroupId!, o.account.bookNumber ?? o.account.mask ?? o.account.name]));
    const txns: BookTxn[] = rows.map((r) => ({
      id: r.id, date: r.date, amountCents: r.amountCents, kind: r.kind, merchant: r.merchant?.name ?? null, description: r.description,
      category: toCat(r.category), splits: r.splits.map((s) => ({ amountCents: s.amountCents, category: toCat(s.category)!, memo: null })),
      counterpart: r.transferGroupId ? counterpartOf.get(r.transferGroupId) ?? null : null,
    }));
    // Statement balances are stored as "amount owed" for cards/credit lines; the book shows them negative.
    const sign = isLiability(a.type) ? -1 : 1;
    const anchors: BookAnchor[] = [
      ...a.statements.flatMap((s) => [
        { date: new Date(s.periodStart.getTime() - DAY), balanceCents: sign * s.openingBalanceCents },
        { date: s.periodEnd, balanceCents: sign * s.closingBalanceCents },
      ]),
      ...(a.openingBalanceCents !== null && a.openingBalanceDate ? [{ date: new Date(a.openingBalanceDate.getTime() - DAY), balanceCents: sign * a.openingBalanceCents }] : []),
    ];
    const months = buildMonths({ txns, anchors, firstMonth: opts.firstMonth, grouped: opts.grouped });
    const number = a.bookNumber || a.mask || a.name;
    const inYear = txns.filter((t) => t.date >= start && t.date <= end).length;
    result.push({ account: a, number, months, inYear, hasBalances: anchors.length > 0 });
  }
  return { company: user.companyName || user.name || "My company", label: fiscalYearLabel(opts.firstMonth), accounts: result };
}

const THIN = { style: "thin" as const };
const BOX = { top: THIN, bottom: THIN, left: THIN, right: THIN };
const MONEY = "#,##0.00";
const FONT = { name: "Calibri", size: 11 };
const BOLD = { ...FONT, bold: true };
const DATE = "mm-dd-yy";

function sheetName(base: string, used: Set<string>) {
  let n = base.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Account";
  for (let i = 2; used.has(n.toLowerCase()); i++) n = `${n.slice(0, 28)} ${i}`;
  used.add(n.toLowerCase());
  return n;
}

const amount = (cents: number | null) => (cents === null || cents === 0 ? null : cents / 100);
const codeValue = (c: string | null) => (c && /^\d+$/.test(c) ? Number(c) : c);

export async function bankBookXlsx(user: Pick<User, "id" | "companyName" | "name">, opts: BankBookOptions): Promise<{ buffer: Buffer; fileName: string }> {
  const book = await loadBankBook(user, opts);
  const wb = new ExcelJS.Workbook();
  wb.creator = "LedgerIQ";
  const summary = wb.addWorksheet("SUMMARY");
  const used = new Set(["summary"]);
  const totals: { label: string; sheet: string; row: number; currency: string }[] = [];

  for (const acc of book.accounts) {
    const ws = wb.addWorksheet(sheetName(acc.number, used), { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    ws.columns = [{ width: 14 }, { width: 7 }, { width: 24 }, { width: 28 }, { width: 7 }, { width: 15 }, { width: 15 }, { width: 16 }];
    const cur = `${acc.account.currency}$`;
    let r = 1;
    const firstDataRow = 5;
    const writeBlock = (m: BookMonth) => {
      const top = r;
      ws.getCell(r, 1).value = book.company; ws.getCell(r, 1).font = FONT; ws.mergeCells(r, 1, r, 2);
      for (let c = 1; c <= 8; c++) ws.getCell(r, c).border = { top: { style: "medium" } };
      r++;
      ws.getCell(r, 1).value = `${acc.account.institution} – ${acc.account.name}`; r++;
      ws.getCell(r, 1).value = `Acc#${acc.number}`; ws.mergeCells(r, 1, r, 2); ws.getCell(r, 6).value = cur; r++;
      ["Date", "#", "Name", "Description", "inv. #", "Debit", "Credit", "Balance"].forEach((h, i) => {
        const cell = ws.getCell(r, i + 1); cell.value = h; cell.border = BOX;
        if (i === 5) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
        cell.font = i === 7 ? BOLD : FONT;
      });
      r++;
      const row = (vals: (string | number | Date | null)[], opts2: { bold?: boolean } = {}) => {
        vals.forEach((v, i) => {
          const cell = ws.getCell(r, i + 1); cell.value = v; cell.border = BOX; cell.font = FONT;
          if (v instanceof Date) cell.numFmt = DATE;
          if (i >= 5 && typeof v === "number") cell.numFmt = MONEY;
          if ((i === 1 && v !== null) || opts2.bold) cell.font = BOLD;
        });
        r++;
      };
      row([m.start, null, null, null, null, null, null, amount(m.openingCents) ?? (m.openingCents === 0 ? 0 : null)]);
      for (const l of m.lines) row([l.date, codeValue(l.code), l.name, l.description || null, null, amount(l.debitCents), amount(l.creditCents), null]);
      for (let i = 0; i < 2; i++) row([null, null, null, null, null, null, null, null]); // room for manual entries
      row([m.end, null, "Balance", null, null, null, null, amount(m.closingCents) ?? (m.closingCents === 0 ? 0 : null)]);
      void top;
      r += 4;
    };
    acc.months.forEach(writeBlock);
    // Year totals: live formulas over the whole sheet, like the original workbook.
    const totalRow = r;
    ws.getCell(totalRow, 5).value = "Total";
    ws.getCell(totalRow, 6).value = { formula: `SUM(F${firstDataRow}:F${totalRow - 1})` };
    ws.getCell(totalRow, 7).value = { formula: `SUM(G${firstDataRow}:G${totalRow - 1})` };
    for (const c of [5, 6, 7]) { ws.getCell(totalRow, c).font = BOLD; ws.getCell(totalRow, c).border = { top: THIN, bottom: { style: "double" } }; }
    ws.getCell(totalRow, 6).numFmt = MONEY; ws.getCell(totalRow, 7).numFmt = MONEY;
    if (!acc.hasBalances) {
      ws.getCell(totalRow + 2, 1).value = "Balances are blank because LedgerIQ has no statement balance or opening balance for this account. Add one on the account's page to fill them in.";
      ws.getCell(totalRow + 2, 1).font = { italic: true, color: { argb: "FF7F7F7F" } };
    }
    totals.push({ label: `${acc.account.institution.toUpperCase()} ${acc.number}`, sheet: ws.name, row: totalRow, currency: acc.account.currency });
  }

  // SUMMARY: formulas into each account sheet's total row.
  summary.columns = [{ width: 34 }, { width: 18 }, { width: 18 }];
  summary.getCell("A1").value = `SUMMARY ${book.label} ${book.company.toUpperCase()}`;
  summary.getCell("A1").font = BOLD;
  summary.getCell("B2").value = "DEBIT"; summary.getCell("C2").value = "CREDIT";
  summary.getCell("A3").value = "ACCOUNTS";
  let sr = 4;
  for (const t of totals) {
    const ref = `'${t.sheet.replace(/'/g, "''")}'`;
    summary.getCell(sr, 1).value = t.currency === "CAD" ? t.label : `${t.label} (${t.currency})`;
    summary.getCell(sr, 2).value = { formula: `${ref}!F${t.row}` };
    summary.getCell(sr, 3).value = { formula: `${ref}!G${t.row}` };
    summary.getCell(sr, 2).numFmt = MONEY; summary.getCell(sr, 3).numFmt = MONEY;
    sr++;
  }
  const last = sr;
  summary.getCell(last + 1, 2).value = { formula: `SUM(B3:B${last})` };
  summary.getCell(last + 1, 3).value = { formula: `SUM(C3:C${last})` };
  for (const c of [2, 3]) { summary.getCell(last + 1, c).numFmt = MONEY; summary.getCell(last + 1, c).font = BOLD; }
  if (new Set(totals.map((t) => t.currency)).size > 1) summary.getCell(last + 3, 1).value = "Note: accounts in different currencies are added together above. Convert them first if you need a single total.";

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, fileName: `accounting_${book.label}.xlsx` };
}
