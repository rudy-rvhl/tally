/**
 * Import a rent roll report (PDF, CSV or Excel) into the rent roll. Preview first (nothing saved),
 * then commit. Re-importing a newer report updates rents, leases and balances; a new tenant in a
 * unit moves the previous one to "former tenants" (kept, never deleted).
 */
import Papa from "papaparse";
import { prisma } from "../db";
import { audit } from "./audit";
import { buildLines, pdfWords } from "../engine/parsers/pdf";
import { parseRentRollLines, parseRentRollTable, rentRollCheck, type RentRollReport, type RentRollUnit } from "../engine/parsers/rentroll";
import { companyTree } from "../scope";

const DAY = 86400000;

export async function readRentRoll(fileName: string, buf: Buffer): Promise<RentRollReport> {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") {
    const w = await pdfWords(buf);
    if (!w) return { source: null, asOf: null, properties: [], totals: null, notes: ["This PDF is a scanned image. Export the rent roll as PDF, CSV or Excel from your software instead."] };
    return parseRentRollLines(buildLines(w.words));
  }
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = (row.values as unknown[]).slice(1).map((v) => (v instanceof Date ? `${String(v.getUTCMonth() + 1).padStart(2, "0")}/${String(v.getUTCDate()).padStart(2, "0")}/${v.getUTCFullYear()}` : v && typeof v === "object" && "result" in (v as object) ? String((v as { result: unknown }).result ?? "") : String(v ?? "")));
      rows.push(vals);
    });
    return parseRentRollTable(rows);
  }
  const parsed = Papa.parse<string[]>(buf.toString("utf8").replace(/^﻿/, ""), { skipEmptyLines: false });
  return parseRentRollTable(parsed.data);
}

/** "100 Av. Exemple" → "100 exemple": street number + first real word of the street. */
export function addressKey(s: string): string {
  const t = s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const num = t.match(/\d+[a-z]?/)?.[0] ?? "";
  const words = t.replace(/\d+[a-z]?/g, " ").split(/[^a-z]+/).filter((w) => w.length > 2 && !["av", "ave", "avenue", "rue", "street", "boul", "blvd", "boulevard", "chemin", "road", "des", "the", "unit"].includes(w));
  return `${num} ${words[0] ?? ""}`.trim();
}
export const unitKey = (u: string) => u.toLowerCase().replace(/^(unit|apt|app|appartement|logement|suite|#)\s*/i, "").replace(/^0+(?=\d)/, "").trim();
const nameWords = (n: string) => new Set(n.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !["and", "others", "other"].includes(w)));
export const sameTenant = (a: string, b: string) => { const x = nameWords(a), y = nameWords(b); return [...x].some((w) => y.has(w)); };

export async function previewRentRoll(userId: string, report: RentRollReport) {
  const companies = await companyTree(userId);
  const buildings = companies.flatMap((c) => c.buildings.map((b) => ({ ...b, companyId: c.id, company: c.name })));
  const tenants = await prisma.tenant.findMany({ where: { userId, status: { in: ["ACTIVE", "VACANT"] } }, select: { id: true, buildingId: true, unit: true, name: true, status: true, rentCents: true } });
  const properties = report.properties.map((p) => {
    const key = addressKey(p.name);
    const match = buildings.find((b) => addressKey(b.name) === key || (b.address && addressKey(b.address) === key));
    const units = p.units.map((u) => {
      const here = match ? tenants.filter((t) => t.buildingId === match.id && t.unit && unitKey(t.unit) === unitKey(u.unit)) : [];
      const active = here.find((t) => t.status === "ACTIVE");
      const action = !u.tenant ? (active ? "moved out" : "vacant") : !active ? "new" : sameTenant(active.name, u.tenant) ? (active.rentCents !== (u.rentCents ?? 0) ? "update (rent changed)" : "update") : `replaces ${active.name}`;
      return { ...u, action };
    });
    return { name: p.name, buildingId: match?.id ?? null, units };
  });
  return { report, check: rentRollCheck(report), properties, buildings, companies };
}

export interface CommitMapping { [property: string]: { buildingId?: string | null; createIn?: string | null; accountId?: string | null } }

export async function commitRentRoll(userId: string, report: RentRollReport, mapping: CommitMapping, fileName: string) {
  const asOf = report.asOf ? new Date(`${report.asOf}T00:00:00Z`) : new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const source = `Rent roll import${report.source ? ` (${report.source})` : ""} ${asOf.toISOString().slice(0, 10)}`;
  const counts = { created: 0, updated: 0, movedOut: 0, vacant: 0, buildingsCreated: 0 };
  const d = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null);
  for (const p of report.properties) {
    const m = mapping[p.name] ?? {};
    let buildingId = m.buildingId ?? null;
    if (buildingId && !(await prisma.building.findFirst({ where: { id: buildingId, userId } }))) throw new Error(`Building for ${p.name} not found.`);
    if (!buildingId) {
      const company = m.createIn ? await prisma.company.findFirst({ where: { id: m.createIn, userId } }) : await prisma.company.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
      if (!company) throw new Error("Add a company first (Settings).");
      const existing = await prisma.building.findFirst({ where: { companyId: company.id, name: p.name } });
      const b = existing ?? await prisma.building.create({ data: { userId, companyId: company.id, name: p.name } });
      if (!existing) { counts.buildingsCreated++; await audit(prisma, userId, "Building", b.id, "building.create", undefined, { name: p.name, source }); }
      buildingId = b.id;
    }
    const accountId = m.accountId && (await prisma.account.findFirst({ where: { id: m.accountId, userId } })) ? m.accountId : null;
    for (const u of p.units) await importUnit(userId, buildingId, accountId, u, asOf, source, counts, d);
  }
  await audit(prisma, userId, "RentRoll", "import", "rentroll.import", undefined, { fileName, source, ...counts });
  return counts;
}

