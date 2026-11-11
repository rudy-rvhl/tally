/**
 * Organize everything from a plain-words plan (see engine/organize.ts): companies, their buildings,
 * which company/building each account belongs to, and which building each transaction is for.
 * The same function previews (apply = false) and applies, so what you approve is what happens.
 * Nothing is deleted; every change is audit-logged; your own choices on transactions are kept.
 */
import { prisma } from "../db";
import { decrypt } from "../crypto";
import { audit } from "./audit";
import { buildLines, pdfWords, statementHolder } from "../engine/parsers/pdf";
import { companyKey, mentionsBuilding, parsePlan, phraseIn, sameBuilding } from "../engine/organize";

export interface OrganizeResult {
  errors: string[];
  companies: { name: string; action: "keep" | "rename" | "create"; from?: string }[];
  buildings: { name: string; company: string; action: "keep" | "move" | "create"; from?: string; existing?: string }[];
  accounts: { label: string; holder: string | null; from: string | null; to: string | null; building: string | null; reason: string; changed: boolean }[];
  transactions: { building: string; company: string; count: number; byTenant: number }[];
  untouched: string[];
  /** Companies left with nothing in them (you can remove them in Settings). */
  empty: string[];
}

async function holderOf(batchId: string | null): Promise<string | null> {
  if (!batchId) return null;
  const b = await prisma.importBatch.findUnique({ where: { id: batchId }, select: { encryptedFile: true, fileType: true } });
  if (!b?.encryptedFile || b.fileType !== "PDF") return null;
  try {
    const w = await pdfWords(decrypt(b.encryptedFile));
    return w ? statementHolder(buildLines(w.words)) : null;
  } catch { return null; }
}

