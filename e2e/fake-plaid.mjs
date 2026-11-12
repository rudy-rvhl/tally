/** A stand-in for Plaid's API, for tests: same endpoints and response shapes, fictional data. */
import http from "node:http";

const acct = { chq: "acc-chq", card: "acc-card" };
let version = 1;
// Phase 1: what the bank has at connection time.
const base = [
  { transaction_id: "t-rona", account_id: acct.chq, amount: 215.37, date: "2026-10-20", name: "RONA", original_description: "POS PURCHASE RONA #12345", pending: false }, // already in the imported statement
  { transaction_id: "t-hydro", account_id: acct.chq, amount: 142.18, date: "2026-11-02", name: "Hydro-Quebec", original_description: "BILL PAYMENT HYDRO-QUEBEC", pending: false },
  { transaction_id: "p-amazon", account_id: acct.chq, amount: 50.0, date: "2026-11-05", name: "Amazon", original_description: "AMAZON.CA MARKETPLACE", pending: true },
  { transaction_id: "p-uber", account_id: acct.chq, amount: 18.0, date: "2026-11-06", name: "Uber", original_description: "UBER TRIP", pending: true },
  { transaction_id: "t-rent-in", account_id: acct.chq, amount: -1450.0, date: "2026-11-01", name: "E-transfer", original_description: "INTERAC E-TRANSFER FROM LINDA UPSHAW", pending: false },
  { transaction_id: "t-card-1", account_id: acct.card, amount: 89.99, date: "2026-11-03", name: "Home Depot", original_description: "HOME DEPOT #7051 MONTREAL", pending: false },
];
// Phase 2 changes: the Amazon charge posts (a bit higher), Uber is cancelled, Hydro is corrected.
const phase2 = {
  added: [{ transaction_id: "t-amazon", account_id: acct.chq, amount: 52.3, date: "2026-11-06", name: "Amazon", original_description: "AMAZON.CA MARKETPLACE", pending: false, pending_transaction_id: "p-amazon" }],
  modified: [{ transaction_id: "t-hydro", account_id: acct.chq, amount: 145.0, date: "2026-11-02", name: "Hydro-Quebec", original_description: "BILL PAYMENT HYDRO-QUEBEC", pending: false }],
  removed: [{ transaction_id: "p-uber" }],
};
const current = () => version === 1 ? base : [...base.filter((t) => !["p-amazon", "p-uber"].includes(t.transaction_id)).map((t) => (t.transaction_id === "t-hydro" ? phase2.modified[0] : t)), phase2.added[0]];

const routes = {
  "/link/token/create": () => ({ link_token: "link-sandbox-test" }),
  "/item/public_token/exchange": () => ({ access_token: "access-sandbox-test", item_id: `item-test-${Date.now()}` }),
  "/accounts/get": () => ({
    item: { institution_id: "ins_test_scotia" },
    accounts: [
      { account_id: acct.chq, name: "Business Account", official_name: "Business chequing", mask: "9876", type: "depository", subtype: "checking", balances: { current: version === 1 ? 7520.0 : 7400.0, available: 7400.0, iso_currency_code: "CAD" } },
      { account_id: acct.card, name: "Visa", official_name: "Scotia Business Visa", mask: "4242", type: "credit", subtype: "credit card", balances: { current: 89.99, available: 9910.01, iso_currency_code: "CAD" } },
    ],
  }),
  "/institutions/get_by_id": () => ({ institution: { name: "Scotiabank" } }),
  "/transactions/sync": (b) => {
    const cur = `cursor-${version}`;
    if (!b.cursor || !/^cursor-\d+$/.test(b.cursor)) return { added: current(), modified: [], removed: [], next_cursor: cur, has_more: false };
    if (b.cursor === cur) return { added: [], modified: [], removed: [], next_cursor: cur, has_more: false };
    return { ...phase2, next_cursor: cur, has_more: false }; // from cursor-1 to cursor-2
  },
  "/item/remove": () => ({}),
  "/__phase2": () => { version = 2; return { ok: true }; },
};

export function startFakePlaid(port = 3999) {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      const fn = routes[req.url];
      if (!fn) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error_code: "NOT_FOUND", error_message: req.url })); return; }
      if (req.url !== "/__phase2" && (body.client_id !== "test-client" || body.secret !== "test-secret")) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error_code: "INVALID_API_KEYS", error_type: "INVALID_INPUT", error_message: "bad keys" })); return; }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(fn(body)));
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
