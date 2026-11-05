import Link from "next/link";
import clsx from "clsx";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readFilters, toQuery, txnLink, type Filters } from "@/lib/filters";
import { latestMonth, loadAnalytic } from "@/lib/services/query";
import { filterOptions, lastNMonths } from "@/lib/services/options";
import { byCategory, byMerchant, bySubcategory, compareGroups, detectRecurring, groupSpending, monthlySeries, spendOf } from "@/lib/engine/analytics";
import { addMonths, isoDate, monthKey, monthLabel, monthRange } from "@/lib/engine/dates";
import { formatMoney, formatPct, median } from "@/lib/engine/money";
import { BarList, Card, EmptyState, PageHeader } from "@/components/ui";
import { FilterBar } from "@/components/FilterBar";
import { StackedBars } from "@/components/charts";
import type { AnalyticTxn } from "@/lib/engine/types";
import { ScopeBreakdown } from "@/components/ScopeBreakdown";
import { breakdown, resolveScope } from "@/lib/scope";

export const metadata = { title: "Spending" };

const VIEWS = [
  { id: "suppliers", label: "By supplier" },
  { id: "categories", label: "By category" },
  { id: "accounts", label: "By account" },
  { id: "months", label: "By month" },
  { id: "buildings", label: "By building" },
] as const;

const RANKS = [
  { id: "total", label: "Most spent" }, { id: "frequency", label: "Most purchases" }, { id: "increase", label: "Biggest increase" },
  { id: "decrease", label: "Biggest decrease" }, { id: "average", label: "Largest average purchase" }, { id: "recurring", label: "Regular charges" },
] as const;

