/**
 * Bank connections: keep accounts up to date automatically through Plaid.
 * - Connect: exchange Plaid Link's one-time token for an access token (stored encrypted).
 * - Map: each bank account goes into one LedgerIQ account (matched by bank, last 4 digits and type).
 * - Sync: new transactions go through the normal import (sorting, suppliers, review, transfers,
 *   duplicate protection against imported statements). Changed ones are updated; ones the bank
 *   removes (cancelled pending charges) are set aside, never deleted.
 */
import { createHash } from "node:crypto";
import { prisma } from "../db";
import { decrypt, encrypt } from "../crypto";
import { log } from "../log";
import { audit } from "./audit";
import { commitImport } from "./import";
import { plaid, PlaidError, type PlaidTransaction } from "./plaid";
import { feedAccountType, feedBalanceCents, feedExternalId, feedToParsed } from "../engine/bankfeed";
import { fingerprints } from "../engine/dedupe";
import { proposeAccount, routeStatement, type AccountLite } from "../engine/routing";
import { defaultCompany } from "../scope";

const tokenOf = async (connectionId: string) => {
  const c = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId }, omit: { accessToken: false } });
  return decrypt(c.accessToken);
};

export async function linkToken(userId: string, connectionId?: string, language = "en") {
  const accessToken = connectionId ? (await tokenOf((await prisma.bankConnection.findFirstOrThrow({ where: { id: connectionId, userId } })).id)).toString() : undefined;
  return (await plaid.linkToken(userId, { accessToken, language })).link_token;
}

/** After Plaid Link: store the connection and its accounts, matched to LedgerIQ accounts when certain. */
export async function connectBank(userId: string, publicToken: string) {
  const { access_token, item_id } = await plaid.exchange(publicToken);
  const { accounts, item } = await plaid.accounts(access_token);
  const institutionName = item.institution_id ? (await plaid.institution(item.institution_id).catch(() => null))?.institution.name ?? "Bank" : "Bank";
  const existing = await prisma.bankConnection.findUnique({ where: { provider_itemId: { provider: "plaid", itemId: item_id } } });
  if (existing && existing.userId !== userId) throw new Error("This bank connection is already used by another LedgerIQ account.");
  const conn = existing
    ? await prisma.bankConnection.update({ where: { id: existing.id }, data: { accessToken: encrypt(Buffer.from(access_token)), status: "OK", lastError: null } })
    : await prisma.bankConnection.create({ data: { userId, itemId: item_id, accessToken: encrypt(Buffer.from(access_token)), institutionId: item.institution_id ?? null, institutionName } });
  const mine: AccountLite[] = await prisma.account.findMany({ where: { userId }, select: { id: true, name: true, institution: true, type: true, mask: true, currency: true, ownership: true, status: true } });
  const taken = new Set((await prisma.bankFeedAccount.findMany({ where: { connection: { userId, status: { not: "DISCONNECTED" } }, accountId: { not: null } }, select: { accountId: true } })).map((x) => x.accountId));
  for (const a of accounts) {
    const route = routeStatement({ institution: institutionName, last4: a.mask ?? null, type: feedAccountType(a.type, a.subtype), ownership: null, currency: a.balances.iso_currency_code ?? null }, mine);
    const accountId = route.confidence === "exact" && route.accountId && !taken.has(route.accountId) ? route.accountId : null;
    if (accountId) taken.add(accountId);
    const data = { name: a.name, officialName: a.official_name ?? null, mask: a.mask ?? null, type: a.type ?? null, subtype: a.subtype ?? null, currency: a.balances.iso_currency_code ?? null,
      currentBalanceCents: feedBalanceCents(a.balances.current), availableBalanceCents: feedBalanceCents(a.balances.available), balanceAt: new Date() };
    await prisma.bankFeedAccount.upsert({ where: { connectionId_externalId: { connectionId: conn.id, externalId: a.account_id } }, update: data, create: { ...data, connectionId: conn.id, externalId: a.account_id, accountId } });
  }
  await audit(prisma, userId, "BankConnection", conn.id, existing ? "bank.reconnect" : "bank.connect", undefined, { institutionName, accounts: accounts.length });
  return conn.id;
}

