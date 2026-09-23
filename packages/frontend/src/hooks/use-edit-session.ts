import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useEditingNavigation } from "../components/editing/editing-navigation";

export type EditErrors = Record<string, string>;
export type EditStatus = "idle" | "dirty" | "saving" | "error" | "saved" | "refreshing" | "refresh-error";

type State<T> = {
  identity: string;
  snapshot: T;
  draft: T;
  status: EditStatus;
  errors: EditErrors;
  error: string | null;
};

export function useEditSession<T>({
  identity,
  initial,
  validate,
  equal = (a, b) => JSON.stringify(a) === JSON.stringify(b),
}: {
  identity: string;
  initial: T;
  validate?: (draft: T) => EditErrors;
  equal?: (a: T, b: T) => boolean;
}) {
  const id = useId();
  const navigation = useEditingNavigation();
  const [state, setState] = useState<State<T>>(() => ({ identity, snapshot: initial, draft: initial, status: "idle", errors: {}, error: null }));
  const [refresh, setRefresh] = useState<(() => Promise<T>) | null>(null);
  const savingRef = useRef(false);
  const refreshRef = useRef(false);
  const generationRef = useRef(0);

  // A new target/operation starts a separate session. New server data for the same identity
  // never replaces a draft, even when a resource refresh completes during editing.
  if (state.identity !== identity) {
    generationRef.current += 1;
    savingRef.current = false;
    refreshRef.current = false;
    setState({ identity, snapshot: initial, draft: initial, status: "idle", errors: {}, error: null });
    setRefresh(null);
  }

  const current = state.identity === identity ? state : { identity, snapshot: initial, draft: initial, status: "idle" as EditStatus, errors: {}, error: null };
  const dirty = !equal(current.snapshot, current.draft);
  const discard = useCallback(() => {
    setState((previous) => ({ ...previous, draft: previous.snapshot, status: "idle", errors: {}, error: null }));
    setRefresh(null);
  }, []);

  useEffect(() => navigation.register(id, { dirty: false, saving: false, discard }), [navigation, id, discard]);
  useEffect(() => navigation.update(id, { dirty, saving: savingRef.current || refreshRef.current, discard }), [navigation, id, dirty, current.status, discard]);

  const setDraft = useCallback((value: T | ((previous: T) => T)) => {
    if (savingRef.current || refreshRef.current) return;
    setState((previous) => previous.status === "refresh-error" ? previous : ({
      ...previous,
      draft: typeof value === "function" ? (value as (previous: T) => T)(previous.draft) : value,
      status: "dirty",
      error: null,
    }));
  }, []);

  const refreshSaved = useCallback(async (loader: () => Promise<T>) => {
    if (refreshRef.current) return false;
    refreshRef.current = true;
    const generation = generationRef.current;
    setState((previous) => ({ ...previous, status: "refreshing", error: null }));
    try {
      const loaded = await loader();
      if (generation !== generationRef.current) return false;
      setState((previous) => ({ ...previous, snapshot: loaded, draft: loaded, status: "saved", error: null }));
      navigation.update(id, { dirty: false, saving: false, discard });
      setRefresh(null);
      return true;
    } catch (error) {
      if (generation !== generationRef.current) return false;
      setState((previous) => ({ ...previous, status: "refresh-error", error: error instanceof Error ? error.message : "表示の更新に失敗しました" }));
      navigation.update(id, { dirty: false, saving: false, discard });
      return false;
    } finally {
      if (generation === generationRef.current) refreshRef.current = false;
    }
  }, [navigation, id, discard]);

  const save = useCallback(async (
    mutate: (draft: T) => Promise<unknown>,
    reload?: () => Promise<T>,
  ) => {
    if (savingRef.current || refreshRef.current || current.status === "refresh-error" ||
      (current.status === "saved" && !dirty)) return false;
    const generation = generationRef.current;
    const errors = validate?.(current.draft) ?? {};
    if (Object.keys(errors).length > 0) {
      setState((previous) => ({ ...previous, errors, status: "error", error: "入力内容を確認してください" }));
      return false;
    }
    savingRef.current = true;
    setState((previous) => ({ ...previous, status: "saving", errors: {}, error: null }));
    try {
      await mutate(current.draft);
    } catch (error) {
      if (generation !== generationRef.current) return false;
      setState((previous) => ({ ...previous, status: "error", error: error instanceof Error ? error.message : "保存に失敗しました" }));
      savingRef.current = false;
      return false;
    }
    if (generation !== generationRef.current) return false;
    savingRef.current = false;
    setState((previous) => ({ ...previous, snapshot: current.draft, draft: current.draft, status: "saved", error: null }));
    if (reload) {
      navigation.update(id, { dirty: false, saving: true, discard });
      setRefresh(() => reload);
      return refreshSaved(reload);
    }
    navigation.update(id, { dirty: false, saving: false, discard });
    return true;
  }, [current.draft, current.status, dirty, refreshSaved, validate, navigation, id, discard]);

  const retryRefresh = useCallback(() => refresh ? refreshSaved(refresh) : Promise.resolve(false), [refresh, refreshSaved]);
  const requestClose = useCallback((close: () => void) => navigation.request(close, id), [navigation, id]);
  const requestTransition = requestClose;

  return { ...current, dirty, status: current.status === "dirty" && !dirty ? "idle" as EditStatus : current.status,
    setDraft, discard, save, retryRefresh, requestClose, requestTransition };
}
