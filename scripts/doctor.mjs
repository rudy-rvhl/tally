#!/usr/bin/env node
/**
 * LedgerIQ setup checkup.
 *   npm run doctor          explain what's wrong with the database connection
 *   npm run doctor -- --fix also create the ledgeriq user/database and tables if missing
 *
 * Prints the real PostgreSQL error (Prisma hides it), which server is listening on the
 * port, and the exact next step.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

const FIX = process.argv.includes("--fix");
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => console.log(`  ✗ ${m}`);
const info = (m) => console.log(`    ${m}`);
const has = (cmd) => spawnSync(process.platform === "win32" ? "where" : "which", [cmd]).status === 0;
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });

/** psql is often installed but not on the PATH (Postgres.app, Homebrew postgresql@16). Look in the usual places. */
function findPsql() {
  if (has("psql")) return "psql";
  const globs = [
    ["/Applications/Postgres.app/Contents/Versions", "bin/psql"],
    ["/opt/homebrew/opt", "bin/psql", /^(postgresql|libpq)/],
    ["/usr/local/opt", "bin/psql", /^(postgresql|libpq)/],
    ["/usr/lib/postgresql", "bin/psql"],
    ["C:\\Program Files\\PostgreSQL", "bin\\psql.exe"],
  ];
  for (const [dir, rel, re] of globs) {
    if (!existsSync(dir)) continue;
    const subs = readdirSync(dir).filter((d) => !re || re.test(d)).sort().reverse();
    for (const sub of subs) { const p = path.join(dir, sub, rel); if (existsSync(p)) return p; }
  }
  for (const p of ["/opt/homebrew/bin/psql", "/usr/local/bin/psql"]) if (existsSync(p)) return p;
  return null;
}
const PSQL = findPsql();

console.log("\nLedgerIQ checkup\n");

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 22) {
  bad(`Node.js ${process.versions.node} is too old. LedgerIQ needs Node 22 or newer.`);
  info("Install the current LTS from https://nodejs.org (or `brew install node@22`), open a new Terminal, then run `npm ci`.");
} else ok(`Node.js ${process.versions.node}`);

// 1. .env and DATABASE_URL
if (!existsSync(".env")) { bad("No .env file. Run: cp .env.example .env"); process.exit(1); }
const envFile = Object.fromEntries(readFileSync(".env", "utf8").split(/\r?\n/).filter((l) => /^\s*[A-Z_]+=/.test(l)).map((l) => {
  const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"(.*)"$/, "$1")];
}));
if (process.env.DATABASE_URL && process.env.DATABASE_URL !== envFile.DATABASE_URL) {
  bad("A DATABASE_URL set in your Terminal overrides the one in .env.");
  info(`Terminal: ${process.env.DATABASE_URL.replace(/:[^:@/]+@/, ":****@")}`);
  info("Fix: run `unset DATABASE_URL` (and remove it from ~/.zshrc if it's there), then try again.");
}
const url = process.env.DATABASE_URL || envFile.DATABASE_URL;
if (!url) { bad("DATABASE_URL is missing from .env."); process.exit(1); }
let u;
try { u = new URL(url); } catch { bad(`DATABASE_URL isn't a valid URL: ${url}`); process.exit(1); }
const conn = { user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), host: u.hostname, port: u.port || "5432", db: u.pathname.slice(1) };
ok(`.env found. Database: ${conn.user}@${conn.host}:${conn.port}/${conn.db}`);

const key = envFile.ENCRYPTION_KEY;
if (!key) {
  if (FIX) {
    // Only ever fill an EMPTY key: replacing a key would make previously stored files unreadable.
    const k = randomBytes(32).toString("base64");
    let text = readFileSync(".env", "utf8");
    text = /^\s*ENCRYPTION_KEY=.*$/m.test(text) ? text.replace(/^\s*ENCRYPTION_KEY=.*$/m, `ENCRYPTION_KEY="${k}"`) : `${text.replace(/\n?$/, "\n")}ENCRYPTION_KEY="${k}"\n`;
    writeFileSync(".env", text);
    ok("ENCRYPTION_KEY was empty, so a new one was created in .env. Keep a copy somewhere safe.");
  } else bad("ENCRYPTION_KEY is empty in .env. Imports won't save until it's set. Fix: npm run doctor -- --fix");
} else if (Buffer.from(key, "base64").length !== 32) bad("ENCRYPTION_KEY isn't a valid 32-byte key (see .env.example).");
else ok("ENCRYPTION_KEY is set.");

