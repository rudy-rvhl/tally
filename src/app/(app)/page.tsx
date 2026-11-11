import Link from "next/link";
import { Upload, Landmark, Sparkles } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readFilters, txnLink, type Filters } from "@/lib/filters";
import { latestMonth, loadAnalytic } from "@/lib/services/query";
import { accountCoverage, lastNMonths } from "@/lib/services/options";
import { byCategory, byMerchant, detectAnomalies, detectRecurring, groupSpending, monthlySeries, rollingAverage, summarize } from "@/lib/engine/analytics";
import { anomalyInsights, explainMonth, recurringInsights } from "@/lib/engine/insights";
import { addMonths, monthKey, monthLabel, monthRange, isoDate } from "@/lib/engine/dates";
import { formatMoney, pctChange } from "@/lib/engine/money";
import { EXAMPLE_QUESTIONS } from "@/lib/engine/ask";
import { BarList, Card, Delta, EmptyState, Notice, PageHeader, Stat } from "@/components/ui";
import { AskBar } from "@/components/AskBar";
import { MonthPicker } from "@/components/MonthPicker";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { InsightList } from "@/components/InsightList";
import { DonutChart, TrendChart } from "@/components/charts";
import { ScopeBreakdown } from "@/components/ScopeBreakdown";
import { accountIdsInScope, breakdown, resolveScope } from "@/lib/scope";

export const metadata = { title: "Overview" };

