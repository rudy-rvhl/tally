/**
 * Local-only mode (default ON): nothing leaves this computer. The network guard
 * (scripts/netguard.cjs, loaded before the app) refuses every connection that isn't to this
 * computer; features that need the internet are switched off here so they explain why instead of failing.
 * Turn it off only on purpose: LEDGERIQ_LOCAL_ONLY="false" in .env (bank connections, AI help).
 */
export const localOnly = () => (process.env.LEDGERIQ_LOCAL_ONLY ?? "true").toLowerCase() !== "false";

/** Where the database is: on this computer (localhost / socket) or elsewhere. */
export function databaseIsLocal(url = process.env.DATABASE_URL ?? ""): boolean {
  try {
    const u = new URL(url);
    const host = decodeURIComponent(u.hostname).replace(/^\[|\]$/g, "");
    const socket = u.searchParams.get("host");
    return ["localhost", "127.0.0.1", "::1"].includes(host) || /^127\./.test(host) || (!!socket && socket.startsWith("/"));
  } catch { return false; }
}