export default async function SpendingPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const raw = await searchParams;
  const f = readFilters(raw);
  let view = (VIEWS.find((v) => v.id === raw.view)?.id ?? "suppliers") as (typeof VIEWS)[number]["id"];
  const rank = (RANKS.find((r) => r.id === raw.rank)?.id ?? "total") as (typeof RANKS)[number]["id"];
  const c = user.baseCurrency;
  const options = await filterOptions(user, { show: ["month", "account", "category", "ownership", "institution", "currency"] });
  const scope: Filters = { ...f, kind: "spending" };
  const [{ txns }, where] = await Promise.all([loadAnalytic(user, scope), resolveScope(user.id)]);
  const split = breakdown(where, txns);
  const views = VIEWS.filter((v) => v.id !== "buildings" || split.length > 0);
  const total = txns.reduce((a, t) => a + spendOf(t), 0);
  const viewQs = (v: string, extra: Record<string, string | undefined> = {}) => {
    const p = new URLSearchParams(toQuery(f).slice(1));
    p.set("view", v);
    for (const [k, val] of Object.entries(extra)) { if (val) p.set(k, val); else p.delete(k); }
    return `/spending?${p}`;
  };
  if (view === "buildings" && !split.length) view = "suppliers";
  const periodLabel = f.month ? monthLabel(f.month) : f.from || f.to ? `${f.from ?? "start"} to ${f.to ?? "today"}` : "all time";

  return (
    <>
      <PageHeader title={where.multi ? `Spending · ${where.label}` : "Spending"} subtitle={<>You spent <strong className="text-slate-900">{formatMoney(total, c)}</strong> {f.month ? "in" : ""} {periodLabel}. Click anything to see the purchases behind it.</>} />
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1" role="tablist">
        {views.map((v) => (
          <Link key={v.id} role="tab" aria-selected={view === v.id} href={viewQs(v.id, { rank: undefined })}
            className={clsx("whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold", view === v.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900")}>{v.label}</Link>
        ))}
      </div>
      <FilterBar options={options} />
      {!txns.length ? (
        <Card><EmptyState title="No spending found" body="Try a different period or clear the filters." action={<Link className="btn-secondary" href={`/spending?view=${view}`}>Clear filters</Link>} /></Card>
      ) : view === "suppliers" ? (
        <Suppliers user={user} f={f} txns={txns} rank={rank} viewQs={viewQs} currency={c} />
      ) : view === "categories" ? (
        <Categories userId={user.id} f={f} txns={txns} currency={c} />
      ) : view === "buildings" ? (
        <Card padded={false} title={where.scope.type === "all" && where.companies.length > 1 ? "Spending by company and building" : "Spending by building"} subtitle="Click one to see only its spending.">
          <ScopeBreakdown rows={split} currency={c} href={viewQs("suppliers")} mode="spending" />
        </Card>
      ) : view === "accounts" ? (
        <Accounts userId={user.id} f={f} txns={txns} currency={c} />
      ) : (
        <Months userId={user.id} f={f} txns={txns} currency={c} />
      )}
    </>
  );
}

async function Suppliers({ user, f, txns, rank, viewQs, currency }: { user: { id: string; baseCurrency: string }; f: Filters; txns: AnalyticTxn[]; rank: string; viewQs: (v: string, e?: Record<string, string | undefined>) => string; currency: string }) {
  const groups = groupSpending(txns, byMerchant);
  const month = f.month ?? (await latestMonth(user.id));
  let rows = groups.map((g) => {
    const purchases = txns.filter((t) => t.kind === "PURCHASE" && byMerchant(t).key === g.key).map((t) => -t.amountCents);
    return { ...g, avg: purchases.length ? Math.round(purchases.reduce((a, b) => a + b, 0) / purchases.length) : 0, med: median(purchases), change: 0, changePct: null as number | null };
  });
  let note = "";
  if (rank === "increase" || rank === "decrease") {
    const base: Filters = { ...f, kind: "spending", from: undefined, to: undefined };
    const [cur, prev] = await Promise.all([loadAnalytic(user, { ...base, month }), loadAnalytic(user, { ...base, month: addMonths(month, -1) })]);
    const cmp = compareGroups(groupSpending(cur.txns, byMerchant), groupSpending(prev.txns, byMerchant));
    note = `Comparing ${monthLabel(month)} with ${monthLabel(addMonths(month, -1))}.`;
    rows = cmp.map((r) => ({ key: r.key, label: r.label, spendCents: r.currentCents, count: 0, share: 0, avg: 0, med: 0, change: r.changeCents, changePct: r.changePct }))
      .filter((r) => (rank === "increase" ? r.change > 0 : r.change < 0)).sort((a, b) => (rank === "increase" ? b.change - a.change : a.change - b.change));
  } else if (rank === "frequency") rows.sort((a, b) => b.count - a.count);
  else if (rank === "average") rows.sort((a, b) => b.avg - a.avg);
  else if (rank === "recurring") {
    const rec = detectRecurring(txns);
    const keys = new Map(rec.map((r) => [r.merchantKey, r]));
    rows = rows.filter((r) => keys.has(r.key)).sort((a, b) => (keys.get(b.key)!.typicalCents - keys.get(a.key)!.typicalCents));
    note = rows.length ? "Suppliers that charge you about the same amount every month." : "Regular charges appear after at least three months of statements. Choose \"All time\" to include more history.";
  }
  const href = (key: string, label: string) => (key.startsWith("name:") ? txnLink(f, { q: label, kind: "spending" }) : `/spending/suppliers/${key}${toQuery(f)}`);
  return (
    <Card padded={false} title={`${groups.length} suppliers`} subtitle="Different spellings of the same business on your statements are combined automatically."
      action={<Link href="/settings#suppliers" className="link whitespace-nowrap text-sm">Combine supplier names</Link>}>
      <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-4 py-2">
        {RANKS.map((r) => <Link key={r.id} href={viewQs("suppliers", { rank: r.id })} className={clsx("whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium", rank === r.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>{r.label}</Link>)}
      </div>
      {note && <p className="px-5 pt-3 text-xs text-slate-500">{note}</p>}
      <table className="w-full">
        <thead className="border-b border-slate-100"><tr>
          <th className="th">Supplier</th>
          <th className="th hidden text-right sm:table-cell">{rank === "increase" || rank === "decrease" ? "Change" : "Purchases"}</th>
          <th className="th hidden text-right md:table-cell">{rank === "increase" || rank === "decrease" ? "Change %" : "Average"}</th>
          <th className="th text-right">{rank === "increase" || rank === "decrease" ? monthLabel(month, "short") : "Total spent"}</th>
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.slice(0, 200).map((r) => (
            <tr key={r.key} className="group hover:bg-slate-50">
              <td className="td"><Link href={href(r.key, r.label)} className="block font-medium text-slate-900 group-hover:text-brand-700">{r.label}</Link>
                {r.share > 0 && <div className="mt-1 h-1 w-full max-w-[12rem] rounded-full bg-slate-100"><div className="h-1 rounded-full bg-brand-500" style={{ width: `${Math.max(2, r.share * 100)}%` }} /></div>}
              </td>
              <td className="td hidden text-right num sm:table-cell">{rank === "increase" || rank === "decrease" ? <span className={r.change > 0 ? "text-red-700" : "text-emerald-700"}>{formatMoney(r.change, currency, { signed: true })}</span> : r.count}</td>
              <td className="td hidden text-right num md:table-cell">{rank === "increase" || rank === "decrease" ? formatPct(r.changePct) : formatMoney(r.avg, currency)}</td>
              <td className="td text-right num font-semibold"><Link href={href(r.key, r.label)}>{formatMoney(r.spendCents, currency)}</Link></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={4} className="p-8 text-center text-sm text-slate-500">Nothing to show for this ranking yet.</td></tr>}
        </tbody>
      </table>
    </Card>
  );
}

async function Categories({ userId, f, txns, currency }: { userId: string; f: Filters; txns: AnalyticTxn[]; currency: string }) {
  const parents = groupSpending(txns, byCategory);
  const subs = groupSpending(txns, bySubcategory);
  const cats = await prisma.category.findMany({ where: { userId }, select: { id: true, name: true, parentId: true } });
  const parentId = (name: string) => cats.find((c) => c.name === name && !c.parentId)?.id;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {parents.map((p) => {
        const pid = parentId(p.key);
        const children = subs.filter((s) => {
          const cat = cats.find((c) => c.id === s.key);
          return cat ? (cat.parentId === pid || cat.id === pid) : p.key === "Uncategorized" && s.key === "none";
        });
        return (
          <Card key={p.key} title={<Link href={txnLink(f, { category: pid, kind: "spending" })} className="hover:text-brand-700">{p.label}</Link>}
            subtitle={`${Math.round(p.share * 100)}% of spending · ${p.count} purchases`} action={<span className="num text-lg font-bold">{formatMoney(p.spendCents, currency)}</span>}>
            <BarList currency={currency} max={p.spendCents} items={children.map((s) => ({ label: s.label.split(" › ")[1] ?? `${s.label} (general)`, value: s.spendCents, sub: `${s.count} purchase${s.count === 1 ? "" : "s"}`, href: txnLink(f, { category: s.key === "none" ? undefined : s.key, kind: "spending" }) }))} />
          </Card>
        );
      })}
    </div>
  );
}

async function Accounts({ userId, f, txns, currency }: { userId: string; f: Filters; txns: AnalyticTxn[]; currency: string }) {
  const accounts = await prisma.account.findMany({ where: { userId }, select: { id: true, name: true, institution: true, mask: true } });
  const byAcc = groupSpending(txns, (t) => ({ key: t.accountId, label: accounts.find((a) => a.id === t.accountId)?.name ?? "Account" }));
  const months = [...new Set(txns.map((t) => monthKey(t.date)))].sort().slice(-12);
  const data = months.map((m) => {
    const row: Record<string, number | string> = { label: monthLabel(m, "short"), month: m };
    for (const a of byAcc) row[a.key] = txns.filter((t) => t.accountId === a.key && monthKey(t.date) === m).reduce((s, t) => s + spendOf(t), 0);
    return row;
  });
  return (
    <div className="grid gap-6">
      <Card title="Spending by account, month by month" subtitle="Click a bar to see that account's purchases for that month.">
        <StackedBars data={data} series={byAcc.map((a) => ({ key: a.key, label: a.label }))} hrefTemplate={txnLink({ ...f, from: undefined, to: undefined }, { kind: "spending", month: "MONTH", account: "SERIES" })} />
      </Card>
      <Card title="Totals by account">
        <BarList currency={currency} items={byAcc.map((a) => {
          const acc = accounts.find((x) => x.id === a.key);
          return { label: `${acc?.institution} · ${a.label}${acc?.mask ? ` ··${acc.mask}` : ""}`, value: a.spendCents, sub: `${a.count} purchases`, href: txnLink(f, { account: a.key, kind: "spending" }) };
        })} />
      </Card>
    </div>
  );
}

async function Months({ userId, f, txns, currency }: { userId: string; f: Filters; txns: AnalyticTxn[]; currency: string }) {
  const parentCats = await prisma.category.findMany({ where: { userId, parentId: null }, select: { id: true, name: true } });
  const keys = [...new Set(txns.map((t) => monthKey(t.date)))].sort();
  const months = keys.length ? lastNMonths(keys[keys.length - 1], Math.min(24, Math.max(keys.length, 1))) : [];
  const series = monthlySeries(txns, months);
  const cats = groupSpending(txns, byCategory).slice(0, 8);
  const max = Math.max(1, ...months.flatMap((m) => cats.map((c) => txns.filter((t) => monthKey(t.date) === m && (t.category ?? "Uncategorized") === c.key).reduce((s, t) => s + spendOf(t), 0))));
  return (
    <div className="grid gap-6">
      <Card padded={false} title="Month by month" subtitle="Click a month to open its full summary.">
        <table className="w-full">
          <thead className="border-b border-slate-100"><tr><th className="th">Month</th><th className="th text-right">Spent</th><th className="th hidden text-right sm:table-cell">vs. previous</th><th className="th hidden text-right md:table-cell">Purchases</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {[...series].reverse().map((p, i, arr) => {
              const prev = arr[i + 1];
              const change = prev ? p.spendingCents - prev.spendingCents : null;
              return (
                <tr key={p.month} className="hover:bg-slate-50">
                  <td className="td font-medium"><Link className="hover:text-brand-700" href={`/reports?month=${p.month}`}>{monthLabel(p.month)}</Link></td>
                  <td className="td text-right num font-semibold"><Link href={txnLink(f, { month: p.month, from: undefined, to: undefined, kind: "spending" })}>{formatMoney(p.spendingCents, currency)}</Link></td>
                  <td className={`td hidden text-right num sm:table-cell ${change && change > 0 ? "text-red-700" : "text-emerald-700"}`}>{change === null ? "—" : formatMoney(change, currency, { signed: true })}</td>
                  <td className="td hidden text-right num md:table-cell">{p.count}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <Card title="Spending heatmap" subtitle="Darker means more spending. Click a cell to see those purchases.">
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead><tr><th className="sticky left-0 bg-white pr-3 text-left font-medium text-slate-500">Category</th>{months.slice(-12).map((m) => <th key={m} className="px-1 pb-2 font-medium text-slate-500">{monthLabel(m, "short").split(" ")[0]}</th>)}</tr></thead>
            <tbody>
              {cats.map((c) => (
                <tr key={c.key}>
                  <td className="sticky left-0 whitespace-nowrap bg-white py-0.5 pr-3 font-medium text-slate-700">{c.label}</td>
                  {months.slice(-12).map((m) => {
                    const v = txns.filter((t) => monthKey(t.date) === m && (t.category ?? "Uncategorized") === c.key).reduce((s, t) => s + spendOf(t), 0);
                    const r = monthRange(m);
                    return (
                      <td key={m} className="p-0.5">
                        <Link href={txnLink(f, { from: isoDate(r.start), to: isoDate(r.end), month: undefined, kind: "spending", category: parentCats.find((x) => x.name === c.key)?.id })} title={`${c.label}, ${monthLabel(m)}: ${formatMoney(v, currency)}`}
                          className="block h-8 w-12 rounded-md ring-brand-600 hover:ring-2" style={{ background: v > 0 ? `rgba(37,99,235,${0.08 + 0.85 * (v / max)})` : "#f1f5f9" }}>
                          <span className="sr-only">{formatMoney(v, currency)}</span>
                        </Link>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
