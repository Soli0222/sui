import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { useAuth } from "../lib/auth";

const ERROR_MESSAGES: Record<string, string> = {
  allowlist_rejected: "このアカウントではログインできません。管理者に連絡してください。",
  oidc_callback_failed: "認証フローが無効になったか、期限切れです。もう一度お試しください。",
  oidc_discovery_failed: "認証サーバー（IdP）の接続に失敗しました。設定を確認してください。",
};

export function LoginPage() {
  const { configured, loading, error, login } = useAuth();
  const [searchParams] = useSearchParams();
  const authError = searchParams.get("auth_error");
  const errorMessage = authError ? (ERROR_MESSAGES[authError] ?? "認証に失敗しました。") : null;

  const help = useMemo(() => {
    if (error) {
      return (
        <p className="mt-4 text-sm text-critical">
          バックエンドに接続できません。ページを再読み込みするか、管理者に連絡してください。
        </p>
      );
    }
    if (configured) return null;
    return (
      <div className="mt-4 text-sm text-ink-2">
        <p>バックエンドに OIDC 設定が未完了です。</p>
        <ul className="mt-2 list-disc pl-5">
          <li>SUI_OIDC_ISSUER</li>
          <li>SUI_OIDC_CLIENT_ID</li>
          <li>SUI_OIDC_CLIENT_SECRET</li>
          <li>SUI_OIDC_REDIRECT_URI</li>
          <li>SUI_OIDC_ALLOWED_SUBJECTS または SUI_OIDC_ALLOWED_EMAILS</li>
        </ul>
      </div>
    );
  }, [configured, error]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-semibold">sui</h1>
        <p className="mt-2 text-sm text-ink-2">個人資産管理ツール</p>

        {errorMessage ? (
          <p className="mt-4 rounded-[var(--radius-s)] bg-critical/10 p-3 text-sm text-critical">
            {errorMessage}
          </p>
        ) : null}

        {error ? (
          <p className="mt-6 text-sm text-critical">バックエンドに接続できません</p>
        ) : configured ? (
          <Button className="mt-6 w-full" onClick={login}>
            IdP でログイン
          </Button>
        ) : (
          <p className="mt-6 text-sm text-warning">OIDC 設定が未完了です</p>
        )}

        {help}
      </Card>
    </div>
  );
}
