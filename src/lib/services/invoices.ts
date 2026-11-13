/**
 * Supplier invoices: upload (stored encrypted on this computer), list by supplier, and see which are
 * paid, unpaid or overdue from your bank transactions.
 */
import { createHash } from "node:crypto";
import { prisma } from "../db";
import { encrypt } from "../crypto";
import { audit } from "./audit";
import { buildLines, pdfWords, type Word } from "../engine/parsers/pdf";
import { matchInvoices, paymentsTo, readInvoice, type InvoiceState, type ReadInvoice } from "../engine/invoice";
import { nameWords } from "../engine/supplier";
import { companyKey, mentionsBuilding, sameBuilding } from "../engine/organize";

const day = (d: Date) => d.toISOString().slice(0, 10);
const at = (iso: string) => new Date(`${iso}T00:00:00Z`);

export async function readInvoiceFile(fileName: string, buf: Buffer): Promise<ReadInvoice> {
  let words: Word[] | null = null;
  try { words = (await pdfWords(buf))?.words ?? null; }
  catch (e) {
    if ((e as Error).name === "PasswordException" || /password/i.test((e as Error).message)) throw new Error("This PDF is password-protected.");
    throw new Error("We couldn't open this PDF.");
  }
  if (words) return readInvoice(buildLines(words), fileName);
  const { ocrAvailable, ocrPdfWords } = await import("../engine/parsers/ocr");
  if (!(await ocrAvailable())) throw new Error("This PDF is a scanned image and the text-recognition component isn't installed.");
  const r = readInvoice(buildLines(await ocrPdfWords(buf), 6, 4.5), fileName);
  r.notes.unshift("Scanned invoice, read with text recognition: please check the amounts.");
  return r;
}

/** The building an invoice is for, from its service (or billing) address. */
async function findBuilding(userId: string, r: ReadInvoice) {
  const where = r.serviceAddress ?? r.billedTo;
  if (!where) return null;
  const buildings = await prisma.building.findMany({ where: { userId }, select: { id: true, name: true, address: true, company: { select: { name: true } } } });
  const hits = buildings.filter((b) => mentionsBuilding(b.name, where) || sameBuilding(b.name, where) || (!!b.address && sameBuilding(b.address, where)));
  if (hits.length <= 1) return hits[0] ?? null;
  const key = r.billedTo ? companyKey(r.billedTo) : null;
  return hits.find((b) => key && companyKey(b.company.name) === key) ?? hits[0];
}

export type UploadResult = { fileName: string; ok: boolean; duplicate?: boolean; error?: string; id?: string; supplier?: string | null; invoiceNo?: string | null; invoiceDate?: string | null; totalCents?: number | null; building?: string | null; notes?: string[] };

export async function uploadInvoice(userId: string, fileName: string, buf: Buffer): Promise<UploadResult> {
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const existing = await prisma.supplierInvoice.findUnique({ where: { userId_sha256: { userId, sha256 } }, select: { id: true, supplier: true, invoiceNo: true } });
  if (existing) return { fileName, ok: true, duplicate: true, id: existing.id, supplier: existing.supplier, invoiceNo: existing.invoiceNo };
  let r: ReadInvoice;
  try { r = await readInvoiceFile(fileName, buf); } catch (e) { return { fileName, ok: false, error: (e as Error).message }; }
  if (!r.invoiceDate || r.totalCents === null || !r.supplier) return { fileName, ok: false, error: r.notes[0] ?? "This doesn't look like an invoice: no supplier, date or total found." };
  // The same invoice uploaded again under another file name.
  if (r.invoiceNo) {
    const same = await prisma.supplierInvoice.findFirst({ where: { userId, invoiceNo: r.invoiceNo, supplier: r.supplier }, select: { id: true } });
    if (same) return { fileName, ok: true, duplicate: true, id: same.id, supplier: r.supplier, invoiceNo: r.invoiceNo };
  }
  const building = await findBuilding(userId, r);
  const inv = await prisma.supplierInvoice.create({
    data: {
      userId, supplier: r.supplier, tradeName: r.tradeName, invoiceNo: r.invoiceNo, invoiceDate: at(r.invoiceDate), dueDate: r.dueDate ? at(r.dueDate) : null,
      description: r.description?.slice(0, 200) ?? null, billedTo: r.billedTo, serviceAddress: r.serviceAddress, buildingId: building?.id ?? null,
      subtotalCents: r.subtotalCents, gstCents: r.gstCents, qstCents: r.qstCents, totalCents: r.totalCents,
      fileName: fileName.slice(0, 200), sha256, file: encrypt(buf),
    },
    select: { id: true },
  });
  await audit(prisma, userId, "SupplierInvoice", inv.id, "invoice.upload", undefined, { supplier: r.supplier, invoiceNo: r.invoiceNo, totalCents: r.totalCents });
  return { fileName, ok: true, id: inv.id, supplier: r.supplier, invoiceNo: r.invoiceNo, invoiceDate: r.invoiceDate, totalCents: r.totalCents, building: building?.name ?? null, notes: r.notes };
}

