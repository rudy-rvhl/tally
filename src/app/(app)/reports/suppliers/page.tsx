import Link from "next/link";
import clsx from "clsx";
import { FileText, Trash2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { ReportsTabs } from "@/components/Nav";
import { SupplierCheck } from "@/components/SupplierCheck";
import { InvoiceUpload } from "@/components/InvoiceUpload";
import { listInvoices, type InvoiceRow } from "@/lib/services/invoices";
import { deleteInvoiceAction } from "@/app/actions";
import { formatMoney } from "@/lib/engine/money";

export const metadata = { title: "Suppliers" };

const fmt = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");

function Status({ r, c }: { r: InvoiceRow; c: string }) {
  const s = r.state;
  const pill = (cls: string, text: string) => <span className={clsx("inline-flex rounded-full px-2 py-0.5 text-xs font-semibold", cls)}>{text}</span>;
  if (s.status === "PAID" || s.status === "PAID_TOGETHER") return (
    <div>
      {pill("bg-emerald-100 text-emerald-800", s.status === "PAID_TOGETHER" ? `Paid (with ${s.paidWith - 1} other${s.paidWith > 2 ? "s" : ""})` : "Paid")}
      {s.payment && <Link href={`/transactions/${s.payment.id}`} className="mt-0.5 block text-xs text-slate-600 hover:text-brand-700">{fmt(s.payment.date)} · {formatMoney(-s.payment.amountCents, c)} · {s.payment.account}</Link>}
    </div>
  );
  if (s.status === "OVERDUE") return <div>{pill("bg-red-100 text-red-800", "Overdue")}<div className="mt-0.5 text-xs text-red-700">was due {fmt(r.dueDate)}</div></div>;
  if (s.status === "UNKNOWN") return <div>{pill("bg-slate-100 text-slate-700", "Can't tell yet")}<div className="mt-0.5 text-xs text-slate-500">no bank statement after this date imported</div></div>;
  return <div>{pill("bg-amber-100 text-amber-800", "Unpaid")}<div className="mt-0.5 text-xs text-slate-500">due {fmt(r.dueDate)}</div></div>;
}

export default async function SuppliersPage() {
  const user = await requireUser();
  const c = user.baseCurrency;
  const groups = await listInvoices(user.id);
  return (
    <>
      <ReportsTabs />
      <PageHeader title="Suppliers" subtitle="Keep your suppliers' invoices here and see which are paid, and check a supplier's statement against your bank." />

      <Card className="mb-6" title="Supplier invoices">
        <InvoiceUpload currency={c} />
      </Card>

      {groups.map((g) => (
        <Card key={g.key} className="mb-6" padded={false} title={<span>{g.supplier}{g.tradeName ? <span className="font-normal text-slate-500"> · {g.tradeName}</span> : null}</span>}
          subtitle={`${g.invoices.length} invoice${g.invoices.length === 1 ? "" : "s"}${g.billedTo ? ` billed to ${g.billedTo}` : ""}`}>
          <div className="grid grid-cols-2 gap-3 border-b border-slate-100 px-5 pb-4 text-sm sm:grid-cols-5" data-testid="invoice-group-summary">
            <div><div className="text-slate-500">Invoiced</div><div className="num font-semibold">{formatMoney(g.totalCents, c)}</div></div>
            <div><div className="text-slate-500">Not paid</div><div className={clsx("num font-semibold", g.unpaidCents ? "text-amber-700" : "text-emerald-700")} data-testid="invoice-unpaid">{formatMoney(g.unpaidCents, c)}</div></div>
            <div><div className="text-slate-500">Overdue</div><div className={clsx("num font-semibold", g.overdueCents ? "text-red-700" : "text-slate-900")}>{formatMoney(g.overdueCents, c)}</div></div>
            <div><div className="text-slate-500">GST paid</div><div className="num font-semibold">{formatMoney(g.gstCents, c)}</div></div>
            <div><div className="text-slate-500">QST paid</div><div className="num font-semibold">{formatMoney(g.qstCents, c)}</div></div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="invoice-table">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-2">Invoice</th><th className="px-4 py-2">Date</th><th className="px-4 py-2">For</th><th className="px-4 py-2 text-right">Before tax</th><th className="px-4 py-2 text-right">GST</th><th className="px-4 py-2 text-right">QST</th><th className="px-4 py-2 text-right">Total</th><th className="px-4 py-2">Paid?</th><th className="px-2 py-2" /></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {g.invoices.map((r) => (
                  <tr key={r.id} data-status={r.state.status}>
                    <td className="whitespace-nowrap px-4 py-2"><a href={`/api/invoices/${r.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium hover:text-brand-700"><FileText className="h-3.5 w-3.5" />{r.invoiceNo ?? "—"}</a></td>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-600">{fmt(r.invoiceDate)}</td>
                    <td className="px-4 py-2">{r.description ?? ""}{r.building ? <div className="text-xs text-slate-500">{r.building}</div> : null}</td>
                    <td className="num px-4 py-2 text-right">{r.subtotalCents !== null ? formatMoney(r.subtotalCents, c) : "—"}</td>
                    <td className="num px-4 py-2 text-right">{r.gstCents !== null ? formatMoney(r.gstCents, c) : "—"}</td>
                    <td className="num px-4 py-2 text-right">{r.qstCents !== null ? formatMoney(r.qstCents, c) : "—"}</td>
                    <td className="num px-4 py-2 text-right font-semibold">{formatMoney(r.totalCents, c)}</td>
                    <td className="px-4 py-2"><Status r={r} c={c} /></td>
                    <td className="px-2 py-2">
                      <form action={deleteInvoiceAction}><input type="hidden" name="id" value={r.id} />
                        <button className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Remove this invoice" aria-label={`Remove invoice ${r.invoiceNo ?? ""}`}><Trash2 className="h-4 w-4" /></button></form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-3 text-xs text-slate-500">
            {g.payerAccounts.length ? `Matched to your payments naming them, from ${g.payerAccounts.join(", ")}.` : "No payment naming this supplier was found in your bank statements yet."}
            {g.coveredUntil ? ` Your statements go up to ${fmt(g.coveredUntil)}.` : ""}
          </p>
        </Card>
      ))}

      <h2 className="mb-3 mt-8 text-lg font-semibold">Check a supplier&apos;s statement</h2>
      <SupplierCheck currency={c} />
    </>
  );
}
