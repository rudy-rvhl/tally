/**
 * Rent roll: tenants, which deposits paid their rent, and what needs attention.
 * Automatic matches are recomputed on every load (so editing a tenant re-matches); your own
 * choices (assigned to a tenant, or "not rent") are never changed.
 */
import type { User } from "@prisma/client";
import { prisma } from "../db";
import { addMonths, formatDate, monthKey, monthLabel, monthRange } from "../engine/dates";
import { formatMoney } from "../engine/money";
import { matchDeposits, rentLedger, type Deposit, type TenantLedger, type TenantLite } from "../engine/rentroll";
import { resolveScope, type ResolvedScope } from "../scope";

const DAY = 86400000;
export type Severity = "high" | "medium" | "info";
export interface Finding { severity: Severity; title: string; detail: string; href?: string; building?: string | null; /** Covers many tenants: shown before single-tenant findings of the same importance. */ summary?: boolean }
export const unitLabel = (u: string) => (/^(unit|apt|app)\b/i.test(u) ? u : `unit ${u}`);

const tenantSelect = { id: true, name: true, unit: true, buildingId: true, accountId: true, rentCents: true, dueDay: true, leaseStart: true, leaseEnd: true, matchText: true, status: true, depositCents: true, email: true, phone: true, notes: true, layout: true, sqft: true, moveIn: true, reportedBalanceCents: true, reportedBalanceAsOf: true } as const;

/**
 * What the engine needs: rent runs from the move-in date, and a current tenant keeps owing rent
 * after the lease date passes (renewals are often not entered). Only a former tenant stops.
 */
const forEngine = (t: { moveIn: Date | null; leaseStart: Date | null; leaseEnd: Date | null; status: string }) =>
  ({ ...t, leaseStart: t.moveIn ?? t.leaseStart, leaseEnd: t.status === "PAST" ? t.leaseEnd : null }) as unknown as TenantLite;

