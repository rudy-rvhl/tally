import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Please sign in.", { status: 401 });
  const { id } = await params;
  const r = await prisma.receipt.findFirst({ where: { id, transaction: { userId: user.id } } });
  if (!r) return new Response("Not found", { status: 404 });
  const safeName = r.fileName.replace(/[^\w.\- ]/g, "_");
  return new Response(new Uint8Array(decrypt(r.data)), { headers: { "Content-Type": r.mimeType, "Content-Disposition": `inline; filename="${safeName}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" } });
}
