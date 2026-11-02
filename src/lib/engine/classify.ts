/**
 * Transaction type and category classification.
 *
 * Type ("kind") answers: is this spending, income, or money moving between the
 * user's own accounts? Getting this right is what prevents double counting
 * (a $1,000 credit-card payment is NOT $1,000 of new spending).
 *
 * Category answers: what was it for? Priority:
 *   1. User-defined rules
 *   2. Previously confirmed classifications for the same merchant
 *   3. Merchant default category
 *   4. Known merchant family suggestion
 *   5. Description keyword patterns
 *   6. (optional) AI suggestion, applied by the caller
 * A user-confirmed category is never overwritten by this engine.
 */

import type { AccountTypeName, TxnKindName } from "./types";

export const LIABILITY_TYPES: AccountTypeName[] = ["CREDIT_CARD", "BUSINESS_CREDIT_CARD", "LINE_OF_CREDIT"];
export const isLiability = (t: AccountTypeName) => LIABILITY_TYPES.includes(t);

/** Kinds that represent real operating spending (net of refunds). */
export const SPENDING_KINDS: TxnKindName[] = ["PURCHASE", "FEE", "INTEREST", "REFUND", "REVERSAL"];
/** Kinds that move money between the user's own accounts or settle debt. Not spending. */
export const MOVEMENT_KINDS: TxnKindName[] = ["TRANSFER", "CARD_PAYMENT", "LOAN_PAYMENT"];

export const KIND_LABELS: Record<TxnKindName, { simple: string; accountant: string }> = {
  PURCHASE: { simple: "Purchase", accountant: "Expense" },
  REFUND: { simple: "Refund", accountant: "Expense reversal (refund)" },
  INCOME: { simple: "Money received", accountant: "Revenue / receipt" },
  TRANSFER: { simple: "Moved between my accounts", accountant: "Inter-account transfer" },
  CARD_PAYMENT: { simple: "Credit card payment", accountant: "Liability settlement (card)" },
  LOAN_PAYMENT: { simple: "Loan or mortgage payment", accountant: "Loan principal repayment" },
  INTEREST: { simple: "Interest charged", accountant: "Interest expense" },
  FEE: { simple: "Bank fee", accountant: "Bank charges" },
  REVERSAL: { simple: "Reversed charge", accountant: "Reversal" },
  ADJUSTMENT: { simple: "Balance correction", accountant: "Reconciliation adjustment" },
};

interface KindResult { kind: TxnKindName; confidence: number }

const has = (s: string, re: RegExp) => re.test(s);

