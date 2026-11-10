/** Runs once when the server starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { repairBalanceRows } = await import("./lib/services/repair");
    await repairBalanceRows();
  } catch (e) {
    // Never stop the app from starting (e.g. the database isn't reachable yet).
    console.warn("LedgerIQ: the automatic statement check was skipped:", (e as Error).message.split("\n")[0]);
  }
}
