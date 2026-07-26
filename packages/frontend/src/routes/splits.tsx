import type { Person } from "@sui/shared";
import { useEffect, useId, useRef, useState, startTransition } from "react";
import { Button, IconButton } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import { FormField } from "../components/ui/form-field";
import { Input } from "../components/ui/input";
import { ResponsiveTable, type ResponsiveTableColumn } from "../components/ui/responsive-table";
import { SegmentedControl } from "../components/ui/segmented-control";
import { useResource } from "../hooks/use-resource";
import { useToast } from "../hooks/use-toast";
import { apiFetch } from "../lib/api";
import { Pencil, Trash2 } from "lucide-react";

type Tab = "members" | "splits" | "settlements";

type PersonForm = {
  name: string;
  memo: string;
  sortOrder: number;
};

const emptyForm: PersonForm = { name: "", memo: "", sortOrder: 0 };

export function SplitsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("members");

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">割り勘</h2>
          <p className="mt-2 text-sm text-ink-2">立替・回収の管理を行います。</p>
        </div>
      </div>

      <SegmentedControl<Tab>
        aria-label="割り勘タブ"
        options={[
          { value: "members", label: "メンバー" },
          { value: "splits", label: "割り勘一覧" },
          { value: "settlements", label: "精算" },
        ]}
        value={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === "members" && <MembersTab />}
      {activeTab === "splits" && <PlaceholderTab message="割り勘一覧は今後のリリースで提供されます。" />}
      {activeTab === "settlements" && <PlaceholderTab message="精算機能は今後のリリースで提供されます。" />}
    </div>
  );
}

function PlaceholderTab({ message }: { message: string }) {
  return (
    <Card>
      <p className="text-sm text-ink-2">{message}</p>
    </Card>
  );
}

