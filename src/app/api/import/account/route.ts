import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/services/audit";
import { defaultCompany, resolveScope } from "@/lib/scope";

const Body = z.object({
  institution: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  type: z.enum(["PERSONAL_CHEQUING", "PERSONAL_SAVINGS", "BUSINESS_SAVINGS", "CREDIT_CARD", "BUSINESS_CHEQUING", "BUSINESS_CREDIT_CARD", "LINE_OF_CREDIT", "CASH", "OTHER"]),
  ownership: z.enum(["BUSINESS", "PERSONAL"]),
  currency: z.enum(["CAD", "USD"]),
  mask: z.string().regex(/^\d{4}$/).nullable().optional(),
});

/** Bulk import: create the account a statement belongs to, in the company/building being viewed. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Some account details are missing." }, { status: 400 });
  const d = parsed.data;
  // Same bank + same last 4 + same kind of account already exists (e.g. created a moment ago by another file): reuse it.
  if (d.mask) {
    const same = await prisma.account.findFirst({ where: { userId: user.id, mask: d.mask, institution: d.institution, type: d.type } });
    if (same) return NextResponse.json({ id: same.id, created: false });
  }
  const scope = await resolveScope(user.id);
  const companyId = scope.company?.id ?? (await defaultCompany(user.id)).id;
  const data = { ...d, mask: d.mask ?? null, companyId, buildingId: scope.building?.id ?? null };
  const a = await prisma.account.create({ data: { ...data, userId: user.id } });
  await audit(prisma, user.id, "Account", a.id, "account.create", undefined, { ...data, source: "bulk import" });
  return NextResponse.json({ id: a.id, created: true });
}
