/** Turn bank-connection data (Plaid) into LedgerIQ's own shapes. Pure: no database, no network. */
import type { AccountTypeName, ParsedTxn } from "./types";

export interface FeedTxn {
  transaction_id: string; account_id: string; amount: number; date: string; name: string;
  merchant_name?: string | null; original_description?: string | null; pending: boolean; pending_transaction_id?: string | null;
}

/** Plaid: positive amount = money out of the account (for bank accounts and cards alike). LedgerIQ: negative = money out. */
export const feedCents = (amount: number) => -Math.round(amount * 100);
export const feedExternalId = (transactionId: string) => `plaid:${transactionId}`;

export function feedToParsed(t: FeedTxn): ParsedTxn {
  return {
    date: new Date(`${t.date}T00:00:00Z`),
    amountCents: feedCents(t.amount),
    // The bank's own wording when available: it matches imported statements and your supplier rules.
    description: (t.original_description || t.name || t.merchant_name || "(no description)").replace(/\s+/g, " ").trim(),
    externalId: feedExternalId(t.transaction_id),
    pending: t.pending,
    sourceRow: 0,
    warnings: [],
  };
}

export function feedAccountType(type?: string | null, subtype?: string | null, business = true): AccountTypeName {
  const s = (subtype ?? "").toLowerCase();
  if (type === "credit") return business ? "BUSINESS_CREDIT_CARD" : "CREDIT_CARD";
  if (type === "loan") return s.includes("line of credit") || s.includes("credit") ? "LINE_OF_CREDIT" : "OTHER";
  if (type === "depository") {
    if (/saving|money market|cd|gic|hsa|cash management/.test(s)) return business ? "BUSINESS_SAVINGS" : "PERSONAL_SAVINGS";
    return business ? "BUSINESS_CHEQUING" : "PERSONAL_CHEQUING";
  }
  return "OTHER";
}

/** A bank balance in cents, as LedgerIQ shows it (cards and credit lines: amount owed). */
export const feedBalanceCents = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 100));
