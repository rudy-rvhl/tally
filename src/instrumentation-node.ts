/** Server start (Node.js only): one-time repair of statements imported with an older reader. */
import { repairBalanceRows } from "./lib/services/repair";

try {
  await repairBalanceRows();
} catch (e) {
  // Never stop the app from starting (e.g. the database isn't reachable yet).
  console.warn("LedgerIQ: the automatic statement check was skipped:", (e as Error).message.split("\n")[0]);
}
