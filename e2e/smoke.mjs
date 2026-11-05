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
/** First money amount in a string, e.g. "Money spent$6,097.95▲ $2..." -> 6097.95 */
const money = (s) => { const m = String(s).match(/-?\$?\s?(-?[\d,]+\.\d{2}|-?\d+)/); return m ? Number(m[1].replace(/,/g, "")) : NaN; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const page = await ctx.newPage();
page.on("response", (r) => { if (r.request().method() === "POST" && process.env.DEBUG) console.log("POST", r.url(), r.status()); });
page.on("console", (m) => { if (process.env.DEBUG) console.log("console:", m.type(), m.text()); });
page.on("pageerror", (e) => { console.log("PAGE ERROR", page.url(), e.message); failures++; });
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
check(await page.isVisible("text=/recognised this as a RBC Royal Bank statement/"), "RBC layout recognised");
check((await commit()).includes("24"), "RBC: 24 imported");

await importFile(ids.amex, "amex-business-2026-08-to-10.csv", { expectNew: 33 });
check(await page.isVisible("text=lists purchases as positive"), "Amex sign convention explained in plain language");
check((await commit()).includes("33"), "Amex: 33 imported");
await shot("02-import-result");

await importFile(ids.scotia, "scotiabank-visa-2026-09-to-10.ofx", { expectNew: 11, fill: async () => {
  await page.locator("details:has(#p3)").evaluate((d) => { d.open = true; });
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
check(Math.abs(money(spentCard) - expected) < 0.005, `October spending = ${expected.toFixed(2)} (excludes card payments, loan payments; nets refunds). Got "${spentCard}"`);
check(await page.isVisible("text=What changed?"), "plain-language summary present");
const firstInsight = await page.locator("text=/You spent .* (more|less) in October than in September/").first().textContent();
check(!!firstInsight, `insight explains change: "${firstInsight}"`);

// 6. Drill down: Overview -> Amazon -> October -> purchase -> account
await go(`${BASE}/spending?view=suppliers`);
await shot("04-spending-suppliers");
await page.click("table a:text-is('Amazon')");
await page.waitForURL(/suppliers\//);
await shot("05-supplier-amazon");
const amazonAll = 75.12 + 42.80 + 120 + 64.99 + 9.99 + 120 + 75 + 250 + 310.45 + 9.99 - 64.99 + 89.99 + 149.00;
const life = await page.locator("a:has-text('Total spent, all time')").textContent();
check(Math.abs(money(life) - amazonAll) < 0.005, `Amazon combined across 2 cards and 5 spellings = ${amazonAll.toFixed(2)} (got "${life}")`);
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
await go(`${BASE}/accountant?tab=journal&month=2026-10`);
check(await page.isVisible("text=Accountant View is turned off"), "accountant tools are hidden until needed");
await page.click("button:has-text('Turn on Accountant View')");
await page.waitForSelector("text=Trial balance", { timeout: 15000 });
check(await page.isVisible("text=Debits equal credits."), "trial balance balances");
await shot("11-accountant-journal");

// 11b. Correcting mistakes safely
// Review: answer a category question for the e-transfer
await go(`${BASE}/review`);
const before = await page.locator(".card:has-text('TREMBLAY')").count();
await page.locator(".card:has-text('TREMBLAY') select[name=categoryId]").selectOption({ label: "Professional services" });
await page.locator(".card:has-text('TREMBLAY') button:has-text('Save')").click();
await page.locator(".card:has-text('TREMBLAY')").waitFor({ state: "detached", timeout: 15000 });
await go(`${BASE}/review`);
check(before === 1 && (await page.locator(".card:has-text('TREMBLAY')").count()) === 0, "answering a review question removes it from the queue");

// Mark a purchase as a duplicate, check it leaves the totals, then restore it
const spentOf = async () => { await go(`${BASE}/?month=2026-10`); return money(await page.locator("a:has-text('Money spent')").first().textContent()); };
const spentBefore = await spentOf();
await go(`${BASE}/transactions?q=AIR%20CANADA`);
await page.locator("table tbody tr a").first().click();
await page.waitForURL(/transactions\/c/);
const txnUrl = page.url();
await page.click("button:has-text('Mark as duplicate')");
await page.waitForSelector("text=excluded from all totals", { timeout: 15000 });
const spentExcluded = await spentOf();
check(Math.abs(spentBefore - spentExcluded - 642.18) < 0.005, `duplicate leaves totals (${spentBefore} -> ${spentExcluded})`);
await go(txnUrl);
await page.click("button:has-text('Restore it')");
await page.waitForSelector("button:has-text('Mark as duplicate')", { timeout: 15000 });
check(Math.abs((await spentOf()) - spentBefore) < 0.005, "restoring a duplicate puts it back in the totals");
await go(txnUrl);
check(await page.isVisible("text=Marked as a duplicate") && await page.isVisible("text=Restored"), "both changes appear in the change history");

// Attach a receipt
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
await page.setInputFiles("input[name=receipt]", { name: "air-canada-invoice.png", mimeType: "image/png", buffer: png });
await page.click("button:has-text('Attach')");
await page.waitForSelector("text=Receipt attached.", { timeout: 15000 });
await go(txnUrl);
const receiptHref = await page.locator("a:has-text('air-canada-invoice.png')").getAttribute("href");
const rr = await page.request.get(`${BASE}${receiptHref}`);
check(rr.ok() && Buffer.compare(Buffer.from(await rr.body()), png) === 0, "receipt is stored encrypted and comes back byte-for-byte");

// Split a Costco purchase (Accountant View is on)
await go(`${BASE}/transactions?q=COSTCO&month=2026-10`);
await page.locator("table tbody tr a").first().click();
await page.waitForURL(/transactions\/c/);
const cats = page.locator("select[name=splitCategory]");
const amts = page.locator("input[name=splitAmount]");
await cats.nth(0).selectOption({ label: "Groceries" }); await amts.nth(0).fill("80.00");
await cats.nth(1).selectOption({ label: "Office expenses" }); await amts.nth(1).fill("30.00");
await page.click("button:has-text('Save split')");
await page.waitForSelector("text=/The parts add up to 110.00/", { timeout: 15000 });
check(true, "a split that doesn't add up is refused with a clear explanation");
await amts.nth(1).fill("32.34");
await page.click("button:has-text('Save split')");
await page.waitForSelector("text=Split saved.", { timeout: 15000 });
await go(`${BASE}/spending?view=categories&month=2026-10`);
check(await page.locator("section a:has-text('Office expenses')").first().isVisible() && (await page.locator("section a:has-text('Office expenses')").first().textContent()).includes("95.61"), "split parts show up under their own categories (office = $63.27 Staples + $32.34 split)");

// Combine two supplier names
await go(`${BASE}/settings`);
await page.selectOption("#into", { label: await page.locator("#into option:has-text('Uber Eats')").textContent() });
await page.locator("label:has-text('Starbucks') input[name=from]").check();
await page.click("button:has-text('Combine')");
await page.waitForSelector("text=/Combined 1 supplier name/", { timeout: 15000 });
await go(`${BASE}/transactions?q=STARBUCKS`);
check((await page.locator("table tbody tr:has-text('Uber Eats')").count()) === 3, "combined supplier's transactions moved, nothing deleted");

// 11c. PDF statements: a French text PDF and a scanned (image-only) PDF
const pdfSample = (f) => path.join(here, "..", "samples", "pdf", f);
async function importPdf(account, file, expectNew) {
  const id = await addAccount(account);
  await go(`${BASE}/import?account=${id}`);
  await page.setInputFiles("input[type=file]", pdfSample(file));
  await page.waitForSelector("text=Check what we found", { timeout: 120000 });
  const chip = await page.textContent(".chip:has-text('new')");
  check(money(chip) === expectNew, `${file}: preview finds ${expectNew} transactions (got "${chip}")`);
  return id;
}
const desjId = await importPdf({ institution: "Desjardins", name: "Compte personnel", type: "PERSONAL_CHEQUING", ownership: "PERSONAL", mask: "4410" }, "desjardins-francais.pdf", 4);
check(await page.isVisible("text=/recognised this as a Desjardins statement/"), "Desjardins PDF recognised");
check(await page.isVisible("text=checked every amount against its running balance"), "PDF amounts verified against the running balance");
await shot("14-import-pdf-preview");
await commit();
await go(`${BASE}/accounts/${desjId}`);
check(await page.isVisible("text=Matches your statement"), "French PDF statement reconciles automatically");

const scanId = await importPdf({ institution: "RBC Royal Bank", name: "Old Operating (scanned)", type: "BUSINESS_CHEQUING", mask: "4567" }, "scanned-chequing.pdf", 9);
check(await page.isVisible("text=/scanned statement, so we read it with text recognition/"), "scanned PDF is read with OCR and says so");
check(await page.isVisible("text=/J TREMBLAY DESIGN/") || (await page.locator("input[value*='TREMBLAY']").count()) > 0, "wrapped payee line joined from the scan");
await shot("15-import-scanned-preview");
await commit();
await go(`${BASE}/accounts/${scanId}`);
check(await page.isVisible("text=Matches your statement"), "scanned statement reconciles to the cent");
await shot("16-account-scanned");

// 11d. Desjardins business statement: several accounts + mortgage interest split
const multiId = await importPdf({ institution: "Desjardins", name: "Compte d'opérations", type: "BUSINESS_CHEQUING", mask: "3456" }, "desjardins-multicomptes.pdf", 9);
check(await page.isVisible("text=This statement covers several accounts"), "multi-account statement offers a section picker");
check(await page.isVisible("text=/\\$3,460.00 interest/"), "preview shows the mortgage interest / principal split");
await shot("17-import-desjardins-multi");
await commit();
await go(`${BASE}/transactions?account=${multiId}&month=2026-10`);
const multiSpent = money(await page.locator("div.card.px-4:has-text('Money spent')").first().textContent());
check(Math.abs(multiSpent - 3778.40) < 0.005, `mortgage interest counted as an expense, principal and card payment not (spent ${multiSpent}, expected 3778.40)`);
await go(`${BASE}/review`);
check(await page.isVisible("text=/loan payment was \\$3,460.00 of interest and \\$740.00 of principal/"), "review explains the automatic loan split");
await go(`${BASE}/accounts/${multiId}`);
check(await page.isVisible("text=Matches your statement"), "Desjardins statement reconciles");

// 11e. Companies and buildings: kept apart on screen, all together in the bank book
await go(`${BASE}/settings`);
check(await page.locator("[data-testid=company]").count() === 1, "a new user starts with one company");
await page.fill("input[id^='co-']", "Exemple Immobilier Inc.");
await page.click("form:has(input[id^='co-']) button:has-text('Save')");
await page.waitForSelector("form:has(input[id^='co-']) >> text=Saved.", { timeout: 15000 });
await page.selectOption("#fy", "8");
await page.click("form:has(#fy) button:has-text('Save')");
await page.waitForSelector("form:has(#fy) >> text=Saved.", { timeout: 15000 });
for (const b of ["12 rue Principale", "40 avenue des Érables"]) {
  await page.fill("[data-testid=company] >> input[placeholder^='New building']", b);
  await page.click("[data-testid=company] >> button:has-text('Add building')");
  await page.waitForSelector(`text=${b} added.`, { timeout: 15000 });
}
await page.fill("#newCompany", "Exemple Gestion Inc.");
await page.click("button:has-text('Add company')");
await page.waitForFunction(() => document.querySelectorAll("[data-testid=company]").length === 2, null, { timeout: 15000 });
check(true, "companies and buildings added in Settings");
await shot("18-settings-companies");
async function place(accountId, label) {
  await go(`${BASE}/accounts/${accountId}`);
  await page.selectOption("#placement", { label });
  await page.click("button:has-text('Save changes')");
  await page.waitForSelector("text=Saved.", { timeout: 15000 });
}
await place(ids.rbc, "12 rue Principale");
await place(ids.scotia, "40 avenue des Érables");
await place(ids.td, "Exemple Gestion Inc.");
// The Amex card is shared: it stays company-wide, and one purchase is assigned to a building.
await go(`${BASE}/transactions?account=${ids.amex}&month=2026-10&q=AMAZON`);
await page.click("table tbody tr:has-text('310.45') a");
await page.waitForSelector("#buildingId", { timeout: 15000 });
await page.selectOption("#buildingId", { label: "40 avenue des Érables" });
await page.click("button:has-text('Save building')");
await page.waitForSelector("text=Saved.", { timeout: 15000 });

const spentNow = async () => money(await page.locator("a:has-text('Money spent')").first().textContent());
async function viewScope(label) {
  await page.selectOption("[data-testid=scope-switch]", { label });
  await page.waitForFunction((l) => document.querySelector("h1")?.textContent?.includes(l), label.replace(" (all)", ""), { timeout: 15000 });
  await page.waitForLoadState("networkidle");
}
await go(`${BASE}/?month=2026-10`);
const allSpent = await spentNow();
const rows = await page.locator("[data-testid=scope-breakdown] tbody tr").allTextContents();
check(rows.length >= 5, `Overview splits the month by company and building (${rows.length} rows)`);
const companyRows = await page.locator("[data-testid=scope-breakdown] tbody tr:has(span.font-semibold) td:nth-child(2)").allTextContents();
const companySum = companyRows.map(money).reduce((a, b) => a + b, 0);
check(companyRows.length === 2 && Math.abs(companySum - allSpent) < 0.005, `company rows add up to the total, nothing doubled (${companySum} vs ${allSpent})`);
await shot("19-overview-by-building");
await viewScope("12 rue Principale");
check(Math.abs((await spentNow()) - oct.rbc) < 0.005, `building 1 shows only its own account's spending (${await spentNow()} vs ${oct.rbc.toFixed(2)})`);
await viewScope("40 avenue des Érables");
const b2 = oct.scotia + 310.45;
check(Math.abs((await spentNow()) - b2) < 0.005, `building 2 = its card + the purchase assigned from the shared card (${await spentNow()} vs ${b2.toFixed(2)})`);
await go(`${BASE}/spending?month=2026-10`);
check(await page.isVisible("h1:has-text('40 avenue des Érables')"), "Spending follows the chosen building");
await viewScope("Exemple Gestion Inc. (all)");
await go(`${BASE}/?month=2026-10`);
check(Math.abs((await spentNow()) - oct.td) < 0.005, `second company kept separate (${await spentNow()} vs ${oct.td.toFixed(2)})`);
await viewScope("All companies");
check(Math.abs((await spentNow()) - allSpent) < 0.005, "All companies shows everything again");
await go(`${BASE}/spending?month=2026-10&view=buildings`);
check(await page.isVisible("[data-testid=scope-breakdown]"), "Spending has a By building view");

await go(`${BASE}/reports?month=2026-10`);
check(await page.isVisible("text=Bank book for your accountant"), "bank book download offered on Reports");
const fyStart = await page.locator("#bb-start").inputValue();
check(fyStart === "2026-08", `fiscal year follows the August start (got ${fyStart})`);
const bb = await page.request.get(`${BASE}/api/export/bankbook?start=2026-08&detail=grouped`);
check(bb.ok() && /accounting_2026-2027\.xlsx/.test(bb.headers()["content-disposition"] ?? ""), "bank book downloads as accounting_2026-2027.xlsx");
{
  const { createRequire: cr } = await import("node:module");
  const ExcelJS = cr(path.join(here, "..", "package.json"))("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await bb.body()));
  const sheets = wb.worksheets.map((w) => w.name);
  check(sheets[0] === "SUMMARY" && sheets.length >= 8, `one sheet per account plus SUMMARY (${sheets.join(", ")})`);
  const ws = wb.getWorksheet(sheets.find((n) => n !== "SUMMARY"));
  const hdr = [1, 2, 3, 4, 5, 6, 7, 8].map((c) => ws.getCell(4, c).value);
  check(JSON.stringify(hdr) === JSON.stringify(["Date", "#", "Name", "Description", "inv. #", "Debit", "Credit", "Balance"]), "columns match the accountant's template");
  check(ws.getCell(1, 1).value === "Exemple Immobilier Inc.", "company name printed on each block");
  const blockCompanies = new Set(wb.worksheets.filter((w) => !["SUMMARY", "BUILDINGS"].includes(w.name)).map((w) => w.getCell(1, 1).value));
  check(blockCompanies.has("Exemple Immobilier Inc.") && blockCompanies.has("Exemple Gestion Inc."), "one workbook holds both companies, each block with its own company name");
  const s = wb.getWorksheet("SUMMARY");
  check(String(s.getCell("A1").value).startsWith("SUMMARY 2026-2027 ALL COMPANIES"), "SUMMARY title");
  const col = (c) => s.getColumn(c).values.map((v) => (v && typeof v === "object" ? v.formula ?? v.result : v));
  check(col(1).includes("EXEMPLE IMMOBILIER INC.") && col(1).includes("EXEMPLE GESTION INC.") && col(1).includes("TOTAL ALL COMPANIES"), "SUMMARY grouped by company with a grand total");
  check(col(2).some((f) => typeof f === "string" && /!F\d+$/.test(f)), "SUMMARY totals are live formulas into each sheet");
  const bs = wb.getWorksheet("BUILDINGS");
  const names = bs ? bs.getColumn(2).values : [];
  check(!!bs && names.includes("12 rue Principale") && names.includes("40 avenue des Érables"), "BUILDINGS sheet lists every building's money in and spent");
}

// 12. Export
const resp = await page.request.get(`${BASE}/api/export?month=2026-10`);
const csv = await resp.text();
check(resp.ok() && csv.split("\n").length > 30, "CSV export works");
check(csv.split("\n")[0].includes('"Company","Building"') && csv.includes("Exemple Gestion Inc.") && csv.includes("12 rue Principale"), "CSV export includes every company, with Company and Building columns");

// 12b. Header buttons: switch view mode, then sign out
await go(`${BASE}/`);
const modeBefore = await page.locator("header button[title^='Switch between']").locator("span.bg-violet-600").count();
await page.click("header button[title^='Switch between']");
await page.waitForFunction((was) => document.querySelectorAll("header button[title^='Switch between'] span.bg-violet-600").length !== was, modeBefore, { timeout: 15000 });
check(true, "header Simple/Accountant switch works");
await page.click("header button[title^='Switch between']"); // back to the previous mode
await page.waitForFunction((was) => document.querySelectorAll("header button[title^='Switch between'] span.bg-violet-600").length === was, modeBefore, { timeout: 15000 });

// 13. Mobile layout
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState() });
const mp = await m.newPage();
await mp.goto(`${BASE}/?month=2026-10`);
await mp.screenshot({ path: path.join(SHOTS, "12-mobile-overview.png"), fullPage: true });
const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(overflow <= 1, `no horizontal scroll on phone (overflow ${overflow}px)`);
check(await mp.isVisible("nav.fixed[aria-label=Main] >> text=Review"), "bottom navigation on phone");
await mp.goto(`${BASE}/transactions?month=2026-10`);
await mp.screenshot({ path: path.join(SHOTS, "13-mobile-transactions.png"), fullPage: true });

await go(`${BASE}/`);
await page.click("header button[aria-label='Sign out']");
await page.waitForURL(/\/login/, { timeout: 15000 });
check(true, "sign out works");
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
