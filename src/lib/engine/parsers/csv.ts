import Papa from "papaparse";
import { parseRows } from "./tabular";
import type { AccountTypeName, ColumnMapping, ParseResult } from "../types";

export function parseCsv(text: string, accountType: AccountTypeName, mapping?: ColumnMapping): ParseResult {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : firstLine.includes("\t") ? "\t" : ",";
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { delimiter, skipEmptyLines: true });
  return parseRows(parsed.data, { accountType, mapping, parserName: "CSV" });
}
