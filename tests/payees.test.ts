import { describe, expect, it } from "vitest";
import { detectFrequency, payeeMonths } from "@/lib/engine/payees";
import { identifyMerchant } from "@/lib/engine/merchants";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
const window12 = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);

describe("payee tracker", () => {
  const pays = [
    { date: d("2026-02-14"), cents: 90000 }, { date: d("2026-03-14"), cents: 90000 },
    { date: d("2026-05-14"), cents: 45000 },                                  // half
    { date: d("2026-06-14"), cents: 90000 }, { date: d("2026-06-20"), cents: 90000 }, // twice
    { date: d("2026-08-14"), cents: 90000 },
  ];
  it("shows each month and the months a monthly bill was missed", () => {
    const r = payeeMonths(pays, months, new Set(), d("2026-02-14"));
    expect(r.frequency).toBe("MONTHLY");
    expect(r.months.map((m) => m.status)).toEqual(["NOT_STARTED", "PAID", "PAID", "MISSING", "LOW", "HIGH", "MISSING", "PAID"]);
    expect(r.missing).toEqual(["2026-04", "2026-07"]);
    expect([r.usualCents, r.paidMonths, r.expectedMonths, r.totalCents]).toEqual([90000, 5, 7, 495000]);
    expect(r.months[5].count).toBe(2);
  });
  it("doesn't call a month missed when its statement wasn't imported", () => {
    const r = payeeMonths(pays, months, new Set(["2026-07"]), d("2026-02-14"));
    expect(r.months[6].status).toBe("NO_STATEMENT");
    expect(r.missing).toEqual(["2026-04"]);
    expect(r.expectedMonths).toBe(6);
  });

  it("tells monthly bills from yearly, quarterly, one-time and occasional payments", () => {
    expect(detectFrequency(["2026-01-03", "2026-02-03", "2026-03-04", "2026-05-03"].map(d))).toBe("MONTHLY");
    expect(detectFrequency(["2024-03-15", "2025-03-14", "2026-03-16"].map(d))).toBe("YEARLY");
    expect(detectFrequency(["2025-03-15", "2026-04-02"].map(d))).toBe("YEARLY");
    expect(detectFrequency(["2025-10-01", "2026-01-02", "2026-04-01", "2026-07-03"].map(d))).toBe("QUARTERLY");
    expect(detectFrequency([d("2026-06-10")])).toBe("ONE_TIME");
    expect(detectFrequency(["2026-01-03", "2026-04-20", "2026-05-02", "2026-09-11"].map(d))).toBe("IRREGULAR");
  });

  it("a yearly insurance premium isn't missed in the months between payments", () => {
    const ins = [{ date: d("2025-03-15"), cents: 240000 }, { date: d("2026-03-14"), cents: 252000 }];
    const r = payeeMonths(ins, window12, new Set(), d("2025-03-15"));
    expect(r.frequency).toBe("YEARLY");
    expect(r.missing).toEqual([]);
    expect(r.months.filter((m) => m.status === "NOT_DUE")).toHaveLength(11);
    expect(r.months[2].status).toBe("PAID");
    expect([r.paidMonths, r.expectedMonths, r.nextDue]).toEqual([1, 1, "2027-03"]);
  });

  it("a yearly payment not made a year (and a grace month) later is missing", () => {
    const ins = [{ date: d("2025-02-10"), cents: 240000 }];
    const r = payeeMonths(ins, window12, new Set(), d("2025-02-10"), "YEARLY");
    expect(r.missing).toEqual(["2026-02"]);
    expect(r.months[1].status).toBe("MISSING");
    // paid a month late: fine
    const late = payeeMonths([...ins, { date: d("2026-03-05"), cents: 240000 }], window12, new Set(), d("2025-02-10"), "YEARLY");
    expect(late.missing).toEqual([]);
  });

  it("one-time and occasional payments are never 'missed'", () => {
    const one = payeeMonths([{ date: d("2026-06-10"), cents: 50000 }], window12, new Set(), d("2026-06-10"));
    expect(one.frequency).toBe("ONE_TIME");
    expect(one.missing).toEqual([]);
    expect(one.nextDue).toBeNull();
    expect(one.months.slice(6).every((m) => m.status === "NOT_DUE")).toBe(true);
  });

  it("you can say a payee is a monthly bill: then every month without a payment is missed", () => {
    const r = payeeMonths([{ date: d("2026-09-14"), cents: 90000 }, { date: d("2026-10-14"), cents: 90000 }], window12, new Set(), d("2026-09-14"), "MONTHLY");
    expect([r.detected, r.frequency]).toEqual(["IRREGULAR", "MONTHLY"]);
    expect(r.missing).toEqual(["2026-11", "2026-12"]);
  });

  it("names e-transfers after the person, not 'Interac e-Transfer'", () => {
    expect(identifyMerchant("Interac e-Transfer® Out to PRONTO RENOVATION").name).toBe("Pronto Renovation");
    expect(identifyMerchant("Interac e-Transfer In from JANE TENANT").name).toBe("Jane Tenant");
    expect(identifyMerchant("VIREMENT INTERAC ENVOYE A PRONTO RENO").name).toBe("Pronto Reno");
  });
});
