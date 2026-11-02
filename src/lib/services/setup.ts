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
  // Card payments settle the card liability; loan payments reduce the loan.
  await prisma.category.updateMany({ where: { userId, name: "Credit card payments" }, data: { ledgerCode: "2100" } });
  await prisma.category.updateMany({ where: { userId, name: "Loan and mortgage payments" }, data: { ledgerCode: "2200" } });
  await prisma.ledgerAccount.createMany({ data: DEFAULT_LEDGER.map((l) => ({ ...l, userId })), skipDuplicates: true });
}
