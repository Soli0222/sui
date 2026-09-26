import { ArchivedSection } from "../components/ArchivedSection";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type {
  Account,
  CreditCard,
  SpendingResponse,
  SpendingRequest,
  SpendingSettings,
  SpendingImport,
  SpendingReview,
} from "@sui/shared";
import { getDaysInYearMonth, isSupportedCurrencyCode, resolveBillingAmount } from "@sui/shared";
import { ApiError, apiFetch } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { FormField } from "../components/ui/form-field";
import { useEditSession } from "../hooks/use-edit-session";
import { useEditingNavigation } from "../components/editing/editing-navigation";
import { EditModal } from "../components/editing/edit-surface";
import { normalizeCurrencyInputValue, formatCurrency } from "../lib/format";
import { Select } from "../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import { Card } from "../components/ui/card";
import { ResponsiveTable } from "../components/ui/responsive-table";
const labels: Record<string, string> = {
  draft: "下書き",
  reviewing: "審査中",
  conditional: "条件付き",
  held: "保留",
  denied: "否認",
  approved: "承認済み",
  purchased: "購入記録を確認",
  completed: "完了",
  cancelled: "取消",
  expired: "期限切れ",
  scheduled: "振替待ち",
  used: "振替確定・利用済み",
  attention: "要確認",
  approvable: "承認可",
};
const rawSignature = (raw: Record<string, string> | undefined) =>
  JSON.stringify(
    Object.fromEntries(
      Object.keys(raw ?? {})
        .sort()
        .map((k) => [k, raw![k]]),
    ),
  );
const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(
    new Date(),
  );
const isRealDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const isRealMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const yen = (n: number | null) =>
  n === null ? "未設定" : `${n.toLocaleString()}円`;
