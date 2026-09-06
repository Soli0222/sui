import { createHash, randomUUID } from "node:crypto";
import type {
  SpendingImport,
  SpendingLedger,
  SpendingDetail,
} from "@sui/shared";
import { isDateString } from "../lib/dates";
import { BadRequestError } from "../lib/http";

// MF's documented export header; no inferred coverage from absent rows.
export const MF_COLUMNS = [
  "計算対象",
  "日付",
  "内容",
  "金額（円）",
  "保有金融機関",
  "大項目",
  "中項目",
  "メモ",
  "振替",
  "ID",
];
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
      continue;
    }
    if (c === '"') {
      if (field || closed) throw new BadRequestError("CSVの引用符が不正です");
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
      closed = false;
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && source[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      closed = false;
    } else {
      if (closed) throw new BadRequestError("閉じ引用符の後に文字があります");
      field += c;
    }
  }
  if (quoted) throw new BadRequestError("CSVの引用符が閉じられていません");
  if (field || row.length || closed) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
export function previewMf(
  bytes: Uint8Array,
  encoding: "utf-8" | "shift_jis",
  filename: string,
  from: string,
  to: string,
  ledger: SpendingLedger,
): SpendingImport {
  let text: string;
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new BadRequestError("文字コードを確認してください");
  }
  const rows = parseCsv(text),
    headers = rows.shift();
  if (
    !headers ||
    new Set(headers).size !== headers.length ||
    MF_COLUMNS.some((c) => !headers.includes(c))
  )
    throw new BadRequestError(
      "MFの列が不足・重複しています: " + MF_COLUMNS.join(", "),
    );
  const imported: SpendingImport = {
    id: randomUUID(),
    hash: createHash("sha256").update(bytes).digest("hex"),
    filename,
    at: new Date().toISOString(),
    from,
    to,
    confirmedCoverage: false,
    committed: false,
    rows: [],
    resolutions: {},
    errors: [],
  };
  const sourceIds = new Set<string>();
  rows.forEach((values, index) => {
    const line = index + 2;
    try {
      if (values.length !== headers.length)
        throw new Error("列数が一致しません");
      const raw = Object.fromEntries(headers.map((h, n) => [h, values[n]]));
      const date = raw["日付"].replace(
        /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/,
        (_, y, m, d) => `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`,
      );
      if (!isDateString(date) || date < from || date > to)
        throw new Error("日付が不正、または指定期間外です");
      const value = raw["金額（円）"].replaceAll(",", "");
      if (
        !/^-?\d+$/.test(value) ||
        !Number.isSafeInteger(Number(value)) ||
        Math.abs(Number(value)) > 2147483647
      )
        throw new Error("金額はint32の整数が必要です");
      if (
        !["0", "1"].includes(raw["計算対象"]) ||
        !["0", "1"].includes(raw["振替"])
      )
        throw new Error("計算対象・振替は0または1が必要です");
      const sourceId = raw.ID.trim() || null;
      if (sourceId && sourceIds.has(sourceId))
        throw new Error("ファイル内のIDが重複しています");
      if (sourceId) sourceIds.add(sourceId);
      const detail: SpendingDetail = {
        id: randomUUID(),
        sourceId,
        raw,
        date,
        description: raw["内容"],
        amount: Number(value),
        categorySource: raw["大項目"] + "/" + raw["中項目"],
        paymentSource: raw["保有金融機関"],
        included: raw["計算対象"] === "1",
        transfer: raw["振替"] === "1",
        version: 1,
        deletedAt: null,
        oneOff: false,
        classificationReason: "",
        fixedId: null,
        refundOf: null,
      };
      const existing = sourceId
        ? ledger.details.find((d) => d.sourceId === sourceId)
        : undefined;
      const candidates = existing
        ? []
        : ledger.details
            .filter(
              (d) =>
                !d.deletedAt &&
                d.date === date &&
                d.amount === detail.amount &&
                d.description === detail.description,
            )
            .map((d) => d.id);
      imported.rows.push({
        line,
        detail,
        error: null,
        candidates,
        existingId: existing?.id ?? null,
      });
    } catch (e) {
      const error = e instanceof Error ? e.message : "不正行";
      imported.rows.push({
        line,
        detail: null,
        error,
        candidates: [],
        existingId: null,
      });
      imported.errors.push(`${line}行: ${error}`);
    }
  });
  return imported;
}
