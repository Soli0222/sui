import type {
  Person,
  PersonSummaryResponse,
  SettlementKind,
  SettlementListItem,
  SettlementsResponse,
  SplitListItem,
  SplitStatus,
  SplitsResponse,
  TransactionsResponse,
} from "@sui/shared";
import { useEffect, useId, useRef, useState, startTransition } from "react";
import { Badge } from "../components/ui/badge";
import { Button, IconButton } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import { FormField } from "../components/ui/form-field";
import { Input } from "../components/ui/input";
import { ResponsiveTable, type ResponsiveTableColumn } from "../components/ui/responsive-table";
import { SegmentedControl } from "../components/ui/segmented-control";
import { Select } from "../components/ui/select";
import { useResource } from "../hooks/use-resource";
import { useToast } from "../hooks/use-toast";
import { apiFetch } from "../lib/api";
import { SplitTransactionForm } from "../components/split-transaction-form";
import { ArchivedSection } from "../components/ArchivedSection";
import { ChevronDown, Pencil, Trash2 } from "lucide-react";

type Tab = "members" | "splits" | "settlements";

type PersonForm = {
  name: string;
  memo: string;
  sortOrder: number;
};

const emptyForm: PersonForm = { name: "", memo: "", sortOrder: 0 };

const splitStatusLabels: Record<Exclude<SplitStatus, "none">, string> = {
  unsettled: "未精算",
  partial: "一部精算",
  settled: "精算済",
};

const splitStatusTone: Record<Exclude<SplitStatus, "none">, "warning" | "success"> = {
  unsettled: "warning",
  partial: "warning",
  settled: "success",
};

function getSplitStatusBadge(status: SplitStatus) {
  if (status === "none") {
    return null;
  }
  return <Badge tone={splitStatusTone[status]}>{splitStatusLabels[status]}</Badge>;
}

