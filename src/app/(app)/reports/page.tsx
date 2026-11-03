import Link from "next/link";
import clsx from "clsx";
import { Download } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readFilters, txnLink } from "@/lib/filters";
import { latestMonth, loadAnalytic } from "@/lib/services/query";
import { accountCoverage, lastNMonths } from "@/lib/services/options";
import { byCategory, byMerchant, compareGroups, detectAnomalies, detectRecurring, groupSpending, monthlySeries, rollingAverage, spendOf, summarize } from "@/lib/engine/analytics";
import { explainMonth } from "@/lib/engine/insights";
import { addMonths, formatDate, isoDate, monthKey, monthLabel, monthRange } from "@/lib/engine/dates";
import { formatMoney, formatPct } from "@/lib/engine/money";
import { BarList, Card, Notice, PageHeader } from "@/components/ui";
import { MonthPicker } from "@/components/MonthPicker";
import { InsightList } from "@/components/InsightList";
import { IncomeVsSpending, MultiLine, StackedBars, TrendChart } from "@/components/charts";
import { PrintButton } from "@/components/PrintButton";
import { BankBookExport } from "@/components/BankBookExport";

export const metadata = { title: "Reports" };

const PERIODS = [{ id: "3", label: "3 months" }, { id: "6", label: "6 months" }, { id: "12", label: "12 months" }, { id: "ytd", label: "This year" }];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const raw = await searchParams;
  const f = readFilters(raw);
  const c = user.baseCurrency;
  const latest = await latestMonth(user.id);
  const month = f.month ?? latest;
  const prev = addMonths(month, -1);
  const period = PERIODS.find((p) => p.id === raw.period)?.id ?? "12";
  const n = period === "ytd" ? Number(month.slice(5)) : Number(period);
  const firstData = await prisma.transaction.findFirst({ where: { userId: user.id, excluded: false }, orderBy: { date: "asc" }, select: { date: true } });
  const firstMonth = firstData ? monthKey(firstData.date) : month;
  // Don't plot months before the first imported statement.
  const months = lastNMonths(month, n).filter((m) => m >= firstMonth);
  const longMonths = lastNMonths(month, 24);
  const [cur, last, hist, reviewCount, cov, accounts, cats] = await Promise.all([
    loadAnalytic(user, { month }),
    loadAnalytic(user, { month: prev }),
    loadAnalytic(user, { from: isoDate(monthRange(longMonths[0]).start), to: isoDate(monthRange(month).end) }),
    prisma.reviewItem.count({ where: { userId: user.id, status: "OPEN" } }),
    accountCoverage(user.id, [month]),
    prisma.account.findMany({ where: { userId: user.id }, select: { id: true, name: true } }),
    prisma.category.findMany({ where: { userId: user.id, parentId: null }, select: { id: true, name: true } }),
  ]);
  const s = summarize(cur.txns);
  const insights = explainMonth(cur.txns, last.txns, month, prev, c);
  const catChanges = compareGroups(groupSpending(cur.txns, byCategory), groupSpending(last.txns, byCategory));
  const merchants = groupSpending(cur.txns, byMerchant);
  const categories = groupSpending(cur.txns, byCategory);
  const anomalies = detectAnomalies(hist.txns.filter((t) => t.date < monthRange(month).start), cur.txns);
  const recurring = detectRecurring(hist.txns).filter((r) => monthKey(r.lastDate) === month);
  const incomeBySource = groupSpending(cur.txns.filter((t) => t.kind === "INCOME").map((t) => ({ ...t, kind: "PURCHASE" as const, amountCents: -t.amountCents })), byMerchant);
  const catHref = (name: string, m = month) => txnLink({}, { month: m, kind: "spending", category: cats.find((x) => x.name === name)?.id });
  const mHref = (key: string, label: string) => (key.startsWith("name:") ? txnLink({}, { month, q: label }) : `/spending/suppliers/${key}?month=${month}`);
  const gaps = cov.filter((a) => a.cells[0].status === "MISSING" || a.cells[0].status === "PARTIAL");
  // Fiscal years for the bank book export, from the user's fiscal year start month.
  const fyStartOf = (m: string) => { const [y, mo] = m.split("-").map(Number); const sy = mo >= user.fiscalYearStartMonth ? y : y - 1; return `${sy}-${String(user.fiscalYearStartMonth).padStart(2, "0")}`; };
  const firstAll = await prisma.transaction.findFirst({ where: { userId: user.id }, orderBy: { date: "asc" }, select: { date: true } });
  const fyYears: { start: string; label: string }[] = [];
  for (let s = fyStartOf(latest); fyYears.length < 6; s = addMonths(s, -12)) {
    const [y, mo] = s.split("-").map(Number);
    fyYears.push({ start: s, label: mo === 1 ? String(y) : `${y}-${y + 1} (${monthLabel(s, "short")} – ${monthLabel(addMonths(s, 11), "short")})` });
    if (!firstAll || s <= monthKey(firstAll.date)) break;
  }
  const missingNumbers = accounts.length ? await prisma.account.count({ where: { userId: user.id, bookNumber: null } }) : 0;
  const needsSetup = [
    ...(!user.companyName ? ["add your company name"] : []),
    ...(user.fiscalYearStartMonth === 1 ? ["set your fiscal year start if it isn't January"] : []),
    ...(missingNumbers ? [`add the account number to show for ${missingNumbers} account${missingNumbers === 1 ? "" : "s"}`] : []),
  ];

  // Trends
  const series = monthlySeries(hist.txns, months);
  const avg = rollingAverage(monthlySeries(hist.txns, longMonths).map((p) => p.spendingCents), 3).slice(-months.length);
  const topCats = groupSpending(hist.txns.filter((t) => months.includes(monthKey(t.date))), byCategory).slice(0, 5);
  const topMerchants = groupSpending(hist.txns.filter((t) => months.includes(monthKey(t.date))), byMerchant).slice(0, 5);
  const allRecurring = detectRecurring(hist.txns);
  const recurringKeys = new Set(allRecurring.map((r) => r.merchantKey));
  const yoy = months.map((m) => {
    const ly = addMonths(m, -12);
    const thisY = hist.txns.filter((t) => monthKey(t.date) === m).reduce((a, t) => a + spendOf(t), 0);
    const lastY = hist.txns.filter((t) => monthKey(t.date) === ly).reduce((a, t) => a + spendOf(t), 0);
    return { label: monthLabel(m, "short"), current: thisY, lastYear: hist.txns.some((t) => monthKey(t.date) === ly) ? lastY : null, href: txnLink({}, { month: m, kind: "spending" }) };
  });
  const hasLastYear = hist.txns.some((t) => monthKey(t.date) <= addMonths(months[0], -1));

  return (
    <>
      <PageHeader title="Reports" subtitle="An automatic monthly summary, plus trends over time." actions={<>
        <MonthPicker month={month} basePath="/reports" extra={raw.period ? `&period=${raw.period}` : ""} latest={latest} />
        <a className="btn-secondary print:hidden" href={`/api/export?month=${month}`}><Download className="h-4 w-4" /> Export {monthLabel(month, "short")}</a>
        <PrintButton />
      </>} />

      <div className="mb-6 print:hidden"><BankBookExport years={fyYears} defaultStart={fyYears[0]?.start ?? fyStartOf(latest)} needsSetup={needsSetup} /></div>

      {gaps.length > 0 && <div className="mb-4"><Notice tone="amber">This month may be incomplete: {gaps.map((g) => g.name).join(", ")} {gaps.length === 1 ? "doesn't" : "don't"} have a full statement for {monthLabel(month)}. Compare it with other months with care.</Notice></div>}

      <h2 className="mb-3 text-xl font-bold">{monthLabel(month)} summary</h2>
      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card title="Money received" action={<span className="num text-xl font-bold text-emerald-700">{formatMoney(s.incomeCents, c)}</span>}>
          {incomeBySource.length ? <BarList currency={c} items={incomeBySource.slice(0, 5).map((g) => ({ label: g.label, value: g.spendCents, href: txnLink({}, { month, kind: "income", q: g.label }) }))} /> : <p className="text-sm text-slate-500">No money received this month.</p>}
        </Card>
        <Card title="Money spent" subtitle="Operating expenses: purchases, fees and interest, minus refunds." action={<span className="num text-xl font-bold">{formatMoney(s.spendingCents, c)}</span>}>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-600">{s.purchaseCount} purchases</dt><dd className="num">{formatMoney(s.spendingCents + s.refundsCents - s.feesAndInterestCents, c)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">Bank fees and interest</dt><dd className="num">{formatMoney(s.feesAndInterestCents, c)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">Refunds</dt><dd className="num text-emerald-700">−{formatMoney(s.refundsCents, c)}</dd></div>
            <div className="flex justify-between border-t border-slate-100 pt-2 font-semibold"><dt>Left over after spending</dt><dd className={clsx("num", s.netCashFlowCents < 0 && "text-red-700")}>{formatMoney(s.netCashFlowCents, c)}</dd></div>
          </dl>
        </Card>
        <Card title="Not counted as spending" subtitle="Money moving between your accounts or paying down debt.">
          <dl className="space-y-2 text-sm">
            <Link href={txnLink({}, { month, kind: "CARD_PAYMENT" })} className="flex justify-between hover:text-brand-700"><dt className="text-slate-600">Credit card payments</dt><dd className="num">{formatMoney(s.movementCents.cardPayments, c)}</dd></Link>
            <Link href={txnLink({}, { month, kind: "TRANSFER" })} className="flex justify-between hover:text-brand-700"><dt className="text-slate-600">Transfers</dt><dd className="num">{formatMoney(s.movementCents.transfers, c)}</dd></Link>
            <Link href={txnLink({}, { month, kind: "LOAN_PAYMENT" })} className="flex justify-between hover:text-brand-700"><dt className="text-slate-600">Loan repayments</dt><dd className="num">{formatMoney(s.movementCents.loanPayments, c)}</dd></Link>
          </dl>
        </Card>
      </div>

      <Card title="What changed from last month?" className="mb-6"><InsightList insights={insights} /></Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="Largest suppliers"><BarList currency={c} items={merchants.slice(0, 8).map((m) => ({ label: m.label, value: m.spendCents, sub: `${Math.round(m.share * 100)}%`, href: mHref(m.key, m.label) }))} /></Card>
        <Card title="Largest expense categories"><BarList currency={c} items={categories.slice(0, 8).map((m) => ({ label: m.label, value: m.spendCents, sub: `${Math.round(m.share * 100)}%`, href: catHref(m.key) }))} /></Card>
      </div>

      <Card title={`Category changes: ${monthLabel(month, "short")} vs ${monthLabel(prev, "short")}`} subtitle="Click any amount to see the transactions behind it." padded={false} className="mb-6">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-100"><tr><th className="th">Category</th><th className="th text-right">{monthLabel(prev, "short")}</th><th className="th text-right">{monthLabel(month, "short")}</th><th className="th text-right">Change</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {catChanges.map((r) => (
                <tr key={r.key} className="hover:bg-slate-50">
                  <td className="td font-medium">{r.label}</td>
                  <td className="td text-right num"><Link className="hover:underline" href={catHref(r.key, prev)}>{formatMoney(r.previousCents, c)}</Link></td>
                  <td className="td text-right num font-semibold"><Link className="hover:underline" href={catHref(r.key)}>{formatMoney(r.currentCents, c)}</Link></td>
                  <td className={clsx("td text-right num", r.changeCents > 0 ? "text-red-700" : r.changeCents < 0 ? "text-emerald-700" : "text-slate-500")}>{formatMoney(r.changeCents, c, { signed: true })} <span className="text-xs">({formatPct(r.changePct)})</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mb-10 grid gap-6 lg:grid-cols-3">
        <Card title="Unusual transactions" subtitle="Much larger than usual for that supplier.">
          {anomalies.length ? <ul className="space-y-1 text-sm">{anomalies.slice(0, 6).map((a) => {
            const t = cur.txns.find((x) => x.id === a.id)!;
            return <li key={a.id}><Link href={`/transactions/${a.id}`} className="flex justify-between gap-3 rounded-lg p-1.5 hover:bg-slate-50"><span><span className="font-medium">{t.merchant}</span> <span className="text-xs text-slate-500">{formatDate(t.date)} · {a.reason}</span></span><span className="num font-semibold">{formatMoney(a.amountCents, c)}</span></Link></li>;
          })}</ul> : <p className="text-sm text-slate-500">Nothing unusual this month.</p>}
        </Card>
        <Card title="Regular charges" subtitle="Subscriptions and bills that repeat every month.">
          <div id="recurring" />
          {recurring.length ? <ul className="space-y-1 text-sm">{recurring.map((r) => (
            <li key={r.merchantKey}><Link href={r.merchantKey.startsWith("name:") ? txnLink({}, { q: r.merchant }) : `/spending/suppliers/${r.merchantKey}`} className="flex justify-between gap-3 rounded-lg p-1.5 hover:bg-slate-50">
              <span className="font-medium">{r.merchant}{r.priceChangeCents > 0 && (r.priceChangePct ?? 0) >= 2 && <span className="ml-1 text-xs text-red-700">price up {formatPct(r.priceChangePct)}</span>}</span><span className="num">{formatMoney(r.lastCents, c)}</span>
            </Link></li>))}</ul> : <p className="text-sm text-slate-500">Regular charges appear once you have three months of statements.</p>}
        </Card>
        <Card title="Items to review">
          <p className="text-3xl font-bold num">{reviewCount}</p>
          <p className="mt-1 text-sm text-slate-500">{reviewCount ? "Resolving these makes your totals more accurate." : "Nothing waiting."}</p>
          {reviewCount > 0 && <Link className="btn-secondary btn-sm mt-3" href="/review">Review now</Link>}
        </Card>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Trends</h2>
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1 print:hidden">
          {PERIODS.map((p) => <Link key={p.id} href={`/reports?month=${month}&period=${p.id}`} className={clsx("rounded-lg px-3 py-1.5 text-sm font-medium", period === p.id ? "bg-white shadow-sm" : "text-slate-600")}>{p.label}</Link>)}
        </div>
      </div>
      {months.length < n && <div className="mb-4"><Notice tone="blue">Your statements start in {monthLabel(firstMonth)}, so this shows {months.length} month{months.length === 1 ? "" : "s"}. Import older statements to see longer trends.</Notice></div>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Monthly spending" subtitle="With the 3-month rolling average.">
          <TrendChart showIncome={false} data={series.map((p, i) => ({ label: monthLabel(p.month, "short"), spending: p.spendingCents, average: avg[i], href: `/reports?month=${p.month}&period=${period}` }))} />
        </Card>
        <Card title="Money received vs. money spent">
          <IncomeVsSpending data={series.map((p) => ({ label: monthLabel(p.month, "short"), spending: p.spendingCents, income: p.incomeCents, href: txnLink({}, { month: p.month, kind: "spending" }) }))} />
        </Card>
        <Card title="Top categories over time">
          <MultiLine data={months.map((m) => ({ label: monthLabel(m, "short"), href: txnLink({}, { month: m, kind: "spending" }), ...Object.fromEntries(topCats.map((tc) => [tc.key, hist.txns.filter((t) => monthKey(t.date) === m && (t.category ?? "Uncategorized") === tc.key).reduce((a, t) => a + spendOf(t), 0)])) }))}
            series={topCats.map((tc) => ({ key: tc.key, label: tc.label }))} />
        </Card>
        <Card title="Top suppliers over time">
          <MultiLine data={months.map((m) => ({ label: monthLabel(m, "short"), href: txnLink({}, { month: m, kind: "spending" }), ...Object.fromEntries(topMerchants.map((tm) => [tm.key, hist.txns.filter((t) => monthKey(t.date) === m && byMerchant(t).key === tm.key).reduce((a, t) => a + spendOf(t), 0)])) }))}
            series={topMerchants.map((tm) => ({ key: tm.key, label: tm.label }))} />
        </Card>
        <Card title="Regular vs. one-off spending" subtitle="Regular = suppliers that charge you every month.">
          <StackedBars hrefTemplate={txnLink({}, { month: "MONTH", kind: "spending" })}
            data={months.map((m) => {
              const inM = hist.txns.filter((t) => monthKey(t.date) === m);
              const reg = inM.filter((t) => recurringKeys.has(byMerchant(t).key)).reduce((a, t) => a + spendOf(t), 0);
              return { label: monthLabel(m, "short"), month: m, regular: reg, variable: inM.reduce((a, t) => a + spendOf(t), 0) - reg };
            })}
            series={[{ key: "regular", label: "Regular charges" }, { key: "variable", label: "One-off purchases" }]} />
        </Card>
        <Card title="Spending by account">
          <StackedBars hrefTemplate={txnLink({}, { month: "MONTH", account: "SERIES", kind: "spending" })}
            data={months.map((m) => ({ label: monthLabel(m, "short"), month: m, ...Object.fromEntries(accounts.map((a) => [a.id, hist.txns.filter((t) => monthKey(t.date) === m && t.accountId === a.id).reduce((s2, t) => s2 + spendOf(t), 0)])) }))}
            series={accounts.filter((a) => hist.txns.some((t) => t.accountId === a.id)).map((a) => ({ key: a.id, label: a.name }))} />
        </Card>
        <Card title="Year over year" subtitle={hasLastYear ? "Each month compared with the same month last year." : "Year-over-year comparison appears once you've imported last year's statements."} className="lg:col-span-2">
          <MultiLine data={yoy} series={[{ key: "current", label: "This period" }, { key: "lastYear", label: "Same month a year earlier" }]} />
        </Card>
      </div>
    </>
  );
}
