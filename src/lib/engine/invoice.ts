/**
 * Supplier invoices (bills): read one from its PDF layout, and work out which ones are paid from
 * your bank transactions. Pure: no database, no network.
 */
import { utcDate } from "./dates";
import { parseAmountToCents } from "./money";
import { mentions, nameWords } from "./supplier";

export interface InvoiceLine { text: string; cells: { x: number; str: string }[] }
export interface ReadInvoice {
  supplier: string | null; tradeName: string | null; invoiceNo: string | null; invoiceDate: string | null; dueDate: string | null;
  description: string | null; billedTo: string | null; serviceAddress: string | null;
  subtotalCents: number | null; gstCents: number | null; qstCents: number | null; totalCents: number | null; balanceDueCents: number | null;
  notes: string[];
}

const AMOUNT = /^(?:-\s?)?\(?-?\s?\$?\s?(?:\d{1,3}(?:[ ,  ]\d{3})+|\d+)[.,]\d{2}\)?\s?\$?$/;
const amt = (s: string) => parseAmountToCents(s.replace(/[$\s  ]/g, (c) => (c === "$" ? "" : " ")).replace(/ (?=\d{3}\b)/g, "").replace(/\s/g, ""));
const amounts = (l: InvoiceLine) => l.cells.map((c) => c.str.trim()).filter((s) => AMOUNT.test(s)).map((s) => amt(s)!).filter((v) => v !== null);
const ISO = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/;
const DMY = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/;
const MONTHS: Record<string, number> = { jan: 1, janv: 1, janvier: 1, january: 1, feb: 2, fev: 2, fevrier: 2, february: 2, mar: 3, mars: 3, march: 3, apr: 4, avr: 4, avril: 4, april: 4, may: 5, mai: 5, jun: 6, juin: 6, june: 6, jul: 7, juil: 7, juillet: 7, july: 7, aug: 8, aout: 8, august: 8, sep: 9, sept: 9, septembre: 9, september: 9, oct: 10, octobre: 10, october: 10, nov: 11, novembre: 11, november: 11, dec: 12, decembre: 12, december: 12 };
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const isoOf = (y: number, m: number, d: number) => utcDate(y, m, d)?.toISOString().slice(0, 10) ?? null;
function findDate(s: string): string | null {
  let m: RegExpMatchArray | null;
  if ((m = s.match(ISO))) return isoOf(+m[1], +m[2], +m[3]);
  if ((m = s.match(DMY))) return +m[1] > 12 ? isoOf(+m[3], +m[2], +m[1]) : isoOf(+m[3], +m[1], +m[2]);
  if ((m = fold(s).match(/\b([a-z]{3,9})\.?\s(\d{1,2}),?\s(\d{4})\b/)) && MONTHS[m[1]]) return isoOf(+m[3], MONTHS[m[1]], +m[2]);
  if ((m = fold(s).match(/\b(\d{1,2})\s([a-z]{3,9})\.?\s(\d{4})\b/)) && MONTHS[m[2]]) return isoOf(+m[3], MONTHS[m[2]], +m[1]);
  return null;
}
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** The cell under a label: on the next few lines, the one closest to the label's left edge. */
function under(lines: InvoiceLine[], i: number, labelX: number, accept: (s: string) => boolean, maxLines = 3): string | null {
  for (const l of lines.slice(i + 1, i + 1 + maxLines)) {
    const c = l.cells.filter((x) => accept(x.str.trim())).sort((a, b) => Math.abs(a.x - labelX) - Math.abs(b.x - labelX))[0];
    if (c && Math.abs(c.x - labelX) <= 70) return c.str.trim();
  }
  return null;
}
const findLine = (lines: InvoiceLine[], re: RegExp) => lines.findIndex((l) => l.cells.some((c) => re.test(c.str.trim())));
const cellX = (l: InvoiceLine, re: RegExp) => l.cells.find((c) => re.test(c.str.trim()))?.x ?? 0;

