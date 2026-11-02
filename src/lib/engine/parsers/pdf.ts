/**
 * PDF statement parser for PDFs with extractable text.
 * Strategy: extract text lines, find lines that start with a date and end with an
 * amount. When a running balance column exists we derive the sign from the balance
 * change, which is far more reliable than guessing from wording.
 * Scanned (image-only) PDFs are detected and reported; OCR is an optional workflow.
 */
import { parseAmountToCents } from "../money";
import { parseDate } from "../dates";
import { isLiability } from "../classify";
import type { AccountTypeName, ParseResult, ParsedTxn } from "../types";

const MONTH = "(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\\.?";
const DATE = `(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?|${MONTH}\\s?\\d{1,2}(?:,?\\s\\d{4})?|\\d{1,2}\\s${MONTH}(?:\\s\\d{4})?)`;
const AMT = "-?\\(?\\$?\\d{1,3}(?:[ ,]?\\d{3})*[.,]\\d{2}\\)?(?:\\s?(?:CR|DR|-))?";
const LINE = new RegExp(`^(${DATE})\\s+(?:(${DATE})\\s+)?(.+?)\\s+(${AMT})(?:\\s+(${AMT}))?$`, "i");

export const INSTITUTION_KEYWORDS: Array<[RegExp, string]> = [
  [/scotiabank|bank of nova scotia/i, "Scotiabank"],
  [/royal bank|rbc/i, "RBC Royal Bank"],
  [/td canada trust|toronto-dominion/i, "TD Canada Trust"],
  [/bmo|bank of montreal/i, "BMO"],
  [/cibc|imperial bank of commerce/i, "CIBC"],
  [/national bank|banque nationale/i, "National Bank"],
  [/desjardins/i, "Desjardins"],
  [/american express|amex/i, "American Express"],
  [/tangerine/i, "Tangerine"],
];

function yearFromText(text: string): number | undefined {
  const m = text.match(/\b(20\d{2})\b/);
  return m ? +m[1] : undefined;
}

export function parseStatementText(text: string, accountType: AccountTypeName): ParseResult {
  const notes: string[] = [];
  const res: ParseResult = {
    parser: "PDF", institution: INSTITUTION_KEYWORDS.find(([re]) => re.test(text))?.[1] ?? null,
    currency: /\bUSD\b|US dollars?/i.test(text) ? "USD" : /\bCAD\b|canadian/i.test(text) ? "CAD" : null,
    accountHint: text.match(/(?:\*{2,}|x{2,}|ending in)\s?(\d{4})\b/i)?.[1] ?? null,
    periodStart: null, periodEnd: null, openingBalanceCents: null, closingBalanceCents: null, transactions: [], notes,
  };
  const year = yearFromText(text);
  const period = text.match(new RegExp(`(${DATE})\\s*(?:to|-|–|au)\\s*(${DATE})`, "i"));
  if (period) {
    res.periodStart = parseDate(period[1], "MDY", year);
    res.periodEnd = parseDate(period[2], "MDY", year);
  }
  const amountAfter = (re: RegExp) => {
    const m = text.match(new RegExp(`${re.source}[^\\d\\n-]{0,40}(${AMT})`, "i"));
    return m ? parseAmountToCents(m[m.length - 1]) : null;
  };
  res.openingBalanceCents = amountAfter(/(opening balance|previous (statement )?balance|balance forward|solde precedent|solde d'ouverture)/);
  res.closingBalanceCents = amountAfter(/(closing balance|new balance|ending balance|nouveau solde|solde de fermeture)/);

  const liability = isLiability(accountType);
  let prevBalance = res.openingBalanceCents;
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  lines.forEach((line, idx) => {
    const m = line.match(LINE);
    if (!m) return;
    const [, d1, , descRaw, a1, a2] = m;
    if (/balance|solde|total/i.test(descRaw) && !/fee|frais/i.test(descRaw)) return;
    const date = parseDate(d1, "MDY", res.periodEnd?.getUTCFullYear() ?? year);
    let amount = parseAmountToCents(a1.replace(/-$/, "").replace(/\s?(CR|DR)$/i, ""));
    if (!date || amount === null) return;
    amount = Math.abs(amount);
    const warnings: string[] = [];
    const isCredit = /\bCR$|-$|^-|^\(/i.test(a1.trim());
    let signed: number;
    const balance = a2 ? parseAmountToCents(a2) : null;
    if (balance !== null && prevBalance !== null) {
      const delta = balance - prevBalance;
      // Deposit account: balance up = money in. Liability: balance up = more owed = money out.
      const inflow = liability ? delta < 0 : delta > 0;
      signed = inflow ? amount : -amount;
      if (Math.abs(Math.abs(delta) - amount) > 1) warnings.push("The running balance doesn't match this amount. Please check the sign.");
      prevBalance = balance;
    } else if (liability) {
      signed = isCredit || /payment|paiement|refund|credit|remboursement/i.test(descRaw) ? amount : -amount;
    } else {
      const inflow = isCredit || /deposit|depot|payroll|refund|transfer from|interest paid|e-transfer from|credit/i.test(descRaw);
      signed = inflow ? amount : -amount;
      warnings.push("This statement has no running balance, so we guessed whether this is money in or out from the description.");
    }
    if (balance !== null && prevBalance === null) prevBalance = balance;
    res.transactions.push({ date, amountCents: signed, description: descRaw.trim(), sourceRow: idx + 1, warnings } satisfies ParsedTxn);
  });
  if (!res.periodStart && res.transactions.length) {
    const ts = res.transactions.map((t) => t.date.getTime());
    res.periodStart = new Date(Math.min(...ts));
    res.periodEnd = new Date(Math.max(...ts));
  }
  if (!res.transactions.length) notes.push("We read the PDF but couldn't find transaction lines. Try the CSV or OFX download from your bank instead.");
  else notes.push("PDF statements vary a lot between banks. Please check the preview carefully before importing.");
  return res;
}

export async function parsePdf(buf: Buffer, accountType: AccountTypeName): Promise<ParseResult> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  const joined = pages.join("\n");
  if (joined.replace(/\s/g, "").length < 40) {
    return {
      parser: "PDF", institution: null, currency: null, accountHint: null, periodStart: null, periodEnd: null,
      openingBalanceCents: null, closingBalanceCents: null, transactions: [],
      notes: ["This PDF looks like a scanned image, so there's no text to read. Scanned statements need the optional OCR add-on (not enabled on this server). Download a CSV or OFX from your bank instead."],
    };
  }
  return parseStatementText(joined, accountType);
}
