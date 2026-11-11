/**
 * Rent roll reports (Stessa, and similar exports from property management software):
 * Property ▸ Unit · Bed/Bath · Sq Ft · Tenant · Rent · Deposit · Balance Due · Move-In · Lease Start · Lease Expires.
 * Reads PDF (by position) and CSV / Excel (by column name). Nothing is saved here.
 */
import { parseAmountToCents } from "../money";

export interface RentRollUnit {
  unit: string;
  layout: string | null;
  sqft: number | null;
  /** null for a vacant unit */
  tenant: string | null;
  /** null when the report says "No Lease" or shows no rent */
  rentCents: number | null;
  depositCents: number | null;
  /** Positive = tenant owes; negative = credit (prepaid). */
  balanceCents: number | null;
  moveIn: string | null; // YYYY-MM-DD
  leaseStart: string | null;
  leaseEnd: string | null;
  noLease: boolean;
}
export interface RentRollProperty { name: string; units: RentRollUnit[] }
export interface RentRollReport {
  source: string | null;
  asOf: string | null;
  properties: RentRollProperty[];
  /** The report's own TOTAL line, to check nothing was missed. */
  totals: { rentCents: number | null; balanceCents: number | null; occupancy: string | null } | null;
  notes: string[];
}

interface Cell { x: number; x2: number; str: string }
interface Line { page: number; y: number; cells: Cell[]; text: string }

