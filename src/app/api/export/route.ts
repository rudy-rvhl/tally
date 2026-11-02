import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readFilters } from "@/lib/filters";
import { buildWhere, txnInclude } from "@/lib/services/query";
import { KIND_LABELS } from "@/lib/engine/classify";
import { isoDate } from "@/lib/engine/dates";
import { audit } from "@/lib/services/audit";

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
  const rows = await prisma.transaction.findMany({ where: await buildWhere(user.id, f), include: txnInclude, orderBy: { date: "asc" } });
  const header = ["Date", "Supplier", "Description", "Original description", "Category", "Subcategory", "Type", "Account", "Institution", "Business or personal", "Currency", "Amount", "Status", "Notes", "Transaction ID"];
  const lines = [header.map(cell).join(",")];
  for (const t of rows) {
    const cat = t.category?.parent ? t.category.parent.name : t.category?.name;
    const sub = t.category?.parent ? t.category.name : "";
    lines.push([isoDate(t.date), t.merchant?.name ?? "", t.description, t.originalDescription, t.splits.length ? "Split" : cat ?? "", sub, KIND_LABELS[t.kind].simple,
      t.account.name, t.account.institution, t.account.ownership === "BUSINESS" ? "Business" : "Personal", t.currency, (t.amountCents / 100).toFixed(2), t.status === "PENDING" ? "Pending" : "Posted", t.notes ?? "", t.id].map(cell).join(","));
  }
  await audit(prisma, user.id, "Export", "transactions", "export.csv", undefined, { filters: f, rows: rows.length });
  const name = `ledgeriq-transactions-${f.month ?? isoDate(new Date())}.csv`;
  return new Response("﻿" + lines.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}
