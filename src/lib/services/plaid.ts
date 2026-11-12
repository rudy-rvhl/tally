/**
 * Plaid API client (https://plaid.com/docs/api/), with plain fetch.
 * Configuration in .env:
 *   PLAID_CLIENT_ID, PLAID_SECRET      from https://dashboard.plaid.com/developers/keys
 *   PLAID_ENV                          "sandbox" (test banks) or "production" (your real banks)
 *   PLAID_REDIRECT_URI                 optional; needed for banks that sign you in on their own site (OAuth)
 */
import { localOnly } from "../privacy";

const HOSTS: Record<string, string> = { sandbox: "https://sandbox.plaid.com", production: "https://production.plaid.com" };

export const plaidEnv = () => (process.env.PLAID_ENV ?? "sandbox").toLowerCase();
/** Bank connections need the internet (your bank → Plaid → this computer): off in local-only mode. */
export const plaidConfigured = () => !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET) && !localOnly();
export const plaidKeysPresent = () => !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
const base = () => process.env.PLAID_BASE_URL ?? HOSTS[plaidEnv()] ?? HOSTS.sandbox; // PLAID_BASE_URL: tests only

export class PlaidError extends Error {
  constructor(public code: string, public type: string, message: string) { super(message); }
  /** The bank wants you to sign in again (password changed, periodic re-check, consent expired). */
  get needsLogin() { return ["ITEM_LOGIN_REQUIRED", "PENDING_EXPIRATION", "PENDING_DISCONNECT", "ACCESS_NOT_GRANTED", "INVALID_UPDATED_USERNAME"].includes(this.code); }
}

async function call<T>(path: string, body: Record<string, unknown>): Promise<T> {
  if (localOnly()) throw new PlaidError("LOCAL_ONLY", "CONFIG", "Local-only mode is on, so LedgerIQ doesn't connect to banks over the internet. Import statements instead, or turn local-only mode off (Settings → Privacy).");
  if (!plaidConfigured()) throw new PlaidError("NOT_CONFIGURED", "CONFIG", "Bank connections aren't set up: add PLAID_CLIENT_ID and PLAID_SECRET to the .env file.");
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", "Plaid-Version": "2020-09-14" },
      body: JSON.stringify({ client_id: process.env.PLAID_CLIENT_ID, secret: process.env.PLAID_SECRET, ...body }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
    throw new PlaidError("NETWORK", "NETWORK", `Couldn't reach Plaid (${(e as Error).message}). Check the internet connection.`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data as { error_code?: string; error_type?: string; display_message?: string | null; error_message?: string };
    throw new PlaidError(d.error_code ?? `HTTP_${res.status}`, d.error_type ?? "API", d.display_message || d.error_message || `Plaid answered ${res.status}.`);
  }
  return data as T;
}

export interface PlaidAccount {
  account_id: string; name: string; official_name?: string | null; mask?: string | null; type?: string; subtype?: string | null;
  balances: { current?: number | null; available?: number | null; iso_currency_code?: string | null };
}
export interface PlaidTransaction {
  transaction_id: string; account_id: string; amount: number; iso_currency_code?: string | null; date: string; authorized_date?: string | null;
  name: string; merchant_name?: string | null; original_description?: string | null; pending: boolean; pending_transaction_id?: string | null;
}

export const plaid = {
  linkToken: (userId: string, opts: { accessToken?: string; language?: string }) => call<{ link_token: string }>("/link/token/create", {
    client_name: "LedgerIQ", language: opts.language ?? "en", country_codes: ["CA", "US"], user: { client_user_id: userId },
    ...(opts.accessToken ? { access_token: opts.accessToken } : { products: ["transactions"], transactions: { days_requested: 730 } }),
    ...(process.env.PLAID_REDIRECT_URI ? { redirect_uri: process.env.PLAID_REDIRECT_URI } : {}),
  }),
  exchange: (publicToken: string) => call<{ access_token: string; item_id: string }>("/item/public_token/exchange", { public_token: publicToken }),
  accounts: (accessToken: string) => call<{ accounts: PlaidAccount[]; item: { institution_id?: string | null } }>("/accounts/get", { access_token: accessToken }),
  institution: (id: string) => call<{ institution: { name: string } }>("/institutions/get_by_id", { institution_id: id, country_codes: ["CA", "US"] }),
  sync: (accessToken: string, cursor: string | null) => call<{ added: PlaidTransaction[]; modified: PlaidTransaction[]; removed: { transaction_id: string }[]; next_cursor: string; has_more: boolean }>(
    "/transactions/sync", { access_token: accessToken, ...(cursor ? { cursor } : {}), count: 500, options: { include_original_description: true } }),
  remove: (accessToken: string) => call<object>("/item/remove", { access_token: accessToken }),
};
