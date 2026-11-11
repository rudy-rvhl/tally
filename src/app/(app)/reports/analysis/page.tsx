import Link from "next/link";
import clsx from "clsx";
import { Eye, Building2, Landmark, TrendingUp, BookOpen } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { loadAnalysis, PERIODS, type Period, type PropertyView } from "@/lib/services/analysis";
import { pctChange } from "@/lib/engine/analysis";
import { formatDate, monthLabel } from "@/lib/engine/dates";
import { formatMoney } from "@/lib/engine/money";
import { BarList, Card, Notice, PageHeader, Stat } from "@/components/ui";
import { ReportsTabs } from "@/components/Nav";
import { Findings, SEVERITY_COUNTS } from "@/components/Findings";
import { IncomeVsSpending } from "@/components/charts";

export const metadata = { title: "Data analysis" };

const pct = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : ""}${Math.round(v * 100)}%`);
const ratio = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

export default async function AnalysisPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const period = (PERIODS.find((p) => p.id === sp.period)?.id ?? "12m") as Period;
  const a = await loadAnalysis(user, period);
  const c = user.baseCurrency;
  const counts = SEVERITY_COUNTS(a.findings);
  const span = `${monthLabel(a.months[0], "short")} – ${monthLabel(a.months[a.months.length - 1], "short")}`;
  const t = a.total, tp = a.totalPrev;
  const realProps = a.props.filter((p) => p.id !== "none");
  const SECTIONS = [["dont-see", "What you don't see", Eye], ["properties", "Properties", Building2], ["accounts", "Accounts", Landmark], ["trends", "Trends", TrendingUp], ["method", "How it's calculated", BookOpen]] as const;

  return (
    <>
      <ReportsTabs />
      <PageHeader title={`Data analysis${a.scope.multi ? ` · ${a.scope.label}` : ""}`} subtitle={`Every property and account, ${span}, compared with the ${a.months.length} months before.`}
        actions={<div className="flex gap-1 rounded-xl bg-slate-100 p-1">{PERIODS.map((p) => <Link key={p.id} href={`/reports/analysis?period=${p.id}`} className={clsx("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium", p.id === period ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900")}>{p.label}</Link>)}</div>} />

      <nav className="sticky top-[57px] z-[5] -mx-1 mb-6 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white/95 p-1 shadow-sm backdrop-blur print:hidden" aria-label="Sections">
        {SECTIONS.map(([id, label, Icon]) => (
          <a key={id} href={`#${id}`} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900">
            <Icon className="h-4 w-4" /> {label}{id === "dont-see" && a.findings.length ? <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-800">{a.findings.length}</span> : null}
          </a>
        ))}
      </nav>

      {a.conversion.missing.length > 0 && <div className="mb-4"><Notice tone="amber">Some foreign-currency transactions aren&apos;t included because no exchange rate was entered. <Link className="underline" href="/settings#rates">Add a rate</Link></Notice></div>}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Income" value={formatMoney(t.incomeCents, c)} tone="good" hint={`${pct(pctChange(t.incomeCents, tp.incomeCents))} vs before`} />
        <Stat label="Operating expenses" value={formatMoney(t.opexCents, c)} hint={`${pct(pctChange(t.opexCents, tp.opexCents))} vs before`} />
        <Stat label="Net operating income" value={formatMoney(t.noiCents, c)} tone={t.noiCents >= 0 ? "good" : "bad"} hint={`Expense ratio ${ratio(t.expenseRatio)}`} help="Income minus operating expenses, before interest and loan payments." />
        <Stat label="Debt payments" value={formatMoney(t.interestCents + t.principalCents, c)} hint={`${formatMoney(t.interestCents, c)} interest`} />
        <Stat label="Cash flow" value={formatMoney(t.cashFlowCents, c)} tone={t.cashFlowCents >= 0 ? "good" : "bad"} hint="After debt payments" />
      </div>

      <Card id="dont-see" className="mb-8" title={<span className="inline-flex items-center gap-2"><Eye className="h-4 w-4" /> What you don&apos;t see</span>}
        subtitle={`${counts.high} to act on now · ${counts.medium} worth a look · ${counts.info} good to know. Each one says why it matters and what to do.`}>
        <Findings items={a.findings} limit={8} empty="Nothing unusual in this period. We'll tell you here when something changes." />
      </Card>

      <section id="properties" className="mb-8 scroll-mt-28">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><Building2 className="h-5 w-5 text-slate-400" /> Properties</h2>
        <Card padded={false} className="mb-6" title="Side by side" subtitle={`${span}. “vs before” compares with the previous ${a.months.length} months.`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm" data-testid="property-table">
              <thead className="border-b border-slate-100"><tr>
                <th className="th">Property</th><th className="th text-right">Income</th><th className="th text-right">of which rent</th><th className="th text-right">Expenses</th>
                <th className="th text-right">NOI</th><th className="th text-right">Expense ratio</th><th className="th text-right">Debt payments</th><th className="th text-right">Cash flow</th><th className="th text-right">NOI vs before</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {a.props.map((p) => (
                  <tr key={p.id} className={p.id === "none" ? "text-slate-500" : ""}>
                    <td className="td font-medium"><a href={`#p-${p.id}`} className="hover:text-brand-700">{p.name}</a>{p.company && <div className="text-xs font-normal text-slate-500">{p.company}</div>}</td>
                    <td className="td text-right num">{formatMoney(p.m.incomeCents, c)}</td>
                    <td className="td text-right num text-slate-500">{p.m.rentCents ? formatMoney(p.m.rentCents, c) : "—"}</td>
                    <td className="td text-right num">{formatMoney(p.m.opexCents, c)}</td>
                    <td className={clsx("td text-right num font-semibold", p.m.noiCents < 0 && "text-red-700")}>{formatMoney(p.m.noiCents, c)}</td>
                    <td className={clsx("td text-right num", (p.m.expenseRatio ?? 0) > 0.5 && "text-amber-700")}>{ratio(p.m.expenseRatio)}</td>
                    <td className="td text-right num">{formatMoney(p.m.interestCents + p.m.principalCents, c)}</td>
                    <td className={clsx("td text-right num font-semibold", p.m.cashFlowCents < 0 ? "text-red-700" : "text-emerald-700")}>{formatMoney(p.m.cashFlowCents, c)}</td>
                    <td className="td text-right num">{pct(pctChange(p.m.noiCents, p.prev.noiCents))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        {a.props.map((p, i) => <PropertyCard key={p.id} p={p} c={c} open={i === 0 || a.props.length <= 2} unassigned={p.id === "none" && realProps.length > 0} />)}
      </section>

      <section id="accounts" className="mb-8 scroll-mt-28">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><Landmark className="h-5 w-5 text-slate-400" /> Accounts</h2>
        <Card padded={false} subtitle="Money in and out, balance, what the account costs in fees and what it earns in interest.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm" data-testid="account-table">
              <thead className="border-b border-slate-100"><tr>
                <th className="th">Account</th><th className="th text-right">Money in</th><th className="th text-right">Money out</th><th className="th text-right">Net</th>
                <th className="th text-right">Balance</th><th className="th text-right">Fees</th><th className="th text-right">Interest earned</th><th className="th text-right">Yield / year</th><th className="th">Statements</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {a.accounts.map((x) => (
                  <tr key={x.id}>
                    <td className="td"><Link className="font-medium hover:text-brand-700" href={`/accounts/${x.id}`}>{x.name}</Link><div className="text-xs text-slate-500">{x.institution}{x.mask ? ` ··${x.mask}` : ""}{x.where ? ` · ${x.where}` : ""}</div></td>
                    <td className="td text-right num text-emerald-700">{formatMoney(x.inCents, x.currency)}</td>
                    <td className="td text-right num">{formatMoney(x.outCents, x.currency)}</td>
                    <td className={clsx("td text-right num font-semibold", x.inCents - x.outCents < 0 && "text-red-700")}>{formatMoney(x.inCents - x.outCents, x.currency, { signed: true })}</td>
                    <td className="td text-right num">{x.balanceCents === null ? <span className="text-slate-400">Unknown</span> : formatMoney(x.balanceCents, x.currency)}{x.balanceAsOf && <div className="text-xs text-slate-400">{formatDate(x.balanceAsOf)}</div>}</td>
                    <td className="td text-right num">{x.feesCents ? formatMoney(x.feesCents, x.currency) : "—"}</td>
                    <td className="td text-right num">{x.interestEarnedCents ? formatMoney(x.interestEarnedCents, x.currency) : "—"}</td>
                    <td className={clsx("td text-right num", x.yield !== null && x.yield < 0.01 && (x.balanceCents ?? 0) > 2_500_000 && "font-semibold text-red-700")}>{x.yield === null ? "—" : `${(x.yield * 100).toFixed(2)}%`}</td>
                    <td className="td">{x.missingMonths.length ? <span className="text-xs text-amber-700">{x.missingMonths.length} month{x.missingMonths.length === 1 ? "" : "s"} missing</span> : <span className="text-xs text-emerald-700">Complete</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <section id="trends" className="mb-8 scroll-mt-28">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><TrendingUp className="h-5 w-5 text-slate-400" /> Trends</h2>
        <div className="grid gap-6 xl:grid-cols-5">
          <Card title="Income and operating expenses, month by month" className="xl:col-span-3">
            <IncomeVsSpending data={t.months.map((m) => ({ label: monthLabel(m.month, "short"), spending: m.opexCents, income: m.incomeCents, href: `/?month=${m.month}` }))} />
          </Card>
          <Card title="Where operating expenses go" subtitle={span} className="xl:col-span-2">
            <BarList currency={c} items={t.categories.map((g) => ({ label: g.label, value: g.spendCents, sub: `${Math.round(g.share * 100)}%`, href: `/spending?view=categories` }))} />
          </Card>
        </div>
      </section>

      <Card id="method" title={<span className="inline-flex items-center gap-2"><BookOpen className="h-4 w-4" /> How it&apos;s calculated</span>} className="mb-6">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          {[
            ["Income", "Money received that isn't a transfer between your own accounts or a refund. “Of which rent” is income matched to a tenant on the rent roll."],
            ["Operating expenses", "Purchases and fees, minus refunds. Interest, loan principal, transfers and card payments are not included, so nothing is counted twice."],
            ["NOI (net operating income)", "Income minus operating expenses: what the property earns before financing."],
            ["Expense ratio", "Operating expenses as a share of income. Residential buildings typically run at 35% to 50%."],
            ["Debt payments and cash flow", "Interest plus loan principal (from the loan split on your statements). Cash flow is NOI minus debt payments."],
            ["Properties", "A transaction belongs to a building when it was assigned to one, otherwise to its account's building. Money with neither is shown as “Not assigned to a building”."],
            ["Yield", "Interest earned in the period, scaled to a year, divided by the latest balance."],
            ["Completeness", "Only imported statements are included. Months with a missing statement are flagged in Accounts."],
          ].map(([k, v]) => <div key={k}><dt className="font-semibold text-slate-800">{k}</dt><dd className="mt-0.5 text-slate-600">{v}</dd></div>)}
        </dl>
      </Card>
    </>
  );
}

function PropertyCard({ p, c, open, unassigned }: { p: PropertyView; c: string; open: boolean; unassigned: boolean }) {
  const perUnit = p.units ? (v: number) => formatMoney(Math.round(v / p.units), c) : null;
  return (
    <details id={`p-${p.id}`} open={open} className="card mb-4 scroll-mt-28 overflow-hidden">
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 px-5 py-4">
        <span className="font-semibold">{p.name}{p.company && <span className="ml-2 text-sm font-normal text-slate-500">{p.company}</span>}</span>
        <span className="text-sm text-slate-500">NOI <strong className={clsx("num", p.m.noiCents < 0 ? "text-red-700" : "text-slate-900")}>{formatMoney(p.m.noiCents, c)}</strong> · cash flow <strong className={clsx("num", p.m.cashFlowCents < 0 ? "text-red-700" : "text-emerald-700")}>{formatMoney(p.m.cashFlowCents, c)}</strong></span>
      </summary>
      <div className="border-t border-slate-100 p-5">
        {unassigned && <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Money on accounts not linked to a building. Assign accounts to buildings (Accounts) to see each property&apos;s true results.</p>}
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Mini label="Income" v={formatMoney(p.m.incomeCents, c)} sub={`${pct(pctChange(p.m.incomeCents, p.prev.incomeCents))} vs before`} />
          <Mini label="Expenses" v={formatMoney(p.m.opexCents, c)} sub={`${pct(pctChange(p.m.opexCents, p.prev.opexCents))} vs before`} />
          <Mini label="Expense ratio" v={ratio(p.m.expenseRatio)} sub="35–50% is typical" />
          <Mini label={p.units ? "NOI per unit" : "NOI"} v={perUnit ? perUnit(p.m.noiCents) : formatMoney(p.m.noiCents, c)} sub={p.units ? `${p.tenants} of ${p.units} units rented` : "Add tenants for per-unit figures"} />
        </div>
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <h4 className="mb-2 text-sm font-semibold text-slate-700">Month by month</h4>
            <IncomeVsSpending height={220} data={p.m.months.map((m) => ({ label: monthLabel(m.month, "short"), spending: m.opexCents, income: m.incomeCents, href: `/?month=${m.month}` }))} />
          </div>
          <div className="space-y-5 lg:col-span-2">
            <div><h4 className="mb-2 text-sm font-semibold text-slate-700">Biggest costs</h4>
              {p.m.categories.length ? <BarList currency={c} items={p.m.categories.slice(0, 6).map((g) => ({ label: g.label, value: g.spendCents, sub: `${Math.round(g.share * 100)}%`, href: "/spending?view=categories" }))} /> : <p className="text-sm text-slate-500">No expenses in this period.</p>}</div>
            <div><h4 className="mb-2 text-sm font-semibold text-slate-700">Top suppliers</h4>
              {p.m.suppliers.length ? <BarList currency={c} items={p.m.suppliers.slice(0, 5).map((g) => ({ label: g.label, value: g.spendCents, sub: `${g.count}×`, href: g.key.startsWith("name:") ? `/transactions?q=${encodeURIComponent(g.label)}` : `/spending/suppliers/${g.key}` }))} /> : <p className="text-sm text-slate-500">—</p>}</div>
          </div>
        </div>
      </div>
    </details>
  );
}

function Mini({ label, v, sub }: { label: string; v: string; sub: string }) {
  return <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">{label}</div><div className="num text-lg font-bold">{v}</div><div className="text-xs text-slate-500">{sub}</div></div>;
}
