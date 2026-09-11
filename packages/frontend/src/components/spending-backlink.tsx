import { useState } from "react";
import { Link } from "react-router-dom";
import type { SpendingResponse } from "@sui/shared";
import { apiFetch } from "../lib/api";
import { useResource } from "../hooks/use-resource";
import { Button } from "./ui/button";

export function SpendingBacklinks({ kind, reloadKey = 0 }: {
  kind: "recurring" | "transaction" | "account";
  reloadKey?: number;
}) {
  const [retry, setRetry] = useState(0);
  const { data: state, error, loading } = useResource(
    () => apiFetch<SpendingResponse>("/api/spending"), [reloadKey, retry],
  );
  if (error) return (
    <aside role="alert" className="rounded border border-line p-3 text-sm">
      関連する支出決裁を取得できませんでした。
      <Button variant="ghost" onClick={() => setRetry(n => n + 1)}>再試行</Button>
    </aside>
  );
  if (loading) return <p role="status" className="text-sm text-ink-2">関連する支出決裁を確認中…</p>;
  const requests = state?.ledger.requests.filter(r => {
    if (r.deletedAt) return false;
    const status = state.requestStates[r.id];
    if (!status) return false;
    return kind === "transaction"
      ? status.funding.some(f => f.transactionId)
      : kind === "recurring"
        ? status.pendingFundingActionRequired
        : status.fundingActionRequired;
  }) ?? [];
  if (!requests.length) return null;
  return (
    <aside className="rounded border border-line p-3 text-sm">
      <details>
        <summary>関連する支出決裁 ({requests.length}件)</summary>
        {requests.map(r => (
          <p key={r.id} className="mt-2">
            <Link className="underline" to={`/spending?request=${r.id}`}>{r.input.name}</Link>
            {state?.requestStates[r.id].issues.length ? " · 要確認" : ""}
            {kind === "account" ? " · 口座の利用不可・削除前に未解決の振替を確認してください" : ""}
          </p>
        ))}
      </details>
    </aside>
  );
}
