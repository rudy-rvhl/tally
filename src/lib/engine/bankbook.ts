/**
 * Bank book model: the month-by-month ledger accountants keep per bank account
 * (Date · # · Name · Description · inv. # · Debit · Credit · Balance).
 *
 * Conventions (from the company's point of view, as in a bank book):
 *   Debit  = money INTO the account       Credit = money OUT of the account
 *   Balance = what the account holds; for credit cards / lines of credit it is negative
 *             when money is owed, so every block satisfies  opening + Debit − Credit = closing.
 *
 * Balances come only from real anchors (statement balances or an opening balance the user
 * entered). Without an anchor they are left empty; nothing is invented.
 */
import { addMonths, monthRange } from "./dates";
import { identifyMerchant } from "./merchants";
import type { TxnKindName } from "./types";

export interface BookCategory { name: string; parent: string | null; bookCode: string | null; kind: "EXPENSE" | "INCOME" | "NON_OPERATING" }
export interface BookTxn {
  id: string;
  date: Date;
  amountCents: number; // + in, − out
  kind: TxnKindName;
  merchant: string | null;
  description: string;
  category: BookCategory | null;
  splits: { amountCents: number; category: BookCategory; memo?: string | null }[];
  /** Book number of the other account when this is a linked transfer / card payment. */
  counterpart?: string | null;
}
export interface BookAnchor { date: Date; balanceCents: number } // balance at END of `date`
export interface BookLine { date: Date | null; code: string | null; name: string; description: string; debitCents: number; creditCents: number }
export interface BookMonth { month: string; start: Date; end: Date; openingCents: number | null; closingCents: number | null; lines: BookLine[] }

const DAY = 86400000;
const UNCATEGORIZED = /^(uncategorized|miscellaneous)$/i;

/** Balance at the end of `date`, from the nearest anchor. */
export function balanceAt(date: Date, anchors: BookAnchor[], txns: { date: Date; amountCents: number }[]): number | null {
  if (!anchors.length) return null;
  const t = date.getTime();
  const before = anchors.filter((a) => a.date.getTime() <= t).sort((a, b) => b.date.getTime() - a.date.getTime())[0];
  if (before) {
    const from = before.date.getTime();
    return before.balanceCents + txns.filter((x) => x.date.getTime() > from && x.date.getTime() <= t).reduce((s, x) => s + x.amountCents, 0);
  }
  const after = [...anchors].sort((a, b) => a.date.getTime() - b.date.getTime())[0];
  const to = after.date.getTime();
  return after.balanceCents - txns.filter((x) => x.date.getTime() > t && x.date.getTime() <= to).reduce((s, x) => s + x.amountCents, 0);
}

const isMortgage = (t: BookTxn) => /hypoth|mortgage|\bpr \d|\bpret\b|pr[eê]t hypoth/i.test(t.description);

