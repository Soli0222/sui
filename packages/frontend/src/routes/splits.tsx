import { INT4_MAX, type Person,
  type PersonSummaryResponse, type SettlementKind, type SettlementListItem,
  type SettlementsResponse, type SplitListItem, type SplitShareItem,
  type SplitStatus, type SplitsResponse, type Transaction,
  type TransactionsResponse } from "@sui/shared";
import { useId, useState, startTransition } from "react";
import { EditModal, type EditChange } from "../components/editing/edit-surface";
import { Badge } from "../components/ui/badge";
import { Button, IconButton } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { CardList } from "../components/ui/card-list";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { FormField } from "../components/ui/form-field";
import { Input } from "../components/ui/input";
import { readMoneyDraft } from "../components/ui/money-input";
import { normalizeCurrencyInputValue } from "../lib/format";
import { ResponsiveTable, type ResponsiveTableColumn } from "../components/ui/responsive-table";
import { SegmentedControl } from "../components/ui/segmented-control";
import { Select } from "../components/ui/select";
import { useResource } from "../hooks/use-resource";
import { useEditSession, type EditErrors } from "../hooks/use-edit-session";
import { useFieldValidation } from "../hooks/use-field-validation";
import { useToast } from "../hooks/use-toast";
import { apiFetch } from "../lib/api";
import { getTodayDate } from "../lib/utils";
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

export function getSplitStatusBadge(status: SplitStatus) {
  if (status === "none") {
    return null;
  }
  return <Badge tone={splitStatusTone[status]} className="whitespace-nowrap">{splitStatusLabels[status]}</Badge>;
}

export function getTransactionSettlementRemaining(transaction: Transaction): number {
  return transaction.settlementRemainingAmount ?? transaction.amount;
}

export function isSettlementCandidate(transaction: Transaction): boolean {
  return (
    transaction.type === "transfer" &&
    transaction.currencyCode === "JPY" &&
    getTransactionSettlementRemaining(transaction) > 0
  );
}

const TRANSFER_OPTION_DESCRIPTION_MAX_GRAPHEMES = 24;

function getGraphemeSegments(input: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    try {
      const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
      return Array.from(segmenter.segment(input), (segment) => segment.segment);
    } catch {
      // fall through to a safe fallback for environments without Segmenter.
    }
  }
  return input.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]|./g) ?? [];
}

export function truncateByGraphemes(input: string, maxLength: number): string {
  const segments = getGraphemeSegments(input);
  if (segments.length <= maxLength) {
    return input;
  }
  return `${segments.slice(0, maxLength).join("")}…`;
}

export function formatTransferOptionLabel(
  transaction: Transaction,
  maxDescriptionLength = TRANSFER_OPTION_DESCRIPTION_MAX_GRAPHEMES,
): string {
  const remaining = getTransactionSettlementRemaining(transaction);
  const description = truncateByGraphemes(transaction.description, maxDescriptionLength);
  return `${transaction.date} / 残り ${remaining.toLocaleString("ja-JP")}円 / ${description}`;
}

