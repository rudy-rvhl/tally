import Link from "next/link";
import clsx from "clsx";
import { ChevronRight, Info } from "lucide-react";
import { formatMoney } from "@/lib/engine/money";

export function PageHeader({ title, subtitle, actions, back }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; back?: React.ReactNode }) {
  return (
    <div className="mb-6">
      {back}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500 sm:text-base">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ title, subtitle, action, children, className, padded = true, id, "data-testid": testId }: { title?: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; padded?: boolean; id?: string; "data-testid"?: string }) {
  return (
    <section id={id} data-testid={testId} className={clsx("card scroll-mt-20", className)}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={clsx(padded && "p-5")}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, href, tone = "neutral", help }: { label: string; value: React.ReactNode; hint?: React.ReactNode; href?: string; tone?: "neutral" | "good" | "bad" | "warn"; help?: string }) {
  const body = (
    <>
      <div className="flex items-center gap-1 text-sm font-medium text-slate-500">
        {label}
        {help && <span title={help} aria-label={help}><Info className="h-3.5 w-3.5 text-slate-400" /></span>}
      </div>
      <div className={clsx("mt-1 text-2xl font-bold tracking-tight num", tone === "good" && "text-emerald-700", tone === "bad" && "text-red-700", tone === "warn" && "text-amber-700")}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
      {href && <ChevronRight className="absolute right-4 top-4 h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-500" />}
    </>
  );
  return href ? (
    <Link href={href} className="card group relative block p-4 transition hover:border-brand-200 hover:shadow-md">{body}</Link>
  ) : (
    <div className="card relative p-4">{body}</div>
  );
}

export function Money({ cents, currency = "CAD", colored = false, signed = false, className }: { cents: number; currency?: string; colored?: boolean; signed?: boolean; className?: string }) {
  return (
    <span className={clsx("num", colored && (cents > 0 ? "text-emerald-700" : cents < 0 ? "text-slate-900" : "text-slate-500"), className)}>
      {formatMoney(cents, currency, { signed })}
    </span>
  );
}

export function Badge({ children, tone = "slate", title }: { children: React.ReactNode; tone?: "slate" | "blue" | "green" | "amber" | "red" | "violet"; title?: string }) {
  const t = { slate: "bg-slate-100 text-slate-700", blue: "bg-blue-50 text-blue-700", green: "bg-emerald-50 text-emerald-700", amber: "bg-amber-50 text-amber-800", red: "bg-red-50 text-red-700", violet: "bg-violet-50 text-violet-700" }[tone];
  return <span title={title} className={clsx("chip", t)}>{children}</span>;
}

export function EmptyState({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon && <div className="mb-4 rounded-2xl bg-brand-50 p-3 text-brand-600">{icon}</div>}
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      {body && <p className="mt-1 max-w-md text-sm text-slate-500">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "blue", children, action }: { tone?: "blue" | "amber" | "red" | "green"; children: React.ReactNode; action?: React.ReactNode }) {
  const t = { blue: "border-blue-200 bg-blue-50 text-blue-900", amber: "border-amber-200 bg-amber-50 text-amber-900", red: "border-red-200 bg-red-50 text-red-900", green: "border-emerald-200 bg-emerald-50 text-emerald-900" }[tone];
  return (
    <div className={clsx("flex flex-col gap-2 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between", t)}>
      <div>{children}</div>
      {action}
    </div>
  );
}

/** Horizontal ranked bars, every row is a link to its transactions. */
export function BarList({ items, currency = "CAD", max }: { items: { label: string; value: number; href: string; sub?: string }[]; currency?: string; max?: number }) {
  const top = max ?? Math.max(1, ...items.map((i) => Math.abs(i.value)));
  return (
    <ul className="space-y-1">
      {items.map((i) => (
        <li key={i.href + i.label}>
          <Link href={i.href} className="group block rounded-lg px-2 py-1.5 hover:bg-slate-50">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-medium text-slate-800 group-hover:text-brand-700">{i.label}</span>
              <span className="num font-semibold text-slate-900">{formatMoney(i.value, currency)}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-brand-500/80 group-hover:bg-brand-600" style={{ width: `${Math.max(2, (Math.abs(i.value) / top) * 100)}%` }} />
              </div>
              {i.sub && <span className="w-28 shrink-0 text-right text-xs text-slate-500">{i.sub}</span>}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Delta({ pct, cents, currency = "CAD", goodWhenDown = true }: { pct: number | null; cents?: number; currency?: string; goodWhenDown?: boolean }) {
  if (pct === null && !cents) return <span className="text-slate-400">—</span>;
  const up = (cents ?? pct ?? 0) > 0;
  const good = goodWhenDown ? !up : up;
  return (
    <span className={clsx("num font-medium", good ? "text-emerald-700" : "text-red-700")}>
      {up ? "▲" : "▼"} {cents !== undefined ? formatMoney(Math.abs(cents), currency) : ""}{pct !== null ? ` (${Math.abs(pct).toFixed(1)}%)` : ""}
    </span>
  );
}
