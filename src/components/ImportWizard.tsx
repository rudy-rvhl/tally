"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { UploadCloud, FileText, CheckCircle2, AlertTriangle, ArrowLeftRight, Loader2, RotateCcw, Settings2 } from "lucide-react";
import type { ImportPreview, PreviewRow, RowDecision, CommitResult } from "@/lib/services/import";
import type { ColumnMapping, TxnKindName } from "@/lib/engine/types";
import { formatMoney, parseAmountToCents } from "@/lib/engine/money";
import { KIND_LABELS } from "@/lib/engine/classify";
import { CategoryOptions, type CatOpt } from "./CategorySelect";

interface Acc { id: string; label: string; type: string; currency: string; liability: boolean }

const KIND_KEYS = Object.keys(KIND_LABELS) as TxnKindName[];
const fmtMonth = (k: string) => new Date(`${k}-01T00:00:00Z`).toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "UTC" });

export function ImportWizard({ accounts, categories, initialAccount, accountant }: { accounts: Acc[]; categories: CatOpt[]; initialAccount?: string; accountant: boolean }) {
  const [accountId, setAccountId] = useState(initialAccount && accounts.some((a) => a.id === initialAccount) ? initialAccount : accounts.length === 1 ? accounts[0].id : "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [decisions, setDecisions] = useState<Record<number, RowDecision>>({});
  const [reimport, setReimport] = useState<Set<number>>(new Set());
  const [mapping, setMapping] = useState<ColumnMapping | undefined>();
  const [period, setPeriod] = useState<{ start: string; end: string; opening: string; closing: string }>({ start: "", end: "", opening: "", closing: "" });
  const [busy, setBusy] = useState<"" | "preview" | "commit">("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<CommitResult | null>(null);
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [drag, setDrag] = useState(false);
  const [section, setSection] = useState<number | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  const account = accounts.find((a) => a.id === accountId);
  const cur = account?.currency ?? "CAD";

  async function runPreview(f: File, m?: ColumnMapping, sec?: number) {
    if (!accountId) { setError("First choose which account this statement belongs to."); return; }
    setBusy("preview"); setError(""); setResult(null);
    const fd = new FormData();
    fd.set("file", f); fd.set("accountId", accountId);
    if (m) fd.set("mapping", JSON.stringify(m));
    if (sec !== undefined) fd.set("section", String(sec));
    try {
      const res = await fetch("/api/import/preview", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const p = data as ImportPreview;
      setPreview(p); setMapping(p.mapping); setDecisions({}); setReimport(new Set());
      setSection(p.sections?.length ? (sec ?? p.sections.reduce((a, b) => (b.transactions > a.transactions ? b : a)).index) : undefined);
      setPeriod({ start: p.periodStart ?? "", end: p.periodEnd ?? "", opening: p.openingBalanceCents !== null ? (p.openingBalanceCents / 100).toFixed(2) : "", closing: p.closingBalanceCents !== null ? (p.closingBalanceCents / 100).toFixed(2) : "" });
      setOnlyAttention(p.counts.needsAttention > 0 && p.rows.length > 30);
    } catch (e) {
      setError((e as Error).message || "We couldn't read that file.");
      setPreview(null);
    } finally { setBusy(""); }
  }

  function pick(f: File | undefined | null) {
    if (!f) return;
    setFile(f);
    setSection(undefined);
    void runPreview(f);
  }

  async function commit() {
    if (!file || !preview) return;
    setBusy("commit"); setError("");
    const fd = new FormData();
    fd.set("file", file); fd.set("accountId", accountId);
    fd.set("payload", JSON.stringify({
      decisions, includeAlreadyImported: [...reimport], mapping, section: section ?? null,
      periodStart: period.start || null, periodEnd: period.end || null,
      openingBalanceCents: period.opening ? parseAmountToCents(period.opening) : null,
      closingBalanceCents: period.closing ? parseAmountToCents(period.closing) : null,
    }));
    try {
      const res = await fetch("/api/import/commit", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data as CommitResult); setPreview(null);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(""); }
  }

  const reset = () => { setFile(null); setPreview(null); setResult(null); setError(""); setDecisions({}); if (input.current) input.current.value = ""; };
  const setD = (i: number, patch: RowDecision) => setDecisions((d) => ({ ...d, [i]: { ...d[i], ...patch } }));

  const willImport = useMemo(() => preview?.rows.filter((r) => !decisions[r.index]?.skip && r.date && (r.duplicate.status !== "ALREADY_IMPORTED" || reimport.has(r.index))).length ?? 0, [preview, decisions, reimport]);
  const totals = useMemo(() => {
    if (!preview) return { out: 0, in: 0 };
    let out = 0, inn = 0;
    for (const r of preview.rows) {
      if (decisions[r.index]?.skip || (r.duplicate.status === "ALREADY_IMPORTED" && !reimport.has(r.index))) continue;
      const a = decisions[r.index]?.flip ? -r.amountCents : r.amountCents;
      if (a < 0) out -= a; else inn += a;
    }
    return { out, in: inn };
  }, [preview, decisions, reimport]);

  // ---------- result screen
  if (result) {
    return (
      <div className="card p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <span className="rounded-2xl bg-emerald-50 p-3 text-emerald-600"><CheckCircle2 className="h-7 w-7" /></span>
          <div className="flex-1">
            <h2 className="text-xl font-bold">Imported {result.imported} transaction{result.imported === 1 ? "" : "s"}</h2>
            <p className="mt-1 text-slate-600">Your overview, supplier totals, account reports and monthly comparisons are already updated.</p>
            <ul className="mt-4 space-y-1.5 text-sm text-slate-700">
              {result.months.length > 0 && <li>Covers {result.months.map(fmtMonth).join(", ")}.</li>}
              {result.skippedDuplicates > 0 && <li>{result.skippedDuplicates} were already in LedgerIQ, so we skipped them. Nothing was counted twice.</li>}
              {result.skippedByUser > 0 && <li>{result.skippedByUser} left out, as you chose.</li>}
              {result.transfersLinked > 0 && <li className="flex items-center gap-1.5"><ArrowLeftRight className="h-4 w-4 text-slate-400" /> {result.transfersLinked} payment{result.transfersLinked === 1 ? "" : "s"} between your accounts linked automatically.</li>}
              {result.flagged > 0 && <li className="text-amber-800">{result.flagged} transaction{result.flagged === 1 ? " needs" : "s need"} a quick look.</li>}
              {result.statementId && <li>We&apos;re checking the statement balances. See the account page for the result.</li>}
            </ul>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link className="btn-primary" href={result.months.length ? `/?month=${result.months[result.months.length - 1]}` : "/"}>See the overview</Link>
              {result.flagged > 0 && <Link className="btn-secondary" href="/review">Review {result.flagged} item{result.flagged === 1 ? "" : "s"}</Link>}
              <Link className="btn-secondary" href={`/accounts/${accountId}`}>View account</Link>
              <button className="btn-ghost" onClick={reset}>Import another statement</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Step 1 */}
      <div className="card p-5">
        <div className="grid gap-5 md:grid-cols-[minmax(0,18rem)_1fr]">
          <div>
            <label htmlFor="acc" className="label"><span className="mr-1.5 inline-grid h-5 w-5 place-items-center rounded-full bg-brand-600 text-[11px] text-white">1</span> Which account is this statement for?</label>
            <select id="acc" className="input" value={accountId} onChange={(e) => { setAccountId(e.target.value); setPreview(null); if (file && e.target.value) setTimeout(() => runPreview(file), 0); }}>
              <option value="">Choose an account</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
            {account && <p className="mt-1.5 text-xs text-slate-500">{account.type} · {account.currency}</p>}
            <Link href="/accounts/new?next=import" className="link mt-2 inline-block text-sm">+ Add a new account</Link>
          </div>
          <div>
            <span className="label"><span className="mr-1.5 inline-grid h-5 w-5 place-items-center rounded-full bg-brand-600 text-[11px] text-white">2</span> Drop the statement file</span>
            <div
              role="button" tabIndex={0} aria-label="Upload a statement file"
              onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); if ((e.dataTransfer.files?.length ?? 0) > 1) { setError("You dropped several files. Use “Import several at once” at the top of this page to import them together."); return; } pick(e.dataTransfer.files?.[0]); }}
              className={clsx("flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition", drag ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-slate-50/50 hover:border-brand-400 hover:bg-brand-50/40", !accountId && "opacity-60")}>
              {busy === "preview" ? <Loader2 className="h-8 w-8 animate-spin text-brand-600" /> : file ? <FileText className="h-8 w-8 text-brand-600" /> : <UploadCloud className="h-8 w-8 text-brand-600" />}
              <p className="mt-2 font-semibold text-slate-800">{busy === "preview" ? "Reading your statement…" : file ? file.name : "Drag your statement here, or click to choose"}</p>
              <p className="mt-1 text-xs text-slate-500">CSV, Excel (.xlsx), OFX, QFX or PDF · up to 10 MB · Scotiabank, RBC, TD, BMO, CIBC, National Bank, Desjardins, Amex and more</p>
              <input ref={input} type="file" className="sr-only" accept=".csv,.txt,.xlsx,.ofx,.qfx,.pdf" onChange={(e) => pick(e.target.files?.[0])} />
            </div>
          </div>
        </div>
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>

      {preview && (
        <>
          {/* Summary */}
          <div className="card p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-lg font-bold"><span className="mr-1.5 inline-grid h-5 w-5 place-items-center rounded-full bg-brand-600 align-middle text-[11px] text-white">3</span> Check what we found</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {preview.institution ? <>We recognised this as a <strong>{preview.institution}</strong> statement. </> : null}
                  We found <strong>{preview.counts.total}</strong> transactions{preview.periodStart && preview.periodEnd ? <> from {preview.periodStart} to {preview.periodEnd}</> : null}.
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="chip bg-emerald-50 text-emerald-800">{preview.counts.new} new</span>
                  {preview.counts.alreadyImported > 0 && <span className="chip bg-slate-100 text-slate-700">{preview.counts.alreadyImported} already imported (will be skipped)</span>}
                  {preview.counts.possibleDuplicates > 0 && <span className="chip bg-amber-50 text-amber-800">{preview.counts.possibleDuplicates} possible duplicates</span>}
                  {preview.counts.needsAttention > 0 && <span className="chip bg-amber-50 text-amber-800">{preview.counts.needsAttention} we&apos;re unsure about</span>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm sm:min-w-[18rem]">
                <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">Money out</div><div className="num font-bold">{formatMoney(totals.out, cur)}</div></div>
                <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">Money in</div><div className="num font-bold text-emerald-700">{formatMoney(totals.in, cur)}</div></div>
              </div>
            </div>
            {preview.sections && preview.sections.length > 1 && (
              <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50/60 p-4">
                <label htmlFor="section" className="label">This statement covers several accounts. Which one are you importing into {account?.label}?</label>
                <select id="section" className="input max-w-md" value={section ?? ""} onChange={(e) => { const v = Number(e.target.value); setSection(v); if (file) void runPreview(file, mapping, v); }}>
                  {preview.sections.map((x) => <option key={x.index} value={x.index}>{x.name} ({x.transactions} transactions)</option>)}
                </select>
                <p className="mt-1.5 text-xs text-slate-500">Import the statement again into another account to bring in the others.</p>
              </div>
            )}
            {preview.loanSplits.length > 0 && (
              <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                {preview.loanSplits.map((l) => (
                  <p key={l.date + l.loan}>
                    Loan payment on {new Date(`${l.date}T00:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" })}: <strong>{formatMoney(l.interestCents, cur)} interest</strong> and {formatMoney(l.principalCents, cur)} principal ({l.loan}).
                  </p>
                ))}
                <p className="mt-1 text-xs">We&apos;ll split it automatically so the interest counts as a business expense and the principal as paying down the loan. You can change this later.</p>
              </div>
            )}
            {preview.alreadyUploaded && <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">You uploaded this exact file on {new Date(preview.alreadyUploaded.at).toLocaleDateString("en-CA")}. Transactions already imported will be skipped, so nothing is counted twice.</div>}
            {[...preview.accountWarnings, ...preview.notes].map((n) => (
              <div key={n} className={clsx("mt-3 flex items-start gap-2 rounded-xl px-4 py-3 text-sm", preview.accountWarnings.includes(n) ? "border border-amber-200 bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-700")}>
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{n}
              </div>
            ))}

            <details className="mt-4" open={!!(preview.openingBalanceCents !== null || preview.closingBalanceCents !== null)}>
              <summary className="cursor-pointer text-sm font-medium text-brand-700">Statement period and balances (optional, lets us check the statement adds up)</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <div><label className="label text-xs" htmlFor="p1">Period start</label><input id="p1" type="date" className="input" value={period.start} onChange={(e) => setPeriod({ ...period, start: e.target.value })} /></div>
                <div><label className="label text-xs" htmlFor="p2">Period end</label><input id="p2" type="date" className="input" value={period.end} onChange={(e) => setPeriod({ ...period, end: e.target.value })} /></div>
                <div><label className="label text-xs" htmlFor="p3">{account?.liability ? "Previous balance owed" : "Opening balance"}</label><input id="p3" inputMode="decimal" className="input" value={period.opening} onChange={(e) => setPeriod({ ...period, opening: e.target.value })} placeholder="from the statement" /></div>
                <div><label className="label text-xs" htmlFor="p4">{account?.liability ? "New balance owed" : "Closing balance"}</label><input id="p4" inputMode="decimal" className="input" value={period.closing} onChange={(e) => setPeriod({ ...period, closing: e.target.value })} placeholder="from the statement" /></div>
              </div>
              <p className="mt-2 text-xs text-slate-500">The period tells us which months this statement covers, even on days with no transactions.</p>
            </details>

            {preview.headers && mapping && (
              <details className="mt-3" open={preview.rows.length === 0}>
                <summary className="flex cursor-pointer items-center gap-1 text-sm font-medium text-brand-700"><Settings2 className="h-4 w-4" /> Columns look wrong? Change how we read this file</summary>
                <MappingEditor headers={preview.headers} mapping={mapping} onChange={setMapping} onApply={(m) => file && runPreview(file, m)} />
              </details>
            )}
          </div>

          {/* Rows */}
          {preview.rows.length > 0 && (
            <div className="card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
                <p className="text-sm text-slate-600">Fix anything that looks wrong. Untick a row to leave it out.</p>
                {preview.counts.needsAttention > 0 && (
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyAttention} onChange={(e) => setOnlyAttention(e.target.checked)} /> Only show rows we&apos;re unsure about ({preview.counts.needsAttention})</label>
                )}
              </div>
              <div className="max-h-[60vh] overflow-auto">
                <table className="w-full min-w-[56rem] text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50"><tr>
                    <th className="th w-10"><span className="sr-only">Include</span></th><th className="th">Date</th><th className="th">Description</th><th className="th">Type</th><th className="th">Category</th><th className="th text-right">Amount</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.rows.filter((r) => !onlyAttention || r.needsAttention).map((r) => (
                      <Row key={r.index} r={r} d={decisions[r.index] ?? {}} setD={(p) => setD(r.index, p)} categories={categories} accountant={accountant} currency={cur}
                        reimport={reimport.has(r.index)} toggleReimport={() => setReimport((s) => { const n = new Set(s); if (n.has(r.index)) n.delete(r.index); else n.add(r.index); return n; })} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="sticky bottom-20 z-10 lg:bottom-4">
            <div className="card flex flex-col items-stretch gap-3 p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-600"><strong className="text-slate-900">{willImport}</strong> transaction{willImport === 1 ? "" : "s"} will be added to <strong className="text-slate-900">{account?.label}</strong>.</p>
              <div className="flex gap-2">
                <button className="btn-ghost" onClick={reset}><RotateCcw className="h-4 w-4" /> Start over</button>
                <button className="btn-primary" onClick={commit} disabled={busy !== "" || willImport === 0}>
                  {busy === "commit" ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing…</> : "Import Transactions"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ r, d, setD, categories, accountant, currency, reimport, toggleReimport }: {
  r: PreviewRow; d: RowDecision; setD: (p: RowDecision) => void; categories: CatOpt[]; accountant: boolean; currency: string; reimport: boolean; toggleReimport: () => void;
}) {
  const already = r.duplicate.status === "ALREADY_IMPORTED";
  const included = already ? reimport : !d.skip && !!r.date;
  const amount = d.flip ? -r.amountCents : r.amountCents;
  const kind = d.kind ?? r.kind;
  const spendish = ["PURCHASE", "FEE", "INTEREST", "REFUND", "REVERSAL"].includes(kind);
  return (
    <tr className={clsx(!included && "bg-slate-50/70 text-slate-400", r.needsAttention && included && "bg-amber-50/40")}>
      <td className="td align-top"><input type="checkbox" aria-label="Include this transaction" checked={included} disabled={!r.date} onChange={() => (already ? toggleReimport() : setD({ skip: !d.skip }))} /></td>
      <td className="td whitespace-nowrap align-top">{r.date ? new Date(`${r.date}T00:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : <span className="text-red-600">Unreadable</span>}</td>
      <td className="td align-top">
        <input className="w-full min-w-[14rem] rounded-md border border-transparent bg-transparent px-1 py-0.5 hover:border-slate-200 focus:border-brand-400 focus:bg-white focus:outline-none" value={d.description ?? r.description} onChange={(e) => setD({ description: e.target.value })} aria-label="Description" />
        <div className="mt-1 flex flex-wrap gap-1 px-1">
          {r.merchantName && <span className="text-xs text-slate-500">{kind === "INCOME" ? "From" : "Supplier"}: <strong className="font-medium text-slate-700">{r.merchantName}</strong>{r.merchantConfidence < 0.7 ? " (new)" : ""}</span>}
          {already && <span className="chip bg-slate-100 text-slate-600">Already imported</span>}
          {r.duplicate.status === "POSSIBLE_DUPLICATE" && <span className="chip bg-amber-100 text-amber-800" title={r.duplicate.reason}>Might be a duplicate</span>}
        </div>
        {r.warnings.map((w) => <div key={w} className="mt-1 px-1 text-xs text-amber-800">{w}</div>)}
        {r.duplicate.status === "POSSIBLE_DUPLICATE" && <div className="mt-1 px-1 text-xs text-amber-800">{r.duplicate.reason} We&apos;ll import it and ask you to confirm in Review.</div>}
      </td>
      <td className="td align-top">
        <select className="input min-w-[11rem] py-1.5 text-xs" value={kind} onChange={(e) => setD({ kind: e.target.value as TxnKindName })} aria-label="Type">
          {KIND_KEYS.map((k) => <option key={k} value={k}>{accountant ? KIND_LABELS[k].accountant : KIND_LABELS[k].simple}</option>)}
        </select>
      </td>
      <td className="td align-top">
        {spendish ? (
          <select className={clsx("input py-1.5 text-xs", r.categoryConfidence < 0.7 && !d.categoryId && "border-amber-300")} value={d.categoryId ?? r.categoryId ?? ""} onChange={(e) => setD({ categoryId: e.target.value })} aria-label="Category">
            <option value="" disabled>Choose…</option>
            <CategoryOptions categories={categories} />
          </select>
        ) : <span className="text-xs text-slate-500">{kind === "INCOME" ? "Money received" : "Not spending"}</span>}
      </td>
      <td className="td whitespace-nowrap text-right align-top">
        <div className={clsx("num font-semibold", amount > 0 && "text-emerald-700")}>{formatMoney(amount, currency)}</div>
        <button type="button" className="mt-1 text-xs text-brand-600 hover:underline" onClick={() => setD({ flip: !d.flip })} title="Switch between money in and money out">
          {amount < 0 ? "Money out · switch" : "Money in · switch"}
        </button>
      </td>
    </tr>
  );
}

function MappingEditor({ headers, mapping, onChange, onApply }: { headers: string[]; mapping: ColumnMapping; onChange: (m: ColumnMapping) => void; onApply: (m: ColumnMapping) => void }) {
  const col = (key: keyof ColumnMapping, label: string, optional = false) => (
    <div>
      <label className="label text-xs">{label}</label>
      <select className="input py-1.5 text-sm" value={mapping[key] === undefined ? "" : String(mapping[key])} onChange={(e) => onChange({ ...mapping, [key]: e.target.value === "" ? undefined : Number(e.target.value) })}>
        {optional && <option value="">(none)</option>}
        {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
      </select>
    </div>
  );
  const single = mapping.amount !== undefined;
  return (
    <div className="mt-3 rounded-xl bg-slate-50 p-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {col("date", "Date column")}
        {col("description", "Description column")}
        <div>
          <label className="label text-xs">Amounts are in</label>
          <select className="input py-1.5 text-sm" value={single ? "one" : "two"} onChange={(e) => onChange(e.target.value === "one" ? { ...mapping, amount: mapping.debit ?? 2, debit: undefined, credit: undefined } : { ...mapping, amount: undefined, debit: mapping.amount ?? 2, credit: (mapping.amount ?? 2) + 1 })}>
            <option value="one">One column</option><option value="two">Separate in/out columns</option>
          </select>
        </div>
        {single ? col("amount", "Amount column") : <>{col("debit", "Money out column")}{col("credit", "Money in column")}</>}
        {single && (
          <div>
            <label className="label text-xs">Positive numbers mean</label>
            <select className="input py-1.5 text-sm" value={mapping.amountSign} onChange={(e) => onChange({ ...mapping, amountSign: e.target.value as "AS_IS" | "INVERT" })}>
              <option value="AS_IS">Money in</option><option value="INVERT">Money out (purchases)</option>
            </select>
          </div>
        )}
        <div>
          <label className="label text-xs">Dates are written</label>
          <select className="input py-1.5 text-sm" value={mapping.dateOrder} onChange={(e) => onChange({ ...mapping, dateOrder: e.target.value as "YMD" | "MDY" | "DMY" })}>
            <option value="MDY">Month/Day/Year</option><option value="DMY">Day/Month/Year</option><option value="YMD">Year-Month-Day</option>
          </select>
        </div>
      </div>
      <button type="button" className="btn-secondary btn-sm mt-3" onClick={() => onApply(mapping)}>Read the file again</button>
    </div>
  );
}
