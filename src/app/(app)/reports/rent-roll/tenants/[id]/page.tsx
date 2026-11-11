import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { latestMonth } from "@/lib/services/query";
import { loadRentRoll } from "@/lib/services/rentroll";
import { formatDate, monthLabel } from "@/lib/engine/dates";
import { formatMoney } from "@/lib/engine/money";
import { Card, Notice, PageHeader, Stat } from "@/components/ui";
import { BackLink } from "@/components/BackLink";
import { TenantForm } from "@/components/TenantForm";
import { Findings } from "@/components/Findings";
import { StatusChip } from "@/components/RentStatus";
import { ActionForm } from "@/components/ActionForm";
import { assignDepositAction, moveOutTenantAction } from "@/app/actions";
import { companyTree } from "@/lib/scope";

export const metadata = { title: "Tenant" };

export default async function TenantPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const tenant = await prisma.tenant.findFirst({ where: { id, userId: user.id } });
  if (!tenant) notFound();
  const month = await latestMonth(user.id);
  const [roll, companies, accounts, payments] = await Promise.all([
    loadRentRoll(user, month), companyTree(user.id),
    prisma.account.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
    prisma.transaction.findMany({ where: { tenantId: id, excluded: false }, orderBy: { date: "desc" }, include: { account: { select: { name: true } } } }),
  ]);
  const row = roll.rows.find((r) => r.tenant.id === id);
  const c = user.baseCurrency;
  const findings = roll.findings.filter((f) => f.href === `/reports/rent-roll/tenants/${id}`).map((f) => ({ ...f, href: undefined }));
  const building = companies.flatMap((co) => co.buildings).find((b) => b.id === tenant.buildingId);
  return (
    <>
      <PageHeader back={<BackLink fallback="/reports/rent-roll" />} title={tenant.name}
        subtitle={[building?.name, tenant.unit ? `unit ${tenant.unit}` : null, tenant.layout ? `${tenant.layout}${tenant.sqft ? `, ${tenant.sqft} sq ft` : ""}` : null, tenant.status === "VACANT" ? "empty unit" : `${formatMoney(tenant.rentCents, c)}/month, due on the ${tenant.dueDay}`, tenant.moveIn ? `moved in ${formatDate(tenant.moveIn)}` : null, tenant.status === "PAST" ? "moved out" : null].filter(Boolean).join(" · ")} />
      {sp.added && <div className="mb-4"><Notice tone="green">Tenant added. We looked for their rent in the statements you&apos;ve already imported; check the payments below.</Notice></div>}
      {row && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tenant.reportedBalanceCents !== null
            ? <Stat label="Balance due (rent roll)" value={tenant.reportedBalanceCents < 0 ? `${formatMoney(-tenant.reportedBalanceCents, c)} credit` : formatMoney(tenant.reportedBalanceCents, c)} tone={tenant.reportedBalanceCents > 0 ? "bad" : "good"}
                hint={`${tenant.reportedBalanceAsOf ? `On ${formatDate(tenant.reportedBalanceAsOf)}` : ""}${row.ledger.dueCents > 0 ? ` · bank deposits: ${row.ledger.balanceCents > 0 ? `${formatMoney(row.ledger.balanceCents, c)} short` : "up to date"}` : ""}`} />
            : <Stat label="Owes" value={formatMoney(Math.max(0, row.ledger.balanceCents), c)} tone={row.ledger.balanceCents > 0 ? "bad" : "good"} hint="From bank deposits, last 12 months" />}
          <Stat label="Paid on time" value={`${row.ledger.months.filter((m) => m.status === "PAID").length} of ${row.ledger.months.filter((m) => m.dueCents > 0).length}`} hint="Months with rent due" />
          <Stat label="Usually pays" value={row.ledger.avgDaysLate === null ? "—" : row.ledger.avgDaysLate <= 0 ? "On time" : `${row.ledger.avgDaysLate} days late`} />
          <Stat label="Lease ends" value={tenant.leaseEnd ? formatDate(tenant.leaseEnd) : "Not set"} />
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          {findings.length > 0 && <Card title="Worth knowing"><Findings items={findings} /></Card>}
          {row && (
            <Card title="Month by month" subtitle="Rent due and the deposits we matched to it. Payments up to 10 days before the due date count for that month." padded={false}>
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100"><tr><th className="th">Month</th><th className="th">Status</th><th className="th text-right">Due</th><th className="th text-right">Received</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {[...row.ledger.months].reverse().filter((m) => m.status !== "NO_LEASE").map((m) => (
                    <tr key={m.month}><td className="td">{monthLabel(m.month)}</td><td className="td"><StatusChip status={m.status} />{m.firstPaid && <span className="ml-2 text-xs text-slate-500">{formatDate(m.firstPaid)}</span>}</td>
                      <td className="td text-right num">{m.dueCents ? formatMoney(m.dueCents, c) : "—"}</td><td className="td text-right num">{m.paidCents ? formatMoney(m.paidCents, c) : "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          <Card title="Payments matched to this tenant" subtitle="If one isn't theirs, choose “Not this tenant” and we won't match it again." padded={false}>
            {payments.length ? (
              <ul className="divide-y divide-slate-100 text-sm">
                {payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-[12rem] flex-1"><Link className="font-medium hover:text-brand-700" href={`/transactions/${p.id}`}>{p.description}</Link>
                      <div className="text-xs text-slate-500">{formatDate(p.date)} · {p.account.name} · {p.tenantConfirmed ? "matched by you" : "matched automatically"}</div></div>
                    <span className="num w-28 text-right font-semibold text-emerald-700">{formatMoney(p.amountCents, p.currency)}</span>
                    <ActionForm action={assignDepositAction}><input type="hidden" name="txnId" value={p.id} /><input type="hidden" name="tenantId" value="none" /><button className="btn-ghost btn-sm">Not this tenant</button></ActionForm>
                  </li>
                ))}
              </ul>
            ) : <p className="px-5 py-4 text-sm text-slate-500">No payments matched yet. Check the account and the words on the statement in the details, or assign deposits on the rent roll.</p>}
          </Card>
        </div>
        <div className="space-y-6 lg:col-span-2">
          <Card title="Lease details">
            <TenantForm tenant={tenant} companies={companies} accounts={accounts.map((a) => ({ id: a.id, label: `${a.institution} · ${a.name}${a.mask ? ` ··${a.mask}` : ""}` }))} />
          </Card>
          {tenant.status === "ACTIVE" && (
            <Card title="Moving out?" subtitle="Their payment history is kept. The unit shows as empty until you add the next tenant.">
              <ActionForm action={moveOutTenantAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={tenant.id} />
                <div><label className="label" htmlFor="moveOut">Last day</label><input className="input" type="date" id="moveOut" name="leaseEnd" defaultValue={tenant.leaseEnd?.toISOString().slice(0, 10)} /></div>
                <button className="btn-secondary">Mark as moved out</button>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
