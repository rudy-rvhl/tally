import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { checkSupplierFile } from "@/lib/services/supplier";
import { log } from "@/lib/log";

/** Check a supplier's statement against your bank transactions. The file isn't kept. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Choose the supplier's statement." }, { status: 400 });
  if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "This file is larger than 15 MB." }, { status: 400 });
  const otherName = String(form.get("name") ?? "").trim().slice(0, 80) || undefined;
  try {
    const r = await checkSupplierFile(user.id, file.name, Buffer.from(await file.arrayBuffer()), otherName);
    if (!r.check) return NextResponse.json({ error: r.statement.notes[0] ?? "We couldn't find any dated lines with amounts on this statement." }, { status: 400 });
    return NextResponse.json(r);
  } catch (e) {
    log("warn", "supplier.check.failed", { userId: user.id, error: (e as Error).message.slice(0, 300) });
    return NextResponse.json({ error: (e as Error).message || "We couldn't read this statement." }, { status: 400 });
  }
}
