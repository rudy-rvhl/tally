import { describe, expect, it } from "vitest";
import { feedAccountType, feedCents, feedToParsed } from "@/lib/engine/bankfeed";

describe("bank connection data", () => {
  it("turns Plaid's sign (positive = money out) into LedgerIQ's (negative = money out)", () => {
    expect(feedCents(215.37)).toBe(-21537);
    expect(feedCents(-1450)).toBe(145000);
    expect(feedCents(0.1 + 0.2)).toBe(-30);
  });
  it("keeps the bank's own wording, a stable id and the pending status", () => {
    expect(feedToParsed({ transaction_id: "abc", account_id: "x", amount: 52.3, date: "2026-11-06", name: "Amazon", original_description: "AMAZON.CA  MARKETPLACE", pending: true }))
      .toMatchObject({ amountCents: -5230, description: "AMAZON.CA MARKETPLACE", externalId: "plaid:abc", pending: true, date: new Date("2026-11-06T00:00:00Z") });
    expect(feedToParsed({ transaction_id: "d", account_id: "x", amount: 1, date: "2026-11-06", name: "Hydro", pending: false }).description).toBe("Hydro");
  });
  it("maps bank account types", () => {
    expect(feedAccountType("depository", "checking")).toBe("BUSINESS_CHEQUING");
    expect(feedAccountType("depository", "savings")).toBe("BUSINESS_SAVINGS");
    expect(feedAccountType("depository", "savings", false)).toBe("PERSONAL_SAVINGS");
    expect(feedAccountType("credit", "credit card")).toBe("BUSINESS_CREDIT_CARD");
    expect(feedAccountType("loan", "line of credit")).toBe("LINE_OF_CREDIT");
  });
});