function Field({ label, children, htmlFor, error }: { label: string; children: ReactNode; htmlFor?: string; error?: string }) {
  const id = useId();
  return (
    <FormField label={label} htmlFor={htmlFor ?? id} error={error}>
      {children}
    </FormField>
  );
}
function Text({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  step,
  list,
  currencyInput = false,
  error,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  step?: string;
  list?: string;
  currencyInput?: boolean;
  error?: string;
}) {
  const id = useId();
  return (
    <FormField label={label} htmlFor={id} required={required} error={error}>
      <Input
        id={id}
        aria-label={label}
        type={currencyInput ? "text" : type}
        inputMode={currencyInput ? "numeric" : undefined}
        {...(currencyInput ? { "data-1p-ignore": "true" } : {})}
        step={step}
        list={list}
        value={value}
        required={required}
        onChange={(e) => {
          if (!currencyInput) {
            onChange(e.target.value);
            return;
          }
          const normalized = normalizeCurrencyInputValue(e.target.value, "JPY");
          if (normalized.valid) onChange(normalized.value);
        }}
      />
    </FormField>
  );
}
function Choice({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <FormField label={label} htmlFor={id}>
      <Select
        id={id}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </Select>
    </FormField>
  );
}
function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </Card>
  );
}
function Modal({
  title,
  close,
  children,
  busy = false,
}: {
  title: ReactNode;
  close: () => void;
  children: ReactNode;
  busy?: boolean;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent>
        <div className="mb-4 flex items-center justify-between gap-3">
          <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
          <Button variant="ghost" onClick={close}>
            閉じる
          </Button>
        </div>
        <DialogDescription className="sr-only">{title}</DialogDescription>
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          {children}
        </fieldset>
        {busy && <p role="status">処理中…</p>}
      </DialogContent>
    </Dialog>
  );
}
function SecondaryPanel({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setShown(true)}>
        {title}
      </Button>
      {shown && (
        <Modal title={title} close={() => setShown(false)}>
          {children}
        </Modal>
      )}
    </>
  );
}
type Command = (command: Record<string, unknown>, expectedVersion?: number) => Promise<boolean>;
export function SpendingPage() {
  const [search, setSearch] = useSearchParams();
  const [state, setState] = useState<SpendingResponse | null>(null),
    [accounts, setAccounts] = useState<Account[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [refreshFailure, setRefreshFailure] = useState("");
  const runningRef = useRef(false);
  const refreshBlockedRef = useRef(false);
  const commandInFlightRef = useRef(false);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const tab = search.get("tab") ?? "requests";
  const setTab = (value: string) => setSearch((previous) => {
    const next = new URLSearchParams(previous);
    if (value === "requests") next.delete("tab"); else next.set("tab", value);
    return next;
  });
  const navigate = useNavigate();
  const load = async () => {
    const [s, a, cs] = await Promise.all([
      apiFetch<SpendingResponse>("/api/spending"),
      apiFetch<Account[]>("/api/accounts"),
      apiFetch<CreditCard[]>("/api/credit-cards"),
    ]);
    setState(s);
    setAccounts(a);
    setCards(cs);
  };
  useEffect(() => {
    let active = true;
    Promise.all([
      apiFetch<SpendingResponse>("/api/spending"),
      apiFetch<Account[]>("/api/accounts"),
      apiFetch<CreditCard[]>("/api/credit-cards"),
    ])
      .then(([s, a, cs]) => {
        if (active) {
          setState(s);
          setAccounts(a);
          setCards(cs);
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, []);
  const run = async (fn: () => Promise<unknown>, onSuccess?: () => void) => {
    if (runningRef.current || refreshBlockedRef.current) return false;
    runningRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409
        ? "更新が競合しました。入力は残っています。最新状態を確認して再編集してください。"
        : e instanceof Error ? e.message : String(e));
      setBusy(false);
      runningRef.current = false;
      return false;
    }
    onSuccess?.();
    try {
      await load();
      setRefreshFailure("");
    } catch (e) {
      refreshBlockedRef.current = true;
      setRefreshFailure(e instanceof Error ? e.message : String(e));
      setNotice("保存済みです。表示の再取得に失敗しました。操作を再送せず、表示を再取得してください。");
    }
    setBusy(false);
    runningRef.current = false;
    return true;
  };
  const command: Command = async (command, expectedVersion) => {
    if (!state) return false;
    if (commandInFlightRef.current || refreshBlockedRef.current) throw new Error("表示を再取得してから操作してください。");
    commandInFlightRef.current = true;
    try {
      const response = await apiFetch<SpendingResponse>("/api/spending/commands", {
        method: "POST", body: JSON.stringify({ version: expectedVersion ?? state.version, command }),
      });
      setState(response);
      return true;
    } finally {
      commandInFlightRef.current = false;
    }
  };
  const selected = state?.ledger.requests.find(
    (r) => r.id === search.get("request") && !r.deletedAt,
  );
  const selectedId = selected?.id;
  useEffect(() => {
    if (!selectedId) return;
    const card = document.getElementById(`spending-${selectedId}`);
    const archive = card?.closest("details");
    if (archive) archive.open = true;
    card?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);
  const renderRequest = (r: SpendingRequest) => {
    if (!state) return null;
    return (
      <RequestDetail
        key={r.id}
        request={r}
        state={state}
        close={() => setSearch((previous) => { const next = new URLSearchParams(previous); next.delete("request"); return next; })}
        busy={busy}
        error={error}
        edit={() => {
          navigate(`/spending/requests/${r.id}/edit?${search.toString()}`);
        }}
        command={async (c, expectedVersion) => {
          return run(
            () => command(c, expectedVersion),
            () => {
              if (c.action === "cancel") setNotice("申請を取り消しました");
            },
          );
        }}
        answer={async (reviewId, answer, expectedVersion) => {
          let saved = false;
          const completed = await run(async () => {
            const next = await apiFetch<SpendingResponse>(
              "/api/spending/commands",
              {
                method: "POST",
                body: JSON.stringify({
                  version: expectedVersion,
                  command: { action: "answer", id: r.id, reviewId, answer },
                }),
              },
            );
            saved = true;
            setState(next);
            setNotice(
              "回答を保存しました。再審査に失敗した場合もAI審査から再試行できます。",
            );
            await apiFetch(`/api/spending/${r.id}/review`, {
              method: "POST",
              body: JSON.stringify({ version: next.version }),
            });
          });
          return saved || completed;
        }}
        review={(reason, expectedVersion) =>
          run(async () => {
            await apiFetch(
              `/api/spending/${r.id}/${reason ? "override" : "review"}`,
              {
                method: "POST",
                body: JSON.stringify({
                  version: expectedVersion ?? state.version,
                  ...(reason ? { reason } : {}),
                }),
              },
            );
          })
        }
      />
    );
  };
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">支出決裁</h1>
          <p className="mt-2 text-sm text-ink-2">
            MFの予算を参考に、買い物を審査します。
          </p>
        </div>
        <Button
          onClick={() => {
            navigate(`/spending/requests/new?${search.toString()}`);
          }}
        >
          新規申請
        </Button>
      </header>
      {error && (
        <p
          role="alert"
          className="rounded border border-critical p-3 text-critical"
        >
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {refreshFailure && <div className="rounded border border-critical p-3 text-sm"><p role="alert">保存後の表示更新に失敗しました: {refreshFailure}</p>
        <Button variant="secondary" onClick={() => { void load().then(() => { refreshBlockedRef.current = false; setRefreshFailure(""); }).catch((reason) => setRefreshFailure(reason instanceof Error ? reason.message : String(reason))); }}>表示を再取得</Button></div>}
      {!state ? (
        <p>読み込み中…</p>
      ) : (
        <>
          <datalist id="spending-categories">
            {[
              ...new Set([
                ...state.ledger.details.map(
                  (d) => d.raw["大項目"] || d.categorySource.split("/")[0],
                ),
                ...(state.ledger.budgetProposals ?? []).flatMap((p) =>
                  p.categories.map((c) => c.category),
                ),
              ]),
            ].map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <datalist id="spending-payments">
            {[
              ...new Set([
                ...accounts.map((a) => a.name),
                ...cards.map((c) => c.name),
                ...state.ledger.details.map((d) => d.paymentSource),
              ]),
            ].map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <nav className="flex flex-wrap gap-2" aria-label="支出決裁メニュー">
            {[
              ["requests", "申請"],
              ["budgets", "通常予算"],
              ["imports", "MF取込・明細"],
              ["funding", "補正予算"],
              ["settings", "決裁設定"],
            ].map(([key, name]) => (
              <Button
                key={key}
                variant={tab === key ? "primary" : "secondary"}
                onClick={() => setTab(key)}
              >
                {name}
              </Button>
            ))}
          </nav>
          {tab !== "settings" &&
            Object.entries(state.ledger.settings).some(
              ([k, v]) =>
                k !== "ai" &&
                v === null &&
                (k !== "fundingDays" || state.funding.length > 0),
            ) && (
              <p className="rounded border border-line p-4">
                未設定の決裁ルール：
                {state.ledger.settings.threshold === null && "決裁対象金額。"}
                {state.ledger.settings.approvalDays === null && "承認期限。"}
                {state.ledger.settings.freshnessDays === null &&
                  "MF更新目安（通常予算の審査に必要。補正予算では参考情報）。"}
                {state.ledger.settings.fundingDays === null &&
                  state.funding.length > 0 &&
                  "補正予算の資金確認期間。"}
                <button
                  className="ml-2 underline"
                  onClick={() => setTab("settings")}
                >
                  決裁設定を開く
                </button>
              </p>
            )}
          <fieldset disabled={busy || Boolean(refreshFailure)} className="min-w-0 space-y-5">
            {tab === "settings" && (
              <SettingsForm
                state={state}
                onState={setState}
                settings={state.ledger.settings}
              />
            )}
            {tab === "funding" && (
              <Box title="補正予算の口座別余力">
                <p className="text-sm text-ink-2">
                  保護額は口座のオフセットを使用します。未確定入金は余力に加えません。
                  <Link className="underline" to="/accounts">
                    口座の利用可否を編集
                  </Link>
                </p>
                {state.funding.length === 0 && (
                  <p>利用可能な口座が未設定です。</p>
                )}
                {state.funding.map((f) => (
                  <div key={f.accountId} className="border-t border-line pt-3">
                    <h3>{accounts.find((a) => a.id === f.accountId)?.name}</h3>
                    <p className="text-2xl font-semibold">
                      {state.ledger.settings.fundingDays === null
                        ? "確認期間が未設定"
                        : f.available.toLocaleString()}{" "}
                      {accounts.find((a) => a.id === f.accountId)?.currencyCode}
                    </p>
                    <p className="text-sm text-ink-2">
                      現在残高 {f.balance.toLocaleString()} ／ 残す金額{" "}
                      {f.balanceOffset.toLocaleString()}
                    </p>
                    {f.issues.map((i) => (
                      <p key={i} className="text-critical">
                        {i}
                      </p>
                    ))}
                    <SecondaryPanel title={<>計算の詳細</>}>
                      <p className="my-2 text-sm">
                        {f.through}までの支払予定と、承認済みの振替予定{" "}
                        {f.held.toLocaleString()}{" "}
                        {
                          accounts.find((a) => a.id === f.accountId)
                            ?.currencyCode
                        }
                        を差し引いています。
                      </p>
                      {f.events.map((e) => (
                        <p key={e.id}>
                          {e.date} {e.amount.toLocaleString()}{" "}
                          <Link to="/recurring" className="underline">
                            予定収支
                          </Link>
                        </p>
                      ))}
                    </SecondaryPanel>
                  </div>
                ))}
              </Box>
            )}
            {tab === "budgets" && (
              <BudgetForm
                state={state}
                onState={setState}
              />
            )}
            {tab === "imports" && (
              <ImportPanel
                state={state}
                run={run}
                onState={setState}
                accounts={accounts}
                cards={cards}
              />
            )}
            {tab === "requests" && (
              <>
                <div className="space-y-4">
                  {state.ledger.requests
                    .filter(
                      (r) =>
                        !r.deletedAt &&
                        r.status !== "cancelled" &&
                        state.requestStates[r.id].status !== "completed",
                    )
                    .slice()
                    .reverse()
                    .map(renderRequest)}
                  <ArchivedSection
                    title="購入完了"
                    count={
                      state.ledger.requests.filter(
                        (r) =>
                          !r.deletedAt &&
                          r.status !== "cancelled" &&
                          state.requestStates[r.id].status === "completed",
                      ).length
                    }
                  >
                    <div className="space-y-4">
                      {state.ledger.requests
                        .filter(
                          (r) =>
                            !r.deletedAt &&
                            r.status !== "cancelled" &&
                            state.requestStates[r.id].status === "completed",
                        )
                        .slice()
                        .reverse()
                        .map(renderRequest)}
                    </div>
                  </ArchivedSection>
                  <ArchivedSection
                    title="取消済み"
                    count={
                      state.ledger.requests.filter(
                        (r) => !r.deletedAt && r.status === "cancelled",
                      ).length
                    }
                  >
                    <div className="space-y-4">
                      {state.ledger.requests
                        .filter((r) => !r.deletedAt && r.status === "cancelled")
                        .slice()
                        .reverse()
                        .map(renderRequest)}
                    </div>
                  </ArchivedSection>
                  {!state.ledger.requests.some((r) => !r.deletedAt) && (
                    <p className="p-5 text-ink-2">
                      申請はまだありません。金額にかかわらず任意申請できます。
                    </p>
                  )}
                </div>
              </>
            )}
          </fieldset>
          {busy && <p role="status">処理中… 審査は最大45秒ほどかかります。</p>}
        </>
      )}
    </div>
  );
}
function SettingsForm({
  settings,
  onState,
  state,
}: {
  settings: SpendingSettings;
  onState: (state: SpendingResponse) => void;
  state: SpendingResponse;
}) {
  const [epoch, setEpoch] = useState(0);
  const [conflict, setConflict] = useState(false);
  const [latestError, setLatestError] = useState("");
  const versionAtOpen = useRef(state.version);
  const edit = useEditSession({ identity: `spending-settings:${epoch}`, initial: settings,
    validate: (draft) => {
      const errors: Record<string, string> = {};
      if (draft.threshold !== null && (!Number.isInteger(draft.threshold) || draft.threshold < 0 || draft.threshold > 2147483647)) errors.threshold = "0円以上の整数で入力してください。";
      for (const [key, maximum] of [["approvalDays", 366], ["freshnessDays", 366], ["fundingDays", 3660]] as const) {
        const value = draft[key];
        if (value !== null && (!Number.isInteger(value) || value < (key === "freshnessDays" ? 0 : 1) || value > maximum)) errors[key] = `日数は${maximum}日以内で入力してください。`;
      }
      if ((draft.supplementalLimits ?? []).some((rule) => !Number.isInteger(rule.amount) || rule.amount < 0 || rule.amount > 2147483647 || !rule.category?.trim() && rule.category !== null)) errors.supplementalLimits = "利用枠のカテゴリと金額を確認してください。";
      return errors;
    } });
  const s = edit.draft;
  const set = edit.setDraft;
  const save = async () => {
    await edit.save(async (draft) => {
      try {
        const response = await apiFetch<SpendingResponse>("/api/spending/commands", {
          method: "POST", body: JSON.stringify({ version: versionAtOpen.current, command: { action: "settings", settings: draft } }),
        });
        versionAtOpen.current = response.version;
        onState(response);
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          setConflict(true);
          throw new Error("更新が競合しました。入力内容を残しています。最新状態を確認して再編集してください。", { cause: error });
        }
        throw error;
      }
    }, async () => {
      const response = await apiFetch<SpendingResponse>("/api/spending");
      versionAtOpen.current = response.version;
      onState(response);
      return response.ledger.settings;
    });
  };
  const reopenLatest = () => edit.requestClose(() => {
    setLatestError("");
    void apiFetch<SpendingResponse>("/api/spending").then((response) => {
      versionAtOpen.current = response.version;
      onState(response);
      setEpoch((value) => value + 1);
      setConflict(false);
    }).catch((error) => setLatestError(error instanceof Error ? error.message : String(error)));
  });
  return (
    <div className="space-y-5">
      <Box title="決裁のルール">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Text
              label="決裁が必要な金額（この額以上・円）"
              type="number"
              currencyInput
              error={edit.errors.threshold}
              value={s.threshold ?? ""}
              onChange={(v) =>
                set({ ...s, threshold: v === "" ? null : Number(v) })
              }
            />
            <Text
              label="承認有効期間（日）"
              type="number"
              error={edit.errors.approvalDays}
              value={s.approvalDays ?? ""}
              onChange={(v) =>
                set({ ...s, approvalDays: v === "" ? null : Number(v) })
              }
            />
          </div>
          <p className="text-sm text-ink-2">
            承認した買い物を、何日以内に購入するかを設定します。
          </p>
          <SecondaryPanel title={<>データ更新と補正予算の詳細設定</>}>
            <div className="mt-4 grid gap-5 md:grid-cols-2">
              <div className="space-y-2">
                <Text
                  label="当月のMFデータを更新する目安（日）"
                  type="number"
                  error={edit.errors.freshnessDays}
                  value={s.freshnessDays ?? ""}
                  onChange={(v) =>
                    set({ ...s, freshnessDays: v === "" ? null : Number(v) })
                  }
                />
                <p className="text-sm text-ink-2">
                  この日数より古いデータでは審査を保留し、CSVの更新を案内します。過去の参考期間は直近3か月です。
                </p>
              </div>
              <div className="space-y-2">
                <Text
                  label="補正予算で考慮する支払予定の期間（日）"
                  type="number"
                  error={edit.errors.fundingDays}
                  value={s.fundingDays ?? ""}
                  onChange={(v) =>
                    set({ ...s, fundingDays: v === "" ? null : Number(v) })
                  }
                />
                <p className="text-sm text-ink-2">
                  何日先の支払いまで差し引いて、口座から使える金額を計算するかを設定します。申請の振替日がさらに先なら、その日まで確認します。
                </p>
              </div>
            </div>
          </SecondaryPanel>
          <section
            className="space-y-4 border-t border-line pt-4"
            aria-label="補正予算の利用枠"
          >
            <h3 className="font-semibold">補正予算の利用枠</h3>
            <p className="text-sm text-ink-2">
              承認した補正申請をJPYで集計します。MF実績とは合算しません。未使用の取消・期限切れは解放し、購入・振替済みは取消や返却だけでは戻しません。未確定の承認は期間外でも含みます。
            </p>
            {!s.supplementalLimits?.length && (
              <p>利用枠は未設定です。支出集中のAI審査は常に行います。</p>
            )}
            {(s.supplementalLimits ?? []).map((rule, index) => {
              const update = (patch: Partial<typeof rule>) =>
                set({
                  ...s,
                  supplementalLimits: s.supplementalLimits!.map((r) =>
                    r.id === rule.id ? { ...r, ...patch } : r,
                  ),
                });
              return (
                <fieldset
                  key={rule.id}
                  className="space-y-3 rounded-lg border border-line p-4"
                >
                  <legend className="px-1">利用枠 {index + 1}</legend>
                  <Choice
                    label={`利用枠${index + 1}の対象`}
                    value={rule.category === null ? "all" : "category"}
                    onChange={(v) =>
                      update({
                        category: v === "all" ? null : "特別な支出",
                        subcategory: null,
                      })
                    }
                  >
                    <option value="all">補正予算全体</option>
                    <option value="category">MFカテゴリを指定</option>
                  </Choice>
                  {rule.category !== null && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Text
                        label={`利用枠${index + 1}の大項目`}
                        value={rule.category}
                        list="spending-categories"
                        required
                        onChange={(category) =>
                          update({ category, subcategory: null })
                        }
                      />
                      <Text
                        label={`利用枠${index + 1}の中項目（空欄ならすべて）`}
                        value={rule.subcategory ?? ""}
                        list={`limit-subcategories-${rule.id}`}
                        onChange={(v) => update({ subcategory: v || null })}
                      />
                      <datalist id={`limit-subcategories-${rule.id}`}>
                        {[
                          ...new Set(
                            state.ledger.details
                              .filter(
                                (d) =>
                                  !d.deletedAt &&
                                  d.raw["大項目"] === rule.category,
                              )
                              .map((d) => d.raw["中項目"])
                              .filter(Boolean),
                          ),
                        ].map((v) => (
                          <option key={v} value={v} />
                        ))}
                      </datalist>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Choice
                      label={`利用枠${index + 1}の期間`}
                      value={String(rule.months)}
                      onChange={(v) => update({ months: Number(v) as 3 | 12 })}
                    >
                      <option value="3">直近3か月</option>
                      <option value="12">直近12か月</option>
                    </Choice>
                    <Text
                      label={`利用枠${index + 1}の金額（円）`}
                      value={rule.amount}
                      currencyInput
                      required
                      onChange={(v) => update({ amount: Number(v) })}
                    />
                  </div>
                  <Choice
                    label={`利用枠${index + 1}の超過時`}
                    value={rule.action}
                    onChange={(v) =>
                      update({ action: v as "explain" | "block" })
                    }
                  >
                    <option value="explain">追加説明とAI再審査を求める</option>
                    <option value="block">
                      承認を止める（例外承認も不可）
                    </option>
                  </Choice>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      set({
                        ...s,
                        supplementalLimits: s.supplementalLimits!.filter(
                          (r) => r.id !== rule.id,
                        ),
                      })
                    }
                  >
                    利用枠 {index + 1} を削除
                  </Button>
                </fieldset>
              );
            })}
            <Button
              type="button"
              variant="secondary"
              disabled={(s.supplementalLimits?.length ?? 0) >= 30}
              onClick={() =>
                set({
                  ...s,
                  supplementalLimits: [
                    ...(s.supplementalLimits ?? []),
                    {
                      id: crypto.randomUUID(),
                      category: null,
                      subcategory: null,
                      months: 3,
                      amount: 0,
                      action: "explain",
                    },
                  ],
                })
              }
            >
              利用枠を追加
            </Button>
            <p className="text-sm text-ink-2">
              金額0円はすべての申請で超過します。希望する金額を設定して保存してください。複数の枠に該当する場合はすべて適用します。
            </p>
          </section>
          {edit.error && <p role="alert" className="text-critical">{edit.error}</p>}
          {edit.errors.supplementalLimits && <p role="alert" className="text-critical">{edit.errors.supplementalLimits}</p>}
          {conflict && <Button type="button" variant="secondary" onClick={reopenLatest}>最新状態を確認して再編集</Button>}
          {latestError && <p role="alert" className="text-critical">{latestError}</p>}
          {edit.status === "refresh-error" && <Button type="button" variant="secondary" onClick={() => { void edit.retryRefresh(); }}>表示を再取得</Button>}
          {edit.dirty && <div className="rounded border border-line p-3 text-xs text-ink-2"><p className="font-medium">今回の変更</p>
            {(["threshold", "approvalDays", "freshnessDays", "fundingDays", "supplementalLimits"] as const)
              .filter((key) => JSON.stringify(edit.snapshot[key]) !== JSON.stringify(s[key]))
              .map((key) => <p key={key}>{({ threshold: "決裁対象金額", approvalDays: "承認有効期間", freshnessDays: "MF更新目安", fundingDays: "資金確認期間", supplementalLimits: "補正予算の利用枠" })[key]}：
                {key === "supplementalLimits" ? "利用枠を変更" : `${String(edit.snapshot[key] ?? "未設定")} → ${String(s[key] ?? "未設定")}`}</p>)}</div>}
          <p role="status" className="text-xs text-ink-2">{edit.dirty ? "未保存の変更" : edit.status === "saved" ? "保存済み" : "変更なし"}</p>
          <Button type="submit" disabled={edit.status === "saving" || edit.status === "refreshing" || edit.status === "refresh-error"}>設定を保存</Button>
        </form>
      </Box>
      <AiSettings initial={settings.ai} version={state.version} onState={onState} />
    </div>
  );
}
function AiSettings({
  initial,
  version,
  onState,
}: {
  initial: SpendingSettings["ai"];
  version: number;
  onState: (state: SpendingResponse) => void;
}) {
  const presets = {
    openai: {
      endpoint: "https://api.openai.com/v1/chat/completions",
      protocol: "chat-completions" as const,
    },
    anthropic: {
      endpoint: "https://api.anthropic.com/v1/messages",
      protocol: "anthropic" as const,
    },
  };
  const fallbackAi: NonNullable<SpendingSettings["ai"]> = {
      ...presets.openai,
      provider: "openai",
      credentialMode: "stored",
      credentialEnv: "SUI_SPENDING_AI_KEY",
      model: "",
    };
  const [epoch, setEpoch] = useState(0);
  const [deleteEpoch, setDeleteEpoch] = useState(0);
  const [conflict, setConflict] = useState(false);
  const [refreshFailure, setRefreshFailure] = useState("");
  const versionAtOpen = useRef(version);
  const edit = useEditSession({ identity: `spending-ai-settings:${epoch}`, initial: { ai: initial ?? fallbackAi, apiKey: "" },
    validate: (draft) => {
      const errors: Record<string, string> = {};
      if (!draft.ai.model.trim()) errors.model = "モデルを入力してください。";
      if (!/^https?:\/\//.test(draft.ai.endpoint)) errors.endpoint = "接続先URLを確認してください。";
      return errors;
    } });
  const deleteEdit = useEditSession({ identity: `spending-ai-delete:${epoch}:${deleteEpoch}`, initial: { requested: true } });
  const { ai, apiKey: key } = edit.draft;
  const setAi = (value: NonNullable<SpendingSettings["ai"]>) => edit.setDraft((draft) => ({ ...draft, ai: value }));
  const setKey = (value: string) => edit.setDraft((draft) => ({ ...draft, apiKey: value }));
  const [models, setModels] = useState<{ id: string; name: string }[]>([]),
    [message, setMessage] = useState(""),
    [working, setWorking] = useState(false),
    [status, setStatus] = useState<{
      configured: boolean;
      storageReady: boolean;
    } | null>(null);
  useEffect(() => {
    let active = true;
    apiFetch<{ configured: boolean; storageReady: boolean }>(
      "/api/spending/ai/status",
    )
      .then((s) => {
        if (active) setStatus(s);
      })
      .catch(() => {
        if (active) setStatus(null);
      });
    return () => {
      active = false;
    };
  }, []);
  const provider = ai.provider ?? "custom";
  const body = () => ({
    ai: { ...ai, model: ai.model || "model-list" },
    ...(key ? { apiKey: key } : {}),
  });
  const inspect = async (test: boolean) => {
    setWorking(true);
    setMessage("");
    try {
      const result = await apiFetch<{
        models?: { id: string; name: string }[];
        ok?: boolean;
      }>(`/api/spending/ai/${test ? "test" : "models"}`, {
        method: "POST",
        body: JSON.stringify(body()),
      });
      if (result.models) setModels(result.models);
      setMessage(
        test
          ? "接続と審査形式を確認できました"
          : `${result.models?.length ?? 0}件のモデルを取得しました`,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  };
  const saveAi = async () => {
    const success = await edit.save(async (draft) => {
      try {
        const result = await apiFetch<{ configured: boolean; storageReady: boolean }>("/api/spending/ai/config", {
          method: "POST", body: JSON.stringify({ version: versionAtOpen.current, ai: draft.ai,
            ...(draft.apiKey ? { apiKey: draft.apiKey } : {}) }),
        });
        setStatus(result);
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          setConflict(true);
          throw new Error("更新が競合しました。AI設定の入力を残しています。最新状態を確認して再編集してください。", { cause: error });
        }
        throw error;
      }
    }, async () => {
      const response = await apiFetch<SpendingResponse>("/api/spending");
      onState(response);
      versionAtOpen.current = response.version;
      return { ai: response.ledger.settings.ai ?? fallbackAi, apiKey: "" };
    });
    if (success) setRefreshFailure("");
  };
  const reopenLatest = () => edit.requestClose(() => {
    void apiFetch<SpendingResponse>("/api/spending").then((response) => {
      onState(response);
      versionAtOpen.current = response.version;
      setEpoch((value) => value + 1);
      setConflict(false);
    }).catch((error) => setRefreshFailure(error instanceof Error ? error.message : String(error)));
  });
  const deleteKey = () => edit.requestTransition(() => {
    void deleteEdit.save(async () => {
      try {
        const result = await apiFetch<{ configured: boolean; storageReady: boolean }>("/api/spending/ai/config", {
          method: "POST", body: JSON.stringify({ version: versionAtOpen.current, ai: initial, apiKey: null }),
        });
        setStatus(result);
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) setConflict(true);
        throw error;
      }
    }, async () => {
      const response = await apiFetch<SpendingResponse>("/api/spending");
      onState(response);
      versionAtOpen.current = response.version;
      return { requested: true };
    }).then((success) => { if (success) setDeleteEpoch((value) => value + 1); });
  });
  return (
    <Box title="AIサービス">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void saveAi();
        }}
      >
        <fieldset disabled={working || edit.status === "saving" || edit.status === "refreshing" || deleteEdit.status === "saving" || deleteEdit.status === "refreshing"} className="min-w-0 space-y-4">
          <Choice
            label="サービス"
            value={provider}
            onChange={(v) => {
              setAi({
                ...ai,
                provider: v as typeof provider,
                ...(v === "custom" ? {} : presets[v as keyof typeof presets]),
                model: "",
                modelsEndpoint: undefined,
                credentialMode: "stored",
              });
              setKey("");
              setModels([]);
              setMessage("");
            }}
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="custom">その他の互換サービス</option>
          </Choice>
          <Field label="APIキー" htmlFor="spending-ai-key">
            <Input
              id="spending-ai-key"
              type="password"
              autoComplete="new-password"
              allowPasswordManager
              value={key}
              placeholder={
                status?.configured
                  ? "保存済み・変更する場合だけ入力"
                  : "APIキーを入力"
              }
              onChange={(e) => setKey(e.target.value)}
            />
          </Field>
          <p className="text-sm text-ink-2">
            {status?.configured
              ? "APIキーは設定済みです。保存後のキーは表示しません。"
              : "APIキーは未設定です。"}
          </p>
          {status && !status.storageReady && (
            <p className="rounded border border-line p-3 text-sm">
              APIキーを保存するには、サーバー管理者による暗号化鍵の初期設定が必要です。設定方法は運用ドキュメントに記載しています。
            </p>
          )}
          <div className="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <Field label="モデル" htmlFor="spending-ai-model" error={edit.errors.model}>
              <Input
                id="spending-ai-model"
                aria-label="モデル"
                list="spending-ai-models"
                value={ai.model}
                onChange={(e) => setAi({ ...ai, model: e.target.value })}
                placeholder="一覧から選択、またはモデルIDを入力"
                required
              />
              <datalist id="spending-ai-models">
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </datalist>
            </Field>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void inspect(false)}
            >
              モデル一覧を取得
            </Button>
          </div>
          <SecondaryPanel title={<>接続の詳細設定</>}>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Text
                label="接続先URL"
                error={edit.errors.endpoint}
                value={ai.endpoint}
                onChange={(v) => {
                  setAi({ ...ai, provider: "custom", endpoint: v });
                  setModels([]);
                }}
              />
              <Choice
                label="通信方式"
                value={ai.protocol}
                onChange={(v) =>
                  setAi({
                    ...ai,
                    provider: "custom",
                    protocol: v as typeof ai.protocol,
                  })
                }
              >
                <option value="chat-completions">Chat Completions互換</option>
                <option value="anthropic">Anthropic Messages</option>
              </Choice>
              {provider === "custom" && (
                <Text
                  label="モデル一覧URL（任意）"
                  value={ai.modelsEndpoint ?? ""}
                  onChange={(v) =>
                    setAi({ ...ai, modelsEndpoint: v || undefined })
                  }
                />
              )}
            </div>
          </SecondaryPanel>
          {message && (
            <p role="status" className="rounded border border-line p-3 text-sm">
              {message}
            </p>
          )}
          {edit.error && <p role="alert" className="text-critical">{edit.error}</p>}
          {deleteEdit.error && <p role="alert" className="text-critical">{deleteEdit.error}</p>}
          {deleteEdit.status === "refresh-error" && <Button type="button" variant="secondary" onClick={() => { void deleteEdit.retryRefresh(); }}>削除後の表示を再取得</Button>}
          {conflict && <Button type="button" variant="secondary" onClick={reopenLatest}>最新状態を確認して再編集</Button>}
          {refreshFailure && <div className="rounded border border-critical p-3 text-sm"><p role="alert">保存済みです。表示の再取得に失敗しました: {refreshFailure}</p>
            <Button type="button" variant="secondary" onClick={() => { void apiFetch<SpendingResponse>("/api/spending").then((response) => {
              onState(response); versionAtOpen.current = response.version; setRefreshFailure("");
            }).catch((error) => setRefreshFailure(error instanceof Error ? error.message : String(error))); }}>表示を再取得</Button></div>}
          {edit.status === "refresh-error" && <Button type="button" variant="secondary" onClick={() => { void edit.retryRefresh(); }}>表示を再取得</Button>}
          <p role="status" className="text-xs text-ink-2">{edit.dirty ? "未保存の変更" : edit.status === "saved" ? "保存済み" : "変更なし"}{key ? " · APIキーを変更" : ""}</p>
          {edit.dirty && <div className="rounded border border-line p-3 text-xs text-ink-2"><p className="font-medium">今回の変更</p>
            {(["provider", "endpoint", "protocol", "model", "modelsEndpoint"] as const)
              .filter((field) => edit.snapshot.ai[field] !== ai[field])
              .map((field) => <p key={field}>{field}：{String(edit.snapshot.ai[field] ?? "未設定")} → {String(ai[field] ?? "未設定")}</p>)}
            {key && <p>APIキーを変更</p>}</div>}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={working || edit.status === "saving" || edit.status === "refresh-error" || deleteEdit.status === "refresh-error"}>AI設定を保存</Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!ai.model}
              onClick={() => void inspect(true)}
            >
              接続を確認
            </Button>
            {initial?.credentialMode === "stored" && status?.configured && (
              <Button
                type="button"
                variant="secondary"
                disabled={deleteEdit.status === "refresh-error" || edit.status === "refresh-error"}
                onClick={deleteKey}
              >
                APIキーを削除
              </Button>
            )}
          </div>
          <p className="text-xs text-ink-2">
            接続確認では架空の内容を送信します。サービス側のAPI利用料金が発生する場合があります。
          </p>
        </fieldset>
      </form>
    </Box>
  );
}
function RequestDetail({
  request: r,
  state,
  edit,
  command,
  review,
  answer,
  close,
  busy,
  error,
}: {
  request: SpendingRequest;
  state: SpendingResponse;
  edit: () => void;
  command: Command;
  review: (reason?: string, expectedVersion?: number) => Promise<boolean>;
  answer: (reviewId: string, answer: string, expectedVersion: number) => Promise<boolean>;
  close: () => void;
  busy: boolean;
  error: string;
}) {
  const [view, setView] = useState("result");
  const [panel, setPanel] = useState<
    "evidence" | "history" | "actions" | "purchase" | "answer" | "return" | null
  >(null);
  const [operationEpoch, setOperationEpoch] = useState(0);
  const versionAtOpen = useRef(state.version);
  const openPanel = (next: NonNullable<typeof panel>) => {
    versionAtOpen.current = state.version;
    setOperationEpoch((epoch) => epoch + 1);
    setPanel(next);
  };
  const [returnLinkId, setReturnLinkId] = useState("");
  const purchase =
    r.purchaseRecord ??
    (r.purchases.length
      ? {
          amount: r.purchases.reduce((n, p) => n + p.amount, 0),
          date: r.purchases.at(-1)!.date,
          reason: "旧購入記録",
        }
      : null);
  const purchaseEdit = useEditSession({
    identity: `spending-purchase:${r.id}:${operationEpoch}`,
    initial: { amount: String(purchase?.amount ?? r.input.items.reduce((n, i) => n + i.amount, 0)), date: purchase?.date ?? today(), reason: "購入を確認" },
    validate: (draft) => {
      const errors: Record<string, string> = {};
      if (!Number.isInteger(Number(draft.amount)) || Number(draft.amount) <= 0 || Number(draft.amount) > 2147483647) errors.amount = "購入実額を正の整数で入力してください。";
      if (!isRealDate(draft.date)) errors.date = "実在する購入日を入力してください。";
      if (!draft.reason.trim() || draft.reason.length > 2000) errors.reason = "メモを2000文字以内で入力してください。";
      return errors;
    },
  });
  const answerEdit = useEditSession({ identity: `spending-answer:${r.id}:${operationEpoch}`, initial: { answer: "" },
    validate: (draft): Record<string, string> => !draft.answer.trim() || draft.answer.length > 2000 ? { answer: "回答を2000文字以内で入力してください。" } : {} });
  const actionEdit = useEditSession({ identity: `spending-action:${r.id}:${operationEpoch}`, initial: { reason: "" },
    validate: (draft): Record<string, string> => !draft.reason.trim() || draft.reason.length > 2000 ? { reason: "理由を2000文字以内で入力してください。" } : {} });
  const returnLink = r.fundingLinks.find((link) => link.id === returnLinkId);
  const returnEdit = useEditSession({ identity: `spending-return:${r.id}:${returnLinkId}:${operationEpoch}`,
    initial: { amount: String(state.requestStates[r.id].funding.find((funding) => funding.id === returnLinkId)?.actual ?? returnLink?.expected.amount ?? 0),
      date: today(), reason: "" },
    validate: (draft) => {
      const errors: Record<string, string> = {};
      if (!Number.isInteger(Number(draft.amount)) || Number(draft.amount) <= 0 || Number(draft.amount) > 2147483647) errors.amount = "返却額を正の整数で入力してください。";
      if (!isRealDate(draft.date)) errors.date = "実在する返却日を入力してください。";
      if (!draft.reason.trim() || draft.reason.length > 2000) errors.reason = "返却理由を2000文字以内で入力してください。";
      return errors;
    } });
  const closePanel = (session: { requestClose: (close: () => void) => void }) => session.requestClose(() => setPanel(null));
  const savePurchase = async () => {
    const success = await purchaseEdit.save(async (draft) => {
      if (!await command({ action: "purchase", id: r.id, amount: Number(draft.amount), date: draft.date, reason: draft.reason }, versionAtOpen.current))
        throw new Error("購入記録を保存できませんでした。");
    });
    if (success) setPanel(null);
  };
  const saveAnswer = async () => {
    if (!latest) return;
    const success = await answerEdit.save(async (draft) => {
      if (!await answer(latest.id, draft.answer, versionAtOpen.current)) throw new Error("回答を保存できませんでした。");
    });
    if (success) setPanel(null);
  };
  const saveAction = async (action: "cancel" | "delete" | "override") => {
    const success = await actionEdit.save(async (draft) => {
      const saved = action === "override"
        ? await review(draft.reason, versionAtOpen.current)
        : await command({ action, id: r.id, reason: draft.reason }, versionAtOpen.current);
      if (!saved) throw new Error("操作を保存できませんでした。");
    });
    if (success) { setPanel(null); if (action === "delete") close(); }
  };
  const saveReturn = async () => {
    if (!returnLink) return;
    const success = await returnEdit.save(async (draft) => {
      if (!await command({ action: "return-funds", id: r.id, linkId: returnLink.id,
        amount: Number(draft.amount), date: draft.date, reason: draft.reason }, versionAtOpen.current))
        throw new Error("資金返却の予定を作成できませんでした。");
    });
    if (success) setPanel(null);
  };
  const cancelled = r.status === "cancelled";
  const cancellation = r.history.findLast((entry) => entry.action === "cancel");
  const st = state.requestStates[r.id];
  const reviews = state.ledger.reviews
    .filter((rv) => rv.requestId === r.id)
    .slice()
    .reverse();
  const latest = reviews[0];
  const canAnswer =
    latest?.question &&
    latest.requestVersion === r.version &&
    ["held", "conditional", "denied"].includes(r.status) &&
    !(r.answers ?? []).some((a) => a.reviewId === latest.id);
  const fundingCurrency =
    latest?.snapshot.funding?.currencyCode ??
    latest?.snapshot.input.currency ??
    "JPY";
  const fundingMoney = (value: number | undefined) =>
    value === undefined
      ? "未確認"
      : isSupportedCurrencyCode(fundingCurrency)
        ? formatCurrency(value, fundingCurrency)
        : `${value.toLocaleString()} ${fundingCurrency}（最小通貨単位）`;
  const supplemental = latest?.snapshot.input.kind === "supplemental";
  const independent =
    latest &&
    typeof latest.snapshot.context === "object" &&
    latest.snapshot.context !== null &&
    "budgetPolicy" in latest.snapshot.context;
  const total = r.input.items.reduce((n, i) => n + i.amount, 0);
  return (
    <section
      id={`spending-${r.id}`}
      aria-label={`${r.input.name}の申請`}
      className="min-w-0 space-y-3 rounded-2xl border border-line bg-surface-1 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="break-words font-semibold">{r.input.name}</h2>
          <span className="text-sm text-ink-2">
            {r.input.purchaseDate} ·{" "}
            {r.input.kind === "normal" ? "通常予算" : "補正予算"}
          </span>
        </div>
        <span className="break-words text-sm">
          <span className="font-data whitespace-nowrap">{total.toLocaleString()} {r.input.currency}</span> ·{" "}
          {cancelled ? "取消済み" : labels[st.status]}
          {st.funding.some((f) => f.state === "scheduled") ? " ／振替待ち" : ""}
          {st.issues.length ? " ／要確認" : ""}
        </span>
      </div>
      {cancelled && cancellation && (
        <p className="text-sm text-ink-2">
          取消日時：
          <time dateTime={cancellation.at}>
            {new Date(cancellation.at).toLocaleString("ja-JP", {
              timeZone: "Asia/Tokyo",
            })}
          </time>
          {" · "}取消理由：{cancellation.reason}
        </p>
      )}
      <fieldset disabled={busy} className="min-w-0 space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={st.status === "reviewing"}
            onClick={() => review()}
          >
            AI審査
          </Button>
          <Button variant="primary" onClick={() => openPanel("purchase")}>
            {purchase ? "購入記録を訂正" : "購入した"}
          </Button>
          <Button
            variant="secondary"
            disabled={r.input.items.length > 1}
            onClick={edit}
          >
            申請を変更
          </Button>

          <Button variant="ghost" onClick={() => openPanel("evidence")}>
            根拠を見る
          </Button>
          <Button variant="ghost" onClick={() => openPanel("history")}>
            履歴を見る
          </Button>
          <Button variant="ghost" onClick={() => openPanel("actions")}>
            その他の操作
          </Button>
          {st.funding.length > 0 && (
            <Button variant="ghost" onClick={() => setView("funding")}>
              振替を確認
            </Button>
          )}
        </div>
        {view !== "result" && (
          <Button variant="ghost" onClick={() => setView("result")}>
            結果に戻る
          </Button>
        )}
        {view === "result" && (
          <div className="space-y-4">
            <p>{r.input.reason}</p>
            {purchase && (
              <p>
                購入記録：{purchase.date} · {purchase.amount.toLocaleString()}{" "}
                {r.input.currency}
              </p>
            )}
            {st.issues.map((i) => (
              <p key={i} className="text-critical">
                {i}
              </p>
            ))}
            {latest && (
              <section
                aria-label="今回の審査結果"
                className="space-y-2 border-y border-line py-4"
              >
                <h3 className="font-semibold">
                  {cancelled ? "取消前の審査結果：" : ""}
                  {labels[latest.decision]}
                </h3>
                <p>{latest.reasons[0]?.slice(0, 160)}</p>
                {supplemental ? (
                  <p>
                    資金余力{" "}
                    <strong>
                      {fundingMoney(latest.snapshot.funding?.available)}
                    </strong>
                    {" ／ "}今回振替額{" "}
                    <strong>
                      {fundingMoney(latest.snapshot.input.funding?.amount)}
                    </strong>
                  </p>
                ) : independent ? (
                  latest.snapshot.calculations.map((c) => (
                    <p key={c.month + c.category}>
                      {c.month} {c.category}：
                      {c.Q > 0 ? "購入した場合の残額（試算）" : "MF予算残額"}{" "}
                      <strong>{yen(c.remaining)}</strong>
                    </p>
                  ))
                ) : (
                  <p className="text-sm text-ink-2">
                    旧計算方式の審査履歴です。再審査で更新できます。
                  </p>
                )}
                {independent &&
                  (latest.snapshot.context as { purchase?: unknown })
                    .purchase != null && (
                    <p className="text-sm text-ink-2">
                      購入記録後の参考審査です。MFへの反映有無は照合していません。
                    </p>
                  )}
                {(latest.missing[0] || latest.options[0]) && (
                  <p>
                    次の確認：
                    {(latest.missing[0] || latest.options[0]).slice(0, 120)}
                  </p>
                )}
                {canAnswer && (
                  <div className="space-y-3 border-t border-line pt-3">
                    <p className="font-semibold">確認待ち</p>
                    <p>{latest.question}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={busy}
                        onClick={() => openPanel("answer")}
                      >
                        回答する
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={edit}
                      >
                        申請を変更
                      </Button>
                    </div>
                  </div>
                )}
                {latest.requestVersion !== r.version && (
                  <p className="text-sm text-ink-2">変更前の審査結果です。</p>
                )}
              </section>
            )}
          </div>
        )}
        {panel === "answer" && canAnswer && (
          <EditModal open subjectType="支出申請" subjectName={r.input.name} title="審査の質問に回答"
            mode="record" status={answerEdit.status} error={answerEdit.error}
            saveLabel="回答を保存して再審査" onSave={() => { void saveAnswer(); }}
            onRequestClose={() => closePanel(answerEdit)}
            impact="回答を先に保存し、その後に再審査します。金額や日付は変更しません。">
            <p>{latest.question}</p>
            <form
              className="mt-4 space-y-4"
              onSubmit={(e) => { e.preventDefault(); void saveAnswer(); }}
            >
              <label className="block space-y-2">
                <span>回答</span>
                <textarea
                  autoFocus
                  aria-label="回答"
                  required
                  maxLength={2000}
                  rows={6}
                  disabled={busy}
                  className="w-full rounded-md border border-line bg-surface-1 p-3 text-base"
                  value={answerEdit.draft.answer}
                  onChange={(e) => answerEdit.setDraft({ answer: e.target.value })}
                />
              </label>
              {answerEdit.errors.answer && <p role="alert" className="text-critical">{answerEdit.errors.answer}</p>}
              <p className="text-sm text-ink-2">
                回答は履歴に保存されます。金額や日付を変える場合は申請を変更してください。
              </p>
              <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
            </form>
          </EditModal>
        )}
        {panel === "purchase" && (
          <EditModal open subjectType="支出申請" subjectName={r.input.name}
            title={purchase ? `${r.input.name}の購入記録を訂正` : `${r.input.name}の購入を記録`}
            mode={purchase ? "correct" : "record"} status={purchaseEdit.status} error={purchaseEdit.error}
            saveLabel={purchase ? "訂正を保存" : "購入を記録"} onSave={() => { void savePurchase(); }}
            onRequestClose={() => closePanel(purchaseEdit)}
            changes={purchase ? [
              { label: "購入実額", before: String(purchase.amount), after: purchaseEdit.draft.amount },
              { label: "購入日", before: purchase.date, after: purchaseEdit.draft.date },
              { label: "メモ", before: purchase.reason, after: purchaseEdit.draft.reason },
            ].filter((change) => change.before !== change.after) : []}
            impact="購入記録として保存します。MFの実績と予算残額は変更しません。">
            <p className="text-sm text-ink-2">{r.input.name}</p>
            <form
              className="mt-4 space-y-4"
              onSubmit={(e) => { e.preventDefault(); void savePurchase(); }}
            >
              <Text
                label="購入実額"
                error={purchaseEdit.errors.amount}
                type="number"
                currencyInput
                value={purchaseEdit.draft.amount}
                onChange={(amount) => purchaseEdit.setDraft((draft) => ({ ...draft, amount }))}
                required
              />
              <Text
                label="購入日"
                error={purchaseEdit.errors.date}
                type="date"
                value={purchaseEdit.draft.date}
                onChange={(date) => purchaseEdit.setDraft((draft) => ({ ...draft, date }))}
                required
              />
              <Text
                label="購入記録のメモ"
                error={purchaseEdit.errors.reason}
                value={purchaseEdit.draft.reason}
                onChange={(reason) => purchaseEdit.setDraft((draft) => ({ ...draft, reason }))}
                required
              />
              <p className="text-sm text-ink-2">
                この記録で購入が完了します。MFの実績と予算残額は変更しません。
              </p>
              <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
            </form>
          </EditModal>
        )}
        {panel === "evidence" && (
          <Modal title="審査の根拠" close={() => setPanel(null)} busy={busy}>
            <p className="text-sm text-ink-2">{r.input.name}</p>
            {error && (
              <p role="alert" className="text-critical">
                {error}
              </p>
            )}
            {!latest && <p>まだ審査していません。</p>}
            {latest && (
              <>
                <p>
                  {latest.at} · {latest.model}
                </p>
                {[...latest.reasons, ...latest.missing, ...latest.options].map(
                  (x, i) => (
                    <p key={i}>{x}</p>
                  ),
                )}
                <ReviewEvidence review={latest} />
                {supplemental && (
                  <p className="text-sm text-ink-2">
                    通常予算・MF履歴は参考情報です。未登録・データ不足だけでは補正申請を保留しません。
                  </p>
                )}
                {latest.snapshot.calculations.map((c) => (
                  <div key={c.month + c.category}>
                    <h4>
                      {c.month} {c.category}
                    </h4>
                    <p>
                      予算 {yen(c.budget)} ／ MF実績 {yen(c.A)} ／ 今回の試算額{" "}
                      {yen(c.Q)}
                    </p>
                    {c.history.map((h) => (
                      <p key={h.month}>
                        {h.month}：{yen(h.total)}{" "}
                        {h.covered ? "" : "データ不足"}
                      </p>
                    ))}
                  </div>
                ))}
                <p className="text-sm text-ink-2">
                  適用ルール：更新目安{latest.snapshot.settings.freshnessDays}
                  日、承認期限{latest.snapshot.settings.approvalDays}
                  日、資金確認
                  {latest.snapshot.settings.fundingDays}日
                </p>
              </>
            )}
          </Modal>
        )}
        {panel === "history" && (
          <Modal
            title="変更・審査履歴"
            close={() => setPanel(null)}
            busy={busy}
          >
            <p className="text-sm text-ink-2">{r.input.name}</p>
            {error && (
              <p role="alert" className="text-critical">
                {error}
              </p>
            )}
            {r.history
              .slice()
              .reverse()
              .map((h, i) => (
                <div key={i}>
                  <p>
                    {h.at} · {h.action}
                  </p>
                  <p>{h.reason}</p>
                  {h.purchaseRecord && (
                    <p>
                      訂正前：{h.purchaseRecord.date}{" "}
                      {h.purchaseRecord.amount.toLocaleString()}{" "}
                      {r.input.currency}
                    </p>
                  )}
                </div>
              ))}
            {reviews.map((rv) => (
              <div key={rv.id}>
                <p>
                  {rv.at} · {labels[rv.decision]}{" "}
                  {rv.overrideReason ? "例外承認" : ""}
                </p>
                {rv.question && <p>質問：{rv.question}</p>}
                {(r.answers ?? [])
                  .filter((a) => a.reviewId === rv.id)
                  .map((a) => (
                    <p key={a.reviewId} className="whitespace-pre-wrap">
                      回答（{a.at}）：{a.answer}
                    </p>
                  ))}
                <ReviewEvidence review={rv} />
                {[...rv.reasons, ...rv.missing, ...rv.options].map((x, i) => (
                  <p key={i}>{x}</p>
                ))}
              </div>
            ))}
          </Modal>
        )}
        {panel === "actions" && (
          <EditModal open subjectType="支出申請" subjectName={r.input.name} title={`${r.input.name}のその他の操作`}
            mode="detail" status={actionEdit.status} error={actionEdit.error}
            onRequestClose={() => closePanel(actionEdit)}>
            <p className="text-sm text-ink-2">{r.input.name}</p>
            <Text
              label="操作の理由"
              error={actionEdit.errors.reason}
              value={actionEdit.draft.reason}
              onChange={(reason) => actionEdit.setDraft({ reason })}
              required
            />
            <p role="status" className="text-xs text-ink-2">{actionEdit.dirty ? "未保存の理由" : "理由を入力してください。"}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || !actionEdit.draft.reason.trim()}
                variant="secondary"
                onClick={() => { void saveAction("override"); }}
              >
                例外承認
              </Button>
              <Button
                disabled={busy || cancelled || !actionEdit.draft.reason.trim()}
                variant="danger"
                onClick={() => { void saveAction("cancel"); }}
              >
                申請を取消
              </Button>
              {!purchase && !r.fundingLinks.length && (
                <Button
                  disabled={busy || !actionEdit.draft.reason.trim()}
                  variant="danger"
                  onClick={() => { void saveAction("delete"); }}
                >
                  申請を削除
                </Button>
              )}
            </div>
          </EditModal>
        )}
        {panel === "return" && returnLink && (
          <EditModal open subjectType="支出申請" subjectName={r.input.name} title={`${r.input.name}の資金返却`}
            mode="record" status={returnEdit.status} error={returnEdit.error} saveLabel="資金返却の振替予定を作成"
            onSave={() => { void saveReturn(); }} onRequestClose={() => closePanel(returnEdit)}
            impact="確定済み振替から資金を戻す単発振替予定を作成します。">
            <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void saveReturn(); }}>
              <Text label="返却額（最小通貨単位）" currencyInput error={returnEdit.errors.amount} value={returnEdit.draft.amount}
                onChange={(amount) => returnEdit.setDraft((draft) => ({ ...draft, amount }))} required />
              <Text label="返却日" type="date" error={returnEdit.errors.date} value={returnEdit.draft.date}
                onChange={(date) => returnEdit.setDraft((draft) => ({ ...draft, date }))} required />
              <Text label="返却理由" error={returnEdit.errors.reason} value={returnEdit.draft.reason}
                onChange={(reason) => returnEdit.setDraft((draft) => ({ ...draft, reason }))} required />
              <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
            </form>
          </EditModal>
        )}
        {view === "funding" && (
          <div className="mt-4 space-y-4">
            <h3 className="font-semibold">補正予算の振替</h3>
            {r.fundingLinks.map((link) => {
              const f = st.funding.find((s) => s.id === link.id)!;
              return (
                <div key={link.id} className="space-y-2">
                  <p>
                    {labels[f.state]} · {link.expected.date} · 予定{" "}
                    {link.expected.amount.toLocaleString()} ／ 実額{" "}
                    {f.actual?.toLocaleString() ?? "未確定"}
                  </p>
                  {f.scheduleAvailable && (
                  <Link
                    className="underline"
                    to={`/recurring?spending=${r.id}&item=${link.recurringId}`}
                  >
                    振替予定を開く
                  </Link>
                  )}
                  {f.transactionId && (
                    <Link
                      className="ml-3 underline"
                      to={`/transactions?spending=${r.id}&transaction=${f.transactionId}`}
                    >
                      確定取引を開く
                    </Link>
                  )}
                  {f.transactionId && !link.returnOf && (
                    <Button variant="secondary" onClick={() => { setReturnLinkId(link.id); openPanel("return"); }}>
                      資金返却を記録
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </fieldset>
    </section>
  );
}
function BudgetForm({
  state,
  onState,
}: {
  state: SpendingResponse;
  onState: (state: SpendingResponse) => void;
}) {
  const currentMonth = today().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [epoch, setEpoch] = useState(0);
  const [selectedProposalId, setSelectedProposalId] = useState("");
  const [conflict, setConflict] = useState(false);
  const [latestError, setLatestError] = useState("");
  const versionAtOpen = useRef(state.version);
  const active = (state.ledger.budgetProposals ?? []).filter((proposal) => !proposal.supersededAt);
  const selectedProposal = active.find((proposal) => proposal.id === selectedProposalId);
  const proposalEdit = useEditSession({
    identity: `spending-budget-proposal:${selectedProposalId}:${epoch}`,
    initial: selectedProposal
      ? { name: selectedProposal.name, from: selectedProposal.from, to: selectedProposal.to ?? "", reason: selectedProposal.reason,
        replaceId: selectedProposalId, rows: selectedProposal.categories.map((category) => ({ category: category.category, amount: String(category.amount) })) }
      : { name: "MF通常予算", from: currentMonth, to: "", reason: "", replaceId: "", rows: [{ category: "", amount: "" }] },
    validate: (draft) => {
      const errors: Record<string, string> = {};
      if (!draft.name.trim() || draft.name.length > 2000) errors.name = "予算案の名前を入力してください。";
      if (!isRealMonth(draft.from)) errors.from = "開始月を入力してください。";
      if (draft.to && (!isRealMonth(draft.to) || draft.to < draft.from)) errors.to = "終了月は開始月以降にしてください。";
      if (!draft.reason.trim() || draft.reason.length > 2000) errors.reason = "改定理由を入力してください。";
      if (!draft.rows.length || draft.rows.some((row) => !row.category.trim() || !/^\d+$/.test(row.amount) || Number(row.amount) > 2147483647)) errors.rows = "カテゴリと月額予算を確認してください。";
      return errors;
    },
  });
  const { name, from, to, reason, replaceId, rows } = proposalEdit.draft;
  const setName = (value: string) => proposalEdit.setDraft((draft) => ({ ...draft, name: value }));
  const setFrom = (value: string) => proposalEdit.setDraft((draft) => ({ ...draft, from: value }));
  const setTo = (value: string) => proposalEdit.setDraft((draft) => ({ ...draft, to: value }));
  const setReason = (value: string) => proposalEdit.setDraft((draft) => ({ ...draft, reason: value }));
  const setRows = (value: typeof rows) => proposalEdit.setDraft((draft) => ({ ...draft, rows: value }));
  const reopenLatest = () => proposalEdit.requestClose(() => {
    setLatestError("");
    void apiFetch<SpendingResponse>("/api/spending").then((response) => {
      onState(response);
      versionAtOpen.current = response.version;
      setEpoch((value) => value + 1);
      setConflict(false);
    }).catch((error) => setLatestError(error instanceof Error ? error.message : String(error)));
  });
  const [calculations, setCalculations] = useState(state.calculations);
  useEffect(() => {
    let active = true;
    apiFetch<SpendingResponse>(`/api/spending?month=${month}`)
      .then((s) => {
        if (active) setCalculations(s.calculations);
      })
      .catch(() => {
        if (active) setCalculations([]);
      });
    return () => {
      active = false;
    };
  }, [month, state.version]);
  const applicable = active.find(
    (p) => p.from <= month && (!p.to || p.to >= month),
  );
  const [cardTotal, setCardTotal] = useState<number | null>(null);
  useEffect(() => {
    apiFetch<CreditCard[]>("/api/credit-cards")
      .then((cs) =>
        setCardTotal(cs.reduce((n, c) => n + resolveBillingAmount({
          actualAmount: null,
          assumptions: c.assumptions,
          yearMonth: month,
          monthOffset: 0,
        }).appliedAssumptionAmount, 0)),
      )
      .catch(() => setCardTotal(null));
  }, [month]);
  return (
    <div className="space-y-5">
      <Box title="MFの通常予算">
        <p className="text-sm text-ink-2">
          MFに設定しているカテゴリ別の月額予算を登録します。適用期間内は、毎月同じ予算を使用します。
        </p>
        <Text
          label="表示する月"
          type="month"
          value={month}
          onChange={setMonth}
        />
        <p className="text-xl font-semibold">
          月額合計{" "}
          {yen(
            applicable
              ? applicable.categories.reduce((n, c) => n + c.amount, 0)
              : null,
          )}
        </p>
        {!applicable && <p>この月に適用する予算案がありません。</p>}
        <p className="text-sm text-ink-2">
          実績はMF明細のみ、残額は月額予算から実績を引いた額です。
        </p>
        {!state.ledger.imports.some(
          (i) =>
            i.committed &&
            !i.supersededAt &&
            i.from.slice(0, 7) <= month &&
            i.to.slice(0, 7) >= month,
        ) && <p className="text-sm text-ink-2">この月のMF明細は未取込です。</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm [&_td]:align-middle [&_th]:align-middle">
            <thead>
              <tr>
                <th className="p-2">MFカテゴリ</th>
                <th className="p-2">月額予算</th>
                <th className="p-2">実績</th>
                <th className="p-2">残額</th>
              </tr>
            </thead>
            <tbody>
              {calculations
                .filter((c) => c.month === month)
                .map((c) => (
                  <tr key={c.category} className="border-t border-line">
                    <td className="min-w-0 break-words p-2">{c.category}</td>
                    <td className="p-2 whitespace-nowrap">
                      {c.budget === null ? "未設定" : yen(c.budget)}
                    </td>
                    <td className="p-2 whitespace-nowrap">{yen(c.A)}</td>
                    <td className="p-2 whitespace-nowrap">
                      {yen(c.budget === null ? null : c.budget - c.A)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <SecondaryPanel title={<>カード仮定額との比較</>}>
          <p className="mt-2 text-sm text-ink-2">
            カード仮定額合計 {yen(cardTotal)}
            。MFの利用月とカードの引落月、投信積立・立替・現金払いなどにより差が生じます。通常予算と合算せず、仮定額も自動変更しません。
          </p>
        </SecondaryPanel>
      </Box>
      <Box title="予算案と適用期間">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void proposalEdit.save(async (draft) => {
              try {
                const response = await apiFetch<SpendingResponse>("/api/spending/commands", { method: "POST",
                  body: JSON.stringify({ version: versionAtOpen.current,
                    command: { action: "budget-proposal", ...(draft.replaceId ? { replaceId: draft.replaceId } : {}),
                      proposal: { name: draft.name, from: draft.from, to: draft.to || null,
                        categories: draft.rows.map((row) => ({ category: row.category, amount: Number(row.amount) })), reason: draft.reason } } }) });
                versionAtOpen.current = response.version;
                onState(response);
              } catch (error) {
                if (error instanceof ApiError && error.status === 409) {
                  setConflict(true);
                  throw new Error("更新が競合しました。予算案の入力を残しています。最新状態を確認して再編集してください。", { cause: error });
                }
                throw error;
              }
            }, async () => {
              const response = await apiFetch<SpendingResponse>("/api/spending");
              versionAtOpen.current = response.version;
              onState(response);
              return proposalEdit.draft;
            });
          }}
        >
          <Choice
            label="変更元の予算案"
            value={replaceId}
            onChange={(id) => proposalEdit.requestTransition(() => {
              versionAtOpen.current = state.version;
              setSelectedProposalId(id);
            })}
          >
            <option value="">新しい期間の予算案を作る</option>
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}・{p.from}〜{p.to ?? "継続"}
              </option>
            ))}
          </Choice>
          <div className="grid gap-4 md:grid-cols-3">
            <Text
              label="予算案の名前"
              error={proposalEdit.errors.name}
              value={name}
              onChange={setName}
              required
            />
            <Text
              label="適用開始月"
              error={proposalEdit.errors.from}
              type="month"
              value={from}
              onChange={setFrom}
              required
            />
            <Text
              label="適用終了月（空欄なら継続）"
              error={proposalEdit.errors.to}
              type="month"
              value={to}
              onChange={setTo}
            />
          </div>
          <p className="text-sm text-ink-2">
            途中から変更する場合は、変更元を選び、適用開始月を変更してください。それ以前の予算と改定履歴は残ります。
          </p>
          {rows.map((row, index) => (
            <div
              key={index}
              className="grid items-end gap-3 rounded border border-line p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <Text
                label={`カテゴリ${index + 1}`}
                list="spending-categories"
                value={row.category}
                required
                onChange={(v) =>
                  setRows(
                    rows.map((r, i) =>
                      i === index ? { ...r, category: v } : r,
                    ),
                  )
                }
              />
              <Text
                label={`月額予算${index + 1}（円）`}
                type="number"
                currencyInput
                value={row.amount}
                onChange={(v) =>
                  setRows(
                    rows.map((r, i) =>
                      i === index ? { ...r, amount: v } : r,
                    ),
                  )
                }
              />
              <Button
                type="button"
                variant="secondary"
                disabled={rows.length === 1}
                onClick={() => setRows(rows.filter((_, i) => i !== index))}
              >
                削除
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            onClick={() => setRows([...rows, { category: "", amount: "" }])}
          >
            カテゴリを追加
          </Button>
          <Text label="改定理由" value={reason} error={proposalEdit.errors.reason} onChange={setReason} required />
          {proposalEdit.errors.rows && <p role="alert" className="text-critical">{proposalEdit.errors.rows}</p>}
          {proposalEdit.error && <p role="alert" className="text-critical">{proposalEdit.error}</p>}
          {conflict && <Button type="button" variant="secondary" onClick={reopenLatest}>最新状態を確認して再編集</Button>}
          {latestError && <p role="alert" className="text-critical">{latestError}</p>}
          {proposalEdit.status === "refresh-error" && <Button type="button" variant="secondary" onClick={() => { void proposalEdit.retryRefresh(); }}>表示を再取得</Button>}
          <p role="status" className="text-xs text-ink-2">{proposalEdit.dirty ? "未保存の変更" : proposalEdit.status === "saved" ? "保存済み" : "変更なし"}</p>
          {proposalEdit.dirty && <div className="rounded border border-line p-3 text-xs text-ink-2"><p className="font-medium">今回の変更</p>
            <p>対象：{replaceId ? `予算案 ${name}` : "新しい期間の予算案"}</p>
            <p>期間：{proposalEdit.snapshot.from}〜{proposalEdit.snapshot.to || "継続"} → {from}〜{to || "継続"}</p>
            <p>カテゴリ別月額：{proposalEdit.snapshot.rows.map((row) => `${row.category || "未入力"} ${row.amount || "未入力"}円`).join("、")} → {rows.map((row) => `${row.category || "未入力"} ${row.amount || "未入力"}円`).join("、")}</p>
          </div>}
          <Button type="submit" disabled={proposalEdit.status === "saving" || proposalEdit.status === "refreshing" || proposalEdit.status === "refresh-error"}>予算案を保存</Button>
        </form>
        <SecondaryPanel title={<>改定履歴</>}>
          {(state.ledger.budgetProposals ?? [])
            .slice()
            .reverse()
            .map((p) => (
              <p key={p.id} className="mt-2 text-sm">
                {p.from}〜{p.to ?? "継続"} {p.name}{" "}
                {yen(p.categories.reduce((n, c) => n + c.amount, 0))} ·{" "}
                {p.reason} {p.supersededAt ? "（改定前）" : ""}
              </p>
            ))}
        </SecondaryPanel>
      </Box>
    </div>
  );
}
function ImportPanel({
  state,
  run,
  onState,
  accounts,
  cards,
}: {
  state: SpendingResponse;
  run: (f: () => Promise<unknown>) => Promise<boolean>;
  onState: (s: SpendingResponse) => void;
  accounts: Account[];
  cards: CreditCard[];
}) {
  const navigation = useEditingNavigation();
  const [epoch, setEpoch] = useState(0);
  const [conflict, setConflict] = useState(false);
  const [localError, setLocalError] = useState("");
  const versionAtOpen = useRef(state.version);
  const [file, setFile] = useState<File | null>(null),
    [batch, setBatch] = useState<SpendingImport | null>(null),
    [month, setMonth] = useState(today().slice(0, 7)),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState(""),
    [payment, setPayment] = useState("");
  const [detail, setDetail] = useState("");
  const previewEdit = useEditSession({ identity: `spending-import-preview:${epoch}`,
    initial: { filename: "", fallback: "" },
    validate: (draft) => {
      const errors: Record<string, string> = {};
      if (!draft.filename || draft.filename.length > 200) errors.filename = "200文字以内のCSVファイルを選択してください。";
      if (draft.fallback && !isRealMonth(draft.fallback)) errors.fallback = "対象月を確認してください。";
      return errors;
    } });
  const confirmEdit = useEditSession({ identity: `spending-import-confirm:${batch?.id ?? "none"}:${epoch}`,
    initial: { resolutions: {} as Record<string, string> },
    validate: (draft) => {
      const errors: Record<string, string> = {};
      if (batch?.rows.some((row) => row.candidates.length > 0 && !draft.resolutions[row.line])) errors.resolutions = "重複候補の扱いを各行で選択してください。";
      return errors;
    } });
  const fallback = previewEdit.draft.fallback;
  const resolutions = confirmEdit.draft.resolutions;
  const reopenLatest = () => navigation.request(() => {
    setLocalError("");
    void apiFetch<SpendingResponse>("/api/spending").then((response) => {
      onState(response);
      versionAtOpen.current = response.version;
      setBatch(null);
      setFile(null);
      setEpoch((value) => value + 1);
      setConflict(false);
    }).catch((error) => setLocalError(error instanceof Error ? error.message : String(error)));
  });
  const preview = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    await previewEdit.save(async (draft) => {
      if (!await run(async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      const result = await apiFetch<{
        preview: SpendingImport;
        state: SpendingResponse;
      }>("/api/spending/imports/preview", {
        method: "POST",
        body: JSON.stringify({
          version: versionAtOpen.current,
          base64: btoa(binary),
          filename: file.name,
          ...(draft.fallback ? { month: draft.fallback } : {}),
        }),
      });
      setBatch(result.preview);
      setMonth(result.preview.month ?? result.preview.from.slice(0, 7));
      versionAtOpen.current = result.state.version;
      onState(result.state);
      })) {
        setConflict(true);
        throw new Error("プレビューを作成できませんでした。入力を残しています。最新状態を確認して再実行してください。");
      }
    });
  };
  const all = state.ledger.details.filter((d) => !d.deletedAt);
  const sources = [...new Set(all.map((d) => d.paymentSource))];
  const shown = all.filter(
    (d) =>
      d.date.startsWith(month) &&
      `${d.date} ${d.description} ${d.categorySource}`.includes(query) &&
      (!category || d.categorySource.split("/")[0] === category) &&
      (!payment || d.paymentSource === payment),
  );
  const paymentLabel = (source: string) => {
    const link = state.ledger.paymentLinks?.[source];
    return link
      ? ((link.kind === "account" ? accounts : cards).find(
          (a) => a.id === link.id,
        )?.name ?? `${source}（関連する登録がありません）`)
      : source;
  };
  const renderPreviewChange = (row: SpendingImport["rows"][number]) => <div className="grid min-w-0 gap-1 break-words">
    {row.error ?? (row.existingId
      ? rawSignature(state.ledger.details.find((d) => d.id === row.existingId)?.raw) === rawSignature(row.detail?.raw)
        ? "変更なし" : "更新"
      : "追加")}
    {row.existingId && <p className="text-xs text-ink-2">前回: {yen(state.ledger.details.find((d) => d.id === row.existingId)?.amount ?? null)}</p>}
    {row.candidates.length > 0 && <Choice label={`行${row.line}の重複候補`}
      value={resolutions[row.line] ?? ""}
      onChange={(value) => confirmEdit.setDraft((draft) => ({ ...draft, resolutions: { ...draft.resolutions, [row.line]: value } }))}>
      <option value="">同じ購入か選択</option><option value="new">別の購入</option>
      {row.candidates.map((id) => <option key={id} value={id}>{state.ledger.details.find((d) => d.id === id)?.description}・既存明細を更新</option>)}
    </Choice>}
  </div>;
  return (
    <div className="space-y-5">
      <Box title="月のMFデータを更新">
        <p className="text-sm text-ink-2">
          MFから出力した月別CSVを選んでください。同じ月を再取込すると、追加・変更・削除を反映します。
        </p>
        <form className="space-y-4" onSubmit={(e) => void preview(e)}>
          <Field label="CSVファイル" htmlFor="spending-csv-file" error={previewEdit.errors.filename}>
            <input
              id="spending-csv-file"
              className="block w-full min-w-0 rounded-lg border border-line bg-surface p-3 text-sm file:mr-3 file:rounded file:border-0 file:bg-transparent file:px-2 file:py-2 file:font-medium"
              type="file"
              accept=".csv"
              required
              onChange={(e) => {
                const selected = e.target.files?.[0] ?? null;
                setFile(selected);
                previewEdit.setDraft((draft) => ({ ...draft, filename: selected?.name ?? "" }));
                setBatch(null);
                previewEdit.setDraft((draft) => ({ ...draft, fallback: "" }));
              }}
            />
          </Field>
          <SecondaryPanel title={<>対象月を判定できない空のCSVの場合</>}>
            <div className="mt-3">
              <Text
                label="空のCSVの対象月"
                error={previewEdit.errors.fallback}
                type="month"
                value={fallback}
                onChange={(value) => previewEdit.setDraft((draft) => ({ ...draft, fallback: value }))}
              />
            </div>
          </SecondaryPanel>
          {previewEdit.error && <p role="alert" className="text-critical">{previewEdit.error}</p>}
          <p role="status" className="text-xs text-ink-2">{previewEdit.dirty ? "未保存のCSV選択" : previewEdit.status === "saved" ? "プレビュー済み" : "CSVを選択してください。"}</p>
          <Button type="submit" disabled={previewEdit.status === "saving"}>取込プレビュー</Button>
        </form>
        {batch && (
          <div className="space-y-4 rounded-lg border border-line p-4">
            <h3 className="font-semibold">
              {batch.month ?? batch.from.slice(0, 7)}分を更新
            </h3>
            <p className="break-all text-sm">
              {batch.filename} · {batch.rows.length}行 · エラー{" "}
              {batch.errors.length}件 {batch.committed ? "（取込済み）" : ""}
            </p>
            <p className="text-sm text-ink-2">
              {(batch.month ?? batch.from.slice(0, 7)) === today().slice(0, 7)
                ? "月途中のデータです。後日、同じ月のCSVで更新できます。"
                : "この月のCSVを最新の実績として使用します。"}{" "}
              過去の取込・購入履歴は保持します。
            </p>
            {batch.errors.map((e, i) => (
              <p key={i} className="text-critical text-sm">
                {e}
              </p>
            ))}
            <ResponsiveTable rows={batch.rows} rowKey={(row) => String(row.line)} breakpoint={1200}
              emptyMessage="取込対象の明細はありません。"
              columns={[
                { key: "detail", header: "日付・内容", render: (row) => <span className="break-words">{row.detail?.date} {row.detail?.description}</span> },
                { key: "amount", header: "金額", mono: true, render: (row) => row.detail && yen(row.detail.amount) },
                { key: "change", header: "変更内容", render: renderPreviewChange },
              ]}
              mobileRow={(row) => <>
                <div className="break-words font-medium">{row.detail?.description ?? `行 ${row.line}`}</div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2"><span>{row.detail?.date}</span><span className="font-data whitespace-nowrap">{row.detail && yen(row.detail.amount)}</span></div>
                {renderPreviewChange(row)}
              </>} />
            {!!batch.removedIds?.length && (
              <SecondaryPanel
                title={<>前回だけにある明細 {batch.removedIds.length}件</>}
              >
                {batch.removedIds.map((id) => {
                  const d = state.ledger.details.find((d) => d.id === id);
                  return (
                    <p key={id} className="text-sm">
                      {d?.date} {d?.description} {yen(d?.amount ?? null)} ·
                      今回の月次実績から除外
                    </p>
                  );
                })}
              </SecondaryPanel>
            )}
            {confirmEdit.errors.resolutions && <p role="alert" className="text-critical">{confirmEdit.errors.resolutions}</p>}
            {confirmEdit.error && <p role="alert" className="text-critical">{confirmEdit.error}</p>}
            {conflict && <Button variant="secondary" onClick={reopenLatest}>最新状態を確認して再編集</Button>}
            {localError && <p role="alert" className="text-critical">{localError}</p>}
            <p role="status" className="text-xs text-ink-2">{confirmEdit.dirty ? "未保存の重複候補の選択" : "プレビュー内容を確認してください。"} · {batch.rows.length}行をこの月の実績として更新</p>
            <Button
              disabled={batch.committed || batch.errors.length > 0}
              onClick={() => { void confirmEdit.save(async (draft) => {
                if (!await run(async () => {
                  const response = await apiFetch<SpendingResponse>("/api/spending/commands", {
                    method: "POST", body: JSON.stringify({ version: versionAtOpen.current,
                      command: { action: "import-confirm", id: batch.id, resolutions: draft.resolutions,
                        confirmedCoverage: false, acceptErrors: false } }),
                  });
                  versionAtOpen.current = response.version;
                  onState(response);
                  setBatch(null);
                })) {
                  setConflict(true);
                  throw new Error("取込を確定できませんでした。選択内容を残しています。最新状態を確認して再編集してください。");
                }
              }); }}
            >
              確認して月のデータを更新
            </Button>
          </div>
        )}
        <SecondaryPanel title={<>取込履歴</>}>
          {state.ledger.imports
            .filter((i) => i.committed)
            .slice()
            .reverse()
            .map((i) => (
              <p key={i.id} className="mt-2 break-all text-sm">
                {i.from.slice(0, 7)}分 · {new Date(i.at).toLocaleString()} ·{" "}
                {i.rows.length}行 ·{" "}
                {i.supersededAt
                  ? "更新前"
                  : i.to.endsWith(
                        String(getDaysInYearMonth(i.from.slice(0, 7))),
                      )
                    ? "月末分"
                    : "月途中"}
              </p>
            ))}
        </SecondaryPanel>
      </Box>
      <Box title="MF明細">
        <div className="grid gap-3 md:grid-cols-2">
          <Text
            label="明細の対象月"
            type="month"
            value={month}
            onChange={setMonth}
          />
          <Text label="明細を検索" value={query} onChange={setQuery} />
          <Choice
            label="カテゴリで絞り込み"
            value={category}
            onChange={setCategory}
          >
            <option value="">すべて</option>
            {[...new Set(all.map((d) => d.categorySource.split("/")[0]))].map(
              (c) => (
                <option key={c}>{c}</option>
              ),
            )}
          </Choice>
          <Choice
            label="支払元で絞り込み"
            value={payment}
            onChange={setPayment}
          >
            <option value="">すべて</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {paymentLabel(s)}
              </option>
            ))}
          </Choice>
        </div>
        <p className="text-sm text-ink-2">
          カテゴリはMFの値を表示します。修正はMFで行い、CSVを取り込み直してください。
        </p>
        <div className="max-h-[32rem] overflow-y-auto">
          <ResponsiveTable rows={shown} rowKey={(item) => item.id} breakpoint={1200}
            emptyMessage="この条件の明細はありません。"
            columns={[
              { key: "date", header: "日付", render: (item) => item.date },
              { key: "description", header: "内容", render: (item) => <><button className="break-words text-left underline" onClick={() => setDetail(item.id)}>{item.description}</button>{(item.transfer || !item.included) && <p className="text-xs">{item.transfer ? "振替" : "集計対象外"}</p>}</> },
              { key: "amount", header: "金額", mono: true, render: (item) => yen(item.amount) },
              { key: "category", header: "MFカテゴリ", render: (item) => item.categorySource },
              { key: "payment", header: "支払元", render: (item) => paymentLabel(item.paymentSource) },
            ]}
            mobileRow={(item) => <>
              <div className="flex min-w-0 flex-wrap justify-between gap-2"><button className="break-words text-left font-medium underline" onClick={() => setDetail(item.id)}>{item.description}</button><span className="font-data whitespace-nowrap">{yen(item.amount)}</span></div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2"><span>{item.date}</span><span className="break-words">MFカテゴリ {item.categorySource}</span><span className="break-words">支払元 {paymentLabel(item.paymentSource)}</span></div>
              {(item.transfer || !item.included) && <span className="text-xs text-ink-3">{item.transfer ? "振替" : "集計対象外"}</span>}
            </>} />
        </div>
        {detail && (
          <Modal title="MF明細" close={() => setDetail("")}>
            <dl className="space-y-3">
              {Object.entries(
                state.ledger.details.find((d) => d.id === detail)?.raw ?? {},
              ).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-sm text-ink-2">{key}</dt>
                  <dd className="break-all">{String(value)}</dd>
                </div>
              ))}
            </dl>
          </Modal>
        )}
      </Box>
      <SecondaryPanel title={<>支払元とsuiのカード・口座を紐づける（任意）</>}>
        <p className="my-3 text-sm text-ink-2">
          MFの金融機関名に対応する登録済みのカード・口座を選びます。未登録の場合はMFの名前のまま使えます。
        </p>
        <div className="space-y-3">
          {sources.map((source) => (
            <PaymentLink
              key={source}
              source={source}
              initial={state.ledger.paymentLinks?.[source]}
              version={state.version}
              onState={onState}
              accounts={accounts}
              cards={cards}
            />
          ))}
        </div>
      </SecondaryPanel>
    </div>
  );
}
function PaymentLink({
  source,
  initial,
  version,
  onState,
  accounts,
  cards,
}: {
  source: string;
  initial?: { kind: "account" | "card"; id: string };
  version: number;
  onState: (state: SpendingResponse) => void;
  accounts: Account[];
  cards: CreditCard[];
}) {
  const [epoch, setEpoch] = useState(0);
  const [conflict, setConflict] = useState(false);
  const [latestError, setLatestError] = useState("");
  const versionAtOpen = useRef(version);
  const edit = useEditSession({ identity: `spending-payment-link:${source}:${epoch}`,
    initial: { value: initial ? `${initial.kind}:${initial.id}` : "" } });
  const value = edit.draft.value;
  const reopenLatest = () => edit.requestClose(() => {
    void apiFetch<SpendingResponse>("/api/spending").then((response) => {
      onState(response);
      versionAtOpen.current = response.version;
      setEpoch((next) => next + 1);
      setConflict(false);
    }).catch((error) => setLatestError(error instanceof Error ? error.message : String(error)));
  });
  return (
    <form
      className="grid items-end gap-3 rounded border border-line p-3 md:grid-cols-[minmax(0,1fr)_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        void edit.save(async (draft) => {
          const [kind, id] = draft.value.split(":");
          try {
            const response = await apiFetch<SpendingResponse>("/api/spending/commands", { method: "POST",
              body: JSON.stringify({ version: versionAtOpen.current,
                command: { action: "payment-link", source, target: draft.value ? { kind, id } : null } }) });
            versionAtOpen.current = response.version;
            onState(response);
          } catch (error) {
            if (error instanceof ApiError && error.status === 409) {
              setConflict(true);
              throw new Error("更新が競合しました。紐づけの入力を残しています。最新状態を確認して再編集してください。", { cause: error });
            }
            throw error;
          }
        }, async () => {
          const response = await apiFetch<SpendingResponse>("/api/spending");
          onState(response);
          versionAtOpen.current = response.version;
          const linked = response.ledger.paymentLinks?.[source];
          return { value: linked ? `${linked.kind}:${linked.id}` : "" };
        });
      }}
    >
      <Choice label={source} value={value} onChange={(next) => edit.setDraft({ value: next })}>
        <option value="">MFの名前で表示</option>
        <optgroup label="カード">
          {cards.map((c) => (
            <option key={c.id} value={`card:${c.id}`}>
              {c.name}
            </option>
          ))}
        </optgroup>
        <optgroup label="口座">
          {accounts.map((a) => (
            <option key={a.id} value={`account:${a.id}`}>
              {a.name}
            </option>
          ))}
        </optgroup>
      </Choice>
      {edit.error && <p role="alert" className="text-critical">{edit.error}</p>}
      {conflict && <Button type="button" variant="secondary" onClick={reopenLatest}>最新状態を確認して再編集</Button>}
      {latestError && <p role="alert" className="text-critical">{latestError}</p>}
      {edit.status === "refresh-error" && <Button type="button" variant="secondary" onClick={() => { void edit.retryRefresh(); }}>表示を再取得</Button>}
      <p role="status" className="text-xs text-ink-2">{edit.dirty ? `${edit.snapshot.value || "MFの名前"} → ${value || "MFの名前"}` : edit.status === "saved" ? "保存済み" : "変更なし"}</p>
      <Button type="submit" variant="secondary" disabled={edit.status === "saving" || edit.status === "refreshing" || edit.status === "refresh-error"}>
        紐づけを保存
      </Button>
    </form>
  );
}