export function detectKind(description: string, amountCents: number, accountType: AccountTypeName): KindResult {
  const d = description.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const liability = isLiability(accountType);
  const inflow = amountCents > 0;

  if (has(d, /\b(REVERSAL|REVERSED|ANNULATION|CORRECTION)\b/)) return { kind: "REVERSAL", confidence: 0.85 };

  if (has(d, /\b(INTEREST|INTERET)S?\b/)) {
    if (inflow && !liability) return { kind: "INCOME", confidence: 0.85 };
    if (!inflow) return { kind: "INTEREST", confidence: 0.9 };
  }
  if (!inflow && has(d, /\b(SERVICE CHARGE|MONTHLY FEE|ANNUAL FEE|ACCOUNT FEE|PLAN FEE|NSF|OVERDRAFT|FRAIS|FEE)\b/))
    return { kind: "FEE", confidence: 0.85 };

  // Credit card payments: inflow on a card, or outflow on a bank account naming a card.
  if (liability && inflow && has(d, /\b(PAYMENT|PAIEMENT|PMT|THANK YOU|MERCI|PAYMENT RECEIVED)\b/))
    return { kind: "CARD_PAYMENT", confidence: 0.95 };
  if (!liability && !inflow && has(d, /\b(VISA|MASTERCARD|MASTER CARD|AMEX|AMERICAN EXPRESS|AMERICAN EXP|CREDIT CARD|CARTE DE CREDIT|MC PAYMENT|CARD PAYMENT)\b/) &&
      has(d, /\b(PAYMENT|PMT|PAIEMENT|PYMT|BILL|FACTURE)\b|PAY\b|TO\b/))
    return { kind: "CARD_PAYMENT", confidence: 0.9 };

  if (has(d, /\b(MORTGAGE|HYPOTHEQUE|HYPOTHECAIRE|LOAN PAYMENT|LOAN PMT|PRET|LOC PAYMENT|LINE OF CREDIT PAYMENT|VIREMENT-REMBOURSEMENT|REMBOURSEMENT AUTOMATIQUE)\b|\bA PR \d/)) {
    if (liability && inflow) return { kind: "LOAN_PAYMENT", confidence: 0.85 };
    if (!inflow) return { kind: "LOAN_PAYMENT", confidence: 0.85 };
  }

  if (has(d, /\b(TRANSFER|TFR|XFER|VIREMENT|TRSF)\b/) && !has(d, /\b(E-?TRANSFER|INTERAC E|VIREMENT INTERAC)\b/) && !has(d, /\bANNULATION\b/))
    return { kind: "TRANSFER", confidence: 0.85 };
  // Interac e-transfers: received ones are money in (e.g. rent, customer payments); sent ones need a look.
  if (inflow && has(d, /\b(VIREMENT INTERAC DE|E-?TRANSFER (FROM|RECEIVED|AUTODEPOSIT)|INTERAC E-?TRANSFER (FROM|RECEIVED|AUTODEPOSIT)|AUTODEPOSIT)\b/))
    return { kind: "INCOME", confidence: 0.85 };
  if (has(d, /\b(E-?TRANSFER|INTERAC E|VIREMENT INTERAC)\b/))
    return inflow ? { kind: "INCOME", confidence: 0.5 } : { kind: "PURCHASE", confidence: 0.5 };

  if (inflow) {
    if (has(d, /\b(REFUND|RETURN|REMBOURSEMENT|REMB|CREDIT VOUCHER|RETOUR)\b/)) return { kind: "REFUND", confidence: 0.9 };
    if (liability) return { kind: "REFUND", confidence: 0.65 };
    if (has(d, /\b(DEPOSIT|DEPOT|PAYROLL|PAIE|SALARY|STRIPE|SQUARE|SHOPIFY PAYOUT|PAYOUT|INVOICE|MOBILE DEP|DEPOT MOBILE)\b/))
      return { kind: "INCOME", confidence: 0.85 };
    return { kind: "INCOME", confidence: 0.6 };
  }
  return { kind: "PURCHASE", confidence: 0.8 };
}

/** Keyword patterns -> category path, used when no rule, history or merchant match exists. */
export const DESCRIPTION_PATTERNS: Array<[RegExp, string]> = [
  [/\b(RESTAURANT|RESTO|BISTRO|PIZZA|SUSHI|GRILL|BRASSERIE|CAFE BAR|PUB|TAVERN|BURGER|SHAWARMA|THAI|PHO)\b/, "Food > Restaurants"],
  [/\b(CAFE|COFFEE|ESPRESSO|BAKERY|BOULANGERIE)\b/, "Food > Coffee shops"],
  [/\b(GROCERY|EPICERIE|SUPERMARKET|MARCHE|FRUITERIE)\b/, "Food > Groceries"],
  [/\b(PARKING|STATIONNEMENT|IMPARK|INDIGO)\b/, "Transportation > Parking"],
  [/\b(STM|TTC|PRESTO|OPUS|TRANSIT|VIA RAIL|GO TRANSIT)\b/, "Transportation > Public transit"],
  [/\b(GAS|FUEL|ESSENCE|PETRO)\b/, "Transportation > Fuel"],
  [/\b(INSURANCE|ASSURANCE|INTACT|DESJARDINS ASSUR)\b/, "Housing > Insurance"],
  [/\b(RENT|LOYER)\b/, "Housing > Rent"],
  [/\b(HOTEL|AIRBNB|MARRIOTT|HILTON|EXPEDIA|AIRLINE|WESTJET|PORTER)\b/, "Business > Business travel"],
  [/\b(SOFTWARE|SAAS|SUBSCRIPTION|GITHUB|ATLASSIAN|DROPBOX|NOTION|FIGMA|HUBSPOT|MAILCHIMP|GODADDY|SQUARESPACE|WIX|DIGITALOCEAN|HEROKU|VERCEL)\b/, "Business > Software"],
  [/\b(ADVERTIS|ADS|MARKETING|GOOGLE ADS)\b/, "Business > Marketing"],
  [/\b(LAWYER|AVOCAT|NOTAIRE|NOTARY|CPA|ACCOUNTING|COMPTABLE|CONSULTING|LEGAL)\b/, "Business > Professional services"],
  [/\b(OFFICE|BUREAU|PRINT|IMPRESSION|POSTE|CANADA POST|PUROLATOR|FEDEX|UPS)\b/, "Business > Office expenses"],
  [/\b(DAYCARE|GARDERIE|CPE)\b/, "Family > Childcare"],
  [/\b(SCHOOL|ECOLE|TUITION|UNIVERSITY|COLLEGE)\b/, "Family > Education"],
  [/\b(PHARMA|PHARMACY|JEAN COUTU|SHOPPERS DRUG|UNIPRIX|PHARMAPRIX)\b/, "Family > Family essentials"],
  [/\b(CINEMA|THEATRE|CINEPLEX|TICKETMASTER|GYM|FITNESS)\b/, "Entertainment > Recreation"],
];

