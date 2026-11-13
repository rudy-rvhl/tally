"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { UploadCloud, Loader2, CheckCircle2, XCircle, Copy } from "lucide-react";
import type { UploadResult } from "@/lib/services/invoices";
import { formatMoney } from "@/lib/engine/money";

export function InvoiceUpload({ currency }: { currency: string }) {
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<UploadResult[] | null>(null);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function send(list: FileList | File[] | null | undefined) {
    const files = [...(list ?? [])];
    if (!files.length) return;
    setBusy(true); setError(""); setResults(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("file", f);
      const res = await fetch("/api/invoices", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setResults(body.results);
      router.refresh();
    } catch (e) { setError((e as Error).message || "The invoices couldn't be uploaded."); }
    setBusy(false);
  }

  const added = results?.filter((r) => r.ok && !r.duplicate).length ?? 0;
  return (
    <div>
      <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); send(e.dataTransfer.files); }}
        onClick={() => input.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") input.current?.click(); }}
        className={clsx("flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center", drag ? "border-brand-500 bg-brand-50" : "border-slate-300 hover:border-brand-400")}>
        {busy ? <Loader2 className="h-7 w-7 animate-spin text-brand-600" /> : <UploadCloud className="h-7 w-7 text-brand-600" />}
        <div className="font-semibold">{busy ? "Reading invoices…" : "Drop supplier invoices here (PDF, several at once)"}</div>
        <p className="max-w-xl text-sm text-slate-500">Supplier, number, date, what it&apos;s for, building, GST, QST and total are read from each one. They&apos;re kept encrypted on this computer, and matched to your bank payments to show what&apos;s paid.</p>
        <input ref={input} type="file" multiple className="sr-only" accept=".pdf,application/pdf" data-testid="invoice-input" onChange={(e) => { send(e.target.files); e.target.value = ""; }} />
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {results && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm" data-testid="invoice-upload-results">
          <p className="mb-1 font-medium">{added} invoice{added === 1 ? "" : "s"} added{results.length > added ? ` · ${results.length - added} not added` : ""}.</p>
          <ul className="space-y-0.5">
            {results.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                {r.ok && !r.duplicate ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : r.duplicate ? <Copy className="h-4 w-4 text-slate-400" /> : <XCircle className="h-4 w-4 text-red-600" />}
                <span className="text-slate-700">{r.fileName}</span>
                <span className="text-slate-500">
                  {r.duplicate ? `already uploaded${r.invoiceNo ? ` (no. ${r.invoiceNo})` : ""}`
                    : r.ok ? `${r.supplier} · no. ${r.invoiceNo ?? "?"} · ${r.invoiceDate} · ${r.totalCents !== null && r.totalCents !== undefined ? formatMoney(r.totalCents, currency) : ""}${r.building ? ` · ${r.building}` : ""}`
                    : r.error}
                </span>
                {r.notes?.map((n) => <span key={n} className="text-amber-700">{n}</span>)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
