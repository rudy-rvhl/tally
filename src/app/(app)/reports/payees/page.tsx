import Link from "next/link";
import clsx from "clsx";
import { CalendarCheck, Search } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { loadPayee, payeeOptions, payeesWithGaps, type Direction } from "@/lib/services/payees";
import { formatDate, monthLabel } from "@/lib/engine/dates";
import { formatMoney } from "@/lib/engine/money";
import { txnLink } from "@/lib/filters";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { ReportsTabs } from "@/components/Nav";
import type { PayeeMonthStatus } from "@/lib/engine/payees";

export const metadata = { title: "Payee tracker" };

const STATUS: Record<PayeeMonthStatus, { label: string; box: string }> = {
  PAID: { label: "Paid", box: "border-emerald-200 bg-emerald-50" },
  LOW: { label: "Less than usual", box: "border-amber-200 bg-amber-50" },
  HIGH: { label: "More than usual", box: "border-sky-200 bg-sky-50" },
  MISSING: { label: "Not paid", box: "border-red-300 bg-red-50" },
  NO_STATEMENT: { label: "No statement imported", box: "border-dashed border-slate-300 bg-white" },
  NOT_STARTED: { label: "Before the first payment", box: "border-slate-100 bg-slate-50 opacity-60" },
};

export default async function PayeesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const dir: Direction = sp.dir === "in" ? "in" : "out";
  const n = sp.n === "24" ? 24 : 12;
  const payee = sp.payee || undefined, q = sp.q?.trim() || undefined;
  const c = user.baseCurrency;
  const [options, gaps, result] = await Promise.all([
    payeeOptions(user.id, dir), payeesWithGaps(user, dir),
    payee || q ? loadPayee(user, { payee, q, dir, n }) : Promise.resolve(null),
  ]);
  const verb = dir === "out" ? "Paid" : "Received";
  const s = result?.summary;
  const monthHref = (m: string) => txnLink({}, { month: m, ...(payee ? { merchant: payee } : { q }) });

  return (
    <>
      <ReportsTabs />
      <PageHeader title="Payee tracker" subtitle="Pick someone you pay (or who pays you) and see, month by month, whether a payment was made." />

      <Card className="mb-6">
        <form method="get" className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto_auto] md:items-end" data-testid="payee-form">
          <div><label className="label" htmlFor="payee">Payee</label>
            <select id="payee" name="payee" className="input" defaultValue={payee ?? ""}>
              <option value="">Choose…</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.count})</option>)}
            </select></div>
          <div><label className="label" htmlFor="q">…or words on the statement</label>
            <input id="q" name="q" className="input" defaultValue={q ?? ""} placeholder="e.g. PRONTO" /></div>
          <div><label className="label" htmlFor="dir">Looking for</label>
            <select id="dir" name="dir" className="input" defaultValue={dir}><option value="out">Payments I made</option><option value="in">Money I received</option></select></div>
          <div><label className="label" htmlFor="n">Over</label>
            <select id="n" name="n" className="input" defaultValue={String(n)}><option value="12">12 months</option><option value="24">24 months</option></select></div>
          <button className="btn-primary"><Search className="h-4 w-4" /> Show</button>
        </form>
        <p className="mt-2 text-xs text-slate-500">If a payee and words are both given, both must match. Words find e-transfers to people who aren&apos;t a recognised supplier (e.g. “Interac e-Transfer Out to PRONTO …”).</p>
      </Card>

      {result && s && (result.rows.length ? (
        <>
          <Card className="mb-6" title={<span className="inline-flex items-center gap-2"><CalendarCheck className="h-4 w-4" /> {result.label}</span>}
            subtitle={`${monthLabel(result.months[0], "short")} – ${monthLabel(result.months[result.months.length - 1], "short")}`}>
            <p className="mb-4 text-base text-slate-800" data-testid="payee-summary">
              {verb} in <strong>{s.paidMonths} of {s.expectedMonths}</strong> month{s.expectedMonths === 1 ? "" : "s"}
              {s.usualCents ? <>, usually <strong>{formatMoney(s.usualCents, c)}</strong> a month</> : null}.{" "}
              {s.missing.length
                ? <span className="font-semibold text-red-700">Nothing {dir === "out" ? "paid" : "received"} in {s.missing.map((m) => monthLabel(m)).join(", ")}.</span>
                : <span className="font-semibold text-emerald-700">No month missed.</span>}
              {" "}Total {formatMoney(s.totalCents, c)}{s.lastPaid ? `, last on ${formatDate(s.lastPaid, "long")}` : ""}.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="payee-months">
              {s.months.map((m) => (
                <Link key={m.month} href={monthHref(m.month)} className={clsx("rounded-xl border p-3 transition hover:shadow-sm", STATUS[m.status].box)} data-status={m.status}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{monthLabel(m.month, "short")}</div>
                  <div className={clsx("num mt-1 text-lg font-bold", m.status === "MISSING" ? "text-red-700" : "text-slate-900")}>{m.totalCents ? formatMoney(m.totalCents, c) : "—"}</div>
                  <div className="text-xs text-slate-600">{STATUS[m.status].label}{m.count > 1 ? ` · ${m.count} payments` : ""}</div>
                  {m.dates.length > 0 && <div className="mt-0.5 text-[11px] text-slate-500">{m.dates.map((d) => formatDate(d)).join(", ")}</div>}
                </Link>
              ))}
            </div>
          </Card>
          <Card padded={false} title={`${result.rows.length} ${dir === "out" ? "payment" : "deposit"}${result.rows.length === 1 ? "" : "s"}`}>
            <ul className="divide-y divide-slate-100 text-sm">
              {result.rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                  <span className="w-28 text-slate-500">{formatDate(r.date)}</span>
                  <Link className="min-w-[12rem] flex-1 hover:text-brand-700" href={`/transactions/${r.id}`}>{r.description}</Link>
                  <span className="text-xs text-slate-500">{r.account.name}</span>
                  <span className="num w-28 text-right font-semibold">{formatMoney(Math.abs(r.amountCents), r.currency)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : <Card><EmptyState title={`Nothing found for “${result.label}”`} body={`No ${dir === "out" ? "payments" : "money received"} matched in the last ${n} months. Try other words from the statement, or the other direction.`} /></Card>)}

      <Card title={dir === "out" ? "Regular payees with a missed month" : "Regular payers with a missed month"} subtitle="Paid in at least 3 of the last 12 months, but not in every month since they started." className={result ? "mt-6" : ""}>
        {gaps.length ? (
          <ul className="divide-y divide-slate-100 text-sm" data-testid="payee-gaps">
            {gaps.map((g) => (
              <li key={g.id}><Link href={`/reports/payees?payee=${g.id}&dir=${dir}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2 hover:text-brand-700">
                <span className="font-medium">{g.name}</span>
                <span className="text-slate-600">{g.usualCents ? `usually ${formatMoney(g.usualCents, c)} · ` : ""}<span className="font-semibold text-red-700">missed {g.missing.map((m) => monthLabel(m, "short")).join(", ")}</span></span>
              </Link></li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-500">No regular {dir === "out" ? "payee" : "payer"} has a missed month in the last 12 months.</p>}
      </Card>
    </>
  );
}
