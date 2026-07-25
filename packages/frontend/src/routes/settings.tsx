import type { ApiTokenSummary, CreatedApiToken } from "@sui/shared";
import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { SwitchField } from "../components/ui/switch";
import { useToast } from "../hooks/use-toast";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth";

function formatDate(value: string | null) {
  if (!value) return "未使用";
  return new Date(value).toLocaleString("ja-JP");
}

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
