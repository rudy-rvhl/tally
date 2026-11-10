import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isBalanceLine, parsePdf, parseLooseDate, resolveYear } from "@/lib/engine/parsers/pdf";
import { reconcile } from "@/lib/engine/reconcile";
import { isoDate } from "@/lib/engine/dates";
import type { AccountTypeName } from "@/lib/engine/types";

const pdf = (f: string) => readFileSync(path.join(__dirname, "..", "samples", "pdf", f));
const rows = (r: Awaited<ReturnType<typeof parsePdf>>) => r.transactions.map((t) => [isoDate(t.date), t.amountCents, t.description]);
const balances = (type: AccountTypeName, r: Awaited<ReturnType<typeof parsePdf>>) =>
  reconcile(type, r.openingBalanceCents!, r.closingBalanceCents!, r.transactions.map((t, i) => ({ id: String(i), amountCents: t.amountCents, description: t.description, date: t.date })));

const CHEQUING = [
  ["2026-10-02", -19640, "Online Banking payment - 5521 HYDRO-QUEBEC"],
  ["2026-10-03", -240000, "Rent 4521 St-Laurent"],
  ["2026-10-06", 739000, "Deposit STRIPE PAYOUT"],
  ["2026-10-09", -90000, "e-Transfer sent J TREMBLAY DESIGN"],
  ["2026-10-12", -85000, "Loan payment business loan"],
  ["2026-10-20", -311862, "Payment AMEX card"],
  ["2026-10-22", -145000, "Misc payment SCOTIA VISA PAYMENT"],
  ["2026-10-27", 615500, "Deposit STRIPE PAYOUT"],
  ["2026-10-31", -1995, "Monthly fee"],
];

