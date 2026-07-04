import type {
  DataExportPayloadData,
  DataImportCounts,
  DataImportResponse,
} from "@sui/shared";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { apiFetch } from "../lib/api";

type DataKey =
  | "accounts"
  | "recurringItems"
  | "creditCards"
  | "creditCardBillings"
  | "subscriptions"
  | "loans"
  | "transactions"
  | "settings";

const summaryLabels: Record<keyof DataImportCounts, string> = {
  accounts: "口座",
  recurringItems: "固定収支",
  creditCards: "クレジットカード",
  creditCardBillings: "カード請求",
  creditCardItems: "カード請求明細",
  subscriptions: "サブスク",
  loans: "ローン",
  transactions: "取引",
  settings: "設定",
};

type ImportPreview = {
  formatVersion: number;
  exportedAt: string | null;
  data: DataExportPayloadData;
  counts: DataImportCounts;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getArrayField(source: Record<string, unknown>, key: DataKey) {
  const value = source[key];
  if (!Array.isArray(value)) {
    throw new Error("選択したファイルの形式が正しくありません。");
  }
  return value;
}

function buildCounts(data: DataExportPayloadData): DataImportCounts {
  return {
    accounts: data.accounts.length,
    recurringItems: data.recurringItems.length,
    creditCards: data.creditCards.length,
    creditCardBillings: data.creditCardBillings.length,
    creditCardItems: data.creditCardBillings.reduce((sum, billing) => sum + billing.items.length, 0),
    subscriptions: data.subscriptions.length,
    loans: data.loans.length,
    transactions: data.transactions.length,
    settings: data.settings.length,
  };
}

function parseExportPayload(text: string): ImportPreview {
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed) || !isRecord(parsed.data) || typeof parsed.formatVersion !== "number") {
    throw new Error("選択したファイルの形式が正しくありません。");
  }

  const dataRecord = parsed.data;
  const data = {
    accounts: getArrayField(dataRecord, "accounts"),
    recurringItems: getArrayField(dataRecord, "recurringItems"),
    creditCards: getArrayField(dataRecord, "creditCards"),
    creditCardBillings: getArrayField(dataRecord, "creditCardBillings"),
    subscriptions: getArrayField(dataRecord, "subscriptions"),
    loans: getArrayField(dataRecord, "loans"),
    transactions: getArrayField(dataRecord, "transactions"),
    settings: getArrayField(dataRecord, "settings"),
  } as unknown as DataExportPayloadData;
  data.creditCardBillings.forEach((billing) => {
    if (!isRecord(billing) || !Array.isArray(billing.items)) {
      throw new Error("選択したファイルの形式が正しくありません。");
    }
  });

  return {
    formatVersion: parsed.formatVersion,
    exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : null,
    data,
    counts: buildCounts(data),
  };
}

function parseFilename(contentDisposition: string | null) {
  const match = contentDisposition?.match(/filename="([^"]+)"/);
  return match?.[1] ?? "sui-export.json";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatExportedAt(value: string | null) {
  if (!value) {
    return "不明";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function DataManagementPage() {
  const [fileInputKey, setFileInputKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<DataImportCounts | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [importing, setImporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    setExportMessage(null);
    try {
      const response = await fetch("/api/export");
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "エクスポートに失敗しました。");
      }

      const blob = await response.blob();
      downloadBlob(blob, parseFilename(response.headers.get("Content-Disposition")));
      setExportMessage("エクスポートファイルをダウンロードしました。");
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : "エクスポートに失敗しました。");
    } finally {
      setExporting(false);
    }
  };

  const handleFileChange = async (file: File | null) => {
    setPreview(null);
    setImportResult(null);
    setImportMessage(null);
    setConfirmed(false);
    if (!file) {
      return;
    }

    try {
      setPreview(parseExportPayload(await file.text()));
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : "ファイルを読み込めませんでした。");
    }
  };

  const handleImport = async () => {
    if (!preview || !confirmed) {
      return;
    }

    setImporting(true);
    setImportMessage(null);
    setImportResult(null);
    try {
      const payload = {
        formatVersion: preview.formatVersion,
        mode: "replace",
        data: preview.data,
      };
      const result = await apiFetch<DataImportResponse>("/api/import", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setImportResult(result.counts);
      setImportMessage("インポートが完了しました。");
      setPreview(null);
      setConfirmed(false);
      setFileInputKey((value) => value + 1);
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : "インポートに失敗しました。");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold sm:text-3xl">データ管理</h2>
          <p className="mt-2 text-sm text-white/60">バックアップと移行用の JSON を扱います。</p>
        </div>
      </div>

      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold">エクスポート</h3>
            <p className="mt-1 text-sm text-white/60">ソフト削除済みの行を含む全データを書き出します。</p>
          </div>
          <Button className="min-h-11 shrink-0" disabled={exporting} onClick={() => void handleExport()}>
            {exporting ? "作成中..." : "JSON をダウンロード"}
          </Button>
        </div>
        {exportMessage ? <p className="mt-4 text-sm text-white/75">{exportMessage}</p> : null}
      </Card>

      <Card>
        <div className="grid gap-5">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold">インポート</h3>
            <p className="mt-1 text-sm text-danger">既存の全データは置き換えられます。</p>
          </div>

          <Input
            key={fileInputKey}
            accept="application/json,.json"
            type="file"
            onChange={(event) => void handleFileChange(event.target.files?.[0] ?? null)}
          />

          {preview ? (
            <div className="grid gap-4 rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="grid gap-1 text-sm text-white/70">
                <div>formatVersion: {preview.formatVersion}</div>
                <div>exportedAt: {formatExportedAt(preview.exportedAt)}</div>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
                {(Object.keys(summaryLabels) as Array<keyof DataImportCounts>).map((key) => (
                  <div key={key} className="min-w-0 rounded-lg bg-white/5 p-3">
                    <dt className="truncate text-white/55">{summaryLabels[key]}</dt>
                    <dd className="mt-1 text-xl font-semibold">{preview.counts[key]}</dd>
                  </div>
                ))}
              </dl>
              <label className="flex items-start gap-3 text-sm text-white/80">
                <input
                  checked={confirmed}
                  className="mt-1 h-4 w-4 accent-primary"
                  type="checkbox"
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>既存の全データが置き換えられることを確認しました。</span>
              </label>
              <Button
                className="min-h-11 justify-self-start"
                disabled={!confirmed || importing}
                variant="danger"
                onClick={() => void handleImport()}
              >
                {importing ? "インポート中..." : "インポートを実行"}
              </Button>
            </div>
          ) : null}

          {importMessage ? <p className="text-sm text-white/75">{importMessage}</p> : null}

          {importResult ? (
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
              {(Object.keys(summaryLabels) as Array<keyof DataImportCounts>).map((key) => (
                <div key={key} className="min-w-0 rounded-lg bg-white/5 p-3">
                  <dt className="truncate text-white/55">{summaryLabels[key]}</dt>
                  <dd className="mt-1 text-xl font-semibold">{importResult[key]}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
