import { describe, expect, it } from "vitest";
import { identifyMerchant, cleanDescriptor } from "@/lib/engine/merchants";

describe("merchant consolidation", () => {
  it("combines Amazon descriptor variants into one family", () => {
    for (const d of ["AMZN MKTP CA", "AMAZON.CA", "AMZN Mktp 12345", "Amazon Marketplace", "AMZN Mktp CA*2K3LM9"]) {
      expect(identifyMerchant(d).name).toBe("Amazon");
    }
  });
  it("is less confident about sub-services and keeps AWS separate", () => {
    const prime = identifyMerchant("AMAZON PRIME*1A2B3");
    expect(prime.name).toBe("Amazon");
    expect(prime.confidence).toBeLessThan(0.9);
    expect(identifyMerchant("AWS EMEA aws.amazon.com").name).toBe("Amazon Web Services");
  });
  it("strips store numbers and city/province", () => {
    expect(cleanDescriptor("STARBUCKS #4412 MONTREAL QC")).toBe("STARBUCKS");
    expect(cleanDescriptor("POS PURCHASE TIM HORTONS #2231")).toBe("TIM HORTONS");
  });
  it("strips Interac e-transfer wording to find the payee", () => {
    expect(identifyMerchant("E-TRANSFER SENT J TREMBLAY DESIGN").name).toBe("Tremblay Design");
  });
  it("keeps the known category suggestion when matched through an alias", () => {
    const m = identifyMerchant("AMAZON.CA", new Map([["AMAZON.CA", "Amazon"]]));
    expect(m).toMatchObject({ source: "ALIAS", suggestedCategory: "Shopping > General merchandise" });
  });
  it("user aliases win", () => {
    const aliases = new Map([[cleanDescriptor("J TREMBLAY DESIGN"), "Tremblay Design Studio"]]);
    expect(identifyMerchant("J TREMBLAY DESIGN", aliases)).toMatchObject({ name: "Tremblay Design Studio", source: "ALIAS", confidence: 1 });
  });
  it("derives a readable name for unknown merchants with low confidence", () => {
    const m = identifyMerchant("RESTAURANT LE CHAMPLAIN MONTREAL QC");
    expect(m.name).toBe("Restaurant Le Champlain");
    expect(m.confidence).toBeLessThan(0.7);
  });
});

describe("Desjardins payee names", () => {
  it("finds the person or payee in Interac and bill-payment wording", () => {
    expect(identifyMerchant("Virement Interac de / MARIE TREMBLAY/").name).toBe("Marie Tremblay");
    expect(identifyMerchant("Paiement facture - AccèsD Internet / HYDRO-QUEBEC").name).toBe("Hydro-Québec");
  });
});
