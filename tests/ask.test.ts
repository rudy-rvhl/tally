import { describe, expect, it } from "vitest";
import { parseQuestion, type AskEntities } from "@/lib/engine/ask";

const entities: AskEntities = {
  merchants: [{ id: "amz", name: "Amazon" }, { id: "aws", name: "Amazon Web Services" }, { id: "adobe", name: "Adobe" }],
  categories: [{ id: "sw", name: "Software", parent: "Business" }, { id: "biz", name: "Business", parent: null }],
  accounts: [{ id: "amex", name: "Business Gold", institution: "American Express", type: "BUSINESS_CREDIT_CARD", mask: "1004" }, { id: "rbc", name: "Operating", institution: "RBC Royal Bank", type: "BUSINESS_CHEQUING", mask: null }],
};
const today = new Date("2026-11-01T00:00:00Z");
const ask = (q: string) => parseQuestion(q, entities, today);

describe("question interpretation", () => {
  it("Amazon this year", () => {
    expect(ask("How much did we spend on Amazon this year?")).toMatchObject({ intent: "total", merchantIds: ["amz"], from: "2026-01-01", to: "2026-11-01" });
  });
  it("Amex in September", () => {
    expect(ask("Show me all purchases on my Amex in September.")).toMatchObject({ intent: "list", accountIds: ["amex"], from: "2026-09-01", to: "2026-09-30" });
  });
  it("five largest last month", () => {
    expect(ask("What were my five largest expenses last month?")).toMatchObject({ intent: "top", limit: 5, from: "2026-10-01", to: "2026-10-31" });
  });
  it("compare two months", () => {
    expect(ask("Compare October with September.")).toMatchObject({ intent: "compare", from: "2026-10-01", compareFrom: "2026-09-01", compareTo: "2026-09-30" });
  });
  it("software category", () => {
    expect(ask("How much did I spend on software this year?")).toMatchObject({ intent: "total", categoryIds: ["sw"] });
  });
  it("price increases", () => {
    expect(ask("Which suppliers increased their prices?").intent).toBe("price_increases");
  });
  it("prefers the longest merchant name", () => {
    expect(ask("How much on Amazon Web Services in October?").merchantIds).toEqual(["aws"]);
  });
  it("months without a year resolve to the most recent past one", () => {
    expect(ask("spending in December").from).toBe("2025-12-01");
  });
  it("income questions", () => {
    expect(ask("How much did we receive last month?").flow).toBe("income");
  });
});
