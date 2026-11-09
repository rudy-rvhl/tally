/**
 * Work out which account a statement belongs to, from what the statement itself says:
 * the bank, the last digits of the account number, the type of account (chequing, savings,
 * credit card, line of credit; business or personal) and the currency. File names are used
 * only as a fallback (banks often name downloads like "BUSINESS_4321_Sep_2026.pdf").
 */
import { isLiability } from "./classify";
import type { AccountTypeName } from "./types";

export type Ownership = "BUSINESS" | "PERSONAL";

const has = (re: RegExp, s: string) => re.test(s);

/** Account type from the statement's heading text (not the transaction rows, which mention cards being paid). */
export function detectAccountType(heading: string): { type: AccountTypeName | null; ownership: Ownership | null } {
  const t = heading.replace(/\s+/g, " ");
  const business = has(/\bbusiness\b|\bentreprises?\b|\bcommercial\b|\bcorporate\b|\bsbap\b|\b(inc|lt[eé]e|ltd|corp|s\.?e\.?n\.?c\.?)\b\.?/i, t);
  const personal = has(/\bpersonal\b|\bpersonnel(le)?\b|\bparticuliers?\b/i, t);
  const ownership: Ownership | null = business ? "BUSINESS" : personal ? "PERSONAL" : null;
  let type: AccountTypeName | null = null;
  if (has(/line of credit|credit line|marge de cr[eé]dit|scotialine|\bheloc\b|home equity/i, t)) type = "LINE_OF_CREDIT";
  else if (has(/credit card|carte de cr[eé]dit|\bvisa\b|mastercard|american express|\bamex\b|minimum payment|paiement minimum|credit limit|limite de cr[eé]dit|card ?member|titulaire de (la )?carte/i, t))
    type = business ? "BUSINESS_CREDIT_CARD" : "CREDIT_CARD";
  else if (has(/savings|[eé]pargne|money master|momentum|high interest|investment account|compte placement/i, t))
    type = business ? "BUSINESS_SAVINGS" : "PERSONAL_SAVINGS";
  else if (has(/chequing|checking|ch[eè]ques?\b|business account|operating|op[eé]rations|current account|compte courant|personal account/i, t))
    type = ownership === "PERSONAL" ? "PERSONAL_CHEQUING" : "BUSINESS_CHEQUING"; // LedgerIQ's default is business
  return { type, ownership };
}

/** Clues from a file name, e.g. "BUSINESS_4321_Sep_2026.pdf" → business, ends in 4321. */
export function fileNameHints(name: string): { last4: string | null; type: AccountTypeName | null; ownership: Ownership | null } {
  const base = name.replace(/\.[a-z0-9]+$/i, "").replace(/[_\-.]+/g, " ");
  const nums = [...base.matchAll(/(?<!\d)(\d{4})(?!\d)/g)].map((m) => m[1]).filter((n) => !(+n >= 1990 && +n <= 2100));
  const long = base.match(/\d{5,}/)?.[0];
  const { type, ownership } = detectAccountType(base);
  return { last4: nums[nums.length - 1] ?? (long ? long.slice(-4) : null), type, ownership };
}

export const typeFamily = (t: AccountTypeName): "DEPOSIT" | "CARD" | "CREDIT_LINE" | "CASH" | "OTHER" =>
  t === "LINE_OF_CREDIT" ? "CREDIT_LINE" : isLiability(t) ? "CARD" : t === "CASH" ? "CASH" : t === "OTHER" ? "OTHER" : "DEPOSIT";
const savings = (t: AccountTypeName) => t === "PERSONAL_SAVINGS" || t === "BUSINESS_SAVINGS";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
/** "Scotiabank" ~ "Scotia", "RBC Royal Bank" ~ "Royal Bank of Canada". */
export function sameInstitution(a: string, b: string): boolean {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  // Any significant word in common, allowing for French/English endings: "RBC Royal Bank" ~ "Royal Bank of Canada",
  // "National Bank" ~ "Banque Nationale".
  const words = (s: string) => s.toLowerCase().split(/[^a-zà-ÿ]+/).filter((w) => w.length > 3 && !["bank", "banque", "canada", "trust", "the"].includes(w));
  const wb = words(b);
  return words(a).some((w) => wb.some((v) => w.startsWith(v) || v.startsWith(w)));
}

