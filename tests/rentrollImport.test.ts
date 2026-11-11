import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildLines, pdfWords } from "@/lib/engine/parsers/pdf";
import { parseRentRollLines, parseRentRollTable, rentRollCheck } from "@/lib/engine/parsers/rentroll";
import { addressKey, sameTenant, unitKey } from "@/lib/services/rentrollImport";
import { categoryJumps, possibleDoublePayments, propertyMetrics, supplierSpikes } from "@/lib/engine/analysis";
import type { AnalyticTxn } from "@/lib/engine/types";

describe("rent roll report (Stessa layout PDF)", () => {
  it("reads every property and unit, and matches the report's own totals", async () => {
    const w = await pdfWords(readFileSync(path.join(__dirname, "..", "samples", "pdf", "rent-roll-stessa.pdf")));
    const r = parseRentRollLines(buildLines(w!.words));
    expect([r.source, r.asOf]).toEqual(["Stessa", "2026-10-31"]);
    expect(r.properties.map((p) => [p.name, p.units.length])).toEqual([["12 rue Principale", 5], ["40 avenue des Érables", 2]]);
    const u = r.properties[0].units;
    expect(u[0]).toMatchObject({ unit: "Unit 01", layout: "2 / 1", tenant: "Marie Tremblay", rentCents: 125000, balanceCents: 125000, moveIn: "2026-01-01", leaseStart: "2026-07-01", leaseEnd: "2027-06-30" });
    expect(u[2]).toMatchObject({ tenant: "Paul Roy & Lucie Roy", balanceCents: -10000 }); // credit in brackets
    expect(u[3]).toMatchObject({ unit: "Unit 04", tenant: null }); // vacant
    expect(r.properties[1].units[0]).toMatchObject({ unit: "101", sqft: 600, tenant: "AHMED FOUDA", rentCents: null, noLease: true, balanceCents: 150000 });
    expect(rentRollCheck(r)).toMatchObject({ units: 7, vacant: 1, noLease: 1, rentCents: 548000, balanceCents: 475000, rentMatches: true, balanceMatches: true });
  });

  it("reads the same columns from a CSV export, with a property column", () => {
    const r = parseRentRollTable([
      ["Property", "Unit", "Bed / Bath", "Tenant", "Rent", "Balance Due", "Move-In", "Lease Start", "Lease Expires"],
      ["12 rue Principale", "1", "2 / 1", "Marie Tremblay", "1,250.00", "(50.00)", "01/01/2026", "07/01/2026", "06/30/2027"],
      ["12 rue Principale", "2", "1 / 1", "Vacant", "", "", "", "", ""],
      ["TOTAL", "", "", "", "1,250.00", "(50.00)", "", "", ""],
    ]);
    expect(r.properties[0].units).toHaveLength(2);
    expect(r.properties[0].units[0]).toMatchObject({ tenant: "Marie Tremblay", rentCents: 125000, balanceCents: -5000, leaseEnd: "2027-06-30" });
    expect(rentRollCheck(r)).toMatchObject({ rentMatches: true, balanceMatches: true, vacant: 1 });
  });

  it("matches report properties to your buildings and units to existing tenants", () => {
    expect(addressKey("100 Av. Exemple")).toBe(addressKey("100 avenue Exemple"));
    expect(addressKey("40 avenue des Érables")).toBe(addressKey("40 Erables"));
    expect(addressKey("102 av. Exemple")).not.toBe(addressKey("100 Av. Exemple"));
    expect(unitKey("Unit 01")).toBe(unitKey("1"));
    expect(unitKey("5473A")).toBe("5473a");
    expect(sameTenant("Paul Roy & Lucie Roy", "PAUL ROY")).toBe(true);
    expect(sameTenant("Marie Tremblay", "Jean Gagnon")).toBe(false);
  });
});

const tx = (id: string, date: string, cents: number, kind: AnalyticTxn["kind"], merchant: string | null, category: string | null = null, extra: Partial<AnalyticTxn> = {}): AnalyticTxn =>
  ({ id, date: new Date(`${date}T00:00:00Z`), amountCents: cents, kind, accountId: "a", merchant, merchantId: merchant, category, subcategory: null, categoryId: category, pending: false, ...extra });

describe("property analysis", () => {
  it("computes income, rent, NOI, debt payments and cash flow", () => {
    const m = propertyMetrics([
      tx("1", "2026-09-01", 150000, "INCOME", "Tenant", null, { tenantId: "t1" }),
      tx("2", "2026-09-15", 20000, "INCOME", "Laundry"),
      tx("3", "2026-09-10", -40000, "PURCHASE", "Hydro", "Housing"),
      tx("4", "2026-09-20", -30000, "INTEREST", "Bank", "Financial"),
      tx("5", "2026-09-20", -50000, "LOAN_PAYMENT", null),
      tx("6", "2026-09-21", -100000, "TRANSFER", null),
    ], ["2026-09"]);
    expect(m).toMatchObject({ incomeCents: 170000, rentCents: 150000, otherIncomeCents: 20000, opexCents: 40000, interestCents: 30000, principalCents: 50000, noiCents: 130000, cashFlowCents: 50000 });
    expect(m.expenseRatio).toBeCloseTo(40000 / 170000);
  });

  it("spots possible double payments, bill spikes and growing categories", () => {
    const hydro = ["2026-05-10", "2026-06-10", "2026-07-10", "2026-08-10"].map((d, i) => tx(`h${i}`, d, -20000, "PURCHASE", "Hydro", "Housing"));
    expect(supplierSpikes([...hydro, tx("h9", "2026-09-10", -52000, "PURCHASE", "Hydro", "Housing")])[0]).toMatchObject({ merchant: "Hydro", lastCents: 52000, usualCents: 20000 });
    expect(possibleDoublePayments([tx("a", "2026-09-01", -45000, "PURCHASE", "Plumber"), tx("b", "2026-09-03", -45000, "PURCHASE", "Plumber"), tx("c", "2026-09-03", -45000, "PURCHASE", "Painter")])).toHaveLength(1);
    expect(categoryJumps([tx("x", "2026-09-01", -200000, "PURCHASE", "R", "Maintenance")], [tx("y", "2025-09-01", -100000, "PURCHASE", "R", "Maintenance")])[0]).toMatchObject({ label: "Maintenance", nowCents: 200000, beforeCents: 100000 });
  });
});
