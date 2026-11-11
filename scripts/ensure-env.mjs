#!/usr/bin/env node
/**
 * Runs before `npm run dev` / `npm start`: makes sure .env exists and has an encryption key.
 * A missing or empty ENCRYPTION_KEY is created. An existing key is NEVER replaced: files saved
 * with it (original statements, receipts) could no longer be opened.
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

if (!existsSync(".env")) {
  if (existsSync(".env.example")) { copyFileSync(".env.example", ".env"); console.log("  LedgerIQ: created .env from .env.example."); }
  else { writeFileSync(".env", ""); }
}
let text = readFileSync(".env", "utf8");
const line = text.match(/^\s*ENCRYPTION_KEY\s*=\s*"?([^"\r\n]*)"?\s*$/m);
const current = (process.env.ENCRYPTION_KEY || line?.[1] || "").trim();

if (!current) {
  const key = randomBytes(32).toString("base64");
  text = line ? text.replace(/^\s*ENCRYPTION_KEY\s*=.*$/m, `ENCRYPTION_KEY="${key}"`) : `${text.replace(/\n?$/, "\n")}ENCRYPTION_KEY="${key}"\n`;
  writeFileSync(".env", text);
  console.log([
    "",
    "  ────────────────────────────────────────────────────────────────────",
    "  LedgerIQ created an encryption key for this computer (in the .env file).",
    "  It protects your original statements and receipts. Keep a copy of the",
    "  ENCRYPTION_KEY line somewhere safe (e.g. your password manager).",
    "  ────────────────────────────────────────────────────────────────────",
    "",
  ].join("\n"));
} else if (Buffer.from(current, "base64").length !== 32) {
  console.log("\n  LedgerIQ: the ENCRYPTION_KEY in .env isn't a valid key (it should be 44 characters ending in \"=\").\n  It was left as is. Run `npm run doctor` for help.\n");
}
