"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import clsx from "clsx";
import { UploadCloud, Loader2, CheckCircle2, AlertTriangle, Home } from "lucide-react";
import type { previewRentRoll } from "@/lib/services/rentrollImport";
import { formatMoney } from "@/lib/engine/money";

type Preview = Awaited<ReturnType<typeof previewRentRoll>> & { fileName: string };
type Map = Record<string, { buildingId: string | null; createIn: string | null; accountId: string | null }>;
const fmtDay = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");

export function RentRollImport({ accounts, currency }: { accounts: { id: string; label: string }[]; currency: string }) {
  const [p, setP] = useState<Preview | null>(null);
  const [map, setMap] = useState<Map>({});
  const [busy, setBusy] = useState<"" | "read" | "save">("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<Record<string, number> | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const m = (v: number | null) => (v === null ? "—" : formatMoney(v, currency));

  async function read(file?: File) {
    if (!file) return;
    setBusy("read"); setError(""); setP(null); setDone(null);
    try {
      const fd = new FormData(); fd.set("file", file);
      const res = await fetch("/api/rentroll/preview", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setP(body);
      setMap(Object.fromEntries((body as Preview).properties.map((x) => [x.name, { buildingId: x.buildingId, createIn: (body as Preview).companies[0]?.id ?? null, accountId: null }])));
    } catch (e) { setError((e as Error).message || "We couldn't read this file."); }
    setBusy("");
  }

  async function save() {
    if (!p) return;
    setBusy("save"); setError("");
    try {
      const res = await fetch("/api/rentroll/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: p.fileName, report: p.report, mapping: map }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setDone(body);
    } catch (e) { setError((e as Error).message); }
    setBusy("");
  }

  if (done) return (
    <div className="card p-6" role="status">
      <div className="flex items-start gap-3"><CheckCircle2 className="h-6 w-6 text-emerald-600" />
        <div>
          <div className="text-lg font-semibold">Rent roll imported</div>
          <p className="mt-1 text-sm text-slate-600">{done.created} tenants added, {done.updated} updated, {done.vacant} empty unit{done.vacant === 1 ? "" : "s"}{done.movedOut ? `, ${done.movedOut} moved to former tenants` : ""}{done.buildingsCreated ? `, ${done.buildingsCreated} building${done.buildingsCreated === 1 ? "" : "s"} created` : ""}. We&apos;re now matching their rent to the deposits in your statements.</p>
          <Link className="btn-primary mt-4" href="/reports/rent-roll">Open the rent roll</Link>
        </div></div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); read(e.dataTransfer.files?.[0]); }}
        onClick={() => input.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") input.current?.click(); }}
        className={clsx("card flex cursor-pointer flex-col items-center gap-3 border-2 border-dashed p-8 text-center", drag ? "border-brand-500 bg-brand-50" : "border-slate-300 hover:border-brand-400")}>
        {busy === "read" ? <Loader2 className="h-8 w-8 animate-spin text-brand-600" /> : <UploadCloud className="h-8 w-8 text-brand-600" />}
        <div className="font-semibold">{busy === "read" ? "Reading your rent roll…" : "Drop your rent roll here"}</div>
        <p className="max-w-lg text-sm text-slate-500">The “Rent Roll” report from Stessa or your property management software, as PDF, CSV or Excel: property, unit, tenant, rent, balance due and lease dates. Nothing is saved until you click Import.</p>
        <input ref={input} type="file" className="sr-only" accept=".pdf,.csv,.xlsx" data-testid="rentroll-input" onChange={(e) => { read(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {p && (
        <>
          <div className="card p-5" data-testid="rentroll-summary">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold">{p.fileName}{p.report.source ? ` · ${p.report.source}` : ""}{p.report.asOf ? ` · as of ${fmtDay(p.report.asOf)}` : ""}</h2>
                <p className="mt-1 text-sm text-slate-600">{p.check.units} units in {p.properties.length} propert{p.properties.length === 1 ? "y" : "ies"} · {p.check.vacant} empty · {p.check.noLease} without a lease</p>
              </div>
              <button className="btn-primary" onClick={save} disabled={busy !== ""} data-testid="rentroll-import">{busy === "save" ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing…</> : `Import ${p.check.units} units`}</button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[["Monthly rent", p.check.rentCents, p.check.rentMatches, p.report.totals?.rentCents ?? null], ["Balance due", p.check.balanceCents, p.check.balanceMatches, p.report.totals?.balanceCents ?? null]].map(([label, v, ok, total]) => (
                <div key={label as string} className="rounded-xl bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">{label as string}</div>
                  <div className="num text-xl font-bold">{m(v as number)}</div>
                  {ok === true ? <div className="inline-flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Matches the report&apos;s total</div>
                    : ok === false ? <div className="inline-flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="h-3 w-3" /> The report says {m(total as number)}. Check the units below.</div>
                    : <div className="text-xs text-slate-400">No total on the report to check against</div>}
                </div>
              ))}
            </div>
          </div>

          {p.properties.map((prop) => {
            const v = map[prop.name] ?? { buildingId: null, createIn: null, accountId: null };
            const set = (patch: Partial<Map[string]>) => setMap((x) => ({ ...x, [prop.name]: { ...v, ...patch } }));
            const rent = prop.units.reduce((a, u) => a + (u.rentCents ?? 0), 0);
            return (
              <div key={prop.name} className="card overflow-hidden">
                <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-5 py-4">
                  <div className="min-w-[12rem] flex-1">
                    <h3 className="inline-flex items-center gap-2 font-semibold"><Home className="h-4 w-4 text-slate-400" /> {prop.name}</h3>
                    <p className="text-sm text-slate-500">{prop.units.length} units · {m(rent)}/month</p>
                  </div>
                  <div><label className="label text-xs">Building in LedgerIQ</label>
                    <select className="input w-64 py-1.5 text-sm" value={v.buildingId ?? `new:${v.createIn ?? ""}`} aria-label={`Building for ${prop.name}`}
                      onChange={(e) => e.target.value.startsWith("new:") ? set({ buildingId: null, createIn: e.target.value.slice(4) }) : set({ buildingId: e.target.value })}>
                      {p.companies.map((c) => <option key={`new-${c.id}`} value={`new:${c.id}`}>New building in {c.name}</option>)}
                      {p.companies.filter((c) => c.buildings.length).map((c) => <optgroup key={c.id} label={c.name}>{c.buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>)}
                    </select></div>
                  <div><label className="label text-xs">Rent is paid into</label>
                    <select className="input w-56 py-1.5 text-sm" value={v.accountId ?? ""} onChange={(e) => set({ accountId: e.target.value || null })} aria-label={`Rent account for ${prop.name}`}>
                      <option value="">Find it automatically</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                    </select></div>
                </div>
                <details>
                  <summary className="cursor-pointer px-5 py-2 text-sm font-medium text-brand-700">See the {prop.units.length} units</summary>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[46rem] text-sm">
                      <thead className="border-b border-slate-100"><tr><th className="th">Unit</th><th className="th">Tenant</th><th className="th">Bed / bath</th><th className="th text-right">Rent</th><th className="th text-right">Balance due</th><th className="th">Lease ends</th><th className="th">What happens</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {prop.units.map((u, i) => (
                          <tr key={i}>
                            <td className="td font-medium">{u.unit}</td>
                            <td className="td">{u.tenant ?? <span className="italic text-slate-400">Vacant</span>}</td>
                            <td className="td text-slate-600">{u.layout}{u.sqft ? ` · ${u.sqft} sq ft` : ""}</td>
                            <td className="td text-right num">{u.noLease ? <span className="text-amber-700">No lease</span> : m(u.rentCents)}</td>
                            <td className={clsx("td text-right num", (u.balanceCents ?? 0) > 0 && "text-red-700", (u.balanceCents ?? 0) < 0 && "text-emerald-700")}>{m(u.balanceCents)}</td>
                            <td className="td whitespace-nowrap text-slate-600">{fmtDay(u.leaseEnd)}</td>
                            <td className="td text-xs text-slate-500">{u.action}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
