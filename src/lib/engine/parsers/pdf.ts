/**
 * PDF statement reader.
 *
 * Works from the page layout, not just the text: every word keeps its position, so
 *  - amounts are assigned to the column they sit under (Withdrawals / Deposits /
 *    Amount / Balance, or Retrait / Dépôt / Solde), which settles money in vs out;
 *  - a reference number inside a description is never mistaken for an amount;
 *  - wrapped descriptions (the payee on a second line) are joined to their row;
 *  - the running balance, when printed, double-checks every sign.
 * Text PDFs give positions directly; scanned PDFs give them through OCR (see ocr.ts)
 * and go through the same reader.
 */
import { parseAmountToCents } from "../money";
import { utcDate } from "../dates";
import { detectAccountType } from "../routing";
import { isLiability } from "../classify";
import type { AccountTypeName, ParseResult, ParsedTxn } from "../types";

// ---------- layout primitives
export interface Word { page: number; x: number; x2: number; y: number; str: string }
interface Cell { x: number; x2: number; str: string }
interface Line { page: number; y: number; cells: Cell[]; text: string }

/** Group words into lines (same baseline) and merge nearby words into cells. */
export function buildLines(words: Word[], gap = 4.5, rowTolerance = 2.5): Line[] {
  // Typographic dashes before an amount are minus signs ("–$92.00" on Wealthsimple, "−12.50").
  const sorted = words.filter((w) => w.str.trim()).map((w) => ({ ...w, str: w.str.replace(/[\u2212\u2013\u2014](?=\s?\$?\s?\d)/g, "-") }))
    .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const lines: { page: number; y: number; words: Word[] }[] = [];
  for (const w of sorted) {
    const last = lines[lines.length - 1];
    if (last && last.page === w.page && Math.abs(last.y - w.y) <= rowTolerance) last.words.push(w);
    else lines.push({ page: w.page, y: w.y, words: [w] });
  }
  return lines.map((l) => {
    const ws = l.words.sort((a, b) => a.x - b.x);
    const cells: Cell[] = [];
    for (const w of ws) {
      const c = cells[cells.length - 1];
      if (c && w.x - c.x2 <= gap) { c.str += (w.x - c.x2 > 0.8 ? " " : "") + w.str.trim(); c.x2 = Math.max(c.x2, w.x2); }
      else cells.push({ x: w.x, x2: w.x2, str: w.str.trim() });
    }
    return { page: l.page, y: l.y, cells, text: cells.map((c) => c.str).join(" ") };
  });
}

// ---------- tokens
const MONTHS: Record<string, number> = {
  jan: 1, janv: 1, janvier: 1, january: 1, feb: 2, fev: 2, fevr: 2, fevrier: 2, february: 2, mar: 3, mars: 3, march: 3,
  apr: 4, avr: 4, avril: 4, april: 4, may: 5, mai: 5, jun: 6, juin: 6, june: 6, jul: 7, juil: 7, juillet: 7, july: 7,
  aug: 8, aou: 8, aout: 8, august: 8, sep: 9, sept: 9, septembre: 9, september: 9, oct: 10, octobre: 10, october: 10,
  nov: 11, novembre: 11, november: 11, dec: 12, decembre: 12, december: 12,
};
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\.$/, "");
const MON = "(?:jan(?:v|vier|uary)?|f[eé]v(?:r|rier)?|feb(?:ruary)?|mar(?:s|ch)?|apr(?:il)?|avr(?:il)?|ma[iy]|jui?n(?:e)?|juil(?:let)?|jul(?:y)?|ao[uû]t?|aug(?:ust)?|sept?(?:embre|ember)?|oct(?:obre|ober)?|nov(?:embre|ember)?|d[eé]c(?:embre|ember)?)\\.?";
const DATE_TOKEN = `(?:\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?|${MON}\\s?\\d{1,2}(?:,?\\s\\d{4})?|\\d{1,2}\\s?${MON}(?:\\s\\d{4})?)`;
const DATE_AT_START = new RegExp(`^(${DATE_TOKEN})(?:\\s+(${DATE_TOKEN}))?(?:\\s+|$)`, "i");
// Thousands may be grouped ("1,659.09", "1 659,09") or not ("1659.09", as on Scotiabank statements).
const AMOUNT_CELL = /^(?:-\s?)?\(?-?\s?\$?\s?(?:\d{1,3}(?:[ ,  ]\d{3})+|\d+)(?:[.,]\d{2})\)?(?:\s?(?:CR|DR|-))?\s?\$?$/i;

interface LooseDate { y?: number; m: number; d: number }

export function parseLooseDate(token: string): LooseDate | null {
  const s = token.trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/))) return { y: +m[1], m: +m[2], d: +m[3] };
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/))) {
    const y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : undefined;
    return +m[1] > 12 ? { y, m: +m[2], d: +m[1] } : { y, m: +m[1], d: +m[2] };
  }
  if ((m = s.match(/^([A-Za-zÀ-ÿ]+)\.?\s?(\d{1,2}),?(?:\s(\d{4}))?$/))) {
    const mo = MONTHS[fold(m[1])]; if (mo) return { y: m[3] ? +m[3] : undefined, m: mo, d: +m[2] };
  }
  if ((m = s.match(/^(\d{1,2})\s?([A-Za-zÀ-ÿ]+)\.?(?:\s(\d{4}))?$/))) {
    const mo = MONTHS[fold(m[2])]; if (mo) return { y: m[3] ? +m[3] : undefined, m: mo, d: +m[1] };
  }
  return null;
}

/** A date read from a DATE column, which may also be printed as MMDD ("0831") or "08 31". */
function columnDate(token: string): LooseDate | null {
  const m = token.trim().match(/^(\d{2})\s?(\d{2})$/);
  if (m) { const mo = +m[1], d = +m[2]; return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? { m: mo, d } : null; }
  return parseLooseDate(token);
}

/** Pick the year for a date printed without one, using the statement period (handles Dec→Jan). */
export function resolveYear(d: LooseDate, period: { start: Date | null; end: Date | null }, fallbackYear?: number): Date | null {
  if (d.y) return utcDate(d.y, d.m, d.d);
  const { start, end } = period;
  if (start && end) {
    for (const y of [end.getUTCFullYear(), start.getUTCFullYear(), end.getUTCFullYear() - 1]) {
      const dt = utcDate(y, d.m, d.d);
      if (dt && dt.getTime() >= start.getTime() - 7 * 86400000 && dt.getTime() <= end.getTime() + 7 * 86400000) return dt;
    }
  }
  const y = end?.getUTCFullYear() ?? fallbackYear;
  return y ? utcDate(y, d.m, d.d) : null;
}