export interface StatementFacts {
  institution: string | null;
  last4: string | null;
  type: AccountTypeName | null;
  ownership: Ownership | null;
  currency: string | null;
}
export interface AccountLite { id: string; name: string; institution: string; type: AccountTypeName; mask: string | null; currency: string; ownership: Ownership; status: string }

export interface RouteResult {
  accountId: string | null;
  /** "exact": same bank and account number. "likely": same bank and type, no number to compare. */
  confidence: "exact" | "likely" | "none";
  reason: string;
  /** Other accounts that could also fit (the user picks). */
  candidates: string[];
}

export function routeStatement(f: StatementFacts, accounts: AccountLite[]): RouteResult {
  const scored: { a: AccountLite; score: number; why: string[] }[] = [];
  for (const a of accounts) {
    const why: string[] = [];
    let score = 0;
    if (f.institution && a.institution && !sameInstitution(f.institution, a.institution)) continue;
    if (f.institution) { score += 30; why.push(f.institution); }
    if (f.last4 && a.mask) {
      if (f.last4 !== a.mask) continue; // a different account number is never the same account
      score += 100; why.push(`account ending in ${a.mask}`);
    } else if (f.last4 && !a.mask) score -= 5; // possible, but weaker than an account with a matching number
    if (f.type) {
      if (typeFamily(f.type) !== typeFamily(a.type)) continue; // a card statement never goes into a bank account
      if (f.type === a.type) { score += 25; why.push(labelOf(a.type)); }
      else if (savings(f.type) !== savings(a.type)) score -= 40; // savings vs chequing
      else score += 10;
    }
    if (f.ownership && f.ownership !== a.ownership) score -= 15;
    if (f.currency && f.currency !== a.currency) continue;
    if (a.status === "CLOSED") score -= 5;
    scored.push({ a, score, why });
  }
  scored.sort((x, y) => y.score - x.score);
  const [best, second] = scored;
  if (!best || best.score < 30) return { accountId: null, confidence: "none", reason: "No matching account yet.", candidates: scored.map((s) => s.a.id) };
  const tie = second && second.score === best.score;
  if (tie) return { accountId: null, confidence: "none", reason: `More than one account could match (${scored.filter((s) => s.score === best.score).map((s) => s.a.name).join(", ")}). Please choose.`, candidates: scored.map((s) => s.a.id) };
  const exact = best.score >= 100 && best.a.mask === f.last4;
  if (!exact && best.score < 50) return { accountId: null, confidence: "none", reason: "Not sure which account this is. Please choose.", candidates: scored.map((s) => s.a.id) };
  return { accountId: best.a.id, confidence: exact ? "exact" : "likely", reason: `Matched by ${best.why.join(", ")}.`, candidates: scored.slice(1).map((s) => s.a.id) };
}

const LABELS: Record<AccountTypeName, string> = {
  PERSONAL_CHEQUING: "personal chequing", PERSONAL_SAVINGS: "personal savings", BUSINESS_SAVINGS: "business savings", CREDIT_CARD: "credit card",
  BUSINESS_CHEQUING: "business chequing", BUSINESS_CREDIT_CARD: "business credit card", LINE_OF_CREDIT: "line of credit", CASH: "cash", OTHER: "account",
};
export const labelOf = (t: AccountTypeName) => LABELS[t];

/** A new account to propose when nothing matches: "Scotiabank Business chequing ··4321". */
export function proposeAccount(f: StatementFacts, fallbackName: string) {
  const type: AccountTypeName = f.type ?? (f.ownership === "PERSONAL" ? "PERSONAL_CHEQUING" : "BUSINESS_CHEQUING");
  const label = labelOf(type);
  return {
    institution: f.institution ?? "Other",
    name: `${label[0].toUpperCase()}${label.slice(1)}${f.last4 ? ` ··${f.last4}` : ""}`,
    type,
    ownership: (f.ownership ?? (type.startsWith("PERSONAL") || type === "CREDIT_CARD" ? "PERSONAL" : "BUSINESS")) as Ownership,
    currency: f.currency ?? "CAD",
    mask: f.last4,
    fallbackName,
  };
}
