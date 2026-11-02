/**
 * Email + password authentication with server-side sessions.
 * The cookie holds a random token; the database stores only its SHA-256 hash.
 */
import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { cache } from "react";
import { prisma } from "./db";

const COOKIE = "liq_session";
const TTL_DAYS = 30;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

export async function hashPassword(pw: string) { return bcrypt.hash(pw, 12); }
export async function verifyPassword(pw: string, h: string) { return bcrypt.compare(pw, h); }

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_DAYS * 86400000);
  await prisma.session.create({ data: { id: hash(token), userId, expiresAt } });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    path: "/", expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { id: hash(token) } });
  jar.delete(COOKIE);
}

export const currentUser = cache(async () => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const s = await prisma.session.findUnique({ where: { id: hash(token) }, include: { user: true } });
  if (!s || s.expiresAt < new Date()) return null;
  return s.user;
});

export async function requireUser() {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}
