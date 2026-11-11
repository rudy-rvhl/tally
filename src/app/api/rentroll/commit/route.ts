import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { commitRentRoll } from "@/lib/services/rentrollImport";
import { log } from "@/lib/log";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const cents = z.number().int().nullable();
const Body = z.object({
  fileName: z.string().max(300),
  report: z.object({
    source: z.string().max(40).nullable(), asOf: day, notes: z.array(z.string()).optional().default([]),
    totals: z.any().nullable().optional(),
    properties: z.array(z.object({
      name: z.string().min(1).max(160),
      units: z.array(z.object({
        unit: z.string().max(40), layout: z.string().max(20).nullable(), sqft: z.number().int().nullable(), tenant: z.string().max(200).nullable(),
        rentCents: cents, depositCents: cents, balanceCents: cents, moveIn: day, leaseStart: day, leaseEnd: day, noLease: z.boolean(),
      })).max(2000),
    })).max(200),
  }),
  mapping: z.record(z.string(), z.object({ buildingId: z.string().nullable().optional(), createIn: z.string().nullable().optional(), accountId: z.string().nullable().optional() })),
});

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The rent roll couldn't be read. Please upload it again." }, { status: 400 });
  try {
    const { report, mapping, fileName } = parsed.data;
    const counts = await commitRentRoll(user.id, { ...report, totals: report.totals ?? null }, mapping, fileName);
    revalidatePath("/", "layout");
    return NextResponse.json(counts);
  } catch (e) {
    log("error", "rentroll.commit.failed", { userId: user.id, error: (e as Error).message.slice(0, 300) });
    return NextResponse.json({ error: `The import didn't complete. ${(e as Error).message}` }, { status: 500 });
  }
}
