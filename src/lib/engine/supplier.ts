/**
 * Supplier statements ("État de compte / Statement" from a supplier): read their lines and check them
 * against your own bank transactions. Pure: no database, no network.
 *
 *  - every payment they recorded should be a payment out of one of your accounts (same amount, around
 *    the same date; a cheque can clear weeks later),
 *  - every payment you made to them should be on their statement,
 *  - their running balance should add up, and the amount due should equal it,
 *  - invoices not covered by payments (oldest first) are what you still owe; a payment smaller than
 *    the invoice it pays leaves a short payment.
 */
import { utcDate } from "./dates";
import { parseAmountToCents } from "./money";

export type EntryKind = "OPENING" | "INVOICE" | "PAYMENT" | "CREDIT" | "OTHER";
export interface SupplierEntry {
  date: string; description: string; kind: EntryKind;
  /** What it does to the amount you owe: + invoice, − payment or credit. */
  amountCents: number; balanceCents: number | null; line: number;
}
export interface SupplierStatement {
  supplier: string | null; customer: string | null; customerNo: string | null; statementDate: string | null;
  amountDueCents: number | null; entries: SupplierEntry[]; notes: string[];
}
export interface SourceLine { text: string; cells: { str: string }[] }

// ---------- reading
const AMOUNT = /^(?:-\s?)?\(?-?\s?\$?\s?(?:\d{1,3}(?:[ ,  ]\d{3})+|\d+)(?:[.,]\d{2})\)?(?:\s?(?:CR|DR|-))?\s?\$?$/i;
const isAmount = (s: string) => AMOUNT.test(s.trim()) && /\d[.,]\d{2}\b/.test(s);
const toCents = (s: string) => parseAmountToCents(s.replace(/[$\s  ]/g, (c) => (c === "$" ? "" : " ")).replace(/ (?=\d{3}\b)/g, "").replace(/\s/g, ""));

const MONTHS: Record<string, number> = {
  jan: 1, janv: 1, janvier: 1, january: 1, feb: 2, fev: 2, fevr: 2, fevrier: 2, february: 2, mar: 3, mars: 3, march: 3, apr: 4, avr: 4, avril: 4, april: 4,
  may: 5, mai: 5, jun: 6, juin: 6, june: 6, jul: 7, juil: 7, juillet: 7, july: 7, aug: 8, aou: 8, aout: 8, august: 8, sep: 9, sept: 9, september: 9, septembre: 9,
  oct: 10, october: 10, octobre: 10, nov: 11, november: 11, novembre: 11, dec: 12, december: 12, decembre: 12,
};
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\.$/, "");
const MON = "[A-Za-zÀ-ÿ]{3,9}\\.?";
const DATE_RE = new RegExp(`^(\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}|\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{2,4}|${MON}\\s\\d{1,2},?\\s\\d{4}|\\d{1,2}[\\s-]${MON}[\\s-]\\d{2,4})(?=\\s|$)`);

