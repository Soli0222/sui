import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { useBlocker } from "react-router-dom";
import { ConfirmDialog } from "../ui/confirm-dialog";

type SessionGuard = { dirty: boolean; saving: boolean; discard: () => void };
type PendingTransition = { ids: string[]; action: () => void };
type EditingNavigation = {
  register: (id: string, guard: SessionGuard) => () => void;
  update: (id: string, guard: SessionGuard) => void;
  request: (action: () => void, id?: string) => void;
};

const Context = createContext<EditingNavigation | null>(null);

/** One router blocker owns all active editors, including editors on the same page. */
export function EditingNavigationProvider({ children }: PropsWithChildren) {
  const guards = useRef(new Map<string, SessionGuard>());
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState<PendingTransition | null>(null);
  const notify = useCallback(() => setRevision((value) => value + 1), []);

  const register = useCallback((id: string, guard: SessionGuard) => {
    guards.current.set(id, guard);
    notify();
    return () => {
      guards.current.delete(id);
      notify();
    };
  }, [notify]);
  const update = useCallback((id: string, guard: SessionGuard) => {
    guards.current.set(id, guard);
    notify();
  }, [notify]);

  const activeIds = useCallback((id?: string) => [...guards.current.entries()]
    .filter(([key, guard]) => (id === undefined || key === id) && guard.dirty)
    .map(([key]) => key), []);
  const isSaving = useCallback((id?: string) => [...guards.current.entries()]
    .some(([key, guard]) => (id === undefined || key === id) && guard.saving), []);

  const request = useCallback((action: () => void, id?: string) => {
    if (isSaving(id) || pending) return;
    const ids = activeIds(id);
    if (ids.length === 0) action();
    else setPending({ ids, action });
  }, [activeIds, isSaving, pending]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    (activeIds().length > 0 || isSaving()) &&
    (currentLocation.pathname !== nextLocation.pathname ||
      currentLocation.search !== nextLocation.search ||
      currentLocation.hash !== nextLocation.hash),
  );

  useEffect(() => {
    if (activeIds().length === 0 && !isSaving()) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [revision, activeIds, isSaving]);

  useEffect(() => {
    if (blocker.state === "blocked" && isSaving()) blocker.reset();
  }, [blocker, revision, isSaving]);

  const routeBlocked = blocker.state === "blocked";
  const cancel = () => {
    if (blocker.state === "blocked") blocker.reset();
    setPending(null);
  };
  const discard = () => {
    if (isSaving()) return;
    const ids = routeBlocked ? activeIds() : pending?.ids ?? [];
    ids.forEach((id) => guards.current.get(id)?.discard());
    const action = pending?.action;
    setPending(null);
    if (routeBlocked && blocker.state === "blocked") blocker.proceed();
    else action?.();
  };

  const value = useMemo(() => ({ register, update, request }), [register, update, request]);
  return (
    <Context.Provider value={value}>
      {children}
      <ConfirmDialog
        open={routeBlocked || pending !== null}
        onOpenChange={(open) => { if (!open) cancel(); }}
        title="未保存の変更を破棄しますか？"
        description="変更を破棄すると、入力した内容は失われます。"
        cancelLabel="編集を続ける"
        confirmLabel="変更を破棄"
        onConfirm={discard}
      />
    </Context.Provider>
  );
}

export function useEditingNavigation() {
  const context = useContext(Context);
  if (!context) throw new Error("useEditSession requires EditingNavigationProvider");
  return context;
}
