import type { Account, ForecastEvent } from "@sui/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEditingNavigation } from "../components/editing/editing-navigation";
import { useToast } from "./use-toast";
import { apiFetch } from "../lib/api";
import { formatCurrencyInputValue } from "../lib/format";
import { confirmationAmount, createConfirmationDraft, isConfirmationStale, type ConfirmationDraft } from "../routes/dashboard-confirmation";

function getDefaultConfirmAccountId(event: ForecastEvent, accounts: Account[]) {
  const fallbackAccount = accounts.find((account) => account.currencyCode === event.currencyCode);
  return event.accountId ?? fallbackAccount?.id ?? "";
}

export function createOverdueConfirmDraft(event: ForecastEvent, accounts: Account[]): ConfirmationDraft {
  return createConfirmationDraft(event, getDefaultConfirmAccountId(event, accounts));
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "確定に失敗しました。";
}

export function useDashboardConfirmation({ accounts, overdueForecast, refreshForecast, setRefreshError }: {
  accounts: Account[];
  overdueForecast: ForecastEvent[];
  refreshForecast: () => Promise<void>;
  setRefreshError: (error: string | null) => void;
}) {
  const { toast } = useToast();
  const navigation = useEditingNavigation();
  const batchSubmitting = useRef(false);
  const confirmedEventIds = useRef(new Set<string>());
  const [manualSelectedEvent, setManualSelectedEvent] = useState<ForecastEvent | null>(null);
  const [isQueueCollapsed, setIsQueueCollapsed] = useState(false);
  const [overdueDrafts, setOverdueDrafts] = useState<Record<string, ConfirmationDraft>>({});
  const discardOverdue = useCallback(() => setOverdueDrafts({}), []);
  const [hiddenOverdueIds, setHiddenOverdueIds] = useState<string[]>([]);
  const [optimisticConfirmedIds, setOptimisticConfirmedIds] = useState<string[]>([]);
  const [isBatchConfirming, setIsBatchConfirming] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const confirmSubmitting = useRef(false);
  const [confirmDraft, setConfirmDraft] = useState<{ eventId: string; amountRaw: string; accountId: string } | null>(null);
  const visibleOverdueForecast = overdueForecast.filter((event) => !hiddenOverdueIds.includes(event.id));
  const overdueDirty = Object.entries(overdueDrafts).some(([id, draft]) => {
    const event = overdueForecast.find((entry) => entry.id === id);
    if (!event) return true;
    const initial = createOverdueConfirmDraft(event, accounts);
    return draft.selected !== initial.selected || draft.amountRaw !== initial.amountRaw || draft.accountId !== initial.accountId;
  });
  useEffect(() => navigation.register("dashboard-overdue", { dirty: false, saving: false, discard: discardOverdue }),
    [navigation, discardOverdue]);
  useEffect(() => navigation.update("dashboard-overdue", { dirty: overdueDirty, saving: isBatchConfirming, discard: discardOverdue }),
    [navigation, overdueDirty, isBatchConfirming, discardOverdue]);
  const selectedEvent = manualSelectedEvent;
  const defaultAccountId = selectedEvent ? getDefaultConfirmAccountId(selectedEvent, accounts) : "";
  const activeDraft = confirmDraft?.eventId === selectedEvent?.id ? confirmDraft : null;
  const confirmRaw = activeDraft?.amountRaw ?? (selectedEvent ? formatCurrencyInputValue(selectedEvent.amount, selectedEvent.currencyCode) : "");
  const confirmAmount = selectedEvent ? confirmationAmount(confirmRaw, selectedEvent.currencyCode) : null;
  const accountId = activeDraft?.accountId ?? defaultAccountId;
  const selectedOverdueEvents = visibleOverdueForecast.filter(
    (event) => !optimisticConfirmedIds.includes(event.id) && (overdueDrafts[event.id]?.selected ?? true),
  );
  const selectedOverdueCount = selectedOverdueEvents.length;
  const staleOverdueIds = Object.keys(overdueDrafts).filter((id) =>
    !optimisticConfirmedIds.includes(id) && (!overdueForecast.some((event) => event.id === id) ||
      overdueForecast.some((event) => event.id === id && isConfirmationStale(overdueDrafts[id], event))));
  const updateConfirmDraft = (draft: { amountRaw?: string; accountId?: string }) => {
    if (!selectedEvent) {
      return;
    }

    setConfirmDraft({
      eventId: selectedEvent.id,
      amountRaw: draft.amountRaw ?? confirmRaw,
      accountId: draft.accountId ?? accountId,
    });
  };

  const updateOverdueDraft = (
    event: ForecastEvent,
    draft: Partial<Omit<ConfirmationDraft, "error">>,
  ) => {
    setOverdueDrafts((current) => {
      const existing = current[event.id] ?? createOverdueConfirmDraft(event, accounts);

      return {
        ...current,
        [event.id]: {
          ...existing,
          ...draft,
          error: undefined,
        },
      };
    });
  };

  const openConfirm = (event: ForecastEvent) => {
    if (optimisticConfirmedIds.includes(event.id)) {
      return;
    }

    setManualSelectedEvent(event);
    setConfirmDraft({
      eventId: event.id,
      amountRaw: formatCurrencyInputValue(event.amount, event.currencyCode),
      accountId: getDefaultConfirmAccountId(event, accounts),
    });
  };

  const closeConfirm = () => {
    setManualSelectedEvent(null);
    setConfirmDraft(null);
  };

  const handleConfirm = async () => {
    if (!selectedEvent || confirmSubmitting.current || confirmedEventIds.current.has(selectedEvent.id)) {
      return;
    }
    if (confirmAmount === null) {
      toast({ title: "実際の金額を確認してください", variant: "error" });
      return;
    }

    const event = selectedEvent;
    const amount = confirmAmount;
    const targetAccountId = accountId;

    confirmSubmitting.current = true;
    setIsConfirming(true);
    setOptimisticConfirmedIds((ids) => [...ids, event.id]);

    try {
      await apiFetch("/api/dashboard/confirm", {
        method: "POST",
        body: JSON.stringify({
          forecastEventId: event.id,
          amount,
          accountId: event.type === "transfer" ? undefined : targetAccountId || undefined,
        }),
      });
      confirmedEventIds.current.add(event.id);

      setManualSelectedEvent((current) => current?.id === event.id ? null : current);
      setConfirmDraft((current) => current?.eventId === event.id ? null : current);
      toast({ title: "確定しました", description: event.description, variant: "success" });
      try {
        await refreshForecast();
      } catch (error) {
        setRefreshError(`確定は保存されましたが表示を更新できませんでした: ${getErrorMessage(error)}`);
      }
    } catch (error) {
      setOptimisticConfirmedIds((ids) => ids.filter((id) => id !== event.id));
      toast({ title: "確定に失敗しました", description: getErrorMessage(error), variant: "error" });
    } finally {
      setIsConfirming(false);
      confirmSubmitting.current = false;
    }
  };

  const handleBatchConfirm = async () => {
    if (selectedOverdueEvents.length === 0 || batchSubmitting.current) {
      return;
    }

    batchSubmitting.current = true;
    setIsBatchConfirming(true);
    const confirmedIds: string[] = [];
    const failedById = new Map<string, string>();

    for (const event of selectedOverdueEvents) {
      if (confirmedEventIds.current.has(event.id)) continue;
      const draft = overdueDrafts[event.id] ?? createOverdueConfirmDraft(event, accounts);
      const amount = confirmationAmount(draft.amountRaw, event.currencyCode);
      if (isConfirmationStale(draft, event)) {
        failedById.set(event.id, "予定が変更されました。金額と口座を確認してください。");
        continue;
      }
      if (amount === null) {
        failedById.set(event.id, "実際の金額を入力してください。");
        continue;
      }

      try {
        await apiFetch("/api/dashboard/confirm", {
          method: "POST",
          body: JSON.stringify({
            forecastEventId: event.id,
            amount,
            accountId: event.type === "transfer" ? undefined : draft.accountId || undefined,
          }),
        });
        confirmedEventIds.current.add(event.id);
        confirmedIds.push(event.id);
      } catch (error) {
        failedById.set(event.id, getErrorMessage(error));
      }
    }

    setOverdueDrafts((current) => {
      const next = { ...current };

      for (const eventId of confirmedIds) {
        delete next[eventId];
      }

      for (const [eventId, error] of failedById) {
        const event = overdueForecast.find((item) => item.id === eventId);
        const existing = current[eventId] ?? (event ? createOverdueConfirmDraft(event, accounts) : null);
        if (existing) {
          next[eventId] = {
            ...existing,
            selected: true,
            error,
          };
        }
      }

      return next;
    });
    setHiddenOverdueIds((ids) => Array.from(new Set([...ids, ...confirmedIds])));
    setOptimisticConfirmedIds((ids) => Array.from(new Set([...ids, ...confirmedIds])));
    setIsBatchConfirming(false);
    batchSubmitting.current = false;

    if (confirmedIds.length > 0) {
      toast({
        title: `${confirmedIds.length} 件を確定しました`,
        description: failedById.size > 0 ? `${failedById.size} 件は失敗しました。` : undefined,
        variant: failedById.size > 0 ? "error" : "success",
      });
    } else {
      toast({
        title: "確定に失敗しました",
        description: `${failedById.size} 件のエラーを確認してください。`,
        variant: "error",
      });
    }

    if (confirmedIds.length > 0) {
      try {
        await refreshForecast();
      } catch (error) {
        setRefreshError(`確定は保存されましたが表示を更新できませんでした: ${getErrorMessage(error)}`);
      }
    }
  };

  return { selectedEvent, isQueueCollapsed, setIsQueueCollapsed, overdueDrafts, setOverdueDrafts,
    visibleOverdueForecast, optimisticConfirmedIds, isBatchConfirming, isConfirming, staleOverdueIds,
    selectedOverdueCount, confirmRaw, confirmAmount, accountId, updateConfirmDraft, updateOverdueDraft,
    openConfirm, closeConfirm, handleConfirm, handleBatchConfirm };
}
