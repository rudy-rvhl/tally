import { currentUser } from "@/lib/auth";
import { bankBookXlsx } from "@/lib/services/bankbook";
import { audit } from "@/lib/services/audit";
import { prisma } from "@/lib/db";

/** GET /api/export/bankbook?start=2025-08&detail=grouped|full&account=<id>&account=<id> */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Please sign in.", { status: 401 });
  const url = new URL(req.url);
  const start = url.searchParams.get("start") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(start)) return new Response("Choose the first month of the fiscal year (YYYY-MM).", { status: 400 });
  const grouped = url.searchParams.get("detail") !== "full";
  const accountIds = url.searchParams.getAll("account").filter(Boolean);
  const { buffer, fileName } = await bankBookXlsx(user, { firstMonth: start, grouped, accountIds });
  await audit(prisma, user.id, "Export", "bankbook", "export.bankbook", undefined, { start, grouped, accounts: accountIds.length || "all" });
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
