import type { Person } from "@sui/shared";
import { useState, startTransition } from "react";
import { Button, IconButton } from "../ui/button";
import { Card } from "../ui/card";
import { CardList, RecordCardLayout } from "../ui/card-list";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { useResource } from "../../hooks/use-resource";
import { useToast } from "../../hooks/use-toast";
import { apiFetch } from "../../lib/api";
import { Pencil, Trash2 } from "lucide-react";
import { PersonEditModal } from "./person-editor";
import { ErrorBlock, calculateTotalOutstanding, describeError, formatPersonOutstanding } from "./split-helpers";
export function MembersTab() {
  const [reloadKey, setReloadKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [deletingPerson, setDeletingPerson] = useState<Person | null>(null);
  const { data, loading, error, setData } = useResource(() => apiFetch<Person[]>('/api/people'), [reloadKey]);
  const { toast } = useToast();

  const reload = () => startTransition(() => setReloadKey((value) => value + 1));
  const people = data ?? [];

  const requestDelete = (person: Person) => setDeletingPerson(person);

  const confirmDelete = async () => {
    if (!deletingPerson) {
      return;
    }

    try {
      await apiFetch(`/api/people/${deletingPerson.id}`, { method: "DELETE" });
      toast({ title: `${deletingPerson.name} を削除しました` });
      setDeletingPerson(null);
      reload();
    } catch (deleteError) {
      toast({
        title: "メンバーの削除に失敗しました",
        description: describeError(deleteError),
        variant: "error",
      });
    }
  };

  const openEdit = (person: Person) => {
    setEditingPerson(person);
  };

  const closeCreate = () => {
    setCreateOpen(false);
  };

  const closeEdit = () => {
    setEditingPerson(null);
  };

  const renderPerson = (person: Person) => <RecordCardLayout
    title={<div><div className="break-words font-medium">{person.name}</div>
      {person.memo && <div className="mt-1 break-words text-xs text-ink-3">メモ {person.memo}</div>}</div>}
    value={<div><div className="text-xs text-ink-3">未回収合計</div><div className="font-data whitespace-nowrap font-semibold">{formatPersonOutstanding(person.outstandingAmount)}</div></div>}
    actions={<>
      <IconButton aria-label={`${person.name}を編集`} onClick={() => openEdit(person)}><Pencil aria-hidden="true" className="h-4 w-4" /></IconButton>
      <IconButton aria-label={`${person.name}を削除`} variant="danger" onClick={() => requestDelete(person)}><Trash2 aria-hidden="true" className="h-4 w-4" /></IconButton>
    </>}
  />;

  return (
    <>
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-semibold">メンバー</h3>
          <Button className="min-h-10 gap-2" onClick={() => setCreateOpen(true)}>
            <span className="text-lg leading-none">+</span>
            メンバーを追加
          </Button>
        </div>
        {error ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : (
          <>
            <div className="mb-4 rounded-xl bg-surface-2 p-4" data-testid="members-total-outstanding">
              <p className="text-sm text-ink-2">未回収合計</p>
              <p className="mt-1 text-2xl font-data font-semibold">
                {loading && data == null
                  ? "読み込み中..."
                  : `${calculateTotalOutstanding(people).toLocaleString("ja-JP")} 円`}
              </p>
            </div>
            {data ? (
              <CardList rows={people} rowKey={(person) => person.id} renderItem={renderPerson}
                emptyMessage="メンバーが登録されていません。上部の「メンバーを追加」から登録してください。" />
            ) : null}
          </>
        )}
        {loading ? <div className="mt-2 text-sm text-ink-3">読み込み中...</div> : null}
      </Card>

      {createOpen ? <PersonEditModal onCancel={closeCreate} onRefreshed={setData} onSaved={closeCreate} /> : null}
      {editingPerson ? <PersonEditModal key={editingPerson.id} person={editingPerson} onCancel={closeEdit}
        onRefreshed={setData} onSaved={closeEdit} /> : null}

      <ConfirmDialog
        open={Boolean(deletingPerson)}
        onOpenChange={(open) => !open && setDeletingPerson(null)}
        title="メンバーを削除しますか？"
        description={deletingPerson ? `「${deletingPerson.name}」を削除します。この操作は取り消せません。` : undefined}
        onConfirm={confirmDelete}
      />
    </>
  );
}
