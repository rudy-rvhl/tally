/**
 * Duplicate protection.
 *
 * 1. Deterministic fingerprint per transaction: the bank's FITID when present,
 *    otherwise hash(date | amount | cleaned description | occurrence #). The
 *    occurrence number keeps two genuine identical coffees on the same day distinct
 *    while making a re-upload of the same file produce identical fingerprints.
 * 2. Exact duplicates (same date, amount and cleaned description already stored,
 *    counted as a multiset) are skipped by default but shown in the preview.
 * 3. Near matches (same amount, within 3 days, similar description) are imported
 *    and flagged for review. Nothing is ever silently deleted.
 */
import { createHash } from "node:crypto";
import { cleanDescriptor, descriptorSimilarity } from "./merchants";
import { daysBetween, isoDate } from "./dates";

export interface DedupeInput { date: Date; amountCents: number; description: string; externalId?: string | null }
export interface ExistingTxn extends DedupeInput { id: string; fingerprint: string }

export function baseKey(t: DedupeInput): string {
  return `${isoDate(t.date)}|${t.amountCents}|${cleanDescriptor(t.description)}`;
}

/** Fingerprints for a batch, in file order. */
export function fingerprints(txns: DedupeInput[]): string[] {
  const seen = new Map<string, number>();
  return txns.map((t) => {
    if (t.externalId) return `fitid:${t.externalId}`;
    const k = baseKey(t);
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return "h:" + createHash("sha256").update(`${k}|${n}`).digest("hex").slice(0, 32);
  });
}

export type DuplicateStatus = "NEW" | "ALREADY_IMPORTED" | "POSSIBLE_DUPLICATE";
export interface DuplicateVerdict { status: DuplicateStatus; matchId?: string; reason?: string }

export function checkDuplicates(incoming: DedupeInput[], existing: ExistingTxn[]): DuplicateVerdict[] {
  const fps = fingerprints(incoming);
  const byFp = new Map(existing.map((e) => [e.fingerprint, e]));
  const pool = new Map<string, ExistingTxn[]>();
  for (const e of existing) {
    const k = baseKey(e);
    pool.set(k, [...(pool.get(k) ?? []), e]);
  }
  const used = new Set<string>();
  return incoming.map((t, i) => {
    const fpHit = byFp.get(fps[i]);
    if (fpHit && !used.has(fpHit.id)) {
      used.add(fpHit.id);
      return { status: "ALREADY_IMPORTED", matchId: fpHit.id, reason: "This exact transaction is already in LedgerIQ." };
    }
    const sameKey = (pool.get(baseKey(t)) ?? []).find((e) => !used.has(e.id));
    if (sameKey) {
      used.add(sameKey.id);
      return { status: "ALREADY_IMPORTED", matchId: sameKey.id, reason: "Same date, amount and description as a transaction you already imported." };
    }
    const near = existing.find((e) => !used.has(e.id) && e.amountCents === t.amountCents && daysBetween(e.date, t.date) <= 3 &&
      descriptorSimilarity(e.description, t.description) >= 0.5);
    if (near) return { status: "POSSIBLE_DUPLICATE", matchId: near.id, reason: "Same amount a few days apart with a similar description. It might be the same purchase." };
    return { status: "NEW" };
  });
}
