import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { commitImport, MAX_FILE_BYTES } from "@/lib/services/import";
import type { ColumnMapping } from "@/lib/engine/types";
import { log } from "@/lib/log";

const Body = z.object({
  decisions: z.record(z.string(), z.object({
    skip: z.boolean().optional(), flip: z.boolean().optional(), description: z.string().max(300).optional(), categoryId: z.string().optional(),
    kind: z.enum(["PURCHASE", "REFUND", "INCOME", "TRANSFER", "CARD_PAYMENT", "LOAN_PAYMENT", "INTEREST", "FEE", "REVERSAL", "ADJUSTMENT"]).optional(),
  })),
  includeAlreadyImported: z.array(z.number()).optional(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  openingBalanceCents: z.number().int().nullable().optional(),
  closingBalanceCents: z.number().int().nullable().optional(),
  mapping: z.any().optional(),
  section: z.number().int().min(0).nullable().optional(),
});

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const form = await req.formData();
  const file = form.get("file");
  const accountId = String(form.get("accountId") ?? "");
  if (!(file instanceof File) || !file.size || file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "The file is missing or too large." }, { status: 400 });
  const parsed = Body.safeParse(JSON.parse(String(form.get("payload") ?? "{}")));
  if (!parsed.success) return NextResponse.json({ error: "Some of your corrections couldn't be read. Please try again." }, { status: 400 });
  const p = parsed.data;
  try {
    const result = await commitImport({
      userId: user.id, accountId, fileName: file.name, buf: Buffer.from(await file.arrayBuffer()), mapping: p.mapping as ColumnMapping | undefined,
      decisions: Object.fromEntries(Object.entries(p.decisions).map(([k, v]) => [Number(k), v])),
      includeAlreadyImported: p.includeAlreadyImported, periodStart: p.periodStart, periodEnd: p.periodEnd,
      openingBalanceCents: p.openingBalanceCents, closingBalanceCents: p.closingBalanceCents, section: p.section ?? undefined,
    });
    revalidatePath("/", "layout");
    return NextResponse.json(result);
  } catch (e) {
    log("error", "import.commit.failed", { userId: user.id, error: (e as Error).message.slice(0, 200) });
    return NextResponse.json({ error: "The import didn't complete, and nothing was saved. Please try again." }, { status: 500 });
  }
}