export async function organize(userId: string, text: string, apply: boolean): Promise<OrganizeResult> {
  const { companies: plan, errors } = parsePlan(text);
  const res: OrganizeResult = { errors, companies: [], buildings: [], accounts: [], transactions: [], untouched: [], empty: [] };
  if (!plan.length) { if (!errors.length) errors.push("Write at least one line: Company name: account words | buildings"); return res; }

  const companies = await prisma.company.findMany({ where: { userId }, include: { buildings: true }, orderBy: { createdAt: "asc" } });
  const allBuildings = companies.flatMap((c) => c.buildings.map((b) => ({ ...b, companyName: c.name })));

  // 1. Companies: matched by their number (or name); renamed to the plan's spelling, or created.
  const companyId = new Map<number, string>(); // plan index → company id
  for (const [i, pc] of plan.entries()) {
    const existing = companies.find((c) => companyKey(c.name) === companyKey(pc.name) && ![...companyId.values()].includes(c.id));
    if (existing) {
      const rename = existing.name !== pc.name;
      res.companies.push({ name: pc.name, action: rename ? "rename" : "keep", from: rename ? existing.name : undefined });
      if (apply && rename) {
        await prisma.company.update({ where: { id: existing.id }, data: { name: pc.name } });
        await audit(prisma, userId, "Company", existing.id, "company.rename", { name: existing.name }, { name: pc.name, source: "organize" });
      }
      companyId.set(i, existing.id);
    } else {
      res.companies.push({ name: pc.name, action: "create" });
      if (apply) {
        const c = await prisma.company.create({ data: { userId, name: pc.name } });
        await audit(prisma, userId, "Company", c.id, "company.create", undefined, { name: pc.name, source: "organize" });
        companyId.set(i, c.id);
      } else companyId.set(i, `new-company-${i}`);
    }
  }

  // 2. Buildings: matched by street number and name; moved to the right company, or created.
  const buildingIds = new Map<string, { id: string; name: string; companyIdx: number }>(); // "i|plan name" → building
  const claimed = new Set<string>();
  for (const [i, pc] of plan.entries()) {
    for (const bn of pc.buildings) {
      const existing = allBuildings.find((b) => !claimed.has(b.id) && sameBuilding(b.name, bn));
      const target = companyId.get(i)!;
      if (existing) {
        claimed.add(existing.id);
        const move = existing.companyId !== target;
        res.buildings.push({ name: bn, company: pc.name, action: move ? "move" : "keep", from: move ? existing.companyName : undefined, existing: existing.name !== bn ? existing.name : undefined });
        if (apply && move) {
          await prisma.building.update({ where: { id: existing.id }, data: { companyId: target } });
          await prisma.account.updateMany({ where: { userId, buildingId: existing.id }, data: { companyId: target } });
          await audit(prisma, userId, "Building", existing.id, "building.move", { companyId: existing.companyId }, { companyId: target, source: "organize" });
        }
        buildingIds.set(`${i}|${bn}`, { id: existing.id, name: existing.name, companyIdx: i });
      } else {
        res.buildings.push({ name: bn, company: pc.name, action: "create" });
        let id = `new-building-${i}-${bn}`;
        if (apply) {
          const b = await prisma.building.create({ data: { userId, companyId: target, name: bn } });
          await audit(prisma, userId, "Building", b.id, "building.create", undefined, { name: bn, source: "organize" });
          id = b.id;
        }
        buildingIds.set(`${i}|${bn}`, { id, name: bn, companyIdx: i });
      }
    }
  }
  const buildingsOf = (i: number) => [...buildingIds.values()].filter((b) => b.companyIdx === i);

  // 3. Accounts: by words in their name / bank / number, and the company printed on their statements.
  const accounts = await prisma.account.findMany({ where: { userId }, include: { imports: { orderBy: { createdAt: "desc" }, take: 3, select: { id: true } }, company: { select: { name: true } }, building: { select: { name: true } } } });
  const accountCompany = new Map<string, number | null>();
  const finalBuilding = new Map<string, string | null>(); // account → its building after organizing
  for (const a of accounts) finalBuilding.set(a.id, a.buildingId);
  for (const a of accounts) {
    let holder: string | null = null;
    for (const imp of a.imports) { holder = await holderOf(imp.id); if (holder) break; }
    const text = `${a.name} ${a.institution} ${a.mask ?? ""} ${holder ?? ""}`;
    const scored = plan.map((pc, i) => {
      const words = pc.accountWords.filter((w) => phraseIn(w, text));
      const byHolder = holder && companyKey(holder) === companyKey(pc.name);
      return { i, score: words.length + (byHolder ? 10 : 0), why: [...(byHolder ? [`statements are addressed to ${holder}`] : []), ...words.map((w) => `“${w}”`)] };
    }).filter((x) => x.score > 0).sort((x, y) => y.score - x.score);
    const label = `${a.institution} · ${a.name}${a.mask ? ` ··${a.mask}` : ""}`;
    const best = scored[0];
    if (!best || (scored[1] && scored[1].score === best.score)) {
      accountCompany.set(a.id, null);
      res.accounts.push({ label, holder, from: a.company?.name ?? null, to: a.company?.name ?? null, building: a.building?.name ?? null, changed: false,
        reason: best ? `Matches more than one company (${scored.filter((x) => x.score === best.score).map((x) => plan[x.i].name).join(", ")}): left as is. Add a more precise word to the plan.` : "Nothing in the plan matches it: left as is." });
      continue;
    }
    accountCompany.set(a.id, best.i);
    const target = companyId.get(best.i)!;
    // An account named after one of the company's buildings belongs to that building.
    const b = buildingsOf(best.i).find((x) => phraseIn(x.name, a.name) || sameBuilding(x.name, a.name));
    const changed = a.companyId !== target || (b ? a.buildingId !== b.id : !!a.buildingId && !buildingsOf(best.i).some((x) => x.id === a.buildingId));
    res.accounts.push({ label, holder, from: a.company?.name ?? null, to: plan[best.i].name, building: b?.name ?? (a.buildingId && buildingsOf(best.i).some((x) => x.id === a.buildingId) ? a.building?.name ?? null : null), changed, reason: `Matched by ${best.why.join(" and ")}.` });
    const keepBuilding = a.buildingId && buildingsOf(best.i).some((x) => x.id === a.buildingId);
    finalBuilding.set(a.id, b?.id ?? (keepBuilding ? a.buildingId : null));
    if (apply && changed) {
      const data = { companyId: target, buildingId: b?.id ?? (keepBuilding ? a.buildingId : null) };
      await prisma.account.update({ where: { id: a.id }, data });
      await audit(prisma, userId, "Account", a.id, "account.organize", { companyId: a.companyId, buildingId: a.buildingId }, { ...data, source: "organize" });
    }
  }

  // 4. Transactions on accounts used by several buildings: rent goes to the tenant's building; other money
  //    to a building when its description names it. Transactions already given a building are kept.
  const tenants = await prisma.tenant.findMany({ where: { userId }, select: { id: true, buildingId: true } });
  const tenantBuilding = new Map(tenants.map((t) => [t.id, t.buildingId]));
  const txns = await prisma.transaction.findMany({ where: { userId, excluded: false, buildingId: null }, select: { id: true, accountId: true, description: true, originalDescription: true, tenantId: true } });
  const assign = new Map<string, { ids: string[]; byTenant: number; company: string; name: string }>();
  const allPlanBuildings = [...buildingIds.values()];
  for (const t of txns) {
    const ci = accountCompany.get(t.accountId);
    if (finalBuilding.get(t.accountId)) continue; // the account's building already applies
    const pool = ci === null || ci === undefined ? allPlanBuildings : buildingsOf(ci);
    let target = t.tenantId ? pool.find((b) => b.id === tenantBuilding.get(t.tenantId!)) : undefined;
    const viaTenant = !!target;
    if (!target) {
      const hits = pool.filter((b) => mentionsBuilding(b.name, `${t.description} ${t.originalDescription}`));
      if (hits.length === 1) target = hits[0];
    }
    if (!target) continue;
    const g = assign.get(target.id) ?? { ids: [], byTenant: 0, company: plan[target.companyIdx].name, name: target.name };
    g.ids.push(t.id); if (viaTenant) g.byTenant++;
    assign.set(target.id, g);
  }
  for (const [bid, g] of assign) {
    res.transactions.push({ building: g.name, company: g.company, count: g.ids.length, byTenant: g.byTenant });
    if (apply && !bid.startsWith("new-")) {
      await prisma.transaction.updateMany({ where: { id: { in: g.ids }, buildingId: null }, data: { buildingId: bid } });
      await audit(prisma, userId, "Building", bid, "transactions.organize", undefined, { count: g.ids.length, byTenant: g.byTenant, source: "organize" });
    }
  }
  // Companies not in the plan that still hold accounts.
  const planned = new Set(companyId.values());
  res.untouched = companies.filter((c) => !planned.has(c.id) && accounts.some((a) => a.companyId === c.id && accountCompany.get(a.id) == null)).map((c) => c.name);
  // Companies not in the plan that will have no accounts and no buildings left.
  const movedBuildings = new Set([...buildingIds.values()].map((b) => b.id));
  res.empty = companies.filter((c) => !planned.has(c.id) && !c.buildings.some((b) => !movedBuildings.has(b.id)) && !accounts.some((a) => a.companyId === c.id && accountCompany.get(a.id) == null)).map((c) => c.name);
  return res;
}