export function readInvoice(lines: InvoiceLine[], fileName = ""): ReadInvoice {
  const notes: string[] = [];
  const TITLE = /^(facture|invoice|facture\s*\/\s*invoice|bill|tax invoice|facture de taxes|page \d.*|date|no\.?|n[o°]\.?|#)$/i;
  // Supplier: the first name-like cell at the top; the line under it may be a trade name ("Pronto Entretien").
  let supplier: string | null = null, tradeName: string | null = null;
  for (const [i, l] of lines.slice(0, 8).entries()) {
    const c = l.cells.map((x) => x.str.trim()).find((s) => /[A-Za-z]{3}/.test(s) && !TITLE.test(s) && !/invoice|facture/i.test(s) && !AMOUNT.test(s));
    if (c) {
      supplier = c;
      const next = lines[i + 1]?.cells.map((x) => x.str.trim()).find((s) => /[A-Za-z]{3}/.test(s) && !TITLE.test(s) && !/\d{2,}/.test(s));
      if (next && !/^(date|no)/i.test(next)) tradeName = next;
      break;
    }
  }

  // Date and number: printed under "Date" and "No." headings, or after "Invoice #", or in the file name.
  let invoiceDate: string | null = null, invoiceNo: string | null = null;
  const h = lines.findIndex((l) => l.cells.some((c) => /^date( de (la )?facture)?$|^invoice date$/i.test(c.str.trim())));
  if (h >= 0) {
    const d = under(lines, h, cellX(lines[h], /^date|^invoice date/i), (s) => !!findDate(s));
    invoiceDate = d ? findDate(d) : null;
    const noX = lines[h].cells.find((c) => /^(no\.?|n[o°]\.?|#|num[eé]ro|invoice (no|#|number))$/i.test(c.str.trim()))?.x;
    if (noX !== undefined) invoiceNo = under(lines, h, noX, (s) => /^[A-Z]{0,4}-?\d{3,}[A-Z0-9-]*$/i.test(s));
  }
  if (!invoiceNo) {
    const m = lines.map((l) => l.text).join("\n").match(/(?:invoice|facture)\s*(?:no\.?|n[o°]\.?|#|number|num[eé]ro)\s*:?\s*([A-Z0-9-]{3,})/i);
    invoiceNo = m?.[1] ?? fileName.match(/inv(?:oice)?[_\s-]*(\d{3,})/i)?.[1] ?? null;
  }
  if (!invoiceDate) invoiceDate = lines.slice(0, 15).map((l) => findDate(l.text)).find((d) => !!d) ?? null;

  // Billed to / service address.
  const b = findLine(lines, /(factur[eé] [àa]|invoice to|bill(ed)? to|sold to|vendu [àa]|client)\s*:?/i);
  const billedTo = b >= 0 ? under(lines, b, cellX(lines[b], /(factur[eé] [àa]|invoice to|bill(ed)? to|sold to|vendu [àa]|client)/i), (s) => /[A-Za-z]{2}/.test(s) && !/:$/.test(s)) : null;
  const sv = findLine(lines, /(service [àa]|service to|ship to|livr[eé] [àa]|lieu des travaux|job site|site)\s*:?/i);
  const serviceAddress = sv >= 0 ? under(lines, sv, cellX(lines[sv], /(service [àa]|service to|ship to|livr[eé] [àa]|lieu|job site|site)/i), (s) => /\d/.test(s) && /[A-Za-z]{3}/.test(s), 4) : null;

  // What it's for.
  const forLine = lines.find((l) => /(pour le mois d|for the month of|p[eé]riode|period|for services|services rendus)/i.test(l.text));
  let description = forLine?.text.trim() ?? null;
  if (!description) {
    const dh = findLine(lines, /^description$/i);
    description = dh >= 0 ? lines[dh + 1]?.text.trim() ?? null : null;
  }

  // Money.
  const lastOn = (re: RegExp, prefer?: RegExp) => {
    const cands = lines.filter((l) => l.cells.some((c) => re.test(c.str.trim())) && amounts(l).length);
    const l = (prefer && cands.find((x) => prefer.test(x.text))) ?? cands[0];
    if (!l) return null;
    const a = amounts(l); return a[a.length - 1];
  };
  const subtotalCents = lastOn(/^(sous-total|sub-?total|sous-total\s*\/\s*sub-total|montant avant taxes|subtotal)/i);
  const gstCents = lastOn(/^(tps|gst|hst|tvh)\b/i, /%/);
  const qstCents = lastOn(/^(tvq|qst|pst)\b/i, /%/);
  const balanceDueCents = lastOn(/(balance due|solde d[uû]|amount due|montant d[uû]|total d[uû]|[àa] payer)/i);
  let totalCents = lastOn(/^(total|total\s*\(?(cad|\$)\)?|grand total|montant total|total de la facture|invoice total)$/i);
  if (totalCents === null && subtotalCents !== null) totalCents = subtotalCents + (gstCents ?? 0) + (qstCents ?? 0);
  if (totalCents === null) totalCents = balanceDueCents;
  if (subtotalCents !== null && totalCents !== null && Math.abs(subtotalCents + (gstCents ?? 0) + (qstCents ?? 0) - totalCents) > 2)
    notes.push("The subtotal and taxes don't add up to the total printed on the invoice.");

  // Due date: printed, or from the terms ("Net 30").
  let dueDate: string | null = null;
  const due = findLine(lines, /(due date|date d'[eé]ch[eé]ance|[eé]ch[eé]ance|payable by)/i);
  if (due >= 0) dueDate = findDate(lines[due].text) ?? (() => { const s = under(lines, due, cellX(lines[due], /(due|[eé]ch[eé]ance|payable)/i), (x) => !!findDate(x)); return s ? findDate(s) : null; })();
  const net = lines.map((l) => l.text).join(" ").match(/\bnet\s?(\d{1,3})\b/i);
  if (!dueDate && invoiceDate && net) dueDate = addDays(invoiceDate, +net[1]);
  if (!invoiceDate) notes.push("We couldn't find the invoice date.");
  if (totalCents === null) notes.push("We couldn't find the invoice total.");
  return { supplier, tradeName, invoiceNo, invoiceDate, dueDate, description, billedTo, serviceAddress, subtotalCents, gstCents, qstCents, totalCents, balanceDueCents, notes };
}

// ---------- paid or not
export interface InvoiceForMatch { id: string; supplier: string; invoiceNo: string | null; invoiceDate: string; dueDate: string | null; totalCents: number; transactionId: string | null }
export interface PaymentForMatch { id: string; date: string; amountCents: number; description: string; merchant: string | null; account: string }
export type InvoiceStatus = "PAID" | "PAID_TOGETHER" | "UNPAID" | "OVERDUE" | "UNKNOWN";
export interface InvoiceState { invoiceId: string; status: InvoiceStatus; payment: PaymentForMatch | null; paidWith: number; daysToPay: number | null }

const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/**
 * One supplier's invoices against your payments to them (payments out naming them).
 * Each payment pays one invoice of the same amount (the oldest one it can, made at most a week before and
 * five months after the invoice), or several unpaid invoices in a row that add up to it.
 * @param coveredUntil  last day your bank statements cover, for the accounts you pay them from (null: unknown)
 * @param today         YYYY-MM-DD
 */
export function matchInvoices(invoices: InvoiceForMatch[], payments: PaymentForMatch[], coveredUntil: string | null, today: string): InvoiceState[] {
  const sorted = [...invoices].sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate) || (a.invoiceNo ?? "").localeCompare(b.invoiceNo ?? ""));
  const pays = [...payments].filter((p) => p.amountCents < 0).sort((a, b) => a.date.localeCompare(b.date));
  const used = new Set<string>();
  const state = new Map<string, InvoiceState>();
  const byId = new Map(pays.map((p) => [p.id, p]));
  for (const inv of sorted) if (inv.transactionId) {
    const p = byId.get(inv.transactionId) ?? null;
    if (p) used.add(p.id);
    state.set(inv.id, { invoiceId: inv.id, status: "PAID", payment: p, paidWith: 1, daysToPay: p ? days(inv.invoiceDate, p.date) : null });
  }
  const fits = (inv: InvoiceForMatch, p: PaymentForMatch) => { const d = days(inv.invoiceDate, p.date); return d >= -7 && d <= 150; };
  // Same amount, oldest invoice first, earliest suitable payment.
  for (const inv of sorted) {
    if (state.has(inv.id)) continue;
    const p = pays.find((x) => !used.has(x.id) && -x.amountCents === inv.totalCents && fits(inv, x));
    if (p) { used.add(p.id); state.set(inv.id, { invoiceId: inv.id, status: "PAID", payment: p, paidWith: 1, daysToPay: days(inv.invoiceDate, p.date) }); }
  }
  // One payment for several invoices in a row.
  for (const p of pays) {
    if (used.has(p.id)) continue;
    const open = sorted.filter((i) => !state.has(i.id) && days(i.invoiceDate, p.date) >= -7 && days(i.invoiceDate, p.date) <= 150);
    for (let s = 0; s < open.length && !used.has(p.id); s++) {
      let sum = 0;
      for (let e = s; e < open.length && e < s + 12; e++) {
        sum += open[e].totalCents;
        if (sum === -p.amountCents && e > s) {
          used.add(p.id);
          for (const inv of open.slice(s, e + 1)) state.set(inv.id, { invoiceId: inv.id, status: "PAID_TOGETHER", payment: p, paidWith: e - s + 1, daysToPay: days(inv.invoiceDate, p.date) });
          break;
        }
        if (sum > -p.amountCents) break;
      }
    }
  }
  for (const inv of sorted) {
    if (state.has(inv.id)) continue;
    const due = inv.dueDate ?? new Date(Date.parse(`${inv.invoiceDate}T00:00:00Z`) + 30 * 86400000).toISOString().slice(0, 10);
    // Unpaid as far as your statements go; if they stop before the invoice, we can't tell.
    const status: InvoiceStatus = coveredUntil !== null && coveredUntil < inv.invoiceDate ? "UNKNOWN" : due < today ? "OVERDUE" : "UNPAID";
    state.set(inv.id, { invoiceId: inv.id, status, payment: null, paidWith: 0, daysToPay: null });
  }
  return invoices.map((i) => state.get(i.id)!);
}

/** Payments that name this supplier (in the description or as the payee). */
export function paymentsTo<T extends { description: string; merchant: string | null }>(supplier: string, tradeName: string | null, payments: T[], otherNames: string[] = []): T[] {
  const words = nameWords(supplier, tradeName, ...otherNames);
  return words.length ? payments.filter((p) => mentions(words, p.description) || (!!p.merchant && mentions(words, p.merchant))) : [];
}
