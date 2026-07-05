import { WifiOff } from "lucide-react";
import { useIsOffline } from "../hooks/use-online-status";

/**
 * オフラインバナー（B-1）。navigator.onLine とフェッチ失敗を組み合わせて判定する
 * useIsOffline を購読し、通信不能時のみ非侵襲な帯として表示する。
 * 通常フロー内の要素として上部に挿入し、フルスクリーンのオーバーレイにはしない。
 */
export function OfflineBanner() {
  const isOffline = useIsOffline();

  if (!isOffline) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="offline-banner flex items-center justify-center gap-2 border-b border-line bg-surface-2 px-3 py-2 text-xs font-medium text-ink-2 sm:text-sm"
    >
      <WifiOff aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      オフラインです。通信が回復すると自動的に最新の状態に戻ります。
    </div>
  );
}