export async function deleteInvoice(userId: string, id: string) {
  const r = await prisma.supplierInvoice.deleteMany({ where: { id, userId } });
  if (r.count) await audit(prisma, userId, "SupplierInvoice", id, "invoice.delete", undefined, undefined);
  return r.count > 0;
}

/** Group key: the distinctive words of the supplier's name, so "PRONTO RENOVATION INC." and "Pronto Renovation Inc" are one supplier. */
export const supplierKey = (name: string) => nameWords(name).join(" ") || name.toLowerCase().trim();

export interface InvoiceRow {
  id: string; invoiceNo: string | null; invoiceDate: string; dueDate: string | null; description: string | null; building: string | null;
  subtotalCents: number | null; gstCents: number | null; qstCents: number | null; totalCents: number; fileName: string; state: InvoiceState;
}
export interface SupplierGroup {
  key: string; supplier: string; tradeName: string | null; billedTo: string | null; invoices: InvoiceRow[];
  unpaidCents: number; overdueCents: number; gstCents: number; qstCents: number; totalCents: number; coveredUntil: string | null; payerAccounts: string[];
}

export async function listInvoices(userId: string): Promise<SupplierGroup[]> {
  const invoices = await prisma.supplierInvoice.findMany({ where: { userId }, orderBy: { invoiceDate: "desc" } });
  if (!invoices.length) return [];
  const buildings = new Map((await prisma.building.findMany({ where: { userId }, select: { id: true, name: true } })).map((b) => [b.id, b.name]));
  const groups = new Map<string, typeof invoices>();
  for (const i of invoices) groups.set(supplierKey(i.supplier), [...(groups.get(supplierKey(i.supplier)) ?? []), i]);
  const accounts = await prisma.account.findMany({ where: { userId }, select: { id: true, name: true, institution: true, mask: true, imports: { select: { periodEnd: true } }, statements: { select: { periodEnd: true } } } });
  const label = new Map(accounts.map((a) => [a.id, `${a.institution} · ${a.name}${a.mask && !a.name.includes(a.mask) ? ` ··${a.mask}` : ""}`]));
  const today = day(new Date());
  const out: SupplierGroup[] = [];
  for (const [key, list] of groups) {
    const first = list[list.length - 1];
    const words = nameWords(first.supplier, first.tradeName);
    const candidates = words.length ? await prisma.transaction.findMany({
      where: { userId, excluded: false, amountCents: { lt: 0 }, date: { gte: new Date(first.invoiceDate.getTime() - 10 * 86400000) },
        OR: words.flatMap((w) => [{ description: { contains: w, mode: "insensitive" as const } }, { merchant: { name: { contains: w, mode: "insensitive" as const } } }]) },
      select: { id: true, date: true, amountCents: true, description: true, accountId: true, merchant: { select: { name: true } } },
    }) : [];
    const linked = list.map((i) => i.transactionId).filter((x): x is string => !!x);
    const extra = linked.length ? await prisma.transaction.findMany({ where: { userId, id: { in: linked } }, select: { id: true, date: true, amountCents: true, description: true, accountId: true, merchant: { select: { name: true } } } }) : [];
    const pays = paymentsTo(first.supplier, first.tradeName, [...candidates, ...extra.filter((e) => !candidates.some((c) => c.id === e.id))]
      .map((t) => ({ id: t.id, date: day(t.date), amountCents: t.amountCents, description: t.description, merchant: t.merchant?.name ?? null, account: label.get(t.accountId) ?? "", accountId: t.accountId })));
    for (const e of extra) if (!pays.some((p) => p.id === e.id)) pays.push({ id: e.id, date: day(e.date), amountCents: e.amountCents, description: e.description, merchant: e.merchant?.name ?? null, account: label.get(e.accountId) ?? "", accountId: e.accountId });
    // How far your statements go, for the accounts you pay them from (all accounts if none yet).
    const payerIds = new Set(pays.map((p) => p.accountId));
    const relevant = accounts.filter((a) => !payerIds.size || payerIds.has(a.id));
    const ends = relevant.flatMap((a) => [...a.imports, ...a.statements].map((p) => p.periodEnd).filter((d): d is Date => !!d)).map(day).sort();
    const coveredUntil = ends.length ? ends[ends.length - 1] : null;
    const states = matchInvoices(list.map((i) => ({ id: i.id, supplier: i.supplier, invoiceNo: i.invoiceNo, invoiceDate: day(i.invoiceDate), dueDate: i.dueDate ? day(i.dueDate) : null, totalCents: i.totalCents, transactionId: i.transactionId })), pays, coveredUntil, today);
    const rows: InvoiceRow[] = list.map((i, n) => ({
      id: i.id, invoiceNo: i.invoiceNo, invoiceDate: day(i.invoiceDate), dueDate: i.dueDate ? day(i.dueDate) : null, description: i.description,
      building: i.buildingId ? buildings.get(i.buildingId) ?? null : null, subtotalCents: i.subtotalCents, gstCents: i.gstCents, qstCents: i.qstCents,
      totalCents: i.totalCents, fileName: i.fileName, state: states[n],
    }));
    const sum = (f: (r: InvoiceRow) => number) => rows.reduce((a, r) => a + f(r), 0);
    out.push({
      key, supplier: first.supplier, tradeName: first.tradeName, billedTo: first.billedTo, invoices: rows,
      unpaidCents: sum((r) => (["UNPAID", "OVERDUE", "UNKNOWN"].includes(r.state.status) ? r.totalCents : 0)),
      overdueCents: sum((r) => (r.state.status === "OVERDUE" ? r.totalCents : 0)),
      gstCents: sum((r) => r.gstCents ?? 0), qstCents: sum((r) => r.qstCents ?? 0), totalCents: sum((r) => r.totalCents),
      coveredUntil, payerAccounts: [...payerIds].map((id) => label.get(id) ?? ""),
    });
  }
  return out.sort((a, b) => b.overdueCents - a.overdueCents || b.unpaidCents - a.unpaidCents || a.supplier.localeCompare(b.supplier));
}

/** Invoice numbers on file for a supplier (for the statement check). */
export async function invoicesOnFile(userId: string, supplier: string | null) {
  if (!supplier) return [];
  const key = supplierKey(supplier);
  const all = await prisma.supplierInvoice.findMany({ where: { userId }, select: { id: true, supplier: true, invoiceNo: true, invoiceDate: true, totalCents: true } });
  return all.filter((i) => supplierKey(i.supplier) === key).map((i) => ({ id: i.id, invoiceNo: i.invoiceNo, invoiceDate: day(i.invoiceDate), totalCents: i.totalCents }));
}
