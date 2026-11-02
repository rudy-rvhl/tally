import { prisma } from "../db";
import { classifyCategory, detectKind, type CategoryContext, type CategoryResult } from "../engine/classify";
import { identifyMerchant, type MerchantMatch } from "../engine/merchants";
import type { AccountTypeName, TxnKindName } from "../engine/types";

export interface ClassifierContext extends CategoryContext {
  aliases: Map<string, string>;
  categoryLabel: (id: string | null) => string;
  categories: { id: string; name: string; parentId: string | null; parentName: string | null }[];
}

export async function loadClassifierContext(userId: string): Promise<ClassifierContext> {
  const [cats, rules, aliases, merchants, confirmed] = await Promise.all([
    prisma.category.findMany({ where: { userId }, include: { parent: { select: { name: true } } } }),
    prisma.categoryRule.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    prisma.merchantAlias.findMany({ where: { merchant: { userId } }, include: { merchant: { select: { name: true } } } }),
    prisma.merchant.findMany({ where: { userId, defaultCategoryId: { not: null } }, select: { name: true, defaultCategoryId: true } }),
    prisma.transaction.groupBy({
      by: ["merchantId", "categoryId"], where: { userId, categoryConfirmed: true, merchantId: { not: null }, categoryId: { not: null } }, _count: { _all: true },
    }),
  ]);
  const byPath = new Map<string, string>();
  const label = new Map<string, string>();
  for (const c of cats) {
    const path = c.parent ? `${c.parent.name} > ${c.name}` : c.name;
    byPath.set(path.toLowerCase(), c.id);
    label.set(c.id, c.parent ? `${c.parent.name} › ${c.name}` : c.name);
  }
  const merchantNames = new Map((await prisma.merchant.findMany({ where: { userId }, select: { id: true, name: true } })).map((m) => [m.id, m.name]));
  const best = new Map<string, { cat: string; n: number }>();
  for (const g of confirmed) {
    const name = merchantNames.get(g.merchantId!);
    if (!name) continue;
    const cur = best.get(name);
    if (!cur || g._count._all > cur.n) best.set(name, { cat: g.categoryId!, n: g._count._all });
  }
  return {
    rules: rules.map((r) => ({ id: r.id, pattern: r.pattern, categoryId: r.categoryId, accountId: r.accountId, kind: r.kind })),
    history: new Map([...best].map(([k, v]) => [k, v.cat])),
    merchantDefaults: new Map(merchants.map((m) => [m.name, m.defaultCategoryId!])),
    pathToId: (p) => byPath.get(p.toLowerCase()) ?? null,
    aliases: new Map(aliases.map((a) => [a.pattern, a.merchant.name])),
    categoryLabel: (id) => (id ? label.get(id) ?? "Uncategorized" : "Uncategorized"),
    categories: cats.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId, parentName: c.parent?.name ?? null })),
  };
}

export interface Classification {
  kind: TxnKindName;
  kindConfidence: number;
  merchant: MerchantMatch;
  category: CategoryResult;
}

const NON_MERCHANT_KINDS: TxnKindName[] = ["TRANSFER", "CARD_PAYMENT", "LOAN_PAYMENT", "INTEREST", "FEE", "ADJUSTMENT"];

export function classify(ctx: ClassifierContext, description: string, amountCents: number, accountType: AccountTypeName, accountId: string): Classification {
  const k = detectKind(description, amountCents, accountType);
  const merchant = identifyMerchant(description, ctx.aliases);
  if (NON_MERCHANT_KINDS.includes(k.kind)) merchant.confidence = Math.min(merchant.confidence, 0.5);
  const category = classifyCategory(
    { description, merchantName: merchant.name, kind: k.kind, accountId, suggestedCategory: merchant.suggestedCategory },
    ctx,
  );
  return { kind: k.kind, kindConfidence: k.confidence, merchant, category };
}
