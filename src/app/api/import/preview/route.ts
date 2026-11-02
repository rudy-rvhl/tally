import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { previewImport, MAX_FILE_BYTES } from "@/lib/services/import";
import type { ColumnMapping } from "@/lib/engine/types";
import { log } from "@/lib/log";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const form = await req.formData();
  const file = form.get("file");
  const accountId = String(form.get("accountId") ?? "");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Choose a statement file to upload." }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "This file is larger than 10 MB. Please upload one statement at a time." }, { status: 400 });
  if (!accountId) return NextResponse.json({ error: "Choose which account this statement belongs to." }, { status: 400 });
  let mapping: ColumnMapping | undefined;
  try { mapping = form.get("mapping") ? (JSON.parse(String(form.get("mapping"))) as ColumnMapping) : undefined; } catch { mapping = undefined; }
  try {
    const preview = await previewImport(user.id, accountId, file.name, Buffer.from(await file.arrayBuffer()), mapping);
    return NextResponse.json(preview);
  } catch (e) {
    log("warn", "import.preview.failed", { userId: user.id, error: (e as Error).name });
    return NextResponse.json({ error: (e as Error).message.startsWith("That account") ? (e as Error).message : "We couldn't read this file. Make sure it's a statement downloaded from your bank (CSV, Excel, OFX, QFX or PDF)." }, { status: 400 });
  }
}
