import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parsePdf, parseLooseDate, resolveYear } from "@/lib/engine/parsers/pdf";
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
