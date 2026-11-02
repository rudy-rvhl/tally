import { prisma } from "../db";
import { DEFAULT_CATEGORIES, DEFAULT_LEDGER } from "../engine/categories";

/** Create the default category tree and chart of accounts for a new user. */
export async function setupNewUser(userId: string) {
  for (const c of DEFAULT_CATEGORIES) {
    const parent = await prisma.category.create({ data: { userId, name: c.name, kind: c.kind, ledgerCode: c.code, taxTreatment: c.tax, isSystem: true } });
    await prisma.category.createMany({
      data: c.children.map((name) => ({ userId, name, parentId: parent.id, kind: c.kind, ledgerCode: c.code, taxTreatment: c.tax, isSystem: true })),
    });
  }
  await prisma.ledgerAccount.createMany({ data: DEFAULT_LEDGER.map((l) => ({ ...l, userId })), skipDuplicates: true });
}
