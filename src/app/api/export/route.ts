import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readFilters } from "@/lib/filters";
import { buildWhere, txnInclude } from "@/lib/services/query";
import { KIND_LABELS } from "@/lib/engine/classify";
import { isoDate } from "@/lib/engine/dates";
import { audit } from "@/lib/services/audit";
import { companyTree } from "@/lib/scope";

/** Neutralise spreadsheet formula injection and quote every cell. */
function cell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Please sign in.", { status: 401 });
  const f = readFilters(Object.fromEntries(new URL(req.url).searchParams));
  // Downloads always include every company and building (with a column for each), so one
  // file covers everything; the other filters (month, category, …) still apply.
  const rows = await prisma.transaction.findMany({ where: await buildWhere(user.id, { ...f, scope: "all" }), include: txnInclude, orderBy: { date: "asc" } });
  const companies = await companyTree(user.id);
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const buildingName = new Map(companies.flatMap((c) => c.buildings.map((b) => [b.id, b.name] as const)));
  const header = ["Date", "Company", "Building", "Supplier", "Description", "Original description", "Category", "Subcategory", "Type", "Account", "Institution", "Business or personal", "Currency", "Amount", "Status", "Notes", "Transaction ID"];
  const lines = [header.map(cell).join(",")];
  for (const t of rows) {
    const cat = t.category?.parent ? t.category.parent.name : t.category?.name;
    const sub = t.category?.parent ? t.category.name : "";
    const bId = t.buildingId ?? t.account.buildingId;
    const cId = t.building?.companyId ?? t.account.companyId;
    lines.push([isoDate(t.date), (cId && companyName.get(cId)) ?? "", (bId && buildingName.get(bId)) ?? "", t.merchant?.name ?? "", t.description, t.originalDescription, t.splits.length ? "Split" : cat ?? "", sub, KIND_LABELS[t.kind].simple,
      t.account.name, t.account.institution, t.account.ownership === "BUSINESS" ? "Business" : "Personal", t.currency, (t.amountCents / 100).toFixed(2), t.status === "PENDING" ? "Pending" : "Posted", t.notes ?? "", t.id].map(cell).join(","));
  }
  await audit(prisma, user.id, "Export", "transactions", "export.csv", undefined, { filters: f, rows: rows.length });
  const name = `ledgeriq-transactions-${f.month ?? isoDate(new Date())}.csv`;
  return new Response("﻿" + lines.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}