type Raw = { a: number; b: number; y: number } | { y: number; m: number; d: number };
function rawDate(tok: string): Raw | null {
  let m: RegExpMatchArray | null;
  if ((m = tok.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return { y: +m[1], m: +m[2], d: +m[3] };
  if ((m = tok.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) return { a: +m[1], b: +m[2], y: +m[3] < 100 ? 2000 + +m[3] : +m[3] };
  if ((m = tok.match(/^([A-Za-zÀ-ÿ]+)\.?\s(\d{1,2}),?\s(\d{4})$/)) && MONTHS[fold(m[1])]) return { y: +m[3], m: MONTHS[fold(m[1])], d: +m[2] };
  if ((m = tok.match(/^(\d{1,2})[\s-]([A-Za-zÀ-ÿ]+)\.?[\s-](\d{2,4})$/)) && MONTHS[fold(m[2])]) return { y: +m[3] < 100 ? 2000 + +m[3] : +m[3], m: MONTHS[fold(m[2])], d: +m[1] };
  return null;
}
/** "03/07/2026": day first or month first? Decided once for the whole statement (a number above 12 settles it; Québec default: day first). */
function dateOrder(raws: Raw[]): "DMY" | "MDY" {
  const ambiguous = raws.filter((r): r is { a: number; b: number; y: number } => "a" in r);
  if (ambiguous.some((r) => r.a > 12)) return "DMY";
  if (ambiguous.some((r) => r.b > 12)) return "MDY";
  return "DMY";
}
function iso(r: Raw, order: "DMY" | "MDY"): string | null {
  const [m, d] = "a" in r ? (order === "DMY" ? [r.b, r.a] : [r.a, r.b]) : [r.m, r.d];
  const dt = utcDate(r.y, m, d);
  return dt ? dt.toISOString().slice(0, 10) : null;
}

const OPENING = /\b(balance forward|previous balance|opening balance|solde (report[eé]|ant[eé]rieur|pr[eé]c[eé]dent|d'ouverture)|report|brought forward|balance b\/f)\b/i;
const PAYMENT = /\b(pmt|paym(en)?t|payment|paiement|pai?e|re[çc]u|received|deposit|d[eé]p[oô]t|chq|cheque|chèque|e-?transfer|virement|interac|eft|tef|ach|wire|visa|mastercard|amex|carte)\b/i;
const CREDIT = /\b(credit note|credit memo|cr[eé]dit|note de cr[eé]dit|nc|return|retour|refund|remboursement|discount|escompte|rabais|adjustment|ajustement|write.?off|radiation)\b/i;
const INVOICE = /\b(inv|invoice|facture|fact|fac|bill|charge|frais|service call|appel de service)\b/i;
const DUE = /(montant d[uû]|amount due|amt\.? due|balance due|solde d[uû]|total due|total [àa] payer|please pay|veuillez payer|solde)/i;

export function readSupplierStatement(lines: SourceLine[]): SupplierStatement {
  const notes: string[] = [];
  // Dates first, to settle day/month order.
  const dated = lines.map((l, i) => ({ l, i, m: l.text.trim().match(DATE_RE) })).filter((x) => x.m);
  const order = dateOrder(dated.map((x) => rawDate(x.m![1])).filter((r): r is Raw => !!r));

  const entries: SupplierEntry[] = [];
  let prevBal: number | null = null;
  for (const { l, i, m } of dated) {
    const date = rawDate(m![1]) && iso(rawDate(m![1])!, order);
    if (!date) continue;
    const cells = l.cells.map((c) => c.str.trim()).filter(Boolean);
    const amounts: number[] = [];
    while (cells.length && isAmount(cells[cells.length - 1])) amounts.unshift(toCents(cells.pop()!)!);
    // The rest (minus the date) is the description; a date followed by nothing but a total is not a line.
    let description = cells.join(" ").replace(DATE_RE, "").trim();
    description = description.replace(/^[-–:|]\s*/, "");
    if (!amounts.length || /^(total|sous-total|subtotal)\b/i.test(description)) continue;
    if (OPENING.test(description)) {
      const bal = amounts[amounts.length - 1];
      entries.push({ date, description, kind: "OPENING", amountCents: 0, balanceCents: bal, line: i });
      prevBal = bal;
      continue;
    }
    // [amount, balance], [charges, credits, balance] (one of them blank) or [amount].
    let amount: number, balance: number | null = null;
    if (amounts.length >= 2) { balance = amounts[amounts.length - 1]; amount = amounts[amounts.length - 2]; }
    else amount = amounts[0];
    let signed: number;
    if (balance !== null && prevBal !== null && Math.abs(Math.abs(balance - prevBal) - Math.abs(amount)) <= 1) signed = balance - prevBal;
    else if (amount < 0) signed = amount;
    else if (PAYMENT.test(description) || CREDIT.test(description)) signed = -Math.abs(amount);
    else signed = Math.abs(amount);
    const kind: EntryKind = signed < 0 ? (PAYMENT.test(description) || !CREDIT.test(description) ? "PAYMENT" : "CREDIT") : INVOICE.test(description) || signed > 0 ? "INVOICE" : "OTHER";
    entries.push({ date, description, kind, amountCents: signed, balanceCents: balance, line: i });
    if (balance !== null) prevBal = balance;
  }

  // Header facts.
  const STATEMENT_WORDS = /(statement|[eé]tat de compte|relev[eé]|page \d|^date$)/i;
  let supplier: string | null = null;
  for (const l of lines.slice(0, 6)) {
    const c = l.cells.map((x) => x.str.trim()).find((s) => s && !STATEMENT_WORDS.test(s) && /[A-Za-z]{3}/.test(s) && !isAmount(s));
    if (c) { supplier = c.replace(/\s{2,}/g, " "); break; }
  }
  const after = (re: RegExp, pick: (l: SourceLine) => string | null) => {
    const i = lines.findIndex((l) => l.cells.some((c) => re.test(c.str.trim())));
    if (i < 0) return null;
    for (const l of lines.slice(i + 1, i + 4)) { const v = pick(l); if (v) return v; }
    return null;
  };
  const customer = after(/^(client|customer|bill to|sold to|factur[eé] [àa]|vendu [àa]|soldto|billed to)\s*:?$/i, (l) => {
    const c = l.cells.map((x) => x.str.trim()).find((s) => /[A-Za-z]{2}/.test(s) && !/^\d+$/.test(s) && !/(no\.? de client|client no|customer (no|#|id)|account (no|#)|n[o°] de compte|date|page)/i.test(s));
    return c ?? null;
  });
  const customerNo = after(/(no\.? de client|client no|customer (no|#|id|number)|account (no|#|number)|n[o°] de compte)/i, (l) => l.cells.map((x) => x.str.trim()).find((s) => /^[A-Z0-9-]{2,}$/i.test(s)) ?? null);
  let amountDueCents: number | null = null;
  for (const [i, l] of lines.entries()) {
    if (!l.cells.some((c) => DUE.test(c.str))) continue;
    const same = l.cells.map((c) => c.str.trim()).filter(isAmount);
    const next = lines.slice(i + 1, i + 3).flatMap((x) => x.cells.map((c) => c.str.trim()).filter(isAmount));
    const v = same.length ? same[same.length - 1] : next.length ? next[0] : null;
    if (v) { amountDueCents = toCents(v); break; }
  }
  const dateLine = after(/^date$/i, (l) => l.cells.map((x) => x.str.trim()).find((s) => DATE_RE.test(s)) ?? null);
  const statementDate = (dateLine && rawDate(dateLine.match(DATE_RE)![1]) ? iso(rawDate(dateLine.match(DATE_RE)![1])!, order) : null) ?? entries[entries.length - 1]?.date ?? null;
  if (!entries.length) notes.push("We couldn't find dated lines with amounts on this statement.");
  return { supplier, customer, customerNo, statementDate, amountDueCents, entries, notes };
}

// ---------- checking
export interface BankTxn { id: string; date: string; amountCents: number; description: string; merchant: string | null; account: string; accountId: string }
export type PaymentStatus = "FOUND" | "FOUND_COMBINED" | "AMOUNT_DIFFERS" | "NOT_FOUND" | "NO_STATEMENT";
export interface PaymentCheck { entry: SupplierEntry; status: PaymentStatus; bank: BankTxn[]; days: number | null; differenceCents: number | null }
export interface SupplierCheck {
  payments: PaymentCheck[];
  /** Payments out of your accounts to this supplier that their statement doesn't show. */
  notOnTheirStatement: BankTxn[];
  arithmetic: { ok: boolean; wrong: { entry: SupplierEntry; expectedCents: number }[] };
  closingCents: number | null; dueMatchesBalance: boolean | null;
  openInvoices: { entry: SupplierEntry; openCents: number }[];
  totals: { invoicedCents: number; paidCents: number; creditedCents: number };
  nameWords: string[];
}

const LEGAL = new Set(["inc", "ltd", "ltee", "limitee", "corp", "corporation", "cie", "co", "enr", "llc", "the", "les", "des", "and", "et", "quebec", "canada", "group", "groupe", "services", "service", "company", "compagnie", "entreprises", "entreprise", "ascenseurs", "elevators", "renovation", "renovations",
  "construction", "plomberie", "plumbing", "electrique", "electric", "toiture", "roofing", "entretien", "maintenance", "gestion", "management", "immobilier", "solutions", "systems", "systemes", "distribution", "fournitures", "supplies"]);
/** The distinctive words of a supplier's name ("PRONTO RENOVATION INC." → ["pronto"]). */
export function nameWords(...names: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const n of names) for (const w of (n ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/))
    if (w.length >= 3 && !LEGAL.has(w) && !/^\d+$/.test(w)) out.add(w);
  return [...out];
}
export const mentions = (words: string[], text: string) => {
  const t = ` ${text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  return words.some((w) => t.includes(` ${w} `) || (w.length >= 5 && t.includes(w)));
};
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/**
 * @param bank       payments out of your accounts (amountCents < 0) around the statement's dates
 * @param uncovered  dates (YYYY-MM-DD) no imported bank statement covers, for the accounts you pay this supplier from
 * @param extraNames other names the supplier goes by on your bank statements
 */
export function checkSupplierStatement(st: SupplierStatement, bank: BankTxn[], uncovered: (date: string) => boolean, extraNames: string[] = []): SupplierCheck {
  const words = nameWords(st.supplier, ...extraNames);
  const named = (t: BankTxn) => words.length > 0 && (mentions(words, t.description) || (!!t.merchant && mentions(words, t.merchant)));
  const used = new Set<string>();
  const pays = st.entries.filter((e) => e.kind === "PAYMENT");
  // A payment naming them, or a cheque, shows in your bank from 10 days before (they record it late) to 35 days
  // after (a cheque clears late). One that doesn't name them only counts within about a week.
  const CHEQUE = /\b(chq|cheque|ch[eè]que|cheq)\b/i;
  const window = (e: SupplierEntry, t: BankTxn) => {
    const d = dayDiff(e.date, t.date);
    return named(t) || CHEQUE.test(t.description) ? d >= -10 && d <= 35 : d >= -5 && d <= 7;
  };
  const score = (e: SupplierEntry, t: BankTxn) => (named(t) ? 100 : 0) - Math.abs(dayDiff(e.date, t.date));
  const results = new Map<SupplierEntry, PaymentCheck>();

  // 1. Exact amount, best candidate first (named, then closest date). Named matches are settled before unnamed ones.
  const pairs: { e: SupplierEntry; t: BankTxn; s: number }[] = [];
  for (const e of pays) for (const t of bank) if (-t.amountCents === -e.amountCents && window(e, t)) pairs.push({ e, t, s: score(e, t) });
  pairs.sort((a, b) => b.s - a.s);
  for (const { e, t } of pairs) {
    if (results.has(e) || used.has(t.id)) continue;
    used.add(t.id);
    results.set(e, { entry: e, status: "FOUND", bank: [t], days: dayDiff(e.date, t.date), differenceCents: 0 });
  }
  // 2. Several payments they recorded the same day = one payment from you (or the reverse).
  const left = () => pays.filter((e) => !results.has(e));
  const byDate = new Map<string, SupplierEntry[]>();
  for (const e of left()) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  for (const [, group] of byDate) {
    if (group.length < 2) continue;
    const sum = group.reduce((a, e) => a - e.amountCents, 0);
    const t = bank.filter((x) => !used.has(x.id) && -x.amountCents === sum && window(group[0], x)).sort((a, b) => score(group[0], b) - score(group[0], a))[0];
    if (!t) continue;
    used.add(t.id);
    for (const e of group) results.set(e, { entry: e, status: "FOUND_COMBINED", bank: [t], days: dayDiff(e.date, t.date), differenceCents: 0 });
  }
  for (const e of left()) {
    const cands = bank.filter((x) => !used.has(x.id) && named(x) && window(e, x));
    for (let i = 0; i < cands.length && !results.has(e); i++) for (let j = i + 1; j < cands.length && !results.has(e); j++) {
      if (cands[i].amountCents + cands[j].amountCents === e.amountCents) {
        used.add(cands[i].id); used.add(cands[j].id);
        results.set(e, { entry: e, status: "FOUND_COMBINED", bank: [cands[i], cands[j]], days: dayDiff(e.date, cands[i].date), differenceCents: 0 });
      }
    }
  }
  // 3. A payment to them around that date, but a different amount.
  for (const e of left()) {
    const t = bank.filter((x) => !used.has(x.id) && named(x) && Math.abs(dayDiff(e.date, x.date)) <= 7).sort((a, b) => Math.abs(dayDiff(e.date, a.date)) - Math.abs(dayDiff(e.date, b.date)))[0];
    if (!t) continue;
    used.add(t.id);
    results.set(e, { entry: e, status: "AMOUNT_DIFFERS", bank: [t], days: dayDiff(e.date, t.date), differenceCents: -t.amountCents - -e.amountCents });
  }
  for (const e of left()) results.set(e, { entry: e, status: uncovered(e.date) ? "NO_STATEMENT" : "NOT_FOUND", bank: [], days: null, differenceCents: null });

  // Your payments to them, in the statement's period, that they didn't record.
  const first = st.entries.find((e) => e.kind !== "OPENING")?.date ?? st.entries[0]?.date;
  const last = st.statementDate ?? st.entries[st.entries.length - 1]?.date;
  const notOnTheirStatement = first && last ? bank.filter((t) => !used.has(t.id) && named(t) && t.date >= first && dayDiff(t.date, last) >= 3) : [];

  // Their arithmetic.
  const wrong: SupplierCheck["arithmetic"]["wrong"] = [];
  let run: number | null = null;
  for (const e of st.entries) {
    if (e.kind === "OPENING") { run = e.balanceCents; continue; }
    if (run !== null) run += e.amountCents;
    if (run !== null && e.balanceCents !== null && Math.abs(run - e.balanceCents) > 1) { wrong.push({ entry: e, expectedCents: run }); run = e.balanceCents; }
    else if (run === null && e.balanceCents !== null) run = e.balanceCents;
  }
  const lastBal = [...st.entries].reverse().find((e) => e.balanceCents !== null)?.balanceCents ?? null;
  const opening = st.entries.find((e) => e.kind === "OPENING")?.balanceCents ?? 0;
  const closing = lastBal ?? opening + st.entries.reduce((a, e) => a + e.amountCents, 0);

  // What's still owed, oldest invoice first (an opening balance counts as the oldest).
  const invoices: { entry: SupplierEntry; openCents: number }[] = [];
  const op = st.entries.find((e) => e.kind === "OPENING");
  if (op && (op.balanceCents ?? 0) > 0) invoices.push({ entry: op, openCents: op.balanceCents! });
  let credit = op && (op.balanceCents ?? 0) < 0 ? -op.balanceCents! : 0;
  for (const e of st.entries) {
    if (e.kind === "OPENING") continue;
    if (e.amountCents > 0) invoices.push({ entry: e, openCents: e.amountCents });
    else credit += -e.amountCents;
    for (const inv of invoices) { const x = Math.min(inv.openCents, credit); inv.openCents -= x; credit -= x; if (!credit) break; }
  }
  const sum = (f: (e: SupplierEntry) => boolean) => st.entries.filter(f).reduce((a, e) => a + Math.abs(e.amountCents), 0);
  return {
    payments: pays.map((e) => results.get(e)!),
    notOnTheirStatement,
    arithmetic: { ok: wrong.length === 0, wrong },
    closingCents: closing,
    dueMatchesBalance: st.amountDueCents === null ? null : Math.abs(st.amountDueCents - closing) <= 1,
    openInvoices: invoices.filter((i) => i.openCents > 0),
    totals: { invoicedCents: sum((e) => e.kind === "INVOICE"), paidCents: sum((e) => e.kind === "PAYMENT"), creditedCents: sum((e) => e.kind === "CREDIT") },
    nameWords: words,
  };
}
