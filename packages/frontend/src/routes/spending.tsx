import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  Account,
  CreditCard,
  SpendingInput,
  SpendingResponse,
  SpendingRequest,
  SpendingSettings,
  SpendingImport,
} from "@sui/shared";
import { getDaysInYearMonth } from "@sui/shared";
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
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  step?: string;
  list?: string;
}) {
  return (
    <Field label={label}>
      <Input
        aria-label={label}
        type={type}
        step={step}
        list={list}
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
                審査のルールが未設定です。決裁する金額と承認期限、データ更新の目安を設定してください。
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
                    <details>
                      <summary className="cursor-pointer">計算の詳細</summary>
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
                onOpenRequest={() => setTab("requests")}
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
                    cards={cards}
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
          <details
            className="rounded-lg border border-line p-4"
            open={s.freshnessDays === null || s.fundingDays === null}
          >
            <summary className="cursor-pointer font-medium">
              データ更新と補正予算の詳細設定
            </summary>
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
          </details>
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
          <details
            className="rounded border border-line p-4"
            open={provider === "custom"}
          >
            <summary className="cursor-pointer">接続の詳細設定</summary>
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
          </details>
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
            list="spending-payments"
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
              list="spending-categories"
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
  cards,
  edit,
  command,
  review,
}: {
  request: SpendingRequest;
  state: SpendingResponse;
  accounts: Account[];
  cards: CreditCard[];
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
  const paymentName = (source: string) => {
    const link = state.ledger.paymentLinks?.[source];
    return link
      ? ((link.kind === "account" ? accounts : cards).find(
          (p) => p.id === link.id,
        )?.name ?? source)
      : source;
  };
  const candidates = state.ledger.details
    .filter((d) => !d.deletedAt && d.amount < 0 && !d.transfer && d.included)
    .sort((a, b) => {
      const score = (d: typeof a) =>
        (d.date === r.input.purchaseDate ? 2 : 0) +
        (paymentName(d.paymentSource) === r.input.payment ? 2 : 0) +
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
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="p-2">MFカテゴリ</th>
                <th className="p-2">月額予算</th>
                <th className="p-2">実績</th>
                <th className="p-2">購入予定・予測</th>
                <th className="p-2">見込み残額</th>
              </tr>
            </thead>
            <tbody>
              {applicable?.categories.map((c) => {
                const calc = calculations.find(
                  (v) => v.month === month && v.category === c.category,
                );
                return (
                  <tr key={c.category} className="border-t border-line">
                    <td className="p-2">{c.category}</td>
                    <td className="p-2 whitespace-nowrap">{yen(c.amount)}</td>
                    <td className="p-2 whitespace-nowrap">
                      {calc ? yen(calc.A) : "—"}
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      {calc ? yen(calc.R + calc.F) : "—"}
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      {calc ? (
                        <>
                          {yen(calc.remaining)}
                          {calc.missing.length > 0 && (
                            <span className="block text-xs text-ink-2">
                              参考値・データ不足
                            </span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <details>
          <summary className="cursor-pointer">カード仮定額との比較</summary>
          <p className="mt-2 text-sm text-ink-2">
            カード仮定額合計 {yen(cardTotal)}
            。MFの利用月とカードの引落月、投信積立・立替・現金払いなどにより差が生じます。通常予算と合算せず、仮定額も自動変更しません。
          </p>
        </details>
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
        <details>
          <summary className="cursor-pointer">改定履歴</summary>
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
        </details>
      </Box>
      <details className="rounded-lg border border-line p-5">
        <summary className="cursor-pointer font-medium">
          今後の支出予測を調整する
        </summary>
        <div className="mt-4">
          <ForecastPlanForm state={state} command={command} />
        </div>
      </details>
    </div>
  );
}
function ForecastPlanForm({
  state,
  command,
}: {
  state: SpendingResponse;
  command: Command;
}) {
  const [id, setId] = useState(""),
    [name, setName] = useState(""),
    [category, setCategory] = useState(""),
    [date, setDate] = useState(today()),
    [amount, setAmount] = useState(0),
    [reason, setReason] = useState("");
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void command({
          action: "plan",
          ...(id ? { id } : {}),
          name,
          category,
          date,
          month: date.slice(0, 7),
          amount,
          reason,
          type: "fixed",
        });
      }}
    >
      <p className="text-sm text-ink-2">
        金額が分かっている固定支出を登録します。発生月の予測に使用し、終了・取消は金額0で記録します。口座の残高予測には追加しません。
      </p>
      <Choice
        label="編集する予定"
        value={id}
        onChange={(v) => {
          setId(v);
          const p = state.ledger.plans.find((p) => p.id === v);
          if (p) {
            setName(p.name);
            setCategory(p.category);
            setDate(p.date);
            setAmount(p.amount);
            setReason(p.reason);
          }
        }}
      >
        <option value="">新規</option>
        {state.ledger.plans.map((p) => (
          <option key={p.id} value={p.id}>
            {p.month} {p.name}
          </option>
        ))}
      </Choice>
      <div className="grid gap-4 md:grid-cols-2">
        <Text label="予定名" value={name} onChange={setName} required />
        <Text
          label="予定のMFカテゴリ"
          list="spending-categories"
          value={category}
          onChange={setCategory}
          required
        />
        <Text
          label="発生日"
          type="date"
          value={date}
          onChange={setDate}
          required
        />
        <Text
          label="予定額（円）"
          type="number"
          value={amount}
          onChange={(v) => setAmount(Number(v))}
        />
      </div>
      <Text
        label="予測の変更理由"
        value={reason}
        onChange={setReason}
        required
      />
      <Button type="submit">予定を保存</Button>
    </form>
  );
}
function ImportPanel({
  state,
  run,
  command,
  onState,
  onOpenRequest,
  accounts,
  cards,
}: {
  state: SpendingResponse;
  run: (f: () => Promise<unknown>) => Promise<void>;
  command: Command;
  onState: (s: SpendingResponse) => void;
  onOpenRequest: () => void;
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
          <details>
            <summary className="cursor-pointer text-sm text-ink-2">
              対象月を判定できない空のCSVの場合
            </summary>
            <div className="mt-3">
              <Text
                label="空のCSVの対象月"
                type="month"
                value={fallback}
                onChange={setFallback}
              />
            </div>
          </details>
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
              <details>
                <summary className="cursor-pointer">
                  前回だけにある明細 {batch.removedIds.length}件
                </summary>
                {batch.removedIds.map((id) => {
                  const d = state.ledger.details.find((d) => d.id === id);
                  return (
                    <p key={id} className="text-sm">
                      {d?.date} {d?.description} {yen(d?.amount ?? null)} ·
                      今回の月次実績から除外
                    </p>
                  );
                })}
              </details>
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
        <details>
          <summary className="cursor-pointer">取込履歴</summary>
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
        </details>
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
          カテゴリはMFの値を表示します。修正はMFで行い、CSVを取り込み直してください。購入との紐づけは申請詳細から行えます。
        </p>
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                {[
                  "日付",
                  "内容",
                  "金額",
                  "MFカテゴリ",
                  "支払元",
                  "関連申請",
                ].map((t) => (
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
                        setOneOff(d.oneOff);
                        setFixedId(d.fixedId ?? "");
                        setRefundOf(d.refundOf ?? "");
                        setReason(d.classificationReason);
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
                  <td className="p-2">
                    {state.ledger.requests
                      .filter((r) =>
                        r.purchases.some((p) =>
                          p.reflected.some((ref) => ref.detailId === d.id),
                        ),
                      )
                      .map((r) => (
                        <Link
                          key={r.id}
                          className="block underline"
                          onClick={onOpenRequest}
                          to={`/spending?request=${encodeURIComponent(r.id)}`}
                        >
                          {r.input.name}
                        </Link>
                      ))}
                  </td>
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
          <div className="rounded border border-line p-4">
            <p className="font-medium">
              {state.ledger.details.find((d) => d.id === detail)?.description}
            </p>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm">
                審査用の補足（単発支出・固定予定・返金）
              </summary>
              <form
                className="mt-4 space-y-4"
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
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={oneOff}
                    onChange={(e) => setOneOff(e.target.checked)}
                  />
                  単発支出として今後の反復予測から除く
                </label>
                <Choice
                  label="対応する固定予定"
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
                  label="返金元の購入明細"
                  value={refundOf}
                  onChange={setRefundOf}
                >
                  <option value="">なし</option>
                  {all
                    .filter((d) => d.amount < 0)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.date} {d.description}
                      </option>
                    ))}
                </Choice>
                <Text
                  label="補足の理由"
                  value={reason}
                  onChange={setReason}
                  required
                />
                <Button type="submit">補足を保存</Button>
              </form>
            </details>
          </div>
        )}
      </Box>
      <details className="rounded-lg border border-line p-5">
        <summary className="cursor-pointer font-medium">
          支払元とsuiのカード・口座を紐づける（任意）
        </summary>
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
      </details>
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