/** Choose where a bank account's transactions go: a LedgerIQ account, "new" (create one) or none. */
export async function mapFeedAccount(userId: string, feedId: string, target: string) {
  const f = await prisma.bankFeedAccount.findFirst({ where: { id: feedId, connection: { userId } }, include: { connection: true } });
  if (!f) throw new Error("Bank account not found.");
  let accountId: string | null = null;
  if (target === "new") {
    const p = proposeAccount({ institution: f.connection.institutionName, last4: f.mask, type: feedAccountType(f.type, f.subtype), ownership: null, currency: f.currency }, f.name);
    const company = await defaultCompany(userId);
    const a = await prisma.account.create({ data: { userId, institution: p.institution, name: f.officialName || f.name || p.name, type: p.type, ownership: p.ownership, currency: (f.currency === "USD" ? "USD" : "CAD"), mask: f.mask, companyId: company.id } });
    await audit(prisma, userId, "Account", a.id, "account.create", undefined, { source: "bank connection", name: a.name });
    accountId = a.id;
  } else if (target) {
    const a = await prisma.account.findFirst({ where: { id: target, userId } });
    if (!a) throw new Error("Account not found.");
    accountId = a.id;
  }
  await prisma.bankFeedAccount.update({ where: { id: f.id }, data: { accountId } });
  // Fetch the whole history again so the newly mapped account gets it (already-imported rows are skipped).
  await prisma.bankConnection.update({ where: { id: f.connectionId }, data: { cursor: null } });
  await audit(prisma, userId, "BankFeedAccount", f.id, "bank.map", { accountId: f.accountId }, { accountId });
  return accountId;
}

const running = new Set<string>();

export interface SyncResult { added: number; updated: number; removed: number; skipped: number; error?: string; needsLogin?: boolean }