interface Amount { cents: number; credit: boolean; debit: boolean; explicitMinus: boolean }
function readAmount(raw: string): Amount | null {
  const s = raw.trim();
  const credit = /\bCR$/i.test(s);
  const debit = /\bDR$/i.test(s);
  const explicitMinus = /^-|^\(|-$|^\$?\s?-/.test(s.replace(/\s?(CR|DR)$/i, ""));
  const core = s.replace(/\s?(CR|DR)$/i, "").replace(/[()$\s  -]/g, (ch) => (ch === " " || ch === " " || ch === " " ? " " : ""));
  const cents = parseAmountToCents(core.replace(/ (?=\d{3}\b)/g, ""));
  if (cents === null) return null;
  return { cents: Math.abs(cents), credit, debit, explicitMinus };
}

// ---------- header / columns
type ColKind = "DATE" | "CODE" | "DESC" | "OUT" | "IN" | "AMOUNT" | "BALANCE" | "INTEREST" | "PRINCIPAL" | "ADVANCE";
interface Column { kind: ColKind; x: number; x2: number }
const HEADER_WORDS: [RegExp, ColKind][] = [
  [/^(trans(action)?\.?\s*date|date( de transaction)?|post(ing)?\s*date|date d'inscription|date)$/i, "DATE"],
  [/^(code|type)$/i, "CODE"],
  [/^(description|details|transaction details|particulars|libell[eé]|transactions?)$/i, "DESC"],
  [/^(int[eé]r[eê]ts?|interest)( \(\$\))?$/i, "INTEREST"],
  [/^(capital vers[eé]|advances?|d[eé]boursements?)( \(\$\))?$/i, "ADVANCE"],
  [/^(remboursement|principal|capital rembours[eé]|principal paid)( \(\$\))?$/i, "PRINCIPAL"],
  [/(withdrawals?|withdrawn|debits?|retraits?|cheques? & debits|paid out|charges?|d[eé]bit|frais|fees?)(\s*\(\s?(\$|cad|usd|\$\s?cad|\$\s?usd)\s?\)|\s*\$|\s+cad|\s+usd)?$/i, "OUT"],
  [/(deposits?|deposited|credits?|d[eé]p[oô]ts?|paid in|payments? (and|&) credits|cr[eé]dit)(\s*\(\s?(\$|cad|usd|\$\s?cad|\$\s?usd)\s?\)|\s*\$|\s+cad|\s+usd)?$/i, "IN"],
  [/^(amount|montant)(\s*\(\s?(\$|cad|usd|\$\s?cad|\$\s?usd)\s?\)|\s*\$|\s+cad|\s+usd)?$/i, "AMOUNT"],
  [/^(balance|solde)(\s*\(\s?(\$|cad|usd|\$\s?cad|\$\s?usd)\s?\)|\s*\$|\s+cad|\s+usd)?$/i, "BALANCE"],
];

type HeaderMode = "TXN" | "LOAN" | "OTHER";
function detectHeader(line: Line): { cols: Column[]; mode: HeaderMode } | null {
  const cols: Column[] = [];
  for (const c of line.cells) {
    const raw = c.str.trim(), plain = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const hit = HEADER_WORDS.find(([re]) => re.test(raw) || re.test(plain));
    if (hit) cols.push({ kind: hit[1], x: c.x, x2: c.x2 });
  }
  if (cols.length < 3 || !cols.some((c) => c.kind === "DATE" || c.kind === "DESC")) {
    // Short two-column headers ("Date  Amount") still count.
    if (!(cols.length >= 2 && cols.some((c) => c.kind === "DATE" || c.kind === "DESC") && cols.some((c) => ["OUT", "IN", "AMOUNT"].includes(c.kind)))) return null;
  }
  // A loan section has principal / advances. Interest alone (daily closing balance, rate, interest)
  // is an interest calculation table: information only.
  if (cols.some((c) => c.kind === "PRINCIPAL" || c.kind === "ADVANCE")) return { cols, mode: "LOAN" };
  if (cols.some((c) => c.kind === "INTEREST") || line.cells.some((c) => /^(rndmt|taux|rate|yield|rendement)\b/i.test(c.str.trim()))) return { cols, mode: "OTHER" };
  if (cols.some((c) => c.kind === "OUT" || c.kind === "IN" || c.kind === "AMOUNT")) return { cols, mode: "TXN" };
  return { cols, mode: "OTHER" };
}

/** Which money column a right-aligned number belongs to. */
function columnFor(cell: Cell, cols: Column[]): Column | null {
  const money = cols.filter((c) => !["DATE", "CODE", "DESC"].includes(c.kind));
  let best: Column | null = null, dist = Infinity;
  for (const c of money) {
    const d = Math.min(Math.abs(cell.x2 - c.x2), cell.x2 >= c.x - 4 && cell.x <= c.x2 + 4 ? 0 : Infinity);
    if (d < dist) { dist = d; best = c; }
  }
  return dist <= 45 ? best : null;
}

// ---------- statement-level facts
export const INSTITUTION_KEYWORDS: Array<[RegExp, string]> = [
  [/scotiabank|bank of nova scotia|banque scotia|banque de nouvelle-[eé]cosse/i, "Scotiabank"],
  [/royal bank|\brbc\b/i, "RBC Royal Bank"],
  [/td canada trust|toronto-dominion|\btd bank\b/i, "TD Canada Trust"],
  [/\bbmo\b|bank of montreal|banque de montr[eé]al/i, "BMO"],
  [/\bcibc\b|imperial bank of commerce/i, "CIBC"],
  [/national bank|banque nationale/i, "National Bank"],
  [/desjardins/i, "Desjardins"],
  [/american express|\bamex\b/i, "American Express"],
  [/tangerine/i, "Tangerine"],
  [/wealthsimple/i, "Wealthsimple"],
  [/\beq bank\b|equitable bank/i, "EQ Bank"],
  [/neo financial/i, "Neo Financial"],
  [/\bkoho\b/i, "KOHO"],
  [/\bhsbc\b/i, "HSBC"],
  [/\bmbna\b/i, "MBNA"],
  [/capital one/i, "Capital One"],
  [/pc financial|pc mastercard/i, "PC Financial"],
  [/rogers bank/i, "Rogers Bank"],
  [/\batb financial\b/i, "ATB Financial"],
  [/vancity/i, "Vancity"],
  [/coast capital/i, "Coast Capital"],
  [/meridian credit union/i, "Meridian"],
  [/questrade/i, "Questrade"],
  [/simplii/i, "Simplii Financial"],
  [/laurentian|laurentienne/i, "Laurentian Bank"],
];

const LONG_DATE = `(?:${MON}\\s\\d{1,2},?\\s\\d{4}|\\d{1,2}(?:er)?\\s${MON}\\s\\d{4}|\\d{4}-\\d{2}-\\d{2})`;
export function findPeriod(text: string): { start: Date | null; end: Date | null } {
  const res = [
    new RegExp(`(?:from|du|period|p[eé]riode(?: du)?|statement period)\\s*:?\\s*(${LONG_DATE})\\s*(?:to|-|–|au|through)\\s*(${LONG_DATE})`, "i"),
    new RegExp(`(${LONG_DATE})\\s*(?:to|-|–|au|through)\\s*(${LONG_DATE})`, "i"),
  ];
  for (const re of res) {
    const m = text.match(re);
    if (m) {
      const a = parseLooseDate(m[1].replace(/(\d)er\b/, "$1")), b = parseLooseDate(m[2].replace(/(\d)er\b/, "$1"));
      if (a?.y && b?.y) return { start: utcDate(a.y, a.m, a.d), end: utcDate(b.y, b.m, b.d) };
    }
  }
  // Year printed only on the end date: "du 1er octobre au 31 octobre 2026", "from October 1 to October 31, 2026"
  const short = text.match(new RegExp(`(?:du|from|p[eé]riode du)\\s+((?:\\d{1,2}(?:er)?\\s${MON})|(?:${MON}\\s\\d{1,2}))\\s+(?:au|to|-|–)\\s+(${LONG_DATE})`, "i"));
  if (short) {
    const b = parseLooseDate(short[2].replace(/(\d)er\b/, "$1"));
    const a = parseLooseDate(short[1].replace(/(\d)er\b/, "$1"));
    if (a && b?.y) {
      const y = a.m > b.m ? b.y - 1 : b.y;
      return { start: utcDate(y, a.m, a.d), end: utcDate(b.y, b.m, b.d) };
    }
  }
  // Dates printed under "FROM" / "TO" labels on the line above (Scotiabank business): "AUG 31 2026  SEP 29 2026".
  // "Oct 1 - Oct 31, 2026" (year printed once, no "from")
  const bare = text.match(new RegExp(`(?:^|\\s)((?:${MON}\\s\\d{1,2})|(?:\\d{1,2}\\s${MON}))\\s*[-–]\\s*(${LONG_DATE})`, "im"));
  if (bare) {
    const a = parseLooseDate(bare[1]), b = parseLooseDate(bare[2]);
    if (a && b?.y) { const y = a.m > b.m ? b.y - 1 : b.y; const s0 = utcDate(y, a.m, a.d), e0 = utcDate(b.y, b.m, b.d); if (s0 && e0 && e0 > s0) return { start: s0, end: e0 }; }
  }
  const pair = text.match(new RegExp(`(${LONG_DATE})\\s+(${LONG_DATE})`, "i"));
  if (pair) {
    const a = parseLooseDate(pair[1]), b = parseLooseDate(pair[2]);
    if (a?.y && b?.y) {
      const s0 = utcDate(a.y, a.m, a.d), e0 = utcDate(b.y, b.m, b.d);
      // Two dates side by side are a period only if they're weeks apart (not a row's date and posting date).
      if (s0 && e0 && e0.getTime() - s0.getTime() >= 20 * 86400000 && e0.getTime() - s0.getTime() <= 100 * 86400000) return { start: s0, end: e0 };
    }
  }
  const open = text.match(new RegExp(`(?:opening date|date d'ouverture|opening balance on|solde d'ouverture au)\\s*:?\\s*(${LONG_DATE})`, "i"));
  const close = text.match(new RegExp(`(?:closing date|statement date|date du relev[eé]|closing balance on|solde de fermeture au)\\s*:?\\s*(${LONG_DATE})`, "i"));
  if (open && close) {
    const a = parseLooseDate(open[1]), b = parseLooseDate(close[1]);
    if (a?.y && b?.y) return { start: utcDate(a.y, a.m, a.d), end: utcDate(b.y, b.m, b.d) };
  }
  return { start: null, end: null };
}

/** The company a statement is addressed to: "1001-2002 QUEBEC INC", "20304050 CANADA INC.", "Exemple Placements Inc." */
const COMPANY_NAME = /^(?:\d{4}-\d{4}\s+qu[eé]bec|\d{6,9}\s+canada|[a-zà-ÿ0-9][\w&.,'’-]*(?:\s+[\w&.,'’-]+){0,5})\s+(inc|lt[eé]e|ltd|limited|corp(oration)?|s\.?e\.?n\.?c\.?)\.?$/i;
export function statementHolder(lines: Line[]): string | null {
  const first = lines.filter((l) => l.page === lines[0]?.page).slice(0, 45);
  const names = first.flatMap((l) => l.cells.map((c) => c.str.trim())).filter((t) => COMPANY_NAME.test(t) && !/bank|banque|caisse|american express|amex|desjardins|scotia|financial|trust/i.test(t));
  // Numbered companies first: they're the most precise.
  return names.find((t) => /^\d/.test(t)) ?? names[0] ?? null;
}

/** Account number printed under a label ("Folio", "Account number") on the next line. */
function accountFromLayout(lines: Line[]): string | null {
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    for (const c of lines[i].cells) {
      if (!/^(folio|account( number| no\.?)?|n[o°] de compte|num[eé]ro de compte|compte)$/i.test(c.str.trim())) continue;
      for (const l of lines.slice(i + 1, i + 3)) {
        const hit = l.cells.find((d) => /^[\dX*•][\dX*• -]{3,}\d$/i.test(d.str.trim()) && /\d{4}\s*$/.test(d.str.trim().replace(/\s/g, "")) && d.x2 >= c.x - 20 && d.x <= c.x2 + 60);
        if (hit) return hit.str.replace(/\D/g, "").slice(-4);
      }
    }
  }
  return null;
}

/**
 * Balances printed under their label in a summary box:
 *   "OCT 1 BALANCE      OCT 31 BALANCE"          (Wealthsimple)
 *   "$3,160.80          $8,450.40"
 * The earlier date (or "opening / previous") is the opening balance, the later one the closing balance.
 */
export function labelledBalances(lines: Line[]): { opening: number | null; closing: number | null } {
  const found: { label: string; cents: number }[] = [];
  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    const l = lines[i];
    if (l.cells.some((c) => AMOUNT_CELL.test(c.str.trim()))) continue;
    for (const c of l.cells.filter((x) => /\b(balance|solde)\b/i.test(x.str) && x.str.length < 40)) {
      for (const n of lines.slice(i + 1, i + 3).filter((n) => n.page === l.page && n.y - l.y <= 30)) {
        const v = n.cells.find((d) => AMOUNT_CELL.test(d.str.trim()) && d.x >= c.x - 30 && d.x <= c.x2 + 30);
        if (v) { const a = readAmount(v.str); if (a) found.push({ label: c.str.trim(), cents: a.explicitMinus && !a.credit ? -a.cents : a.cents }); break; }
      }
    }
  }
  if (!found.length) return { opening: null, closing: null };
  const dated = found.map((f) => ({ ...f, d: f.label.match(new RegExp(`(${DATE_TOKEN})`, "i"))?.[1] })).filter((f) => f.d).map((f) => ({ ...f, ld: parseLooseDate(f.d!) }));
  if (dated.length >= 2 && dated.every((f) => f.ld)) {
    const sorted = [...dated].sort((a, b) => a.ld!.m - b.ld!.m || a.ld!.d - b.ld!.d);
    return { opening: sorted[0].cents, closing: sorted[sorted.length - 1].cents };
  }
  const open = found.find((f) => /opening|previous|beginning|start|ancien|pr[eé]c[eé]dent|d[eé]but|ouverture/i.test(f.label));
  const close = found.find((f) => /closing|new|ending|nouveau|fermeture|fin\b/i.test(f.label));
  return { opening: open?.cents ?? null, closing: close?.cents ?? null };
}

