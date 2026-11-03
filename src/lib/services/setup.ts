import { prisma } from "../db";
import { DEFAULT_BOOK_CODES, DEFAULT_CATEGORIES, DEFAULT_LEDGER } from "../engine/categories";

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
  await ensureBankBookDefaults(userId);
}

/**
 * Bring an existing user's categories up to date: add default subcategories that are missing
 * and fill bank-book codes that are still empty. Never renames, moves or overwrites anything.
 */
export async function ensureBankBookDefaults(userId: string) {
  for (const c of DEFAULT_CATEGORIES) {
    const parent = await prisma.category.findFirst({ where: { userId, name: c.name, parentId: null } });
    if (!parent) continue;
    const existing = await prisma.category.findMany({ where: { userId, parentId: parent.id }, select: { name: true } });
    const missing = c.children.filter((n) => !existing.some((e) => e.name.toLowerCase() === n.toLowerCase()));
    if (missing.length) {
      await prisma.category.createMany({
        data: missing.map((name) => ({ userId, name, parentId: parent.id, kind: c.kind, ledgerCode: c.code, taxTreatment: c.tax, isSystem: true })),
        skipDuplicates: true,
      });
    }
  }
  for (const [path, code] of Object.entries(DEFAULT_BOOK_CODES)) {
    const [parentName, childName] = path.split(" > ");
    await prisma.category.updateMany({ where: { userId, name: childName, bookCode: null, parent: { name: parentName } }, data: { bookCode: code } });
  }
}
