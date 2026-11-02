/**
 * Tabular statement parser shared by CSV and XLSX.
 * Detects the header row, column roles, date order and sign convention, and
 * recognises known Canadian institution layouts. The detected mapping is returned
 * so the user can correct it in the import preview.
 */
import { parseAmountToCents } from "../money";
import { parseDate, type DateOrder } from "../dates";
import { isLiability } from "../classify";
import type { AccountTypeName, ColumnMapping, ParseResult, ParsedTxn } from "../types";

const norm = (s: unknown) => String(s ?? "").trim();
const lc = (s: unknown) => norm(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

interface Template {
  institution: string;
  /** Matches the header row (lower-cased cells joined by |) or, for headerless files, a sample row. */
  headerTest?: (h: string) => boolean;
  rowTest?: (row: string[]) => boolean;
  mapping: Partial<ColumnMapping>;
}

// Known layouts. Headers are matched loosely; columns are then found by name anyway.
const TEMPLATES: Template[] = [
  { institution: "RBC Royal Bank", headerTest: (h) => h.includes("account number") && h.includes("description 1") && h.includes("cad$"), mapping: { dateOrder: "MDY", amountSign: "AS_IS" } },
  { institution: "American Express", headerTest: (h) => (h.includes("cardmember") || h.includes("date processed")) && h.includes("amount"), mapping: { dateOrder: "DMY", amountSign: "INVERT" } },
  { institution: "BMO", headerTest: (h) => h.includes("first bank card") || (h.includes("item #") && h.includes("card #")), mapping: { dateOrder: "YMD" } },
  { institution: "Scotiabank", headerTest: (h) => h.includes("sub-description") && h.includes("type of transaction"), mapping: { dateOrder: "YMD", amountSign: "AS_IS" } },
  { institution: "National Bank", headerTest: (h) => h.includes("date") && h.includes("description") && h.includes("categorie"), mapping: { dateOrder: "YMD" } },
  // Headerless layouts
  { institution: "TD Canada Trust", rowTest: (r) => r.length >= 4 && r.length <= 5 && /^\d{2}\/\d{2}\/\d{4}$/.test(norm(r[0])) && !/\d/.test(norm(r[1]).slice(0, 1)), mapping: { date: 0, description: 1, debit: 2, credit: 3, dateOrder: "MDY", hasHeader: false } },
  { institution: "CIBC", rowTest: (r) => r.length >= 4 && /^\d{4}-\d{2}-\d{2}$/.test(norm(r[0])) && (norm(r[2]) === "" || norm(r[3]) === ""), mapping: { date: 0, description: 1, debit: 2, credit: 3, dateOrder: "YMD", hasHeader: false } },
  { institution: "Desjardins", rowTest: (r) => r.length >= 9 && /^\d{4}\/\d{2}\/\d{2}$/.test(norm(r[3])), mapping: { date: 3, description: 5, debit: 7, credit: 8, dateOrder: "YMD", hasHeader: false } },
];

const COL = {
  date: [/^(transaction )?date( de (la )?transaction)?$/, /^date$/, /trans(action)? date/, /^posted date$/, /date posted/, /^date d'operation$/],
  postedDate: [/posting date|date processed|date posted|date d'inscription/],
  description: [/^description( 1)?$/, /payee|merchant|details|memo|libelle|narrative|^name$|transaction description/, /^description/],
  extra: [/^description 2$|sub-description|^memo$/],
  amount: [/^amount$|transaction amount|^montant$|^cad\$$|^amount \(cad\)$|^value$/],
  debit: [/debit|withdrawal|retrait|^charges?$|money out|paid out/],
  credit: [/credit|deposit|depot|payments?$|money in|paid in/],
  reference: [/reference|ref(erence)? ?(no|#)|fitid|transaction id|confirmation/],
  balance: [/balance|solde/],
};

function findCol(headers: string[], patterns: RegExp[], exclude: number[] = []): number | undefined {
  for (const p of patterns) {
    const i = headers.findIndex((h, idx) => !exclude.includes(idx) && p.test(h));
    if (i >= 0) return i;
  }
  return undefined;
}

function looksLikeHeader(row: string[]): boolean {
  const cells = row.map(lc).filter(Boolean);
  if (cells.length < 2) return false;
  const datey = cells.filter((c) => parseDate(c, "MDY") !== null).length;
  const numeric = cells.filter((c) => parseAmountToCents(c) !== null).length;
  const named = cells.filter((c) => /date|description|amount|montant|debit|credit|payee|memo|balance|solde|transaction/.test(c)).length;
  return named >= 2 && datey === 0 && numeric <= 1;
}

function detectDateOrder(values: string[]): { order: DateOrder; ambiguous: boolean } {
  let firstOver12 = false, secondOver12 = false, ymd = false;
  for (const v of values) {
    const s = norm(v);
    if (/^\d{4}[-/.]/.test(s) || /^\d{8}/.test(s)) { ymd = true; continue; }
    const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}$/);
    if (!m) continue;
    if (+m[1] > 12) firstOver12 = true;
    if (+m[2] > 12) secondOver12 = true;
  }
  if (ymd) return { order: "YMD", ambiguous: false };
  if (firstOver12 && !secondOver12) return { order: "DMY", ambiguous: false };
  if (secondOver12 && !firstOver12) return { order: "MDY", ambiguous: false };
  const hasNumeric = values.some((v) => /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(norm(v)));
  return { order: "MDY", ambiguous: hasNumeric };
}

/** Infer columns for a headerless file by looking at what values each column holds. */
function inferColumns(rows: string[][]): Partial<ColumnMapping> {
  const width = Math.max(...rows.map((r) => r.length));
  const sample = rows.slice(0, 50);
  const score = (i: number, f: (s: string) => boolean) => sample.filter((r) => f(norm(r[i]))).length / sample.length;
  const cols = Array.from({ length: width }, (_, i) => ({
    i,
    date: score(i, (s) => parseDate(s, "MDY") !== null || parseDate(s, "DMY") !== null),
    num: score(i, (s) => s !== "" && parseAmountToCents(s) !== null),
    empty: score(i, (s) => s === ""),
    text: score(i, (s) => /[a-z]{3,}/i.test(s) && parseDate(s, "MDY") === null),
  }));
  const date = cols.filter((c) => c.date > 0.8).sort((a, b) => b.date - a.date)[0]?.i;
  const description = cols.filter((c) => c.i !== date).sort((a, b) => b.text - a.text)[0]?.i;
  const numeric = cols.filter((c) => c.i !== date && c.i !== description && c.num + c.empty > 0.95 && c.num > 0.05);
  // Two sparse numeric columns side by side = debit/credit. One dense = signed amount.
  const sparse = numeric.filter((c) => c.empty > 0.05);
  if (sparse.length >= 2) return { date, description, debit: sparse[0].i, credit: sparse[1].i };
  return { date, description, amount: numeric[0]?.i };
}

export interface TabularOptions {
  accountType: AccountTypeName;
  mapping?: ColumnMapping; // user correction from the preview
  parserName: string;
}

export function parseRows(rawRows: unknown[][], opts: TabularOptions): ParseResult {
  const rows = rawRows.map((r) => r.map(norm)).filter((r) => r.some((c) => c !== ""));
  const notes: string[] = [];
  const result: ParseResult = {
    parser: opts.parserName, institution: null, currency: null, accountHint: null,
    periodStart: null, periodEnd: null, openingBalanceCents: null, closingBalanceCents: null,
    transactions: [], notes,
  };
  if (!rows.length) { notes.push("The file is empty."); return result; }

  // Find the header row within the first 15 rows (some banks prepend account info).
  let headerIdx = -1;
  for (let i = 0; i < Math.min(15, rows.length); i++) if (looksLikeHeader(rows[i])) { headerIdx = i; break; }
  const headers = headerIdx >= 0 ? rows[headerIdx].map(lc) : [];
  const body = headerIdx >= 0 ? rows.slice(headerIdx + 1) : rows;
  // Account hints in the preamble ("Account: ****1234")
  for (const r of rows.slice(0, Math.max(headerIdx, 0))) {
    const m = r.join(" ").match(/(\*{2,}|x{2,})\s?(\d{3,4})\b/i);
    if (m) result.accountHint = m[2];
  }

  let mapping: Partial<ColumnMapping> = {};
  let template: Template | undefined;
  if (headerIdx >= 0) {
    const joined = headers.join("|");
    template = TEMPLATES.find((t) => t.headerTest?.(joined));
    const date = findCol(headers, COL.date);
    const description = findCol(headers, COL.description, [date ?? -1]);
    const amount = findCol(headers, COL.amount);
    const debit = amount === undefined ? findCol(headers, COL.debit) : undefined;
    const credit = amount === undefined ? findCol(headers, COL.credit, [debit ?? -1]) : undefined;
    const extra = findCol(headers, COL.extra, [description ?? -1]);
    const reference = findCol(headers, COL.reference);
    mapping = { date, description, amount, debit, credit, extraDescription: extra, reference, hasHeader: true };
    if (headers.some((h) => /usd/.test(h)) && !headers.some((h) => /cad/.test(h))) result.currency = "USD";
    if (headers.some((h) => /cad/.test(h))) result.currency = "CAD";
  } else {
    template = TEMPLATES.find((t) => t.rowTest?.(rows[0]));
    mapping = template?.mapping.date !== undefined ? { ...template.mapping } : inferColumns(rows);
    mapping.hasHeader = false;
  }
  if (template) {
    result.institution = template.institution;
    if (template.mapping.dateOrder) mapping.dateOrder = template.mapping.dateOrder;
    if (template.mapping.amountSign) mapping.amountSign = template.mapping.amountSign;
  }

  if (opts.mapping) mapping = { ...opts.mapping };

  if (mapping.date === undefined || mapping.description === undefined || (mapping.amount === undefined && mapping.debit === undefined && mapping.credit === undefined)) {
    notes.push("We couldn't tell which columns hold the date, description and amount. Please choose them below.");
    result.headers = headerIdx >= 0 ? rows[headerIdx] : rows[0].map((_, i) => `Column ${i + 1}`);
    result.mapping = { date: mapping.date ?? 0, description: mapping.description ?? 1, amount: mapping.amount ?? 2, amountSign: "AS_IS", dateOrder: "MDY", hasHeader: headerIdx >= 0 };
    return result;
  }

  const dateValues = body.map((r) => r[mapping.date!]);
  if (!mapping.dateOrder) {
    const d = detectDateOrder(dateValues);
    mapping.dateOrder = d.order;
    if (d.ambiguous) notes.push("Dates like 03/04 could mean March 4 or April 3. We read them as month/day. Change this below if that's wrong.");
  }

  // Sign convention for a single amount column.
  if (mapping.amount !== undefined && !mapping.amountSign) {
    mapping.amountSign = "AS_IS";
    if (isLiability(opts.accountType)) {
      const vals = body.map((r) => ({ c: parseAmountToCents(r[mapping.amount!]), d: lc(r[mapping.description!]) })).filter((v) => v.c !== null);
      const positives = vals.filter((v) => v.c! > 0).length;
      const paymentsNegative = vals.filter((v) => /payment|paiement|thank you|merci/.test(v.d)).every((v) => v.c! < 0);
      if (positives > vals.length / 2 && paymentsNegative) {
        mapping.amountSign = "INVERT";
        notes.push("This card statement lists purchases as positive numbers. We've treated them as money spent.");
      }
    }
  }

  const fullMapping = mapping as ColumnMapping;
  result.mapping = fullMapping;
  result.headers = headerIdx >= 0 ? rows[headerIdx] : rows[0].map((_, i) => `Column ${i + 1}`);

  body.forEach((r, i) => {
    const sourceRow = i + 1 + (headerIdx >= 0 ? headerIdx + 1 : 0);
    const rawDate = r[fullMapping.date];
    const date = parseDate(rawDate ?? "", fullMapping.dateOrder);
    let desc = norm(r[fullMapping.description]);
    if (fullMapping.extraDescription !== undefined && norm(r[fullMapping.extraDescription])) desc = `${desc} ${norm(r[fullMapping.extraDescription])}`.trim();
    let cents: number | null = null;
    if (fullMapping.amount !== undefined) {
      cents = parseAmountToCents(r[fullMapping.amount]);
      if (cents !== null && fullMapping.amountSign === "INVERT") cents = -cents;
    } else {
      const debit = fullMapping.debit !== undefined ? parseAmountToCents(r[fullMapping.debit]) : null;
      const credit = fullMapping.credit !== undefined ? parseAmountToCents(r[fullMapping.credit]) : null;
      if (debit !== null || credit !== null) cents = Math.abs(credit ?? 0) - Math.abs(debit ?? 0);
    }
    if (!date && cents === null) return; // footer / blank-ish line
    const warnings: string[] = [];
    if (!date) warnings.push(`We couldn't read the date "${rawDate ?? ""}".`);
    if (cents === null) warnings.push("We couldn't read the amount.");
    if (!desc) warnings.push("This line has no description.");
    if (/opening balance|closing balance|solde (d'ouverture|de fermeture)|balance forward/i.test(desc)) return;
    const txn: ParsedTxn = {
      date: date ?? new Date(0), amountCents: cents ?? 0, description: desc || "(no description)",
      externalId: fullMapping.reference !== undefined ? norm(r[fullMapping.reference]) || undefined : undefined,
      pending: /pending|en attente/i.test(r.join(" ")), sourceRow, warnings,
    };
    result.transactions.push(txn);
  });

  const dates = result.transactions.filter((t) => t.date.getTime() > 0).map((t) => t.date.getTime());
  if (dates.length) {
    result.periodStart = new Date(Math.min(...dates));
    result.periodEnd = new Date(Math.max(...dates));
  }
  return result;
}
