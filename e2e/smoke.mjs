// End-to-end workflow test: a first-time user registers, adds accounts, imports
// the four sample statements, and checks that totals, drill-downs, duplicate
// protection, transfer linking and question answering behave correctly.
// Usage: BASE_URL=http://localhost:3100 node e2e/smoke.mjs
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOTS = path.join(here, "screens");
mkdirSync(SHOTS, { recursive: true });
const sample = (f) => path.join(here, "..", "samples", f);
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failures++; };
const money = (s) => Number(String(s).replace(/[^0-9.-]/g, ""));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const page = await ctx.newPage();
page.on("response", (r) => { if (r.request().method() === "POST" && process.env.DEBUG) console.log("POST", r.url(), r.status()); });
page.on("console", (m) => { if (process.env.DEBUG) console.log("console:", m.type(), m.text()); });
page.on("pageerror", (e) => { console.log("PAGE ERROR", e.message); failures++; });
// Wait for hydration before interacting, like a real user would.
const go = async (url) => { await page.goto(url); await page.waitForLoadState("networkidle"); };
const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

// 1. Register
const email = `owner+${Date.now()}@example.com`;
await go(`${BASE}/register`);
await page.fill("#name", "Rosa Martin");
await page.fill("#email", email);
await page.fill("#password", "correct horse battery");
await page.click("button:has-text('Create my account')");
await page.waitForURL(`${BASE}/`);
await page.waitForSelector("text=Start by adding a bank account or card");
check(true, "new user lands on Overview with one clear next step");

// 2. Accounts
async function addAccount(a) {
  await go(`${BASE}/accounts/new`);
  await page.fill("#institution", a.institution);
  await page.fill("#name", a.name);
  await page.selectOption("#type", a.type);
  await page.selectOption("#ownership", a.ownership ?? "BUSINESS");
  if (a.mask) await page.fill("#mask", a.mask);
  await page.click("button:has-text('Add account')");
  await page.waitForURL(/\/accounts\/c/, { timeout: 15000 });
  return page.url().split("/accounts/")[1];
}
const ids = {
  rbc: await addAccount({ institution: "RBC Royal Bank", name: "Operating Account", type: "BUSINESS_CHEQUING", mask: "4567" }),
  amex: await addAccount({ institution: "American Express", name: "Business Amex", type: "BUSINESS_CREDIT_CARD" }),
  scotia: await addAccount({ institution: "Scotiabank", name: "Scotia Visa", type: "CREDIT_CARD", mask: "8812" }),
  td: await addAccount({ institution: "TD Canada Trust", name: "Personal Chequing", type: "PERSONAL_CHEQUING", ownership: "PERSONAL" }),
};
check(Object.values(ids).every(Boolean), "four accounts created");

// 3. Import each statement through the drag-and-drop page
async function importFile(accountId, file, { expectNew, fill } = {}) {
  await go(`${BASE}/import?account=${accountId}`);
  await page.setInputFiles("input[type=file]", sample(file));
  await page.waitForSelector("text=Check what we found", { timeout: 30000 });
  if (fill) await fill();
  const newChip = await page.textContent(".chip:has-text('new')");
  if (expectNew !== undefined) check(money(newChip) === expectNew, `${file}: preview shows ${expectNew} new (got "${newChip}")`);
  return newChip;
}
async function commit() {
  await page.click("button:has-text('Import Transactions')");
  await page.waitForSelector("text=/Imported \\d+ transaction/", { timeout: 60000 });
  return page.textContent("h2");
}

await importFile(ids.rbc, "rbc-business-chequing-2026-08-to-10.csv", { expectNew: 24 });
await shot("01-import-preview");
check(await page.isVisible("text=RBC Royal Bank"), "RBC layout recognised");
check((await commit()).includes("24"), "RBC: 24 imported");

await importFile(ids.amex, "amex-business-2026-08-to-10.csv", { expectNew: 33 });
check(await page.isVisible("text=lists purchases as positive"), "Amex sign convention explained in plain language");
check((await commit()).includes("33"), "Amex: 33 imported");
await shot("02-import-result");

await importFile(ids.scotia, "scotiabank-visa-2026-09-to-10.ofx", { expectNew: 11, fill: async () => {
  await page.click("summary:has-text('Statement period and balances')").catch(() => {});
  await page.fill("#p3", "3136.55");
} });
check((await commit()).includes("11"), "Scotia OFX: 11 imported");
await importFile(ids.td, "td-personal-chequing-2026-10.csv", { expectNew: 4 });
check((await commit()).includes("4"), "TD: both identical Tim Hortons charges kept (4 imported)");

// 4. Duplicate protection: upload the Amex file again
await importFile(ids.amex, "amex-business-2026-08-to-10.csv", { expectNew: 0 });
check(await page.isVisible("text=You uploaded this exact file"), "re-upload is recognised");
check(await page.isDisabled("button:has-text('Import Transactions')"), "nothing to import on re-upload");