function ReviewEvidence({ review }: { review: SpendingReview }) {
  const context = review.snapshot.context as {
    monthly?: {
      id: string;
      month: string;
      category: string;
      subcategory: string;
      total: number;
    }[];
    details?: {
      id: string;
      date: string;
      description: string;
      amount: number;
      category: string;
      subcategory?: string;
      memo?: string;
    }[];
    detailTruncated?: boolean;
    omittedDetails?: number;
    omittedRequests?: number;
    from?: string;
    through?: string;
  } | null;
  return (
    <div className="space-y-3">
      {review.assessment && (
        <dl className="space-y-2">
          {(
            [
              ["最近の支出", review.assessment.concentration],
              ["目的・期限", review.assessment.purpose],
              ["金額の妥当性", review.assessment.amount],
              ["AIの判断理由", review.assessment.conclusion],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="font-semibold">{label}</dt>
              <dd className="whitespace-pre-wrap">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {context?.monthly && (
        <div className="space-y-1">
          <h4 className="font-semibold">
            MFの中項目別実績（{context.from}〜{context.through}）
          </h4>
          <p className="text-sm text-ink-2">
            取り込んだ対象支出の集計です。未取込期間の支出は含みません。
          </p>
          {context.monthly
            .filter(
              (g) =>
                review.snapshot.input.items.some(
                  (i) => i.category === g.category,
                ) || review.assessment?.evidenceIds.includes(g.id),
            )
            .map((g) => (
              <p key={g.id}>
                {review.assessment?.evidenceIds.includes(g.id) ? "参照：" : ""}
                {g.month} {g.category}／{g.subcategory || "中項目なし"}：
                {yen(g.total)}
              </p>
            ))}
          {context.details
            ?.filter((d) => review.assessment?.evidenceIds.includes(d.id))
            .map((d) => (
              <p key={d.id}>
                {d.date} {d.category}／{d.subcategory} {d.description}：
                {yen(d.amount)} {d.memo}
              </p>
            ))}
          {context.detailTruncated && (
            <p className="text-sm text-ink-2">
              個別明細{context.omittedDetails ?? "一部"}
              件を省略。上の集計には含まれます。
            </p>
          )}
          {!!context.omittedRequests && (
            <p className="text-sm text-ink-2">
              関連申請{context.omittedRequests}件を省略。
            </p>
          )}
        </div>
      )}
      {(review.snapshot.limits ?? []).map((rule) => (
        <div key={rule.id} className="rounded-md border border-line p-3">
          <p className="font-semibold">
            {rule.category ?? "補正予算全体"}
            {rule.subcategory ? "／" + rule.subcategory : ""} · 直近
            {rule.months}か月
          </p>
          <p>
            {rule.from}〜{rule.through}：他の申請 {yen(rule.used)} ＋ 今回{" "}
            {yen(rule.requested)} ／ 利用枠 {yen(rule.amount)}
          </p>
          <p>
            {rule.exceeded
              ? rule.action === "block"
                ? "上限超過：承認できません"
                : review.decision === "approvable"
                  ? "目安超過：追加説明を審査済みです"
                  : "目安超過：追加説明とAI再審査が必要です"
              : "利用枠内です"}
          </p>
        </div>
      ))}
    </div>
  );
}
