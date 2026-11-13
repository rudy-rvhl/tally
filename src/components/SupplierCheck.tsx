"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import clsx from "clsx";
import { UploadCloud, Loader2, CheckCircle2, AlertTriangle, XCircle, HelpCircle, Printer } from "lucide-react";
import type { checkSupplierFile } from "@/lib/services/supplier";
import type { PaymentStatus } from "@/lib/engine/supplier";
import { formatMoney } from "@/lib/engine/money";

type Result = Awaited<ReturnType<typeof checkSupplierFile>> & { payerAccounts?: string[] };
const fmtDay = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");

const STATUS: Record<PaymentStatus, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  FOUND: { label: "Found in your bank", cls: "bg-emerald-50 text-emerald-800 border-emerald-200", icon: CheckCircle2 },
  FOUND_COMBINED: { label: "Found (paid together)", cls: "bg-emerald-50 text-emerald-800 border-emerald-200", icon: CheckCircle2 },
  AMOUNT_DIFFERS: { label: "Amount differs", cls: "bg-amber-50 text-amber-800 border-amber-200", icon: AlertTriangle },
  NOT_FOUND: { label: "Not in your bank", cls: "bg-red-50 text-red-800 border-red-200", icon: XCircle },
  NO_STATEMENT: { label: "No bank statement for this date", cls: "bg-slate-50 text-slate-700 border-slate-200", icon: HelpCircle },
};

