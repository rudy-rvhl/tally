import { describe, expect, it } from "vitest";
import { buildMonths, balanceAt, fiscalYearLabel, linesFor, type BookCategory, type BookTxn } from "@/lib/engine/bankbook";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const cat = (name: string, kind: BookCategory["kind"] = "EXPENSE", bookCode: string | null = null, parent: string | null = null): BookCategory => ({ name, kind, bookCode, parent });
let n = 0;
const tx = (date: string, amountCents: number, kind: BookTxn["kind"], extra: Partial<BookTxn> = {}): BookTxn =>
  ({ id: `t${n++}`, date: d(date), amountCents, kind, merchant: null, description: "", category: null, splits: [], ...extra });

const RENT = cat("Rent", "INCOME");
const UTIL = cat("Utilities", "EXPENSE", "5790", "Housing");
const FEES = cat("Banking fees", "EXPENSE", "5690", "Financial");
const INTEREST = cat("Interest expenses", "EXPENSE", null, "Financial");
const PRINCIPAL = cat("Loan and mortgage payments", "NON_OPERATING", null, "Money movement");

const october = [
  tx("2026-10-01", 120000, "INCOME", { merchant: "Tenant A", category: RENT }),
  tx("2026-10-07", 97500, "INCOME", { merchant: "Depot Mobile", category: RENT }),
  tx("2026-10-02", 110000, "INCOME", { merchant: "Tenant B", category: RENT }),
  tx("2026-10-05", -19640, "PURCHASE", { merchant: "Hydro-Québec", category: UTIL }),
  tx("2026-10-16", -420000, "LOAN_PAYMENT", { description: "Virement-remboursement / à PR 1 PRET HYPOTHECAIRE", splits: [{ amountCents: -346000, category: INTEREST }, { amountCents: -74000, category: PRINCIPAL }] }),
  tx("2026-10-20", -84530, "CARD_PAYMENT", { description: "Paiement facture AMERICAN EXP", counterpart: "1004" }),
  tx("2026-10-21", -50000, "CARD_PAYMENT", { description: "Paiement facture - AccèsD Internet / AMERICAN EXP CARD" }),
  tx("2026-10-30", -595, "FEE", { category: FEES }),
];

describe("bank book lines", () => {
  it("groups a month the way a bookkeeper does: one rent line, mortgage interest and capital, fees", () => {
    const [m] = buildMonths({ txns: october, anchors: [{ date: d("2026-09-30"), balanceCents: 2000000 }], firstMonth: "2026-10", months: 1, grouped: true });
    expect(m.lines.map((l) => [l.code, l.name, l.description, l.debitCents, l.creditCents])).toEqual([
      [null, "Rent", "", 327500, 0],
      [null, "Mortgage", "Interest", 0, 346000],
      [null, "Mortgage", "Capital", 0, 74000],
      ["5690", "Bank fee", "", 0, 595],
      ["5790", "Hydro-Québec", "Utilities", 0, 19640],
      [null, "Credit card payment", "To Acc#1004", 0, 84530],
      [null, "Credit card payment", "American Express", 0, 50000],
    ]);
  });
  it("every block adds up: opening + debit − credit = closing", () => {
    const [m] = buildMonths({ txns: october, anchors: [{ date: d("2026-09-30"), balanceCents: 2000000 }], firstMonth: "2026-10", months: 1, grouped: true });
    const debit = m.lines.reduce((s, l) => s + l.debitCents, 0), credit = m.lines.reduce((s, l) => s + l.creditCents, 0);
    expect(m.openingCents).toBe(2000000);
    expect(m.closingCents).toBe(m.openingCents! + debit - credit);
  });
  it("full detail keeps each transaction with its date", () => {
    const [m] = buildMonths({ txns: october, anchors: [], firstMonth: "2026-10", months: 1, grouped: false });
    expect(m.lines.length).toBe(9); // loan payment gives two lines
    expect(m.lines[0].date?.toISOString().slice(0, 10)).toBe("2026-10-01");
  });
});

describe("bank book balances", () => {
  const txns = [tx("2026-09-10", -10000, "PURCHASE"), tx("2026-10-10", 50000, "INCOME"), tx("2026-11-10", -2000, "FEE")];
  it("carries a statement balance forward and backward through the year", () => {
    const anchors = [{ date: d("2026-10-31"), balanceCents: 100000 }];
    expect(balanceAt(d("2026-11-30"), anchors, txns)).toBe(98000);
    expect(balanceAt(d("2026-09-30"), anchors, txns)).toBe(50000);
    expect(balanceAt(d("2026-08-31"), anchors, txns)).toBe(60000);
    const months = buildMonths({ txns, anchors, firstMonth: "2026-09", months: 3, grouped: true });
    expect(months.map((m) => [m.openingCents, m.closingCents])).toEqual([[60000, 50000], [50000, 100000], [100000, 98000]]);
  });
  it("leaves balances empty instead of guessing when there is no statement or opening balance", () => {
    const [m] = buildMonths({ txns, anchors: [], firstMonth: "2026-10", months: 1, grouped: true });
    expect([m.openingCents, m.closingCents]).toEqual([null, null]);
  });
  it("credit cards: owed money shows as a negative balance so the block still adds up", () => {
    const card = [tx("2026-10-03", -5000, "PURCHASE", { merchant: "Costco", category: cat("Groceries", "EXPENSE", null, "Food") }), tx("2026-10-20", 20000, "CARD_PAYMENT")];
    const [m] = buildMonths({ txns: card, anchors: [{ date: d("2026-09-30"), balanceCents: -20000 }], firstMonth: "2026-10", months: 1, grouped: true });
    expect([m.openingCents, m.closingCents]).toEqual([-20000, -5000]);
  });
});

describe("labels", () => {
  it("fiscal year labels", () => {
    expect(fiscalYearLabel("2025-08")).toBe("2025-2026");
    expect(fiscalYearLabel("2026-01")).toBe("2026");
  });
  it("uncategorized purchases have no description; refunds are money in", () => {
    expect(linesFor(tx("2026-10-01", 6499, "REFUND", { merchant: "Amazon", category: cat("Uncategorized", "EXPENSE", null, "Other") }))).toEqual([{ code: null, name: "Amazon", description: "", debitCents: 6499, creditCents: 0 }]);
  });
});
