import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

/** The original invoice PDF (decrypted on this computer). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Please sign in.", { status: 401 });
  const { id } = await params;
  const inv = await prisma.supplierInvoice.findFirst({ where: { id, userId: user.id }, omit: { file: false } });
  if (!inv) return new Response("Not found", { status: 404 });
  const safeName = inv.fileName.replace(/[^\w.\- ]/g, "_");
  return new Response(new Uint8Array(decrypt(inv.file)), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${safeName}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" } });
}