export function SettlementTransferDetailPanel({ transaction }: { transaction: Transaction }) {
  const remaining = getTransactionSettlementRemaining(transaction);
  const allocated = transaction.settlementAllocatedAmount ?? 0;
  return (
    <div className="min-w-0 rounded-xl bg-surface-2 p-3 text-sm">
      <div className="grid gap-1">
        <div className="break-words font-medium">{transaction.description}</div>
        <div className="text-ink-2">
          <span className="font-data">{transaction.date}</span>
          {" / 総額 "}
          <span className="font-data">{transaction.amount.toLocaleString("ja-JP")}</span> 円
        </div>
        <div className="text-ink-2">
          精算済み <span className="font-data">{allocated.toLocaleString("ja-JP")}</span> 円
          {" / 残額 "}
          <span className="font-data">{remaining.toLocaleString("ja-JP")}</span> 円
        </div>
        <div className="text-ink-2">
          振替元: <span className="break-words">{transaction.accountName ?? "未設定"}</span>
        </div>
        <div className="text-ink-2">
          振替先: <span className="break-words">{transaction.transferToAccountName ?? "未設定"}</span>
        </div>
      </div>
    </div>
  );
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
        className="flex min-w-0 items-center gap-1 whitespace-nowrap text-ink-2 transition hover:text-ink"
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

export function calculateTotalOutstanding(people: Person[]): number {
  return people.reduce((sum, person) => sum + (person.outstandingAmount.JPY ?? 0), 0);
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

  const renderPerson = (person: Person) => <>
    <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
      <div className="min-w-0"><div className="break-words font-medium">{person.name}</div>
        {person.memo && <div className="mt-1 break-words text-xs text-ink-3">メモ {person.memo}</div>}</div>
      <div className="sm:text-right"><div className="text-xs text-ink-3">未回収合計</div><div className="font-data whitespace-nowrap font-semibold">{formatPersonOutstanding(person.outstandingAmount)}</div></div>
    </div>
    <div className="text-xs text-ink-2">表示順 {person.sortOrder}</div>
    <div className="flex justify-end gap-1">
      <IconButton aria-label={`${person.name}を編集`} onClick={() => openEdit(person)}><Pencil aria-hidden="true" className="h-4 w-4" /></IconButton>
      <IconButton aria-label={`${person.name}を削除`} variant="danger" onClick={() => requestDelete(person)}><Trash2 aria-hidden="true" className="h-4 w-4" /></IconButton>
    </div>
  </>;

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
    return <>
      <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0"><div className="break-words font-medium">{split.description}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-3"><span className="whitespace-nowrap">{split.date}</span>{getSplitStatusBadge(split.status)}</div></div>
        <div className="sm:text-right"><div className="text-xs text-ink-3">未回収</div><div className="font-data whitespace-nowrap font-semibold">{remaining.toLocaleString("ja-JP")} 円</div></div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        <span className="font-data whitespace-nowrap">合計 {split.amount.toLocaleString("ja-JP")} 円</span>
        <span className="font-data whitespace-nowrap">自分負担 {split.ownShare.toLocaleString("ja-JP")} 円</span>
      </div>
      <div className="min-w-0 text-sm"><div className="mb-1 text-xs text-ink-3">メンバー別未回収</div><SplitSharesCell split={split} /></div>
      <div className="flex justify-end gap-1">
        <IconButton aria-label={`${split.description}を編集`} onClick={() => setEditingSplit(split)}><Pencil aria-hidden="true" className="h-4 w-4" /></IconButton>
        <IconButton aria-label={`${split.description}を削除`} variant="danger" onClick={() => setDeletingSplit(split)}><Trash2 aria-hidden="true" className="h-4 w-4" /></IconButton>
      </div>
    </>;
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

type SettlementDraft = { personId: string; kind: SettlementKind; transactionId: string; date: string;
  offsetTotal: string; note: string; allocations: Record<string, string> };

export function CreateSettlementDialog({
  open,
  people,
  onClose,
  onSaved,
  onRefreshed,
}: {
  open: boolean;
  people: Person[];
  onClose: () => void;
  onSaved: () => void;
  onRefreshed?: (settlements: SettlementsResponse) => void;
}) {
  const personFieldId = useId(); const dateFieldId = useId(); const transactionFieldId = useId();
  const validate = (draft: SettlementDraft): EditErrors => {
    const errors: EditErrors = {};
    if (!draft.personId) errors.personId = "メンバーを選択してください";
    if (draft.kind === "offset" && !draft.date) errors.date = "日付を入力してください";
    if (draft.kind === "transaction" && (!draft.transactionId || !selectedTransaction)) errors.transactionId = "振替取引を選択してください";
    if (draft.personId && !activeSummary) errors.allocations = "持分の読み込みを待ってください";
    let allocated = 0;
    for (const [shareId, raw] of Object.entries(draft.allocations)) {
      if (!raw.trim()) continue;
      const amount = readMoneyDraft(raw, "JPY");
      if (amount.kind === "valid" && amount.minorUnits === 0) continue;
      const share = activeSummary?.shares.find((item) => item.id === shareId && item.remainingAmount > 0);
      if (amount.kind !== "valid" || amount.minorUnits === null || amount.minorUnits <= 0 || amount.minorUnits > INT4_MAX) {
        errors[`allocation-${shareId}`] = "1円以上、上限以内の整数を入力してください";
      } else if (!share || amount.minorUnits > share.remainingAmount) {
        errors[`allocation-${shareId}`] = "未精算の残額以下にしてください";
      } else allocated += amount.minorUnits;
    }
    if (allocated === 0 && !errors.allocations) errors.allocations = "精算する持分を入力してください";
    if (draft.kind === "transaction" && selectedTransaction && allocated > getTransactionSettlementRemaining(selectedTransaction)) {
      errors.allocations = "振替取引の未充当額以下にしてください";
    }
    return errors;
  };
  const fieldIds = { personId: personFieldId, date: dateFieldId, transactionId: transactionFieldId, allocations: "settlement-shares" };
  const session = useEditSession<SettlementDraft>({ identity: "new-settlement", initial: { personId: "", kind: "offset", transactionId: "", date: getTodayDate(), offsetTotal: "", note: "", allocations: {} }, validate, fieldIds });
  const draft = session.draft;
  const { personId, kind, transactionId, date, offsetTotal, note, allocations } = draft;
  const { data: summary, loading: summaryLoading } = useResource(
    () => personId ? apiFetch<PersonSummaryResponse>(`/api/people/${personId}/summary`) : Promise.resolve(null), [personId],
  );
  const { data: transactionsResponse } = useResource(
    () => kind === "transaction" ? apiFetch<TransactionsResponse>("/api/transactions?type=transfer&limit=100") : Promise.resolve(null), [kind],
  );
  const activeSummary = !summaryLoading && summary?.person.id === personId ? summary : null;
  const transferOptions = transactionsResponse?.items.filter(isSettlementCandidate) ?? [];
  const selectedTransaction = transferOptions.find((transaction) => transaction.id === transactionId);
  const fields = useFieldValidation(draft, validate, fieldIds);
  const set = (patch: Partial<SettlementDraft>) => session.setDraft({ ...draft, ...patch });
  const { toast } = useToast();

  const handleSave = async () => {
    fields.showAll();
    const ok = await session.save((value) => {
      const selectedAllocations = Object.entries(value.allocations)
        .map(([shareId, raw]) => ({ shareId, amount: readMoneyDraft(raw, "JPY").minorUnits ?? 0 }))
        .filter(({ amount }) => amount > 0);
      return apiFetch("/api/settlements", {
        method: "POST",
        body: JSON.stringify({
          kind: value.kind,
          personId: value.personId,
          transactionId: value.kind === "transaction" ? value.transactionId : null,
          date: value.kind === "offset" ? value.date : undefined,
          note: value.note.trim() || null,
          allocations: selectedAllocations,
        }),
      });
    }, async () => {
      const settlements = await apiFetch<SettlementsResponse>("/api/settlements");
      onRefreshed?.(settlements);
      return draft;
    });
    if (ok) { toast({ title: "精算を記録しました" }); onSaved(); }
  };

  const distribute = (totalAmount: number) => {
    const unsettledShares = (activeSummary?.shares ?? []).filter((share) => share.remainingAmount > 0);
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
    set({ allocations: next });
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
      distribute(getTransactionSettlementRemaining(selectedTransaction));
    } else {
      const parsed = readMoneyDraft(offsetTotal, "JPY");
      const parsedTotal = parsed.minorUnits;
      if (parsed.kind !== "valid" || parsedTotal === null || parsedTotal <= 0 || parsedTotal > INT4_MAX) {
        toast({ title: "精算総額を1円以上、上限以内で入力してください", variant: "error" });
        return;
      }
      distribute(parsedTotal);
    }
  };

  const changes: EditChange[] = [];
  if (personId) changes.push({ label: "メンバー", before: "未選択", after: people.find((person) => person.id === personId)?.name ?? personId });
  if (kind !== session.snapshot.kind) changes.push({ label: "精算方法", before: "相殺・現金精算", after: "振替取引で精算" });
  if (kind === "offset" && date !== session.snapshot.date) changes.push({ label: "精算日", before: session.snapshot.date, after: date || "未入力" });
  if (kind === "transaction" && transactionId) changes.push({ label: "振替取引", before: "未選択", after: selectedTransaction ? formatTransferOptionLabel(selectedTransaction) : transactionId });
  if (Object.values(allocations).some(Boolean)) changes.push({ label: "精算額", before: "未入力", after: `${Object.values(allocations).reduce((sum, value) => sum + (Number(value) || 0), 0).toLocaleString("ja-JP")} 円` });
  if (note !== session.snapshot.note) changes.push({ label: "メモ", before: "未入力", after: note || "未入力" });
  return (
    <EditModal open={open} subjectType="割り勘の精算" subjectName="精算" mode="record" status={session.status}
      error={session.error} changes={changes} saveLabel="精算を記録"
      impact={kind === "transaction" ? "選んだ振替取引を未回収持分に割り当てます。振替取引の口座反映を重複させません。" : "未回収持分の精算履歴を記録します。口座残高には直接反映しません。"}
      onRequestClose={() => session.requestClose(onClose)} onSave={() => void handleSave()}
      onRetryRefresh={() => void session.retryRefresh().then((ok) => { if (ok) onSaved(); })}>
        <form className="grid min-w-0 gap-4" onSubmit={(event) => { event.preventDefault(); void handleSave(); }}>
          <FormField label="メンバー" htmlFor={personFieldId} required error={fields.visibleErrors.personId}>
            <Select
              id={personFieldId}
              value={personId}
              onChange={(event) => {
                set({ personId: event.target.value, allocations: {}, offsetTotal: "" });
              }}
            >
              <option value="">選択してください</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>{person.name}</option>
              ))}
            </Select>
          </FormField>

          <FormField label="種別">
            <Select
              aria-label="種別"
              value={kind}
              onChange={(event) => set({ kind: event.target.value as SettlementKind })}
            >
              <option value="offset">相殺・現金精算</option>
              <option value="transaction">振替取引で精算</option>
            </Select>
          </FormField>

          {kind === "offset" ? (
            <FormField label="日付" htmlFor={dateFieldId} required error={fields.visibleErrors.date}>
              <Input id={dateFieldId} type="date" value={date} onChange={(event) => set({ date: event.target.value })} />
            </FormField>
          ) : (
            <FormField label="振替取引" htmlFor={transactionFieldId} required error={fields.visibleErrors.transactionId} className="min-w-0">
              <Select
                id={transactionFieldId}
                value={transactionId}
                onChange={(event) => set({ transactionId: event.target.value })}
                className="w-full min-w-0 truncate"
              >
                <option value="">選択してください</option>
                {transferOptions.map((transaction) => (
                  <option key={transaction.id} value={transaction.id}>
                    {formatTransferOptionLabel(transaction)}
                  </option>
                ))}
              </Select>
              {selectedTransaction ? (
                <div className="mt-2 min-w-0">
                  <SettlementTransferDetailPanel transaction={selectedTransaction} />
                </div>
              ) : null}
            </FormField>
          )}

          {kind === "offset" ? (
            <div className="flex items-end gap-3">
              <FormField label="精算総額" className="flex-1">
                <Input
                  type="text"
                  inputMode="numeric"
                  data-1p-ignore="true"
                  placeholder="円"
                  value={offsetTotal}
                  onChange={(event) => {
                    const normalized = normalizeCurrencyInputValue(event.target.value, "JPY");
                    if (normalized.valid) set({ offsetTotal: normalized.value });
                  }}
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
            <Input value={note} onChange={(event) => set({ note: event.target.value })} />
          </FormField>

          {activeSummary ? (
            <div id="settlement-shares" className="grid min-w-0 gap-2">
              <p className="text-sm font-medium">未精算持分</p>
              {fields.visibleErrors.allocations ? <p role="alert" className="text-sm text-critical">{fields.visibleErrors.allocations}</p> : null}
              {activeSummary.shares.filter((share) => share.remainingAmount > 0).length === 0 ? (
                <p className="text-sm text-ink-2">未精算の持分はありません。</p>
              ) : (
                activeSummary.shares
                  .filter((share) => share.remainingAmount > 0)
                  .map((share) => (
                    <SettlementShareAllocationRow
                      key={share.id}
                      share={share}
                      value={allocations[share.id] ?? ""}
                      error={fields.visibleErrors[`allocation-${share.id}`]}
                      onBlur={() => fields.touch(`allocation-${share.id}`)}
                      onChange={(value) =>
                        set({ allocations: { ...allocations, [share.id]: value } })
                      }
                    />
                  ))
              )}
            </div>
          ) : null}

          <button type="submit" className="sr-only" aria-hidden="true" tabIndex={-1}>保存</button>
        </form>
    </EditModal>
  );
}

