"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import clsx from "clsx";
import { Loader2, CheckCircle2, ArrowRight, Building2, Landmark, ListTree } from "lucide-react";
import { organizeAction } from "@/app/actions";
import type { OrganizeResult } from "@/lib/services/organize";

const ACTION: Record<string, string> = { keep: "already there", rename: "renamed", create: "created", move: "moved here" };

export function OrganizeForm({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  const [preview, setPreview] = useState<OrganizeResult | null>(null);
  const [done, setDone] = useState<OrganizeResult | null>(null);
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"" | "preview" | "apply">("");
  const run = (apply: boolean) => { setMode(apply ? "apply" : "preview"); start(async () => { const r = await organizeAction(text, apply); if (apply) { setDone(r); setPreview(null); } else { setPreview(r); setDone(null); } }); };
  const r = done ?? preview;
  const changedAccounts = r?.accounts.filter((a) => a.changed) ?? [];

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <label htmlFor="plan" className="label">Your companies, their accounts and their buildings: one line per company</label>
        <textarea id="plan" className="input min-h-[9rem] font-mono text-sm" value={text} onChange={(e) => { setText(e.target.value); setPreview(null); setDone(null); }} spellCheck={false} data-testid="organize-plan" />
        <div className="mt-2 grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
          <p><strong>Company name:</strong> words that identify its accounts <strong>|</strong> its buildings</p>
          <p>Account words are found in the account&apos;s name, bank or number, or in the company name printed on its statements (e.g. “1001”). Use “20304050 Desjardins” to mean both words.</p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-secondary" disabled={pending} onClick={() => run(false)} data-testid="organize-preview">{pending && mode === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListTree className="h-4 w-4" />} Preview changes</button>
          {preview && !preview.errors.length && <button className="btn-primary" disabled={pending} onClick={() => run(true)} data-testid="organize-apply">{pending && mode === "apply" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Apply</button>}
        </div>
      </div>

      {r && r.errors.length > 0 && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{r.errors.map((e) => <p key={e}>{e}</p>)}</div>}
      {done && !done.errors.length && (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-5" role="status">
          <div className="flex items-start gap-3"><CheckCircle2 className="h-6 w-6 text-emerald-600" /><div><div className="font-semibold">Everything is organized</div>
            <p className="text-sm text-slate-600">{changedAccounts.length} account{changedAccounts.length === 1 ? "" : "s"} moved, {done.transactions.reduce((a, t) => a + t.count, 0)} transactions given a building. Every change is in the audit log.</p></div></div>
          <div className="flex gap-2"><Link className="btn-secondary" href="/accounts">See accounts</Link><Link className="btn-primary" href="/">Overview</Link></div>
        </div>
      )}

      {r && !r.errors.length && (
        <div className="grid gap-6 lg:grid-cols-2" data-testid="organize-result">
          <div className="card p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold"><Building2 className="h-4 w-4 text-slate-400" /> Companies and buildings</h2>
            {r.companies.map((c) => (
              <div key={c.name} className="mb-4">
                <div className="font-medium">{c.name} <span className="text-xs font-normal text-slate-500">{ACTION[c.action]}{c.from ? ` (was “${c.from}”)` : ""}</span></div>
                <ul className="mt-1 space-y-0.5 pl-4 text-sm text-slate-600">
                  {r.buildings.filter((b) => b.company === c.name).map((b) => <li key={b.name}>{b.name}{b.existing ? ` (“${b.existing}”)` : ""} <span className={clsx("text-xs", b.action === "keep" ? "text-slate-400" : "text-brand-700")}>{ACTION[b.action]}{b.from ? ` from ${b.from}` : ""}</span></li>)}
                </ul>
              </div>
            ))}
            {r.transactions.length > 0 && (<>
              <h3 className="mb-1 mt-4 text-sm font-semibold text-slate-700">Transactions given a building</h3>
              <ul className="space-y-0.5 text-sm text-slate-600">{r.transactions.map((t) => <li key={t.building}>{t.building}: {t.count}{t.byTenant ? ` (${t.byTenant} rent payments)` : ""}</li>)}</ul>
              <p className="mt-1 text-xs text-slate-500">Rent goes to its tenant&apos;s building; other money when its description names the building. Anything else stays with the whole company; you can set it on the transaction.</p>
            </>)}
            {r.untouched.length > 0 && <p className="mt-3 text-xs text-amber-700">Not in your plan, kept as is: {r.untouched.join(", ")}.</p>}
            {r.empty.length > 0 && <p className="mt-3 text-xs text-slate-500">{r.empty.join(", ")} will have nothing left in {r.empty.length === 1 ? "it" : "them"}. You can remove {r.empty.length === 1 ? "it" : "them"} in <Link className="link" href="/settings#company">Settings</Link>.</p>}
          </div>
          <div className="card p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold"><Landmark className="h-4 w-4 text-slate-400" /> Accounts</h2>
            <ul className="divide-y divide-slate-100 text-sm">
              {r.accounts.map((a) => (
                <li key={a.label} className="py-2">
                  <div className="flex flex-wrap items-center gap-1.5"><span className="font-medium">{a.label}</span>
                    {a.changed ? <span className="inline-flex items-center gap-1 text-brand-700">{a.from ?? "no company"} <ArrowRight className="h-3 w-3" /> {a.to}{a.building ? ` · ${a.building}` : ""}</span>
                      : <span className="text-slate-500">{a.to ?? "no company"}{a.building ? ` · ${a.building}` : ""}</span>}</div>
                  <div className="text-xs text-slate-500">{a.reason}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
