import { describe, expect, it } from "vitest";
import { detectKind, classifyCategory } from "@/lib/engine/classify";

describe("transaction type detection", () => {
  it("treats a chequing payment to a card as a card payment, not spending", () => {
    expect(detectKind("PAYMENT AMEX CARD", -100000, "BUSINESS_CHEQUING").kind).toBe("CARD_PAYMENT");
    expect(detectKind("SCOTIA VISA PAYMENT", -100000, "BUSINESS_CHEQUING").kind).toBe("CARD_PAYMENT");
  });
  it("treats the card side of a payment as a card payment", () => {
    expect(detectKind("PAYMENT RECEIVED - THANK YOU", 100000, "CREDIT_CARD").kind).toBe("CARD_PAYMENT");
  });
  it("detects refunds, fees, interest, loans, income", () => {
    expect(detectKind("AMAZON.CA REFUND", 6499, "CREDIT_CARD").kind).toBe("REFUND");
    expect(detectKind("MONTHLY FEE", -1995, "BUSINESS_CHEQUING").kind).toBe("FEE");
    expect(detectKind("INTEREST CHARGES", -1850, "CREDIT_CARD").kind).toBe("INTEREST");
    expect(detectKind("LOAN PAYMENT BUSINESS LOAN", -85000, "BUSINESS_CHEQUING").kind).toBe("LOAN_PAYMENT");
    expect(detectKind("STRIPE PAYOUT", 640000, "BUSINESS_CHEQUING").kind).toBe("INCOME");
    expect(detectKind("COFFEE SHOP", -500, "CREDIT_CARD").kind).toBe("PURCHASE");
  });
  it("is uncertain about Interac e-transfers", () => {
    expect(detectKind("E-TRANSFER SENT J TREMBLAY", -90000, "BUSINESS_CHEQUING").confidence).toBeLessThan(0.7);
  });
});

describe("category classification priority", () => {
  const ids: Record<string, string> = { "Business > Software": "sw", "Shopping > General merchandise": "gm", "Food > Restaurants": "rest", "Other > Uncategorized": "unc", "Money movement > Credit card payments": "ccp" };
  const base = { rules: [], history: new Map<string, string>(), merchantDefaults: new Map<string, string>(), pathToId: (p: string) => ids[p] ?? null };
  it("rule beats history beats merchant beats pattern", () => {
    const t = { description: "AMAZON.CA", merchantName: "Amazon", kind: "PURCHASE" as const, accountId: "a", suggestedCategory: "Shopping > General merchandise" };
    expect(classifyCategory(t, base)).toMatchObject({ categoryId: "gm", source: "MERCHANT" });
    expect(classifyCategory(t, { ...base, history: new Map([["Amazon", "hist"]]) })).toMatchObject({ categoryId: "hist", source: "HISTORY" });
    expect(classifyCategory(t, { ...base, history: new Map([["Amazon", "hist"]]), rules: [{ id: "r", pattern: "amazon", categoryId: "rule" }] })).toMatchObject({ categoryId: "rule", source: "RULE" });
  });
  it("uses description patterns, then falls back to uncategorized with zero confidence", () => {
    expect(classifyCategory({ description: "BISTRO 21", merchantName: "Bistro", kind: "PURCHASE", accountId: "a" }, base).categoryId).toBe("rest");
    expect(classifyCategory({ description: "ZXQ LLC", merchantName: "Zxq Llc", kind: "PURCHASE", accountId: "a" }, base)).toMatchObject({ categoryId: "unc", confidence: 0 });
  });
  it("puts card payments in money movement", () => {
    expect(classifyCategory({ description: "PAYMENT", merchantName: "x", kind: "CARD_PAYMENT", accountId: "a" }, base).categoryId).toBe("ccp");
  });
});

describe("Desjardins wording", () => {
  it("classifies common Desjardins transaction descriptions", () => {
    expect(detectKind("Virement Interac de / MARIE TREMBLAY/", 125000, "BUSINESS_CHEQUING")).toEqual({ kind: "INCOME", confidence: 0.85 });
    expect(detectKind("Paiement facture - AccèsD Internet / AMERICAN EXP CARD", -84530, "BUSINESS_CHEQUING").kind).toBe("CARD_PAYMENT");
    expect(detectKind("Virement-remboursement / à PR 1", -420000, "BUSINESS_CHEQUING").kind).toBe("LOAN_PAYMENT");
    expect(detectKind("Annulation - Virement Interac à / JEAN ROY/", 60000, "BUSINESS_CHEQUING").kind).toBe("REVERSAL");
    expect(detectKind("Dépôt Mobile", 97500, "BUSINESS_CHEQUING").kind).toBe("INCOME");
    expect(detectKind("Frais fixes d'utilisation", -595, "BUSINESS_CHEQUING").kind).toBe("FEE");
  });

  it("wires are money movement to confirm, not spending", () => {
    expect(detectKind("VIR. TELEGRAP. TRANSMIS EXEMPLE INC TELEVIREMENT", -10000000, "BUSINESS_SAVINGS")).toEqual({ kind: "TRANSFER", confidence: 0.6 });
    expect(detectKind("WIRE TRANSFER SENT", -500000, "BUSINESS_CHEQUING").kind).toBe("TRANSFER");
    expect(detectKind("INTERAC E-TRANSFER SENT", -5000, "BUSINESS_CHEQUING").kind).not.toBe("TRANSFER");
  });
});
