"use client";
import { useTransition } from "react";
import { Building2 } from "lucide-react";
import clsx from "clsx";
import { setScopeAction } from "@/app/actions";
import type { CompanyTree } from "@/lib/scope";

/** Header picker: everything, one company, or one building. Applies to every screen. */
export function ScopeSwitch({ companies, value }: { companies: CompanyTree[]; value: string }) {
  const [pending, start] = useTransition();
  const many = companies.length > 1;
  return (
    <label className={clsx("relative flex min-w-0 items-center", pending && "opacity-60")} title="Choose which company or building the screens show. Downloads for your accountant always include everything.">
      <Building2 className="pointer-events-none absolute left-2.5 h-4 w-4 text-slate-500" aria-hidden />
      <span className="sr-only">Showing</span>
      <select key={value} defaultValue={value} disabled={pending} aria-busy={pending} data-testid="scope-switch"
        onChange={(e) => { const v = e.target.value; start(async () => { await setScopeAction(v); }); }}
        className="w-36 truncate rounded-full border border-slate-200 bg-white py-1.5 pl-8 pr-7 text-sm font-medium text-slate-800 shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 sm:w-48">
        <option value="all">{many ? "All companies" : `All of ${companies[0]?.name ?? "my company"}`}</option>
        {companies.map((c) => many ? (
          <optgroup key={c.id} label={c.name}>
            <option value={`c:${c.id}`}>{c.name} (all)</option>
            {c.buildings.map((b) => <option key={b.id} value={`b:${b.id}`}>{b.name}</option>)}
          </optgroup>
        ) : c.buildings.map((b) => <option key={b.id} value={`b:${b.id}`}>{b.name}</option>))}
      </select>
    </label>
  );
}

/** A button that switches what the screens show, then opens `href`. */
export function ScopeLink({ value, href, className, children, title }: { value: string; href: string; className?: string; children: React.ReactNode; title?: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" title={title} disabled={pending} aria-busy={pending} className={clsx("text-left", className, pending && "opacity-60")}
      onClick={() => start(async () => { await setScopeAction(value, href); })}>
      {children}
    </button>
  );
}