export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const sp = readFilters(await searchParams);
  const [accountCount, txnCount] = await Promise.all([
    prisma.account.count({ where: { userId: user.id } }),
    prisma.transaction.count({ where: { userId: user.id } }),
  ]);
  if (!accountCount || !txnCount) {
    return (
      <>
        <PageHeader title={`Welcome${user.name ? `, ${user.name.split(" ")[0]}` : ""}`} subtitle="Let's get your numbers in. It takes about two minutes." />
        <Card>
          <EmptyState
            icon={<Upload className="h-6 w-6" />}
            title={accountCount ? "Import your first statement" : "Start by adding a bank account or card"}
            body={accountCount
              ? "Download a statement from your bank's website (CSV, Excel, OFX/QFX or PDF), then drag it in. You'll see a preview before anything is saved."
              : "Drop in your statements from every bank (PDF, CSV, Excel or OFX). LedgerIQ recognises each account by its number and type and sets them up for you. Or add an account by hand first."}
            action={accountCount ? <Link href="/import" className="btn-primary"><Upload className="h-4 w-4" /> Import a statement</Link>
              : <div className="flex flex-wrap justify-center gap-2"><Link href="/import/bulk" className="btn-primary"><Upload className="h-4 w-4" /> Drop all my statements</Link><Link href="/accounts/new?next=import" className="btn-secondary"><Landmark className="h-4 w-4" /> Add an account</Link></div>}
          />
        </Card>
      </>
    );
  }
  const latest = await latestMonth(user.id);
  const raw = await searchParams;
  const yearly = raw.view === "year";
  // Yearly view: the fiscal year (calendar year when it starts in January) containing the chosen month.
  const fy = user.fiscalYearStartMonth;
  const fyStartOf = (m: string) => { const [y, mo] = m.split("-").map(Number); return `${mo >= fy ? y : y - 1}-${String(fy).padStart(2, "0")}`; };
  const yearStartKey = /^\d{4}-\d{2}$/.test(raw.year ?? "") ? fyStartOf(raw.year) : fyStartOf(sp.month ?? latest);
  const yearLabel = (start: string) => (fy === 1 ? start.slice(0, 4) : `${start.slice(0, 4)}–${Number(start.slice(0, 4)) + 1}`);
  const month = yearly ? addMonths(yearStartKey, 11) : sp.month ?? latest;
  const prev = addMonths(month, -1);
  const periodMonths = yearly ? lastNMonths(month, 12) : [month];
  const months = lastNMonths(month, 12);
  const rangeOf = (ms: string[]) => ({ from: isoDate(monthRange(ms[0]).start), to: isoDate(monthRange(ms[ms.length - 1]).end) });
  const pf: Filters = yearly ? rangeOf(periodMonths) : { month };
  const prevFilter: Filters = yearly ? rangeOf(periodMonths.map((m) => addMonths(m, -12))) : { month: prev };
  const pq = yearly ? `from=${pf.from}&to=${pf.to}` : `month=${month}`;
  const label = yearly ? (fy === 1 ? yearLabel(yearStartKey) : `fiscal ${yearLabel(yearStartKey)}`) : monthLabel(month);
  const prevLabel = yearly ? (fy === 1 ? yearLabel(addMonths(yearStartKey, -12)) : `fiscal ${yearLabel(addMonths(yearStartKey, -12))}`) : monthLabel(prev);
  const [cur, last, hist, review, cov, scope] = await Promise.all([
    loadAnalytic(user, pf),
    loadAnalytic(user, prevFilter),
    loadAnalytic(user, rangeOf(months)),
    prisma.reviewItem.count({ where: { userId: user.id, status: "OPEN" } }),
    accountCoverage(user.id, periodMonths.filter((m) => m <= latest)),
    resolveScope(user.id),
  ]);
  const inScope = await accountIdsInScope(user.id, scope);
  const split = breakdown(scope, cur.txns);
  const c = user.baseCurrency;
  const s = summarize(cur.txns), p = summarize(last.txns);
  // Start the chart at the first month with data, so it isn't mostly empty.
  const firstDataMonth = hist.txns.length ? monthKey(hist.txns[0].date) : month;
  const series = monthlySeries(hist.txns, months).filter((p) => p.month >= firstDataMonth && p.month <= latest);
  const avg3 = rollingAverage(series.map((x) => x.spendingCents), 3);
  const prior3 = series.slice(-4, -1).map((x) => x.spendingCents);
  const avgPrior = prior3.length === 3 ? Math.round(prior3.reduce((a, b) => a + b, 0) / 3) : null;
  const cats = groupSpending(cur.txns, byCategory);
  const merchants = groupSpending(cur.txns, byMerchant);
  const recurring = detectRecurring(hist.txns);
  const recurringThisMonth = recurring.filter((r) => r.lastDate >= monthRange(month).start && r.lastDate <= monthRange(month).end);
  const recurringTotal = recurringThisMonth.reduce((a, r) => a + r.lastCents, 0);
  const anomalies = detectAnomalies(hist.txns.filter((t) => t.date < monthRange(month).start), cur.txns);
  const insights = yearly
    ? explainMonth(cur.txns, last.txns, month, prev, c, { cur: label, prev: prevLabel, from: pf.from!, to: pf.to! })
    : [...explainMonth(cur.txns, last.txns, month, prev, c), ...recurringInsights(recurringThisMonth, c), ...anomalyInsights(anomalies, c)];
  const gaps = cov.filter((a) => (!inScope || inScope.has(a.accountId)) && a.cells.some((x) => x.status === "MISSING" || x.status === "PARTIAL"));
  const catIds = await prisma.category.findMany({ where: { userId: user.id, parentId: null }, select: { id: true, name: true } });
  const catHref = (name: string) => txnLink({}, { ...pf, kind: "spending", category: catIds.find((x) => x.name === name)?.id });
  const merchantHref = (key: string, label: string) => key.startsWith("name:") ? txnLink({}, { ...pf, q: label }) : `/spending/suppliers/${key}?${pq}`;
  const mLabel = yearly ? label : monthLabel(month).split(" ")[0];
  const switcher = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Period">
        <Link role="tab" aria-selected={!yearly} href={`/?month=${yearly ? latest : month}`} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${!yearly ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}>Month</Link>
        <Link role="tab" aria-selected={yearly} href={`/?view=year&year=${month}`} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${yearly ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}>Year</Link>
      </div>
      {yearly ? (
        <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          <Link href={`/?view=year&year=${addMonths(yearStartKey, -12)}`} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Previous year"><ChevronLeft className="h-4 w-4" /></Link>
          <span className="min-w-[8.5rem] px-2 text-center text-sm font-semibold text-slate-800">{label}</span>
          {addMonths(yearStartKey, 12) <= latest ? <Link href={`/?view=year&year=${addMonths(yearStartKey, 12)}`} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Next year"><ChevronRight className="h-4 w-4" /></Link> : <span className="p-1.5 text-slate-200"><ChevronRight className="h-4 w-4" /></span>}
        </div>
      ) : <MonthPicker month={month} basePath="/" latest={latest} />}
    </div>
  );

  return (
    <>
      <PageHeader title={scope.multi ? scope.label : "Overview"} subtitle={`${scope.multi ? "Overview · " : "How your business did in "}${yearly ? `${label} (${monthLabel(periodMonths[0], "short")} – ${monthLabel(month, "short")}), compared with ${prevLabel}` : label}${scope.building ? ` · ${scope.company!.name}` : ""}`} actions={switcher} />

      <div className="mb-6"><AskBar size="lg" suggestions={EXAMPLE_QUESTIONS.slice(0, 4)} /></div>

      {gaps.length > 0 && (
        <div className="mb-4">
          <Notice tone="amber" action={<Link href="/accounts" className="btn-secondary btn-sm">See statement coverage</Link>}>
            <strong>{mLabel} may be incomplete.</strong>{" "}
            {yearly
              ? `${gaps.map((g) => { const n = g.cells.filter((x) => x.status === "MISSING" || x.status === "PARTIAL").length; return `${g.name}: ${n} month${n === 1 ? "" : "s"} missing or partial`; }).join("; ")}.`
              : `${gaps.map((g) => `${g.name} ${g.cells[0].status === "MISSING" ? "has no statement" : `only covers ${g.cells[0].coveredDays} of ${g.cells[0].daysInMonth} days`}`).join("; ")} for this month.`} Totals below only include what's been imported.
          </Notice>
        </div>
      )}
      {cur.conversion.missing.length > 0 && (
        <div className="mb-4"><Notice tone="amber" action={<Link className="btn-secondary btn-sm" href="/settings#rates">Add exchange rate</Link>}>
          {cur.conversion.missing.reduce((a, m) => a + m.count, 0)} {cur.conversion.missing.map((m) => m.currency).join("/")} transactions aren't in these totals because there's no exchange rate for {mLabel}. We never mix currencies without a rate you've confirmed.
        </Notice></div>
      )}

      <Card title="What changed?" subtitle="A plain-language summary. Click any line to see the transactions behind it." className="mb-6">
        <InsightList insights={insights} />
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Money spent" value={formatMoney(s.spendingCents, c)} href={txnLink({}, { ...pf, kind: "spending" })}
          hint={p.spendingCents ? <Delta pct={pctChange(s.spendingCents, p.spendingCents)} cents={s.spendingCents - p.spendingCents} currency={c} /> : `No ${prevLabel} data to compare`}
          help="Purchases, bank fees and interest, minus refunds. Card payments and transfers between your accounts are not counted." />
        <Stat label="Money received" value={formatMoney(s.incomeCents, c)} tone="good" href={txnLink({}, { ...pf, kind: "income" })} hint={p.incomeCents ? <Delta pct={pctChange(s.incomeCents, p.incomeCents)} cents={s.incomeCents - p.incomeCents} currency={c} goodWhenDown={false} /> : `No ${prevLabel} data to compare`} />
        <Stat label="Left over" value={formatMoney(s.netCashFlowCents, c)} tone={s.netCashFlowCents >= 0 ? "good" : "bad"} href={txnLink({}, { month })} hint="Money received minus money spent" help="Also called net cash flow." />
        {yearly
          ? <Stat label={`vs. ${prevLabel}`} value={p.spendingCents ? formatMoney(s.spendingCents - p.spendingCents, c, { signed: true }) : "—"} tone={p.spendingCents && s.spendingCents > p.spendingCents ? "warn" : "neutral"}
              hint={p.spendingCents ? `Spent in ${prevLabel}: ${formatMoney(p.spendingCents, c)}` : `No ${prevLabel} data yet`} href="/reports/analysis" />
          : <Stat label="vs. 3-month average" value={avgPrior === null ? "—" : formatMoney(s.spendingCents - avgPrior, c, { signed: true })} tone={avgPrior !== null && s.spendingCents > avgPrior ? "warn" : "neutral"}
              hint={avgPrior === null ? "Needs 3 earlier months" : `Average spent: ${formatMoney(avgPrior, c)}`} href="/reports" />}
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Purchases" value={s.purchaseCount} href={txnLink({}, { ...pf, kind: "PURCHASE" })} hint={`Avg ${formatMoney(s.averagePurchaseCents, c)}`} />
        <Stat label="Suppliers" value={s.merchantCount} href={`/spending?view=suppliers&${pq}`} />
        <Stat label="Accounts used" value={s.accountCount} href="/accounts" />
        <Stat label="Regular charges" value={formatMoney(yearly ? recurring.reduce((a, r) => a + r.typicalCents, 0) : recurringTotal, c)} hint={yearly ? `Per month · ${recurring.length} subscriptions & bills` : `${recurringThisMonth.length} subscriptions & bills`} href={yearly ? "/reports/analysis" : `/reports?month=${month}#recurring`} />
        <Stat label="Refunds" value={formatMoney(s.refundsCents, c)} href={txnLink({}, { ...pf, kind: "REFUND" })} />
        <Stat label="To review" value={review} tone={review ? "warn" : "good"} href="/review" hint={review ? "Items need a quick look" : "All clear"} />
      </div>

      {split.length > 0 && (
        <Card className="mb-6" padded={false} title={scope.scope.type === "all" && scope.companies.length > 1 ? `Each company and building in ${mLabel}` : `Each building in ${mLabel}`}
          subtitle="Kept separate so buildings never get mixed. Click one to see only its numbers; choose “All” at the top to come back.">
          <ScopeBreakdown rows={split} currency={c} href={yearly ? `/?view=year&year=${month}` : `/?month=${month}`} />
        </Card>
      )}

      <div className="mb-6 grid gap-6 xl:grid-cols-5">
        <Card title={yearly ? `${label}, month by month` : "Spending over time"} subtitle={yearly ? "Click a month to open it." : `${series.length === 12 ? "Last 12 months" : `Since ${monthLabel(firstDataMonth)}, your first imported statement`}. Click a month to see its transactions.`} className="xl:col-span-3">
          <TrendChart data={series.map((x, i) => ({ label: monthLabel(x.month, "short"), spending: x.spendingCents, income: x.incomeCents, average: avg3[i], href: `/?month=${x.month}` }))} />
        </Card>
        <Card title={`Where the money went in ${mLabel}`} subtitle={cats[0] ? `Biggest: ${cats[0].label} (${formatMoney(cats[0].spendCents, c)})` : undefined} className="xl:col-span-2">
          {cats.length ? <DonutChart data={cats.map((g) => ({ label: g.label, value: g.spendCents, href: catHref(g.key) }))} currency={c} /> : <p className="text-sm text-slate-500">No spending this month.</p>}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Top suppliers" subtitle={merchants[0] ? `Largest: ${merchants[0].label}` : undefined} action={<Link href={`/spending?view=suppliers&${pq}`} className="link text-sm">All suppliers</Link>}>
          {merchants.length ? <BarList currency={c} items={merchants.slice(0, 8).map((m) => ({ label: m.label, value: m.spendCents, sub: `${m.count} purchase${m.count === 1 ? "" : "s"}`, href: merchantHref(m.key, m.label) }))} /> : <p className="text-sm text-slate-500">No purchases this month.</p>}
        </Card>
        <Card title="Money that isn't spending" subtitle="These move money between your own accounts or pay down debt. They're excluded from spending so nothing is counted twice.">
          <dl className="divide-y divide-slate-100 text-sm">
            {[
              ["Credit card payments", s.movementCents.cardPayments, "CARD_PAYMENT"],
              ["Transfers between my accounts", s.movementCents.transfers, "TRANSFER"],
              ["Loan and mortgage payments", s.movementCents.loanPayments, "LOAN_PAYMENT"],
            ].map(([label, v, k]) => (
              <Link key={k as string} href={txnLink({}, { ...pf, kind: k as string })} className="flex items-center justify-between py-3 hover:text-brand-700">
                <dt className="text-slate-600">{label}</dt><dd className="num font-semibold">{formatMoney(v as number, c)}</dd>
              </Link>
            ))}
          </dl>
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500"><Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" />Loan payments may include interest. An accountant can split the interest out in Accountant View.</p>
        </Card>
      </div>
    </>
  );
}
