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
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "../components/ui/dialog";
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

const DEFAULT_UI_SETTINGS: UiSettingsResponse = {
  dashboardDefaultPeriod: "next3Months",
  transactionsDefaultPeriod: "last3Months",
};

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
  const [name, setName] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [created, setCreated] = useState<CreatedApiToken | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [uiSettings, setUiSettings] = useState<UiSettingsResponse>(DEFAULT_UI_SETTINGS);
  const [isSavingUiSettings, setIsSavingUiSettings] = useState(false);
  const uiSettingsChangedByUser = useRef(false);
  const savingUiSettings = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void apiFetch<UiSettingsResponse>("/api/settings")
      .then((settings) => {
        if (!cancelled && !uiSettingsChangedByUser.current) {
          setUiSettings(settings);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "設定の取得に失敗しました";
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
  }, []);

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

  const handleCreate = async () => {
    if (!name.trim()) return;
    setIsCreating(true);
    try {
      const token = await apiFetch<CreatedApiToken>("/api/auth/tokens", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), readOnly }),
      });
      setCreated(token);
      setTokens((current) => [token, ...current]);
      setName("");
      setReadOnly(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "発行に失敗しました";
      toast({ title: "トークン発行に失敗しました", description: message, variant: "error" });
    } finally {
      setIsCreating(false);
    }
  };

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

  const handleUiSettingChange = async (
    key: keyof UiSettingsResponse,
    value: DashboardPeriodPreset | TransactionDefaultPeriodPreset,
  ) => {
    if (savingUiSettings.current) return;

    const previousSettings = uiSettings;
    uiSettingsChangedByUser.current = true;
    savingUiSettings.current = true;
    setUiSettings({ ...previousSettings, [key]: value });
    setIsSavingUiSettings(true);

    try {
      const saved = await apiFetch<UiSettingsResponse>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ [key]: value }),
      });
      setUiSettings(saved);
      toast({ title: "表示の既定値を保存しました" });
    } catch (error) {
      setUiSettings(previousSettings);
      const message = error instanceof Error ? error.message : "保存に失敗しました";
      toast({
        title: "表示の既定値の保存に失敗しました",
        description: message,
        variant: "error",
      });
    } finally {
      savingUiSettings.current = false;
      setIsSavingUiSettings(false);
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

      <Card>
        <div className="grid gap-5">
          <div>
            <h3 className="text-lg font-semibold">表示の既定値</h3>
            <p className="text-sm text-ink-2">各画面を開いたときに選択する期間を設定します。</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="dashboard-default-period">
                ダッシュボードの表示期間
              </label>
              <Select
                id="dashboard-default-period"
                disabled={isSavingUiSettings}
                value={uiSettings.dashboardDefaultPeriod}
                onChange={(event) =>
                  void handleUiSettingChange(
                    "dashboardDefaultPeriod",
                    event.target.value as DashboardPeriodPreset,
                  )
                }
              >
                {dashboardDefaultPeriodOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="transactions-default-period">
                取引一覧の表示期間
              </label>
              <Select
                id="transactions-default-period"
                disabled={isSavingUiSettings}
                value={uiSettings.transactionsDefaultPeriod}
                onChange={(event) =>
                  void handleUiSettingChange(
                    "transactionsDefaultPeriod",
                    event.target.value as TransactionDefaultPeriodPreset,
                  )
                }
              >
                {transactionsDefaultPeriodOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold">API トークン</h3>
              <p className="text-sm text-ink-2">MCP など外部クライアント用のトークンを発行します。</p>
            </div>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button>トークンを発行</Button>
              </DialogTrigger>
              <DialogContent size="s">
                <DialogTitle>API トークンを発行</DialogTitle>
                <DialogDescription className="text-sm text-ink-2">
                  発行したトークンはこのダイアログでのみ表示されます。再表示はできません。
                </DialogDescription>

                {created ? (
                  <div className="grid gap-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium">トークン</label>
                      <div className="flex gap-2">
                        <Input readOnly value={created.token} className="font-mono text-xs" />
                        <Button variant="secondary" onClick={() => void copyToClipboard(created.token)}>
                          コピー
                        </Button>
                      </div>
                    </div>
                    <DialogClose asChild>
                      <Button onClick={() => { setCreated(null); setCreateOpen(false); }}>閉じる</Button>
                    </DialogClose>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium" htmlFor="token-name">用途</label>
                      <Input
                        id="token-name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="例: claude-mcp"
                      />
                    </div>
                    <SwitchField
                      label="読み取り専用"
                      help="POST/PUT/DELETE を禁止します"
                      checked={readOnly}
                      onChange={setReadOnly}
                    />
                    <Button disabled={!name.trim() || isCreating} onClick={() => void handleCreate()}>
                      {isCreating ? "発行中..." : "発行"}
                    </Button>
                  </div>
                )}
              </DialogContent>
            </Dialog>
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
    </div>
  );
}
