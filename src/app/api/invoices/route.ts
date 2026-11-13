import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { uploadInvoice, type UploadResult } from "@/lib/services/invoices";
import { encryptionKeyProblem } from "@/lib/crypto";
import { log } from "@/lib/log";

/** Upload supplier invoices (PDF, several at once). Each is read, stored encrypted, and checked for duplicates. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const keyProblem = encryptionKeyProblem();
  if (keyProblem) return NextResponse.json({ error: keyProblem }, { status: 500 });
  const files = (await req.formData()).getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return NextResponse.json({ error: "Choose one or more invoices (PDF)." }, { status: 400 });
  if (files.length > 100) return NextResponse.json({ error: "Upload at most 100 invoices at a time." }, { status: 400 });
  const results: UploadResult[] = [];
  for (const f of files) {
    if (f.size > 15 * 1024 * 1024) { results.push({ fileName: f.name, ok: false, error: "Larger than 15 MB." }); continue; }
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") { results.push({ fileName: f.name, ok: false, error: "Only PDF invoices can be read." }); continue; }
    try { results.push(await uploadInvoice(user.id, f.name, Buffer.from(await f.arrayBuffer()))); }
    catch (e) {
      log("warn", "invoice.upload.failed", { userId: user.id, error: (e as Error).message.slice(0, 300) });
      results.push({ fileName: f.name, ok: false, error: "We couldn't read this invoice." });
    }
  }
  revalidatePath("/reports/suppliers");
  return NextResponse.json({ results });
}
