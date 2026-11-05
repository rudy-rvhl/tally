/**
 * What part of the business the screens are showing: everything, one company, or one building.
 * The choice is remembered in a cookie and applied by the single query layer (buildWhere), so
 * every total, chart, drill-down and answer on screen uses the same rows.
 * Downloads for the accountant (the Excel bank book) always include every company.
 *
 * A transaction belongs to a building when it was assigned to one directly, otherwise to its
 * account's building. It belongs to a company through that building, otherwise its account.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

export const SCOPE_COOKIE = "liq_scope";

export type Scope = { type: "all" } | { type: "company"; id: string } | { type: "building"; id: string };

export function parseScope(v: string | null | undefined): Scope {
  const m = /^(c|b):([\w-]{1,64})$/.exec(v ?? "");
  if (!m) return { type: "all" };
  return m[1] === "c" ? { type: "company", id: m[2] } : { type: "building", id: m[2] };
}

export function scopeValue(s: Scope): string {
  return s.type === "all" ? "all" : `${s.type === "company" ? "c" : "b"}:${s.id}`;
}

/** The remembered scope for this request; "all" outside a request (tests, scripts). */
export async function scopeCookie(): Promise<string | undefined> {
  try {
    const { cookies } = await import("next/headers");
    return (await cookies()).get(SCOPE_COOKIE)?.value;
  } catch {
    return undefined;
  }
}

export function scopeWhere(s: Scope): Prisma.TransactionWhereInput | null {
  if (s.type === "building") return { OR: [{ buildingId: s.id }, { buildingId: null, account: { buildingId: s.id } }] };
  if (s.type === "company") return { OR: [{ building: { companyId: s.id } }, { buildingId: null, account: { companyId: s.id } }] };
  return null;
}

export interface CompanyTree {
  id: string;
  name: string;
  buildings: { id: string; name: string; address: string | null }[];
}

export async function companyTree(userId: string): Promise<CompanyTree[]> {
  return prisma.company.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }, { name: "asc" }],
    select: { id: true, name: true, buildings: { orderBy: { name: "asc" }, select: { id: true, name: true, address: true } } },
  });
}

export interface ResolvedScope {
  scope: Scope;
  /** e.g. "All companies", "Example Holdings", "12 Main St (Example Holdings)" */
  label: string;
  company: CompanyTree | null;
  building: CompanyTree["buildings"][number] | null;
  companies: CompanyTree[];
  /** True when there is something to choose between (more than one company, or any building). */
  multi: boolean;
}

/** The current scope checked against the user's own companies; anything unknown falls back to everything. */
export async function resolveScope(userId: string, raw?: string): Promise<ResolvedScope> {
  const companies = await companyTree(userId);
  const multi = companies.length > 1 || companies.some((c) => c.buildings.length > 0);
  let scope = parseScope(raw ?? (await scopeCookie()));
  let company: CompanyTree | null = null;
  let building: CompanyTree["buildings"][number] | null = null;
  const id = scope.type === "all" ? "" : scope.id;
  if (scope.type === "company") company = companies.find((c) => c.id === id) ?? null;
  if (scope.type === "building") {
    for (const c of companies) {
      const b = c.buildings.find((x) => x.id === id);
      if (b) { company = c; building = b; }
    }
  }
  if ((scope.type === "company" && !company) || (scope.type === "building" && !building)) scope = { type: "all" };
  const label = building ? building.name : company ? company.name : companies.length > 1 ? "All companies" : companies[0]?.name ?? "My company";
  return { scope, label, company, building, companies, multi };
}

/** The first company, created from the legacy company name if the user has none yet. */
export async function defaultCompany(userId: string) {
  const first = await prisma.company.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
  if (first) return first;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { companyName: true } });
  return prisma.company.create({ data: { userId, name: user?.companyName?.trim() || "My company" } });
}

export interface BreakdownRow<T> {
  /** Scope to switch to when the row is clicked; null for money not assigned to a building. */
  value: string | null;
  label: string;
  depth: 0 | 1;
  rows: T[];
}

/**
 * Split rows by company and building for the current scope: companies (with their buildings)
 * when showing everything across several companies, otherwise the buildings of the company
 * plus whatever isn't assigned to a building. Empty when there is nothing to split.
 */
export function breakdown<T extends { buildingId?: string | null; companyId?: string | null }>(r: ResolvedScope, rows: T[]): BreakdownRow<T>[] {
  if (r.scope.type === "building") return [];
  const out: BreakdownRow<T>[] = [];
  const companies = r.company ? [r.company] : r.companies;
  const nested = companies.length > 1;
  for (const c of companies) {
    const inCompany = rows.filter((t) => t.companyId === c.id);
    if (nested) out.push({ value: `c:${c.id}`, label: c.name, depth: 0, rows: inCompany });
    if (!c.buildings.length) continue;
    for (const b of c.buildings) out.push({ value: `b:${b.id}`, label: b.name, depth: nested ? 1 : 0, rows: inCompany.filter((t) => t.buildingId === b.id) });
    const rest = inCompany.filter((t) => !t.buildingId);
    if (rest.length) out.push({ value: null, label: nested ? `${c.name}: not assigned to a building` : "Not assigned to a building", depth: nested ? 1 : 0, rows: rest });
  }
  return out.length > 1 ? out : [];
}

/** Accounts that can hold money for the current scope (for "statement missing" warnings). */
export async function accountIdsInScope(userId: string, r: ResolvedScope): Promise<Set<string> | null> {
  if (r.scope.type === "all") return null;
  const where = r.building
    ? { userId, OR: [{ buildingId: r.building.id }, { buildingId: null, companyId: r.company!.id }] }
    : { userId, companyId: r.company!.id };
  const accounts = await prisma.account.findMany({ where, select: { id: true } });
  return new Set(accounts.map((a) => a.id));
}
