#!/usr/bin/env node
/**
 * Locked out? Get a one-time password reset link from the Terminal. Nothing else changes:
 * your accounts, statements and transactions stay exactly as they are.
 *
 *   npm run reset-password                      lists the emails that have an account, then asks
 *   npm run reset-password -- you@example.com   link for that account
 *
 * Then open the link in your browser (the app must be running: npm run dev) and choose a new password.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { PrismaClient } from "@prisma/client";

if (existsSync(".env")) {
  for (const l of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
}

const prisma = new PrismaClient();
const TTL_MINUTES = 30;
try {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true, createdAt: true, _count: { select: { accounts: true, transactions: true } } },
  });
  if (!users.length) { console.log("\n  There are no accounts in this database yet. Create one at http://localhost:3000/register\n"); process.exit(0); }

  console.log("\n  Accounts in this LedgerIQ database:\n");
  users.forEach((u, i) => console.log(`  ${i + 1}. ${u.email}${u.name ? ` (${u.name})` : ""}: ${u._count.accounts} bank accounts, ${u._count.transactions} transactions, created ${u.createdAt.toISOString().slice(0, 10)}`));

  let email = (process.argv[2] ?? "").trim().toLowerCase();
  if (!email && users.length === 1) email = users[0].email;
  if (!email) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ans = (await rl.question("\n  Which one? Type its number or email: ")).trim();
    rl.close();
    email = /^\d+$/.test(ans) ? users[Number(ans) - 1]?.email ?? "" : ans.toLowerCase();
  }
  const user = users.find((u) => u.email === email);
  if (!user) { console.log(`\n  No account uses "${email}". Pick one of the emails listed above.\n`); process.exit(1); }

  const token = randomBytes(32).toString("base64url");
  const id = createHash("sha256").update(token).digest("hex");
  await prisma.$transaction([
    prisma.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.passwordReset.create({ data: { id, userId: user.id, expiresAt: new Date(Date.now() + TTL_MINUTES * 60000) } }),
  ]);
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  console.log(`\n  Reset link for ${user.email} (works once, for ${TTL_MINUTES} minutes):\n\n  ${base}/reset-password?token=${token}\n`);
  console.log("  Open it in your browser while the app is running (npm run dev) and choose a new password.");
  console.log("  Only the password changes. All your data stays.\n");
} catch (e) {
  const msg = String(e?.message ?? e);
  if (/passwordReset|does not exist|P2021/i.test(msg)) console.log("\n  The database needs an update first. Run: npx prisma migrate deploy   then try again.\n");
  else if (/connect|P1001|denied/i.test(msg)) console.log("\n  Couldn't reach the database. Start PostgreSQL, or run: npm run doctor\n");
  else console.log(`\n  Something went wrong: ${msg}\n`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
