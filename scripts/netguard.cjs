/**
 * Local-only network guard, loaded before anything else (node --require) in every LedgerIQ process.
 * Every outgoing network connection goes through net.Socket#connect; anything that isn't this
 * computer is refused there, so no library can send your data anywhere by mistake.
 *
 * LEDGERIQ_LOCAL_ONLY (in .env) — default "true": nothing leaves this computer.
 * Set it to "false" only to use bank connections (Plaid) or AI help (Anthropic); then only their
 * servers are allowed, and only when their keys are set.
 */
const fs = require("node:fs");
const net = require("node:net");

function readEnv() {
  const env = {};
  try {
    for (const l of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
      if (m) env[m[1]] = m[2];
    }
  } catch { /* no .env yet */ }
  return { ...env, ...process.env };
}
const env = readEnv();
const localOnly = (env.LEDGERIQ_LOCAL_ONLY ?? "true").toLowerCase() !== "false";
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1", "ip6-localhost"]);
const allowed = new Set();
if (!localOnly) {
  if (env.PLAID_CLIENT_ID) for (const h of ["sandbox.plaid.com", "production.plaid.com"]) allowed.add(h);
  if (env.ANTHROPIC_API_KEY) allowed.add("api.anthropic.com");
}
const logOnly = env.LEDGERIQ_NETGUARD === "log"; // diagnostics: record instead of block
const seen = new Set();

function hostOf(args) {
  const a = args[0];
  if (Array.isArray(a)) return hostOf(a);
  if (a && typeof a === "object") return a.path ? null : (a.host ?? a.hostname ?? "localhost");
  if (typeof a === "number") return typeof args[1] === "string" ? args[1] : "localhost";
  if (typeof a === "string" && !/^\d+$/.test(a)) return null; // unix socket path
  return "localhost";
}
const isLocal = (h) => h === null || LOOPBACK.has(String(h).toLowerCase().replace(/^\[|\]$/g, "")) || /^127\./.test(h);

const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const host = hostOf(args);
  if (isLocal(host) || allowed.has(String(host).toLowerCase())) return original.apply(this, args);
  if (!seen.has(host)) {
    seen.add(host);
    const line = `[LedgerIQ ${logOnly ? "network log" : "local-only"}] ${logOnly ? "connection to" : "blocked a connection to"} ${host}${logOnly ? "" : " (nothing was sent)"}`;
    process.stderr.write(line + "\n");
    if (env.LEDGERIQ_NETGUARD_FILE) try { fs.appendFileSync(env.LEDGERIQ_NETGUARD_FILE, `${process.pid} ${host}\n`); } catch {}
  }
  if (logOnly) return original.apply(this, args);
  const err = Object.assign(new Error(`LedgerIQ local-only mode: connections to ${host} are blocked. Nothing was sent.`), { code: "ELOCALONLY" });
  process.nextTick(() => this.destroy(err));
  return this;
};
module.exports = { localOnly };
