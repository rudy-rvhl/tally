/**
 * Password recovery without losing any data: a one-time link (30 minutes) sets a new password.
 * LedgerIQ runs on your own computer and doesn't send email, so the link is printed in the
 * terminal running the app (only someone at that computer can see it), or produced with
 * `npm run reset-password`. Only the token's hash is stored.
 */
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db";
import { audit } from "./audit";

export const RESET_TTL_MINUTES = 30;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

/** A new reset token for this user; earlier unused links stop working. */
export async function createResetToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    prisma.passwordReset.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.passwordReset.create({ data: { id: hash(token), userId, expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60000) } }),
  ]);
  return token;
}

/** The user a still-valid token belongs to, or null. */
export async function checkResetToken(token: string) {
  if (!token || token.length > 200) return null;
  const r = await prisma.passwordReset.findUnique({ where: { id: hash(token) }, include: { user: { select: { id: true, email: true } } } });
  if (!r || r.usedAt || r.expiresAt < new Date()) return null;
  return r.user;
}

/** Set the new password, use up the link and sign out every other session. Data is not touched. */
export async function completeReset(token: string, passwordHash: string): Promise<{ id: string; email: string } | null> {
  const user = await checkResetToken(token);
  if (!user) return null;
  const used = await prisma.passwordReset.updateMany({ where: { id: hash(token), usedAt: null }, data: { usedAt: new Date() } });
  if (!used.count) return null; // the same link used twice at the same moment
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);
  await audit(prisma, user.id, "User", user.id, "password.reset", undefined, { via: "reset link" });
  return user;
}

export function printResetLink(email: string, url: string) {
  const line = "─".repeat(72);
  console.log(`\n${line}\n  LedgerIQ password reset for ${email}\n  Open this link within ${RESET_TTL_MINUTES} minutes (it works once):\n\n  ${url}\n${line}\n`);
}
