import Link from "next/link";
import clsx from "clsx";
import { AlertTriangle, AlertCircle, Info, ChevronRight } from "lucide-react";

export interface FindingView { severity: "high" | "medium" | "info"; title: string; detail: string; href?: string; building?: string | null; metric?: string }

const STYLE = {
  high: { icon: AlertCircle, box: "bg-red-50 text-red-600", label: "Act now" },
  medium: { icon: AlertTriangle, box: "bg-amber-50 text-amber-600", label: "Worth a look" },
  info: { icon: Info, box: "bg-sky-50 text-sky-600", label: "Good to know" },
} as const;

/** Plain-language findings, most important first. */
export function Findings({ items, empty = "Nothing needs your attention.", limit }: { items: FindingView[]; empty?: string; limit?: number }) {
  if (!items.length) return <p className="text-sm text-slate-500">{empty}</p>;
  const shown = limit ? items.slice(0, limit) : items;
  const rest = limit ? items.slice(limit) : [];
  const row = (f: FindingView, i: number) => {
    const s = STYLE[f.severity];
    const body = (
      <div className="flex gap-3">
        <span className={clsx("mt-0.5 h-fit rounded-lg p-1.5", s.box)} title={s.label}><s.icon className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold text-slate-900">{f.title}</span>
            {f.building && <span className="text-xs text-slate-500">{f.building}</span>}
            {f.metric && <span className="num ml-auto text-sm font-semibold text-slate-700">{f.metric}</span>}
          </div>
          <p className="mt-0.5 text-sm text-slate-600">{f.detail}</p>
        </div>
        {f.href && <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300 group-hover:text-brand-500" />}
      </div>
    );
    return <li key={i}>{f.href ? <Link href={f.href} className="group block rounded-xl p-3 hover:bg-slate-50">{body}</Link> : <div className="p-3">{body}</div>}</li>;
  };
  return (
    <div data-testid="findings">
      <ul className="-m-3 divide-y divide-slate-100">{shown.map(row)}</ul>
      {rest.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-brand-700">Show {rest.length} more</summary>
          <ul className="-mx-3 mt-2 divide-y divide-slate-100">{rest.map((f, i) => row(f, i + shown.length))}</ul>
        </details>
      )}
    </div>
  );
}

export const SEVERITY_COUNTS = (items: FindingView[]) => ({ high: items.filter((f) => f.severity === "high").length, medium: items.filter((f) => f.severity === "medium").length, info: items.filter((f) => f.severity === "info").length });
