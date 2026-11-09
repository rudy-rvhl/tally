import { describe, expect, it } from "vitest";
import { detectAccountType, fileNameHints, proposeAccount, routeStatement, sameInstitution, type AccountLite } from "@/lib/engine/routing";

const acc = (id: string, institution: string, type: AccountLite["type"], mask: string | null, extra: Partial<AccountLite> = {}): AccountLite =>
  ({ id, name: id, institution, type, mask, currency: "CAD", ownership: type.startsWith("PERSONAL") ? "PERSONAL" : "BUSINESS", status: "ACTIVE", ...extra });
const accounts = [
  acc("scotia-chq", "Scotiabank", "BUSINESS_CHEQUING", "9876"),
  acc("scotia-sav", "Scotiabank", "BUSINESS_SAVINGS", "5432"),
  acc("scotia-visa", "Scotiabank", "CREDIT_CARD", "8812"),
  acc("rbc-chq", "RBC Royal Bank", "BUSINESS_CHEQUING", "4567"),
  acc("td-personal", "TD Canada Trust", "PERSONAL_CHEQUING", null),
];

describe("which account a statement belongs to", () => {
  it("reads the type of account from the statement heading", () => {
    expect(detectAccountType("STATEMENT OF BUSINESS ACCOUNT")).toEqual({ type: "BUSINESS_CHEQUING", ownership: "BUSINESS" });
    expect(detectAccountType("STATEMENT OF BUSINESS SAVINGS ACCOUNT").type).toBe("BUSINESS_SAVINGS");
    expect(detectAccountType("Scotia Momentum Visa Infinite card  Minimum payment $25.00").type).toBe("CREDIT_CARD");
    expect(detectAccountType("Relevé de compte  Épargne à intérêt élevé  Particuliers").type).toBe("PERSONAL_SAVINGS");
    expect(detectAccountType("ScotiaLine personal line of credit").type).toBe("LINE_OF_CREDIT");
    expect(detectAccountType("Personal chequing account").type).toBe("PERSONAL_CHEQUING");
    expect(detectAccountType("Your statement").type).toBeNull();
  });

  it("uses the file name as a fallback, ignoring years", () => {
    expect(fileNameHints("BUSINESS_4321_Sep_2026.pdf")).toEqual({ last4: "4321", type: null, ownership: "BUSINESS" });
    expect(fileNameHints("estatement-2026-10.csv").last4).toBeNull();
  });

  it("routes by bank + last 4 digits, and never into a different account number", () => {
    const r = routeStatement({ institution: "Scotiabank", last4: "9876", type: "BUSINESS_CHEQUING", ownership: "BUSINESS", currency: "CAD" }, accounts);
    expect([r.accountId, r.confidence]).toEqual(["scotia-chq", "exact"]);
    expect(routeStatement({ institution: "Scotiabank", last4: "5432", type: "BUSINESS_SAVINGS", ownership: null, currency: null }, accounts).accountId).toBe("scotia-sav");
    // Unknown number at a known bank: a new account, not someone else's.
    expect(routeStatement({ institution: "Scotiabank", last4: "1111", type: "BUSINESS_CHEQUING", ownership: null, currency: null }, accounts).accountId).toBeNull();
  });

  it("separates chequing from savings, and cards from bank accounts, when no number is printed", () => {
    const sav = routeStatement({ institution: "Scotiabank", last4: null, type: "BUSINESS_SAVINGS", ownership: null, currency: null }, accounts);
    expect(sav.accountId).toBe("scotia-sav");
    const card = routeStatement({ institution: "Scotiabank", last4: null, type: "CREDIT_CARD", ownership: null, currency: null }, accounts);
    expect(card.accountId).toBe("scotia-visa");
    const td = routeStatement({ institution: "TD Canada Trust", last4: "3333", type: "PERSONAL_CHEQUING", ownership: "PERSONAL", currency: null }, accounts);
    expect(td.accountId).toBe("td-personal"); // account has no number on file: same bank and type is enough
    expect(td.confidence).toBe("likely");
  });

  it("asks when two accounts fit equally", () => {
    const two = [...accounts, acc("scotia-chq-2", "Scotiabank", "BUSINESS_CHEQUING", null), acc("scotia-chq-3", "Scotiabank", "BUSINESS_CHEQUING", null)];
    const r = routeStatement({ institution: "Scotiabank", last4: null, type: "BUSINESS_CHEQUING", ownership: null, currency: null }, two.filter((a) => a.id !== "scotia-chq"));
    expect(r.accountId).toBeNull();
    expect(r.reason).toMatch(/More than one/);
  });

  it("matches bank names written differently, and proposes a new account otherwise", () => {
    expect(sameInstitution("Scotiabank", "Scotia")).toBe(true);
    expect(sameInstitution("RBC Royal Bank", "Royal Bank of Canada")).toBe(true);
    expect(sameInstitution("Scotiabank", "TD Canada Trust")).toBe(false);
    expect(proposeAccount({ institution: "Scotiabank", last4: "4321", type: "BUSINESS_CHEQUING", ownership: "BUSINESS", currency: "CAD" }, "x"))
      .toMatchObject({ institution: "Scotiabank", name: "Business chequing ··4321", type: "BUSINESS_CHEQUING", mask: "4321" });
  });
});
