import { parseCsv } from "./csv";
import { parseOfx } from "./ofx";
import { parseXlsx } from "./xlsx";
import { parsePdf } from "./pdf";
import type { AccountTypeName, ColumnMapping, ParseResult } from "../types";

export type FileKind = "CSV" | "XLSX" | "OFX" | "QFX" | "PDF" | "UNKNOWN";

export function detectFileKind(name: string, head: Buffer): FileKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const start = head.subarray(0, 512).toString("latin1");
  if (start.startsWith("%PDF")) return "PDF";
  if (head[0] === 0x50 && head[1] === 0x4b) return "XLSX"; // zip container
  if (/OFXHEADER|<OFX>/i.test(start)) return ext === "qfx" ? "QFX" : "OFX";
  if (ext === "csv" || ext === "txt") return "CSV";
  if (ext === "xlsx") return "XLSX";
  if (ext === "ofx") return "OFX";
  if (ext === "qfx") return "QFX";
  if (ext === "pdf") return "PDF";
  return "UNKNOWN";
}

export async function parseStatement(name: string, buf: Buffer, accountType: AccountTypeName, mapping?: ColumnMapping): Promise<ParseResult & { fileKind: FileKind }> {
  const kind = detectFileKind(name, buf);
  switch (kind) {
    case "CSV": return { ...parseCsv(buf.toString("utf8"), accountType, mapping), fileKind: kind };
    case "OFX": case "QFX": return { ...parseOfx(buf.toString("latin1"), accountType), fileKind: kind };
    case "XLSX": return { ...(await parseXlsx(buf, accountType, mapping)), fileKind: kind };
    case "PDF": return { ...(await parsePdf(buf, accountType)), fileKind: kind };
    default:
      return { fileKind: kind, parser: "NONE", institution: null, currency: null, accountHint: null, periodStart: null, periodEnd: null,
        openingBalanceCents: null, closingBalanceCents: null, transactions: [],
        notes: ["We don't recognise this file type. Upload a CSV, Excel (.xlsx), OFX, QFX or PDF statement."] };
  }
}
