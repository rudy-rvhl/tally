import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

/** Download the original statement file exactly as uploaded (audit trail). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Please sign in.", { status: 401 });
  const { id } = await params;
  const b = await prisma.importBatch.findFirst({ where: { id, userId: user.id }, omit: { encryptedFile: false } });
  if (!b?.encryptedFile) return new Response("Not found", { status: 404 });
  const safeName = b.fileName.replace(/[^\w.\- ]/g, "_");
  return new Response(new Uint8Array(decrypt(b.encryptedFile)), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${safeName}"`, "Cache-Control": "private, no-store" } });
}
