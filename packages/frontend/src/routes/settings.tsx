import type {
  ApiTokenSummary,
  CreatedApiToken,
  DashboardPeriodPreset,
  TransactionDefaultPeriodPreset,
  UiSettingsResponse,
} from "@sui/shared";
import { useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { EditShell, type EditChange } from "../components/editing/edit-surface";
import { EditModal } from "../components/editing/edit-surface";
import { FormField } from "../components/ui/form-field";
import { useEditSession, type EditErrors } from "../hooks/use-edit-session";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { SwitchField } from "../components/ui/switch";
import { useToast } from "../hooks/use-toast";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth";

function formatDate(value: string | null) {
  if (!value) return "未使用";
  return new Date(value).toLocaleString("ja-JP");
}

const dashboardDefaultPeriodOptions: Array<{
  value: DashboardPeriodPreset;
  label: string;
}> = [
  { value: "next1Month", label: "1ヶ月" },
  { value: "next3Months", label: "3ヶ月" },
  { value: "next6Months", label: "6ヶ月" },
  { value: "next1Year", label: "1年" },
  { value: "all", label: "全期間" },
];

const transactionsDefaultPeriodOptions: Array<{
  value: TransactionDefaultPeriodPreset;
  label: string;
}> = [
  { value: "thisMonth", label: "当月" },
  { value: "lastMonth", label: "先月" },
  { value: "last3Months", label: "過去3ヶ月" },
  { value: "last6Months", label: "過去6ヶ月" },
  { value: "last1Year", label: "過去1年" },
  { value: "all", label: "全期間" },
];

export function SettingsPage() {
  const { logout } = useAuth();
  const { toast } = useToast();
  const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<CreatedApiToken | null>(null);
  const [uiSettings, setUiSettings] = useState<UiSettingsResponse | null>(null);
  const [uiSettingsError, setUiSettingsError] = useState<string | null>(null);
  const [settingsReloadKey, setSettingsReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void apiFetch<UiSettingsResponse>("/api/settings")
      .then((settings) => {
        if (!cancelled) {
          setUiSettings(settings);
          setUiSettingsError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "設定の取得に失敗しました";
          setUiSettingsError(message);
          toast({
            title: "表示の既定値の取得に失敗しました",
            description: message,
            variant: "error",
          });
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsReloadKey]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const list = await apiFetch<ApiTokenSummary[]>("/api/auth/tokens");
        if (!cancelled) {
          setTokens(list);
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "一覧の取得に失敗しました";
          toast({ title: "エラー", description: message, variant: "error" });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRevoke = async (id: string) => {
    if (!confirm("このトークンを失効しますか？失効後は元に戻せません。")) return;
    try {
      await apiFetch(`/api/auth/tokens/${id}`, { method: "DELETE" });
      setTokens((current) => current.filter((token) => token.id !== id));
      toast({ title: "トークンを失効しました" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "失効に失敗しました";
      toast({ title: "トークン失効に失敗しました", description: message, variant: "error" });
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "クリップボードにコピーしました" });
    } catch {
      toast({ title: "コピーに失敗しました", variant: "error" });
    }
  };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold sm:text-3xl">設定</h2>
          <p className="mt-2 text-sm text-ink-2">認証と API トークンを管理します。</p>
        </div>
        <Button variant="secondary" onClick={() => void logout()}>
          ログアウト
        </Button>
      </div>

      {uiSettings ? <SettingsPeriodEditor initial={uiSettings} /> : <Card>
        <h3 className="text-lg font-semibold">表示の既定値</h3>
        {uiSettingsError ? <p role="alert" className="mt-2 text-sm text-critical">{uiSettingsError}</p> : <p className="mt-2 text-sm text-ink-2">読み込み中...</p>}
        {uiSettingsError ? <Button className="mt-3" variant="secondary" onClick={() => setSettingsReloadKey((value) => value + 1)}>再試行</Button> : null}
      </Card>}

      <Card>
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold">API トークン</h3>
              <p className="text-sm text-ink-2">MCP など外部クライアント用のトークンを発行します。</p>
            </div>
            <Button onClick={() => setCreateOpen(true)}>トークンを発行</Button>
          </div>

          {loading ? (
            <p className="text-sm text-ink-2">読み込み中...</p>
          ) : tokens.length === 0 ? (
            <p className="text-sm text-ink-2">トークンはまだ発行されていません。</p>
          ) : (
            <div className="grid gap-3">
              {tokens.map((token) => (
                <div
                  key={token.id}
                  className="flex flex-col gap-2 rounded-[var(--radius-s)] border border-line bg-surface-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="font-medium">{token.name}</div>
                    <div className="text-xs text-ink-3">
                      {token.readOnly ? "読み取り専用" : "読み書き"} · 最終使用: {formatDate(token.lastUsedAt)} · 作成: {formatDate(token.createdAt)}
                    </div>
                  </div>
                  <Button variant="danger" className="self-start sm:self-auto" onClick={() => void handleRevoke(token.id)}>
                    失効
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
      {createOpen ? <TokenIssueModal onClose={() => setCreateOpen(false)} onCreated={(token, list) => { setTokens((current) => list ?? [token, ...current]); setCreateOpen(false); setCreated(token); }} /> : null}
      <Dialog open={Boolean(created)} onOpenChange={(open) => { if (!open) setCreated(null); }}>
        <DialogContent size="s">
          <DialogTitle>発行した API トークン</DialogTitle>
          <DialogDescription className="text-sm text-ink-2">この画面を閉じると再表示できません。必要な場所にコピーしてください。</DialogDescription>
          {created ? <div className="grid gap-4">
            <div><label className="mb-1 block text-sm font-medium" htmlFor="created-token">トークン</label>
              <div className="flex gap-2"><Input id="created-token" readOnly value={created.token} className="font-mono text-xs" />
                <Button variant="secondary" onClick={() => void copyToClipboard(created.token)}>コピー</Button></div></div>
            <DialogClose asChild><Button onClick={() => setCreated(null)}>閉じる</Button></DialogClose>
          </div> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SettingsPeriodEditor({ initial }: { initial: UiSettingsResponse }) {
  const { toast } = useToast();
  const session = useEditSession({ identity: "settings:display-periods", initial });
  const draft = session.draft;
  const busy = session.status === "saving" || session.status === "refreshing";
  const optionLabel = (value: string, options: Array<{ value: string; label: string }>) => options.find((item) => item.value === value)?.label ?? value;
  const changes: EditChange[] = [];
  if (session.snapshot.dashboardDefaultPeriod !== draft.dashboardDefaultPeriod) changes.push({
    label: "ダッシュボードの表示期間", before: optionLabel(session.snapshot.dashboardDefaultPeriod, dashboardDefaultPeriodOptions),
    after: optionLabel(draft.dashboardDefaultPeriod, dashboardDefaultPeriodOptions),
  });
  if (session.snapshot.transactionsDefaultPeriod !== draft.transactionsDefaultPeriod) changes.push({
    label: "取引一覧の表示期間", before: optionLabel(session.snapshot.transactionsDefaultPeriod, transactionsDefaultPeriodOptions),
    after: optionLabel(draft.transactionsDefaultPeriod, transactionsDefaultPeriodOptions),
  });
  const save = async () => {
    const saved = await session.save(
      (value) => apiFetch<UiSettingsResponse>("/api/settings", { method: "PUT", body: JSON.stringify(value) }),
      () => apiFetch<UiSettingsResponse>("/api/settings"),
    );
    if (saved) toast({ title: "表示の既定値を保存しました" });
  };
  return <Card className="!p-0">
    <EditShell subjectType="設定" subjectName="表示の既定値" title="表示の既定値" mode="edit" status={session.status}
      changes={changes} error={session.error} impact="保存後、新しく開く画面の初期表示期間に反映されます。"
      onCancel={() => session.requestClose(session.discard)} onSave={() => void save()} onRetryRefresh={() => void session.retryRefresh()} saveLabel="変更を保存" saveDisabled={!session.dirty}>
      <p className="mb-4 text-sm text-ink-2">2項目をまとめて保存します。</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="ダッシュボードの表示期間" htmlFor="dashboard-default-period">
          <Select id="dashboard-default-period" disabled={busy || session.status === "refresh-error"} value={draft.dashboardDefaultPeriod}
            onChange={(event) => session.setDraft({ ...draft, dashboardDefaultPeriod: event.target.value as DashboardPeriodPreset })}>
            {dashboardDefaultPeriodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </FormField>
        <FormField label="取引一覧の表示期間" htmlFor="transactions-default-period">
          <Select id="transactions-default-period" disabled={busy || session.status === "refresh-error"} value={draft.transactionsDefaultPeriod}
            onChange={(event) => session.setDraft({ ...draft, transactionsDefaultPeriod: event.target.value as TransactionDefaultPeriodPreset })}>
            {transactionsDefaultPeriodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </FormField>
      </div>
    </EditShell>
  </Card>;
}

type TokenDraft = { name: string; readOnly: boolean };
function TokenIssueModal({ onClose, onCreated }: { onClose: () => void; onCreated: (token: CreatedApiToken, list: ApiTokenSummary[] | null) => void }) {
  const { toast } = useToast();
  const issuedTokenRef = useRef<CreatedApiToken | null>(null);
  const refreshedTokensRef = useRef<ApiTokenSummary[] | null>(null);
  const session = useEditSession<TokenDraft>({ identity: "new-api-token", initial: { name: "", readOnly: false },
    validate: (draft): EditErrors => draft.name.trim() ? {} : { name: "用途を入力してください" }, fieldIds: { name: "token-name" } });
  const draft = session.draft;
  const save = async () => {
    const ok = await session.save(async (value) => {
      issuedTokenRef.current = await apiFetch<CreatedApiToken>("/api/auth/tokens", { method: "POST", body: JSON.stringify({ name: value.name.trim(), readOnly: value.readOnly }) });
    }, async () => {
      refreshedTokensRef.current = await apiFetch<ApiTokenSummary[]>("/api/auth/tokens");
      return draft;
    });
    if (ok && issuedTokenRef.current) { toast({ title: "トークンを発行しました" }); onCreated(issuedTokenRef.current, refreshedTokensRef.current); }
  };
  return <EditModal open subjectType="API トークン" subjectName="API トークン" mode="create" status={session.status}
    error={session.error} saveLabel="トークンを発行" impact="発行後の秘密値は一度だけ表示します。用途と権限は後から変更できません。"
    changes={draft.name.trim() ? [{ label: "用途", before: "未入力", after: draft.name.trim() },
      { label: "権限", before: "読み書き", after: draft.readOnly ? "読み取り専用" : "読み書き" }] : []}
    onRequestClose={() => session.requestClose(() => issuedTokenRef.current ? onCreated(issuedTokenRef.current, refreshedTokensRef.current) : onClose())} onSave={() => void save()}
    onRetryRefresh={() => void session.retryRefresh().then((ok) => { if (ok && issuedTokenRef.current) onCreated(issuedTokenRef.current, refreshedTokensRef.current); })}>
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <FormField label="用途" htmlFor="token-name" required error={session.errors.name}>
        <Input id="token-name" value={draft.name} onChange={(event) => session.setDraft({ ...draft, name: event.target.value })} placeholder="例: claude-mcp" />
      </FormField>
      <SwitchField label="読み取り専用" help="POST/PUT/DELETE を禁止します" checked={draft.readOnly}
        onChange={(readOnly) => session.setDraft({ ...draft, readOnly })} />
      <button type="submit" className="sr-only" aria-hidden="true" tabIndex={-1}>発行</button>
    </form>
  </EditModal>;
}
