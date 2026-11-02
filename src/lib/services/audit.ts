import type { Prisma } from "@prisma/client";
import { prisma } from "../db";

type Tx = Prisma.TransactionClient | typeof prisma;

/** Every change to financial data is recorded with before/after values. */
export async function audit(db: Tx, userId: string, entityType: string, entityId: string, action: string, before?: unknown, after?: unknown) {
  await db.auditLog.create({
    data: {
      userId, entityType, entityId, action,
      before: before === undefined ? undefined : (JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue),
      after: after === undefined ? undefined : (JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue),
    },
  });
}
