import { describe, expect, it } from "vitest";
import { breakdown, parseScope, scopeValue, scopeWhere, type ResolvedScope } from "../src/lib/scope";

const companies = [
  { id: "c1", name: "Alpha Holdings", buildings: [{ id: "b1", name: "12 Main St", address: null }, { id: "b2", name: "40 Oak Ave", address: null }] },
  { id: "c2", name: "Beta Properties", buildings: [] },
];
const resolved = (scope: ResolvedScope["scope"]): ResolvedScope => ({
  scope, label: "", companies, multi: true,
  company: scope.type === "company" ? companies.find((c) => c.id === scope.id)! : scope.type === "building" ? companies[0] : null,
  building: scope.type === "building" ? companies[0].buildings.find((b) => b.id === scope.id)! : null,
});
const rows = [
  { id: 1, companyId: "c1", buildingId: "b1" },
  { id: 2, companyId: "c1", buildingId: "b2" },
  { id: 3, companyId: "c1", buildingId: null },
  { id: 4, companyId: "c2", buildingId: null },
];

describe("scope", () => {
  it("parses and round-trips values, falling back to everything", () => {
    expect(parseScope("c:abc123")).toEqual({ type: "company", id: "abc123" });
    expect(parseScope("b:xyz")).toEqual({ type: "building", id: "xyz" });
    for (const bad of [undefined, "", "all", "x:1", "c:", "b:a b", "c:../etc"]) expect(parseScope(bad)).toEqual({ type: "all" });
    expect(scopeValue(parseScope("b:xyz"))).toBe("b:xyz");
    expect(scopeValue({ type: "all" })).toBe("all");
  });

  it("filters a building by the transaction's own building, else its account's", () => {
    expect(scopeWhere({ type: "building", id: "b1" })).toEqual({ OR: [{ buildingId: "b1" }, { buildingId: null, account: { buildingId: "b1" } }] });
    expect(scopeWhere({ type: "company", id: "c1" })).toEqual({ OR: [{ building: { companyId: "c1" } }, { buildingId: null, account: { companyId: "c1" } }] });
    expect(scopeWhere({ type: "all" })).toBeNull();
  });

  it("splits everything into companies, with each company's buildings and unassigned money", () => {
    const b = breakdown(resolved({ type: "all" }), rows);
    expect(b.map((r) => [r.label, r.depth, r.rows.map((x) => x.id)])).toEqual([
      ["Alpha Holdings", 0, [1, 2, 3]],
      ["12 Main St", 1, [1]],
      ["40 Oak Ave", 1, [2]],
      ["Alpha Holdings: not assigned to a building", 1, [3]],
      ["Beta Properties", 0, [4]],
    ]);
    // Every row is counted exactly once at the company level: nothing is mixed or doubled.
    expect(b.filter((r) => r.depth === 0).flatMap((r) => r.rows).length).toBe(rows.length);
  });

  it("splits one company into its buildings, and shows nothing for a single building", () => {
    const b = breakdown(resolved({ type: "company", id: "c1" }), rows.filter((r) => r.companyId === "c1"));
    expect(b.map((r) => [r.value, r.label])).toEqual([["b:b1", "12 Main St"], ["b:b2", "40 Oak Ave"], [null, "Not assigned to a building"]]);
    expect(breakdown(resolved({ type: "building", id: "b1" }), rows)).toEqual([]);
    expect(breakdown(resolved({ type: "company", id: "c2" }), [rows[3]])).toEqual([]);
  });
});
