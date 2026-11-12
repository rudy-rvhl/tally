import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { connectBank, syncConnection } from "@/lib/services/bankfeed";
import { log } from "@/lib/log";
import { encryptionKeyProblem } from "@/lib/crypto";

/** After the bank sign-in: save the connection, match its accounts, and bring in the history. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const keyProblem = encryptionKeyProblem();
  if (keyProblem) return NextResponse.json({ error: keyProblem }, { status: 500 });
  const { publicToken } = (await req.json().catch(() => ({}))) as { publicToken?: string };
  if (!publicToken || publicToken.length > 300) return NextResponse.json({ error: "The bank sign-in didn't finish. Please try again." }, { status: 400 });
  try {
    const id = await connectBank(user.id, publicToken);
    const sync = await syncConnection(id);
    revalidatePath("/", "layout");
    return NextResponse.json({ connectionId: id, sync });
  } catch (e) {
    log("warn", "bank.connect.failed", { userId: user.id, error: (e as Error).message.slice(0, 300) });
    return NextResponse.json({ error: `The connection couldn't be saved. ${(e as Error).message}` }, { status: 400 });
  }
}
