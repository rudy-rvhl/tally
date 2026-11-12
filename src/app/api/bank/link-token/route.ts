import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { linkToken } from "@/lib/services/bankfeed";
import { plaidConfigured } from "@/lib/services/plaid";

/** A one-time token for Plaid Link (the secure bank sign-in window). With `connectionId`: sign in again. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  if (!plaidConfigured()) return NextResponse.json({ error: "Bank connections aren't set up yet (PLAID_CLIENT_ID and PLAID_SECRET in .env)." }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { connectionId?: string; language?: string };
  try {
    return NextResponse.json({ linkToken: await linkToken(user.id, body.connectionId, body.language === "fr" ? "fr" : "en") });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
