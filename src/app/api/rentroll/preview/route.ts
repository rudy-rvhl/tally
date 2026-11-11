import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { previewRentRoll, readRentRoll } from "@/lib/services/rentrollImport";
import { log } from "@/lib/log";

/** Read a rent roll report (PDF, CSV or Excel). Nothing is saved. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const file = (await req.formData()).get("file");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Choose your rent roll file." }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "This file is larger than 10 MB." }, { status: 400 });
  try {
    const report = await readRentRoll(file.name, Buffer.from(await file.arrayBuffer()));
    if (!report.properties.length) return NextResponse.json({ error: report.notes[0] ?? "We couldn't find any units in this file. It should list Unit, Tenant and Rent." }, { status: 400 });
    return NextResponse.json({ fileName: file.name, ...(await previewRentRoll(user.id, report)) });
  } catch (e) {
    log("warn", "rentroll.preview.failed", { userId: user.id, error: (e as Error).message.slice(0, 300) });
    return NextResponse.json({ error: "We couldn't read this file. Export the rent roll as PDF, CSV or Excel and try again." }, { status: 400 });
  }
}
