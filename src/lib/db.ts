import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { prisma?: PrismaClient };
// Encrypted file contents (original statements, receipts) are never loaded unless a query asks
// for them explicitly with `omit: { …: false }` — only the two download routes do. Besides
// saving memory, this keeps raw binary data out of rendered pages (React's development mode
// on Node 24 fails with "ArrayBuffer is not detachable" when page data contains it).
const createClient = () => new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  omit: { importBatch: { encryptedFile: true }, receipt: { data: true } },
});
export const prisma: ReturnType<typeof createClient> = (g.prisma as ReturnType<typeof createClient> | undefined) ?? createClient();
if (process.env.NODE_ENV !== "production") g.prisma = prisma;
