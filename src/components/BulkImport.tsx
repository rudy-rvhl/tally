"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { UploadCloud, Loader2, CheckCircle2, AlertTriangle, XCircle, FileText, Files } from "lucide-react";
import type { DetectedStatement } from "@/lib/services/bulk";
import type { CommitResult } from "@/lib/services/import";
import { formatMoney } from "@/lib/engine/money";

export interface BulkAccount { id: string; label: string; type: string; typeLabel: string }

type Item = {
  key: string;
  file: File;
  state: "reading" | "ready" | "error" | "importing" | "done" | "failed";
  error?: string;
  d?: DetectedStatement;
  result?: CommitResult;
};

const SKIP = "skip";
const newKey = (d: DetectedStatement) => `new:${d.proposal.institution}|${d.proposal.mask ?? d.fileName}|${d.proposal.type}`;
const fmtDate = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "?");

export function BulkImport({ accounts, typeLabels }: { accounts: BulkAccount[]; typeLabels: Record<string, string> }) {
  const [items, setItems] = useState<Item[]>([]);
  const [target, setTarget] = useState<Record<string, string>>({}); // item key → account id | new:… | skip
  const [newType, setNewType] = useState<Record<string, string>>({}); // new:… → account type
  const [drag, setDrag] = useState(false);
  const [running, setRunning] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const update = (key: string, patch: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  async function add(list: FileList | null) {
    if (!list?.length) return;
    const files = [...list];
    const pending: Item[] = files.map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, file, state: "reading" }));
    setItems((xs) => [...xs, ...pending]);
    // Two at a time: scanned PDFs take a few seconds each.
    let next = 0;
    const worker = async () => {
      while (next < pending.length) {
        const it = pending[next++];
        try {
          const fd = new FormData(); fd.set("file", it.file);
          const res = await fetch("/api/import/detect", { method: "POST", body: fd });
          const body = await res.json();
          if (!res.ok) { update(it.key, { state: "error", error: body.error ?? "We couldn't read this file." }); continue; }
          const found = body as DetectedStatement[];
          // One row per account in the file (a statement can cover several accounts).
          const rows: Item[] = found.map((d, j) => ({ key: j ? `${it.key}#${j}` : it.key, file: it.file, state: d.error ? "error" : "ready", error: d.error ?? undefined, d }));
          setItems((xs) => xs.flatMap((x) => (x.key === it.key ? rows : [x])));
          setTarget((t) => {
            const n = { ...t };
            for (const r of rows) {
              if (!r.d || r.d.error) continue;
              // Matched → that account. Nothing similar → a new account. Unsure between accounts → ask.
              n[r.key] = r.d.alreadyUploaded ? SKIP : r.d.route.accountId ?? (r.d.route.candidates.length ? "" : newKey(r.d));
            }
            return n;
          });
        } catch {
          update(it.key, { state: "error", error: "The connection dropped while reading this file. Try again." });
        }
      }
    };
    await Promise.all([worker(), worker()]);
  }

  // Grouped by destination, oldest statement first, so balances carry from one month to the next.
  const label = (v: string | undefined, d?: DetectedStatement) =>
    !v ? "" : v === SKIP ? "~" : v.startsWith("new:") ? `${d?.proposal.institution} ${d?.proposal.name}` : accounts.find((a) => a.id === v)?.label ?? "";
  const ordered = useMemo(() => [...items].sort((a, b) => {
    const la = label(target[a.key], a.d), lb = label(target[b.key], b.d);
    return la.localeCompare(lb) || (a.d?.periodStart ?? "").localeCompare(b.d?.periodStart ?? "") || a.file.name.localeCompare(b.file.name);
  }), [items, target]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = items.filter((x) => x.state === "ready" && target[x.key] && target[x.key] !== SKIP);
  const unassigned = items.filter((x) => x.state === "ready" && !target[x.key]);
  const reading = items.some((x) => x.state === "reading");
  const newGroups = [...new Set(ready.map((x) => target[x.key]).filter((v) => v.startsWith("new:")))];

  async function importAll() {
    setRunning(true);
    const created: Record<string, string> = {};
    for (const it of ordered) {
      const v = target[it.key];
      if (it.state !== "ready" || !v || v === SKIP || !it.d) continue;
      update(it.key, { state: "importing" });
      try {
        let accountId = v;
        if (v.startsWith("new:")) {
          if (!created[v]) {
            const p = it.d.proposal;
            const res = await fetch("/api/import/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...p, type: newType[v] ?? p.type }) });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error ?? "We couldn't create the account.");
            created[v] = body.id;
          }
          accountId = created[v];
        }
        const fd = new FormData();
        fd.set("file", it.file); fd.set("accountId", accountId);
        fd.set("payload", JSON.stringify({ decisions: {}, section: it.d.section, flagWarnings: true }));
        const res = await fetch("/api/import/commit", { method: "POST", body: fd });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "The import didn't complete.");
        update(it.key, { state: "done", result: body as CommitResult });
      } catch (e) {
        update(it.key, { state: "failed", error: (e as Error).message });
      }
    }
    setRunning(false);
  }

  const done = items.filter((x) => x.state === "done");
  const totals = done.reduce((a, x) => ({ imported: a.imported + (x.result?.imported ?? 0), skipped: a.skipped + (x.result?.skippedDuplicates ?? 0), flagged: a.flagged + (x.result?.flagged ?? 0) }), { imported: 0, skipped: 0, flagged: 0 });
  const finished = !running && done.length > 0 && !items.some((x) => x.state === "importing");

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
        onClick={() => input.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") input.current?.click(); }}
        className={clsx("card flex cursor-pointer flex-col items-center justify-center gap-3 border-2 border-dashed p-10 text-center transition", drag ? "border-brand-500 bg-brand-50" : "border-slate-300 hover:border-brand-400")}>
        <span className="rounded-2xl bg-brand-50 p-4 text-brand-600"><Files className="h-8 w-8" /></span>
        <div className="text-lg font-semibold">Drop all your statements here</div>
        <p className="max-w-xl text-sm text-slate-500">PDF, CSV, Excel, OFX or QFX, from any bank, for any account and any month. We read each one, find the bank, the account number, the type of account and the dates, and file it in the right account. Nothing is saved until you click Import.</p>
        <span className="btn-secondary">Choose files</span>
        <input ref={input} type="file" multiple className="sr-only" accept=".csv,.txt,.xlsx,.ofx,.qfx,.pdf" data-testid="bulk-input" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      </div>

      {items.length > 0 && (
        <div className="card overflow-hidden" data-testid="bulk-table">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="font-semibold">{items.length} statement{items.length === 1 ? "" : "s"}</h2>
              <p className="text-sm text-slate-500">Check where each one goes. Change it if we got it wrong.</p>
            </div>
            {!finished && (
              <button className="btn-primary" disabled={running || reading || !ready.length || unassigned.length > 0} onClick={importAll} data-testid="bulk-import">
                {running ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing…</> : `Import ${ready.length} statement${ready.length === 1 ? "" : "s"}`}
              </button>
            )}
          </div>
          {unassigned.length > 0 && !running && <p className="border-b border-amber-100 bg-amber-50 px-5 py-2 text-sm text-amber-900">Choose an account for {unassigned.length} statement{unassigned.length === 1 ? "" : "s"} below (or “Don&apos;t import”).</p>}
          {newGroups.length > 0 && !running && !finished && (
            <div className="border-b border-slate-100 bg-slate-50 px-5 py-3 text-sm">
              <p className="mb-2 font-medium text-slate-700">New accounts we&apos;ll create</p>
              <ul className="space-y-1.5">
                {newGroups.map((g) => {
                  const d = items.find((x) => target[x.key] === g)?.d;
                  if (!d) return null;
                  return (
                    <li key={g} className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{d.proposal.institution}{d.proposal.mask ? ` ··${d.proposal.mask}` : ""}</span>
                      <select className="input w-auto py-1 text-sm" aria-label="Type of account" value={newType[g] ?? d.proposal.type} onChange={(e) => setNewType((t) => ({ ...t, [g]: e.target.value }))}>
                        {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <span className="text-xs text-slate-500">{d.proposal.currency}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="border-b border-slate-100"><tr>
                <th className="th">Statement</th><th className="th">What we found</th><th className="th">Period</th><th className="th text-right">Transactions</th><th className="th">Goes into</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {ordered.map((it) => {
                  const d = it.d;
                  const v = target[it.key] ?? "";
                  return (
                    <tr key={it.key} className={clsx(v === SKIP && "opacity-60")} data-testid="bulk-row">
                      <td className="td max-w-[14rem]">
                        <div className="flex items-start gap-2"><FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                          <div className="min-w-0"><div className="truncate font-medium" title={it.file.name}>{it.file.name}</div>
                            {d?.sectionName && <div className="text-xs text-slate-500">{d.sectionName}</div>}</div></div>
                      </td>
                      <td className="td">
                        {it.state === "reading" ? <span className="inline-flex items-center gap-1.5 text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading…</span>
                          : !d || it.state === "error" ? <span className="text-red-700">{it.error}</span>
                          : <>
                            <div className="font-medium">{d.institution ?? "Unknown bank"}{d.last4 ? ` ··${d.last4}` : ""}</div>
                            <div className="text-xs text-slate-500">{[d.typeLabel ?? "type not printed", d.typeLabel && /business|personal/.test(d.typeLabel) ? null : d.ownership?.toLowerCase(), d.currency].filter(Boolean).join(" · ")}</div>
                          </>}
                      </td>
                      <td className="td whitespace-nowrap text-slate-600">{d && !d.error ? `${fmtDate(d.periodStart)} – ${fmtDate(d.periodEnd)}` : ""}</td>
                      <td className="td text-right">
                        {d && !d.error && <>
                          <div className="num font-medium">{d.transactions}</div>
                          {d.balances === "match" ? <div className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-emerald-700"><CheckCircle2 className="h-3 w-3" /> balances match</div>
                            : d.balances === "differ" ? <div className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-amber-700" title="Opening balance plus the transactions doesn't equal the closing balance. It will be flagged in Review."><AlertTriangle className="h-3 w-3" /> off by {formatMoney(Math.abs(d.differenceCents ?? 0), d.currency ?? "CAD")}</div>
                            : <div className="text-xs text-slate-400">no balances</div>}
                        </>}
                      </td>
                      <td className="td min-w-[17rem]">
                        {d && !d.error && it.state === "ready" && (
                          <>
                            <select className={clsx("input py-1.5 text-sm", !v && "border-amber-400")} value={v} disabled={running} aria-label={`Account for ${it.file.name}`}
                              onChange={(e) => setTarget((t) => ({ ...t, [it.key]: e.target.value }))}>
                              {!v && <option value="">Choose an account…</option>}
                              {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                              <option value={newKey(d)}>New account: {d.proposal.name}</option>
                              <option value={SKIP}>Don&apos;t import</option>
                            </select>
                            <div className="mt-1 text-xs">
                              {d.alreadyUploaded ? <span className="text-amber-700">You already imported this exact file into {d.alreadyUploaded.account}.</span>
                                : v && v === d.route.accountId ? <span className={d.route.confidence === "exact" ? "text-emerald-700" : "text-slate-500"}>{d.route.reason}</span>
                                : v.startsWith("new:") ? <span className="text-slate-500">No account with this number yet. We&apos;ll create it.</span>
                                : !v ? <span className="text-amber-700">{d.route.reason}</span> : null}
                              {d.overlap && v === d.route.accountId && <div className="text-slate-500">{d.overlap}</div>}
                            </div>
                          </>
                        )}
                        {it.state === "importing" && <span className="inline-flex items-center gap-1.5 text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Importing…</span>}
                        {it.state === "done" && it.result && <span className="inline-flex items-center gap-1.5 text-emerald-700" data-testid="bulk-done"><CheckCircle2 className="h-4 w-4" /> {it.result.imported} added{it.result.skippedDuplicates ? `, ${it.result.skippedDuplicates} already there` : ""}{it.result.flagged ? `, ${it.result.flagged} to review` : ""}</span>}
                        {it.state === "failed" && <span className="inline-flex items-start gap-1.5 text-red-700"><XCircle className="mt-0.5 h-4 w-4 shrink-0" /> {it.error}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {finished && (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-5" role="status">
          <div>
            <div className="text-lg font-semibold">Imported {totals.imported} transaction{totals.imported === 1 ? "" : "s"} from {done.length} statement{done.length === 1 ? "" : "s"}</div>
            <p className="text-sm text-slate-500">{totals.skipped ? `${totals.skipped} were already in LedgerIQ and were skipped. ` : ""}{totals.flagged ? `${totals.flagged} need a quick look in Review.` : "Nothing needs review."}</p>
          </div>
          <div className="flex gap-2">
            {totals.flagged > 0 && <Link href="/review" className="btn-secondary">Go to Review</Link>}
            <Link href="/accounts" className="btn-primary">See accounts</Link>
          </div>
        </div>
      )}
    </div>
  );
}
