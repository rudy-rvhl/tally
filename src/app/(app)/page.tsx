import Link from "next/link";
import { Upload, Landmark, Sparkles } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readFilters, txnLink } from "@/lib/filters";
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
              : "Tell us which account the statement is for. Then import a statement file from your bank, and LedgerIQ sorts everything out."}
            action={accountCount ? <Link href="/import" className="btn-primary"><Upload className="h-4 w-4" /> Import a statement</Link>
              : <Link href="/accounts/new?next=import" className="btn-primary"><Landmark className="h-4 w-4" /> Add an account</Link>}
          />
        </Card>
      </>
    );
  }
  const latest = await latestMonth(user.id);
  const month = sp.month ?? latest;
  const prev = addMonths(month, -1);
  const months = lastNMonths(month, 12);
  const yearStart = `${month.slice(0, 4)}-01-01`;
  const [cur, last, hist, review, cov, scope] = await Promise.all([
    loadAnalytic(user, { month }),
    loadAnalytic(user, { month: prev }),
    loadAnalytic(user, { from: isoDate(monthRange(months[0]).start), to: isoDate(monthRange(month).end) }),
    prisma.reviewItem.count({ where: { userId: user.id, status: "OPEN" } }),
    accountCoverage(user.id, [month]),
    resolveScope(user.id),
  ]);
  const inScope = await accountIdsInScope(user.id, scope);
  const split = breakdown(scope, cur.txns);
  const c = user.baseCurrency;
  const s = summarize(cur.txns), p = summarize(last.txns);
  // Start the chart at the first month with data, so it isn't mostly empty.
  const firstDataMonth = hist.txns.length ? monthKey(hist.txns[0].date) : month;
  const series = monthlySeries(hist.txns, months).filter((p) => p.month >= firstDataMonth);
  const avg3 = rollingAverage(series.map((x) => x.spendingCents), 3);
  void yearStart;
  const prior3 = series.slice(-4, -1).map((x) => x.spendingCents);
  const avgPrior = prior3.length === 3 ? Math.round(prior3.reduce((a, b) => a + b, 0) / 3) : null;
  const cats = groupSpending(cur.txns, byCategory);
  const merchants = groupSpending(cur.txns, byMerchant);
  const recurring = detectRecurring(hist.txns);
  const recurringThisMonth = recurring.filter((r) => r.lastDate >= monthRange(month).start && r.lastDate <= monthRange(month).end);
  const recurringTotal = recurringThisMonth.reduce((a, r) => a + r.lastCents, 0);
  const anomalies = detectAnomalies(hist.txns.filter((t) => t.date < monthRange(month).start), cur.txns);
  const insights = [...explainMonth(cur.txns, last.txns, month, prev, c), ...recurringInsights(recurringThisMonth, c), ...anomalyInsights(anomalies, c)];
  const gaps = cov.filter((a) => (!inScope || inScope.has(a.accountId)) && (a.cells[0].status === "MISSING" || a.cells[0].status === "PARTIAL"));
  const catIds = await prisma.category.findMany({ where: { userId: user.id, parentId: null }, select: { id: true, name: true } });
  const catHref = (name: string) => txnLink({}, { month, kind: "spending", category: catIds.find((x) => x.name === name)?.id });
  const merchantHref = (key: string, label: string) => key.startsWith("name:") ? txnLink({}, { month, q: label }) : `/spending/suppliers/${key}?month=${month}`;
  const mLabel = monthLabel(month).split(" ")[0];

  return (
    <>
      <PageHeader title={scope.multi ? scope.label : "Overview"} subtitle={scope.multi ? `Overview · ${monthLabel(month)}${scope.building ? ` · ${scope.company!.name}` : ""}` : `How your business did in ${monthLabel(month)}`} actions={<MonthPicker month={month} basePath="/" latest={latest} />} />

      <div className="mb-6"><AskBar size="lg" suggestions={EXAMPLE_QUESTIONS.slice(0, 4)} /></div>

      {gaps.length > 0 && (
        <div className="mb-4">
          <Notice tone="amber" action={<Link href="/accounts" className="btn-secondary btn-sm">See statement coverage</Link>}>
            <strong>{mLabel} may be incomplete.</strong>{" "}
            {gaps.map((g) => `${g.name} ${g.cells[0].status === "MISSING" ? "has no statement" : `only covers ${g.cells[0].coveredDays} of ${g.cells[0].daysInMonth} days`}`).join("; ")} for this month. Totals below only include what's been imported.
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
        <Stat label="Money spent" value={formatMoney(s.spendingCents, c)} href={txnLink({}, { month, kind: "spending" })}
          hint={<Delta pct={pctChange(s.spendingCents, p.spendingCents)} cents={s.spendingCents - p.spendingCents} currency={c} />}
          help="Purchases, bank fees and interest, minus refunds. Card payments and transfers between your accounts are not counted." />
        <Stat label="Money received" value={formatMoney(s.incomeCents, c)} tone="good" href={txnLink({}, { month, kind: "income" })} hint={<Delta pct={pctChange(s.incomeCents, p.incomeCents)} cents={s.incomeCents - p.incomeCents} currency={c} goodWhenDown={false} />} />
        <Stat label="Left over" value={formatMoney(s.netCashFlowCents, c)} tone={s.netCashFlowCents >= 0 ? "good" : "bad"} href={txnLink({}, { month })} hint="Money received minus money spent" help="Also called net cash flow." />
        <Stat label="vs. 3-month average" value={avgPrior === null ? "—" : formatMoney(s.spendingCents - avgPrior, c, { signed: true })} tone={avgPrior !== null && s.spendingCents > avgPrior ? "warn" : "neutral"}
          hint={avgPrior === null ? "Needs 3 earlier months" : `Average spent: ${formatMoney(avgPrior, c)}`} href="/reports" />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Purchases" value={s.purchaseCount} href={txnLink({}, { month, kind: "PURCHASE" })} hint={`Avg ${formatMoney(s.averagePurchaseCents, c)}`} />
        <Stat label="Suppliers" value={s.merchantCount} href={`/spending?view=suppliers&month=${month}`} />
        <Stat label="Accounts used" value={s.accountCount} href="/accounts" />
        <Stat label="Regular charges" value={formatMoney(recurringTotal, c)} hint={`${recurringThisMonth.length} subscriptions & bills`} href={`/reports?month=${month}#recurring`} />
        <Stat label="Refunds" value={formatMoney(s.refundsCents, c)} href={txnLink({}, { month, kind: "REFUND" })} />
        <Stat label="To review" value={review} tone={review ? "warn" : "good"} href="/review" hint={review ? "Items need a quick look" : "All clear"} />
      </div>

      {split.length > 0 && (
        <Card className="mb-6" padded={false} title={scope.scope.type === "all" && scope.companies.length > 1 ? `Each company and building in ${mLabel}` : `Each building in ${mLabel}`}
          subtitle="Kept separate so buildings never get mixed. Click one to see only its numbers; choose “All” at the top to come back.">
          <ScopeBreakdown rows={split} currency={c} href={`/?month=${month}`} />
        </Card>
      )}

      <div className="mb-6 grid gap-6 xl:grid-cols-5">
        <Card title="Spending over time" subtitle={`${series.length === 12 ? "Last 12 months" : `Since ${monthLabel(firstDataMonth)}, your first imported statement`}. Click a month to see its transactions.`} className="xl:col-span-3">
          <TrendChart data={series.map((x, i) => ({ label: monthLabel(x.month, "short"), spending: x.spendingCents, income: x.incomeCents, average: avg3[i], href: `/?month=${x.month}` }))} />
        </Card>
        <Card title={`Where the money went in ${mLabel}`} subtitle={cats[0] ? `Biggest: ${cats[0].label} (${formatMoney(cats[0].spendCents, c)})` : undefined} className="xl:col-span-2">
          {cats.length ? <DonutChart data={cats.map((g) => ({ label: g.label, value: g.spendCents, href: catHref(g.key) }))} currency={c} /> : <p className="text-sm text-slate-500">No spending this month.</p>}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Top suppliers" subtitle={merchants[0] ? `Largest: ${merchants[0].label}` : undefined} action={<Link href={`/spending?view=suppliers&month=${month}`} className="link text-sm">All suppliers</Link>}>
          {merchants.length ? <BarList currency={c} items={merchants.slice(0, 8).map((m) => ({ label: m.label, value: m.spendCents, sub: `${m.count} purchase${m.count === 1 ? "" : "s"}`, href: merchantHref(m.key, m.label) }))} /> : <p className="text-sm text-slate-500">No purchases this month.</p>}
        </Card>
        <Card title="Money that isn't spending" subtitle="These move money between your own accounts or pay down debt. They're excluded from spending so nothing is counted twice.">
          <dl className="divide-y divide-slate-100 text-sm">
            {[
              ["Credit card payments", s.movementCents.cardPayments, "CARD_PAYMENT"],
              ["Transfers between my accounts", s.movementCents.transfers, "TRANSFER"],
              ["Loan and mortgage payments", s.movementCents.loanPayments, "LOAN_PAYMENT"],
            ].map(([label, v, k]) => (
              <Link key={k as string} href={txnLink({}, { month, kind: k as string })} className="flex items-center justify-between py-3 hover:text-brand-700">
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