const MONEY = /^\(?-?\$?\d{1,3}(?:,\d{3})*(?:\.\d{2})\)?$|^\(?-?\$?\d+\.\d{2}\)?$/;
const DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const BEDBATH = /^('?-|\d+)\s*\/\s*(\d+(?:\.\d)?)$/;
const money = (s: string): number | null => {
  const t = s.trim();
  if (!t || t === "-" || /^no lease$/i.test(t)) return null;
  const neg = /^\(.*\)$/.test(t) || t.startsWith("-");
  const c = parseAmountToCents(t.replace(/[()$-]/g, ""));
  return c === null ? null : neg ? -Math.abs(c) : c;
};
const isoUS = (s: string | null | undefined): string | null => {
  const m = s?.trim().match(DATE);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
};
const tidyName = (s: string) => s.replace(/\s+/g, " ").trim().replace(/(^|[\s&/+-])([a-zà-ÿ])/g, (_, p, c) => p + c.toUpperCase());

/** From PDF lines (cells with positions). */
export function parseRentRollLines(lines: Line[]): RentRollReport {
  const text = lines.map((l) => l.text).join("\n");
  const notes: string[] = [];
  const report: RentRollReport = {
    source: /stessa/i.test(text) ? "Stessa" : /appfolio/i.test(text) ? "AppFolio" : /buildium/i.test(text) ? "Buildium" : null,
    asOf: null, properties: [], totals: null, notes,
  };
  const asOf = text.match(/as of\s+([A-Za-z]+ \d{1,2},? \d{4})/i)?.[1];
  if (asOf) { const d = new Date(`${asOf} UTC`); if (!isNaN(+d)) report.asOf = d.toISOString().slice(0, 10); }

  const hi = lines.findIndex((l) => /\bunit\b/i.test(l.text) && /tenant/i.test(l.text) && /\brent\b/i.test(l.text));
  if (hi < 0) { notes.push("We couldn't find the column headings (Unit, Tenant, Rent) in this file."); return report; }
  const head = lines.filter((l) => l.page === lines[hi].page && lines[hi].y - l.y >= 0 && lines[hi].y - l.y <= 18).flatMap((l) => l.cells);
  const xOf = (re: RegExp) => head.find((c) => re.test(c.str))?.x ?? null;
  const unitX = xOf(/^unit$/i) ?? 0;
  const rentX = xOf(/^rent$/i) ?? 460, depositX = xOf(/^deposit$/i), balanceX = xOf(/^balance/i);
  const rentMax = depositX !== null ? (rentX + depositX) / 2 : balanceX !== null ? (rentX + balanceX) / 2 : rentX + 30;
  const depositMax = depositX !== null && balanceX !== null ? (depositX + balanceX) / 2 : Infinity;

  let current: RentRollProperty | null = null;
  for (const l of lines.slice(hi + 1)) {
    const t = l.text.trim();
    if (/^(report created|powered by|access your account|https?:\/\/|page \d)/i.test(t)) continue;
    if (/^total\b/i.test(t)) {
      const amounts = l.cells.filter((c) => MONEY.test(c.str.trim()) || c.str.trim() === "-");
      const rent = amounts.find((c) => c.x < rentMax), bal = amounts.find((c) => c.x >= depositMax && c.x >= (balanceX ?? 0) - 25);
      report.totals = { rentCents: rent ? money(rent.str) : null, balanceCents: bal ? money(bal.str) : null, occupancy: t.match(/occupancy:\s*([\d.]+%)/i)?.[1] ?? null };
      continue;
    }
    // A property heading: text starting left of the Unit column, no amounts, no bed/bath.
    if (l.cells[0] && l.cells[0].x < unitX - 4 && l.cells.length <= 2 && !/\d+\.\d{2}/.test(t)) {
      current = { name: t, units: [] };
      report.properties.push(current);
      continue;
    }
    // Split every cell into tokens, each remembering where its cell starts.
    const tokens = l.cells.flatMap((c) => c.str.trim().split(/\s+/).map((s, i) => ({ s, x: i === 0 ? c.x : c.x + 1, first: i === 0 })));
    const joined = tokens.map((k) => k.s).join(" ");
    const bb = joined.match(/^(.+?)\s+('?-|\d+)\s*\/\s*(\d+(?:\.\d)?)\b/);
    if (!bb) continue;
    if (!current) { current = { name: "Property", units: [] }; report.properties.push(current); }
    const unit = bb[1].trim();
    const restTokens = tokens.slice(joined.slice(0, bb[0].length).split(/\s+/).length);
    let i = 0;
    let sqft: number | null = null;
    // Square feet: a whole number right after bed/bath, followed by the tenant's name (or "Vacant").
    const nextIsText = (k?: { s: string }) => !!k && !MONEY.test(k.s) && !DATE.test(k.s);
    if (restTokens[i] && /^\d{1,3}(,\d{3})+$|^\d{2,5}$/.test(restTokens[i].s) && nextIsText(restTokens[i + 1])) { sqft = Number(restTokens[i].s.replace(/,/g, "")); i++; }
    const nameParts: string[] = [];
    while (i < restTokens.length && !(MONEY.test(restTokens[i].s) && restTokens[i].first) && !DATE.test(restTokens[i].s) && !(restTokens[i].s === "No" && restTokens[i + 1]?.s === "Lease") && !(restTokens[i].s === "-" && restTokens[i].first && restTokens[i].x > rentMax)) nameParts.push(restTokens[i++].s);
    let rentCents: number | null = null, depositCents: number | null = null, balanceCents: number | null = null, noLease = false;
    const dates: string[] = [];
    for (; i < restTokens.length; i++) {
      const k = restTokens[i];
      if (k.s === "No" && restTokens[i + 1]?.s === "Lease") { noLease = true; if (k.x < rentMax) rentCents = null; else dates.push("NOLEASE"); i++; continue; }
      if (DATE.test(k.s)) { dates.push(k.s); continue; }
      if (MONEY.test(k.s) || k.s === "-") {
        const v = money(k.s);
        if (k.x < rentMax) rentCents = v; else if (k.x < depositMax) depositCents = v; else balanceCents = v;
      }
    }
    const name = nameParts.join(" ").trim();
    const vacant = /^vacant$/i.test(name) || !name;
    const [moveIn, start, end] = dates;
    current.units.push({
      unit, layout: `${bb[2].replace(/^'?-$/, "0")} / ${bb[3]}`, sqft, tenant: vacant ? null : tidyName(name),
      rentCents: vacant ? null : rentCents, depositCents, balanceCents: vacant ? null : balanceCents,
      moveIn: isoUS(moveIn), leaseStart: isoUS(start === "NOLEASE" ? null : start), leaseEnd: isoUS(end === "NOLEASE" ? null : end), noLease,
    });
  }
  report.properties = report.properties.filter((p) => p.units.length);
  return report;
}

/** From CSV / Excel rows (first row with Unit + Tenant + Rent is the header). */
export function parseRentRollTable(rows: string[][]): RentRollReport {
  const notes: string[] = [];
  const report: RentRollReport = { source: null, asOf: null, properties: [], totals: null, notes };
  const hi = rows.findIndex((r) => r.some((c) => /^unit/i.test(c.trim())) && r.some((c) => /tenant|locataire/i.test(c)) && r.some((c) => /^(rent|loyer)/i.test(c.trim())));
  if (hi < 0) { notes.push("We couldn't find the column headings (Unit, Tenant, Rent) in this file."); return report; }
  const h = rows[hi].map((c) => c.trim().toLowerCase());
  const col = (re: RegExp) => h.findIndex((c) => re.test(c));
  const C = {
    property: col(/^(property|propri[eé]t[eé]|building|immeuble|address|adresse)/), unit: col(/^(unit|unité|logement|apt)/), bed: col(/bed|chambre/),
    sqft: col(/sq\.? ?ft|pi2|superficie/), tenant: col(/tenant|locataire/), rent: col(/^(rent|loyer)/), deposit: col(/deposit|d[eé]p[oô]t/),
    balance: col(/balance|solde|due/), moveIn: col(/move.?in|emm[eé]nagement/), start: col(/lease start|d[eé]but/), end: col(/expir|lease end|fin/),
  };
  let current: RentRollProperty | null = null;
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const date = (s: string) => isoUS(s) ?? (/^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
  for (const r of rows.slice(hi + 1)) {
    const filled = r.filter((c) => c.trim());
    if (!filled.length) continue;
    if (/^total/i.test(filled[0].trim())) { report.totals = { rentCents: money(get(r, C.rent)), balanceCents: money(get(r, C.balance)), occupancy: null }; continue; }
    const propName = get(r, C.property);
    if (filled.length === 1 && !get(r, C.rent)) { current = { name: filled[0].trim(), units: [] }; report.properties.push(current); continue; }
    if (propName && current?.name !== propName) { current = report.properties.find((p) => p.name === propName) ?? null; if (!current) { current = { name: propName, units: [] }; report.properties.push(current); } }
    if (!current) { current = { name: "Property", units: [] }; report.properties.push(current); }
    const tenant = get(r, C.tenant);
    const vacant = !tenant || /^vacant$/i.test(tenant);
    const bed = get(r, C.bed).match(BEDBATH);
    current.units.push({
      unit: get(r, C.unit), layout: bed ? `${bed[1].replace(/^'?-$/, "0")} / ${bed[2]}` : get(r, C.bed) || null, sqft: Number(get(r, C.sqft).replace(/,/g, "")) || null,
      tenant: vacant ? null : tidyName(tenant), rentCents: vacant ? null : money(get(r, C.rent)), depositCents: money(get(r, C.deposit)),
      balanceCents: vacant ? null : money(get(r, C.balance)), moveIn: date(get(r, C.moveIn)), leaseStart: date(get(r, C.start)), leaseEnd: date(get(r, C.end)),
      noLease: /no lease/i.test(get(r, C.rent)) || /no lease/i.test(get(r, C.start)),
    });
  }
  report.properties = report.properties.filter((p) => p.units.length);
  return report;
}

export function rentRollCheck(r: RentRollReport) {
  const units = r.properties.flatMap((p) => p.units);
  const rent = units.reduce((a, u) => a + (u.rentCents ?? 0), 0);
  const balance = units.reduce((a, u) => a + (u.balanceCents ?? 0), 0);
  return {
    units: units.length, vacant: units.filter((u) => !u.tenant).length, noLease: units.filter((u) => u.tenant && u.noLease).length,
    rentCents: rent, balanceCents: balance,
    rentMatches: r.totals?.rentCents == null ? null : r.totals.rentCents === rent,
    balanceMatches: r.totals?.balanceCents == null ? null : r.totals.balanceCents === balance,
  };
}
