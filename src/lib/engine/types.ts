/** Engine-level types, kept independent from Prisma so engines are pure and testable. */

export type AccountTypeName =
  | "PERSONAL_CHEQUING" | "PERSONAL_SAVINGS" | "BUSINESS_SAVINGS" | "CREDIT_CARD" | "BUSINESS_CHEQUING"
  | "BUSINESS_CREDIT_CARD" | "LINE_OF_CREDIT" | "CASH" | "OTHER";

export type TxnKindName =
  | "PURCHASE" | "REFUND" | "INCOME" | "TRANSFER" | "CARD_PAYMENT" | "LOAN_PAYMENT"
  | "INTEREST" | "FEE" | "REVERSAL" | "ADJUSTMENT";

/** A transaction as parsed from a statement, before it touches the database. */
export interface ParsedTxn {
  date: Date;
  amountCents: number; // signed, cash perspective (+ in, - out)
  description: string;
  externalId?: string;
  pending?: boolean;
  /** Row number in the source file (1-based), for the preview and audit trail. */
  sourceRow: number;
  /** Parser doubts, shown to the user in plain language. */
  warnings: string[];
}

export interface ParseResult {
  parser: string;
  institution: string | null;
  currency: string | null;
  accountHint: string | null; // masked account number if found
  /** Account type as printed in the statement's heading (chequing, savings, card…), when it says. */
  accountTypeHint?: AccountTypeName | null;
  ownershipHint?: "BUSINESS" | "PERSONAL" | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  openingBalanceCents: number | null;
  closingBalanceCents: number | null;
  transactions: ParsedTxn[];
  /** File-level notes ("We assumed amounts are from the cardholder's perspective"). */
  notes: string[];
  /** Columns detected for CSV/XLSX so the user can correct the mapping. */
  mapping?: ColumnMapping;
  headers?: string[];
  /** Statements covering several accounts: the sections found (one is imported at a time). */
  sections?: { index: number; name: string; transactions: number }[];
  /** Loan payments broken into interest and principal, from a loan section of the statement. */
  loanPayments?: { date: Date; interestCents: number; principalCents: number; loan: string }[];
}

export interface ColumnMapping {
  date: number;
  description: number;
  /** Either a single signed amount column, or separate debit/credit columns. */
  amount?: number;
  debit?: number;
  credit?: number;
  /** How to read a single amount column: as-is, or inverted (card statements listing purchases as positive). */
  amountSign: "AS_IS" | "INVERT";
  dateOrder: "YMD" | "MDY" | "DMY";
  extraDescription?: number;
  reference?: number;
  hasHeader: boolean;
}

/** Minimal transaction shape the analytics engine works with. */
export interface AnalyticTxn {
  id: string;
  date: Date;
  amountCents: number; // already converted into the reporting currency
  kind: TxnKindName;
  accountId: string;
  merchant: string | null;
  merchantId: string | null;
  category: string | null; // top-level category name
  subcategory: string | null;
  categoryId: string | null;
  pending: boolean;
  /** Effective building (the transaction's own, else its account's). */
  buildingId?: string | null;
  companyId?: string | null;
  /** Tenant whose rent this is (rent roll). */
  tenantId?: string | null;
}
