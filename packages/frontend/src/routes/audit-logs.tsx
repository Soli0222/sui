import type { AuditLogEntry, AuditLogsResponse } from "@sui/shared";
import { startTransition, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { ResponsiveTable, type ResponsiveTableColumn } from "../components/ui/responsive-table";
import { useResource } from "../hooks/use-resource";
import { apiFetch } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { cn } from "../lib/utils";

const AUDIT_LOGS_LIMIT = 50;

function buildAuditLogsPath(page: number) {
  return `/api/audit-logs?page=${page}&limit=${AUDIT_LOGS_LIMIT}`;
}

function formatValue(value: string | null | undefined, mono = true) {
  if (value == null) {
    return <span className="text-ink-3">-</span>;
  }

  return (
    <span className={cn("whitespace-pre-wrap break-all", mono && "font-data")}>
      {value}
    </span>
  );
}

export function AuditLogsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [reloadKey, setReloadKey] = useState(0);

  const rawPage = Number(searchParams.get("page") ?? 1);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;

  const { data, loading, error } = useResource(
    () => apiFetch<AuditLogsResponse>(buildAuditLogsPath(page)),
    [page, reloadKey],
  );

  const reload = () => startTransition(() => setReloadKey((key) => key + 1));

  const total = data?.total ?? 0;
  const limit = data?.limit ?? AUDIT_LOGS_LIMIT;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const canGoBack = page > 1;
  const canGoNext = page < totalPages;

  const setPage = (next: number) => {
    if (next === page) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("page", String(next));
    setSearchParams(nextParams);
  };

  const columns: ResponsiveTableColumn<AuditLogEntry>[] = [
    {
      key: "createdAt",
      header: "日時",
      mono: true,
      render: (item) => <span className="text-ink-2">{formatDateTime(item.createdAt)}</span>,
    },
    { key: "method", header: "メソッド", render: (item) => formatValue(item.method) },
    {
      key: "path",
      header: "パス",
      mono: true,
      render: (item) => formatValue(item.path),
    },
    {
      key: "status",
      header: "ステータス",
      render: (item) => <span className="font-data">{item.status}</span>,
    },
    { key: "clientSource", header: "クライアント", render: (item) => formatValue(item.clientSource) },
    { key: "authKind", header: "認証種別", render: (item) => formatValue(item.authKind) },
    { key: "authMode", header: "認証モード", render: (item) => formatValue(item.authMode) },
    { key: "subject", header: "主体", render: (item) => formatValue(item.subject) },
    {
      key: "requestId",
      header: "リクエストID",
      mono: true,
      render: (item) => formatValue(item.requestId),
    },
    {
      key: "sessionId",
      header: "セッションID",
      mono: true,
      render: (item) => formatValue(item.sessionId),
    },
    {
      key: "apiTokenId",
      header: "APIトークンID",
      mono: true,
      render: (item) => formatValue(item.apiTokenId),
    },
  ];

  const mobileRow = (item: AuditLogEntry) => (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-data text-ink-2">{formatDateTime(item.createdAt)}</span>
        <span className="font-data font-semibold">{item.method}</span>
      </div>
      <div className="font-data whitespace-pre-wrap break-all">{item.path}</div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
        {[
          { label: "ステータス", value: String(item.status), mono: true },
          { label: "クライアント", value: item.clientSource },
          { label: "認証種別", value: item.authKind },
          { label: "認証モード", value: item.authMode },
          { label: "主体", value: item.subject },
          { label: "リクエストID", value: item.requestId },
          { label: "セッションID", value: item.sessionId },
          { label: "APIトークンID", value: item.apiTokenId },
        ].map(({ label, value, mono }) => (
          <div key={label} className="col-span-full grid grid-cols-subgrid">
            <dt className="text-ink-3">{label}</dt>
            <dd className="min-w-0">{formatValue(value, mono)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );

  return (
    <div className="grid gap-6">
      <div>
        <h2 className="text-2xl font-semibold">監査ログ</h2>
        <p className="mt-2 text-sm text-ink-2">状態を変えたリクエストの記録を確認します。</p>
      </div>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-semibold">リクエスト一覧</h3>
          <div className="text-sm text-ink-2">{loading ? null : `全 ${total} 件`}</div>
        </div>

        {error ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : loading ? (
          <p className="text-sm text-ink-2">読み込み中...</p>
        ) : (
          <>
            <ResponsiveTable
              columns={columns}
              rows={data?.items ?? []}
              rowKey={(item) => item.id}
              emptyMessage="監査ログはありません。"
              mobileRow={mobileRow}
            />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-ink-2" aria-live="polite">
                {page} / {totalPages} ページ
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  className="border border-line"
                  disabled={!canGoBack}
                  onClick={() => setPage(page - 1)}
                >
                  前へ
                </Button>
                <Button
                  variant="ghost"
                  className="border border-line"
                  disabled={!canGoNext}
                  onClick={() => setPage(page + 1)}
                >
                  次へ
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="grid gap-3 rounded-xl border border-critical/40 bg-critical/10 p-4 text-sm text-ink">
      <p role="alert">{message}</p>
      <Button className="justify-self-start" variant="secondary" onClick={onRetry}>
        再試行
      </Button>
    </div>
  );
}