/**
 * 未精算持分の 1 行。
 * 割り勘タイトルが長くても按分金額の入力欄が押し出されないよう、
 * 情報側を可変幅（minmax(0,1fr)）、入力欄を固定幅の列として分離する。
 */
export function SettlementShareAllocationRow({
  share,
  value,
  error,
  onBlur,
  onChange,
}: {
  share: SplitShareItem;
  value: string;
  error?: string;
  onBlur?: () => void;
  onChange: (next: string) => void;
}) {
  const fullTitle = `${share.splitDate} ${share.splitDescription}`;

  return (
    <div className="grid min-w-0 gap-1 sm:grid-cols-[minmax(0,1fr)_7rem] sm:items-center sm:gap-3">
      <div className="min-w-0">
        <p className="line-clamp-2 break-words text-sm" title={fullTitle}>
          <span className="font-data">{share.splitDate}</span> {share.splitDescription}
        </p>
        <p className="text-xs text-ink-2">
          残額 <span className="font-data">{share.remainingAmount.toLocaleString("ja-JP")}</span> 円
        </p>
      </div>
      <div className="w-full min-w-0 sm:w-28">
        <Input
          id={`allocation-${share.id}`}
          type="text"
          inputMode="numeric"
          data-1p-ignore="true"
          max={share.remainingAmount}
          className="w-full"
          placeholder="金額"
          aria-label={`${share.splitDescription} の按分金額`}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `allocation-error-${share.id}` : undefined}
          value={value}
          onBlur={onBlur}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      {error ? <p id={`allocation-error-${share.id}`} role="alert" className="text-sm text-critical sm:col-span-2">{error}</p> : null}
    </div>
  );
}