/** One or more book lines for a transaction (split transactions give one line per part). */
export function linesFor(t: BookTxn): Omit<BookLine, "date">[] {
  const side = (cents: number) => (cents >= 0 ? { debitCents: cents, creditCents: 0 } : { debitCents: 0, creditCents: -cents });
  const catDesc = (c: BookCategory | null) => (c && !UNCATEGORIZED.test(c.name) && c.kind === "EXPENSE" ? c.name : "");
  const code = (c: BookCategory | null) => c?.bookCode ?? null;

  if (t.splits.length) {
    if (t.kind === "LOAN_PAYMENT") {
      return t.splits.map((s) => ({
        code: code(s.category), name: isMortgage(t) ? "Mortgage" : "Loan payment",
        description: s.category.kind === "EXPENSE" ? "Interest" : "Capital", ...side(s.amountCents),
      }));
    }
    return t.splits.map((s) => ({ code: code(s.category), name: t.merchant ?? t.description, description: s.memo || catDesc(s.category), ...side(s.amountCents) }));
  }
  switch (t.kind) {
    case "FEE": return [{ code: code(t.category), name: "Bank fee", description: "", ...side(t.amountCents) }];
    case "INTEREST": return [{ code: code(t.category), name: "Interest", description: "Interest charged", ...side(t.amountCents) }];
    case "INCOME": {
      if (t.category?.name && /interest/i.test(t.category.name)) return [{ code: code(t.category), name: "Interest", description: "", ...side(t.amountCents) }];
      // Money received is summarised by its category ("Rent"), not by who paid, like a bank book.
      const label = t.category?.kind === "INCOME" ? t.category.name : t.merchant ?? t.description;
      return [{ code: code(t.category), name: label, description: "", ...side(t.amountCents) }];
    }
    case "LOAN_PAYMENT": return [{ code: code(t.category), name: isMortgage(t) ? "Mortgage" : "Loan payment", description: "", ...side(t.amountCents) }];
    case "CARD_PAYMENT": return [{ code: null, name: "Credit card payment", description: t.counterpart ? `${t.amountCents < 0 ? "To" : "From"} Acc#${t.counterpart}` : identifyMerchant(t.description).name, ...side(t.amountCents) }];
    case "TRANSFER": return [{ code: null, name: "Transfer", description: t.counterpart ? `${t.amountCents < 0 ? "To" : "From"} Acc#${t.counterpart}` : identifyMerchant(t.description).name, ...side(t.amountCents) }];
    case "ADJUSTMENT": return [{ code: null, name: "Balance correction", description: t.description, ...side(t.amountCents) }];
    default: // PURCHASE, REFUND, REVERSAL
      return [{ code: code(t.category), name: t.merchant ?? t.description, description: catDesc(t.category), ...side(t.amountCents) }];
  }
}

/** Order inside a month: money in, loan payments, fees, purchases, transfers. */
function rank(l: BookLine): number {
  if (l.debitCents && !l.creditCents && l.name !== "Transfer" && l.name !== "Credit card payment") return 0;
  if (l.name === "Mortgage" || l.name === "Loan payment") return 1;
  if (l.name === "Bank fee" || l.name === "Interest") return 2;
  if (l.name === "Transfer" || l.name === "Credit card payment" || l.name === "Balance correction") return 4;
  return 3;
}

export function buildMonths(input: { txns: BookTxn[]; anchors: BookAnchor[]; firstMonth: string; months?: number; grouped: boolean }): BookMonth[] {
  const { txns, anchors, grouped } = input;
  const keys = Array.from({ length: input.months ?? 12 }, (_, i) => addMonths(input.firstMonth, i));
  return keys.map((month) => {
    const { start, end } = monthRange(month);
    const inMonth = txns.filter((t) => t.date >= start && t.date <= end).sort((a, b) => a.date.getTime() - b.date.getTime());
    let lines: BookLine[] = inMonth.flatMap((t) => linesFor(t).map((l) => ({ ...l, date: grouped ? null : t.date })));
    if (grouped) {
      const g = new Map<string, BookLine>();
      for (const l of lines) {
        const key = [l.code ?? "", l.name.toLowerCase(), l.description.toLowerCase(), l.debitCents ? "in" : "out"].join("|");
        const cur = g.get(key);
        if (cur) { cur.debitCents += l.debitCents; cur.creditCents += l.creditCents; } else g.set(key, { ...l });
      }
      lines = [...g.values()].sort((a, b) => rank(a) - rank(b) || (a.name === "Mortgage" && b.name === "Mortgage" ? (a.description === "Interest" ? -1 : 1) : 0) || a.name.localeCompare(b.name));
    }
    const opening = balanceAt(new Date(start.getTime() - DAY), anchors, txns);
    const net = inMonth.reduce((s, t) => s + t.amountCents, 0);
    return { month, start, end, openingCents: opening, closingCents: opening === null ? null : opening + net, lines };
  });
}

export function fiscalYearLabel(firstMonth: string): string {
  const [y, m] = firstMonth.split("-").map(Number);
  return m === 1 ? String(y) : `${y}-${y + 1}`;
}
