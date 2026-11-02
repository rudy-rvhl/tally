import ExcelJS from "exceljs";
import { parseRows } from "./tabular";
import type { AccountTypeName, ColumnMapping, ParseResult } from "../types";

export async function parseXlsx(buf: Buffer, accountType: AccountTypeName, mapping?: ColumnMapping): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS's type expects its own Buffer type; a Node Buffer is accepted at runtime.
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  const rows: string[][] = [];
  ws?.eachRow({ includeEmpty: false }, (row) => {
    const out: string[] = [];
    for (let c = 1; c <= row.cellCount; c++) {
      const v = row.getCell(c).value as unknown;
      if (v instanceof Date) out.push(v.toISOString().slice(0, 10));
      else if (v && typeof v === "object" && "result" in (v as object)) out.push(String((v as { result: unknown }).result ?? ""));
      else if (v && typeof v === "object" && "richText" in (v as object)) out.push((v as { richText: { text: string }[] }).richText.map((r) => r.text).join(""));
      else out.push(v === null || v === undefined ? "" : String(v));
    }
    rows.push(out);
  });
  return parseRows(rows, { accountType, mapping, parserName: "XLSX" });
}