function PersonEditModal({ person, onCancel, onSaved, onRefreshed }: {
  person?: Person; onCancel: () => void; onSaved: () => void; onRefreshed: (people: Person[]) => void;
}) {
  const nameId = useId();
  const memoId = useId();
  const sortOrderId = useId();
  const { toast } = useToast();
  const initial: PersonForm = person ? { name: person.name, memo: person.memo ?? "", sortOrder: person.sortOrder } : emptyForm;
  const validate = (value: PersonForm): EditErrors => {
    const errors: EditErrors = {};
    if (!value.name.trim()) errors.name = "名前を入力してください";
    if (!Number.isSafeInteger(value.sortOrder)) errors.sortOrder = "整数で入力してください";
    return errors;
  };
  const fieldIds = { name: nameId, sortOrder: sortOrderId };
  const session = useEditSession({ identity: `person:${person?.id ?? "new"}`, initial, validate, fieldIds });
  const form = session.draft;
  const fields = useFieldValidation(form, validate, fieldIds);
  const refresh = async () => {
    const people = await apiFetch<Person[]>("/api/people");
    onRefreshed(people);
    const saved = person ? people.find((item) => item.id === person.id) : null;
    if (person && !saved) throw new Error("保存したメンバーを再取得できませんでした");
    return saved ? { name: saved.name, memo: saved.memo ?? "", sortOrder: saved.sortOrder } : form;
  };
  const save = async () => {
    fields.showAll();
    const ok = await session.save((value) => apiFetch(person ? `/api/people/${person.id}` : "/api/people", {
      method: person ? "PUT" : "POST", body: JSON.stringify({ ...value, name: value.name.trim(), memo: value.memo.trim() || null }),
    }), refresh);
    if (ok) { toast({ title: `${form.name} を${person ? "更新" : "追加"}しました` }); onSaved(); }
  };
  const changes: EditChange[] = [];
  if (session.snapshot.name !== form.name) changes.push({ label: "名前", before: session.snapshot.name || "未入力", after: form.name || "未入力" });
  if (session.snapshot.memo !== form.memo) changes.push({ label: "メモ", before: session.snapshot.memo || "未入力", after: form.memo || "未入力" });
  if (session.snapshot.sortOrder !== form.sortOrder) changes.push({ label: "表示順", before: String(session.snapshot.sortOrder), after: String(form.sortOrder) });
  return <EditModal open subjectType="割り勘のメンバー" subjectName={person?.name ?? "メンバー"} mode={person ? "edit" : "create"}
    status={session.status} error={session.error} changes={changes} saveLabel={person ? "変更を保存" : "メンバーを追加"}
    impact="割り勘で選べるメンバーの基本情報を更新します。既存の持分額は変更しません。"
    onRequestClose={() => session.requestClose(onCancel)} onSave={() => void save()}
    onRetryRefresh={() => void session.retryRefresh().then((ok) => { if (ok) onSaved(); })}>
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <FormField label="名前" htmlFor={nameId} required error={fields.visibleErrors.name}>
        <Input id={nameId} value={form.name} onBlur={() => fields.touch("name")} onChange={(event) => session.setDraft({ ...form, name: event.target.value })} />
      </FormField>
      <FormField label="メモ" htmlFor={memoId}><Input id={memoId} value={form.memo} onChange={(event) => session.setDraft({ ...form, memo: event.target.value })} /></FormField>
      <FormField label="表示順" htmlFor={sortOrderId} error={fields.visibleErrors.sortOrder}>
        <Input id={sortOrderId} type="number" inputMode="numeric" value={form.sortOrder} onBlur={() => fields.touch("sortOrder")}
          onChange={(event) => session.setDraft({ ...form, sortOrder: Number(event.target.value) })} />
      </FormField>
      <button type="submit" className="sr-only" aria-hidden="true" tabIndex={-1}>保存</button>
    </form>
  </EditModal>;
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
