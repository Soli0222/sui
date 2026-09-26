import type { Person, SplitListItem, SplitStatus, SplitsResponse } from "@sui/shared";
import { useState, startTransition } from "react";
import { ArchivedSection } from "../ArchivedSection";
import { SplitTransactionForm } from "../split-transaction-form";
import { Button, IconButton } from "../ui/button";
import { Card } from "../ui/card";
import { CardList, RecordCardLayout } from "../ui/card-list";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { FormField } from "../ui/form-field";
import { Select } from "../ui/select";
import { useResource } from "../../hooks/use-resource";
import { useToast } from "../../hooks/use-toast";
import { apiFetch } from "../../lib/api";
import { Pencil, Trash2 } from "lucide-react";
import { ErrorBlock, SplitSharesCell, describeError, getSplitStatusBadge } from "./split-helpers";
export function SplitsTab() {
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<SplitStatus | "all">("all");
  const [personId, setPersonId] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSplit, setEditingSplit] = useState<SplitListItem | null>(null);
  const [deletingSplit, setDeletingSplit] = useState<SplitListItem | null>(null);
  const { toast } = useToast();
  const { data, loading, error, setData } = useResource(() => {
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (personId !== "all") params.set("personId", personId);
    const query = params.toString();
    return Promise.all([
      apiFetch<SplitsResponse>(query ? `/api/splits?${query}` : "/api/splits"),
      apiFetch<Person[]>("/api/people"),
    ]).then(([splits, people]) => ({ splits, people }));
  }, [reloadKey, status, personId]);

  const reload = () => startTransition(() => setReloadKey((value) => value + 1));
  const acceptSplits = (all: SplitsResponse) => setData((current) => ({
    splits: all.filter((split) => (status === "all" || split.status === status) &&
      (personId === "all" || split.shares.some((share) => share.personId === personId))),
    people: current?.people ?? [],
  }));

  const closeCreate = () => setCreateOpen(false);
  const closeEdit = () => setEditingSplit(null);
  const handleSaved = () => {
    setCreateOpen(false);
    setEditingSplit(null);
  };

  const confirmDelete = async () => {
    if (!deletingSplit) {
      return;
    }
    try {
      await apiFetch(`/api/splits/${deletingSplit.id}`, { method: "DELETE" });
      toast({ title: "割り勘取引を削除しました" });
      setDeletingSplit(null);
      reload();
    } catch (deleteError) {
      toast({ title: "削除に失敗しました", description: describeError(deleteError), variant: "error" });
    }
  };

  const splits = data?.splits ?? [];
  const activeSplits = splits.filter((split) => split.status !== "settled");
  const settledSplits = splits.filter((split) => split.status === "settled");

  const renderSplit = (split: SplitListItem) => {
    const remaining = split.shares.reduce((sum, share) => sum + share.remainingAmount, 0);
    return <RecordCardLayout
      title={<div><div className="break-words font-medium">{split.description}</div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-3"><span className="whitespace-nowrap">{split.date}</span>{getSplitStatusBadge(split.status)}</div></div>}
      value={<div><div className="text-xs text-ink-3">未回収</div><div className="font-data whitespace-nowrap font-semibold">{remaining.toLocaleString("ja-JP")} 円</div></div>}
      details={<div className="grid min-w-0 gap-1.5">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
          <span className="font-data whitespace-nowrap">合計 {split.amount.toLocaleString("ja-JP")} 円</span>
          <span className="font-data whitespace-nowrap">自分負担 {split.ownShare.toLocaleString("ja-JP")} 円</span>
        </div>
        <div className="min-w-0 text-sm"><div className="mb-1 text-xs text-ink-3">メンバー別未回収</div><SplitSharesCell split={split} /></div>
      </div>}
      actions={<>
        <IconButton aria-label={`${split.description}を編集`} onClick={() => setEditingSplit(split)}><Pencil aria-hidden="true" className="h-4 w-4" /></IconButton>
        <IconButton aria-label={`${split.description}を削除`} variant="danger" onClick={() => setDeletingSplit(split)}><Trash2 aria-hidden="true" className="h-4 w-4" /></IconButton>
      </>}
    />;
  };

  return (
    <>
      <Card>
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <h3 className="text-xl font-semibold">割り勘一覧</h3>
          <div className="flex flex-wrap items-end gap-3">
            <FormField label="状態" className="w-32">
              <Select value={status} onChange={(event) => setStatus(event.target.value as SplitStatus | "all")}>
                <option value="all">すべて</option>
                <option value="unsettled">未精算</option>
                <option value="partial">一部精算</option>
                <option value="settled">精算済</option>
              </Select>
            </FormField>
            <FormField label="メンバー" className="w-40">
              <Select value={personId} onChange={(event) => setPersonId(event.target.value)}>
                <option value="all">すべて</option>
                {(data?.people ?? []).map((person) => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </Select>
            </FormField>
            <Button className="min-h-10 gap-2" onClick={() => setCreateOpen(true)}>
              <span className="text-lg leading-none">+</span>
              割り勘取引を追加
            </Button>
          </div>
        </div>
        {error ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : (
          <>
            <CardList rows={activeSplits} rowKey={(split) => split.id} renderItem={renderSplit}
              emptyMessage={activeSplits.length === 0 && settledSplits.length > 0 ? "未精算の割り勘はありません。" : "該当する割り勘はありません。"} />
            <ArchivedSection title="精算済み" count={settledSplits.length}>
              <CardList rows={settledSplits} rowKey={(split) => split.id} renderItem={renderSplit} />
            </ArchivedSection>
          </>
        )}
        {loading ? <div className="mt-2 text-sm text-ink-3">読み込み中...</div> : null}
      </Card>

      {createOpen ? <SplitTransactionForm people={data?.people ?? []} onSaved={handleSaved} onCancel={closeCreate} onRefreshed={acceptSplits} /> : null}
      {editingSplit ? <SplitTransactionForm key={editingSplit.id} splitId={editingSplit.id} people={data?.people ?? []}
        onSaved={handleSaved} onCancel={closeEdit} onRefreshed={acceptSplits} /> : null}

      <ConfirmDialog
        open={Boolean(deletingSplit)}
        onOpenChange={(open) => !open && setDeletingSplit(null)}
        title="割り勘取引を削除しますか？"
        description={deletingSplit ? `「${deletingSplit.description}」を削除します。この操作は取り消せません。` : undefined}
        onConfirm={confirmDelete}
      />
    </>
  );
}
