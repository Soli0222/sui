import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { SpendingResponse } from "@sui/shared";
import { apiFetch } from "../lib/api";
/** Shows all approval links alongside the existing financial source screens. */
export function SpendingBacklinks({
  kind,
}: {
  kind: "recurring" | "transaction" | "account";
}) {
  const [state, setState] = useState<SpendingResponse | null>(null);
  useEffect(() => {
    let active = true;
    apiFetch<SpendingResponse>("/api/spending")
      .then((s) => {
        if (active) setState(s);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const requests =
    state?.ledger.requests.filter(
      (r) =>
        !r.deletedAt &&
        r.fundingLinks.length &&
        (kind !== "transaction" ||
          state.requestStates[r.id].funding.some((f) => f.transactionId)),
    ) ?? [];
  if (!requests.length) return null;
  return (
    <aside className="rounded border border-line p-3 text-sm">
      <details>
        <summary>関連する支出決裁 ({requests.length}件)</summary>
        {requests.map((r) => (
          <p key={r.id} className="mt-2">
            <Link className="underline" to={`/spending?request=${r.id}`}>
              {r.input.name}
            </Link>
            {state?.requestStates[r.id].issues.length ? " · 要確認" : ""}{" "}
            {kind === "account"
              ? "· 口座の利用不可・削除前に未解決の振替を確認してください"
              : ""}
          </p>
        ))}
      </details>
    </aside>
  );
}