function SplitSharesCell({ split }: { split: SplitListItem }) {
  const [expanded, setExpanded] = useState(false);
  const remaining = split.shares.filter((share) => share.remainingAmount > 0);
  if (remaining.length === 0) {
    return <span className="text-ink-3">未回収なし</span>;
  }
  const total = remaining.reduce((sum, share) => sum + share.remainingAmount, 0);
  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex items-center gap-1 text-ink-2 transition hover:text-ink"
      >
        <span>
          未回収 {remaining.length}人（合計 {total.toLocaleString("ja-JP")}円）
        </span>
        <ChevronDown aria-hidden="true" className={"h-4 w-4 shrink-0 transition-transform" + (expanded ? " rotate-180" : "")} />
      </button>
      {expanded ? (
        <div className="mt-1 grid gap-1 text-xs text-ink-3">
          {remaining.map((share) => (
            <div key={share.id}>
              {share.personName}: {share.remainingAmount.toLocaleString("ja-JP")}円
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatPersonOutstanding(outstandingAmount: Person["outstandingAmount"]) {
  const amount = outstandingAmount.JPY ?? 0;
  if (amount === 0) {
    return <span className="text-ink-3">未回収なし</span>;
  }
  return `${amount.toLocaleString("ja-JP")} 円`;
}

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
      {activeTab === "splits" && <SplitsTab />}
      {activeTab === "settlements" && <SettlementsTab />}
    </div>
  );
}

function MembersTab() {
  const [reloadKey, setReloadKey] = useState(0);
  const [form, setForm] = useState<PersonForm>(emptyForm);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [editForm, setEditForm] = useState<PersonForm>(emptyForm);
  const [deletingPerson, setDeletingPerson] = useState<Person | null>(null);
  const { data, loading, error } = useResource(() => apiFetch<Person[]>('/api/people'), [reloadKey]);
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
    {
      key: "outstanding",
      header: "未回収合計",
      align: "right",
      render: (person) => formatPersonOutstanding(person.outstandingAmount),
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
                  <div className="font-data text-sm font-semibold">{formatPersonOutstanding(person.outstandingAmount)}</div>
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

function SplitsTab() {
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<SplitStatus | "all">("all");
  const [personId, setPersonId] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSplit, setEditingSplit] = useState<SplitListItem | null>(null);
  const [deletingSplit, setDeletingSplit] = useState<SplitListItem | null>(null);
  const { toast } = useToast();
  const { data, loading, error } = useResource(() => {
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

  const closeCreate = () => setCreateOpen(false);
  const closeEdit = () => setEditingSplit(null);
  const handleSaved = () => {
    setCreateOpen(false);
    setEditingSplit(null);
    reload();
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

  const columns: ResponsiveTableColumn<SplitListItem>[] = [
    { key: "date", header: "日付", mono: true, render: (split) => split.date },
    { key: "description", header: "内容", render: (split) => split.description },
    {
      key: "amount",
      header: "合計金額",
      align: "right",
      render: (split) => `${split.amount.toLocaleString("ja-JP")} 円`,
    },
    {
      key: "ownShare",
      header: "自分負担",
      align: "right",
      render: (split) => `${split.ownShare.toLocaleString("ja-JP")} 円`,
    },
    {
      key: "status",
      header: "状態",
      render: (split) => getSplitStatusBadge(split.status),
    },
    {
      key: "remaining",
      header: "未回収",
      align: "right",
      render: (split) =>
        `${split.shares.reduce((sum, share) => sum + share.remainingAmount, 0).toLocaleString("ja-JP")} 円`,
    },
    {
      key: "shareBreakdown",
      header: "未回収内訳",
      render: (split) => <SplitSharesCell split={split} />,
    },
    {
      key: "actions",
      header: "",
      render: (split) => (
        <div className="flex justify-end gap-1">
          <IconButton aria-label="編集" onClick={() => setEditingSplit(split)}>
            <Pencil aria-hidden="true" className="h-4 w-4" />
          </IconButton>
          <IconButton aria-label="削除" variant="danger" onClick={() => setDeletingSplit(split)}>
            <Trash2 aria-hidden="true" className="h-4 w-4" />
          </IconButton>
        </div>
      ),
    },
  ];

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
            <ResponsiveTable
              columns={columns}
              rows={activeSplits}
              rowKey={(split) => split.id}
              emptyMessage={
                activeSplits.length === 0 && settledSplits.length > 0
                  ? "未精算の割り勘はありません。"
                  : "該当する割り勘はありません。"
              }
              mobileRow={(split) => (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{split.description}</div>
                      <div className="text-xs text-ink-3">{split.date}</div>
                    </div>
                    {getSplitStatusBadge(split.status)}
                  </div>
                  <div className="text-xs text-ink-3">
                    合計 {split.amount.toLocaleString("ja-JP")} 円 / 未回収{" "}
                    {split.shares.reduce((sum, share) => sum + share.remainingAmount, 0).toLocaleString("ja-JP")} 円
                  </div>
                  <div className="text-sm">
                    <SplitSharesCell split={split} />
                  </div>
                  <div className="flex justify-end gap-1">
                    <IconButton aria-label="編集" onClick={() => setEditingSplit(split)}>
                      <Pencil aria-hidden="true" className="h-4 w-4" />
                    </IconButton>
                    <IconButton aria-label="削除" variant="danger" onClick={() => setDeletingSplit(split)}>
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </IconButton>
                  </div>
                </>
              )}
            />
            <ArchivedSection title="精算済み" count={settledSplits.length}>
              <ResponsiveTable
                columns={columns}
                rows={settledSplits}
                rowKey={(split) => split.id}
                mobileRow={(split) => (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{split.description}</div>
                        <div className="text-xs text-ink-3">{split.date}</div>
                      </div>
                      {getSplitStatusBadge(split.status)}
                    </div>
                    <div className="text-xs text-ink-3">
                      合計 {split.amount.toLocaleString("ja-JP")} 円
                    </div>
                    <div className="flex justify-end gap-1">
                      <IconButton aria-label="編集" onClick={() => setEditingSplit(split)}>
                        <Pencil aria-hidden="true" className="h-4 w-4" />
                      </IconButton>
                      <IconButton aria-label="削除" variant="danger" onClick={() => setDeletingSplit(split)}>
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                      </IconButton>
                    </div>
                  </>
                )}
              />
            </ArchivedSection>
          </>
        )}
        {loading ? <div className="mt-2 text-sm text-ink-3">読み込み中...</div> : null}
      </Card>

      <Dialog open={createOpen} onOpenChange={(open) => (open ? setCreateOpen(true) : closeCreate())}>
        <DialogContent size="m">
          <DialogTitle className="text-lg font-semibold">割り勘取引を追加</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-ink-2">
            立替・回収の対象となる割り勘取引を登録します。
          </DialogDescription>
          <SplitTransactionForm
            people={data?.people ?? []}
            onSaved={handleSaved}
            onCancel={closeCreate}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingSplit)} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent size="m">
          <DialogTitle className="text-lg font-semibold">割り勘取引を編集</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-ink-2">
            割り勘取引の内容を更新します。
          </DialogDescription>
          <SplitTransactionForm
            splitId={editingSplit?.id}
            people={data?.people ?? []}
            onSaved={handleSaved}
            onCancel={closeEdit}
          />
        </DialogContent>
      </Dialog>

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

function SettlementsTab() {
  const [reloadKey, setReloadKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const { data, loading, error } = useResource(() =>
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
            emptyMessage="精算履歴はありません。"
            mobileRow={(settlement) => (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{settlement.personName}</div>
                    <div className="text-xs text-ink-3">
                      {settlement.date}・{settlement.kind === "transaction" ? "取引精算" : "相殺"}
                    </div>
                  </div>
                  <div className="font-data text-base font-semibold">
                    {settlement.allocations.reduce((sum, a) => sum + a.amount, 0).toLocaleString("ja-JP")} 円
                  </div>
                </div>
              </>
            )}
          />
        )}
        {loading ? <div className="mt-2 text-sm text-ink-3">読み込み中...</div> : null}
      </Card>

      <CreateSettlementDialog
        open={createOpen}
        people={data?.people ?? []}
        onClose={() => setCreateOpen(false)}
        onSaved={reload}
      />
    </>
  );
}

function CreateSettlementDialog({
  open,
  people,
  onClose,
  onSaved,
}: {
  open: boolean;
  people: Person[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [personId, setPersonId] = useState("");
  const [kind, setKind] = useState<SettlementKind>("offset");
  const [transactionId, setTransactionId] = useState("");
  const [date, setDate] = useState("");
  const [offsetTotal, setOffsetTotal] = useState("");
  const [note, setNote] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const { toast } = useToast();
  const { data: summary } = useResource(
    () => (personId ? apiFetch<PersonSummaryResponse>(`/api/people/${personId}/summary`) : Promise.resolve(null)),
    [personId],
  );
  const { data: transactionsResponse } = useResource(
    () =>
      kind === "transaction"
        ? apiFetch<TransactionsResponse>("/api/transactions?type=transfer&limit=100")
        : Promise.resolve(null),
    [kind],
  );

  const reset = () => {
    setPersonId("");
    setKind("offset");
    setTransactionId("");
    setDate("");
    setOffsetTotal("");
    setNote("");
    setAllocations({});
  };

  const handleSave = async () => {
    if (!personId) {
      toast({ title: "メンバーを選択してください", variant: "error" });
      return;
    }
    if (kind === "offset" && !date) {
      toast({ title: "日付を入力してください", variant: "error" });
      return;
    }
    if (kind === "transaction" && !transactionId) {
      toast({ title: "振替取引を選択してください", variant: "error" });
      return;
    }
    const selectedAllocations = Object.entries(allocations)
      .filter(([, value]) => value && Number(value) > 0)
      .map(([shareId, value]) => ({ shareId, amount: Number(value) }));
    if (selectedAllocations.length === 0) {
      toast({ title: "精算する持分を入力してください", variant: "error" });
      return;
    }
    try {
      await apiFetch("/api/settlements", {
        method: "POST",
        body: JSON.stringify({
          kind,
          personId,
          transactionId: kind === "transaction" ? transactionId : null,
          date: kind === "offset" ? date : undefined,
          note: note.trim() || null,
          allocations: selectedAllocations,
        }),
      });
      toast({ title: "精算を記録しました" });
      onSaved();
      onClose();
      reset();
    } catch (saveError) {
      toast({ title: "精算の記録に失敗しました", description: describeError(saveError), variant: "error" });
    }
  };

  const transferOptions =
    transactionsResponse?.items.filter((transaction) => transaction.type === "transfer" && !transaction.settlementLinked) ??
    [];
  const selectedTransaction = transferOptions.find((transaction) => transaction.id === transactionId);

  const distribute = (totalAmount: number) => {
    const unsettledShares = (summary?.shares ?? []).filter((share) => share.remainingAmount > 0);
    if (unsettledShares.length === 0 || totalAmount <= 0) {
      return;
    }
    const next: Record<string, string> = {};
    let remaining = totalAmount;
    for (const share of unsettledShares) {
      if (remaining <= 0) {
        break;
      }
      const amount = Math.min(share.remainingAmount, remaining);
      next[share.id] = String(amount);
      remaining -= amount;
    }
    setAllocations(next);
    if (remaining > 0) {
      toast({
        title: "未回収総額を超えた分は按分できません",
        description: `${remaining.toLocaleString("ja-JP")} 円が余りました`,
        variant: "error",
      });
    }
  };

  const autoAllocate = () => {
    if (kind === "transaction") {
      if (!selectedTransaction) {
        toast({ title: "振替取引を選択してください", variant: "error" });
        return;
      }
      distribute(selectedTransaction.amount);
    } else {
      const parsedTotal = Number(offsetTotal);
      if (!parsedTotal || parsedTotal <= 0) {
        toast({ title: "精算総額を入力してください", variant: "error" });
        return;
      }
      distribute(parsedTotal);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent size="m">
        <DialogTitle className="text-lg font-semibold">精算を記録</DialogTitle>
        <DialogDescription className="mt-2 text-sm text-ink-2">
          メンバーの未精算持分を精算します。
        </DialogDescription>
        <form className="mt-6 grid gap-4">
          <FormField label="メンバー">
            <Select
              value={personId}
              onChange={(event) => {
                setPersonId(event.target.value);
                setAllocations({});
                setOffsetTotal("");
              }}
            >
              <option value="">選択してください</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>{person.name}</option>
              ))}
            </Select>
          </FormField>

          <FormField label="種別">
            <Select value={kind} onChange={(event) => setKind(event.target.value as SettlementKind)}>
              <option value="offset">相殺・現金精算</option>
              <option value="transaction">振替取引で精算</option>
            </Select>
          </FormField>

          {kind === "offset" ? (
            <FormField label="日付">
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </FormField>
          ) : (
            <FormField label="振替取引">
              <Select value={transactionId} onChange={(event) => setTransactionId(event.target.value)}>
                <option value="">選択してください</option>
                {transferOptions.map((transaction) => (
                  <option key={transaction.id} value={transaction.id}>
                    {transaction.date} {transaction.description} ({transaction.amount.toLocaleString("ja-JP")} 円)
                  </option>
                ))}
              </Select>
            </FormField>
          )}

          {kind === "offset" ? (
            <div className="flex items-end gap-3">
              <FormField label="精算総額" className="flex-1">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  placeholder="円"
                  value={offsetTotal}
                  onChange={(event) => setOffsetTotal(event.target.value)}
                />
              </FormField>
              <Button type="button" onClick={autoAllocate}>
                自動按分
              </Button>
            </div>
          ) : (
            <div className="flex justify-end">
              <Button type="button" disabled={!selectedTransaction} onClick={autoAllocate}>
                振替金額で自動按分
              </Button>
            </div>
          )}

          <FormField label="メモ">
            <Input value={note} onChange={(event) => setNote(event.target.value)} />
          </FormField>

          {summary ? (
            <div className="grid gap-2">
              <p className="text-sm font-medium">未精算持分</p>
              {summary.shares.filter((share) => share.remainingAmount > 0).length === 0 ? (
                <p className="text-sm text-ink-2">未精算の持分はありません。</p>
              ) : (
                summary.shares
                  .filter((share) => share.remainingAmount > 0)
                  .map((share) => (
                    <div key={share.id} className="flex items-center gap-3">
                      <span className="min-w-0 flex-1 text-sm truncate">
                        {share.splitDate} {share.splitDescription}（残額 {share.remainingAmount.toLocaleString("ja-JP")}）
                      </span>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={share.remainingAmount}
                        className="w-28"
                        placeholder="金額"
                        value={allocations[share.id] ?? ""}
                        onChange={(event) =>
                          setAllocations((current) => ({ ...current, [share.id]: event.target.value }))
                        }
                      />
                    </div>
                  ))
              )}
            </div>
          ) : null}

          <div className="flex justify-end gap-3 border-t border-line pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              キャンセル
            </Button>
            <Button type="button" onClick={handleSave}>
              保存
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
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