export const KIND_DEFAULT_CATEGORY: Partial<Record<TxnKindName, string>> = {
  FEE: "Financial > Banking fees",
  INTEREST: "Financial > Interest expenses",
  TRANSFER: "Money movement > Transfers between my accounts",
  CARD_PAYMENT: "Money movement > Credit card payments",
  LOAN_PAYMENT: "Money movement > Loan and mortgage payments",
  ADJUSTMENT: "Money movement > Balance corrections",
};

export interface CategoryRuleInput {
  id: string;
  pattern: string;
  categoryId: string;
  accountId?: string | null;
  kind?: TxnKindName | null;
}

export interface CategoryContext {
  rules: CategoryRuleInput[];
  /** merchant name -> categoryId most often confirmed by the user */
  history: Map<string, string>;
  merchantDefaults: Map<string, string>;
  pathToId: (path: string) => string | null;
}

export interface CategoryResult {
  categoryId: string | null;
  source: "RULE" | "HISTORY" | "MERCHANT" | "PATTERN" | "NONE";
  confidence: number;
}

export function classifyCategory(
  t: { description: string; merchantName: string; kind: TxnKindName; accountId: string; suggestedCategory?: string },
  ctx: CategoryContext,
): CategoryResult {
  const hay = `${t.description} ${t.merchantName}`.toUpperCase();
  for (const r of ctx.rules) {
    if (r.accountId && r.accountId !== t.accountId) continue;
    if (r.kind && r.kind !== t.kind) continue;
    if (r.pattern && hay.includes(r.pattern.toUpperCase())) return { categoryId: r.categoryId, source: "RULE", confidence: 1 };
  }

  const kindDefault = KIND_DEFAULT_CATEGORY[t.kind];
  if (kindDefault) return { categoryId: ctx.pathToId(kindDefault), source: "PATTERN", confidence: 0.9 };
  if (t.kind === "INCOME") {
    const path = /\bINTEREST|INTERET/.test(hay) ? "Income > Interest income" : "Income > Sales and customer payments";
    return { categoryId: ctx.pathToId(path), source: "PATTERN", confidence: 0.6 };
  }

  const hist = ctx.history.get(t.merchantName);
  if (hist) return { categoryId: hist, source: "HISTORY", confidence: 0.95 };

  const md = ctx.merchantDefaults.get(t.merchantName);
  if (md) return { categoryId: md, source: "MERCHANT", confidence: 0.9 };

  if (t.suggestedCategory) {
    const id = ctx.pathToId(t.suggestedCategory);
    if (id) return { categoryId: id, source: "MERCHANT", confidence: 0.75 };
  }

  for (const [re, path] of DESCRIPTION_PATTERNS) {
    if (re.test(hay)) {
      const id = ctx.pathToId(path);
      if (id) return { categoryId: id, source: "PATTERN", confidence: 0.72 };
    }
  }
  return { categoryId: ctx.pathToId("Other > Uncategorized"), source: "NONE", confidence: 0 };
}

/** Below this, the transaction goes to the review queue. */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.7;