export async function syncConnection(connectionId: string): Promise<SyncResult> {
  const res: SyncResult = { added: 0, updated: 0, removed: 0, skipped: 0 };
  if (running.has(connectionId)) return res;
  running.add(connectionId);
  const conn = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId }, include: { accounts: true } });
  try {
    if (conn.status === "DISCONNECTED") return res;
    const token = (await tokenOf(conn.id)).toString();
    // 1. Everything new since the last sync.
    let cursor = conn.cursor;
    const added: PlaidTransaction[] = [], modified: PlaidTransaction[] = [], removed: string[] = [];
    for (let page = 0; page < 200; page++) {
      const r = await plaid.sync(token, cursor);
      added.push(...r.added); modified.push(...r.modified); removed.push(...r.removed.map((x) => x.transaction_id));
      cursor = r.next_cursor;
      if (!r.has_more) break;
    }
    const target = new Map(conn.accounts.filter((a) => a.accountId).map((a) => [a.externalId, a.accountId!]));
    const userId = conn.userId;

    // 2. A pending charge that has now posted: update the same transaction (keeps your edits).
    const fresh: PlaidTransaction[] = [];
    for (const t of added) {
      const accountId = target.get(t.account_id);
      if (!accountId) { res.skipped++; continue; }
      if (t.pending_transaction_id) {
        const was = await prisma.transaction.findFirst({ where: { accountId, externalId: feedExternalId(t.pending_transaction_id) } });
        if (was) {
          const posted = feedToParsed(t);
          await prisma.transaction.update({ where: { id: was.id }, data: { externalId: posted.externalId, fingerprint: `fitid:${posted.externalId}`, status: "POSTED", date: posted.date, amountCents: posted.amountCents, originalDescription: posted.description, ...(was.description === was.originalDescription ? { description: posted.description } : {}) } });
          await audit(prisma, userId, "Transaction", was.id, "bank.posted", { amountCents: was.amountCents, status: was.status }, { amountCents: posted.amountCents, status: "POSTED" });
          res.updated++;
          continue;
        }
      }
      fresh.push(t);
    }
    // 3. New transactions, per account, through the normal import.
    const byAccount = new Map<string, PlaidTransaction[]>();
    for (const t of fresh) byAccount.set(target.get(t.account_id)!, [...(byAccount.get(target.get(t.account_id)!) ?? []), t]);
    for (const [accountId, list] of byAccount) {
      const parsedRows = list.map(feedToParsed).sort((a, b) => a.date.getTime() - b.date.getTime());
      // Skip what's already here (a re-sync), so no empty imports are recorded.
      const fps = fingerprints(parsedRows);
      const have = new Set((await prisma.transaction.findMany({ where: { accountId, fingerprint: { in: fps } }, select: { fingerprint: true } })).map((x) => x.fingerprint));
      const rows = parsedRows.filter((_, i) => !have.has(fps[i]));
      res.skipped += parsedRows.length - rows.length;
      if (!rows.length) continue;
      const dates = rows.map((r) => r.date.getTime());
      const r = await commitImport({
        userId, accountId, fileName: "", buf: Buffer.alloc(0), decisions: {},
        feed: {
          label: `${conn.institutionName} (bank connection)`,
          key: `${conn.id}|${accountId}|${createHash("sha256").update(fps.join(",")).digest("hex")}`,
          parsed: { fileKind: "BANK_FEED" as never, parser: "Bank connection (Plaid)", institution: conn.institutionName, currency: null, accountHint: null,
            periodStart: new Date(Math.min(...dates)), periodEnd: new Date(Math.max(...dates)), openingBalanceCents: null, closingBalanceCents: null, transactions: rows, notes: [] },
        },
      });
      res.added += r.imported; res.skipped += r.skippedDuplicates;
    }
    // 4. Changed by the bank: amount, date, posted status. Your category, notes and building are kept.
    for (const t of modified) {
      const accountId = target.get(t.account_id);
      if (!accountId) continue;
      const row = await prisma.transaction.findFirst({ where: { accountId, externalId: feedExternalId(t.transaction_id) } });
      if (!row) continue;
      const p = feedToParsed(t);
      if (row.amountCents === p.amountCents && +row.date === +p.date && row.status === (p.pending ? "PENDING" : "POSTED")) continue;
      await prisma.transaction.update({ where: { id: row.id }, data: { amountCents: p.amountCents, date: p.date, status: p.pending ? "PENDING" : "POSTED", originalDescription: p.description, ...(row.description === row.originalDescription ? { description: p.description } : {}) } });
      await audit(prisma, userId, "Transaction", row.id, "bank.modified", { amountCents: row.amountCents, date: row.date }, { amountCents: p.amountCents, date: p.date });
      res.updated++;
    }
    // 5. Removed by the bank (a cancelled pending charge): set aside, not deleted.
    for (const id of removed) {
      const row = await prisma.transaction.findFirst({ where: { userId, externalId: feedExternalId(id), excluded: false } });
      if (!row) continue;
      await prisma.transaction.update({ where: { id: row.id }, data: { excluded: true, excludedReason: "Removed by the bank (a pending charge that was cancelled or replaced)" } });
      await audit(prisma, userId, "Transaction", row.id, "bank.removed", { excluded: false }, { excluded: true });
      res.removed++;
    }
    // 6. Balances, and where we got to.
    const { accounts } = await plaid.accounts(token);
    for (const a of accounts) {
      await prisma.bankFeedAccount.updateMany({ where: { connectionId: conn.id, externalId: a.account_id }, data: { currentBalanceCents: feedBalanceCents(a.balances.current), availableBalanceCents: feedBalanceCents(a.balances.available), balanceAt: new Date(), name: a.name, mask: a.mask ?? null } });
    }
    await prisma.bankConnection.update({ where: { id: conn.id }, data: { cursor, lastSyncAt: new Date(), status: "OK", lastError: null } });
    if (res.added || res.updated || res.removed) await audit(prisma, userId, "BankConnection", conn.id, "bank.sync", undefined, res);
    return res;
  } catch (e) {
    const pe = e instanceof PlaidError ? e : null;
    res.error = (e as Error).message;
    res.needsLogin = !!pe?.needsLogin;
    await prisma.bankConnection.update({ where: { id: conn.id }, data: { status: pe?.needsLogin ? "NEEDS_LOGIN" : "ERROR", lastError: res.error.slice(0, 500), lastSyncAt: new Date() } });
    log("warn", "bank.sync.failed", { connectionId, code: pe?.code, error: res.error.slice(0, 300) });
    return res;
  } finally {
    running.delete(connectionId);
  }
}

/** Every active connection (all users); used by the automatic schedule. */
export async function syncAll() {
  const conns = await prisma.bankConnection.findMany({ where: { status: { in: ["OK", "ERROR"] } }, select: { id: true } });
  const out: Record<string, SyncResult> = {};
  for (const c of conns) out[c.id] = await syncConnection(c.id);
  return out;
}

export async function disconnectBank(userId: string, connectionId: string) {
  const conn = await prisma.bankConnection.findFirst({ where: { id: connectionId, userId } });
  if (!conn) throw new Error("Connection not found.");
  try { await plaid.remove((await tokenOf(conn.id)).toString()); } catch { /* already removed at the bank: still disconnect here */ }
  await prisma.bankConnection.update({ where: { id: conn.id }, data: { status: "DISCONNECTED", accessToken: encrypt(Buffer.from("")), cursor: null } });
  await audit(prisma, userId, "BankConnection", conn.id, "bank.disconnect", undefined, { institution: conn.institutionName });
}