describe("PDF statements", () => {
  it("chequing with Withdrawals/Deposits/Balance columns, 2 pages, wrapped payees", async () => {
    const r = await parsePdf(pdf("chequing-withdrawals-deposits.pdf"), "BUSINESS_CHEQUING");
    expect(r.institution).toBe("RBC Royal Bank");
    expect(r.accountHint).toBe("4567");
    expect([isoDate(r.periodStart!), isoDate(r.periodEnd!)]).toEqual(["2026-10-01", "2026-10-31"]);
    expect(rows(r)).toEqual(CHEQUING); // reference "5521" is not an amount; payee on line 2 is joined
    expect(r.transactions.every((t) => t.warnings.length === 0)).toBe(true);
    expect(balances("BUSINESS_CHEQUING", r).balanced).toBe(true);
  });

  it("credit card with posting dates, CR and trailing-minus credits, Dec→Jan period", async () => {
    const r = await parsePdf(pdf("credit-card-dec-jan.pdf"), "CREDIT_CARD");
    expect(r.institution).toBe("Scotiabank");
    expect(r.accountHint).toBe("8812");
    expect(rows(r)).toEqual([
      ["2025-12-18", -4521, "AMAZON.CA AMAZON.CA ON"],
      ["2025-12-22", -6112, "PETRO-CANADA 2231 MONTREAL QC"],
      ["2025-12-28", 123456, "PAYMENT - THANK YOU"],
      ["2026-01-03", -3999, "ADOBE *CREATIVE CLOUD"],
      ["2026-01-08", 4521, "AMAZON.CA RETURN"],
      ["2026-01-10", -91997, "COSTCO WHOLESALE W512"],
    ]);
    expect(balances("CREDIT_CARD", r).balanced).toBe(true);
  });

  it("Amex-style single Amount column with minus credits; reference lines ignored", async () => {
    const r = await parsePdf(pdf("amex-style.pdf"), "BUSINESS_CREDIT_CARD");
    expect(r.institution).toBe("American Express");
    expect(r.transactions.map((t) => t.amountCents)).toEqual([-12000, -3999, -64218, 6499, 264510, -60000]);
    expect(r.transactions[2].description).toBe("AIR CANADA 0142356 MONTREAL QC");
    expect(r.transactions[0].description).toBe("AMAZON MARKETPLACE");
    expect(balances("BUSINESS_CREDIT_CARD", r).balanced).toBe(true);
  });

  it("French layout: RETRAIT/DÉPÔT/SOLDE, '02 OCT' dates, '1 234,56' amounts, solde reporté", async () => {
    const r = await parsePdf(pdf("desjardins-francais.pdf"), "PERSONAL_CHEQUING");
    expect(r.institution).toBe("Desjardins");
    expect([isoDate(r.periodStart!), isoDate(r.periodEnd!)]).toEqual(["2026-10-01", "2026-10-31"]);
    expect(r.openingBalanceCents).toBe(125000);
    expect(rows(r)).toEqual([
      ["2026-10-02", -8745, "Achat IGA EXTRA #8123"],
      ["2026-10-05", 231050, "Dépôt paie"],
      ["2026-10-15", -10483, "Paiement facture VIDEOTRON"],
      ["2026-10-28", -795, "Frais mensuels"],
    ]);
    expect(balances("PERSONAL_CHEQUING", r).balanced).toBe(true);
  });

  it("scanned (image-only) statement is read with OCR and gives the same result", async () => {
    const r = await parsePdf(pdf("scanned-chequing.pdf"), "BUSINESS_CHEQUING");
    expect(r.parser).toContain("OCR");
    expect(r.institution).toBe("RBC Royal Bank");
    expect(rows(r)).toEqual(CHEQUING);
    expect(balances("BUSINESS_CHEQUING", r).balanced).toBe(true);
  }, 120000);

  it("explains password-protected and damaged files", async () => {
    const r = await parsePdf(Buffer.from("%PDF-1.4 not really a pdf"), "BUSINESS_CHEQUING");
    expect(r.transactions).toEqual([]);
    expect(r.notes[0]).toMatch(/couldn't open|password/i);
  });
});

describe("PDF dates", () => {
  it("reads English and French date styles", () => {
    expect(parseLooseDate("Oct 2")).toEqual({ y: undefined, m: 10, d: 2 });
    expect(parseLooseDate("Oct6")).toEqual({ y: undefined, m: 10, d: 6 });
    expect(parseLooseDate("02 OCT")).toEqual({ y: undefined, m: 10, d: 2 });
    expect(parseLooseDate("15 déc. 2025")).toEqual({ y: 2025, m: 12, d: 15 });
    expect(parseLooseDate("2026-10-02")).toEqual({ y: 2026, m: 10, d: 2 });
  });
  it("assigns the right year across a December→January statement", () => {
    const period = { start: new Date("2025-12-16T00:00:00Z"), end: new Date("2026-01-15T00:00:00Z") };
    expect(isoDate(resolveYear({ m: 12, d: 20 }, period)!)).toBe("2025-12-20");
    expect(isoDate(resolveYear({ m: 1, d: 5 }, period)!)).toBe("2026-01-05");
  });
});

describe("Desjardins business statement with several accounts", () => {
  it("imports the operating account, joins two-line rows, drops codes, reads 'du 1er … au …'", async () => {
    const r = await parsePdf(pdf("desjardins-multicomptes.pdf"), "BUSINESS_CHEQUING");
    expect(r.institution).toBe("Desjardins");
    expect(r.accountHint).toBe("3456"); // folio printed under its label
    expect([isoDate(r.periodStart!), isoDate(r.periodEnd!)]).toEqual(["2026-10-01", "2026-10-31"]);
    expect(rows(r)).toEqual([
      ["2026-10-01", 125000, "Virement Interac de / LOCATAIRE UN /"],
      ["2026-10-01", 110000, "Virement Interac de / LOCATAIRE DEUX/"],
      ["2026-10-01", -84530, "Paiement facture - AccèsD Internet / AMERICAN EXP CARD"],
      ["2026-10-03", -60000, "Virement Interac à / ENTREPRENEUR ABC/"],
      ["2026-10-03", 60000, "Annulation - Virement Interac à / ENTREPRENEUR ABC/"],
      ["2026-10-07", 97500, "Dépôt Mobile"],
      ["2026-10-16", -420000, "Virement-remboursement / à PR 1"],
      ["2026-10-20", -31245, "Paiement facture - AccèsD Internet / HYDRO-QUEBEC"],
      ["2026-10-30", -595, "Frais fixes d'utilisation"],
    ]);
    expect([r.openingBalanceCents, r.closingBalanceCents]).toEqual([2000000, 1796130]);
    expect(balances("BUSINESS_CHEQUING", r).balanced).toBe(true);
  });

  it("lists the other account section and can import it instead", async () => {
    const r = await parsePdf(pdf("desjardins-multicomptes.pdf"), "BUSINESS_CHEQUING");
    expect(r.sections?.map((s) => [s.name, s.transactions])).toEqual([["EOP EPARGNE AVEC OPERATIONS (C)", 9], ["COMPTE D'EPARGNE ET DE PLACEMENT", 1]]);
    const cs = await parsePdf(pdf("desjardins-multicomptes.pdf"), "PERSONAL_SAVINGS", { section: r.sections![1].index });
    expect(rows(cs)).toEqual([["2026-10-31", 5, "Intérêts"]]);
    expect([cs.openingBalanceCents, cs.closingBalanceCents]).toEqual([500, 505]);
  });

  it("reads the mortgage section's interest / principal split instead of importing it", async () => {
    const r = await parsePdf(pdf("desjardins-multicomptes.pdf"), "BUSINESS_CHEQUING");
    expect(r.loanPayments).toEqual([{ date: new Date("2026-10-16T00:00:00Z"), interestCents: 346000, principalCents: 74000, loan: "PR 1 PRET HYPOTHECAIRE (MULTILOGEMENTS)" }]);
    expect(r.transactions.some((t) => /Remboursement automatique/.test(t.description))).toBe(false);
  });

  it("Scotiabank business: date column on the right (MMDD), printed only on the last row of each day", async () => {
    const r = await parsePdf(pdf("scotia-business-2026-09.pdf"), "BUSINESS_CHEQUING");
    expect(r.institution).toBe("Scotiabank");
    expect(r.accountHint).toBe("9876");
    expect(r.accountTypeHint).toBe("BUSINESS_CHEQUING");
    expect([isoDate(r.periodStart!), isoDate(r.periodEnd!)]).toEqual(["2026-08-31", "2026-09-29"]);
    expect(rows(r)).toEqual([
      ["2026-09-05", 125000, "CREDIT MEMO 70000001 FREE INTERAC E-TRANSFER"], // undated row: takes the next printed date
      ["2026-09-05", 98000, "CREDIT MEMO 70000002 FREE INTERAC E-TRANSFER"],
      ["2026-09-15", -36540, "INSURANCE ARCHIVE+8 EXEMPLE ASSURANCES MUTUELLE"],
      ["2026-09-18", -14218, "BILL PAYMENT HYDRO-QUEBEC"],
      ["2026-09-29", 110000, "CREDIT MEMO 70000003 FREE INTERAC E-TRANSFER"],
      ["2026-09-29", -2000, "SERVICE CHARGE"],
    ]);
    expect(r.transactions.every((t) => !t.warnings.length)).toBe(true); // every amount checked against the running balance
    expect([r.openingBalanceCents, r.closingBalanceCents]).toEqual([320000, 600242]);
    expect(balances("BUSINESS_CHEQUING", r).balanced).toBe(true);
  });

  it("Scotiabank savings statement is recognised as savings, and the fee table on page 2 is ignored", async () => {
    const r = await parsePdf(pdf("scotia-savings-2026-10.pdf"), "BUSINESS_CHEQUING");
    expect([r.accountHint, r.accountTypeHint, r.ownershipHint]).toEqual(["5432", "BUSINESS_SAVINGS", "BUSINESS"]);
    expect(rows(r)).toEqual([["2026-10-15", 100000, "TRANSFER FROM 00098 76"], ["2026-10-30", 412, "INTEREST"]]);
    expect(balances("BUSINESS_SAVINGS", r).balanced).toBe(true);
  });

  it("Scotiabank credit card: rows start with a reference number; credits have a trailing minus; sub-totals ignored", async () => {
    const r = await parsePdf(pdf("scotia-visa-2026-09.pdf"), "CREDIT_CARD");
    expect([r.institution, r.accountHint, r.accountTypeHint]).toEqual(["Scotiabank", "2468", "CREDIT_CARD"]);
    expect(rows(r)).toEqual([
      ["2026-08-14", 64218, "PAYMENT FROM - *****01*2345"],
      ["2026-08-16", -21537, "RONA #12345 MONTREAL QC"],
      ["2026-08-22", -14218, "HYDRO-QUEBEC MONTREAL QC"],
      ["2026-09-03", -6499, "AMAZON.CA*AB12C AMAZON.CA ON"],
      ["2026-09-08", 1748, "RETURN AMAZON.CA ON"],
    ]);
    expect(balances("CREDIT_CARD", r).balanced).toBe(true);
  });

  it("unknown layout (no headings we recognise, date mid-line) is read line by line and checked against the running balance", async () => {
    const r = await parsePdf(pdf("unusual-layout.pdf"), "BUSINESS_CHEQUING");
    expect(rows(r)).toEqual([
      ["2026-09-01", -120000, "Office rent"],
      ["2026-09-05", 250000, "Client payment INV-104"],
      ["2026-09-12", -9540, "Bell Canada"],
      ["2026-09-30", -1250, "Bank fee"],
    ]);
    expect(r.transactions.every((t) => !t.warnings.length)).toBe(true);
    expect(r.notes.join(" ")).toMatch(/read it line by line and checked/);
  });

  it("Banque Scotia (French) investment account: REPORT is the balance, not money; interest table and fee table ignored", async () => {
    const r = await parsePdf(pdf("scotia-fr-placements-2025-07.pdf"), "BUSINESS_SAVINGS");
    expect([r.institution, r.accountHint, r.accountTypeHint]).toEqual(["Scotiabank", "5577", "BUSINESS_SAVINGS"]);
    expect(rows(r)).toEqual([
      ["2025-07-11", -2000000, "VIR. TELEGRAP. TRANSMIS EXEMPLE PLACEMENTS INC TELEVIREMENT"],
      ["2025-07-17", -500000, "VIR. TELEGRAP. TRANSMIS SOCIETE EXEMPLE TELEVIREMENT"],
      ["2025-07-31", 81245, "INTERETS CREDITEURS"],
      ["2025-07-31", -250, "FRAIS DE GESTION"],
    ]);
    expect([r.openingBalanceCents, r.closingBalanceCents]).toEqual([25000000, 22580995]);
    expect(r.loanPayments ?? []).toEqual([]); // the daily interest table is not a loan
    expect(balances("BUSINESS_SAVINGS", r).balanced).toBe(true);
  });

  it("balance lines inside the table (opening, carried / brought forward, closing) are never transactions", async () => {
    const r = await parsePdf(pdf("scotia-chequing-balances.pdf"), "PERSONAL_CHEQUING");
    expect(rows(r)).toEqual([
      ["2026-09-02", 220000, "Payroll Deposit EXEMPLE INC"],
      ["2026-09-05", -9540, "Bill Payment BELL CANADA"],
      ["2026-09-15", -90000, "MB-Transfer to 00011 33"],
      ["2026-09-30", -5000, "Service Charge"],
    ]);
    expect(r.sections).toBeUndefined(); // page 2 continues the same account
    expect([isoDate(r.periodStart!), isoDate(r.periodEnd!)]).toEqual(["2026-08-31", "2026-09-30"]);
    expect(balances("PERSONAL_CHEQUING", r).balanced).toBe(true);
  });

  it("recognises balance-only lines in English and French", () => {
    for (const s of ["REPORT", "BALANCE FORWARD", "Balance brought forward", "Balance carried forward", "Opening Balance", "Closing balance on Sep 30, 2026 =", "Your balance on Sep 30, 2026", "Solde reporté", "Solde au 31 juil. 2025", "Nouveau solde"])
      expect(isBalanceLine(s), s).toBe(true);
    for (const s of ["BALANCE TRANSFER", "Minimum balance fee", "REPORT ON BUSINESS SUBSCRIPTION", "INTERETS CREDITEURS", "Solde payé carte Visa"])
      expect(isBalanceLine(s), s).toBe(false);
  });
});
