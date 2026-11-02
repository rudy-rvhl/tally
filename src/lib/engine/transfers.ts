/**
 * Transfer matching: link money leaving one of the user's accounts with the same
 * amount arriving in another (e.g. chequing -> credit card payment), so neither
 * side is counted as spending or income.
 */
import { daysBetween } from "./dates";
import type { TxnKindName } from "./types";

export interface TransferCandidate {
  id: string; accountId: string; date: Date; amountCents: number; currency: string; kind: TxnKindName; transferGroupId?: string | null;
}
export interface TransferPair { outId: string; inId: string; confidence: number; days: number }

const MOVEMENT: TxnKindName[] = ["TRANSFER", "CARD_PAYMENT", "LOAN_PAYMENT"];

export function matchTransfers(txns: TransferCandidate[], maxDays = 4): TransferPair[] {
  const open = txns.filter((t) => !t.transferGroupId);
  const outs = open.filter((t) => t.amountCents < 0).sort((a, b) => a.date.getTime() - b.date.getTime());
  const ins = open.filter((t) => t.amountCents > 0);
  const usedIn = new Set<string>();
  const pairs: TransferPair[] = [];
  for (const o of outs) {
    let best: { t: TransferCandidate; score: number; days: number } | null = null;
    for (const i of ins) {
      if (usedIn.has(i.id) || i.accountId === o.accountId || i.currency !== o.currency || i.amountCents !== -o.amountCents) continue;
      const days = daysBetween(i.date, o.date);
      if (days > maxDays) continue;
      const movement = (MOVEMENT.includes(o.kind) ? 1 : 0) + (MOVEMENT.includes(i.kind) ? 1 : 0);
      if (movement === 0) continue; // two ordinary transactions with equal amounts are not evidence of a transfer
      const score = movement * 0.35 + (1 - days / (maxDays + 1)) * 0.3;
      if (!best || score > best.score) best = { t: i, score, days };
    }
    if (best) {
      usedIn.add(best.t.id);
      pairs.push({ outId: o.id, inId: best.t.id, confidence: Math.min(1, Number(best.score.toFixed(2))), days: best.days });
    }
  }
  return pairs;
}
