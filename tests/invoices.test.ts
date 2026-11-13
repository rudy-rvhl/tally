import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildLines, pdfWords } from "@/lib/engine/parsers/pdf";
import { matchInvoices, paymentsTo, readInvoice, type InvoiceForMatch, type PaymentForMatch } from "@/lib/engine/invoice";

const read = async (f: string) => readInvoice(buildLines((await pdfWords(readFileSync(path.join(__dirname, "..", "samples", "pdf", f))))!.words), f);

describe("supplier invoices", () => {
  it("reads number, date, terms, addresses, taxes and total", async () => {
    const r = await read("invoice-pronto-1015.pdf");
    expect(r).toMatchObject({
      supplier: "PRONTO RENOVATION INC.", tradeName: "Pronto Entretien", invoiceNo: "1015", invoiceDate: "2026-10-01", dueDate: "2026-10-31",
      description: "Pour le mois de OCTOBRE 2026", billedTo: "EXEMPLE IMMOBILIER INC.", serviceAddress: "200 avenue des Exemples",
      subtotalCents: 78278, gstCents: 3914, qstCents: 7808, totalCents: 90000, notes: [],
    });
  });

  const inv = (id: string, date: string, cents: number, extra: Partial<InvoiceForMatch> = {}): InvoiceForMatch => ({ id, supplier: "PRONTO", invoiceNo: id, invoiceDate: date, dueDate: null, totalCents: cents, transactionId: null, ...extra });
  const pay = (id: string, date: string, dollars: number, description = "Interac e-Transfer Out to PRONTO RENOVATION"): PaymentForMatch => ({ id, date, amountCents: Math.round(-dollars * 100), description, merchant: null, account: "Chequing" });

  it("paid, paid together, unpaid, overdue, and can't tell yet", () => {
    const invoices = [inv("A", "2026-01-05", 22995), inv("B", "2026-02-02", 22995), inv("C", "2026-03-02", 22995), inv("D", "2026-04-01", 22995), inv("E", "2026-06-01", 22995), inv("F", "2026-07-01", 22995)];
    const payments = [pay("p1", "2026-01-20", 229.95), pay("p2", "2026-03-10", 459.90), pay("p3", "2026-04-15", 100)];
    const s = matchInvoices(invoices, payments, "2026-06-15", "2026-06-20");
    expect(s.map((x) => [x.invoiceId, x.status, x.payment?.id ?? null])).toEqual([
      ["A", "PAID", "p1"], ["B", "PAID_TOGETHER", "p2"], ["C", "PAID_TOGETHER", "p2"], ["D", "OVERDUE", null], ["E", "UNPAID", null], ["F", "UNKNOWN", null],
    ]);
    expect(s[0].daysToPay).toBe(15);
  });

  it("a payment made long before an invoice doesn't pay it; one you linked by hand does", () => {
    const s = matchInvoices([inv("A", "2026-06-01", 50000), inv("B", "2026-06-01", 70000, { transactionId: "p9" })],
      [pay("p1", "2026-01-10", 500), pay("p9", "2026-06-03", 650)], "2026-06-30", "2026-06-10");
    expect(s.map((x) => x.status)).toEqual(["UNPAID", "PAID"]);
    expect(s[1].payment?.id).toBe("p9");
  });

  it("finds payments by the supplier's name or trade name", () => {
    const ps = [pay("1", "2026-01-01", 1, "VIREMENT INTERAC A / PRONTO RENO"), pay("2", "2026-01-01", 1, "PAIEMENT FACTURE ENTRETIEN SOLUTIONS"), pay("3", "2026-01-01", 1, "HYDRO-QUEBEC")];
    expect(paymentsTo("PRONTO RENOVATION INC.", "Pronto Entretien", ps).map((p) => p.id)).toEqual(["1"]);
  });
});
