/**
 * Data analysis: every property (building) and every account, for a period, plus the findings
 * an owner wouldn't see by scrolling through transactions. Uses the same query layer as every
 * other screen (and the company / building chosen at the top).
 */
import type { User } from "@prisma/client";
import { prisma } from "../db";
import { loadAnalytic, latestMonth } from "./query";
import { accountCoverage } from "./options";
import { accountBalance } from "./balances";
import { loadRentRoll } from "./rentroll";
import { resolveScope } from "../scope";
import { addMonths, formatDate, isoDate, monthLabel, monthRange, monthsBetween } from "../engine/dates";
import { formatMoney } from "../engine/money";
import { detectRecurring } from "../engine/analytics";
import { categoryJumps, paidFor, pctChange, possibleDoublePayments, propertyMetrics, supplierSpikes, type PropertyMetrics } from "../engine/analysis";
import type { AnalyticTxn } from "../engine/types";
import type { FindingView } from "@/components/Findings";

export type Period = "12m" | "fy" | "ytd";
export const PERIODS: { id: Period; label: string }[] = [{ id: "12m", label: "Last 12 months" }, { id: "fy", label: "This fiscal year" }, { id: "ytd", label: "This calendar year" }];
const pct = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : ""}${Math.round(v * 100)}%`);
const INTEREST_EARNED = /inter[eê]ts? cr[eé]diteurs|interest (paid|earned|credit)|^interest\b|int[eé]r[eê]ts? (sur|vers[eé])|interest income/i;

export interface PropertyView { id: string; name: string; company: string | null; m: PropertyMetrics; prev: PropertyMetrics; tenants: number; units: number }
export interface AccountView {
  id: string; name: string; institution: string; mask: string | null; currency: string; where: string | null;
  inCents: number; outCents: number; feesCents: number; interestEarnedCents: number; balanceCents: number | null; balanceAsOf: Date | null;
  yield: number | null; missingMonths: string[];
}

export async function loadAnalysis(user: Pick<User, "id" | "baseCurrency" | "fiscalYearStartMonth">, period: Period) {
  const c = user.baseCurrency;
  const latest = await latestMonth(user.id);
  const fyStart = (() => { const [y, m] = latest.split("-").map(Number); const sy = m >= user.fiscalYearStartMonth ? y : y - 1; return `${sy}-${String(user.fiscalYearStartMonth).padStart(2, "0")}`; })();
  const first = period === "12m" ? addMonths(latest, -11) : period === "fy" ? fyStart : `${latest.slice(0, 4)}-01`;
  const months = monthsBetween(first, latest);
  const prevMonths = months.map((m) => addMonths(m, -months.length));
  const range = (ms: string[]) => ({ from: isoDate(monthRange(ms[0]).start), to: isoDate(monthRange(ms[ms.length - 1]).end) });
  const [scope, cur, prev] = await Promise.all([resolveScope(user.id), loadAnalytic(user, range(months)), loadAnalytic(user, range(prevMonths))]);

  // ---------- properties
  const companies = scope.company ? [scope.company] : scope.companies;
  const buildingList = companies.flatMap((co) => co.buildings.filter((b) => !scope.building || b.id === scope.building.id).map((b) => ({ id: b.id, name: b.name, company: companies.length > 1 ? co.name : null })));
  const tenants = await prisma.tenant.findMany({ where: { userId: user.id }, select: { buildingId: true, unit: true, status: true, id: true } });
  const props: PropertyView[] = buildingList.map((b) => {
    const ts = tenants.filter((t) => t.buildingId === b.id);
    return {
      ...b, m: propertyMetrics(cur.txns.filter((t) => t.buildingId === b.id), months), prev: propertyMetrics(prev.txns.filter((t) => t.buildingId === b.id), prevMonths),
      tenants: ts.filter((t) => t.status === "ACTIVE").length, units: new Set(ts.map((t) => (t.unit ?? t.id).toLowerCase())).size,
    };
  });
  const unassigned = cur.txns.filter((t) => !t.buildingId);
  if (!scope.building && (unassigned.length || !props.length)) {
    props.push({ id: "none", name: props.length ? "Not assigned to a building" : "All accounts", company: null, m: propertyMetrics(unassigned, months), prev: propertyMetrics(prev.txns.filter((t) => !t.buildingId), prevMonths), tenants: 0, units: 0 });
  }
  const total = propertyMetrics(cur.txns, months);
  const totalPrev = propertyMetrics(prev.txns, prevMonths);

  // ---------- accounts
  const accountIds = [...new Set(cur.txns.map((t) => t.accountId))];
  const accounts = await prisma.account.findMany({ where: { userId: user.id, OR: [{ id: { in: accountIds } }, ...(scope.building ? [{ buildingId: scope.building.id }] : scope.company ? [{ companyId: scope.company.id }] : [{}])] }, include: { building: { select: { name: true } }, company: { select: { name: true } } }, orderBy: [{ institution: "asc" }, { name: "asc" }] });
  const cov = await accountCoverage(user.id, months);
  const rawInterest = await prisma.transaction.findMany({ where: { accountId: { in: accounts.map((a) => a.id) }, excluded: false, amountCents: { gt: 0 }, date: { gte: monthRange(months[0]).start, lte: monthRange(latest).end } }, select: { accountId: true, amountCents: true, description: true, category: { select: { name: true } } } });
  const accountViews: AccountView[] = await Promise.all(accounts.map(async (a) => {
    const ts = cur.txns.filter((t) => t.accountId === a.id);
    const bal = await accountBalance(a);
    const interest = rawInterest.filter((t) => t.accountId === a.id && (INTEREST_EARNED.test(t.description) || t.category?.name === "Interest income")).reduce((s, t) => s + t.amountCents, 0);
    const yearly = interest * (12 / months.length);
    return {
      id: a.id, name: a.name, institution: a.institution, mask: a.mask, currency: a.currency,
      where: a.building?.name ?? (scope.companies.length > 1 ? a.company?.name ?? null : null),
      inCents: ts.filter((t) => t.amountCents > 0).reduce((s, t) => s + t.amountCents, 0),
      outCents: ts.filter((t) => t.amountCents < 0).reduce((s, t) => s - t.amountCents, 0),
      feesCents: ts.filter((t) => t.kind === "FEE").reduce((s, t) => s - t.amountCents, 0),
      interestEarnedCents: interest,
      balanceCents: bal && !bal.owed ? bal.cents : bal ? -bal.cents : null, balanceAsOf: bal?.asOf ?? null,
      yield: bal && !bal.owed && bal.cents > 0 ? yearly / bal.cents : null,
      missingMonths: cov.find((x) => x.accountId === a.id)?.cells.filter((x) => x.status === "MISSING" || x.status === "PARTIAL").map((x) => x.month) ?? [],
    };
  }));

  // ---------- what you don't see
  const F: FindingView[] = [];
  const periodName = PERIODS.find((p) => p.id === period)!.label.toLowerCase();
  const txHref = (q: Record<string, string>) => `/transactions?${new URLSearchParams({ from: range(months).from, to: range(months).to, ...q })}`;

  // Idle cash
  for (const a of accountViews) {
    if (a.balanceCents === null || a.balanceCents < 2_500_000 || a.yield === null) continue;
    const at3 = Math.round(a.balanceCents * 0.03);
    if (a.yield < 0.01) F.push({ severity: "high", title: `${formatMoney(a.balanceCents, a.currency)} is sitting in ${a.name} earning almost nothing`, metric: `${(a.yield * 100).toFixed(1)}% a year`, detail: `It earned ${formatMoney(a.interestEarnedCents, a.currency)} in interest over the ${periodName}. At 3% it would earn about ${formatMoney(at3, a.currency)} a year. Keep what you need for the next few months of expenses and move the rest to a savings or investment account.`, href: `/accounts/${a.id}` });
    else if (a.yield < 0.025) F.push({ severity: "medium", title: `${a.name} earns ${(a.yield * 100).toFixed(1)}% on ${formatMoney(a.balanceCents, a.currency)}`, metric: `${(a.yield * 100).toFixed(1)}% a year`, detail: `Business savings and GICs commonly pay more. Each extra 1% is about ${formatMoney(Math.round(a.balanceCents * 0.01), a.currency)} a year.`, href: `/accounts/${a.id}` });
    else F.push({ severity: "info", title: `${a.name} earns about ${(a.yield * 100).toFixed(1)}% a year`, metric: formatMoney(a.interestEarnedCents, a.currency), detail: `${formatMoney(a.interestEarnedCents, a.currency)} of interest on a balance of ${formatMoney(a.balanceCents, a.currency)} over the ${periodName}. Check when the rate is reviewed: savings rates follow the Bank of Canada rate down.`, href: `/accounts/${a.id}` });
  }
  // Properties losing money / high expense ratio
  for (const p of props.filter((x) => x.id !== "none")) {
    if (p.m.incomeCents > 0 && p.m.cashFlowCents < 0) F.push({ severity: "high", building: p.name, title: `${p.name} costs more than it brings in`, metric: formatMoney(p.m.cashFlowCents, c, { signed: true }), detail: `After expenses and debt payments it lost ${formatMoney(-p.m.cashFlowCents, c)} over the ${periodName}. NOI was ${formatMoney(p.m.noiCents, c)} before ${formatMoney(p.m.interestCents + p.m.principalCents, c)} of debt payments.`, href: "#properties" });
    if (p.m.expenseRatio !== null && p.m.expenseRatio > 0.5 && p.m.incomeCents > 0) F.push({ severity: "medium", building: p.name, title: `${p.name}: expenses take ${Math.round(p.m.expenseRatio * 100)}% of income`, metric: `${Math.round(p.m.expenseRatio * 100)}%`, detail: `Residential buildings usually run at 35–50%. The biggest costs: ${p.m.categories.slice(0, 3).map((g) => `${g.label} ${formatMoney(g.spendCents, c)}`).join(", ")}.`, href: "#properties" });
    if (p.m.incomeCents === 0 && p.m.opexCents > 0) F.push({ severity: "medium", building: p.name, title: `No income recorded for ${p.name}`, metric: formatMoney(p.m.opexCents, c), detail: `${formatMoney(p.m.opexCents, c)} of expenses but no money received. If rent goes into an account shared by several buildings, set the building on the tenants (Rent roll) or on the deposits.`, href: "/reports/rent-roll" });
    // Typical costs of a rental property that don't appear anywhere
    const own = cur.txns.filter((t) => t.buildingId === p.id);
    if (p.m.incomeCents > 0 && months.length >= 10) {
      const missing = [!paidFor(own, /insurance|assurance/i) && "insurance", !paidFor(own, /tax|taxe/i) && "property or school taxes"].filter(Boolean);
      if (missing.length) F.push({ severity: "medium", building: p.name, title: `No ${missing.join(" or ")} paid for ${p.name}`, detail: `Nothing for ${missing.join(" or ")} in the ${periodName}. If it's paid from another account, a personal card or by the lender with the mortgage, the property's results look better than they are. If it isn't paid, check the policy or the tax bill.` });
    }
    const growthIn = pctChange(p.m.incomeCents, p.prev.incomeCents), growthOut = pctChange(p.m.opexCents, p.prev.opexCents);
    if (growthIn !== null && growthOut !== null && growthOut - growthIn > 0.1 && p.m.opexCents - p.prev.opexCents > 100000)
      F.push({ severity: "medium", building: p.name, title: `${p.name}: costs are rising faster than income`, metric: `${pct(growthOut)} vs ${pct(growthIn)}`, detail: `Expenses went from ${formatMoney(p.prev.opexCents, c)} to ${formatMoney(p.m.opexCents, c)} while income changed ${pct(growthIn)}, compared with the previous ${months.length} months.`, href: "#properties" });
    for (const j of categoryJumps(own, prev.txns.filter((t) => t.buildingId === p.id)).slice(0, 2))
      F.push({ severity: "info", building: p.name, title: `${j.label} up ${pct(pctChange(j.nowCents, j.beforeCents))} at ${p.name}`, metric: formatMoney(j.nowCents - j.beforeCents, c, { signed: true }), detail: `${formatMoney(j.beforeCents, c)} in the previous ${months.length} months, ${formatMoney(j.nowCents, c)} now.` });
  }
  // Money not assigned to any building
  if (scope.companies.some((co) => co.buildings.length) && !scope.building) {
    const share = total.opexCents ? props.find((p) => p.id === "none")?.m.opexCents ?? 0 : 0;
    if (share > 0 && share / total.opexCents > 0.1) F.push({ severity: "medium", title: `${Math.round((share / total.opexCents) * 100)}% of expenses aren't assigned to a building`, metric: formatMoney(share, c), detail: "Each property's results leave these out, so they look more profitable than they are. Put each account in its building (Accounts), or choose the building on shared-card purchases.", href: "/accounts" });
  }
  // Fees
  const fees = accountViews.reduce((a, x) => a + x.feesCents, 0);
  if (fees > 10000) {
    const prevFees = prev.txns.filter((t) => t.kind === "FEE").reduce((a, t) => a - t.amountCents, 0);
    F.push({ severity: fees > 100000 ? "medium" : "info", title: `${formatMoney(fees, c)} in bank fees`, metric: prevFees ? pct(pctChange(fees, prevFees)) : undefined, detail: `${accountViews.filter((a) => a.feesCents).sort((a, b) => b.feesCents - a.feesCents).slice(0, 3).map((a) => `${a.name} ${formatMoney(a.feesCents, a.currency)}`).join(", ")}. A business plan with more included transactions, or fewer accounts, may cost less.`, href: txHref({ kind: "FEE" }) });
  }
  // Possible double payments
  for (const d of possibleDoublePayments(cur.txns).slice(0, 3))
    F.push({ severity: "medium", title: `${d.a.merchant ?? "A supplier"} may have been paid twice`, metric: formatMoney(-d.a.amountCents, c), detail: `The same amount on ${formatDate(d.a.date)} and ${formatDate(d.b.date)}. If it's one bill, ask for a refund; if it's two, ignore this.`, href: `/transactions/${d.b.id}` });
  // Bills that jumped
  for (const s of supplierSpikes([...prev.txns, ...cur.txns]).filter((s) => s.date >= monthRange(months[0]).start).slice(0, 3))
    F.push({ severity: "info", title: `${s.merchant}: last bill ${formatMoney(s.lastCents, c)}, usually ${formatMoney(s.usualCents, c)}`, metric: `×${(s.lastCents / s.usualCents).toFixed(1)}`, detail: `On ${formatDate(s.date)}. Worth checking for a leak, a rate change or an estimated reading.`, href: txHref({ q: s.merchant }) });
  // Regular charges that stopped
  const endOfPeriod = monthRange(latest).end;
  for (const r of detectRecurring([...prev.txns, ...cur.txns]).filter((r) => r.cadence === "monthly" && endOfPeriod.getTime() - r.lastDate.getTime() > 50 * 86400000).slice(0, 3))
    F.push({ severity: "info", title: `${r.merchant} stopped charging after ${formatDate(r.lastDate)}`, detail: `It was a regular charge of about ${formatMoney(r.typicalCents, c)} a month. If it's insurance, a loan or a utility, make sure it's being paid from somewhere (or that you meant to cancel it).` });
  // Uncategorised spending
  const uncategorised = cur.txns.filter((t) => t.kind === "PURCHASE" && !t.categoryId).reduce((a, t) => a + spendOfAbs(t), 0);
  if (total.opexCents && uncategorised / total.opexCents > 0.05) F.push({ severity: "medium", title: `${Math.round((uncategorised / total.opexCents) * 100)}% of spending has no category`, metric: formatMoney(uncategorised, c), detail: "Category totals and the expense breakdowns below leave these out. Review them once; similar purchases are then sorted automatically.", href: "/review" });
  // Income concentration
  const payers = new Map<string, number>();
  for (const t of cur.txns.filter((x) => x.kind === "INCOME")) payers.set(t.merchant ?? "Unknown", (payers.get(t.merchant ?? "Unknown") ?? 0) + t.amountCents);
  const topPayer = [...payers].sort((a, b) => b[1] - a[1])[0];
  if (topPayer && total.incomeCents > 0 && topPayer[1] / total.incomeCents > 0.5 && payers.size > 2) F.push({ severity: "info", title: `${Math.round((topPayer[1] / total.incomeCents) * 100)}% of income comes from one source`, metric: formatMoney(topPayer[1], c), detail: `${topPayer[0]}. Losing it would hit cash flow hard; keep an eye on that lease or contract.` });
  // Missing statements
  const gaps = accountViews.filter((a) => a.missingMonths.length);
  if (gaps.length) F.push({ severity: "medium", title: `Statements missing for ${gaps.length} account${gaps.length === 1 ? "" : "s"}`, metric: `${gaps.reduce((a, x) => a + x.missingMonths.length, 0)} months`, detail: `${gaps.slice(0, 3).map((a) => `${a.name}: ${a.missingMonths.slice(0, 3).map((m) => monthLabel(m, "short")).join(", ")}${a.missingMonths.length > 3 ? "…" : ""}`).join("; ")}. Totals for those months are too low until they're imported.`, href: "/accounts" });
  // Money moving between companies
  if (scope.companies.length > 1) {
    const moves = await prisma.transaction.findMany({ where: { userId: user.id, excluded: false, transferGroupId: { not: null }, date: { gte: monthRange(months[0]).start, lte: endOfPeriod } }, select: { transferGroupId: true, amountCents: true, account: { select: { companyId: true } } } });
    const groups = new Map<string, typeof moves>();
    for (const m of moves) groups.set(m.transferGroupId!, [...(groups.get(m.transferGroupId!) ?? []), m]);
    const cross = [...groups.values()].filter((g) => new Set(g.map((x) => x.account.companyId)).size > 1);
    const amount = cross.reduce((a, g) => a + Math.max(...g.map((x) => Math.abs(x.amountCents))), 0);
    if (cross.length) F.push({ severity: "info", title: `${formatMoney(amount, c)} moved between your companies`, metric: `${cross.length} transfer${cross.length === 1 ? "" : "s"}`, detail: "Money moved between separate companies is a loan, a dividend or a payment between them, not just a transfer. Note what each one was for, so your accountant books it correctly.", href: txHref({ kind: "TRANSFER" }) });
  }
  // Interest burden
  if (total.noiCents > 0 && total.interestCents / total.noiCents > 0.3) F.push({ severity: "info", title: `Interest takes ${Math.round((total.interestCents / total.noiCents) * 100)}% of your NOI`, metric: formatMoney(total.interestCents, c), detail: "When rates or renewals come up, this is where a better mortgage rate or paying down the most expensive debt helps most." });
  // Rent roll
  const roll = await loadRentRoll(user, latest);
  const owedTotal = roll.reportedBalanceCents > 0 ? roll.reportedBalanceCents : roll.kpi.arrearsCents;
  if (owedTotal > 0) F.push({ severity: "high", title: `Tenants owe ${formatMoney(owedTotal, c)}`, metric: roll.kpi.collectionRate12 === null ? undefined : `${Math.round(roll.kpi.collectionRate12 * 100)}% collected`,
    detail: roll.reportedBalanceCents > 0 ? `According to your rent roll${roll.reportedAsOf ? ` of ${formatDate(roll.reportedAsOf)}` : ""}. The rent roll page lists who owes what, and which tenants owe two months or more.` : `${roll.findings.filter((f) => /owes/.test(f.title)).slice(0, 3).map((f) => f.title).join("; ")}.`, href: "/reports/rent-roll" });
  if (!roll.rows.length && props.some((p) => p.m.incomeCents > 0) && scope.companies.some((co) => co.buildings.length)) F.push({ severity: "info", title: "Add your tenants to see rent, arrears and vacancies", detail: "With the rent roll filled in, this analysis separates rent from other income, shows who's late and what each empty unit costs you.", href: "/reports/rent-roll" });

  const order = { high: 0, medium: 1, info: 2 } as const;
  F.sort((a, b) => order[a.severity] - order[b.severity]);
  return { scope, months, period, latest, props, total, totalPrev, accounts: accountViews, findings: F, conversion: cur.conversion, roll: roll.kpi };
}

const spendOfAbs = (t: AnalyticTxn) => -t.amountCents;
