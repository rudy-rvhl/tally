import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { detectStatement } from "@/lib/services/bulk";
import { MAX_FILE_BYTES } from "@/lib/services/import";
import { log } from "@/lib/log";

/** Bulk import: read one file (nothing is saved) and say which account it belongs to. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const file = (await req.formData()).get("file");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "The file is empty." }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "This file is larger than 10 MB." }, { status: 400 });
  try {
    return NextResponse.json(await detectStatement(user.id, file.name, Buffer.from(await file.arrayBuffer())));
  } catch (e) {
    log("warn", "import.detect.failed", { userId: user.id, error: (e as Error).message.slice(0, 300) });
    return NextResponse.json({ error: "We couldn't read this file. Make sure it's a statement downloaded from your bank (CSV, Excel, OFX, QFX or PDF)." }, { status: 400 });
  }
}
