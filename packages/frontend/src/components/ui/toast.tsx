import * as ToastPrimitive from "@radix-ui/react-toast";
import { useToast } from "../../hooks/use-toast";
import { cn } from "../../lib/utils";

/**
 * トースト基盤。成功は 3 秒で自動クローズ、失敗は手動クローズのみ。
 * layout 直下に一度だけマウントする。
 */
export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <ToastPrimitive.Provider swipeDirection="right">
      {toasts.map((item) => (
        <ToastPrimitive.Root
          key={item.id}
          open
          duration={item.variant === "success" ? 3000 : Number.POSITIVE_INFINITY}
          onOpenChange={(open) => {
            if (!open) {
              dismiss(item.id);
            }
          }}
          className={cn(
            "grid grid-cols-[1fr_auto] items-start gap-x-3 rounded-[var(--radius-m)] border p-4 shadow-[var(--elev-1)]",
            item.variant === "success" ? "border-line bg-surface-1" : "border-critical/50 bg-surface-1",
          )}
        >
          <div className="grid gap-1 min-w-0">
            <ToastPrimitive.Title className="text-sm font-semibold text-ink">{item.title}</ToastPrimitive.Title>
            {item.description ? (
              <ToastPrimitive.Description className="text-sm text-ink-2">
                {item.description}
              </ToastPrimitive.Description>
            ) : null}
          </div>
          <ToastPrimitive.Close
            aria-label="閉じる"
            className="shrink-0 rounded-[var(--radius-s)] px-2 py-1 text-xs font-medium text-ink-3 transition hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            閉じる
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport
        aria-live="polite"
        className="fixed inset-x-3 bottom-3 z-[100] flex max-h-screen w-auto flex-col gap-2 outline-none sm:bottom-4 sm:left-auto sm:right-4 sm:w-full sm:max-w-sm"
      />
    </ToastPrimitive.Provider>
  );
}
