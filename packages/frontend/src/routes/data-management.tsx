import type {
  DataExportPayloadData,
  DataImportCounts,
  DataImportResponse,
} from "@sui/shared";
import { useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { FormField } from "../components/ui/form-field";
import { SwitchField } from "../components/ui/switch";
import { useEditSession, type EditErrors } from "../hooks/use-edit-session";
import { useToast } from "../hooks/use-toast";
import { apiFetch } from "../lib/api";

type DataKey = keyof DataExportPayloadData;

const summaryLabels: Record<keyof DataImportCounts, string> = {
  accounts: "口座",
  recurringItems: "予定収支",
  creditCards: "クレジットカード",
  creditCardBillings: "カード請求",
  creditCardItems: "カード請求明細",
  subscriptions: "サブスク",
  salaryRecords: "給与",
  donations: "寄付",
  furusatoSimulationInputs: "ふるさと納税シミュレーション入力",
  loans: "ローン",
  transactions: "取引",
  people: "メンバー",
  transactionSplits: "割り勘",
  splitShares: "割り勘持分",
  settlements: "精算",
  settlementAllocations: "精算割当",
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

const defaultEmptyKeys: DataKey[] = [
  "people",
  "transactionSplits",
  "splitShares",
  "settlements",
  "settlementAllocations",
  "salaryRecords",
  "donations",
  "furusatoSimulationInputs",
];

function getArrayField(source: Record<string, unknown>, key: DataKey) {
  const value = source[key];
  if (value === undefined && defaultEmptyKeys.includes(key)) {
    return [];
  }
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
    salaryRecords: data.salaryRecords.length,
    donations: data.donations.length,
    furusatoSimulationInputs: data.furusatoSimulationInputs.length,
    loans: data.loans.length,
    transactions: data.transactions.length,
    people: data.people.length,
    transactionSplits: data.transactionSplits.length,
    splitShares: data.splitShares.length,
    settlements: data.settlements.length,
    settlementAllocations: data.settlementAllocations.length,
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
    salaryRecords: getArrayField(dataRecord, "salaryRecords"),
    donations: getArrayField(dataRecord, "donations"),
    furusatoSimulationInputs: getArrayField(dataRecord, "furusatoSimulationInputs"),
    loans: getArrayField(dataRecord, "loans"),
    transactions: getArrayField(dataRecord, "transactions"),
    people: getArrayField(dataRecord, "people"),
    transactionSplits: getArrayField(dataRecord, "transactionSplits"),
    splitShares: getArrayField(dataRecord, "splitShares"),
    settlements: getArrayField(dataRecord, "settlements"),
    settlementAllocations: getArrayField(dataRecord, "settlementAllocations"),
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
  const [reading, setReading] = useState(false);
  const fileReadGenerationRef = useRef(0);
  const importSession = useEditSession({ identity: "data-import:replace", initial: { fileName: "", confirmed: false },
    validate: (draft): EditErrors => draft.fileName && draft.confirmed ? {} : { confirmed: "ファイルと置き換えの確認が必要です" },
    fieldIds: { confirmed: "confirm-data-replace" } });
  const confirmed = importSession.draft.confirmed;
  const importing = importSession.status === "saving";
  const { toast } = useToast();

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
      toast({ title: "エクスポートファイルをダウンロードしました" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "エクスポートに失敗しました。";
      setExportMessage(message);
      toast({ title: "エクスポートに失敗しました", description: message, variant: "error" });
    } finally {
      setExporting(false);
    }
  };

  const handleFileChange = async (file: File | null) => {
    const generation = ++fileReadGenerationRef.current;
    setPreview(null);
    setImportResult(null);
    setImportMessage(null);
    if (!file) {
      return;
    }

    setReading(true);
    try {
      const parsed = parseExportPayload(await file.text());
      if (generation !== fileReadGenerationRef.current) return;
      setPreview(parsed);
      importSession.setDraft({ fileName: file.name, confirmed: false });
    } catch (error) {
      if (generation === fileReadGenerationRef.current) setImportMessage(error instanceof Error ? error.message : "ファイルを読み込めませんでした。");
    } finally {
      if (generation === fileReadGenerationRef.current) setReading(false);
    }
  };

  const discardPreview = () => {
    fileReadGenerationRef.current += 1;
    setReading(false);
    setPreview(null);
    setImportMessage(null);
    importSession.discard();
    setFileInputKey((value) => value + 1);
  };

  const handleImport = async () => {
    if (!preview || !confirmed) {
      return;
    }

    setImportMessage(null);
    setImportResult(null);
    let result: DataImportResponse | null = null;
    const saved = await importSession.save(async () => {
      const payload = {
        formatVersion: preview.formatVersion,
        mode: "replace",
        data: preview.data,
      };
      result = await apiFetch<DataImportResponse>("/api/import", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    });
    if (saved && result) {
      setImportResult((result as DataImportResponse).counts);
      setImportMessage("インポートが完了しました。");
      setPreview(null);
      importSession.discard();
      setFileInputKey((value) => value + 1);
      toast({ title: "インポートが完了しました" });
    }
  };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold sm:text-3xl">データ管理</h2>
          <p className="mt-2 text-sm text-ink-2">バックアップと移行用の JSON を扱います。</p>
        </div>
      </div>

      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold">エクスポート</h3>
            <p className="mt-1 text-sm text-ink-2">ソフト削除済みの行を含む全データを書き出します。</p>
          </div>
          <Button className="min-h-11 shrink-0" disabled={exporting} onClick={() => void handleExport()}>
            {exporting ? "作成中..." : "JSON をダウンロード"}
          </Button>
        </div>
        {exportMessage ? <p className="mt-4 text-sm text-ink-2">{exportMessage}</p> : null}
      </Card>

      <Card>
        <div className="grid gap-5">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold">インポート</h3>
            <p className="mt-1 text-sm text-danger">既存の全データは置き換えられます。</p>
          </div>

          <FormField label="インポートする JSON ファイル" htmlFor="import-file" help="プレビューを確認してから置き換えを実行します。">
            <Input id="import-file" key={fileInputKey} accept="application/json,.json" type="file"
              disabled={importing || reading || Boolean(preview)} onChange={(event) => void handleFileChange(event.target.files?.[0] ?? null)} />
          </FormField>
          {reading ? <p role="status" className="text-sm text-ink-2">ファイルを読み込み中...</p> : null}

          {preview ? (
            <div className="grid gap-4 rounded-xl border border-line bg-surface-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="break-all text-sm font-medium">選択中: {importSession.draft.fileName}</p>
                <Button variant="secondary" disabled={importing} onClick={() => importSession.requestClose(discardPreview)}>別のファイルを選ぶ</Button>
              </div>
              <div className="grid gap-1 text-sm text-ink-2">
                <div>formatVersion: {preview.formatVersion}</div>
                <div>exportedAt: {formatExportedAt(preview.exportedAt)}</div>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
                {(Object.keys(summaryLabels) as Array<keyof DataImportCounts>).map((key) => (
                  <div key={key} className="min-w-0 rounded-lg bg-surface-2 p-3">
                    <dt className="truncate text-ink-3">{summaryLabels[key]}</dt>
                    <dd className="mt-1 text-xl font-semibold">{preview.counts[key]}</dd>
                  </div>
                ))}
              </dl>
              <SwitchField
                id="confirm-data-replace"
                label="既存の全データが置き換えられることを確認しました。"
                checked={confirmed}
                onChange={(next) => importSession.setDraft({ ...importSession.draft, confirmed: next })}
              />
              <p role="status" className="text-sm text-ink-2">{importing ? "置き換え中" : confirmed ? "置き換え実行前・未保存" : "プレビュー中・未保存"}</p>
              <p className="text-xs text-critical">選択したファイルの全件で現在のデータを置き換えます。この操作は元に戻せません。</p>
              <Button
                className="min-h-11 justify-self-start"
                disabled={!confirmed || importing}
                variant="danger"
                onClick={() => void handleImport()}
              >
                {importing ? "インポート中..." : "インポートを実行"}
              </Button>
              <Button className="justify-self-start" variant="ghost" disabled={importing} onClick={() => importSession.requestClose(discardPreview)}>プレビューを破棄</Button>
            </div>
          ) : null}

          {importMessage ? <p className="text-sm text-ink-2">{importMessage}</p> : null}
          {importSession.error ? <p role="alert" className="text-sm text-critical">{importSession.error}</p> : null}

          {importResult ? (
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
              {(Object.keys(summaryLabels) as Array<keyof DataImportCounts>).map((key) => (
                <div key={key} className="min-w-0 rounded-lg bg-surface-2 p-3">
                  <dt className="truncate text-ink-3">{summaryLabels[key]}</dt>
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
