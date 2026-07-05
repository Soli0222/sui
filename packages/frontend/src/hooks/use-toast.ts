import { useEffect, useState } from "react";

export type ToastVariant = "success" | "error";

export type ToastItem = {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
};

type Listener = (toasts: ToastItem[]) => void;

let toasts: ToastItem[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) {
    listener(toasts);
  }
}

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function dismissToast(id: string) {
  toasts = toasts.filter((item) => item.id !== id);
  emit();
}

export function showToast(input: { title: string; description?: string; variant?: ToastVariant }) {
  const id = createId();
  toasts = [...toasts, { id, title: input.title, description: input.description, variant: input.variant ?? "success" }];
  emit();
  return id;
}

/**
 * 成功/失敗トーストの購読と発火。成功は 3 秒で自動クローズ、失敗は手動クローズ（<Toaster /> 側で制御）。
 */
export function useToast() {
  const [items, setItems] = useState(toasts);

  useEffect(() => {
    listeners.add(setItems);
    return () => {
      listeners.delete(setItems);
    };
  }, []);

  return { toasts: items, toast: showToast, dismiss: dismissToast };
}
