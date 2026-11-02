import { describe, expect, it } from "vitest";
import { parseAmountToCents, formatMoney } from "@/lib/engine/money";
import { parseDate, isoDate } from "@/lib/engine/dates";

describe("parseAmountToCents", () => {
  it.each([
    ["1,234.56", 123456], ["-45.10", -4510], ["(12.00)", -1200], ["12.00-", -1200], ["$5", 500],
    ["1 234,56", 123456], ["12,50", 1250], ["100.00 CR", 10000], ["100.00 DR", -10000], ["0.105", 11], ["", null], ["abc", null],
  ])("%s -> %s", (raw, cents) => expect(parseAmountToCents(raw)).toBe(cents));
  it("avoids float drift", () => expect(parseAmountToCents("0.29")).toBe(29));
});

describe("parseDate", () => {
  it("reads common bank formats", () => {
    expect(isoDate(parseDate("10/02/2026", "MDY")!)).toBe("2026-10-02");
    expect(isoDate(parseDate("10/02/2026", "DMY")!)).toBe("2026-02-10");
    expect(isoDate(parseDate("2026-10-02")!)).toBe("2026-10-02");
    expect(isoDate(parseDate("20261002120000")!)).toBe("2026-10-02");
    expect(isoDate(parseDate("02 Oct 2026")!)).toBe("2026-10-02");
    expect(isoDate(parseDate("Oct 2, 2026")!)).toBe("2026-10-02");
    expect(isoDate(parseDate("OCT 02", "MDY", 2026)!)).toBe("2026-10-02");
    expect(parseDate("02/30/2026", "MDY")).toBeNull();
  });
});

describe("formatMoney", () => {
  it("formats CAD and negatives", () => {
    expect(formatMoney(245000)).toBe("$2,450.00");
    expect(formatMoney(-1200)).toBe("-$12.00");
    expect(formatMoney(1000, "USD")).toContain("US$");
  });
});
