import type { Person, SettlementListItem, SettlementsResponse } from "@sui/shared";
import { useState, startTransition } from "react";
import { Button, IconButton } from "../ui/button";
import { Card } from "../ui/card";
import { ResponsiveTable, type ResponsiveTableColumn } from "../ui/responsive-table";
import { useResource } from "../../hooks/use-resource";
import { useToast } from "../../hooks/use-toast";
import { apiFetch } from "../../lib/api";
import { Trash2 } from "lucide-react";
import { CreateSettlementDialog } from "./settlement-editor";
import { ErrorBlock, describeError } from "./split-helpers";
export function SettlementsTab() {
  const [reloadKey, setReloadKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const { data, loading, error, setData } = useResource(() =>
    Promise.all([
      apiFetch<SettlementsResponse>("/api/settlements"),
      apiFetch<Person[]>("/api/people"),
    ]).then(([settlements, people]) => ({ settlements, people })),
    [reloadKey],
  );
  const { toast } = useToast();

  const reload = () => startTransition(() => setReloadKey((value) => value + 1));

  const columns: ResponsiveTableColumn<SettlementListItem>[] = [
    { key: "date", header: "日付", mono: true, render: (settlement) => settlement.date },
    { key: "person", header: "メンバー", render: (settlement) => settlement.personName },
    {
      key: "kind",
      header: "種別",
      render: (settlement) => (settlement.kind === "transaction" ? "取引精算" : "相殺"),
    },
    {
      key: "amount",
      header: "金額",
      align: "right",
      render: (settlement) =>
        `${settlement.allocations.reduce((sum, a) => sum + a.amount, 0).toLocaleString("ja-JP")} 円`,
    },
    { key: "note", header: "メモ", render: (settlement) => settlement.note ?? "-" },
    {
      key: "actions",
      header: "",
      render: (settlement) => (
        <div className="flex justify-end">
          <IconButton aria-label="削除" variant="danger" onClick={() => deleteSettlement(settlement.id)}>
            <Trash2 aria-hidden="true" className="h-4 w-4" />
          </IconButton>
        </div>
      ),
    },
  ];

  const deleteSettlement = async (id: string) => {
    try {
      await apiFetch(`/api/settlements/${id}`, { method: "DELETE" });
      toast({ title: "精算を削除しました" });
      reload();
    } catch (deleteError) {
      toast({ title: "精算の削除に失敗しました", description: describeError(deleteError), variant: "error" });
    }
  };

  return (
    <>
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-semibold">精算一覧</h3>
          <Button className="min-h-10 gap-2" onClick={() => setCreateOpen(true)}>
            <span className="text-lg leading-none">+</span>
            精算を記録
          </Button>
        </div>
        {error ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : (
          <ResponsiveTable
            columns={columns}
            rows={data?.settlements ?? []}
            rowKey={(settlement) => settlement.id}
            breakpoint={900}
            emptyMessage="精算履歴はありません。"
            mobileRow={(settlement) => (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="break-words font-medium">{settlement.personName}</div>
                    <div className="text-xs text-ink-3">
                      {settlement.date}・{settlement.kind === "transaction" ? "取引精算" : "相殺"}
                    </div>
                  </div>
                  <div className="font-data whitespace-nowrap font-semibold">
                    {settlement.allocations.reduce((sum, a) => sum + a.amount, 0).toLocaleString("ja-JP")} 円
                  </div>
                </div>
                {settlement.note && <div className="break-words text-xs text-ink-2">メモ {settlement.note}</div>}
                <div className="flex justify-end"><IconButton aria-label={`${settlement.personName}の精算を取り消す`} variant="danger" onClick={() => deleteSettlement(settlement.id)}><Trash2 aria-hidden="true" className="h-4 w-4" /></IconButton></div>
              </>
            )}
          />
        )}
        {loading ? <div className="mt-2 text-sm text-ink-3">読み込み中...</div> : null}
      </Card>

      {createOpen ? (
        <CreateSettlementDialog
          open
          people={data?.people ?? []}
          onClose={() => setCreateOpen(false)}
          onSaved={() => setCreateOpen(false)}
          onRefreshed={(settlements) => setData((current) => ({ settlements, people: current?.people ?? [] }))}
        />
      ) : null}
    </>
  );
}