async function candidateDeposits(userId: string, from: Date) {
  const rows = await prisma.transaction.findMany({
    where: {
      userId, excluded: false, amountCents: { gt: 0 }, date: { gte: from },
      // Rent is income; money moved between your own accounts, refunds and card payments are not.
      OR: [{ tenantId: { not: null } }, { kind: { in: ["INCOME", "ADJUSTMENT"] } }],
    },
    select: { id: true, date: true, amountCents: true, description: true, originalDescription: true, accountId: true, buildingId: true, tenantId: true, tenantConfirmed: true, account: { select: { buildingId: true, name: true, institution: true, currency: true } } },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => ({ ...r, effBuilding: r.buildingId ?? r.account.buildingId }));
}

/** Re-run automatic matching for every deposit you haven't decided on yourself. */
export async function autoMatchRent(userId: string) {
  const tenants = (await prisma.tenant.findMany({ where: { userId, status: { not: "VACANT" } }, select: tenantSelect })).map(forEngine);
  const from = new Date(Date.now() - 800 * DAY);
  const deposits = (await candidateDeposits(userId, from)).filter((d) => !d.tenantConfirmed);
  const input: Deposit[] = deposits.map((d) => ({ id: d.id, date: d.date, amountCents: d.amountCents, description: `${d.description} ${d.originalDescription}`, accountId: d.accountId, buildingId: d.effBuilding }));
  const { matches, suggestions } = tenants.length ? matchDeposits(tenants, input) : { matches: [], suggestions: [] };
  const want = new Map(matches.map((m) => [m.depositId, m.tenantId]));
  for (const d of deposits) {
    const target = want.get(d.id) ?? null;
    if (d.tenantId !== target) await prisma.transaction.update({ where: { id: d.id }, data: { tenantId: target } });
  }
  return { matches, suggestions };
}

function inScope(scope: ResolvedScope, buildingCompany: Map<string, string>, buildingId: string | null) {
  if (scope.scope.type === "all") return true;
  if (scope.scope.type === "building") return buildingId === scope.building?.id;
  return buildingId ? buildingCompany.get(buildingId) === scope.company?.id : false;
}

export interface TenantRow {
  tenant: TenantLite & { depositCents: number | null; email: string | null; phone: string | null; notes: string | null; layout: string | null; sqft: number | null; moveIn: Date | null; reportedBalanceCents: number | null; reportedBalanceAsOf: Date | null };
  building: string | null;
  ledger: TenantLedger;
  thisMonth: TenantLedger["months"][number] | undefined;
  account: string | null;
}

export async function loadRentRoll(user: Pick<User, "id" | "baseCurrency">, month: string) {
  const c = user.baseCurrency;
  const { suggestions } = await autoMatchRent(user.id);
  const scope = await resolveScope(user.id);
  const buildings = scope.companies.flatMap((co) => co.buildings.map((b) => ({ ...b, companyId: co.id, company: co.name })));
  const buildingCompany = new Map(buildings.map((b) => [b.id, b.companyId]));
  const buildingName = new Map(buildings.map((b) => [b.id, b.name]));
  const allTenants = await prisma.tenant.findMany({ where: { userId: user.id }, select: { ...tenantSelect, account: { select: { name: true } } }, orderBy: [{ unit: "asc" }, { name: "asc" }] });
  const tenants = allTenants.filter((t) => inScope(scope, buildingCompany, t.buildingId) || (scope.scope.type === "all"));
  const months = Array.from({ length: 12 }, (_, i) => addMonths(month, i - 11));
  const asOf = new Date(Math.min(Date.now(), monthRange(month).end.getTime()));
  const fromDate = monthRange(addMonths(month, -14)).start;
  const deposits = await candidateDeposits(user.id, fromDate);

  // First day we have statements for, per account: months before it are "no data", not "unpaid".
  const firsts = await prisma.transaction.groupBy({ by: ["accountId"], where: { userId: user.id }, _min: { date: true } });
  const firstOf = new Map(firsts.map((f) => [f.accountId, f._min.date]));
  const accountsByBuilding = await prisma.account.findMany({ where: { userId: user.id }, select: { id: true, buildingId: true, companyId: true, name: true } });

  const rows: TenantRow[] = tenants.map((t) => {
    const pays = deposits.filter((d) => d.tenantId === t.id).map((d) => ({ date: d.date, amountCents: d.amountCents }));
    const candidates = t.accountId ? [t.accountId] : accountsByBuilding.filter((a) => !t.buildingId || a.buildingId === t.buildingId || a.buildingId === null).map((a) => a.id);
    const starts = candidates.map((id) => firstOf.get(id)).filter(Boolean) as Date[];
    // Not tracked until we know where this tenant's rent goes (an account, or at least one matched deposit).
    const tracked = !!t.accountId || pays.length > 0;
    const dataFrom = !tracked ? new Date(8.64e15) : starts.length ? new Date(Math.min(...starts.map((s) => s.getTime()))) : null;
    const ledger = rentLedger(forEngine(t), pays, months, asOf, dataFrom);
    return { tenant: t as unknown as TenantRow["tenant"], building: t.buildingId ? buildingName.get(t.buildingId) ?? null : null, ledger, thisMonth: ledger.months.find((m) => m.month === month), account: t.account?.name ?? null };
  });

  const active = rows.filter((r) => r.tenant.status === "ACTIVE");
  const due = active.reduce((a, r) => a + (r.thisMonth?.dueCents ?? 0), 0);
  const collected = active.reduce((a, r) => a + Math.min(r.thisMonth?.paidCents ?? 0, r.thisMonth?.dueCents || Infinity), 0);
  const arrears = rows.reduce((a, r) => a + Math.max(0, r.ledger.balanceCents), 0);
  const last12due = rows.reduce((a, r) => a + r.ledger.dueCents, 0);
  const last12paid = rows.reduce((a, r) => a + Math.min(r.ledger.paidCents, r.ledger.dueCents), 0);
  const units = new Set(rows.map((r) => `${r.tenant.buildingId}|${(r.tenant.unit ?? r.tenant.id).toLowerCase()}`));
  const occupied = new Set(active.map((r) => `${r.tenant.buildingId}|${(r.tenant.unit ?? r.tenant.id).toLowerCase()}`));

  // Deposits into rent accounts that aren't anyone's rent yet (last 3 months).
  const rentAccounts = new Set(tenants.map((t) => t.accountId).filter(Boolean) as string[]);
  const rentBuildings = new Set(tenants.map((t) => t.buildingId).filter(Boolean) as string[]);
  const recentFrom = monthRange(addMonths(month, -2)).start;
  const sugg = new Map(suggestions.map((s) => [s.depositId, s.tenantIds]));
  const scopedIds = new Set(tenants.map((t) => t.id));
  const unmatched = deposits.filter((d) => !d.tenantId && !d.tenantConfirmed && d.date >= recentFrom && d.date <= monthRange(month).end &&
    (rentAccounts.has(d.accountId) || (!!d.effBuilding && rentBuildings.has(d.effBuilding)) || (sugg.get(d.id) ?? []).some((id) => scopedIds.has(id))))
    .map((d) => ({ id: d.id, date: d.date, amountCents: d.amountCents, description: d.description, account: d.account.name, currency: d.account.currency, suggested: sugg.get(d.id) ?? [] }));

  // ---------- what needs attention
  const f: Finding[] = [];
  const name = (r: TenantRow) => `${r.tenant.name}${r.tenant.unit ? ` (${unitLabel(r.tenant.unit)})` : ""}`;
  for (const r of rows.filter((x) => x.tenant.status !== "VACANT")) {
    const href = `/reports/rent-roll/tenants/${r.tenant.id}`;
    // When the rent roll report gives the tenant's balance, that's the reference (summarised below).
    if (r.ledger.balanceCents > 0 && r.tenant.reportedBalanceCents === null) {
      const firstOwed = r.ledger.months.find((m) => m.status === "UNPAID" || m.status === "PARTIAL");
      f.push({ severity: r.ledger.balanceCents >= r.tenant.rentCents ? "high" : "medium", building: r.building, href, title: `${name(r)} owes ${formatMoney(r.ledger.balanceCents, c)}`, detail: `Rent due over the last 12 months is ${formatMoney(r.ledger.dueCents, c)} and we found ${formatMoney(r.ledger.paidCents, c)} paid${firstOwed ? `. The first short month is ${monthLabel(firstOwed.month)}` : ""}. If they paid in cash or into another account, record it, or assign the deposit below.` });
    }
    const recent = r.ledger.months.slice(-6);
    const lateRecent = recent.filter((m) => m.status === "LATE").length;
    if (lateRecent >= 2) f.push({ severity: "medium", building: r.building, href, title: `${name(r)} paid late ${lateRecent} times in 6 months`, detail: `Rent arrives on average ${r.ledger.avgDaysLate} day${r.ledger.avgDaysLate === 1 ? "" : "s"} after the due date. A reminder a few days before the ${r.tenant.dueDay}${["st", "nd", "rd"][r.tenant.dueDay - 1] ?? "th"}, or pre-authorised debit, usually fixes this.` });
    if (r.tenant.status === "ACTIVE" && !r.ledger.lastPayment && r.tenant.accountId && r.ledger.months.some((m) => m.dueCents > 0))
      f.push({ severity: "high", building: r.building, href, title: `No rent found for ${name(r)}`, detail: "We can't find any deposit from this tenant in the account their rent is paid into. Check the words on the statement on their page, or assign their payments in “Deposits not matched” below." });
    if (r.tenant.status === "ACTIVE" && r.tenant.leaseEnd) {
      const days = Math.round((r.tenant.leaseEnd.getTime() - asOf.getTime()) / DAY);
      if (days < 0) f.push({ severity: "medium", building: r.building, href, title: `${name(r)}'s lease ended on ${formatDate(r.tenant.leaseEnd)}`, detail: "They're still marked as a current tenant. Renew the lease (and update the rent), or mark them as moved out." });
      else if (days <= 120) f.push({ severity: days <= 60 ? "medium" : "info", building: r.building, href, title: `${name(r)}'s lease ends in ${days} days`, detail: `On ${formatDate(r.tenant.leaseEnd, "long")}. In Quebec, the notice to modify a 12-month lease must be sent 3 to 6 months before it ends: a good moment to review the rent.` });
    }
    if (r.tenant.status === "ACTIVE" && r.tenant.leaseStart && asOf.getTime() - r.tenant.leaseStart.getTime() > 400 * DAY)
      f.push({ severity: "info", building: r.building, href, title: `${name(r)}: same rent since ${formatDate(r.tenant.leaseStart)}`, detail: `${formatMoney(r.tenant.rentCents, c)}/month for over a year. If the lease was renewed with an increase, update the rent so arrears are calculated correctly; otherwise consider a review at renewal.` });
  }
  // Empty units recorded as vacant (e.g. from an imported rent roll): what they'd rent for.
  const medianOf = (xs: number[]) => { const s2 = [...xs].sort((a, b) => a - b); return s2.length ? s2[Math.floor(s2.length / 2)] : 0; };
  const similarRent = (r: TenantRow) => medianOf(active.filter((o) => o.tenant.buildingId === r.tenant.buildingId && o.tenant.layout === r.tenant.layout && o.tenant.rentCents > 0).map((o) => o.tenant.rentCents));
  for (const r of rows.filter((x) => x.tenant.status === "VACANT")) {
    const est = r.tenant.rentCents || similarRent(r);
    f.push({ severity: "high", building: r.building, href: `/reports/rent-roll/tenants/${r.tenant.id}`, title: `${unitLabel(r.tenant.unit ?? "")[0].toUpperCase()}${unitLabel(r.tenant.unit ?? "").slice(1)}${r.building ? ` at ${r.building}` : ""} is empty`, detail: est ? `Similar ${r.tenant.layout ?? ""} units in this building rent for about ${formatMoney(est, c)}: that's ${formatMoney(est * 12, c)} a year while it stays empty.` : "Add the new tenant when it's rented." });
  }
  // Rent well below similar units in the same building (same bedrooms / bathrooms).
  const below = active.map((r) => ({ r, median: similarRent(r) })).filter(({ r, median }) => r.tenant.rentCents > 0 && median > 0 && r.tenant.rentCents < median * 0.85 && active.filter((o) => o.tenant.buildingId === r.tenant.buildingId && o.tenant.layout === r.tenant.layout).length >= 3)
    .sort((a, b) => b.median - b.r.tenant.rentCents - (a.median - a.r.tenant.rentCents));
  if (below.length) {
    const gap = below.reduce((a, x) => a + (x.median - x.r.tenant.rentCents), 0);
    f.push({ summary: true, severity: "medium", title: `${below.length} unit${below.length === 1 ? " rents" : "s rent"} at least 15% below similar units`, detail: `Together ${formatMoney(gap, c)}/month (${formatMoney(gap * 12, c)} a year) below the typical rent for the same size in the same building. Largest gaps: ${below.slice(0, 4).map(({ r, median }) => `${r.building ?? ""} ${unitLabel(r.tenant.unit ?? "")} ${formatMoney(r.tenant.rentCents, c)} vs ${formatMoney(median, c)}`).join("; ")}. Worth reviewing at each renewal (in Quebec, within the rules for rent increases).` });
  }
  // No lease on file
  const noLease = active.filter((r) => r.tenant.rentCents <= 0);
  if (noLease.length) f.push({ summary: true, severity: "medium", title: `${noLease.length} tenant${noLease.length === 1 ? " has" : "s have"} no lease or rent on file`, detail: `${noLease.map((r) => `${r.building ?? ""} ${unitLabel(r.tenant.unit ?? "")} (${r.tenant.name})`).join("; ")}. Without a lease the rent owed can't be tracked, and it's harder to enforce. Add the rent on their page.` });
  // Balances due according to the imported rent roll report
  const reported = active.filter((r) => r.tenant.reportedBalanceCents !== null);
  if (reported.length) {
    const owed = reported.filter((r) => (r.tenant.reportedBalanceCents ?? 0) > 0);
    const totalOwed = owed.reduce((a, r) => a + (r.tenant.reportedBalanceCents ?? 0), 0);
    const asOfR = reported[0].tenant.reportedBalanceAsOf;
    const big = owed.filter((r) => r.tenant.rentCents > 0 && (r.tenant.reportedBalanceCents ?? 0) >= 2 * r.tenant.rentCents).sort((a, b) => (b.tenant.reportedBalanceCents ?? 0) - (a.tenant.reportedBalanceCents ?? 0));
    if (totalOwed > 0) f.push({ summary: true, severity: "high", title: `Tenants owe ${formatMoney(totalOwed, c)} according to your rent roll`, detail: `${owed.length} of ${reported.length} tenants had a balance due${asOfR ? ` on ${formatDate(asOfR, "long")}` : ""}${(() => { const credits = -reported.reduce((x, r) => x + Math.min(0, r.tenant.reportedBalanceCents ?? 0), 0); return credits ? ` (other tenants have ${formatMoney(credits, c)} of credit, so the report's net total is ${formatMoney(totalOwed - credits, c)})` : ""; })()}. ${big.length} owe two months of rent or more: ${big.slice(0, 5).map((r) => `${r.building ?? ""} ${unitLabel(r.tenant.unit ?? "")} ${formatMoney(r.tenant.reportedBalanceCents ?? 0, c)} (${((r.tenant.reportedBalanceCents ?? 0) / r.tenant.rentCents).toFixed(1)} months)`).join("; ")}${big.length > 5 ? "…" : ""}. If some of these are paid, the rent roll software hasn't recorded it.` });
  }
  // Vacancies: a unit whose last tenant moved out and no current tenant.
  const vacantKeys = new Set(rows.filter((x) => x.tenant.status === "VACANT").map((x) => `${x.tenant.buildingId}|${(x.tenant.unit ?? x.tenant.id).toLowerCase()}`));
  for (const r of rows.filter((x) => x.tenant.status === "PAST" && x.tenant.unit)) {
    const key = `${r.tenant.buildingId}|${r.tenant.unit!.toLowerCase()}`;
    if (occupied.has(key) || vacantKeys.has(key)) continue;
    if (rows.some((o) => o !== r && o.tenant.status === "PAST" && `${o.tenant.buildingId}|${(o.tenant.unit ?? "").toLowerCase()}` === key && (o.tenant.leaseEnd?.getTime() ?? 0) > (r.tenant.leaseEnd?.getTime() ?? 0))) continue;
    const since = r.tenant.leaseEnd ?? null;
    const monthsVacant = since ? Math.max(0, Math.round((asOf.getTime() - since.getTime()) / (30.4 * DAY))) : null;
    f.push({ severity: "high", building: r.building, title: `Unit ${r.tenant.unit}${r.building ? ` at ${r.building}` : ""} is empty${since ? ` since ${formatDate(since)}` : ""}`, detail: `At the last rent of ${formatMoney(r.tenant.rentCents, c)}/month${monthsVacant ? `, that's about ${formatMoney(r.tenant.rentCents * monthsVacant, c)} of rent not collected so far` : ""}. Add the new tenant when it's rented.` });
  }
  const untracked = rows.filter((r) => r.tenant.status === "ACTIVE" && !r.tenant.accountId && !r.ledger.lastPayment && r.tenant.rentCents > 0);
  if (untracked.length) f.push({ summary: true, severity: "info", title: `Rent not tracked yet for ${untracked.length} tenant${untracked.length === 1 ? "" : "s"}`, detail: `We haven't found a deposit for ${untracked.length === rows.filter((r) => r.tenant.status === "ACTIVE").length ? "any tenant" : "them"} in your imported statements. Import the statements of the account the rent goes into, then set that account per building (rent roll import) or per tenant. Until then, “owes” uses your rent roll report's balance only.` });
  if (unmatched.length) f.push({ severity: "info", title: `${unmatched.length} deposit${unmatched.length === 1 ? "" : "s"} not matched to a tenant`, detail: `${formatMoney(unmatched.reduce((a, d) => a + d.amountCents, 0), c)} came into your rent accounts in the last 3 months without a tenant. Assign each one, or mark it as not rent.`, href: "#unmatched" });
  const order = { high: 0, medium: 1, info: 2 } as const;
  f.sort((a, b) => order[a.severity] - order[b.severity] || Number(!!b.summary) - Number(!!a.summary));

  return {
    scope, months, month, rows, unmatched, findings: f,
    reportedBalanceCents: active.reduce((a, r) => a + Math.max(0, r.tenant.reportedBalanceCents ?? 0), 0),
    reportedAsOf: active.find((r) => r.tenant.reportedBalanceAsOf)?.tenant.reportedBalanceAsOf ?? null,
    tenantOptions: allTenants.filter((t) => t.status === "ACTIVE").map((t) => ({ id: t.id, label: `${t.name}${t.unit ? ` · ${unitLabel(t.unit)}` : ""}${t.buildingId && buildingName.get(t.buildingId) ? ` · ${buildingName.get(t.buildingId)}` : ""}` })),
    kpi: {
      dueCents: due, collectedCents: collected, outstandingCents: Math.max(0, due - collected),
      collectionRate: due ? collected / due : null, collectionRate12: last12due ? last12paid / last12due : null,
      arrearsCents: arrears, activeTenants: active.length, units: units.size, occupied: occupied.size,
      annualRentCents: active.reduce((a, r) => a + r.tenant.rentCents * 12, 0),
      depositsHeldCents: active.reduce((a, r) => a + (r.tenant.depositCents ?? 0), 0),
    },
  };
}

export const thisMonth = () => monthKey(new Date());
