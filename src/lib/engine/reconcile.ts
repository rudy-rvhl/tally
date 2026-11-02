/**
 * Statement reconciliation.
 *
 * Deposit accounts (balance = money you have):
 *   opening + inflows - outflows = calculated closing
 * Liability accounts (balance = money you owe):
 *   opening + charges (outflows) - payments/credits (inflows) = calculated closing
 * Only posted, non-excluded transactions in the statement period count.
 */
import { isLiability } from "./classify";
import type { AccountTypeName } from "./types";

export interface ReconTxn { id: string; amountCents: number; description: string; date: Date; pending?: boolean; excluded?: boolean }

export interface ReconciliationResult {
  liability: boolean;
  openingCents: number;
  statementClosingCents: number;
  inflowsCents: number;
  outflowsCents: number;
  calculatedClosingCents: number;
  differenceCents: number; // statement - calculated
  balanced: boolean;
  transactionCount: number;
  pendingExcluded: number;
  hints: string[];
}

export function reconcile(accountType: AccountTypeName, openingCents: number, statementClosingCents: number, txns: ReconTxn[]): ReconciliationResult {
  const liability = isLiability(accountType);
  const posted = txns.filter((t) => !t.pending && !t.excluded);
  const inflows = posted.filter((t) => t.amountCents > 0).reduce((s, t) => s + t.amountCents, 0);
  const outflows = posted.filter((t) => t.amountCents < 0).reduce((s, t) => s - t.amountCents, 0);
  const calculated = liability ? openingCents + outflows - inflows : openingCents + inflows - outflows;
  const diff = statementClosingCents - calculated;
  const hints: string[] = [];
  if (diff !== 0) {
    const abs = Math.abs(diff);
    const single = posted.find((t) => Math.abs(t.amountCents) === abs);
    if (single) hints.push(`The difference equals "${single.description}" (${(abs / 100).toFixed(2)}). It may be counted twice or entered with the wrong sign.`);
    const half = posted.find((t) => Math.abs(t.amountCents) * 2 === abs);
    if (half) hints.push(`The difference is exactly double "${half.description}". Its sign (money in vs. out) may be reversed.`);
    if (!single && !half) hints.push("A transaction may be missing from the import, or the statement balances were entered incorrectly.");
    const pend = txns.filter((t) => t.pending).length;
    if (pend) hints.push(`${pend} pending transaction(s) are not counted. Banks only include posted transactions in statement balances.`);
  }
  return {
    liability, openingCents, statementClosingCents, inflowsCents: inflows, outflowsCents: outflows,
    calculatedClosingCents: calculated, differenceCents: diff, balanced: diff === 0,
    transactionCount: posted.length, pendingExcluded: txns.filter((t) => t.pending).length, hints,
  };
}
