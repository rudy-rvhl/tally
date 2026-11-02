import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "@/lib/engine/parsers/csv";
import { parseOfx } from "@/lib/engine/parsers/ofx";
import { parseStatementText } from "@/lib/engine/parsers/pdf";
import { detectFileKind } from "@/lib/engine/parsers";
import { isoDate } from "@/lib/engine/dates";

const sample = (f: string) => readFileSync(path.join(__dirname, "..", "samples", f));

describe("CSV import", () => {
  it("reads the RBC layout with signed amounts", () => {
    const r = parseCsv(sample("rbc-business-chequing-2026-08-to-10.csv").toString(), "BUSINESS_CHEQUING");
    expect(r.institution).toBe("RBC Royal Bank");
    expect(r.transactions.length).toBe(24);
    const rent = r.transactions.find((t) => t.description.startsWith("RENT"))!;
    expect(rent.amountCents).toBe(-240000);
    expect(isoDate(r.periodStart!)).toBe("2026-08-01");
    expect(isoDate(r.periodEnd!)).toBe("2026-10-31");
  });
  it("inverts Amex charges (listed as positive) into money out", () => {
    const r = parseCsv(sample("amex-business-2026-08-to-10.csv").toString(), "BUSINESS_CREDIT_CARD");
    expect(r.institution).toBe("American Express");
    expect(r.mapping?.amountSign).toBe("INVERT");
    const adobe = r.transactions.find((t) => t.description.startsWith("ADOBE"))!;
    expect(adobe.amountCents).toBe(-3449);
    const pay = r.transactions.find((t) => t.description.startsWith("PAYMENT RECEIVED"))!;
    expect(pay.amountCents).toBeGreaterThan(0);
  });
  it("reads a headerless TD file with debit/credit columns", () => {
    const r = parseCsv(sample("td-personal-chequing-2026-10.csv").toString(), "PERSONAL_CHEQUING");
    expect(r.institution).toBe("TD Canada Trust");
    expect(r.transactions.map((t) => t.amountCents)).toEqual([50000, -485, -485, -6327]);
  });
  it("asks the user when columns can't be detected", () => {
    const r = parseCsv("foo,bar\nhello,world\n", "BUSINESS_CHEQUING");
    expect(r.transactions.length).toBe(0);
    expect(r.notes[0]).toMatch(/choose them/);
  });
  it("detects semicolon French formats", () => {
    const r = parseCsv("Date;Description;Débit;Crédit\n2026-10-02;EPICERIE MARCHE;12,50;\n2026-10-03;DEPOT;;1 000,00\n", "BUSINESS_CHEQUING");
    expect(r.transactions.map((t) => t.amountCents)).toEqual([-1250, 100000]);
  });
});

describe("OFX import", () => {
  it("parses FITIDs, period and balance owed", () => {
    const r = parseOfx(sample("scotiabank-visa-2026-09-to-10.ofx").toString(), "CREDIT_CARD");
    expect(r.institution).toBe("Scotiabank");
    expect(r.transactions.length).toBe(11);
    expect(r.transactions[0].externalId).toBe("S1");
    expect(r.closingBalanceCents).toBe(107606);
    expect(r.accountHint).toBe("8812");
    expect(isoDate(r.periodEnd!)).toBe("2026-10-31");
  });
});

describe("PDF text import", () => {
  it("derives signs from the running balance", () => {
    const text = `Scotiabank Business Account ****4410
Statement period Oct 1, 2026 to Oct 31, 2026
Opening balance $1,000.00
Oct 02 DEPOSIT STRIPE 500.00 1,500.00
Oct 03 STAPLES STORE 112 63.27 1,436.73
Closing balance $1,436.73`;
    const r = parseStatementText(text, "BUSINESS_CHEQUING");
    expect(r.institution).toBe("Scotiabank");
    expect(r.openingBalanceCents).toBe(100000);
    expect(r.closingBalanceCents).toBe(143673);
    expect(r.transactions.map((t) => t.amountCents)).toEqual([50000, -6327]);
    expect(r.transactions.every((t) => t.warnings.length === 0)).toBe(true);
  });
});

describe("file sniffing", () => {
  it("uses content, not just extension", () => {
    expect(detectFileKind("x.txt", Buffer.from("%PDF-1.4"))).toBe("PDF");
    expect(detectFileKind("x.dat", Buffer.from("OFXHEADER:100"))).toBe("OFX");
    expect(detectFileKind("x.qfx", Buffer.from("OFXHEADER:100"))).toBe("QFX");
  });
});
