import type { User } from "@prisma/client";
import { prisma } from "../db";
import type { FilterOptions } from "@/components/FilterBar";
import { addMonths, monthKey, monthLabel, monthsBetween } from "../engine/dates";
import { coverage, type CoverageCell } from "../engine/analytics";
import { dataRange } from "./query";

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  PERSONAL_CHEQUING: "Personal chequing", PERSONAL_SAVINGS: "Personal savings", CREDIT_CARD: "Credit card",
  BUSINESS_CHEQUING: "Business chequing", BUSINESS_CREDIT_CARD: "Business credit card", LINE_OF_CREDIT: "Line of credit", CASH: "Cash", OTHER: "Other",
};

export async function filterOptions(user: User, extra: Partial<FilterOptions> = {}): Promise<FilterOptions> {
  const [accounts, cats, range] = await Promise.all([
    prisma.account.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
    prisma.category.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
    dataRange(user.id),
  ]);
  const parents = cats.filter((c) => !c.parentId);
  const categories = parents.flatMap((p) => [{ id: p.id, label: p.name, depth: 0 }, ...cats.filter((c) => c.parentId === p.id).map((c) => ({ id: c.id, label: c.name, depth: 1 }))]);
  const months = range ? monthsBetween(range.first, range.last).reverse().map((m) => ({ value: m, label: monthLabel(m) })) : [];
  return {
    months, categories, accountant: user.mode === "ACCOUNTANT",
    accounts: accounts.map((a) => ({ id: a.id, label: `${a.name}${a.mask ? ` ··${a.mask}` : ""}` })),
    institutions: [...new Set(accounts.map((a) => a.institution))].sort(),
    currencies: [...new Set(accounts.map((a) => a.currency))].sort(),
    ...extra,
  };
}

export interface AccountCoverage { accountId: string; name: string; cells: CoverageCell[] }

/** Which months each account has statement data for (from import periods). */
export async function accountCoverage(userId: string, months: string[]): Promise<AccountCoverage[]> {
  const accounts = await prisma.account.findMany({ where: { userId, status: "ACTIVE" }, include: { imports: { select: { periodStart: true, periodEnd: true } }, statements: { select: { periodStart: true, periodEnd: true } } }, orderBy: { name: "asc" } });
  return accounts.map((a) => ({
    accountId: a.id, name: a.name,
    cells: coverage([...a.imports, ...a.statements].filter((p) => p.periodStart && p.periodEnd).map((p) => ({ start: p.periodStart!, end: p.periodEnd! })), months),
  }));
}

export function lastNMonths(endKey: string, n: number): string[] {
  return monthsBetween(addMonths(endKey, -(n - 1)), endKey);
}

export const thisMonthKey = () => monthKey(new Date());
