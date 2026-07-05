type Listener = () => void;

let offline = typeof navigator !== "undefined" && "onLine" in navigator ? !navigator.onLine : false;
const listeners = new Set<Listener>();

function setOffline(next: boolean) {
  if (offline === next) {
    return;
  }

  offline = next;
  for (const listener of listeners) {
    listener();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => setOffline(false));
  window.addEventListener("offline", () => setOffline(true));
}

/**
 * オフラインバナー（B-1）: `navigator.onLine` とフェッチ失敗を組み合わせて判定する。
 * `navigator.onLine` はブラウザによって不正確なことがあるため、実際のフェッチ失敗
 * （apiFetch の catch）でも offline とみなし、いずれかの応答成功で復帰させる。
 */
export function reportFetchFailure() {
  setOffline(true);
}

export function reportFetchSuccess() {
  setOffline(false);
}

export function subscribeOffline(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getIsOffline() {
  return offline;
}
