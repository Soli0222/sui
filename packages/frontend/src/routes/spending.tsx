import { ArchivedSection } from "../components/ArchivedSection";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  Account,
  CreditCard,
  SpendingApplicationInput,
  SpendingResponse,
  SpendingRequest,
  SpendingSettings,
  SpendingImport,
  SpendingReview,
} from "@sui/shared";
import { getDaysInYearMonth, isSupportedCurrencyCode } from "@sui/shared";
import { apiFetch } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { normalizeCurrencyInputValue, formatCurrency } from "../lib/format";
import { Select } from "../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import { Card } from "../components/ui/card";
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
const yen = (n: number | null) =>
  n === null ? "未設定" : `${n.toLocaleString()}円`;
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid min-w-0 content-start gap-1.5 text-sm text-ink-2">
      {label}
      {children}
    </label>
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
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  step?: string;
  list?: string;
  currencyInput?: boolean;
}) {
  return (
    <Field label={label}>
      <Input
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
    </Field>
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
  return (
    <Field label={label}>
      <Select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </Select>
    </Field>
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
function newInput(): SpendingApplicationInput {
  return {
    name: "",
    amount: 0,
    category: "",
    reason: "",
    purchaseDate: today(),
    payment: "",
    kind: "normal",
    currency: "JPY",
    rateToJpy: 1,
    rateAt: today(),
    urgency: "",
    replacement: "",
    alternatives: "",
    relatedIds: [],
    funding: null,
  };
}
function applicationInput(r: SpendingRequest): SpendingApplicationInput {
  const { items, ...input } = r.input;
  return {
    ...input,
    amount: items.reduce((n, i) => n + i.amount, 0),
    category: items[0]?.category ?? "",
  };
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
type Command = (command: Record<string, unknown>) => Promise<void>;
export function SpendingPage() {
  const [state, setState] = useState<SpendingResponse | null>(null),
    [accounts, setAccounts] = useState<Account[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("requests");
  const [notice, setNotice] = useState("");
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [search, setSearch] = useSearchParams();
  const [editing, setEditing] = useState<SpendingRequest | null>(null),
    [create, setCreate] = useState(false);
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
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
      onSuccess?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const command: Command = async (command) => {
    if (!state) return;
    await apiFetch("/api/spending/commands", {
      method: "POST",
      body: JSON.stringify({ version: state.version, command }),
    });
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
        close={() => setSearch({})}
        busy={busy}
        error={error}
        edit={() => {
          setEditing(r);
          setCreate(true);
        }}
        command={async (c) => {
          await run(
            () => command(c),
            () => {
              if (c.action === "cancel") setNotice("申請を取り消しました");
            },
          );
        }}
        answer={async (reviewId, answer) => {
          let saved = false;
          await run(async () => {
            const next = await apiFetch<SpendingResponse>(
              "/api/spending/commands",
              {
                method: "POST",
                body: JSON.stringify({
                  version: state.version,
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
          return saved;
        }}
        review={(reason) =>
          run(async () => {
            await apiFetch(
              `/api/spending/${r.id}/${reason ? "override" : "review"}`,
              {
                method: "POST",
                body: JSON.stringify({
                  version: state.version,
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
            setEditing(null);
            setCreate(true);
            setTab("requests");
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
          <fieldset disabled={busy} className="min-w-0 space-y-5">
            {tab === "settings" && (
              <SettingsForm
                key={state.version}
                state={state}
                run={run}
                settings={state.ledger.settings}
                save={(s) =>
                  run(() => command({ action: "settings", settings: s }))
                }
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
                command={(c) => run(() => command(c))}
              />
            )}
            {tab === "imports" && (
              <ImportPanel
                state={state}
                run={run}
                command={command}
                onState={setState}
                accounts={accounts}
                cards={cards}
              />
            )}
            {tab === "requests" && (
              <>
                {create && (
                  <RequestForm
                    key={editing?.id ?? "new"}
                    initial={editing ? applicationInput(editing) : newInput()}
                    busy={busy}
                    error={error}
                    accounts={accounts}
                    state={state}
                    save={(input) =>
                      run(async () => {
                        await command({
                          action: "request",
                          ...(editing ? { id: editing.id } : {}),
                          input,
                        });
                        setCreate(false);
                      })
                    }
                    cancel={() => setCreate(false)}
                  />
                )}
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
  save,
  state,
  run,
}: {
  settings: SpendingSettings;
  save: (s: SpendingSettings) => void;
  state: SpendingResponse;
  run: (f: () => Promise<unknown>) => Promise<void>;
}) {
  const [s, set] = useState(settings);
  return (
    <div className="space-y-5">
      <Box title="決裁のルール">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save(s);
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Text
              label="決裁が必要な金額（この額以上・円）"
              type="number"
              currencyInput
              value={s.threshold ?? ""}
              onChange={(v) =>
                set({ ...s, threshold: v === "" ? null : Number(v) })
              }
            />
            <Text
              label="承認有効期間（日）"
              type="number"
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
          <Button type="submit">設定を保存</Button>
        </form>
      </Box>
      <AiSettings initial={settings.ai} version={state.version} run={run} />
    </div>
  );
}
function AiSettings({
  initial,
  version,
  run,
}: {
  initial: SpendingSettings["ai"];
  version: number;
  run: (f: () => Promise<unknown>) => Promise<void>;
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
  const [ai, setAi] = useState<NonNullable<SpendingSettings["ai"]>>(
    initial ?? {
      ...presets.openai,
      provider: "openai",
      credentialMode: "stored",
      credentialEnv: "SUI_SPENDING_AI_KEY",
      model: "",
    },
  );
  const [key, setKey] = useState(""),
    [models, setModels] = useState<{ id: string; name: string }[]>([]),
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
  return (
    <Box title="AIサービス">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() =>
            apiFetch("/api/spending/ai/config", {
              method: "POST",
              body: JSON.stringify({
                version,
                ai,
                ...(key ? { apiKey: key } : {}),
              }),
            }),
          );
        }}
      >
        <fieldset disabled={working} className="min-w-0 space-y-4">
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
          <Field label="APIキー">
            <Input
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
            <Field label="モデル">
              <Input
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
          <div className="flex flex-wrap gap-3">
            <Button type="submit">AI設定を保存</Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!ai.model}
              onClick={() => void inspect(true)}
            >
              接続を確認
            </Button>
            {initial?.credentialMode === "stored" && (
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  void run(() =>
                    apiFetch("/api/spending/ai/config", {
                      method: "POST",
                      body: JSON.stringify({
                        version,
                        ai: initial,
                        apiKey: null,
                      }),
                    }),
                  )
                }
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
function RequestForm({
  initial,
  accounts,
  state,
  save,
  cancel,
  busy,
  error,
}: {
  initial: SpendingApplicationInput;
  accounts: Account[];
  state: SpendingResponse;
  save: (v: SpendingApplicationInput) => void;
  cancel: () => void;
  busy: boolean;
  error: string;
}) {
  const [v, set] = useState(initial);
  return (
    <Modal title="買い物の申請" close={cancel} busy={busy}>
      {error && (
        <p role="alert" className="text-critical">
          {error}
        </p>
      )}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save({
            ...v,
            funding: v.funding ? { ...v.funding, amount: v.amount } : null,
          });
        }}
      >
        <Text
          label="買うもの"
          value={v.name}
          required
          onChange={(name) => set({ ...v, name })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Text
            label={v.currency === "JPY" ? "金額（円）" : "金額（最小通貨単位）"}
            type="number"
            currencyInput
            value={v.amount || ""}
            required
            onChange={(n) => set({ ...v, amount: Number(n) })}
          />
          <Text
            label="カテゴリ"
            list="spending-categories"
            value={v.category}
            required
            onChange={(category) => set({ ...v, category, subcategory: "" })}
          />
        </div>
        <Text
          label="中項目（任意）"
          value={v.subcategory ?? ""}
          list="request-subcategories"
          onChange={(subcategory) => set({ ...v, subcategory })}
        />
        <datalist id="request-subcategories">
          {[
            ...new Set(
              [
                ...state.ledger.details
                  .filter((d) => !d.deletedAt && d.raw["大項目"] === v.category)
                  .map((d) => d.raw["中項目"]),
                ...(state.ledger.settings.supplementalLimits ?? [])
                  .filter((r) => r.category === v.category)
                  .map((r) => r.subcategory),
              ].filter((v): v is string => !!v),
            ),
          ].map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <Text
          label="購入理由"
          value={v.reason}
          required
          onChange={(reason) => set({ ...v, reason })}
        />
        <Text
          label="支払手段"
          list="spending-payments"
          value={v.payment}
          required
          onChange={(payment) => set({ ...v, payment })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Text
            label="購入予定日"
            type="date"
            value={v.purchaseDate}
            required
            onChange={(purchaseDate) => set({ ...v, purchaseDate })}
          />
          <Choice
            label="使う予算"
            value={v.kind}
            onChange={(kind) =>
              set({
                ...v,
                kind: kind as SpendingApplicationInput["kind"],
                funding:
                  kind === "normal"
                    ? null
                    : {
                        sourceId: "",
                        destinationId: "",
                        date: v.purchaseDate,
                        amount: v.amount,
                      },
              })
            }
          >
            <option value="normal">通常予算</option>
            <option value="supplemental">補正予算</option>
          </Choice>
        </div>
        {v.funding && (
          <div className="space-y-3 border-t border-line pt-3">
            <Choice
              label="資金元口座"
              value={v.funding.sourceId}
              onChange={(sourceId) =>
                set({ ...v, funding: { ...v.funding!, sourceId } })
              }
            >
              <option value="">選択してください</option>
              {accounts
                .filter((a) => a.supplementalBudgetEnabled)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </Choice>
            <Choice
              label="振替先口座"
              value={v.funding.destinationId}
              onChange={(destinationId) =>
                set({ ...v, funding: { ...v.funding!, destinationId } })
              }
            >
              <option value="">選択してください</option>
              {accounts
                .filter((a) => a.id !== v.funding!.sourceId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </Choice>
            <Text
              label="振替日"
              type="date"
              value={v.funding.date}
              required
              onChange={(date) =>
                set({ ...v, funding: { ...v.funding!, date } })
              }
            />
            <p>
              振替額：{v.amount.toLocaleString()} {v.currency}
            </p>
          </div>
        )}
        <SecondaryPanel title={<>補足情報・外貨設定</>}>
          <div className="space-y-3">
            <Text
              label="緊急性"
              value={v.urgency}
              onChange={(urgency) => set({ ...v, urgency })}
            />
            <Text
              label="買い替え／追加購入"
              value={v.replacement}
              onChange={(replacement) => set({ ...v, replacement })}
            />
            <Text
              label="延期・代替案"
              value={v.alternatives}
              onChange={(alternatives) => set({ ...v, alternatives })}
            />
            <Choice
              label="関連申請を追加"
              value=""
              onChange={(id) =>
                id &&
                set({ ...v, relatedIds: [...new Set([...v.relatedIds, id])] })
              }
            >
              <option value="">選択</option>
              {state.ledger.requests
                .filter((r) => !r.deletedAt)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.input.name}
                  </option>
                ))}
            </Choice>
            <p>
              {v.relatedIds
                .map(
                  (id) =>
                    state.ledger.requests.find((r) => r.id === id)?.input.name,
                )
                .join("、")}
            </p>
            <Text
              label="通貨"
              value={v.currency}
              onChange={(currency) =>
                set({
                  ...v,
                  currency: currency.toUpperCase(),
                  rateToJpy: currency.toUpperCase() === "JPY" ? 1 : null,
                  rateAt: null,
                })
              }
            />
            {v.currency !== "JPY" && (
              <>
                <Text
                  label="最小通貨単位からJPYへの換算率"
                  type="number"
                  step="any"
                  value={v.rateToJpy ?? ""}
                  onChange={(n) =>
                    set({ ...v, rateToJpy: n ? Number(n) : null })
                  }
                />
                <Text
                  label="換算基準日"
                  type="date"
                  value={v.rateAt ?? ""}
                  onChange={(rateAt) => set({ ...v, rateAt })}
                />
              </>
            )}
          </div>
        </SecondaryPanel>
        <p className="text-sm text-ink-2">
          {v.amount * (v.rateToJpy ?? 0) >=
          (state.ledger.settings.threshold ?? Infinity)
            ? "決裁対象の金額です"
            : "任意申請です"}
        </p>
        <div className="flex gap-2">
          <Button type="submit">下書きを保存</Button>
          <Button type="button" variant="secondary" onClick={cancel}>
            閉じる
          </Button>
        </div>
      </form>
    </Modal>
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
  review: (reason?: string) => void;
  answer: (reviewId: string, answer: string) => Promise<boolean>;
  close: () => void;
  busy: boolean;
  error: string;
}) {
  const [view, setView] = useState("result");
  const [panel, setPanel] = useState<
    "evidence" | "history" | "actions" | "purchase" | "answer" | null
  >(null);
  const purchase =
    r.purchaseRecord ??
    (r.purchases.length
      ? {
          amount: r.purchases.reduce((n, p) => n + p.amount, 0),
          date: r.purchases.at(-1)!.date,
          reason: "旧購入記録",
        }
      : null);
  const [amount, setAmount] = useState(
    String(purchase?.amount ?? r.input.items.reduce((n, i) => n + i.amount, 0)),
  );
  const [date, setDate] = useState(purchase?.date ?? today());
  const [reason, setReason] = useState("購入を確認");
  const [answerText, setAnswerText] = useState("");
  const [actionReason, setActionReason] = useState("");
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
      className="space-y-3 rounded-lg border border-line bg-surface-1 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-semibold">{r.input.name}</h2>
          <span className="text-sm text-ink-2">
            {r.input.purchaseDate} ·{" "}
            {r.input.kind === "normal" ? "通常予算" : "補正予算"}
          </span>
        </div>
        <span className="text-sm">
          {total.toLocaleString()} {r.input.currency} ·{" "}
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
          <Button variant="primary" onClick={() => setPanel("purchase")}>
            {purchase ? "購入記録を訂正" : "購入した"}
          </Button>
          <Button
            variant="secondary"
            disabled={r.input.items.length > 1}
            onClick={edit}
          >
            申請を変更
          </Button>

          <Button variant="ghost" onClick={() => setPanel("evidence")}>
            根拠を見る
          </Button>
          <Button variant="ghost" onClick={() => setPanel("history")}>
            履歴を見る
          </Button>
          <Button variant="ghost" onClick={() => setPanel("actions")}>
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
                        onClick={() => setPanel("answer")}
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
          <Modal
            title="審査の質問に回答"
            close={() => setPanel(null)}
            busy={busy}
          >
            <p>{latest.question}</p>
            {error && (
              <p role="alert" className="text-critical">
                {error}
              </p>
            )}
            <form
              className="mt-4 space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await answer(latest.id, answerText)) {
                  setAnswerText("");
                  setPanel(null);
                }
              }}
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
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                />
              </label>
              <p className="text-sm text-ink-2">
                回答は履歴に保存されます。金額や日付を変える場合は申請を変更してください。
              </p>
              <Button type="submit" disabled={busy || !answerText.trim()}>
                {busy ? "回答を保存・再審査中…" : "回答を保存して再審査"}
              </Button>
            </form>
          </Modal>
        )}
        {panel === "purchase" && (
          <Modal
            title={purchase ? "購入記録を訂正" : "購入を完了する"}
            close={() => setPanel(null)}
            busy={busy}
          >
            <p className="text-sm text-ink-2">{r.input.name}</p>
            {error && (
              <p role="alert" className="text-critical">
                {error}
              </p>
            )}
            <form
              className="mt-4 space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                await command({
                  action: "purchase",
                  id: r.id,
                  amount: Number(amount),
                  date,
                  reason,
                });
                setPanel(null);
              }}
            >
              <Text
                label="購入実額"
                type="number"
                currencyInput
                value={amount}
                onChange={setAmount}
                required
              />
              <Text
                label="購入日"
                type="date"
                value={date}
                onChange={setDate}
                required
              />
              <Text
                label="購入記録のメモ"
                value={reason}
                onChange={setReason}
                required
              />
              <p className="text-sm text-ink-2">
                この記録で購入が完了します。MFの実績と予算残額は変更しません。
              </p>
              <Button type="submit">購入を記録</Button>
            </form>
          </Modal>
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
          <Modal title="その他の操作" close={() => setPanel(null)} busy={busy}>
            <p className="text-sm text-ink-2">{r.input.name}</p>
            {error && (
              <p role="alert" className="text-critical">
                {error}
              </p>
            )}
            <Text
              label="操作の理由"
              value={actionReason}
              onChange={setActionReason}
              required
            />
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!actionReason.trim()}
                variant="secondary"
                onClick={() => review(actionReason)}
              >
                例外承認
              </Button>
              <Button
                disabled={cancelled || !actionReason.trim()}
                variant="danger"
                onClick={() =>
                  void command({
                    action: "cancel",
                    id: r.id,
                    reason: actionReason,
                  })
                }
              >
                申請を取消
              </Button>
              {!purchase && !r.fundingLinks.length && (
                <Button
                  disabled={!actionReason.trim()}
                  variant="danger"
                  onClick={async () => {
                    await command({
                      action: "delete",
                      id: r.id,
                      reason: actionReason,
                    });
                    close();
                  }}
                >
                  申請を削除
                </Button>
              )}
            </div>
          </Modal>
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
                    <form
                      className="space-y-3"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        await command({
                          action: "return-funds",
                          id: r.id,
                          linkId: link.id,
                          amount: Number(amount),
                          date,
                          reason: actionReason,
                        });
                      }}
                    >
                      <Text
                        label="返却額"
                        type="number"
                        currencyInput
                        value={amount}
                        onChange={setAmount}
                        required
                      />
                      <Text
                        label="返却日"
                        type="date"
                        value={date}
                        onChange={setDate}
                        required
                      />
                      <Text
                        label="返却理由"
                        value={actionReason}
                        onChange={setActionReason}
                        required
                      />
                      <Button type="submit">資金返却の振替予定を作成</Button>
                    </form>
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
  command,
}: {
  state: SpendingResponse;
  command: Command;
}) {
  const currentMonth = today().slice(0, 7);
  const [month, setMonth] = useState(currentMonth),
    [name, setName] = useState("MF通常予算"),
    [from, setFrom] = useState(currentMonth),
    [to, setTo] = useState(""),
    [reason, setReason] = useState(""),
    [replaceId, setReplaceId] = useState("");
  const [rows, setRows] = useState<{ category: string; amount: number }[]>([
    { category: "", amount: 0 },
  ]);
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
  const active = (state.ledger.budgetProposals ?? []).filter(
    (p) => !p.supersededAt,
  );
  const applicable = active.find(
    (p) => p.from <= month && (!p.to || p.to >= month),
  );
  const [cardTotal, setCardTotal] = useState<number | null>(null);
  useEffect(() => {
    apiFetch<{ assumptionAmount: number }[]>("/api/credit-cards")
      .then((cs) =>
        setCardTotal(cs.reduce((n, c) => n + c.assumptionAmount, 0)),
      )
      .catch(() => setCardTotal(null));
  }, []);
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
          <table className="w-full text-left text-sm">
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
                    <td className="p-2">{c.category}</td>
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
            void command({
              action: "budget-proposal",
              ...(replaceId ? { replaceId } : {}),
              proposal: {
                name,
                from,
                to: to || null,
                categories: rows,
                reason,
              },
            });
          }}
        >
          <Choice
            label="変更元の予算案"
            value={replaceId}
            onChange={(id) => {
              setReplaceId(id);
              const p = active.find((p) => p.id === id);
              if (p) {
                setName(p.name);
                setFrom(p.from);
                setTo(p.to ?? "");
                setRows(p.categories.map((c) => ({ ...c })));
              }
            }}
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
              value={name}
              onChange={setName}
              required
            />
            <Text
              label="適用開始月"
              type="month"
              value={from}
              onChange={setFrom}
              required
            />
            <Text
              label="適用終了月（空欄なら継続）"
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
                      i === index ? { ...r, amount: Number(v) } : r,
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
            onClick={() => setRows([...rows, { category: "", amount: 0 }])}
          >
            カテゴリを追加
          </Button>
          <Text label="改定理由" value={reason} onChange={setReason} required />
          <Button type="submit">予算案を保存</Button>
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
  command,
  onState,
  accounts,
  cards,
}: {
  state: SpendingResponse;
  run: (f: () => Promise<unknown>) => Promise<void>;
  command: Command;
  onState: (s: SpendingResponse) => void;
  accounts: Account[];
  cards: CreditCard[];
}) {
  const [file, setFile] = useState<File | null>(null),
    [batch, setBatch] = useState<SpendingImport | null>(null),
    [resolutions, setResolutions] = useState<Record<string, string>>({}),
    [month, setMonth] = useState(today().slice(0, 7)),
    [fallback, setFallback] = useState(""),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState(""),
    [payment, setPayment] = useState("");
  const [detail, setDetail] = useState("");
  const preview = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    await run(async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      const result = await apiFetch<{
        preview: SpendingImport;
        state: SpendingResponse;
      }>("/api/spending/imports/preview", {
        method: "POST",
        body: JSON.stringify({
          version: state.version,
          base64: btoa(binary),
          filename: file.name,
          ...(fallback ? { month: fallback } : {}),
        }),
      });
      setBatch(result.preview);
      setResolutions({});
      setMonth(result.preview.month ?? result.preview.from.slice(0, 7));
      onState(result.state);
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
  return (
    <div className="space-y-5">
      <Box title="月のMFデータを更新">
        <p className="text-sm text-ink-2">
          MFから出力した月別CSVを選んでください。同じ月を再取込すると、追加・変更・削除を反映します。
        </p>
        <form className="space-y-4" onSubmit={(e) => void preview(e)}>
          <Field label="CSVファイル">
            <input
              className="block w-full min-w-0 rounded-lg border border-line bg-surface p-3 text-sm file:mr-3 file:rounded file:border-0 file:bg-transparent file:px-2 file:py-2 file:font-medium"
              type="file"
              accept=".csv"
              required
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setBatch(null);
                setFallback("");
              }}
            />
          </Field>
          <SecondaryPanel title={<>対象月を判定できない空のCSVの場合</>}>
            <div className="mt-3">
              <Text
                label="空のCSVの対象月"
                type="month"
                value={fallback}
                onChange={setFallback}
              />
            </div>
          </SecondaryPanel>
          <Button type="submit">取込プレビュー</Button>
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
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className="p-2">日付・内容</th>
                    <th className="p-2">金額</th>
                    <th className="p-2">変更内容</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.rows.map((row) => (
                    <tr key={row.line} className="border-t border-line">
                      <td className="p-2">
                        {row.detail?.date} {row.detail?.description}
                      </td>
                      <td className="p-2 whitespace-nowrap">
                        {row.detail && yen(row.detail.amount)}
                      </td>
                      <td className="p-2">
                        {row.error ??
                          (row.existingId
                            ? rawSignature(
                                state.ledger.details.find(
                                  (d) => d.id === row.existingId,
                                )?.raw,
                              ) === rawSignature(row.detail?.raw)
                              ? "変更なし"
                              : "更新"
                            : "追加")}
                        {row.existingId && (
                          <p className="text-xs text-ink-2">
                            前回:{" "}
                            {yen(
                              state.ledger.details.find(
                                (d) => d.id === row.existingId,
                              )?.amount ?? null,
                            )}
                          </p>
                        )}
                        {row.candidates.length > 0 && (
                          <Choice
                            label={`行${row.line}の重複候補`}
                            value={resolutions[row.line] ?? ""}
                            onChange={(v) =>
                              setResolutions({ ...resolutions, [row.line]: v })
                            }
                          >
                            <option value="">同じ購入か選択</option>
                            <option value="new">別の購入</option>
                            {row.candidates.map((id) => (
                              <option key={id} value={id}>
                                {
                                  state.ledger.details.find((d) => d.id === id)
                                    ?.description
                                }
                                ・既存明細を更新
                              </option>
                            ))}
                          </Choice>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
            <Button
              disabled={batch.committed || batch.errors.length > 0}
              onClick={() =>
                void run(async () => {
                  await command({
                    action: "import-confirm",
                    id: batch.id,
                    resolutions,
                    confirmedCoverage: false,
                    acceptErrors: false,
                  });
                  setBatch(null);
                })
              }
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
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                {["日付", "内容", "金額", "MFカテゴリ", "支払元"].map((t) => (
                  <th key={t} className="p-2 whitespace-nowrap">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => (
                <tr key={d.id} className="border-t border-line align-top">
                  <td className="p-2 whitespace-nowrap">{d.date}</td>
                  <td className="p-2 min-w-32">
                    <button
                      className="text-left underline"
                      onClick={() => {
                        setDetail(d.id);
                      }}
                    >
                      {d.description}
                    </button>
                    {(d.transfer || !d.included) && (
                      <p className="text-xs">
                        {d.transfer ? "振替" : "集計対象外"}
                      </p>
                    )}
                  </td>
                  <td className="p-2 whitespace-nowrap">{yen(d.amount)}</td>
                  <td className="p-2">{d.categorySource}</td>
                  <td className="p-2">{paymentLabel(d.paymentSource)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!shown.length && (
            <p className="p-4 text-sm text-ink-2">
              この条件の明細はありません。
            </p>
          )}
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
              key={source + JSON.stringify(state.ledger.paymentLinks?.[source])}
              source={source}
              initial={state.ledger.paymentLinks?.[source]}
              accounts={accounts}
              cards={cards}
              save={(c) => run(() => command(c))}
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
  accounts,
  cards,
  save,
}: {
  source: string;
  initial?: { kind: "account" | "card"; id: string };
  accounts: Account[];
  cards: CreditCard[];
  save: Command;
}) {
  const [value, setValue] = useState(
    initial ? `${initial.kind}:${initial.id}` : "",
  );
  return (
    <form
      className="grid items-end gap-3 rounded border border-line p-3 md:grid-cols-[minmax(0,1fr)_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        const [kind, id] = value.split(":");
        void save({
          action: "payment-link",
          source,
          target: value ? { kind, id } : null,
        });
      }}
    >
      <Choice label={source} value={value} onChange={setValue}>
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
      <Button type="submit" variant="secondary">
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
