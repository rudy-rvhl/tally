import { describe, expect, it } from "vitest";
import { matchDeposits, mentions, rentLedger, rentMonthOf, type Deposit, type TenantLite } from "@/lib/engine/rentroll";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const tenant = (id: string, name: string, rent: number, extra: Partial<TenantLite> = {}): TenantLite =>
  ({ id, name, unit: null, buildingId: "b1", accountId: "acc", rentCents: rent, dueDay: 1, leaseStart: d("2026-01-01"), leaseEnd: null, matchText: null, status: "ACTIVE", ...extra });
const dep = (id: string, date: string, cents: number, description: string, extra: Partial<Deposit> = {}): Deposit =>
  ({ id, date: d(date), amountCents: cents, description, accountId: "acc", buildingId: "b1", ...extra });

const tenants = [
  tenant("t1", "Marie Tremblay", 145000),
  tenant("t2", "Jean Gagnon", 120000),
  tenant("t3", "Paul Roy", 120000),
  tenant("t4", "Sofia Lopez", 98000, { matchText: "9123-4567 QUEBEC, LOPEZ CONSULTING" }),
];

describe("rent matching", () => {
  it("matches by the name on the statement, even when the amount differs (partial payment)", () => {
    const r = matchDeposits(tenants, [dep("a", "2026-10-01", 145000, "VIREMENT INTERAC DE MARIE TREMBLAY"), dep("b", "2026-10-03", 60000, "E-TRANSFER FROM J GAGNON")]);
    expect(r.matches).toEqual([
      { depositId: "a", tenantId: "t1", reason: "name on the statement" },
      { depositId: "b", tenantId: "t2", reason: "name on the statement" },
    ]);
  });

  it("matches the words you gave for a tenant who pays from a company", () => {
    expect(mentions(tenants[3], "DEPOSIT 9123-4567 QUEBEC INC")).toBe(true);
    expect(matchDeposits(tenants, [dep("c", "2026-10-02", 98000, "DEPOSIT 9123-4567 QUEBEC INC")]).matches[0].tenantId).toBe("t4");
  });

  it("matches by exact rent when the statement shows no name, and asks when two tenants pay the same rent", () => {
    const r = matchDeposits(tenants, [dep("d", "2026-10-01", 145000, "CREDIT MEMO 84612841 FREE INTERAC E-TRANSFER"), dep("e", "2026-10-01", 120000, "CREDIT MEMO 39450628 FREE INTERAC E-TRANSFER")]);
    expect(r.matches).toEqual([{ depositId: "d", tenantId: "t1", reason: "same amount as the rent" }]);
    expect(r.suggestions).toEqual([{ depositId: "e", tenantIds: ["t2", "t3"] }]);
  });

  it("ignores money out, other accounts and deposits outside the lease", () => {
    const r = matchDeposits(tenants, [
      dep("f", "2026-10-01", -145000, "MARIE TREMBLAY"),
      dep("g", "2026-10-01", 145000, "MARIE TREMBLAY", { accountId: "other" }),
      dep("h", "2025-06-01", 145000, "MARIE TREMBLAY"),
    ]);
    expect(r.matches).toEqual([]);
  });
});

describe("rent ledger", () => {
  const t = tenant("t1", "Marie Tremblay", 145000, { leaseStart: d("2026-07-01") });
  const months = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];
  it("gives each month a status and the balance owing", () => {
    const l = rentLedger(t, [
      { date: d("2026-06-28"), amountCents: 145000 }, // paid a few days early: counts for July
      { date: d("2026-08-15"), amountCents: 145000 }, // late
      { date: d("2026-09-01"), amountCents: 100000 }, // partial
    ], months, d("2026-10-20"), d("2026-06-01"));
    expect(l.months.map((m) => m.status)).toEqual(["NO_LEASE", "PAID", "LATE", "PARTIAL", "UNPAID", "UPCOMING"]);
    expect([l.late, l.partial, l.unpaid]).toEqual([1, 1, 1]);
    expect(l.balanceCents).toBe(4 * 145000 - 390000);
  });

  it("doesn't call months unpaid before the first statement we have", () => {
    const l = rentLedger(t, [{ date: d("2026-10-01"), amountCents: 145000 }], months, d("2026-10-20"), d("2026-10-01"));
    expect(l.months.map((m) => m.status)).toEqual(["NO_LEASE", "NO_DATA", "NO_DATA", "NO_DATA", "PAID", "UPCOMING"]);
    expect(l.balanceCents).toBe(0);
  });

  it("assigns early payments to the coming month", () => {
    expect(rentMonthOf(d("2026-09-25"), 1)).toBe("2026-10");
    expect(rentMonthOf(d("2026-09-15"), 1)).toBe("2026-09");
    expect(rentMonthOf(d("2026-10-10"), 15)).toBe("2026-10");
  });
});