// 5. Overview for October 2026
await go(`${BASE}/?month=2026-10`);
await shot("03-overview");
const spentCard = await page.locator("a:has-text('Money spent')").first().textContent();
// Expected October spending (operating expenses only), computed independently from the sample files:
const oct = {
  rbc: 2400 + (186.40 + 10) + 19.95 + 900, // rent, hydro, fee, e-transfer (purchase)
  amex: 39.99 + 11.50 + 21.60 + 120 + 75 + 250 + 310.45 + 9.99 + 6.45 + (84.30 + 30) + (300 + 300) + 642.18 - 64.99,
  scotia: 112.34 + 61.12 + 149.00 + 31.20 + 18.50,
  td: 4.85 * 2 + 63.27,
};
const expected = Object.values(oct).reduce((a, b) => a + b, 0);
check(Math.abs(money(spentCard.split("Money spent")[1]) - expected) < 0.005, `October spending = ${expected.toFixed(2)} (excludes card payments, loan payments; nets refunds). Got "${spentCard}"`);
check(await page.isVisible("text=What changed?"), "plain-language summary present");
const firstInsight = await page.locator("text=/You spent .* (more|less) in October than in September/").first().textContent();
check(!!firstInsight, `insight explains change: "${firstInsight}"`);

// 6. Drill down: Overview -> Amazon -> October -> purchase -> account
await go(`${BASE}/spending?view=suppliers`);
await shot("04-spending-suppliers");
await page.click("a:has-text('Amazon'):not(:has-text('Web'))");
await page.waitForURL(/suppliers\//);
await shot("05-supplier-amazon");
const amazonAll = 75.12 + 42.80 + 120 + 64.99 + 9.99 + 120 + 75 + 250 + 310.45 + 9.99 - 64.99 + 89.99 + 149.00;
const life = await page.locator("a:has-text('Total spent, all time')").textContent();
check(Math.abs(money(life.split("all time")[1]) - amazonAll) < 0.005, `Amazon combined across 2 cards and 5 spellings = ${amazonAll.toFixed(2)} (got "${life}")`);
check(await page.isVisible("text=across 2 accounts"), "Amazon shows accounts used");
await page.click("a:has-text('Oct 2026')").catch(() => {});
const firstRow = page.locator("table tbody tr a").first();
await firstRow.click();
await page.waitForURL(/transactions\/c/);
check(await page.isVisible("text=Wording on the statement"), "transaction detail shows original statement wording");
check(await page.isVisible("text=Came from"), "transaction detail links to the source statement file");
await shot("06-transaction-detail");
await page.goBack();
await page.waitForURL(/suppliers\//);
check(page.url().includes("suppliers/"), "back returns to the supplier view");

// 7. Transfers linked automatically; card payments are not spending
await go(`${BASE}/transactions?kind=CARD_PAYMENT`);
const linkedIcons = await page.locator("[title='Linked to the other side of this transfer']").count();
check(linkedIcons >= 10, `card payments linked across accounts (${linkedIcons} linked rows)`);

// 8. Ask
async function ask(q) {
  await go(`${BASE}/ask?q=${encodeURIComponent(q)}`);
  return page.textContent("h2");
}
const a1 = await ask("How much did we spend on Amazon this year?");
check(Math.abs(money(a1) - amazonAll) < 0.005, `Ask Amazon this year -> "${a1}"`);
await page.click("a:has-text('See the transactions')");
await page.waitForURL(/transactions\?/);
check(await page.isVisible("text=Amazon transactions"), "answer links to its source transactions");
const a2 = await ask("What were my five largest expenses last month?");
check(/5 largest/.test(a2), `top five: "${a2}"`);
const a3 = await ask("Which suppliers increased their prices?");
check(/went up/.test(a3) && (await page.isVisible("text=Adobe")), `price increase found (Adobe): "${a3}"`);
const a4 = await ask("Compare October with September");
check(/October 2026 vs .* September 2026/.test(a4), `compare: "${a4}"`);
const a5 = await ask("Show me all purchases on my Amex in September");
check(/You spent/.test(a5), `amex september: "${a5}"`);
await shot("07-ask");

// 9. Review queue has plain-language items with actions
await go(`${BASE}/review`);
await shot("08-review");
check(await page.isVisible("text=Transactions to review"), "review page loads");

// 10. Reconciliation: Scotia statement balances
await go(`${BASE}/accounts/${ids.scotia}`);
await shot("09-account-scotia");
check(await page.isVisible("text=Matches your statement"), "Scotiabank Visa statement reconciles");

// 11. Reports and accountant mode
await go(`${BASE}/reports?month=2026-10`);
await shot("10-reports");
check(await page.isVisible("text=October 2026 summary"), "monthly report renders");
await go(`${BASE}/settings`);
await page.click("button:has-text('Accountant')");
await go(`${BASE}/accountant?tab=journal&month=2026-10`);
check(await page.isVisible("text=Debits equal credits."), "trial balance balances");
await shot("11-accountant-journal");

// 12. Export
const resp = await page.request.get(`${BASE}/api/export?month=2026-10`);
const csv = await resp.text();
check(resp.ok() && csv.split("\n").length > 30, "CSV export works");

// 13. Mobile layout
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState() });
const mp = await m.newPage();
await mp.goto(`${BASE}/?month=2026-10`);
await mp.screenshot({ path: path.join(SHOTS, "12-mobile-overview.png"), fullPage: true });
const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(overflow <= 1, `no horizontal scroll on phone (overflow ${overflow}px)`);
check(await mp.isVisible("nav[aria-label=Main] >> text=Review"), "bottom navigation on phone");
await mp.goto(`${BASE}/transactions?month=2026-10`);
await mp.screenshot({ path: path.join(SHOTS, "13-mobile-transactions.png"), fullPage: true });

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