function MembersTab() {
  const [reloadKey, setReloadKey] = useState(0);
  const [form, setForm] = useState<PersonForm>(emptyForm);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [editForm, setEditForm] = useState<PersonForm>(emptyForm);
  const [deletingPerson, setDeletingPerson] = useState<Person | null>(null);
  const { data, loading, error } = useResource(() => apiFetch<Person[]>("/api/people"), [reloadKey]);
  const { toast } = useToast();

  const reload = () => startTransition(() => setReloadKey((value) => value + 1));

  const canSave = (value: PersonForm) => value.name.trim().length > 0;

  const createPerson = async () => {
    try {
      await apiFetch("/api/people", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          memo: form.memo.trim() || null,
        }),
      });
      setForm(emptyForm);
      setCreateOpen(false);
      reload();
      toast({ title: `${form.name} を追加しました` });
    } catch (createError) {
      toast({
        title: "メンバーの追加に失敗しました",
        description: describeError(createError),
        variant: "error",
      });
    }
  };

  const updatePerson = async () => {
    if (!editingPerson) {
      return;
    }

    try {
      await apiFetch(`/api/people/${editingPerson.id}`, {
        method: "PUT",
        body: JSON.stringify({
          ...editForm,
          memo: editForm.memo.trim() || null,
        }),
      });
      setEditingPerson(null);
      setEditForm(emptyForm);
      reload();
      toast({ title: `${editForm.name} を更新しました` });
    } catch (updateError) {
      toast({
        title: "メンバーの更新に失敗しました",
        description: describeError(updateError),
        variant: "error",
      });
    }
  };

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
    setEditForm({
      name: person.name,
      memo: person.memo ?? "",
      sortOrder: person.sortOrder,
    });
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setForm(emptyForm);
  };

  const closeEdit = () => {
    setEditingPerson(null);
    setEditForm(emptyForm);
  };

  const columns: ResponsiveTableColumn<Person>[] = [
    { key: "name", header: "名前", render: (person) => person.name },
    {
      key: "memo",
      header: "メモ",
      render: (person) => <span className="text-ink-2">{person.memo ?? "-"}</span>,
    },
    { key: "sortOrder", header: "表示順", mono: true, render: (person) => person.sortOrder },
    {
      key: "actions",
      header: "",
      render: (person) => (
        <div className="flex justify-end gap-1">
          <IconButton aria-label="編集" onClick={() => openEdit(person)}>
            <Pencil aria-hidden="true" className="h-4 w-4" />
          </IconButton>
          <IconButton aria-label="削除" variant="danger" onClick={() => requestDelete(person)}>
            <Trash2 aria-hidden="true" className="h-4 w-4" />
          </IconButton>
        </div>
      ),
    },
  ];

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
          <ResponsiveTable
            columns={columns}
            rows={data ?? []}
            rowKey={(person) => person.id}
            emptyMessage="メンバーが登録されていません。上部の「メンバーを追加」から登録してください。"
            mobileRow={(person) => (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{person.name}</div>
                    <div className="text-xs text-ink-3">{person.memo ?? "メモなし"}</div>
                  </div>
                  <div className="text-xs text-ink-3">順 {person.sortOrder}</div>
                </div>
                <div className="flex justify-end gap-1">
                  <IconButton aria-label="編集" onClick={() => openEdit(person)}>
                    <Pencil aria-hidden="true" className="h-4 w-4" />
                  </IconButton>
                  <IconButton aria-label="削除" variant="danger" onClick={() => requestDelete(person)}>
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </IconButton>
                </div>
              </>
            )}
          />
        )}
        {loading ? <div className="mt-2 text-sm text-ink-3">読み込み中...</div> : null}
      </Card>

      <Dialog open={createOpen} onOpenChange={(open) => (open ? setCreateOpen(true) : closeCreate())}>
        <DialogContent size="m">
          <DialogTitle className="text-lg font-semibold">メンバーを追加</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-ink-2">
            割り勘に参加する人を登録します。
          </DialogDescription>
          <PersonEditModal
            form={form}
            onChange={setForm}
            canSave={canSave(form)}
            actionLabel="追加"
            onCancel={closeCreate}
            onSave={createPerson}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingPerson)} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent size="m">
          <DialogTitle className="text-lg font-semibold">メンバーを編集</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-ink-2">メンバー情報を更新します。</DialogDescription>
          <PersonEditModal
            form={editForm}
            onChange={setEditForm}
            canSave={canSave(editForm)}
            actionLabel="保存"
            onCancel={closeEdit}
            onSave={updatePerson}
          />
        </DialogContent>
      </Dialog>

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

function PersonEditModal({
  form,
  onChange,
  canSave,
  actionLabel,
  onCancel,
  onSave,
}: {
  form: PersonForm;
  onChange: (next: PersonForm) => void;
  canSave: boolean;
  actionLabel: string;
  onCancel: () => void;
  onSave: () => void;
}) {
  const nameId = useId();
  const memoId = useId();
  const sortOrderId = useId();
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  return (
    <form
      className="mt-6 grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) {
          onSave();
        }
      }}
    >
      <FormField label="名前" htmlFor={nameId} required>
        <Input
          id={nameId}
          ref={firstFieldRef}
          required
          value={form.name}
          onChange={(event) => onChange({ ...form, name: event.target.value })}
        />
      </FormField>

      <FormField label="メモ" htmlFor={memoId}>
        <Input
          id={memoId}
          value={form.memo}
          onChange={(event) => onChange({ ...form, memo: event.target.value })}
        />
      </FormField>

      <FormField label="表示順" htmlFor={sortOrderId}>
        <Input
          id={sortOrderId}
          type="number"
          inputMode="numeric"
          value={form.sortOrder}
          onChange={(event) => onChange({ ...form, sortOrder: Number(event.target.value) })}
        />
      </FormField>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <div className="text-xs text-ink-3">{!canSave ? "必須: 名前" : ""}</div>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onCancel}>
            キャンセル
          </Button>
          <Button type="submit" disabled={!canSave}>
            {actionLabel}
          </Button>
        </div>
      </div>
    </form>
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

function describeError(error: unknown) {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}
