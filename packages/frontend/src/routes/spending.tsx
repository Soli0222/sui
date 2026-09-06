import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  Account,
  SpendingInput,
  SpendingResponse,
  SpendingRequest,
  SpendingSettings,
  SpendingImport,
} from "@sui/shared";
import { apiFetch } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { Card } from "../components/ui/card";
const labels: Record<string, string> = {
  draft: "下書き",
  reviewing: "審査中",
  conditional: "条件付き",
  held: "保留",
  denied: "否認",
  approved: "承認済み",
  purchased: "購入済み・明細待ち",
  completed: "完了",
  cancelled: "取消",
  expired: "期限切れ",
  scheduled: "振替待ち",
  used: "振替確定・利用済み",
  attention: "要確認",
  approvable: "承認可",
};
const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(
    new Date(),
  );
const yen = (n: number | null) =>
  n === null ? "未設定" : `${n.toLocaleString()}円`;
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm text-ink-2">
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
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  step?: string;
}) {
  return (
    <Field label={label}>
      <Input
        type={type}
        step={step}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
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
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
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
function newInput(): SpendingInput {
  return {
    name: "",
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
    items: [
      {
        id: crypto.randomUUID(),
        name: "",
        amount: 0,
        category: "",
        month: today().slice(0, 7),
        forecastId: null,
        forecastAmount: 0,
      },
    ],
    funding: null,
  };
}
type Command = (command: Record<string, unknown>) => Promise<void>;
export function SpendingPage() {
  const [state, setState] = useState<SpendingResponse | null>(null),
    [accounts, setAccounts] = useState<Account[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("requests");
  const [search, setSearch] = useSearchParams();
  const [editing, setEditing] = useState<SpendingRequest | null>(null),
    [create, setCreate] = useState(false);
  const load = async () => {
    const [s, a] = await Promise.all([
      apiFetch<SpendingResponse>("/api/spending"),
      apiFetch<Account[]>("/api/accounts"),
    ]);
    setState(s);
    setAccounts(a);
  };
  useEffect(() => {
    let active = true;
    Promise.all([
      apiFetch<SpendingResponse>("/api/spending"),
      apiFetch<Account[]>("/api/accounts"),
    ])
      .then(([s, a]) => {
        if (active) {
          setState(s);
          setAccounts(a);
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, []);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
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
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">支出決裁</h1>
          <p className="mt-2 text-sm text-ink-2">
            買う前の予算確認と、購入後の明細確認。
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
      {!state ? (
        <p>読み込み中…</p>
      ) : (
        <>
          <nav className="flex flex-wrap gap-2" aria-label="支出決裁メニュー">
            {[
              ["requests", "申請"],
              ["budgets", "通常予算・予測"],
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
          {Object.entries(state.ledger.settings).some(
            ([k, v]) => k !== "ai" && v === null,
          ) && (
            <p className="rounded border border-line p-4">
              利用開始には、決裁対象金額・明細の鮮度・承認期限・資金確認期間の入力が必要です。
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
                      {f.available.toLocaleString()}{" "}
                      {accounts.find((a) => a.id === f.accountId)?.currencyCode}
                    </p>
                    <p className="text-sm text-ink-2">
                      実残高 {f.balance.toLocaleString()} − 保護額{" "}
                      {f.balanceOffset.toLocaleString()} − 未確定拘束{" "}
                      {f.held.toLocaleString()} ／ 確認期限 {f.through}
                    </p>
                    {f.issues.map((i) => (
                      <p key={i} className="text-critical">
                        {i}
                      </p>
                    ))}
                    <details>
                      <summary>拘束の内訳</summary>
                      {f.events.map((e) => (
                        <p key={e.id}>
                          {e.date} {e.amount.toLocaleString()}{" "}
                          <Link to="/recurring" className="underline">
                            予定収支
                          </Link>
                        </p>
                      ))}
                    </details>
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
              />
            )}
            {tab === "requests" && (
              <>
                {create && (
                  <RequestForm
                    key={editing?.id ?? "new"}
                    initial={editing?.input ?? newInput()}
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
                <div className="grid gap-3">
                  {state.ledger.requests
                    .filter((r) => !r.deletedAt)
                    .slice()
                    .reverse()
                    .map((r) => {
                      const s = state.requestStates[r.id];
                      return (
                        <button
                          key={r.id}
                          onClick={() => setSearch({ request: r.id })}
                          className="flex flex-wrap items-center justify-between gap-3 rounded border border-line bg-surface p-4 text-left"
                        >
                          <span>
                            <strong>{r.input.name}</strong>
                            <span className="ml-3 text-sm text-ink-2">
                              {r.input.purchaseDate} ·{" "}
                              {r.input.kind === "normal"
                                ? "通常予算"
                                : "補正予算"}
                            </span>
                          </span>
                          <span>
                            {r.input.items
                              .reduce((a, i) => a + i.amount, 0)
                              .toLocaleString()}{" "}
                            {r.input.currency} · {labels[s.status]}{" "}
                            {s.funding.some((f) => f.state === "scheduled")
                              ? "／振替待ち"
                              : ""}{" "}
                            {s.issues.length ? "／要確認" : ""}
                          </span>
                        </button>
                      );
                    })}
                  {state.ledger.requests.length === 0 && (
                    <p className="p-5 text-ink-2">
                      申請はまだありません。金額にかかわらず任意申請できます。
                    </p>
                  )}
                </div>
                {selected && (
                  <RequestDetail
                    key={selected.id}
                    request={selected}
                    state={state}
                    accounts={accounts}
                    edit={() => {
                      setEditing(selected);
                      setCreate(true);
                    }}
                    command={(c) => run(() => command(c))}
                    review={(reason) =>
                      run(async () => {
                        await apiFetch(
                          `/api/spending/${selected.id}/${reason ? "override" : "review"}`,
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
                )}
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
}: {
  settings: SpendingSettings;
  save: (s: SpendingSettings) => void;
}) {
  const [s, set] = useState(settings);
  const ai = s.ai ?? {
    endpoint: "",
    model: "",
    credentialEnv: "SUI_SPENDING_AI_KEY",
    protocol: "chat-completions" as const,
  };
  return (
    <Box title="決裁設定">
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save(s);
        }}
      >
        {(
          [
            ["threshold", "決裁が必要な金額（この額以上・円）"],
            ["freshnessDays", "明細の有効な鮮度（日）"],
            ["approvalDays", "承認有効期間（日）"],
            ["fundingDays", "資金確認期間（日）"],
          ] as const
        ).map(([k, label]) => (
          <Text
            key={k}
            label={label}
            type="number"
            value={s[k] ?? ""}
            onChange={(v) => set({ ...s, [k]: v === "" ? null : Number(v) })}
          />
        ))}
        <p className="md:col-span-2 text-sm text-ink-2">
          過去の参考期間は直近3か月です。設定値が未入力の場合は審査を保留します。
        </p>
        <Text
          label="AIエンドポイント（完全なURL）"
          value={ai.endpoint}
          onChange={(v) => set({ ...s, ai: { ...ai, endpoint: v } })}
        />
        <Text
          label="モデル"
          value={ai.model}
          onChange={(v) => set({ ...s, ai: { ...ai, model: v } })}
        />
        <Text
          label="サーバーの認証用環境変数名（秘密値は入力しない）"
          value={ai.credentialEnv}
          onChange={(v) => set({ ...s, ai: { ...ai, credentialEnv: v } })}
        />
        <Choice
          label="AI通信形式"
          value={ai.protocol}
          onChange={(v) =>
            set({ ...s, ai: { ...ai, protocol: v as typeof ai.protocol } })
          }
        >
          <option value="chat-completions">Chat Completions互換</option>
          <option value="anthropic">Anthropic Messages</option>
        </Choice>
        <Button type="submit">設定を保存</Button>
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
}: {
  initial: SpendingInput;
  accounts: Account[];
  state: SpendingResponse;
  save: (v: SpendingInput) => void;
  cancel: () => void;
}) {
  const [v, set] = useState(initial);
  const amount = v.items.reduce((a, i) => a + i.amount, 0),
    threshold = state.ledger.settings.threshold;
  const updateItem = (
    index: number,
    patch: Partial<SpendingInput["items"][number]>,
  ) =>
    set({
      ...v,
      items: v.items.map((x, n) => (n === index ? { ...x, ...patch } : x)),
    });
  return (
    <Box title="申請を編集">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save(v);
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Text
            label="申請名"
            value={v.name}
            onChange={(name) => set({ ...v, name })}
            required
          />
          <Text
            label="用途・購入理由"
            value={v.reason}
            onChange={(reason) => set({ ...v, reason })}
            required
          />
          <Text
            label="購入予定日"
            type="date"
            value={v.purchaseDate}
            onChange={(purchaseDate) => set({ ...v, purchaseDate })}
            required
          />
          <Text
            label="支払手段"
            value={v.payment}
            onChange={(payment) => set({ ...v, payment })}
            required
          />
          <Choice
            label="予算区分"
            value={v.kind}
            onChange={(kind) =>
              set({
                ...v,
                kind: kind as SpendingInput["kind"],
                funding:
                  kind === "normal"
                    ? null
                    : {
                        sourceId: "",
                        destinationId: "",
                        date: v.purchaseDate,
                        amount,
                      },
              })
            }
          >
            <option value="normal">通常予算</option>
            <option value="supplemental">補正予算</option>
          </Choice>
          <Text
            label="通貨"
            value={v.currency}
            onChange={(currency) =>
              set({ ...v, currency: currency.toUpperCase() })
            }
          />
          {v.currency !== "JPY" && (
            <>
              <Text
                label="最小通貨単位からJPYへの換算率"
                type="number"
                step="any"
                value={v.rateToJpy ?? ""}
                onChange={(rate) =>
                  set({ ...v, rateToJpy: rate ? Number(rate) : null })
                }
              />
              <Text
                label="換算基準日"
                type="date"
                value={v.rateAt ?? ""}
                onChange={(rateAt) => set({ ...v, rateAt: rateAt || null })}
              />
            </>
          )}
        </div>
        {v.items.map((item, index) => (
          <div
            key={item.id}
            className="grid gap-3 rounded border border-line p-4 md:grid-cols-2"
          >
            <Text
              label={`内訳${index + 1} 品名`}
              value={item.name}
              onChange={(name) => updateItem(index, { name })}
              required
            />
            <Text
              label="金額（通貨の最小単位）"
              type="number"
              value={item.amount}
              onChange={(amount) =>
                updateItem(index, { amount: Number(amount) })
              }
              required
            />
            <Text
              label="予算カテゴリ"
              value={item.category}
              onChange={(category) => updateItem(index, { category })}
              required
            />
            <Text
              label="予算対象月"
              type="month"
              value={item.month}
              onChange={(month) => updateItem(index, { month })}
              required
            />
            <Choice
              label="予測からの充当元"
              value={item.forecastId ?? ""}
              onChange={(forecastId) =>
                updateItem(index, {
                  forecastId: forecastId || null,
                  forecastAmount: 0,
                })
              }
            >
              <option value="">追加購入・不明（控除しない）</option>
              <option value={`variable:${item.month}:${item.category}`}>
                一般変動費の予測内
              </option>
              {state.ledger.plans
                .filter(
                  (p) => p.month === item.month && p.category === item.category,
                )
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}（登録額 {yen(p.amount)}）
                  </option>
                ))}
            </Choice>
            {item.forecastId && (
              <Text
                label="予測から充当する額（審査で控除上限を確認）"
                type="number"
                value={item.forecastAmount}
                onChange={(n) =>
                  updateItem(index, { forecastAmount: Number(n) })
                }
              />
            )}
            <Button
              type="button"
              variant="ghost"
              disabled={
                v.items.length === 1 ||
                state.ledger.requests.some((r) =>
                  r.purchases.some((p) => p.itemId === item.id),
                )
              }
              onClick={() =>
                set({ ...v, items: v.items.filter((_, n) => n !== index) })
              }
            >
              未購入の内訳を削除
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            set({
              ...v,
              items: [
                ...v.items,
                {
                  ...newInput().items[0],
                  month: v.items[0].month,
                  category: v.items[0].category,
                },
              ],
            })
          }
        >
          内訳を追加
        </Button>
        <p>
          {threshold === null
            ? "決裁対象金額が未設定です"
            : amount * (v.rateToJpy ?? 0) >= threshold
              ? "決裁対象の金額です"
              : "任意申請です"}{" "}
          · 合計 {amount.toLocaleString()} {v.currency}
        </p>
        <details>
          <summary className="cursor-pointer">緊急性・代替案・関連申請</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
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
              {state.ledger.requests.map((r) => (
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
          </div>
        </details>
        {v.funding && (
          <div className="grid gap-3 border-t border-line pt-3 md:grid-cols-2">
            <Choice
              label="資金元口座"
              value={v.funding.sourceId}
              onChange={(sourceId) =>
                set({ ...v, funding: { ...v.funding!, sourceId } })
              }
            >
              <option value="">選択</option>
              {accounts
                .filter((a) => a.supplementalBudgetEnabled)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currencyCode})
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
              <option value="">選択</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currencyCode})
                </option>
              ))}
            </Choice>
            <Text
              label="振替日"
              type="date"
              value={v.funding.date}
              onChange={(date) =>
                set({ ...v, funding: { ...v.funding!, date } })
              }
            />
            <Text
              label="振替額（購入全額）"
              type="number"
              value={v.funding.amount}
              onChange={(amount) =>
                set({
                  ...v,
                  funding: { ...v.funding!, amount: Number(amount) },
                })
              }
            />
          </div>
        )}
        <div className="flex gap-3">
          <Button type="submit">下書きを保存</Button>
          <Button type="button" variant="secondary" onClick={cancel}>
            閉じる
          </Button>
        </div>
      </form>
    </Box>
  );
}
function RequestDetail({
  request: r,
  state,
  accounts,
  edit,
  command,
  review,
}: {
  request: SpendingRequest;
  state: SpendingResponse;
  accounts: Account[];
  edit: () => void;
  command: Command;
  review: (reason?: string) => void;
}) {
  const [reason, setReason] = useState(""),
    [itemId, setItem] = useState(r.input.items[0].id),
    [amount, setAmount] = useState(""),
    [date, setDate] = useState(today()),
    [close, setClose] = useState(true),
    [purchaseId, setPurchase] = useState(""),
    [detailId, setDetail] = useState(""),
    [allocation, setAllocation] = useState("");
  const st = state.requestStates[r.id],
    reviews = state.ledger.reviews
      .filter((x) => x.requestId === r.id)
      .slice()
      .reverse();
  const candidates = state.ledger.details
    .filter((d) => !d.deletedAt && d.amount < 0 && !d.transfer && d.included)
    .sort((a, b) => {
      const score = (d: typeof a) =>
        (d.date === r.input.purchaseDate ? 2 : 0) +
        (state.ledger.paymentMappings[d.paymentSource] === r.input.payment
          ? 2
          : 0) +
        (d.description.includes(r.input.name) ? 1 : 0);
      return score(b) - score(a);
    });
  return (
    <Box title={r.input.name}>
      <p>
        {labels[st.status]} · 有効期限 {r.expiresAt ?? "未承認"} ·{" "}
        {r.input.reason}
      </p>
      {st.issues.map((i) => (
        <p key={i} className="text-critical">
          要確認: {i}
        </p>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={edit}>
          編集・再申請
        </Button>
        <Button onClick={() => review()}>AI審査</Button>
      </div>
      <Text
        label="例外承認・取消・購入実績の理由"
        value={reason}
        onChange={setReason}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={!reason.trim()}
          onClick={() => review(reason)}
        >
          理由を付けて例外承認
        </Button>
        <Button
          variant="danger"
          disabled={!reason.trim()}
          onClick={() => void command({ action: "cancel", id: r.id, reason })}
        >
          未購入分を取消
        </Button>
        {r.purchases.length === 0 && r.fundingLinks.length === 0 && (
          <Button
            variant="danger"
            disabled={!reason.trim()}
            onClick={() => void command({ action: "delete", id: r.id, reason })}
          >
            申請を削除
          </Button>
        )}
      </div>
      <details open>
        <summary className="font-semibold">購入実績を記録</summary>
        <form
          className="mt-3 grid gap-3 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void command({
              action: "purchase",
              id: r.id,
              itemId,
              amount: Number(amount),
              date,
              reason,
              closeRemainder: close,
            });
          }}
        >
          <Choice label="購入した内訳" value={itemId} onChange={setItem}>
            {r.input.items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Choice>
          <Text
            label="今回購入した実額"
            type="number"
            value={amount}
            onChange={setAmount}
            required
          />
          <Text label="購入日" type="date" value={date} onChange={setDate} />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={close}
              onChange={(e) => setClose(e.target.checked)}
            />
            未購入分の予約を解放（これで購入終了）
          </label>
          <Button disabled={!reason.trim()} type="submit">
            購入実績を記録
          </Button>
          <p className="text-sm text-ink-2">
            未承認の購入も事後申請として記録します。増額分は関連申請で追加審査してください。
          </p>
        </form>
      </details>
      {r.purchases.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center gap-3">
          <span>
            {p.date} 購入実額 {p.amount.toLocaleString()} {r.input.currency}
          </span>
          <Button
            variant="secondary"
            disabled={!reason || !amount}
            onClick={() =>
              void command({
                action: "purchase-update",
                id: r.id,
                purchaseId: p.id,
                amount: Number(amount),
                date,
                reason,
              })
            }
          >
            上の実額・日付で訂正
          </Button>
        </div>
      ))}
      <details open={r.purchases.length > 0}>
        <summary className="font-semibold">MF明細と購入実績を紐づけ</summary>
        <form
          className="mt-3 grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void command({
              action: "allocate",
              id: r.id,
              purchaseId,
              detailId,
              amount: Number(allocation),
            });
          }}
        >
          <Choice label="購入実績" value={purchaseId} onChange={setPurchase}>
            <option value="">選択</option>
            {r.purchases.map((p) => (
              <option key={p.id} value={p.id}>
                {p.date} {r.input.items.find((i) => i.id === p.itemId)?.name}{" "}
                {p.amount.toLocaleString()} {r.input.currency}
              </option>
            ))}
          </Choice>
          <Choice
            label="MF明細候補（利用者が確認して選択）"
            value={detailId}
            onChange={setDetail}
          >
            <option value="">選択</option>
            {candidates.map((d) => (
              <option key={d.id} value={d.id}>
                {d.date} {d.description} {yen(-d.amount)} {d.paymentSource}
              </option>
            ))}
          </Choice>
          <Text
            label="配賦額（JPY）"
            type="number"
            value={allocation}
            onChange={setAllocation}
          />
          <Button type="submit" disabled={!purchaseId || !detailId}>
            確認して紐づけ
          </Button>
        </form>
        {state.ledger.allocations
          .filter((a) => a.active && a.requestId === r.id)
          .map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between border-t border-line py-2"
            >
              <span>
                {
                  state.ledger.details.find((d) => d.id === a.detailId)
                    ?.description
                }{" "}
                {yen(a.amount)}
              </span>
              <Button
                variant="ghost"
                disabled={!reason.trim()}
                onClick={() =>
                  void command({ action: "unlink", allocationId: a.id, reason })
                }
              >
                解除
              </Button>
            </div>
          ))}
      </details>
      {r.fundingLinks.length > 0 && (
        <div>
          <h3 className="font-semibold">振替（購入完了とは独立）</h3>
          {r.fundingLinks.map((link) => {
            const s = st.funding.find((s) => s.id === link.id)!;
            return (
              <div
                key={link.id}
                className="space-y-2 border-t border-line py-3"
              >
                <p>
                  {labels[s.state]} {link.returnOf ? "資金返却" : ""} ·{" "}
                  {accounts.find((a) => a.id === link.expected.sourceId)?.name}{" "}
                  →{" "}
                  {
                    accounts.find((a) => a.id === link.expected.destinationId)
                      ?.name
                  }{" "}
                  · {link.expected.amount.toLocaleString()} ／ 実額{" "}
                  {s.actual?.toLocaleString() ?? "未確定"}
                </p>
                <Link
                  className="mr-3 underline"
                  to={`/recurring?spending=${r.id}&item=${link.recurringId}`}
                >
                  振替予定を開く
                </Link>
                {s.transactionId && (
                  <Link
                    className="underline"
                    to={`/transactions?spending=${r.id}&transaction=${s.transactionId}`}
                  >
                    確定取引を開く
                  </Link>
                )}
                {s.transactionId && !link.returnOf && (
                  <Button
                    variant="secondary"
                    disabled={!reason || !amount}
                    onClick={() =>
                      void command({
                        action: "return-funds",
                        id: r.id,
                        linkId: link.id,
                        amount: Number(amount),
                        date,
                        reason,
                      })
                    }
                  >
                    上の実額・日付で資金返却予定を登録
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <h3 className="font-semibold">審査・変更履歴</h3>
      {reviews.map((rv) => (
        <details
          key={rv.id}
          open={rv === reviews[0]}
          className="rounded border border-line p-3"
        >
          <summary>
            {rv.at} · {labels[rv.decision]}{" "}
            {rv.overrideReason ? "（例外承認）" : ""}
          </summary>
          <p className="my-2 text-sm">
            モデル {rv.model ?? "未設定"} ／ 申請版 {rv.requestVersion} ／
            根拠版 {rv.ledgerVersion} ／ 鮮度{" "}
            {rv.snapshot.settings.freshnessDays ?? "未設定"}日 ／ 承認期限{" "}
            {rv.snapshot.settings.approvalDays ?? "未設定"}日 ／ 資金確認{" "}
            {rv.snapshot.settings.fundingDays ?? "未設定"}日
          </p>
          {[...rv.reasons, ...rv.missing, ...rv.options].map((s, n) => (
            <p key={n}>{s}</p>
          ))}
          {rv.snapshot.calculations.map((c) => (
            <div key={c.month + c.category} className="my-3 overflow-x-auto">
              <h4>
                {c.month} {c.category}
              </h4>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {[
                      "予算",
                      "A 実績",
                      "R 未反映",
                      "F 今後",
                      "Q 今回",
                      "申請前",
                      "申請後",
                      "残余",
                    ].map((h) => (
                      <th key={h} className="p-2 text-right">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {[
                      c.budget,
                      c.A,
                      c.R,
                      c.F,
                      c.Q,
                      c.before,
                      c.after,
                      c.remaining,
                    ].map((v, n) => (
                      <td key={n} className="p-2 text-right whitespace-nowrap">
                        {yen(v)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
              <p>
                全支出 {yen(c.allSpending)} ／ 通常対象 {yen(c.A)} ／ 補正対象{" "}
                {yen(c.supplemental)}
              </p>
              <p>
                変動費月額: 中央値 {yen(c.median)} ／ 平均 {yen(c.average)} ／
                最大 {yen(c.maximum)} ／ 当月ペース {yen(c.currentPace)}
                （確認済み {c.coveredDays}日）
              </p>
              {c.history.map((h) => (
                <p key={h.month}>
                  {h.month} 実績 {yen(h.total)} ／ 変動費 {yen(h.variable)} ／{" "}
                  {h.covered ? "期間確認済み" : "未確認期間あり"}
                </p>
              ))}
              {c.forecastAvailable.map((f) => (
                <p key={f.id}>
                  予測控除上限{" "}
                  {state.ledger.plans.find((p) => p.id === f.id)?.name ??
                    "一般変動費"}
                  : {yen(f.amount)}
                </p>
              ))}
            </div>
          ))}
        </details>
      ))}
      {r.history
        .slice()
        .reverse()
        .map((h, n) => (
          <p key={n} className="text-sm text-ink-2">
            {h.at} {h.action} {h.reason}
          </p>
        ))}
    </Box>
  );
}
function BudgetForm({
  state,
  command,
}: {
  state: SpendingResponse;
  command: Command;
}) {
  const [month, setMonth] = useState(today().slice(0, 7)),
    [category, setCategory] = useState(""),
    [amount, setAmount] = useState(""),
    [reason, setReason] = useState(""),
    [from, setFrom] = useState(""),
    [name, setName] = useState(""),
    [date, setDate] = useState(today()),
    [planId, setPlanId] = useState("");
  const [cardTotal, setCardTotal] = useState<number | null>(null);
  useEffect(() => {
    apiFetch<{ assumptionAmount: number }[]>("/api/credit-cards")
      .then((cards) =>
        setCardTotal(cards.reduce((n, c) => n + c.assumptionAmount, 0)),
      )
      .catch(() => setCardTotal(null));
  }, []);
  const latest = [
    ...new Map(
      state.ledger.budgets
        .filter((b) => b.month === month)
        .map((b) => [b.category, b]),
    ).values(),
  ];
  return (
    <>
      <Box title="月別・カテゴリ別の通常予算">
        <form
          className="grid gap-3 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void command({
              action: "budget",
              month,
              category,
              amount: Number(amount),
              reason,
            });
          }}
        >
          <Text label="適用月" type="month" value={month} onChange={setMonth} />
          <Text
            label="カテゴリ"
            value={category}
            onChange={setCategory}
            required
          />
          <Text
            label="予算（円）"
            type="number"
            value={amount}
            onChange={setAmount}
            required
          />
          <Text label="改定理由" value={reason} onChange={setReason} required />
          <Button type="submit">予算を改定</Button>
        </form>
        {latest.map((b) => (
          <p key={b.id}>
            {b.category} <strong>{yen(b.amount)}</strong>
          </p>
        ))}
        {state.calculations
          .filter((c) => c.month === month)
          .map((c) => (
            <div key={c.category} className="border-t border-line py-3">
              <strong>
                {c.category} 残余 {yen(c.remaining)}
              </strong>
              <p>
                月末見込み {yen(c.after)} = 実績 {yen(c.A)} + 未反映予約{" "}
                {yen(c.R)} + 今後 {yen(c.F)}
              </p>
              <p className="text-sm text-ink-2">
                全支出 {yen(c.allSpending)} ／ 通常対象 {yen(c.A)} ／ 補正対象{" "}
                {yen(c.supplemental)}
              </p>
              {c.missing.map((m) => (
                <p key={m} className="text-sm text-critical">
                  {m}
                </p>
              ))}
            </div>
          ))}
        <div className="flex flex-wrap items-end gap-3">
          <Text
            label="複製元の月"
            type="month"
            value={from}
            onChange={setFrom}
          />
          <Button
            variant="secondary"
            disabled={!from || !reason}
            onClick={() =>
              void command({ action: "copy-budget", from, to: month, reason })
            }
          >
            この月へ複製
          </Button>
        </div>
        <p>
          通常予算合計 {yen(latest.reduce((n, b) => n + b.amount, 0))} ／
          現在のカード仮定額合計 {yen(cardTotal)}
        </p>
        <p className="text-sm text-ink-2">
          通常予算とカード仮定額は同じ支出を別の観点で表します。利用月と引落月、投信積立、立替・精算、現金払いで差が出るため、合算や仮定額の自動変更はしません。
        </p>
        <details>
          <summary>改定履歴</summary>
          {state.ledger.budgets
            .filter((b) => b.month === month)
            .slice()
            .reverse()
            .map((b) => (
              <p key={b.id}>
                {b.at} {b.category} {yen(b.amount)} {b.reason}
              </p>
            ))}
        </details>
      </Box>
      <Box title="今後の通常支出予定">
        <p className="text-sm text-ink-2">
          固定支出は対象月ごとに登録・改定します。終了月以降は登録しません。登録金額が過去の変動費基準より優先されます。既存の口座予測には追加しません。
        </p>
        <form
          className="grid gap-3 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void command({
              action: "plan",
              ...(planId ? { id: planId } : {}),
              month,
              category,
              name,
              amount: Number(amount),
              date,
              type: "fixed",
              reason,
            });
          }}
        >
          <Choice
            label="編集する予定"
            value={planId}
            onChange={(id) => {
              setPlanId(id);
              const p = state.ledger.plans.find((p) => p.id === id);
              if (p) {
                setMonth(p.month);
                setCategory(p.category);
                setName(p.name);
                setDate(p.date);
                setAmount(String(p.amount));
                setReason(p.reason);
              }
            }}
          >
            <option value="">新規</option>
            {state.ledger.plans.map((p) => (
              <option value={p.id} key={p.id}>
                {p.month} {p.name}
              </option>
            ))}
          </Choice>
          <Text label="予定名" value={name} onChange={setName} required />
          <Text label="発生日" type="date" value={date} onChange={setDate} />
          <p className="text-sm">
            上の適用月・カテゴリ・金額・改定理由を使用します。終了・取消は金額0で記録します。
          </p>
          <Button type="submit">予定を保存</Button>
        </form>
      </Box>
    </>
  );
}
function ImportPanel({
  state,
  run,
  command,
  onState,
}: {
  state: SpendingResponse;
  run: (f: () => Promise<unknown>) => Promise<void>;
  command: Command;
  onState: (s: SpendingResponse) => void;
}) {
  const [from, setFrom] = useState(today().slice(0, 7) + "-01"),
    [to, setTo] = useState(today()),
    [encoding, setEncoding] = useState("shift_jis"),
    [file, setFile] = useState<File | null>(null),
    [batch, setBatch] = useState<SpendingImport | null>(null),
    [resolutions, setResolutions] = useState<Record<string, string>>({}),
    [coverage, setCoverage] = useState(false),
    [acceptErrors, setAcceptErrors] = useState(false),
    [query, setQuery] = useState("");
  const [detail, setDetail] = useState(""),
    [oneOff, setOneOff] = useState(false),
    [fixedId, setFixedId] = useState(""),
    [refundOf, setRefundOf] = useState(""),
    [reason, setReason] = useState("");
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
          from,
          to,
          encoding,
        }),
      });
      setBatch(result.preview);
      setResolutions({});
      setCoverage(false);
      onState(result.state);
    });
  };
  const mappingRows = (kind: "category" | "payment") =>
    [
      ...new Set(
        state.ledger.details
          .filter((d) => !d.deletedAt)
          .map((d) =>
            kind === "category" ? d.categorySource : d.paymentSource,
          ),
      ),
    ].map((source) => (
      <Mapping
        key={kind + source}
        kind={kind}
        source={source}
        initial={
          (kind === "category"
            ? state.ledger.categoryMappings
            : state.ledger.paymentMappings)[source] ?? ""
        }
        save={(c) => run(() => command(c))}
      />
    ));
  return (
    <>
      <Box title="MF CSVの手動取込">
        <form
          className="grid gap-3 md:grid-cols-2"
          onSubmit={(e) => void preview(e)}
        >
          <Field label="CSVファイル">
            <Input
              type="file"
              accept=".csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
          </Field>
          <Choice label="文字コード" value={encoding} onChange={setEncoding}>
            <option value="shift_jis">Shift_JIS / CP932</option>
            <option value="utf-8">UTF-8</option>
          </Choice>
          <Text
            label="対象期間の開始"
            type="date"
            value={from}
            onChange={setFrom}
          />
          <Text
            label="対象期間の終了"
            type="date"
            value={to}
            onChange={setTo}
          />
          <Button type="submit">取込プレビュー</Button>
        </form>
        {batch && (
          <div className="space-y-3">
            <h3>
              {batch.filename} · {batch.rows.length}行 · エラー{" "}
              {batch.errors.length}件 {batch.committed ? "（取込済み）" : ""}
            </h3>
            <p className="text-sm">
              行のない日が取込済みとは限りません。対象期間全体を確認できた場合だけ、下の確認欄を選択してください。
            </p>
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th>行・日付</th>
                    <th>内容・金額</th>
                    <th>検証・差分</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.rows.map((row) => (
                    <tr key={row.line} className="border-t border-line">
                      <td className="p-2">
                        {row.line} {row.detail?.date}
                      </td>
                      <td className="p-2">
                        {row.detail?.description}{" "}
                        {row.detail && yen(row.detail.amount)}
                      </td>
                      <td className="p-2">
                        {row.error ??
                          (row.existingId ? "既存ID: 差分更新" : "新規")}{" "}
                        {row.existingId && (
                          <details>
                            <summary>変更前／変更後</summary>
                            <pre className="whitespace-pre-wrap">
                              {JSON.stringify(
                                {
                                  before: state.ledger.details.find(
                                    (d) => d.id === row.existingId,
                                  )?.raw,
                                  after: row.detail?.raw,
                                },
                                null,
                                2,
                              )}
                            </pre>
                          </details>
                        )}
                        {row.candidates.length > 0 && (
                          <Choice
                            label="重複候補の解決"
                            value={resolutions[row.line] ?? ""}
                            onChange={(v) =>
                              setResolutions({ ...resolutions, [row.line]: v })
                            }
                          >
                            <option value="">未解決</option>
                            <option value="new">別購入として追加</option>
                            <option value="skip">取り込まない</option>
                            {row.candidates.map((id) => (
                              <option key={id} value={id}>
                                既存明細を更新: {id}
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
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={coverage}
                disabled={batch.errors.length > 0}
                onChange={(e) => setCoverage(e.target.checked)}
              />
              対象期間全体の明細を確認した
            </label>
            {batch.errors.length > 0 && (
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={acceptErrors}
                  onChange={(e) => setAcceptErrors(e.target.checked)}
                />
                不正行を確認した。正常行のみ取り込み、期間は未確認のままにする
              </label>
            )}
            <Button
              disabled={batch.committed}
              onClick={() =>
                void run(async () => {
                  await command({
                    action: "import-confirm",
                    id: batch.id,
                    resolutions,
                    confirmedCoverage: coverage,
                    acceptErrors,
                  });
                  setBatch(null);
                })
              }
            >
              確認して取込確定
            </Button>
          </div>
        )}
        <details>
          <summary>取込履歴と確認範囲</summary>
          {state.ledger.imports
            .slice()
            .reverse()
            .map((i) => (
              <p key={i.id}>
                {i.at} {i.filename} {i.from}〜{i.to} {i.rows.length}行 ／{" "}
                {i.committed ? "取込済み" : "プレビュー"} ／{" "}
                {i.confirmedCoverage ? "期間確認済み" : "期間未確認"} ／ エラー
                {i.errors.length}件
              </p>
            ))}
        </details>
      </Box>
      <Box title="カテゴリ・支払手段の対応付け">
        {mappingRows("category")}
        {mappingRows("payment")}
        {state.ledger.details.length === 0 && (
          <p>明細取込後、未対応の名前がここに表示されます。</p>
        )}
      </Box>
      <Box title="MF明細の検索・分類">
        <Text
          label="日付・内容・カテゴリで検索"
          value={query}
          onChange={setQuery}
        />
        <div className="max-h-80 overflow-auto">
          {state.ledger.details
            .filter(
              (d) =>
                !d.deletedAt &&
                `${d.date} ${d.description} ${d.categorySource}`.includes(
                  query,
                ),
            )
            .map((d) => (
              <button
                key={d.id}
                className="block w-full border-t border-line p-3 text-left"
                onClick={() => {
                  setDetail(d.id);
                  setOneOff(d.oneOff);
                  setFixedId(d.fixedId ?? "");
                  setRefundOf(d.refundOf ?? "");
                  setReason(d.classificationReason);
                }}
              >
                {d.date} {d.description} {yen(d.amount)} ·{" "}
                {state.ledger.categoryMappings[d.categorySource] ??
                  "カテゴリ未対応"}{" "}
                ·{" "}
                {d.transfer
                  ? "振替"
                  : !d.included
                    ? "集計対象外"
                    : d.oneOff
                      ? "単発支出"
                      : ""}
              </button>
            ))}
        </div>
        {detail && (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() =>
                command({
                  action: "classify",
                  detailId: detail,
                  oneOff,
                  fixedId: fixedId || null,
                  refundOf: refundOf || null,
                  reason,
                }),
              );
            }}
          >
            <p>
              {state.ledger.details.find((d) => d.id === detail)?.description}
            </p>
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={oneOff}
                onChange={(e) => setOneOff(e.target.checked)}
              />
              単発支出として反復予測から除外（履歴には残す）
            </label>
            <Choice
              label="固定予定に対応する支出"
              value={fixedId}
              onChange={setFixedId}
            >
              <option value="">なし</option>
              {state.ledger.plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.month} {p.name}
                </option>
              ))}
            </Choice>
            <Choice
              label="返金元の購入明細（入金明細の場合）"
              value={refundOf}
              onChange={setRefundOf}
            >
              <option value="">なし</option>
              {state.ledger.details
                .filter((d) => d.amount < 0)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.date} {d.description}
                  </option>
                ))}
            </Choice>
            <Text
              label="分類理由"
              value={reason}
              onChange={setReason}
              required
            />
            <Button type="submit">利用者の分類として保存</Button>
          </form>
        )}
      </Box>
    </>
  );
}
function Mapping({
  kind,
  source,
  initial,
  save,
}: {
  kind: "category" | "payment";
  source: string;
  initial: string;
  save: Command;
}) {
  const [target, set] = useState(initial);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save({ action: "mapping", kind, source, target });
      }}
    >
      <Text
        label={`${kind === "category" ? "カテゴリ" : "支払手段"}: ${source}${initial ? "" : "（未対応）"}`}
        value={target}
        onChange={set}
        required
      />
      <Button variant="secondary" type="submit">
        対応付けを保存
      </Button>
    </form>
  );
}
