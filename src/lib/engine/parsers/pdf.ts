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
import { isLiability } from "../classify";
import type { AccountTypeName, ParseResult, ParsedTxn } from "../types";

// ---------- layout primitives
export interface Word { page: number; x: number; x2: number; y: number; str: string }
interface Cell { x: number; x2: number; str: string }
interface Line { page: number; y: number; cells: Cell[]; text: string }

/** Group words into lines (same baseline) and merge nearby words into cells. */
export function buildLines(words: Word[], gap = 4.5, rowTolerance = 2.5): Line[] {
  const sorted = words.filter((w) => w.str.trim()).sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
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
const AMOUNT_CELL = /^(?:-\s?)?\(?-?\s?\$?\s?\d{1,3}(?:[ ,  ]\d{3})*(?:[.,]\d{2})\)?(?:\s?(?:CR|DR|-))?\s?\$?$/i;

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
type ColKind = "DATE" | "DESC" | "OUT" | "IN" | "AMOUNT" | "BALANCE";
interface Column { kind: ColKind; x: number; x2: number }
const HEADER_WORDS: [RegExp, ColKind][] = [
  [/^(trans(action)?\.?\s*date|date( de transaction)?|post(ing)?\s*date|date d'inscription|date)$/i, "DATE"],
  [/^(description|details|transaction details|particulars|libell[eé]|transactions?)$/i, "DESC"],
  [/(withdrawals?|debits?|retraits?|cheques? & debits|paid out|charges?|d[eé]bit)( \(\$\))?( \$)?$/i, "OUT"],
  [/(deposits?|credits?|d[eé]p[oô]ts?|paid in|payments? (and|&) credits|cr[eé]dit)( \(\$\))?( \$)?$/i, "IN"],
  [/^(amount|montant|amount \(\$\)|montant \(\$\)|amount \$)$/i, "AMOUNT"],
  [/^(balance|solde)( \(\$\))?( \$)?$/i, "BALANCE"],
];

function detectHeader(line: Line): Column[] | null {
  const cols: Column[] = [];
  for (const c of line.cells) {
    const hit = HEADER_WORDS.find(([re]) => re.test(c.str.trim()));
    if (hit) cols.push({ kind: hit[1], x: c.x, x2: c.x2 });
  }
  const amountCols = cols.filter((c) => c.kind === "OUT" || c.kind === "IN" || c.kind === "AMOUNT");
  if (cols.length >= 2 && amountCols.length >= 1 && cols.some((c) => c.kind === "DATE" || c.kind === "DESC")) {
    // Two DATE columns (transaction + posting): keep the first as the transaction date.
    return cols;
  }
  return null;
}

/** Which amount column a right-aligned number belongs to. */
function columnFor(cell: Cell, cols: Column[]): Column | null {
  const money = cols.filter((c) => c.kind === "OUT" || c.kind === "IN" || c.kind === "AMOUNT" || c.kind === "BALANCE");
  let best: Column | null = null, dist = Infinity;
  for (const c of money) {
    // Numbers are usually right-aligned under the header; accept overlap or close right edges.
    const d = Math.min(Math.abs(cell.x2 - c.x2), cell.x2 >= c.x - 4 && cell.x <= c.x2 + 4 ? 0 : Infinity);
    if (d < dist) { dist = d; best = c; }
  }
  return dist <= 45 ? best : null;
}

// ---------- statement-level facts
export const INSTITUTION_KEYWORDS: Array<[RegExp, string]> = [
  [/scotiabank|bank of nova scotia/i, "Scotiabank"],
  [/royal bank|\brbc\b/i, "RBC Royal Bank"],
  [/td canada trust|toronto-dominion|\btd bank\b/i, "TD Canada Trust"],
  [/\bbmo\b|bank of montreal|banque de montr[eé]al/i, "BMO"],
  [/\bcibc\b|imperial bank of commerce/i, "CIBC"],
  [/national bank|banque nationale/i, "National Bank"],
  [/desjardins/i, "Desjardins"],
  [/american express|\bamex\b/i, "American Express"],
  [/tangerine/i, "Tangerine"],
  [/simplii/i, "Simplii Financial"],
  [/laurentian|laurentienne/i, "Laurentian Bank"],
];

const LONG_DATE = `(?:${MON}\\s\\d{1,2},?\\s\\d{4}|\\d{1,2}(?:er)?\\s${MON}\\s\\d{4}|\\d{4}-\\d{2}-\\d{2})`;
function findPeriod(text: string): { start: Date | null; end: Date | null } {
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
  const open = text.match(new RegExp(`(?:opening date|date d'ouverture)\\s*:?\\s*(${LONG_DATE})`, "i"));
  const close = text.match(new RegExp(`(?:closing date|statement date|date du relev[eé])\\s*:?\\s*(${LONG_DATE})`, "i"));
  if (open && close) {
    const a = parseLooseDate(open[1]), b = parseLooseDate(close[1]);
    if (a?.y && b?.y) return { start: utcDate(a.y, a.m, a.d), end: utcDate(b.y, b.m, b.d) };
  }
  return { start: null, end: null };
}

const AMT_IN_TEXT = "-?\\(?\\$?\\s?\\d{1,3}(?:[ ,\\u00a0]\\d{3})*[.,]\\d{2}\\)?(?:\\s?(?:CR|DR))?";
function amountAfter(text: string, label: RegExp): number | null {
  const m = text.match(new RegExp(`${label.source}[^\\d\\n-]{0,40}(${AMT_IN_TEXT})`, "i"));
  if (!m) return null;
  const a = readAmount(m[m.length - 1]);
  return a ? (a.explicitMinus && !a.credit ? -a.cents : a.cents) : null;
}

const OPENING_ROW = /^(opening balance|balance forward|previous (statement )?balance|solde (report[eé]|d'ouverture|pr[eé]c[eé]dent|ant[eé]rieur)|ancien solde)/i;
const CLOSING_ROW = /^(closing balance|new balance|ending balance|solde (de fermeture|final|actuel)|nouveau solde)/i;
const SKIP_ROW = /^(total|subtotal|sous-total|totaux|interest charged on|minimum payment|paiement minimum|payment due|page \d)/i;
const NOT_CONTINUATION = /^(reference|r[eé]f[eé]rence|page \d|continued|suite|please|veuillez|account|compte|total)/i;

// ---------- main
export function parseLayout(lines: Line[], accountType: AccountTypeName, parser = "PDF"): ParseResult {
  const notes: string[] = [];
  const text = lines.map((l) => l.text).join("\n");
  const period = findPeriod(text);
  const yearMatch = text.match(/\b(20\d{2})\b/);
  const res: ParseResult = {
    // The bank's name is in the letterhead; look there first so "Payment AMEX card" in a row doesn't decide it.
    parser, institution: INSTITUTION_KEYWORDS.find(([re]) => re.test(lines.slice(0, 8).map((l) => l.text).join(" ")))?.[1] ?? INSTITUTION_KEYWORDS.find(([re]) => re.test(text))?.[1] ?? null,
    currency: /\bUSD\b|US dollars?|dollars am[eé]ricains/i.test(text) ? "USD" : /\bCAD\b|canadian|canadiens/i.test(text) ? "CAD" : null,
    accountHint: text.match(/(?:\*{2,}|x{2,}[\sx]*|ending in|se terminant par|account ending)\s?(\d{4})\b/i)?.[1]
      ?? text.match(/(?:account|compte|folio)\s*(?:number|no\.?|num[eé]ro|#)?\s*:?\s*([\d][\d -]{3,}\d)\b/i)?.[1].replace(/\D/g, "").slice(-4) ?? null,
    periodStart: period.start, periodEnd: period.end, openingBalanceCents: null, closingBalanceCents: null, transactions: [], notes,
  };
  res.openingBalanceCents = amountAfter(text, /(opening balance|previous (statement )?balance|balance forward|solde (pr[eé]c[eé]dent|d'ouverture|report[eé])|ancien solde)/);
  res.closingBalanceCents = amountAfter(text, /(closing balance|new balance|ending balance|nouveau solde|solde (de fermeture|final))/);

  const liability = isLiability(accountType);
  let cols: Column[] | null = null;
  let prevBalance: number | null = res.openingBalanceCents;
  let lastBalance: number | null = null;
  let current: ParsedTxn | null = null;
  let pos = { page: 0, y: 0, descX: 0 }; // where the current row sits, for joining wrapped descriptions
  let usedColumns = false, usedBalance = false;
  const fallbackYear = yearMatch ? +yearMatch[1] : undefined;

  for (const line of lines) {
    const header = detectHeader(line);
    if (header) { cols = header; current = null; continue; }

    const first = line.cells[0]?.str ?? "";
    const dm = first.match(DATE_AT_START);
    // Split the date(s) off the first cell if the PDF merged them with the description.
    let cells = line.cells;
    let dateTok: string | null = null;
    if (dm) {
      dateTok = dm[1];
      const rest = first.slice(dm[0].length).trim();
      cells = [...(rest ? [{ ...line.cells[0], str: rest }] : []), ...line.cells.slice(1)];
      // A second date cell (posting date) right after
      if (cells[0] && new RegExp(`^${DATE_TOKEN}$`, "i").test(cells[0].str)) cells = cells.slice(1);
    }

    // Amounts: right-side cells that look like money (and sit under a money column, when columns are known).
    const amounts: { cell: Cell; col: Column | null; amt: Amount }[] = [];
    const textCells: Cell[] = [];
    for (const c of cells) {
      const amt = AMOUNT_CELL.test(c.str) ? readAmount(c.str) : null;
      const col = amt && cols ? columnFor(c, cols) : null;
      if (amt && (!cols || col)) amounts.push({ cell: c, col, amt });
      else textCells.push(c);
    }
    const desc = textCells.map((c) => c.str).join(" ").replace(/\s+/g, " ").trim();

    // Balance-forward / closing rows
    if (OPENING_ROW.test(desc)) {
      const b = amounts[amounts.length - 1];
      if (b) { const v = b.amt.explicitMinus && !b.amt.credit ? -b.amt.cents : b.amt.cents; prevBalance = v; if (res.openingBalanceCents === null) res.openingBalanceCents = v; }
      current = null; continue;
    }
    if (CLOSING_ROW.test(desc)) {
      const b = amounts[amounts.length - 1];
      if (b && res.closingBalanceCents === null) res.closingBalanceCents = b.amt.explicitMinus && !b.amt.credit ? -b.amt.cents : b.amt.cents;
      current = null; continue;
    }

    if (dateTok && amounts.length) {
      if (SKIP_ROW.test(desc)) { current = null; continue; }
      const ld = parseLooseDate(dateTok);
      const date = ld ? resolveYear(ld, period, fallbackYear) : null;
      if (!date) { current = null; continue; }
      const warnings: string[] = [];
      let signed: number | null = null;
      let balance: number | null = null;
      if (cols) {
        usedColumns = true;
        for (const a of amounts) {
          if (a.col?.kind === "OUT") signed = -a.amt.cents;
          else if (a.col?.kind === "IN") signed = a.amt.cents;
          else if (a.col?.kind === "AMOUNT") {
            const isCredit = a.amt.credit || a.amt.explicitMinus;
            signed = liability ? (isCredit ? a.amt.cents : -a.amt.cents) : (a.amt.debit || a.amt.explicitMinus ? -a.amt.cents : a.amt.credit ? a.amt.cents : null) ?? null;
            if (signed === null) signed = -a.amt.cents; // decided below by balance, or flagged
            if (!liability && !a.amt.credit && !a.amt.debit && !a.amt.explicitMinus) warnings.push("__unsigned");
          } else if (a.col?.kind === "BALANCE") balance = a.amt.explicitMinus && !a.amt.credit ? -a.amt.cents : a.amt.cents;
        }
      } else {
        // No header found: last number may be a running balance when there are two.
        const amt = amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[amounts.length - 1];
        if (amounts.length >= 2) { const b = amounts[amounts.length - 1].amt; balance = b.explicitMinus && !b.credit ? -b.cents : b.cents; }
        const isCredit = amt.amt.credit || amt.amt.explicitMinus;
        if (liability) signed = isCredit ? amt.amt.cents : -amt.amt.cents;
        else if (amt.amt.explicitMinus || amt.amt.debit) signed = -amt.amt.cents;
        else if (amt.amt.credit) signed = amt.amt.cents;
        else { signed = -amt.amt.cents; warnings.push("__unsigned"); }
      }
      if (signed === null) { current = null; continue; }
      // The running balance is the strongest evidence of direction.
      if (balance !== null && prevBalance !== null) {
        usedBalance = true;
        const expect = (s: number) => (liability ? prevBalance! - s : prevBalance! + s);
        if (Math.abs(expect(signed) - balance) > 1 && Math.abs(expect(-signed) - balance) <= 1) signed = -signed;
        else if (Math.abs(expect(signed) - balance) > 1) warnings.push("The running balance on the statement doesn't match this amount. Please check it.");
        const idx = warnings.indexOf("__unsigned"); if (idx >= 0) warnings.splice(idx, 1);
      }
      const u = warnings.indexOf("__unsigned");
      if (u >= 0) warnings.splice(u, 1, "We couldn't tell from the statement whether this is money in or out. Please check it.");
      if (balance !== null) { prevBalance = balance; lastBalance = balance; }
      current = { date, amountCents: signed, description: desc || "(no description)", sourceRow: res.transactions.length + 1, warnings };
      pos = { page: line.page, y: line.y, descX: textCells[0]?.x ?? 0 };
      res.transactions.push(current);
      continue;
    }

    // Continuation of the previous row's description (e.g. the payee printed on the next line).
    if (current && !dateTok && !amounts.length && desc && line.page === pos.page && line.y - pos.y < 30 &&
        textCells[0] && Math.abs(textCells[0].x - pos.descX) < 25 && !NOT_CONTINUATION.test(desc) && desc.length < 80) {
      current.description = `${current.description} ${desc}`.trim();
      pos.y = line.y;
      continue;
    }
    if (dateTok || amounts.length) current = null;
  }

  if (res.closingBalanceCents === null && lastBalance !== null) res.closingBalanceCents = lastBalance;
  if (!res.periodStart && res.transactions.length) {
    const ts = res.transactions.map((t) => t.date.getTime());
    res.periodStart = new Date(Math.min(...ts));
    res.periodEnd = new Date(Math.max(...ts));
    notes.push("We couldn't find the statement period printed on this PDF, so we used the first and last transaction dates. Adjust it below if needed.");
  }
  if (!res.transactions.length) notes.push("We read the PDF but couldn't find transaction lines. Try the CSV or OFX download from your bank instead, or check the PDF isn't a summary page only.");
  else if (usedColumns && usedBalance) notes.push("We read the columns on this statement and checked every amount against its running balance.");
  else if (usedColumns) notes.push("We read the money-in and money-out columns on this statement. Please glance over the preview.");
  else notes.push("This statement doesn't have clear column headings, so please check the preview carefully.");
  return res;
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

/** Open a PDF with the standard pdf.js build (shared with OCR rendering). */
export async function openPdf(buf: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;
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

export async function parsePdf(buf: Buffer, accountType: AccountTypeName): Promise<ParseResult> {
  const empty = (note: string): ParseResult => ({ parser: "PDF", institution: null, currency: null, accountHint: null, periodStart: null, periodEnd: null, openingBalanceCents: null, closingBalanceCents: null, transactions: [], notes: [note] });
  let extracted: Awaited<ReturnType<typeof pdfWords>>;
  try {
    extracted = await pdfWords(buf);
  } catch (e) {
    if ((e as Error).name === "PasswordException" || /password/i.test((e as Error).message)) return empty("This PDF is password-protected. Open it in your PDF viewer, print or save it without a password, and upload that copy.");
    return empty("We couldn't open this PDF. It may be damaged. Try downloading the statement again.");
  }
  if (extracted) return parseLayout(buildLines(extracted.words), accountType);
  // Scanned statement: read it with OCR, then use the same layout reader.
  const { ocrPdfWords, ocrAvailable } = await import("./ocr");
  if (!(await ocrAvailable())) return empty("This PDF is a scanned image. Reading scanned statements needs the OCR component, which isn't installed on this server. Download a CSV or OFX from your bank instead.");
  const words = await ocrPdfWords(buf);
  if (!words.length) return empty("This PDF is a scanned image and we couldn't read any text from it. Try a clearer scan, or download a CSV or OFX from your bank.");
  const r = parseLayout(buildLines(words, 6, 4.5), accountType, "PDF (scanned, OCR)");
  r.notes.unshift("This is a scanned statement, so we read it with text recognition. Please check every amount in the preview.");
  for (const t of r.transactions) if (!t.warnings.length) t.warnings.push("Read from a scan. Please confirm the amount.");
  return r;
}
