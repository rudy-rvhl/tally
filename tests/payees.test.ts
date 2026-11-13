import { describe, expect, it } from "vitest";
import { payeeMonths } from "@/lib/engine/payees";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];

describe("payee tracker", () => {
  const pays = [
    { date: d("2026-02-14"), cents: 90000 }, { date: d("2026-03-14"), cents: 90000 },
    { date: d("2026-05-14"), cents: 45000 },                                  // half
    { date: d("2026-06-14"), cents: 90000 }, { date: d("2026-06-20"), cents: 90000 }, // twice
    { date: d("2026-08-14"), cents: 90000 },
  ];
  it("shows each month and the months that were missed", () => {
    const r = payeeMonths(pays, months, new Set(), d("2026-02-14"));
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
});
