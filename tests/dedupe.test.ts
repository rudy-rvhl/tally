import { describe, expect, it } from "vitest";
import { checkDuplicates, fingerprints } from "@/lib/engine/dedupe";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("duplicate protection", () => {
  const file = [
    { date: d("2026-10-04"), amountCents: -485, description: "TIM HORTONS #2231" },
    { date: d("2026-10-04"), amountCents: -485, description: "TIM HORTONS #2231" },
    { date: d("2026-10-17"), amountCents: -6327, description: "STAPLES STORE 112" },
  ];
  it("keeps two identical same-day purchases distinct", () => {
    const fps = fingerprints(file);
    expect(new Set(fps).size).toBe(3);
  });
  it("re-uploading the same statement imports nothing new", () => {
    const fps = fingerprints(file);
    const existing = file.map((t, i) => ({ ...t, id: `t${i}`, fingerprint: fps[i] }));
    expect(checkDuplicates(file, existing).map((v) => v.status)).toEqual(["ALREADY_IMPORTED", "ALREADY_IMPORTED", "ALREADY_IMPORTED"]);
  });
  it("an overlapping statement with one extra coffee imports only the new one", () => {
    const existing = fingerprints(file.slice(0, 1)).map((fp) => ({ ...file[0], id: "t0", fingerprint: fp }));
    expect(checkDuplicates(file, existing).map((v) => v.status)).toEqual(["ALREADY_IMPORTED", "NEW", "NEW"]);
  });
  it("flags near matches for review instead of dropping them", () => {
    const existing = [{ id: "x", fingerprint: "other", date: d("2026-10-15"), amountCents: -6327, description: "STAPLES #112" }];
    const v = checkDuplicates([file[2]], existing)[0];
    expect(v.status).toBe("POSSIBLE_DUPLICATE");
    expect(v.matchId).toBe("x");
  });
  it("FITIDs are deterministic", () => {
    expect(fingerprints([{ ...file[0], externalId: "S1" }])[0]).toBe("fitid:S1");
  });
});