// 2. Who is listening on the port?
if (has("lsof")) {
  const l = run("lsof", ["-nP", `-iTCP:${conn.port}`, "-sTCP:LISTEN"]);
  const procs = [...new Set((l.stdout || "").split("\n").slice(1).filter(Boolean).map((x) => x.split(/\s+/)[0]))];
  if (!procs.length) { bad(`Nothing is listening on port ${conn.port}. PostgreSQL isn't running.`); info("Start it: open Postgres.app, or `brew services start postgresql@16`, or `docker start ledgeriq-db`."); }
  else ok(`Listening on port ${conn.port}: ${procs.join(", ")}${procs.some((p) => /docker|com\.docke|vpnkit/i.test(p)) ? " (Docker)" : ""}`);
  if (procs.length > 1) info("More than one program is using this port. Quit the one you don't use (e.g. Postgres.app or the Docker container).");
}

// 3. Try to connect with the app's credentials and show PostgreSQL's own message.
if (!PSQL) {
  bad("Couldn't find psql (PostgreSQL's command-line tool), so the database can't be checked.");
  info("Install it with Homebrew: brew install libpq   (or reinstall Postgres.app), then run this again.");
} else {
  if (PSQL !== "psql") ok(`Using psql at ${PSQL}`);
  const env = { ...process.env, PGPASSWORD: conn.password, PGCONNECT_TIMEOUT: "5" };
  const test = run(PSQL, ["-h", conn.host, "-p", conn.port, "-U", conn.user, "-d", conn.db, "-tAc", "select current_user"], { env });
  if (test.status === 0) {
    ok(`Connected as ${test.stdout.trim()}.`);
    const t = run(PSQL, ["-h", conn.host, "-p", conn.port, "-U", conn.user, "-d", conn.db, "-tAc", "select count(*) from information_schema.tables where table_name='Session'"], { env });
    if (t.stdout?.trim() === "1") ok("Tables exist.");
    else { bad("The tables haven't been created."); info("Fix: npx prisma migrate deploy"); if (FIX) execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit" }); }
  } else {
    const lines = (test.stderr || "").trim().split("\n").map((l) => l.trim()).filter(Boolean);
    const msg = (lines.find((l) => /FATAL|error/i.test(l)) ?? lines[0] ?? "unknown error").replace(/^psql: (error: )?/, "");
    bad(`PostgreSQL refused the connection: ${msg}`);
    const missingRole = /role .* does not exist|password authentication failed|no pg_hba|permission denied|database .* does not exist/i.test(msg);
    if (missingRole) {
      info("The running PostgreSQL doesn't have the ledgeriq user/database (or a different password).");
      if (!FIX) info("Fix automatically: npm run doctor -- --fix");
      else {
        console.log("\n  Creating the ledgeriq user and database as your administrator account...");
        // As your own (administrator) account: try the local socket first (how Postgres.app/Homebrew trust you), then TCP.
        const local = ["localhost", "127.0.0.1", "::1"].includes(conn.host);
        const admin = (sql, db = "postgres") => {
          const viaSocket = local ? run(PSQL, ["-p", conn.port, "-d", db, "-v", "ON_ERROR_STOP=1", "-tAc", sql]) : null;
          return viaSocket && viaSocket.status === 0 ? viaSocket : run(PSQL, ["-h", conn.host, "-p", conn.port, "-d", db, "-v", "ON_ERROR_STOP=1", "-tAc", sql]);
        };
        const pw = conn.password.replace(/'/g, "''");
        let r = admin(`DO $$BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${conn.user}') THEN CREATE ROLE "${conn.user}" LOGIN PASSWORD '${pw}' CREATEDB; ELSE ALTER ROLE "${conn.user}" LOGIN PASSWORD '${pw}'; END IF; END$$;`);
        if (r.status !== 0) {
          bad(`Couldn't create the user: ${(r.stderr || "").trim().split("\n").pop()}`);
          info("Your Mac account may not be a PostgreSQL administrator. If you use Docker, run `docker start ledgeriq-db` and quit Postgres.app instead.");
          process.exit(1);
        }
        ok(`User ${conn.user} ready.`);
        const exists = admin(`SELECT 1 FROM pg_database WHERE datname='${conn.db}'`);
        if (exists.stdout?.trim() !== "1") { r = admin(`CREATE DATABASE "${conn.db}" OWNER "${conn.user}"`); if (r.status !== 0) { bad((r.stderr || "").trim()); process.exit(1); } ok(`Database ${conn.db} created.`); }
        else { admin(`ALTER DATABASE "${conn.db}" OWNER TO "${conn.user}"`); ok(`Database ${conn.db} now belongs to ${conn.user}.`); }
        admin(`ALTER SCHEMA public OWNER TO "${conn.user}"`, conn.db);
        console.log("\n  Creating the tables...");
        execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit" });
        ok("Done. Start the app with `npm run dev` and reload the page.");
      }
    } else if (/could not connect|Connection refused|timeout/i.test(msg)) {
      info("PostgreSQL isn't reachable. Start it (Postgres.app, `brew services start postgresql@16`, or `docker start ledgeriq-db`).");
    }
  }
}
console.log("");
