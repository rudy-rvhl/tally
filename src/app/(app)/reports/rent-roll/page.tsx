import Link from "next/link";
import { Plus, Home, Users, KeyRound, ListChecks, FileUp } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { latestMonth } from "@/lib/services/query";
import { loadRentRoll, type TenantRow } from "@/lib/services/rentroll";
import { formatDate, monthLabel } from "@/lib/engine/dates";
import { formatMoney } from "@/lib/engine/money";
import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { ReportsTabs } from "@/components/Nav";
import { MonthPicker } from "@/components/MonthPicker";
import { Findings } from "@/components/Findings";
import { MonthDots, StatusChip, StatusLegend } from "@/components/RentStatus";
import { ActionForm } from "@/components/ActionForm";
import { assignDepositAction } from "@/app/actions";

export const metadata = { title: "Rent roll" };

export default async function RentRollPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const latest = await latestMonth(user.id);
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month : latest;
  const r = await loadRentRoll(user, month);
  const c = user.baseCurrency;
  const k = r.kpi;
  const where = r.scope.multi ? ` · ${r.scope.label}` : "";

  if (!r.rows.length) {
    return (
      <>
        <ReportsTabs />
        <PageHeader title={`Rent roll${where}`} subtitle="Your tenants, what they owe and what they've paid, matched to the money received in your accounts." />
        <Card>
          <EmptyState icon={<Home className="h-6 w-6" />} title="Add your first tenant"
            body={<>Import the rent roll from Stessa or your property software (PDF, CSV or Excel), or enter each tenant: building, unit, rent and lease dates. LedgerIQ then finds their rent in your imported statements every month, by their name on the deposit or the exact rent amount, and tells you who&apos;s late, who owes what and which leases are ending.</>}
            action={<div className="flex flex-wrap justify-center gap-2"><Link className="btn-primary" href="/reports/rent-roll/import"><FileUp className="h-4 w-4" /> Import my rent roll</Link><Link className="btn-secondary" href="/reports/rent-roll/tenants/new"><Plus className="h-4 w-4" /> Add a tenant by hand</Link></div>} />
        </Card>
      </>
    );
  }

  const groups = new Map<string, TenantRow[]>();
  for (const row of r.rows.filter((x) => x.tenant.status === "ACTIVE" || x.tenant.status === "VACANT").sort((a, b) => (a.tenant.unit ?? "").localeCompare(b.tenant.unit ?? "", undefined, { numeric: true }))) groups.set(row.building ?? "No specific building", [...(groups.get(row.building ?? "No specific building") ?? []), row]);
  const past = r.rows.filter((x) => x.tenant.status === "PAST");

  return (
    <>
      <ReportsTabs />
      <PageHeader title={`Rent roll${where}`} subtitle={`Rent due and received in ${monthLabel(month)}, matched to the deposits in your accounts.`}
        actions={<><MonthPicker month={month} basePath="/reports/rent-roll" latest={latest} /><Link className="btn-secondary" href="/reports/rent-roll/import"><FileUp className="h-4 w-4" /> Import a rent roll</Link><Link className="btn-primary" href="/reports/rent-roll/tenants/new"><Plus className="h-4 w-4" /> Add a tenant</Link></>} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Rent due in ${monthLabel(month).split(" ")[0]}`} value={formatMoney(k.dueCents, c)} hint={r.rows.some((x) => x.tenant.status === "ACTIVE" && x.thisMonth?.status === "NO_DATA") ? `Tenants whose rent we track (${r.rows.filter((x) => x.tenant.status === "ACTIVE" && x.thisMonth?.dueCents).length} of ${k.activeTenants})` : `${k.activeTenants} tenant${k.activeTenants === 1 ? "" : "s"}`} />
        <Stat label="Received" value={formatMoney(k.collectedCents, c)} tone="good" hint={k.collectionRate === null ? "Nothing due yet" : `${Math.round(k.collectionRate * 100)}% of rent due`} />
        <Stat label="Still to collect" value={formatMoney(k.outstandingCents, c)} tone={k.outstandingCents ? "warn" : "good"} hint={k.outstandingCents ? "This month" : "Everyone has paid"} />
        {r.reportedBalanceCents > 0
          ? <Stat label="Owed by tenants" value={formatMoney(r.reportedBalanceCents, c)} tone="bad" hint={`Per your rent roll${r.reportedAsOf ? ` of ${formatDate(r.reportedAsOf)}` : ""}`} help="The balance due in the rent roll report you imported. The tenant pages also show what your bank deposits say." />
          : <Stat label="Owed by tenants" value={formatMoney(k.arrearsCents, c)} tone={k.arrearsCents ? "bad" : "good"} hint="From your bank deposits, last 12 months" help="Rent due minus rent received, for the months we have statements for." />}
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Collected over 12 months" value={k.collectionRate12 === null ? "—" : `${Math.round(k.collectionRate12 * 100)}%`} hint="Of the rent that was due" />
        <Stat label="Occupancy" value={`${k.occupied} of ${k.units}`} hint={k.units > k.occupied ? `${k.units - k.occupied} unit${k.units - k.occupied === 1 ? "" : "s"} empty` : "All units rented"} tone={k.units > k.occupied ? "warn" : "good"} />
        <Stat label="Yearly rent" value={formatMoney(k.annualRentCents, c)} hint="Current rents × 12" />
        <Stat label="Deposits held" value={formatMoney(k.depositsHeldCents, c)} />
      </div>

      <Card title={<span className="inline-flex items-center gap-2"><ListChecks className="h-4 w-4" /> Needs your attention</span>} subtitle="What the rent roll shows that's easy to miss. Most important first." className="mb-6">
        <Findings items={r.findings} limit={6} empty="All rent is in and nothing needs attention." />
      </Card>

      {[...groups].map(([building, rows]) => {
        const vacant = rows.filter((x) => x.tenant.status === "VACANT").length;
        const due = rows.reduce((a, x) => a + (x.thisMonth?.dueCents ?? 0), 0);
        const paid = rows.reduce((a, x) => a + (x.thisMonth?.paidCents ?? 0), 0);
        return (
          <Card key={building} padded={false} className="mb-6" title={<span className="inline-flex items-center gap-2"><Home className="h-4 w-4 text-slate-400" /> {building}</span>}
            subtitle={`${rows.length} unit${rows.length === 1 ? "" : "s"}${vacant ? ` (${vacant} empty)` : ""} · ${formatMoney(rows.filter((x) => x.tenant.status === "ACTIVE").reduce((a, x) => a + x.tenant.rentCents, 0), c)}/month`}
            action={<span className="text-sm text-slate-500">{monthLabel(month).split(" ")[0]}: <strong className="num text-slate-900">{formatMoney(paid, c)}</strong> of {formatMoney(due, c)}</span>}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm" data-testid="rent-table">
                <thead className="border-b border-slate-100"><tr>
                  <th className="th w-16">Unit</th><th className="th">Tenant</th><th className="th">Bed / bath</th><th className="th text-right">Rent</th><th className="th">Lease ends</th>
                  <th className="th">{monthLabel(month).split(" ")[0]}</th><th className="th">Last 12 months</th><th className="th text-right">Balance due</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((x) => x.tenant.status === "VACANT" ? (
                    <tr key={x.tenant.id} className="bg-slate-50/60">
                      <td className="td whitespace-nowrap font-medium">{x.tenant.unit?.replace(/^unit\s+/i, "") ?? "—"}</td>
                      <td className="td"><Link className="italic text-slate-500 hover:text-brand-700" href={`/reports/rent-roll/tenants/${x.tenant.id}`}>Vacant</Link></td>
                      <td className="td text-slate-500">{x.tenant.layout ?? ""}</td>
                      <td className="td text-right num text-slate-400">{x.tenant.rentCents ? formatMoney(x.tenant.rentCents, c) : "—"}</td>
                      <td className="td" colSpan={4}><Badge tone="red">Empty unit</Badge></td>
                    </tr>
                  ) : (
                    <tr key={x.tenant.id} className="group hover:bg-slate-50">
                      <td className="td whitespace-nowrap font-medium">{x.tenant.unit?.replace(/^unit\s+/i, "") ?? "—"}</td>
                      <td className="td"><Link className="font-medium text-slate-900 group-hover:text-brand-700" href={`/reports/rent-roll/tenants/${x.tenant.id}`}>{x.tenant.name}</Link>
                        {x.ledger.lastPayment && <div className="text-xs text-slate-500">Last paid {formatDate(x.ledger.lastPayment)}</div>}</td>
                      <td className="td whitespace-nowrap text-slate-500">{x.tenant.layout ?? ""}{x.tenant.sqft ? <div className="text-xs">{x.tenant.sqft} sq ft</div> : null}</td>
                      <td className="td text-right num">{x.tenant.rentCents ? formatMoney(x.tenant.rentCents, c) : <Badge tone="amber">No lease</Badge>}</td>
                      <td className="td whitespace-nowrap text-slate-600">{x.tenant.leaseEnd ? formatDate(x.tenant.leaseEnd) : <span className="text-slate-400">Not set</span>}</td>
                      <td className="td">{x.thisMonth && <><StatusChip status={x.thisMonth.status} />{x.thisMonth.paidCents > 0 && x.thisMonth.status !== "PAID" && <div className="mt-0.5 text-xs text-slate-500">{formatMoney(x.thisMonth.paidCents, c)} received</div>}</>}</td>
                      <td className="td"><MonthDots months={x.ledger.months} /></td>
                      <td className="td text-right">
                        {x.tenant.reportedBalanceCents !== null
                          ? <span className={`num font-semibold ${x.tenant.reportedBalanceCents > 0 ? "text-red-700" : x.tenant.reportedBalanceCents < 0 ? "text-emerald-700" : "text-slate-400"}`} title="From your rent roll report">{x.tenant.reportedBalanceCents === 0 ? "—" : x.tenant.reportedBalanceCents < 0 ? `${formatMoney(-x.tenant.reportedBalanceCents, c)} credit` : formatMoney(x.tenant.reportedBalanceCents, c)}</span>
                          : <span className={`num font-semibold ${x.ledger.balanceCents > 0 ? "text-red-700" : "text-slate-400"}`}>{x.ledger.balanceCents > 0 ? formatMoney(x.ledger.balanceCents, c) : "—"}</span>}
                        {x.tenant.reportedBalanceCents !== null && x.ledger.dueCents > 0 && <div className="text-xs text-slate-500" title="Rent due minus deposits matched in your bank statements">Bank: {x.ledger.balanceCents > 0 ? formatMoney(x.ledger.balanceCents, c) : "up to date"}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}
      <div className="mb-6 -mt-3 px-1"><StatusLegend /></div>

      <Card id="unmatched" title={<span className="inline-flex items-center gap-2"><KeyRound className="h-4 w-4" /> Deposits not matched to a tenant</span>}
        subtitle="Money received in your rent accounts over the last 3 months that isn't anyone's rent yet. Assign it once; similar deposits are matched by amount and name from then on." padded={false} className="mb-6">
        {r.unmatched.length ? (
          <ul className="divide-y divide-slate-100" data-testid="unmatched">
            {r.unmatched.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-[12rem] flex-1">
                  <div className="font-medium">{d.description}</div>
                  <div className="text-xs text-slate-500">{formatDate(d.date)} · {d.account}{d.suggested.length > 1 && <> · <Badge tone="amber">same amount as {d.suggested.length} tenants</Badge></>}</div>
                </div>
                <div className="num w-28 text-right font-semibold text-emerald-700">{formatMoney(d.amountCents, d.currency)}</div>
                <ActionForm action={assignDepositAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="txnId" value={d.id} />
                  <select name="tenantId" className="input w-56 py-1.5 text-sm" aria-label="Tenant" defaultValue={d.suggested[0] ?? ""} required>
                    <option value="" disabled>Whose rent is this?</option>
                    {r.tenantOptions.map((t) => <option key={t.id} value={t.id}>{t.label}{d.suggested.includes(t.id) ? " (same amount)" : ""}</option>)}
                    <option value="none">Not rent</option>
                  </select>
                  <button className="btn-secondary btn-sm">Save</button>
                </ActionForm>
              </li>
            ))}
          </ul>
        ) : <p className="px-5 py-4 text-sm text-slate-500">Every deposit in your rent accounts is matched. Nice.</p>}
      </Card>

      {past.length > 0 && (
        <details className="card p-5">
          <summary className="cursor-pointer font-semibold"><Users className="mr-2 inline h-4 w-4" />Former tenants ({past.length})</summary>
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {past.map((x) => (
              <li key={x.tenant.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link className="link" href={`/reports/rent-roll/tenants/${x.tenant.id}`}>{x.tenant.name}{x.tenant.unit ? ` · unit ${x.tenant.unit}` : ""}{x.building ? ` · ${x.building}` : ""}</Link>
                <span className="text-slate-500">Moved out {x.tenant.leaseEnd ? formatDate(x.tenant.leaseEnd) : ""}{x.ledger.balanceCents > 0 ? ` · owes ${formatMoney(x.ledger.balanceCents, c)}` : ""}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