export function SupplierCheck({ currency }: { currency: string }) {
  const [r, setR] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const m = (v: number | null | undefined) => (v === null || v === undefined ? "—" : formatMoney(v, currency));

  async function run(f: File | null | undefined, otherName = name) {
    if (!f) return;
    setFile(f); setBusy(true); setError(""); setR(null);
    try {
      const fd = new FormData(); fd.set("file", f); if (otherName.trim()) fd.set("name", otherName.trim());
      const res = await fetch("/api/supplier/check", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setR(body);
    } catch (e) { setError((e as Error).message || "We couldn't read this statement."); }
    setBusy(false);
  }

  const st = r?.statement, c = r?.check;
  const pays = c?.payments ?? [];
  const found = pays.filter((p) => p.status === "FOUND" || p.status === "FOUND_COMBINED").length;
  const notFound = pays.filter((p) => p.status === "NOT_FOUND").length;
  const differ = pays.filter((p) => p.status === "AMOUNT_DIFFERS").length;
  const unknown = pays.filter((p) => p.status === "NO_STATEMENT").length;
  const extra = c?.notOnTheirStatement ?? [];
  const allGood = c && found === pays.length && !extra.length && c.arithmetic.ok && c.dueMatchesBalance !== false;
  const statusOf = new Map(pays.map((p) => [p.entry.line, p]));

  return (
    <div className="space-y-6">
      <div className="card p-5 print:hidden">
        <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); run(e.dataTransfer.files?.[0]); }}
          onClick={() => input.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") input.current?.click(); }}
          className={clsx("flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center", drag ? "border-brand-500 bg-brand-50" : "border-slate-300 hover:border-brand-400")}>
          {busy ? <Loader2 className="h-8 w-8 animate-spin text-brand-600" /> : <UploadCloud className="h-8 w-8 text-brand-600" />}
          <div className="font-semibold">{busy ? "Checking against your bank transactions…" : "Drop a supplier's statement here"}</div>
          <p className="max-w-xl text-sm text-slate-500">The “État de compte / Statement” a supplier sends you, as PDF (also scanned), CSV or Excel. Each payment on it is looked for in all your bank accounts. The file is read on this computer and not kept.</p>
          <input ref={input} type="file" className="sr-only" accept=".pdf,.csv,.xlsx" data-testid="supplier-input" onChange={(e) => { run(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[16rem] flex-1"><label className="label" htmlFor="sname">Name on your bank statements, if different (optional)</label>
            <input id="sname" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. the person you e-transfer" /></div>
          {file && <button className="btn-secondary" onClick={() => run(file)} disabled={busy}>Check again</button>}
        </div>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {r && st && c && (
        <>
          <div className={clsx("card border-l-4 p-5", allGood ? "border-l-emerald-500" : notFound || differ || extra.length || !c.arithmetic.ok || c.dueMatchesBalance === false ? "border-l-red-500" : "border-l-amber-400")} data-testid="supplier-summary">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">{st.supplier ?? "Supplier"}{st.customer ? <span className="font-normal text-slate-500"> · statement for {st.customer}</span> : null}</h2>
                <p className="text-sm text-slate-500">{r.fileName}{st.statementDate ? ` · dated ${fmtDay(st.statementDate)}` : ""}{st.customerNo ? ` · client no. ${st.customerNo}` : ""}</p>
              </div>
              <button className="btn-secondary print:hidden" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</button>
            </div>
            <p className="mt-3 text-base text-slate-800" data-testid="supplier-verdict">
              {allGood ? <span className="font-semibold text-emerald-700">Everything matches. </span> : null}
              <strong>{found} of {pays.length}</strong> payment{pays.length === 1 ? "" : "s"} on their statement {found === 1 ? "is" : "are"} in your bank transactions.
              {notFound ? <span className="font-semibold text-red-700"> {notFound} not found.</span> : null}
              {differ ? <span className="font-semibold text-amber-700"> {differ} with a different amount.</span> : null}
              {unknown ? <span className="text-slate-600"> {unknown} can&apos;t be checked yet: no bank statement imported for {unknown === 1 ? "that date" : "those dates"}.</span> : null}
              {extra.length ? <span className="font-semibold text-red-700"> {extra.length} payment{extra.length === 1 ? "" : "s"} you made {extra.length === 1 ? "isn't" : "aren't"} on their statement.</span> : null}
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><dt className="text-slate-500">They say you owe</dt><dd className="num text-lg font-semibold" data-testid="supplier-due">{m(st.amountDueCents ?? c.closingCents)}</dd></div>
              <div><dt className="text-slate-500">Invoiced</dt><dd className="num font-semibold">{m(c.totals.invoicedCents)}</dd></div>
              <div><dt className="text-slate-500">Payments they recorded</dt><dd className="num font-semibold">{m(c.totals.paidCents)}</dd></div>
              <div><dt className="text-slate-500">Their math</dt><dd className={clsx("font-semibold", c.arithmetic.ok && c.dueMatchesBalance !== false ? "text-emerald-700" : "text-red-700")} data-testid="supplier-math">
                {!c.arithmetic.ok ? `${c.arithmetic.wrong.length} line(s) don't add up` : c.dueMatchesBalance === false ? "Amount due ≠ balance" : "Adds up"}</dd></div>
            </dl>
            {r.payerAccounts?.length ? <p className="mt-3 text-xs text-slate-500">You pay {st.supplier ?? "them"} from: {r.payerAccounts.join(", ")}. Looking for “{c.nameWords.join("”, “")}” in your bank descriptions.</p>
              : <p className="mt-3 text-xs text-slate-500">No earlier payment naming {st.supplier ?? "them"} was found, so all your accounts were searched by amount and date. If your bank shows them under another name, type it above and check again.</p>}
            {st.notes.map((n) => <p key={n} className="mt-2 text-xs text-amber-700">{n}</p>)}
          </div>

          <div className="card overflow-hidden" data-testid="supplier-lines">
            <div className="border-b border-slate-100 px-5 py-3 font-semibold">Their statement, line by line</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="px-4 py-2">Date</th><th className="px-4 py-2">Description</th><th className="px-4 py-2 text-right">Amount</th><th className="px-4 py-2 text-right">Balance</th><th className="px-4 py-2">In your bank</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {st.entries.map((e) => {
                    const p = statusOf.get(e.line);
                    const S = p ? STATUS[p.status] : null;
                    return (
                      <tr key={e.line} data-kind={e.kind} data-status={p?.status ?? ""}>
                        <td className="whitespace-nowrap px-4 py-2 text-slate-600">{fmtDay(e.date)}</td>
                        <td className="px-4 py-2">{e.description}<span className="ml-2 text-xs text-slate-400">{e.kind === "INVOICE" ? "invoice" : e.kind === "PAYMENT" ? "payment" : e.kind === "CREDIT" ? "credit" : e.kind === "OPENING" ? "opening balance" : ""}</span></td>
                        <td className={clsx("num whitespace-nowrap px-4 py-2 text-right", e.amountCents < 0 && "text-emerald-700")}>{e.kind === "OPENING" ? "" : m(e.amountCents)}</td>
                        <td className="num whitespace-nowrap px-4 py-2 text-right text-slate-600">{m(e.balanceCents)}</td>
                        <td className="px-4 py-2">
                          {p && S && (
                            <div>
                              <span className={clsx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold", S.cls)}><S.icon className="h-3.5 w-3.5" />{S.label}</span>
                              {p.bank.map((t) => (
                                <Link key={t.id} href={`/transactions/${t.id}`} className="mt-1 block text-xs text-slate-600 hover:text-brand-700">
                                  {fmtDay(t.date)} · {m(-t.amountCents)} · {t.description} · <span className="text-slate-400">{t.account}</span>
                                </Link>
                              ))}
                              {p.status === "AMOUNT_DIFFERS" && p.differenceCents !== null && <div className="text-xs font-semibold text-amber-700">Your bank shows {m(Math.abs(p.differenceCents))} {p.differenceCents > 0 ? "more" : "less"} than they recorded.</div>}
                              {p.status === "NOT_FOUND" && <div className="text-xs text-red-700">No payment of {m(-e.amountCents)} around this date in your bank. Ask them for proof of payment, or check another account.</div>}
                              {p.status === "FOUND" && p.days !== null && Math.abs(p.days) > 3 && <div className="text-xs text-slate-500">{Math.abs(p.days)} days {p.days > 0 ? "later" : "earlier"} in your bank.</div>}
                            </div>
                          )}
                          {e.kind === "INVOICE" && (r.invoicesOnFileCount ?? 0) > 0 && (r.invoiceFiles?.[e.line]
                            ? <a href={`/api/invoices/${r.invoiceFiles[e.line].id}`} target="_blank" rel="noreferrer" className={clsx("text-xs hover:underline", r.invoiceFiles[e.line].totalCents === e.amountCents ? "text-emerald-700" : "font-semibold text-red-700")} data-testid="invoice-on-file">
                                {r.invoiceFiles[e.line].totalCents === e.amountCents ? "Invoice on file ✓" : `Your copy says ${m(r.invoiceFiles[e.line].totalCents)}`}</a>
                            : <span className="text-xs text-slate-400">No copy on file</span>)}
                          {c.arithmetic.wrong.some((w) => w.entry.line === e.line) && <div className="text-xs font-semibold text-red-700">Their balance should be {m(c.arithmetic.wrong.find((w) => w.entry.line === e.line)!.expectedCents)}.</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {(r.invoicesNotOnStatement?.length ?? 0) > 0 && (
            <div className="card border-l-4 border-l-amber-400 p-5" data-testid="invoices-not-on-statement">
              <h3 className="font-semibold">Invoices you have that aren&apos;t on their statement</h3>
              <ul className="mt-2 text-sm">
                {r.invoicesNotOnStatement!.map((i) => <li key={i.id}><a className="hover:text-brand-700" href={`/api/invoices/${i.id}`} target="_blank" rel="noreferrer">No. {i.invoiceNo ?? "?"} · {fmtDay(i.invoiceDate)} · {m(i.totalCents)}</a></li>)}
              </ul>
            </div>
          )}
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="card p-5" data-testid="supplier-extra">
              <h3 className="font-semibold">Payments you made that aren&apos;t on their statement</h3>
              <p className="mb-3 text-xs text-slate-500">Payments out of your accounts naming {st.supplier ?? "them"} in the statement&apos;s period that they didn&apos;t record. Send them these: they may owe you a credit.</p>
              {extra.length ? (
                <ul className="divide-y divide-slate-100 text-sm">
                  {extra.map((t) => (
                    <li key={t.id}><Link href={`/transactions/${t.id}`} className="flex flex-wrap justify-between gap-2 py-1.5 hover:text-brand-700">
                      <span>{fmtDay(t.date)} · {t.description} <span className="text-xs text-slate-400">{t.account}</span></span><span className="num font-semibold text-red-700">{m(-t.amountCents)}</span>
                    </Link></li>
                  ))}
                </ul>
              ) : <p className="text-sm text-emerald-700">None: every payment to them in your bank is on their statement.</p>}
            </div>
            <div className="card p-5" data-testid="supplier-open">
              <h3 className="font-semibold">What&apos;s still owed, by invoice</h3>
              <p className="mb-3 text-xs text-slate-500">Their payments applied to the oldest invoices first. A partly paid invoice means a payment was smaller than the invoice.</p>
              {c.openInvoices.length ? (
                <ul className="divide-y divide-slate-100 text-sm">
                  {c.openInvoices.map((i) => (
                    <li key={i.entry.line} className="flex flex-wrap justify-between gap-2 py-1.5">
                      <span>{fmtDay(i.entry.date)} · {i.entry.description}{i.openCents < i.entry.amountCents && i.entry.kind !== "OPENING" ? <span className="ml-1 text-xs text-amber-700">(partly paid: {m(i.entry.amountCents)} invoiced)</span> : null}</span>
                      <span className="num font-semibold">{m(i.openCents)}</span>
                    </li>
                  ))}
                  <li className="flex justify-between py-1.5 font-semibold"><span>Total</span><span className="num">{m(c.openInvoices.reduce((a, i) => a + i.openCents, 0))}</span></li>
                </ul>
              ) : <p className="text-sm text-emerald-700">Nothing owed: every invoice is paid.</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
