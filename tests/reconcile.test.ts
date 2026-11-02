import { describe, expect, it } from "vitest";
import { reconcile } from "@/lib/engine/reconcile";
import { matchTransfers } from "@/lib/engine/transfers";
import { parseOfx } from "@/lib/engine/parsers/ofx";
import { readFileSync } from "node:fs";
import path from "node:path";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("reconciliation", () => {
  it("balances the Scotiabank Visa sample (liability: opening + charges - payments)", () => {
    const r0 = parseOfx(readFileSync(path.join(__dirname, "..", "samples", "scotiabank-visa-2026-09-to-10.ofx")).toString(), "CREDIT_CARD");
    const txns = r0.transactions.map((t, i) => ({ id: String(i), amountCents: t.amountCents, description: t.description, date: t.date }));
    const r = reconcile("CREDIT_CARD", 313655, r0.closingBalanceCents!, txns);
    expect(r.outflowsCents).toBe(58951);
    expect(r.inflowsCents).toBe(265000);
    expect(r.calculatedClosingCents).toBe(107606);
    expect(r.balanced).toBe(true);
  });
  it("deposit accounts: opening + in - out, and explains a missing transaction", () => {
    const txns = [
      { id: "a", amountCents: 50000, description: "DEPOSIT", date: d("2026-10-02") },
      { id: "b", amountCents: -6327, description: "STAPLES", date: d("2026-10-03") },
    ];
    const ok = reconcile("BUSINESS_CHEQUING", 100000, 143673, txns);
    expect(ok.balanced).toBe(true);
    const off = reconcile("BUSINESS_CHEQUING", 100000, 137346, txns);
    expect(off.differenceCents).toBe(-6327);
    expect(off.hints[0]).toMatch(/STAPLES/);
  });
  it("ignores pending and excluded transactions", () => {
    const r = reconcile("BUSINESS_CHEQUING", 0, 0, [{ id: "p", amountCents: -100, description: "x", date: d("2026-10-01"), pending: true }, { id: "e", amountCents: -100, description: "y", date: d("2026-10-01"), excluded: true }]);
    expect(r.balanced).toBe(true);
  });
});

describe("transfer matching", () => {
  it("links a chequing payment with the card's payment received", () => {
    const pairs = matchTransfers([
      { id: "out", accountId: "chq", date: d("2026-10-20"), amountCents: -311862, currency: "CAD", kind: "CARD_PAYMENT" },
      { id: "in", accountId: "amex", date: d("2026-10-21"), amountCents: 311862, currency: "CAD", kind: "CARD_PAYMENT" },
      { id: "noise", accountId: "amex", date: d("2026-10-21"), amountCents: 311862, currency: "USD", kind: "REFUND" },
    ]);
    expect(pairs).toEqual([expect.objectContaining({ outId: "out", inId: "in" })]);
  });
  it("does not pair two ordinary purchases/refunds with equal amounts", () => {
    expect(matchTransfers([
      { id: "a", accountId: "x", date: d("2026-10-20"), amountCents: -500, currency: "CAD", kind: "PURCHASE" },
      { id: "b", accountId: "y", date: d("2026-10-20"), amountCents: 500, currency: "CAD", kind: "REFUND" },
    ])).toEqual([]);
  });
});
