import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildLines, pdfWords } from "@/lib/engine/parsers/pdf";
import { checkSupplierStatement, nameWords, readSupplierStatement, type BankTxn } from "@/lib/engine/supplier";

const read = async () => readSupplierStatement(buildLines((await pdfWords(readFileSync(path.join(__dirname, "..", "samples", "pdf", "supplier-statement-pronto.pdf"))))!.words));
const tx = (id: string, date: string, dollars: number, description: string): BankTxn => ({ id, date, amountCents: Math.round(-dollars * 100), description, merchant: null, account: "Chequing ··0042", accountId: "a1" });

describe("supplier statement", () => {
  it("reads the supplier, client, amount due and every line", async () => {
    const st = await read();
    expect([st.supplier, st.customer, st.customerNo, st.statementDate, st.amountDueCents]).toEqual(["PRONTO RENOVATION INC.", "EXEMPLE IMMOBILIER INC.", "777", "2026-11-11", 135000]);
    expect(st.entries.map((e) => [e.date, e.kind, e.amountCents])).toEqual([
      ["2026-08-31", "OPENING", 0], ["2026-09-02", "INVOICE", 90000], ["2026-09-15", "PAYMENT", -90000], ["2026-10-01", "INVOICE", 90000],
      ["2026-10-14", "PAYMENT", -90000], ["2026-10-20", "PAYMENT", -45000], ["2026-11-02", "INVOICE", 90000],
    ]);
  });

  it("finds their payments in your bank, and says which are missing or can't be checked", async () => {
    const st = await read();
    const bank = [tx("t1", "2026-10-14", 900, "Interac e-Transfer Out to PRONTO RENOVATION"), tx("t2", "2026-10-14", 900, "RENT"), tx("t3", "2026-10-21", 120, "AMAZON")];
    const r = checkSupplierStatement(st, bank, (d) => d < "2026-10-01");
    expect(r.payments.map((p) => [p.entry.date, p.status, p.bank.map((b) => b.id)])).toEqual([
      ["2026-09-15", "NO_STATEMENT", []], ["2026-10-14", "FOUND", ["t1"]], ["2026-10-20", "NOT_FOUND", []],
    ]);
    expect(r.arithmetic.ok).toBe(true);
    expect([r.closingCents, r.dueMatchesBalance]).toEqual([135000, true]);
    expect(r.openInvoices.map((i) => [i.entry.date, i.openCents])).toEqual([["2026-10-01", 45000], ["2026-11-02", 90000]]);
  });

  it("flags a different amount, payments they didn't record, and two of their payments paid at once", () => {
    const st = readSupplierStatement([
      { text: "ACME PLOMBERIE INC. Statement", cells: [{ str: "ACME PLOMBERIE INC." }, { str: "Statement" }] },
      ...[["2026-03-01", "Balance forward", "0.00"], ["2026-03-02", "INV 1", "500.00", "500.00"], ["2026-03-05", "Payment - thank you", "-200.00", "300.00"],
        ["2026-03-05", "Payment - thank you", "-100.00", "200.00"], ["2026-03-20", "Cheque 123", "-200.00", "0.00"], ["2026-03-25", "INV 2", "300.00", "350.00"]]
        .map((c) => ({ text: c.join(" "), cells: c.map((str) => ({ str })) })),
    ]);
    const bank = [tx("a", "2026-03-04", 300, "VIREMENT INTERAC A ACME"), tx("b", "2026-03-22", 250, "CHQ ACME PLOMBERIE"), tx("c", "2026-03-12", 75, "ACME PLOMBERIE")];
    const r = checkSupplierStatement(st, bank, () => false);
    expect(r.payments.map((p) => p.status)).toEqual(["FOUND_COMBINED", "FOUND_COMBINED", "AMOUNT_DIFFERS"]);
    expect(r.payments[2].differenceCents).toBe(5000);
    expect(r.notOnTheirStatement.map((t) => t.id)).toEqual(["c"]);
    // their running balance is wrong on the last line (0 + 300 = 300, not 350)
    expect(r.arithmetic.wrong.map((w) => [w.entry.date, w.expectedCents])).toEqual([["2026-03-25", 30000]]);
  });

  it("dates written day first (03/07/2026 = July 3) when a day is above 12", () => {
    const st = readSupplierStatement([["15/06/2026", "Facture 9", "100,00", "100,00"], ["03/07/2026", "Paiement reçu", "100,00", "0,00"]].map((c) => ({ text: c.join(" "), cells: c.map((str) => ({ str })) })));
    expect(st.entries.map((e) => [e.date, e.kind, e.amountCents])).toEqual([["2026-06-15", "INVOICE", 10000], ["2026-07-03", "PAYMENT", -10000]]);
  });

  it("names: generic words don't count", () => {
    expect(nameWords("PRONTO RENOVATION INC.")).toEqual(["pronto"]);
    expect(nameWords("Ascenseurs Exemplo Inc.")).toEqual(["exemplo"]);
  });
});
