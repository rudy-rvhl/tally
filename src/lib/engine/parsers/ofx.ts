/** OFX / QFX parser (SGML v1 and XML v2). FITIDs give deterministic duplicate protection. */
import { parseAmountToCents } from "../money";
import { parseDate } from "../dates";
import { isLiability } from "../classify";
import type { AccountTypeName, ParseResult, ParsedTxn } from "../types";

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"));
  return m ? m[1].trim() : null;
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&quot;/g, '"');

export function parseOfx(text: string, accountType: AccountTypeName): ParseResult {
  const notes: string[] = [];
  const org = tag(text, "ORG");
  const fid = tag(text, "FID");
  const acct = tag(text, "ACCTID");
  const res: ParseResult = {
    parser: "OFX", institution: org ? decode(org) : fid ? `Institution ${fid}` : null,
    currency: tag(text, "CURDEF"), accountHint: acct ? acct.slice(-4) : null,
    periodStart: tag(text, "DTSTART") ? parseDate(tag(text, "DTSTART")!) : null,
    periodEnd: tag(text, "DTEND") ? parseDate(tag(text, "DTEND")!) : null,
    openingBalanceCents: null, closingBalanceCents: null, transactions: [], notes,
  };
  // <CCACCTFROM> is a credit card; <ACCTTYPE> says CHECKING / SAVINGS / CREDITLINE.
  const acctType = tag(text, "ACCTTYPE")?.toUpperCase();
  res.accountTypeHint = /<CCACCTFROM>/i.test(text) ? "CREDIT_CARD" : acctType === "SAVINGS" ? "PERSONAL_SAVINGS" : acctType === "CREDITLINE" ? "LINE_OF_CREDIT" : acctType === "CHECKING" ? "BUSINESS_CHEQUING" : null;
  const ledger = text.match(/<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|<\/CCSTMTRS>)/i);
  if (ledger) {
    const bal = parseAmountToCents(tag(ledger[1], "BALAMT"));
    if (bal !== null) {
      // OFX reports card balances as negative when owed. We store "amount owed" as positive for liabilities.
      res.closingBalanceCents = isLiability(accountType) ? -bal : bal;
    }
  }
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  blocks.forEach((raw, i) => {
    const block = raw.split(/<\/STMTTRN>/i)[0];
    const warnings: string[] = [];
    const dt = tag(block, "DTPOSTED") ?? tag(block, "DTUSER");
    const date = dt ? parseDate(dt) : null;
    const cents = parseAmountToCents(tag(block, "TRNAMT"));
    const name = decode(tag(block, "NAME") ?? "");
    const memo = decode(tag(block, "MEMO") ?? "");
    const description = [name, memo && memo !== name ? memo : ""].filter(Boolean).join(" ").trim();
    if (!date) warnings.push("We couldn't read the date.");
    if (cents === null) warnings.push("We couldn't read the amount.");
    const t: ParsedTxn = {
      date: date ?? new Date(0), amountCents: cents ?? 0, description: description || "(no description)",
      externalId: tag(block, "FITID") ?? undefined, sourceRow: i + 1, warnings,
    };
    res.transactions.push(t);
  });
  if (!res.periodStart && res.transactions.length) {
    const ts = res.transactions.map((t) => t.date.getTime());
    res.periodStart = new Date(Math.min(...ts));
    res.periodEnd = new Date(Math.max(...ts));
  }
  if (!blocks.length) notes.push("We didn't find any transactions in this OFX/QFX file.");
  return res;
}
