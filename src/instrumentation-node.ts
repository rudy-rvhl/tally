/** Server start (Node.js only). */
import { repairBalanceRows } from "./lib/services/repair";

try {
  await repairBalanceRows();
  // Re-reading statements can take a little while (OCR): in the background, so the app opens right away.
  import("./lib/services/repair").then((m) => m.rereadMisreadStatements()).catch((e) => console.warn("LedgerIQ: statement re-read skipped:", (e as Error).message.split("\n")[0]));
} catch (e) {
  // Never stop the app from starting (e.g. the database isn't reachable yet).
  console.warn("LedgerIQ: the automatic statement check was skipped:", (e as Error).message.split("\n")[0]);
}

// Bank connections: update now, then every few hours while the app is running.
const g = globalThis as unknown as { ledgeriqBankTimer?: ReturnType<typeof setInterval> };
const { plaidConfigured } = await import("./lib/services/plaid");
if (plaidConfigured() && !g.ledgeriqBankTimer) {
  // Between 1 hour and 20 days (longer timers overflow in Node and would fire constantly).
  const hours = Math.min(480, Math.max(1, Number(process.env.BANK_SYNC_HOURS) || 4));
  const run = async () => {
    try {
      const { syncAll } = await import("./lib/services/bankfeed");
      const results = Object.values(await syncAll());
      const added = results.reduce((a, r) => a + r.added, 0);
      if (added) console.log(`  LedgerIQ: ${added} new transaction(s) from your bank connections.`);
      if (results.some((r) => r.needsLogin)) console.log("  LedgerIQ: a bank asks you to sign in again (Accounts → Bank connections).");
    } catch (e) {
      console.warn("LedgerIQ: bank update skipped:", (e as Error).message.split("\n")[0]);
    }
  };
  setTimeout(run, 15_000); // let the app finish starting first
  g.ledgeriqBankTimer = setInterval(run, hours * 3600_000);
}
