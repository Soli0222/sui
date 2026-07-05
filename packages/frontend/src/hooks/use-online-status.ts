import { useSyncExternalStore } from "react";
import { getIsOffline, subscribeOffline } from "../lib/network-status";

function getServerSnapshot() {
  return false;
}

/** オフラインバナー用。navigator.onLine とフェッチ失敗の両方から更新される。 */
export function useIsOffline() {
  return useSyncExternalStore(subscribeOffline, getIsOffline, getServerSnapshot);
}