async function importUnit(userId: string, buildingId: string, accountId: string | null, u: RentRollUnit, asOf: Date, source: string, counts: Record<string, number>, d: (s: string | null) => Date | null) {
  const here = (await prisma.tenant.findMany({ where: { userId, buildingId, status: { in: ["ACTIVE", "VACANT"] } } })).filter((t) => t.unit && unitKey(t.unit) === unitKey(u.unit));
  const active = here.find((t) => t.status === "ACTIVE");
  const placeholders = here.filter((t) => t.status === "VACANT");
  const details = { layout: u.layout, sqft: u.sqft, unit: u.unit };
  if (!u.tenant) {
    if (active) {
      await prisma.tenant.update({ where: { id: active.id }, data: { status: "PAST", leaseEnd: active.leaseEnd && active.leaseEnd < asOf ? active.leaseEnd : asOf } });
      await audit(prisma, userId, "Tenant", active.id, "tenant.move_out", { status: "ACTIVE" }, { status: "PAST", source });
      counts.movedOut++;
    }
    if (!placeholders.length) {
      const t = await prisma.tenant.create({ data: { userId, buildingId, name: "Vacant", status: "VACANT", rentCents: active?.rentCents ?? 0, ...details, source } });
      await audit(prisma, userId, "Tenant", t.id, "unit.vacant", undefined, { unit: u.unit, source });
    }
    counts.vacant++;
    return;
  }
  const data = {
    name: u.tenant, rentCents: u.rentCents ?? 0, depositCents: u.depositCents && u.depositCents > 0 ? u.depositCents : null,
    moveIn: d(u.moveIn), leaseStart: d(u.leaseStart) ?? d(u.moveIn), leaseEnd: d(u.leaseEnd),
    // "-" on the report means nothing is owed.
    reportedBalanceCents: u.balanceCents ?? 0, reportedBalanceAsOf: asOf, ...details,
    notes: u.noLease ? "No lease on file in the rent roll report." : undefined,
  };
  // Placeholders for an empty unit aren't records of anything: remove them once the unit is rented.
  if (placeholders.length) await prisma.tenant.deleteMany({ where: { id: { in: placeholders.map((t) => t.id) } } });
  if (active && sameTenant(active.name, u.tenant)) {
    await prisma.tenant.update({ where: { id: active.id }, data: { ...data, name: active.name.length >= u.tenant.length ? active.name : u.tenant, ...(accountId && !active.accountId ? { accountId } : {}) } });
    await audit(prisma, userId, "Tenant", active.id, "tenant.update", { rentCents: active.rentCents, leaseEnd: active.leaseEnd }, { rentCents: data.rentCents, leaseEnd: data.leaseEnd, source });
    counts.updated++;
    return;
  }
  if (active) {
    const end = data.moveIn ? new Date(data.moveIn.getTime() - DAY) : asOf;
    await prisma.tenant.update({ where: { id: active.id }, data: { status: "PAST", leaseEnd: end } });
    await audit(prisma, userId, "Tenant", active.id, "tenant.move_out", { status: "ACTIVE" }, { status: "PAST", leaseEnd: end, source });
    counts.movedOut++;
  }
  const t = await prisma.tenant.create({ data: { userId, buildingId, accountId, status: "ACTIVE", source, ...data } });
  await audit(prisma, userId, "Tenant", t.id, "tenant.create", undefined, { ...data, source });
  counts.created++;
}
