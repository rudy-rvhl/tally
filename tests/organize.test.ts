import { describe, expect, it } from "vitest";
import { companyKey, mentionsBuilding, parsePlan, phraseIn, sameBuilding } from "@/lib/engine/organize";

describe("organize plan", () => {
  it("reads one company per line: account words | buildings", () => {
    const { companies, errors } = parsePlan(`
      # my companies
      1001-2002 Québec Inc: 1001 | Maple, 12 Oak, 14 Oak, St-Laurent
      20304050 Canada Inc: 20304050 Desjardins, Amex, Maple | 16 Oak, Maple
      nonsense line`);
    expect(companies).toEqual([
      { name: "1001-2002 Québec Inc", accountWords: ["1001"], buildings: ["Maple", "12 Oak", "14 Oak", "St-Laurent"] },
      { name: "20304050 Canada Inc", accountWords: ["20304050 Desjardins", "Amex", "Maple"], buildings: ["16 Oak", "Maple"] },
    ]);
    expect(errors).toHaveLength(1);
  });

  it("matches companies by their number and accounts by words in their name, bank or statement", () => {
    expect(companyKey("1001-2002 Québec Inc")).toBe("1001");
    expect(companyKey("1001-2002 QUEBEC INC")).toBe("1001");
    expect(companyKey("20304050 Canada Inc.")).toBe("20304050");
    expect(phraseIn("20304050 Desjardins", "Compte d'opérations Desjardins 20304050 CANADA INC.")).toBe(true);
    expect(phraseIn("20304050 Desjardins", "Compte d'opérations Desjardins 1001-2002 QUEBEC INC")).toBe(false);
    expect(phraseIn("Amex", "Business Platinum American Express")).toBe(true);
    expect(phraseIn("1001", "Business savings Scotiabank 1001-2002 QUEBEC INC")).toBe(true);
    expect(phraseIn("1001", "Scotiabank 21001")).toBe(false);
  });

  it("recognises the same building written differently, and buildings named in transactions", () => {
    expect(sameBuilding("12 Oak", "12 Av. Oak")).toBe(true);
    expect(sameBuilding("12 Oak", "14 Av. Oak")).toBe(false);
    expect(sameBuilding("St-Laurent", "5473 Rue Saint-Laurent")).toBe(true);
    expect(sameBuilding("Maple", "Maple")).toBe(true);
    expect(mentionsBuilding("12 Av. Oak", "HYDRO-QUEBEC 12 OAK APT 3")).toBe(true);
    expect(mentionsBuilding("12 Av. Oak", "REF 12 PAYMENT")).toBe(false);
    expect(mentionsBuilding("Maple", "PLOMBERIE MAPLE BUILDING")).toBe(true);
  });
});