const AMT_IN_TEXT = "-?\\(?\\$?\\s?(?:\\d{1,3}(?:[ ,\\u00a0]\\d{3})+|\\d+)[.,]\\d{2}\\)?(?:\\s?(?:CR|DR))?";
function amountAfter(text: string, label: RegExp): number | null {
  const m = text.match(new RegExp(`${label.source}[^\\d\\n-]{0,40}(${AMT_IN_TEXT})`, "i"));
  if (!m) return null;
  const a = readAmount(m[m.length - 1]);
  return a ? (a.explicitMinus && !a.credit ? -a.cents : a.cents) : null;
}

const OPENING_ROW = /^(opening balance|balance forward|balance brought forward|brought forward|previous (statement )?balance|beginning balance|starting balance|report\b|solde (report[eé]|d'ouverture|pr[eé]c[eé]dent|ant[eé]rieur|au d[eé]but)|ancien solde)/i;
const CLOSING_ROW = /^(closing balance|new balance|ending balance|balance carried forward|carried forward|solde (de fermeture|final|actuel|[àa] reporter)|nouveau solde)/i;
/**
 * Information printed on a statement that is never money in or out: limits, available credit,
 * minimum payment, due dates, totals, rates and reward points (English and French). Real charges
 * that share some of these words ("Interest charges", "Annual fee", "Overlimit fee") don't match.
 */
export const STATEMENT_INFO = new RegExp([
  "credit limit", "limite de cr[eé]dit", "available credit", "credit available", "cr[eé]dit disponible", "spending limit", "limite de d[eé]penses",
  "cash advance limit", "(?<!(fee|frais|charge)[a-z' ]{0,30})[a-z ]{0,40}\\blimits?\\b(?!\\s*(fee|charge))", "(?<!(frais|fee|charge)[a-zà-ÿ' ]{0,30})limite\\b(?!.*frais)", "limite (d'|pour )?avances?", "available cash", "minimum payment", "minimum due", "paiement minimum", "versement minimum",
  "payment due", "amount due", "montant (d[uû]|exigible)", "date d'[eé]ch[eé]ance", "due date",
  "new balance", "previous balance", "statement balance", "nouveau solde", "solde (pr[eé]c[eé]dent|ant[eé]rieur|du relev[eé])",
  "total (of )?(new |your )?(charges|payments|credits|debits|purchases|activity|fees and interest)", "totaux?\\b",
  "interest rates?\\b(?! charge)", "annual interest rate", "taux d'int[eé]r[eê]t", "purchase rate",
  "membership rewards", "rewards? points", "points? (earned|balance|redeemed|gagn|accumul|obtenus)", "scene\\+? points",
].map((t) => `\\b${t}`).join("|"), "i");

/** Not a transaction: a balance line or statement information. */
export const isStatementInfo = (desc: string) => STATEMENT_INFO.test(desc) || isBalanceLine(desc);

/**
 * A line that only states a balance ("REPORT", "Balance brought forward", "Your balance on Sep 30, 2026",
 * "Solde au 31 juillet") and is never money in or out, whatever column its number is in.
 */
const BALANCE_WORDS = new Set(["opening", "closing", "new", "previous", "ending", "beginning", "starting", "current", "final", "account", "your", "statement", "daily", "balance", "balances", "forward", "brought", "carried", "from", "last", "this", "period", "report", "reporte", "reporter", "solde", "ouverture", "fermeture", "nouveau", "ancien", "precedent", "anterieur", "actuel", "debut", "fin", "au", "du", "de", "d", "a", "on", "as", "of", "at", "the", "le", "la", "en", "date", "le"]);
export function isBalanceLine(desc: string): boolean {
  const words = desc.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[$=:,.()'’*-]/g, " ").split(/\s+/).filter(Boolean)
    .filter((w) => !/^\d+$/.test(w) && !MONTHS[w] && !/^\d+(er)?$/.test(w));
  return words.length > 0 && words.some((w) => w === "balance" || w === "solde" || w === "report") && words.every((w) => BALANCE_WORDS.has(w));
}
const SKIP_ROW = /^(total|sub-?total|sous-total|totaux|interest charged on|minimum payment|paiement minimum|payment due|page \d)/i;
const NOT_CONTINUATION = /^(reference|r[eé]f[eé]rence|page \d|continued|suite|please|veuillez|account|compte|total|date d'[eé]ch[eé]ance|taux|nombre de|number of|no\. of|sommaire|summary)/i;
const sectionKey = (s: string) => s.replace(/\((suite|continued|cont'd)\)/gi, "").replace(/\s+/g, " ").trim().toUpperCase();

export interface StatementSection { index: number; name: string; transactions: number }
export interface LoanPayment { date: Date; interestCents: number; principalCents: number; loan: string }

// ---------- main
export function parseLayout(lines: Line[], accountType: AccountTypeName, parser = "PDF", opts: { section?: number } = {}): ParseResult & { sections?: StatementSection[]; loanPayments?: LoanPayment[] } {
  const notes: string[] = [];
  const text = lines.map((l) => l.text).join("\n");
  const period = findPeriod(text);
  const yearMatch = text.match(/\b(20\d{2})\b/);
  const res: ParseResult & { sections?: StatementSection[]; loanPayments?: LoanPayment[] } = {
    // The bank's name is in the letterhead; look there first so "Payment AMEX card" in a row doesn't decide it.
    parser, institution: INSTITUTION_KEYWORDS.find(([re]) => re.test(lines.slice(0, 8).map((l) => l.text).join(" ")))?.[1] ?? INSTITUTION_KEYWORDS.find(([re]) => re.test(text))?.[1] ?? null,
    currency: /\bUSD\b|US dollars?|dollars am[eé]ricains/i.test(text) ? "USD" : /\bCAD\b|canadian|canadiens/i.test(text) ? "CAD" : null,
    accountHint: text.match(/(?:\*{2,}|x{2,}[\sx]*|ending in|se terminant par|account ending)\s?(\d{4})\b/i)?.[1]
      ?? accountFromLayout(lines)
      ?? text.match(/(?:account|compte|folio)\s*(?:number|no\.?|num[eé]ro|#)?\s*:?\s*([\d][\d -]{3,}\d)\b/i)?.[1].replace(/\D/g, "").slice(-4) ?? null,
    periodStart: period.start, periodEnd: period.end, openingBalanceCents: null, closingBalanceCents: null, transactions: [], notes,
  };
  // The statement's heading (everything above the first table) says what kind of account it is.
  const firstTable = lines.findIndex((l) => detectHeader(l));
  const kind = detectAccountType(lines.slice(0, firstTable > 0 ? firstTable : 30).map((l) => l.text).join("\n"));
  res.accountTypeHint = kind.type; res.ownershipHint = kind.ownership;
  res.holder = statementHolder(lines);
  if (!kind.type) {
    // The product name can be printed further down ("Compte d'épargne sur mesure", "Compte de placements
    // d'entreprise", "Momentum PLUS Savings Account"): a line naming an account, with no amount and no transfer.
    const product = lines.find((l) => /^(compte\b|.*\baccount$)/i.test(l.text.trim()) && !l.cells.some((c) => AMOUNT_CELL.test(c.str.trim())) &&
      !/transfer|virement|\bvir\b|\bto\b|\bfrom\b|payment|paiement/i.test(l.text) && detectAccountType(l.text).type);
    if (product) {
      const k = detectAccountType(product.text);
      res.accountTypeHint = k.type === "PERSONAL_SAVINGS" && kind.ownership === "BUSINESS" ? "BUSINESS_SAVINGS" : k.type === "BUSINESS_CHEQUING" && kind.ownership === "PERSONAL" ? "PERSONAL_CHEQUING" : k.type;
    }
  }
  const labelled = labelledBalances(lines);
  const textOpening = amountAfter(text, /(opening balance|previous (statement )?balance|balance forward|solde (pr[eé]c[eé]dent|d'ouverture|report[eé])|ancien solde)/);
  const textClosing = amountAfter(text, /(closing balance|new balance|ending balance|nouveau solde|solde (de fermeture|final))/);

  const liability = isLiability(accountType);
  const fallbackYear = yearMatch ? +yearMatch[1] : undefined;
  const sections: { name: string; key: string; opening: number | null; closing: number | null; rows: ParsedTxn[]; lastDate: Date | null }[] = [];
  // Rows printed without a date. In a layout where the date sits to the right of the amounts
  // (Scotiabank business), the date is printed on the LAST row of each day, so these rows take the
  // next date; otherwise the date is printed on the first row of the day and they take the previous one.
  let awaitingDate: ParsedTxn[] = [];
  let trailingDate = false;
  const loanPayments: LoanPayment[] = [];
  let mode: HeaderMode | null = null;
  let cols: Column[] | null = null;
  let sec: (typeof sections)[number] | null = null;
  let prevBalance: number | null = null;
  let current: ParsedTxn | null = null;
  let pos = { page: 0, y: 0, descX: 0 }; // where the current row sits, for joining wrapped descriptions
  let pending: { date: Date; desc: string; page: number; y: number; descX: number } | null = null; // date+text row whose amounts are on the next line
  let usedColumns = false, usedBalance = false;
  let lastHeaderPage = -1;
  const balOf = (a: Amount) => (a.explicitMinus && !a.credit ? -a.cents : a.cents);

  const startSection = (name: string) => {
    const key = sectionKey(name);
    const existing = sections.find((x) => x.key === key && key);
    if (existing) { sec = existing; return; }
    sec = { name: name.replace(/\((suite|continued)\)/gi, "").trim() || `Account ${sections.length + 1}`, key, opening: null, closing: null, rows: [], lastDate: null };
    sections.push(sec);
    prevBalance = null;
  };

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const header = detectHeader(line);
    if (header) {
      mode = header.mode; cols = header.cols; current = null; pending = null;
      // A "DATE" heading printed a few points above or below the other headings (stacked headers).
      const near = lines.filter((l) => l !== line && l.page === line.page && Math.abs(l.y - line.y) <= 10);
      if (!cols.some((c) => c.kind === "DATE")) {
        const d = near.flatMap((l) => l.cells).find((c) => /^date$/i.test(c.str.trim()));
        if (d) cols = [...cols, { kind: "DATE", x: d.x, x2: d.x2 }];
      }
      const dateCol = cols.find((c) => c.kind === "DATE"), descCol = cols.find((c) => c.kind === "DESC");
      trailingDate = !!dateCol && !!descCol && dateCol.x > descCol.x2 + 60;
      let ai = li - 1;
      while (ai >= 0 && near.includes(lines[ai])) ai--;
      const above = lines[ai];
      const name = above && above.page === line.page && line.y - above.y < 30 ? above.text : "";
      if (mode === "TXN") {
        const last = sections[sections.length - 1];
        // A table header repeated on a new page continues the same account, unless a new
        // account starts (it opens with a balance brought forward) or it's a second table on the same page.
        // "Balance brought forward" at the top of a page continues the same account.
        const opensNewAccount = lines.slice(li + 1, li + 4).some((l) => { const t = l.text.replace(/^\S{1,4}\s+(?=solde|opening|balance)/i, ""); return OPENING_ROW.test(t) && !/brought forward|carried forward/i.test(t); });
        if (!last || (sectionKey(name) && sectionKey(name) === last.key)) startSection(name);
        else if (line.page === lastHeaderPage || opensNewAccount) startSection(name);
        else sec = last;
        lastHeaderPage = line.page;
      } else sec = null;
      if (mode === "LOAN") (cols as Column[] & { loanName?: string }).loanName = lines[li + 1]?.text ?? name;
      continue;
    }

    // Rows that start with a reference number before the date (Scotiabank cards: "001  Sep 2  Sep 3  AMAZON…").
    let lineCells = line.cells;
    if (!trailingDate && lineCells.length) {
      const c0 = lineCells[0].str.trim();
      if (/^\d{1,6}$/.test(c0) && lineCells[1] && DATE_AT_START.test(lineCells[1].str)) lineCells = lineCells.slice(1);
      else {
        const m = c0.match(/^\d{1,6}\s+/);
        if (m && DATE_AT_START.test(c0.slice(m[0].length))) lineCells = [{ ...lineCells[0], str: c0.slice(m[0].length) }, ...lineCells.slice(1)];
      }
    }
    const first = lineCells[0]?.str ?? "";
    const dm = trailingDate ? null : first.match(DATE_AT_START);
    let cells = lineCells;
    let dateTok: string | null = null;
    const dateCol = trailingDate ? cols?.find((c) => c.kind === "DATE") : undefined;
    if (dateCol) {
      const hit = cells.find((c) => c.x >= dateCol.x - 15 && c.x <= dateCol.x2 + 25 && columnDate(c.str) !== null);
      if (hit) { dateTok = hit.str.trim(); cells = cells.filter((c) => c !== hit); }
    } else if (dm) {
      dateTok = dm[1];
      const rest = first.slice(dm[0].length).trim();
      cells = [...(rest ? [{ ...lineCells[0], str: rest }] : []), ...lineCells.slice(1)];
      if (cells[0] && new RegExp(`^${DATE_TOKEN}$`, "i").test(cells[0].str)) cells = cells.slice(1);
    }

    const amounts: { cell: Cell; col: Column | null; amt: Amount }[] = [];
    const textCells: Cell[] = [];
    const codeCol = cols?.find((c) => c.kind === "CODE");
    for (const c of cells) {
      const amt = AMOUNT_CELL.test(c.str) ? readAmount(c.str) : null;
      const col = amt && cols ? columnFor(c, cols) : null;
      if (amt && (!cols || col)) amounts.push({ cell: c, col, amt });
      else if (dateTok && codeCol && /^[A-Z]{2,4}$/.test(c.str) && c.x < codeCol.x2 + 15 && c.x2 > codeCol.x - 15) continue; // transaction-type code column
      else textCells.push(c);
    }
    let desc = textCells.map((c) => c.str).join(" ").replace(/\s+/g, " ").trim();
    if (dateTok && codeCol) desc = desc.replace(/^[A-Z]{2,4}\s+(?=\S)/, (m) => (cells[0] && cells[0].x < codeCol.x2 + 15 ? "" : m));

    // Loan sections: capture the interest / principal split of each payment, don't import rows.
    if (mode === "LOAN") {
      if (dateTok && cols) {
        const ld = parseLooseDate(dateTok);
        const date = ld ? resolveYear(ld, period, fallbackYear) : null;
        const interest = amounts.find((a) => a.col?.kind === "INTEREST")?.amt.cents ?? 0;
        const principal = amounts.find((a) => a.col?.kind === "PRINCIPAL")?.amt.cents ?? 0;
        if (date && (interest || principal)) loanPayments.push({ date, interestCents: interest, principalCents: principal, loan: (cols as Column[] & { loanName?: string }).loanName ?? "Loan" });
      }
      continue;
    }
    if (mode === "OTHER") continue;
    if (!sec && mode === null && (dateTok || amounts.length)) startSection("");
    const S = sec as (typeof sections)[number] | null;
    if (!S) continue;

    // Two-column summaries ("Previous Balance $4,721.70   Flexible Payment Option Limit $24,500.00"):
    // the amount right after the label, not the last one on the line.
    const balanceAmount = () => {
      if (amounts.length > 1 && textCells.some((t) => t.x > amounts[0].cell.x2 && t.x < amounts[amounts.length - 1].cell.x)) return amounts[0];
      return amounts[amounts.length - 1];
    };
    if (OPENING_ROW.test(desc)) {
      const b = balanceAmount();
      if (b) { prevBalance = balOf(b.amt); if (S.opening === null) S.opening = prevBalance; }
      current = null; pending = null; continue;
    }
    if (CLOSING_ROW.test(desc)) {
      const b = balanceAmount();
      if (b) S.closing = balOf(b.amt);
      current = null; pending = null; continue;
    }
    if (desc && STATEMENT_INFO.test(desc)) { current = null; pending = null; continue; }
    if (desc && isBalanceLine(desc)) {
      // Any other balance-only line: it confirms the running balance; it's never a transaction.
      const b = balanceAmount();
      if (b) { prevBalance = balOf(b.amt); if (S.opening === null && !S.rows.length) S.opening = prevBalance; else S.closing = prevBalance; }
      current = null; pending = null; continue;
    }

    // A dated row with text but no amounts: its amounts are probably on the next line.
    if (dateTok && !amounts.length && desc && !SKIP_ROW.test(desc)) {
      const ld = columnDate(dateTok);
      const date = ld ? resolveYear(ld, period, fallbackYear) : null;
      pending = date ? { date, desc, page: line.page, y: line.y, descX: textCells[0]?.x ?? 0 } : null;
      current = null;
      continue;
    }
    let rowDate: Date | null = null;
    if (!dateTok && amounts.length && pending && line.page === pending.page && line.y - pending.y < 30) {
      rowDate = pending.date;
      desc = `${pending.desc} ${desc}`.trim();
      pending = null;
    } else if (dateTok && amounts.length) {
      pending = null;
      if (SKIP_ROW.test(desc)) { current = null; continue; }
      const ld = columnDate(dateTok);
      rowDate = ld ? resolveYear(ld, period, fallbackYear) : null;
      if (!rowDate) { current = null; continue; }
    }
    // A row with money in or out but no date of its own (several transactions on the same day).
    let undated = false;
    if (!rowDate && !dateTok && cols && mode === "TXN" && /[a-zà-ÿ]{2}/i.test(desc) && !SKIP_ROW.test(desc) &&
        amounts.some((a) => a.col && ["OUT", "IN", "AMOUNT"].includes(a.col.kind)) &&
        (trailingDate || (S.lastDate && line.page === pos.page && line.y - pos.y < 40))) {
      rowDate = trailingDate ? new Date(0) : S.lastDate;
      undated = trailingDate;
    }

    if (rowDate) {
      const warnings: string[] = [];
      let signed: number | null = null;
      let balance: number | null = null;
      if (cols) {
        usedColumns = true;
        for (const a of amounts) {
          if (a.col?.kind === "OUT") signed = (signed ?? 0) - a.amt.cents;
          else if (a.col?.kind === "IN") signed = (signed ?? 0) + a.amt.cents;
          else if (a.col?.kind === "AMOUNT") {
            const isCredit = a.amt.credit || a.amt.explicitMinus;
            if (liability) signed = isCredit ? a.amt.cents : -a.amt.cents;
            else if (a.amt.debit || a.amt.explicitMinus) signed = -a.amt.cents;
            else if (a.amt.credit) signed = a.amt.cents;
            else { signed = -a.amt.cents; warnings.push("__unsigned"); }
          } else if (a.col?.kind === "BALANCE") balance = balOf(a.amt);
        }
      } else {
        const amt = amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[amounts.length - 1];
        if (amounts.length >= 2) balance = balOf(amounts[amounts.length - 1].amt);
        const isCredit = amt.amt.credit || amt.amt.explicitMinus;
        if (liability) signed = isCredit ? amt.amt.cents : -amt.amt.cents;
        else if (amt.amt.explicitMinus || amt.amt.debit) signed = -amt.amt.cents;
        else if (amt.amt.credit) signed = amt.amt.cents;
        else { signed = -amt.amt.cents; warnings.push("__unsigned"); }
      }
      if (signed === null) { current = null; continue; }
      // Seed the running balance with the opening balance printed elsewhere (summary box), so even the
      // first row's direction can be checked when the statement shows unsigned amounts.
      if (prevBalance === null && !S.rows.length && sections.length === 1 && (textOpening ?? labelled.opening) !== null) prevBalance = (textOpening ?? labelled.opening)!;
      if (balance !== null && prevBalance !== null) {
        usedBalance = true;
        const expect = (v: number) => (liability ? prevBalance! - v : prevBalance! + v);
        if (Math.abs(expect(signed) - balance) > 1 && Math.abs(expect(-signed) - balance) <= 1) signed = -signed;
        else if (Math.abs(expect(signed) - balance) > 1) warnings.push("The running balance on the statement doesn't match this amount. Please check it.");
        const idx = warnings.indexOf("__unsigned"); if (idx >= 0) warnings.splice(idx, 1);
      }
      const u = warnings.indexOf("__unsigned");
      if (u >= 0) warnings.splice(u, 1, "We couldn't tell from the statement whether this is money in or out. Please check it.");
      // No opening balance printed: the first row's balance minus its amount is where the period started.
      if (balance !== null && prevBalance === null && S.opening === null && !S.rows.length && !warnings.length) S.opening = liability ? balance + signed : balance - signed;
      if (balance !== null) { prevBalance = balance; S.closing = balance; }
      // No balance printed on this row: keep a running balance so the next printed one can be checked.
      else if (prevBalance !== null) prevBalance = liability ? prevBalance - signed : prevBalance + signed;
      current = { date: rowDate, amountCents: signed, description: desc || "(no description)", sourceRow: 0, warnings };
      if (undated) awaitingDate.push(current);
      else {
        for (const t of awaitingDate) t.date = rowDate;
        awaitingDate = [];
        S.lastDate = rowDate;
      }
      pos = { page: line.page, y: line.y, descX: textCells[0]?.x ?? 0 };
      S.rows.push(current);
      continue;
    }

    // Continuation of the previous (or pending) row's description.
    const target = pending ?? (current ? { desc: current.description, ...pos } : null);
    if (target && !dateTok && !amounts.length && desc && line.page === target.page && line.y - target.y < 30 &&
        textCells[0] && Math.abs(textCells[0].x - target.descX) < 25 && !NOT_CONTINUATION.test(desc) && desc.length < 80) {
      if (pending) { pending.desc = `${pending.desc} ${desc}`; pending.y = line.y; }
      else if (current) { current.description = `${current.description} ${desc}`.trim(); pos.y = line.y; }
      continue;
    }
    if (dateTok || amounts.length) { current = null; pending = null; }
  }

  // Rows still waiting for a date at the end: use the statement's last date and say so.
  for (const t of awaitingDate) {
    const fallback = sections.find((x) => x.rows.includes(t))?.lastDate ?? period.end;
    if (fallback) { t.date = fallback; t.warnings.push("The statement didn't print a date for this transaction, so we used the last date shown. Please check it."); }
  }
  awaitingDate = [];

  // Several accounts in one statement: import one section at a time.
  const withRows = sections.map((x, index) => ({ ...x, index })).filter((x) => x.rows.length);
  const chosen = withRows.find((x) => x.index === opts.section) ?? [...withRows].sort((a, b) => b.rows.length - a.rows.length)[0];
  if (withRows.length > 1) {
    res.sections = withRows.map((x) => ({ index: x.index, name: x.name, transactions: x.rows.length }));
    notes.push(`This statement covers ${withRows.length} accounts. We're showing "${chosen.name}". You can pick another one above.`);
  }
  res.transactions = (chosen?.rows ?? []).map((t, i) => ({ ...t, sourceRow: i + 1 }));
  res.openingBalanceCents = chosen?.opening ?? (sections.length <= 1 ? textOpening ?? labelled.opening : null);
  res.closingBalanceCents = chosen?.closing ?? (sections.length <= 1 ? textClosing ?? labelled.closing : null);
  if (sections.length <= 1 && textClosing !== null) res.closingBalanceCents = textClosing;
  if (sections.length <= 1 && textOpening !== null && res.openingBalanceCents === null) res.openingBalanceCents = textOpening;
  if (loanPayments.length) {
    res.loanPayments = loanPayments;
    const skipped = loanPayments.length;
    notes.push(`The loan section of this statement (${skipped} payment${skipped === 1 ? "" : "s"}) wasn't imported as transactions. We used it to split each loan payment into interest and principal.`);
  }

  if (!res.periodStart && res.transactions.length) {
    const ts = res.transactions.map((t) => t.date.getTime());
    res.periodStart = new Date(Math.min(...ts));
    res.periodEnd = new Date(Math.max(...ts));
    notes.push("We couldn't find the statement period printed on this PDF, so we used the first and last transaction dates. Adjust it below if needed.");
  }
  // Layout we don't know: read it line by line (a date anywhere on the line plus an amount).
  if (!res.transactions.length && !sections.some((x) => x.rows.length)) {
    const loose = lineByLine(lines, period, fallbackYear, liability, textOpening);
    if (loose.rows.length) {
      res.transactions = loose.rows.map((t, i) => ({ ...t, sourceRow: i + 1 }));
      res.openingBalanceCents ??= textOpening; res.closingBalanceCents ??= textClosing;
      if (!res.periodStart) {
        const ts = res.transactions.map((t) => t.date.getTime());
        res.periodStart = new Date(Math.min(...ts)); res.periodEnd = new Date(Math.max(...ts));
      }
      notes.push(loose.checked
        ? "This statement has an unusual layout, so we read it line by line and checked the amounts against its running balance. Please glance over the preview."
        : "This statement has an unusual layout, so we read it line by line. Please check every amount, and whether it's money in or out, in the preview.");
      return res;
    }
  }
  if (!res.transactions.length) notes.push(`We opened this PDF${res.institution ? ` (${res.institution})` : ""} but couldn't recognise any transaction lines in it. If it's a full statement (not a summary page), download the CSV or OFX version from your bank's website instead, or send the PDF to whoever supports your LedgerIQ so its layout can be added.`);
  else if (usedColumns && usedBalance) notes.push("We read the columns on this statement and checked every amount against its running balance.");
  else if (usedColumns) notes.push("We read the money-in and money-out columns on this statement. Please glance over the preview.");
  else notes.push("This statement doesn't have clear column headings, so please check the preview carefully.");
  return res;
}

/**
 * Last resort for layouts the column reader doesn't understand: any line with a date somewhere
 * and at least one amount is a transaction. With two amounts, the last is the running balance,
 * which then decides money in or out. Lines below a transaction with text only extend its description.
 */
function lineByLine(lines: Line[], period: { start: Date | null; end: Date | null }, fallbackYear: number | undefined, liability: boolean, opening: number | null): { rows: ParsedTxn[]; checked: boolean } {
  const ANY_DATE = new RegExp(`(?<![A-Za-z0-9])(${DATE_TOKEN})(?![A-Za-z0-9])`, "i");
  const rows: ParsedTxn[] = [];
  let prevBalance: number | null = opening, checked = false;
  let last: { t: ParsedTxn; page: number; y: number } | null = null;
  for (const line of lines) {
    const amountCells = line.cells.filter((c) => AMOUNT_CELL.test(c.str.trim()));
    const textCells = line.cells.filter((c) => !amountCells.includes(c));
    const text = textCells.map((c) => c.str).join(" ").replace(/\s+/g, " ").trim();
    const dm = text.match(ANY_DATE);
    if (OPENING_ROW.test(text.replace(ANY_DATE, "").trim()) || (text && isBalanceLine(text.replace(ANY_DATE, " ")))) {
      const a = amountCells.length ? readAmount(amountCells[amountCells.length - 1].str) : null;
      if (a) prevBalance = a.explicitMinus && !a.credit ? -a.cents : a.cents;
      last = null; continue;
    }
    if (!dm || !amountCells.length) {
      if (last && !dm && !amountCells.length && text && /[a-zà-ÿ]{2}/i.test(text) && line.page === last.page && line.y - last.y < 26 && text.length < 80 && !NOT_CONTINUATION.test(text)) {
        last.t.description = `${last.t.description} ${text}`.trim(); last.y = line.y;
      } else last = null;
      continue;
    }
    const desc = text.replace(dm[0], " ").replace(new RegExp(`^\\s*${DATE_TOKEN}(?![A-Za-z0-9])`, "i"), " ").replace(/\s+/g, " ").trim();
    if (!/[a-zà-ÿ]{2}/i.test(desc) || SKIP_ROW.test(desc) || CLOSING_ROW.test(desc) || STATEMENT_INFO.test(desc)) { last = null; continue; }
    const ld = parseLooseDate(dm[1]);
    const date = ld ? resolveYear(ld, period, fallbackYear) : null;
    if (!date) { last = null; continue; }
    const amts = amountCells.map((c) => readAmount(c.str)).filter((a): a is Amount => !!a);
    const amt = amts.length >= 2 ? amts[amts.length - 2] : amts[0];
    const balance = amts.length >= 2 ? (amts[amts.length - 1].explicitMinus && !amts[amts.length - 1].credit ? -amts[amts.length - 1].cents : amts[amts.length - 1].cents) : null;
    const warnings: string[] = [];
    let signed: number;
    const isCredit = amt.credit || amt.explicitMinus;
    if (liability) signed = isCredit ? amt.cents : -amt.cents;
    else if (amt.debit || amt.explicitMinus) signed = -amt.cents;
    else if (amt.credit) signed = amt.cents;
    else signed = -amt.cents;
    if (balance !== null && prevBalance !== null) {
      const expect = (v: number) => (liability ? prevBalance! - v : prevBalance! + v);
      if (Math.abs(expect(signed) - balance) > 1 && Math.abs(expect(-signed) - balance) <= 1) signed = -signed;
      if (Math.abs(expect(signed) - balance) <= 1) checked = true;
      else warnings.push("The running balance on the statement doesn't match this amount. Please check it.");
    } else if (!liability && !amt.debit && !amt.credit && !amt.explicitMinus) warnings.push("We couldn't tell from the statement whether this is money in or out. Please check it.");
    if (balance !== null) prevBalance = balance;
    else if (prevBalance !== null) prevBalance = liability ? prevBalance - signed : prevBalance + signed;
    const t: ParsedTxn = { date, amountCents: signed, description: desc, sourceRow: 0, warnings };
    rows.push(t);
    last = { t, page: line.page, y: line.y };
  }
  return { rows, checked };
}

/** Plain-text fallback (one statement line per text line), used when no positions are available. */
export function parseStatementText(text: string, accountType: AccountTypeName): ParseResult {
  const AMT = "-?\\(?\\$?\\d{1,3}(?:[ ,]?\\d{3})*[.,]\\d{2}\\)?(?:\\s?(?:CR|DR|-))?";
  const lines: Line[] = text.split(/\r?\n/).map((raw, i) => {
    const l = raw.replace(/\s+/g, " ").trim();
    const m = l.match(new RegExp(`^(.*?)\\s+(${AMT})(?:\\s+(${AMT}))?$`, "i"));
    const cells: Cell[] = m
      ? [{ x: 0, x2: 300, str: m[1] }, { x: 340, x2: 400, str: m[2] }, ...(m[3] ? [{ x: 440, x2: 500, str: m[3] }] : [])]
      : [{ x: 0, x2: 300, str: l }];
    return { page: 1, y: i * 14, cells, text: l };
  });
  return parseLayout(lines, accountType);
}

// pdf.js's "legacy" build installs polyfills on runtimes that lack them. On Node < 22 that
// includes ArrayBuffer.prototype.transfer, which pdf.js never calls but which Next.js's response
// streaming then picks up and fails with "ArrayBuffer is not detachable and could not be cloned".
// Remember what the runtime had natively, and remove that one polyfill after loading pdf.js.
const NATIVE_TRANSFER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "transfer");

function dropTransferPolyfill() {
  if (!NATIVE_TRANSFER && Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "transfer")) {
    delete (ArrayBuffer.prototype as { transfer?: unknown }).transfer;
  }
}

/** Open a PDF with the standard pdf.js build (shared with OCR rendering). */
export async function openPdf(buf: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  dropTransferPolyfill();
  try {
    return await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;
  } finally {
    dropTransferPolyfill(); // the worker module, loaded on first open, installs its own copy
  }
}

/** Extract positioned words from a text PDF. Returns null for image-only (scanned) PDFs. */
export async function pdfWords(buf: Buffer): Promise<{ words: Word[]; pages: number } | null> {
  const pdf = await openPdf(buf);
  const words: Word[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    for (const it of tc.items as { str?: string; transform: number[]; width: number }[]) {
      if (!it.str || !it.str.trim()) continue;
      const [, , , , e, f] = it.transform;
      words.push({ page: p, x: e, x2: e + it.width, y: vp.height - f, str: it.str });
    }
  }
  const chars = words.reduce((s, w) => s + w.str.trim().length, 0);
  return chars < 40 ? null : { words, pages: pdf.numPages };
}

export async function parsePdf(buf: Buffer, accountType: AccountTypeName, opts: { section?: number } = {}): Promise<ParseResult> {
  const empty = (note: string): ParseResult => ({ parser: "PDF", institution: null, currency: null, accountHint: null, periodStart: null, periodEnd: null, openingBalanceCents: null, closingBalanceCents: null, transactions: [], notes: [note] });
  let extracted: Awaited<ReturnType<typeof pdfWords>>;
  try {
    extracted = await pdfWords(buf);
  } catch (e) {
    if ((e as Error).name === "PasswordException" || /password/i.test((e as Error).message)) return empty("This PDF is password-protected. Open it in your PDF viewer, print or save it without a password, and upload that copy.");
    return empty("We couldn't open this PDF. It may be damaged. Try downloading the statement again.");
  }
  if (extracted) return parseLayout(buildLines(extracted.words), accountType, "PDF", opts);
  // Scanned statement: read it with OCR, then use the same layout reader.
  const { ocrPdfWords, ocrAvailable } = await import("./ocr");
  if (!(await ocrAvailable())) return empty("This PDF is a scanned image. Reading scanned statements needs the OCR component, which isn't installed on this server. Download a CSV or OFX from your bank instead.");
  const words = await ocrPdfWords(buf);
  if (!words.length) return empty("This PDF is a scanned image and we couldn't read any text from it. Try a clearer scan, or download a CSV or OFX from your bank.");
  const r = parseLayout(buildLines(words, 6, 4.5), accountType, "PDF (scanned, OCR)", opts);
  r.notes.unshift("This is a scanned statement, so we read it with text recognition. Please check every amount in the preview.");
  for (const t of r.transactions) if (!t.warnings.length) t.warnings.push("Read from a scan. Please confirm the amount.");
  return r;
}
