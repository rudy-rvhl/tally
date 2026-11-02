import { describe, expect, it } from "vitest";
import { summarize, groupSpending, byMerchant, detectRecurring, coverage, compareGroups, monthlySeries } from "@/lib/engine/analytics";
import { explainMonth } from "@/lib/engine/insights";
import type { AnalyticTxn, TxnKindName } from "@/lib/engine/types";

let n = 0;
const t = (date: string, amountCents: number, kind: TxnKindName, merchant: string | null, category = "Shopping"): AnalyticTxn => ({
  id: `t${n++}`, date: new Date(`${date}T00:00:00Z`), amountCents, kind, accountId: "a", merchant, merchantId: merchant ? `m-${merchant}` : null,
  category, subcategory: null, categoryId: category, pending: false,
});

describe("summaries never double count", () => {
  const txns = [
    t("2026-10-02", -12000, "PURCHASE", "Amazon"),
    t("2026-10-13", 6499, "REFUND", "Amazon"),
    t("2026-10-20", -311862, "CARD_PAYMENT", null, "Money movement"),
    t("2026-10-20", 311862, "CARD_PAYMENT", null, "Money movement"),
    t("2026-10-01", 650000, "INCOME", null, "Income"),
    t("2026-10-28", -1995, "FEE", null, "Financial"),
  ];
  it("excludes card payments from spending and nets refunds", () => {
    const s = summarize(txns);
    expect(s.spendingCents).toBe(12000 - 6499 + 1995);
    expect(s.incomeCents).toBe(650000);
    expect(s.netCashFlowCents).toBe(650000 - 7496);
    expect(s.movementCents.cardPayments).toBe(311862);
  });
  it("totals agree across groupings", () => {
    const total = summarize(txns).spendingCents;
    const byM = groupSpending(txns, byMerchant).reduce((a, g) => a + g.spendCents, 0);
    const series = monthlySeries(txns, ["2026-10"]).reduce((a, p) => a + p.spendingCents, 0);
    expect(byM).toBe(total);
    expect(series).toBe(total);
  });
});

describe("recurring detection", () => {
  it("finds a monthly subscription and its price increase", () => {
    const txns = [t("2026-08-03", -3449, "PURCHASE", "Adobe"), t("2026-09-03", -3449, "PURCHASE", "Adobe"), t("2026-10-03", -3999, "PURCHASE", "Adobe"), t("2026-10-05", -100, "PURCHASE", "Once")];
    const r = detectRecurring(txns);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ merchant: "Adobe", cadence: "monthly", priceChangeCents: 550 });
  });
});

describe("price changes", () => {
  it("doesn't call a restaurant's varying bill a price increase", () => {
    const r = detectRecurring([t("2026-08-16", -10830, "PURCHASE", "Bistro"), t("2026-09-16", -11130, "PURCHASE", "Bistro"), t("2026-10-16", -11430, "PURCHASE", "Bistro")]);
    expect(r[0].priceChangeCents).toBe(0);
  });
});

describe("anomalies", () => {
  it("doesn't flag a regular rent payment as unusual", async () => {
    const { detectAnomalies } = await import("@/lib/engine/analytics");
    const hist = [t("2026-08-03", -240000, "PURCHASE", "Landlord"), t("2026-09-03", -240000, "PURCHASE", "Landlord")];
    expect(detectAnomalies(hist, [t("2026-10-03", -240000, "PURCHASE", "Landlord")])).toEqual([]);
  });
});

describe("statement coverage", () => {
  it("marks missing and partial months", () => {
    const c = coverage([{ start: new Date("2026-08-16T00:00:00Z"), end: new Date("2026-09-30T00:00:00Z") }], ["2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(c.map((x) => x.status)).toEqual(["NOT_STARTED", "PARTIAL", "COMPLETE", "MISSING"]);
  });
});

describe("plain-language explanation", () => {
  it("names the drivers of a change", () => {
    const sep = [t("2026-09-04", -12000, "PURCHASE", "Amazon"), t("2026-09-07", -1150, "PURCHASE", "Slack")];
    const oct = [t("2026-10-04", -75500, "PURCHASE", "Amazon"), t("2026-10-07", -1150, "PURCHASE", "Slack")];
    const ins = explainMonth(oct, sep, "2026-10", "2026-09", "CAD");
    expect(ins[0].text).toMatch(/You spent \$635\.00 more in October than in September/);
    expect(ins[0].text).toMatch(/Amazon/);
    expect(compareGroups(groupSpending(oct, byMerchant), groupSpending(sep, byMerchant))[0].changePct).toBeCloseTo(529.17, 1);
  });
});
