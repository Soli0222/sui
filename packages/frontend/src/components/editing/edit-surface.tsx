import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Button, IconButton } from "../ui/button";
import { cn } from "../../lib/utils";
import type { EditStatus } from "../../hooks/use-edit-session";

export type EditChange = { label: string; before: ReactNode; after: ReactNode };
export type EditShellProps = {
  subjectType: string;
  subjectName: string;
  title?: string;
  mode: "create" | "edit" | "schedule" | "correct" | "record" | "detail";
  status: EditStatus;
  changes?: EditChange[];
  impact?: ReactNode;
  error?: string | null;
  saveLabel?: string;
  saveDisabled?: boolean;
  onCancel: () => void;
  onSave?: () => void;
  onRetryRefresh?: () => void;
  children: ReactNode;
  modal?: boolean;
  className?: string;
};

const actionLabels: Record<EditShellProps["mode"], string> = {
  create: "追加する", edit: "変更を保存", schedule: "変更を予約", correct: "訂正を保存", record: "記録する", detail: "",
};

export function EditShell({ subjectType, subjectName, title: titleOverride, mode, status, changes = [], impact, error,
  saveLabel, saveDisabled = false, onCancel, onSave, onRetryRefresh, children, modal = false, className }: EditShellProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);
  const title = titleOverride ?? (mode === "detail" ? subjectName : mode === "create" ? `${subjectType}を追加` : `${subjectName}を${mode === "record" ? "記録" : "編集"}`);
  const busy = status === "saving" || status === "refreshing";
  const statusText: Record<EditStatus, string> = {
    idle: "変更なし", dirty: "未保存の変更", saving: "保存中", error: "保存できませんでした",
    saved: "保存済み", refreshing: "保存済み・表示更新中", "refresh-error": "保存済み・表示更新失敗",
  };
  const Heading = modal ? DialogTitle : "h2";
  return (
    <section className={cn("edit-shell flex min-h-0 flex-col overflow-hidden bg-surface-1", className)} aria-labelledby={headingId}>
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <p className="text-xs text-ink-3">{subjectType}</p>
          <Heading id={headingId} ref={headingRef} tabIndex={-1} className="mt-1 break-words text-lg font-semibold outline-none">{title}</Heading>
          {mode !== "detail" && <p role="status" className="mt-1 text-xs text-ink-2">{statusText[status]}</p>}
        </div>
        <IconButton aria-label="閉じる" onClick={onCancel} disabled={busy}>×</IconButton>
      </header>
      <div className="edit-shell-body min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
        {children}
      </div>
      <footer className="shrink-0 border-t border-line bg-surface-1 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
        {changes.length > 0 && <div className="mb-2 max-h-[min(18vh,8rem)] overflow-y-auto text-sm">
          <p className="font-medium">今回の変更</p>
          <dl className="mt-1 grid gap-1 text-ink-2">{changes.map((change) => <div key={change.label} className="flex min-w-0 flex-wrap gap-x-2"><dt>{change.label}:</dt><dd className="break-all">{change.before} → {change.after}</dd></div>)}</dl>
        </div>}
        {impact && <p className="mb-2 text-xs text-ink-2">{impact}</p>}
        {error && <p role="alert" className="mb-2 text-sm text-critical">{error}</p>}
        {status === "refresh-error" && onRetryRefresh && <Button type="button" variant="secondary" className="mb-2" onClick={onRetryRefresh}>表示を再取得</Button>}
        <div className="flex items-center justify-between gap-3">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>{mode === "detail" ? "閉じる" : "キャンセル"}</Button>
          {mode !== "detail" && <Button type="button" onClick={onSave} disabled={busy || status === "refresh-error" || saveDisabled}>{saveLabel ?? actionLabels[mode]}</Button>}
        </div>
      </footer>
    </section>
  );
}

function restoreFocus(origin?: RefObject<HTMLElement | null>, fallback?: RefObject<HTMLElement | null>) {
  const target = origin?.current?.isConnected ? origin.current : fallback?.current;
  target?.focus();
}

export function EditModal({ open, onRequestClose, originRef, fallbackFocusRef, ...shell }: Omit<EditShellProps, "modal" | "onCancel"> & {
  open: boolean; onRequestClose: () => void;
  originRef?: RefObject<HTMLElement | null>; fallbackFocusRef?: RefObject<HTMLElement | null>;
}) {
  const capturedOrigin = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) capturedOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [open]);
  return <Dialog open={open} onOpenChange={(next) => { if (!next) onRequestClose(); }}>
    <DialogContent size="m" className="!flex !max-h-[calc(100dvh-1rem)] !flex-col !overflow-hidden !p-0 sm:!max-h-[min(90dvh,56rem)]"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        (event.currentTarget as HTMLElement).querySelector<HTMLElement>("h2")?.focus();
      }}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        restoreFocus(originRef ?? { current: capturedOrigin.current }, fallbackFocusRef);
      }}>
      <EditShell {...shell} modal onCancel={onRequestClose} className="max-h-[calc(100dvh-1rem)] sm:max-h-[min(90dvh,56rem)]" />
    </DialogContent>
  </Dialog>;
}

export function EditPanelLayout({ children, open, onRequestClose, originRef, fallbackFocusRef, editor }: {
  children: ReactNode; open: boolean; onRequestClose: () => void;
  originRef?: RefObject<HTMLElement | null>; fallbackFocusRef?: RefObject<HTMLElement | null>;
  editor: Omit<EditShellProps, "modal" | "onCancel">;
}) {
  const wasOpen = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setCompact(element.clientWidth < 1096));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (open && compact && document.activeElement instanceof HTMLElement &&
      !panelRef.current?.contains(document.activeElement)) {
      panelRef.current?.querySelector<HTMLElement>("h2")?.focus();
    }
  }, [open, compact]);
  useEffect(() => {
    if (wasOpen.current && !open) restoreFocus(originRef, fallbackFocusRef);
    wasOpen.current = open;
  }, [open, originRef, fallbackFocusRef]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        onRequestClose();
      }
      if (event.key === "Tab" && compact && panelRef.current) {
        const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || active === panelRef.current.querySelector("h2"))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (active === last || !panelRef.current.contains(active))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, compact, onRequestClose]);
  return <div className="edit-panel-container" ref={containerRef}>
    <div className={cn("edit-panel-layout", open && "edit-panel-layout-open")}>
      <div className="edit-panel-main min-w-0" inert={open && compact} aria-hidden={open && compact}>{children}</div>
      {open && <aside ref={panelRef} className="edit-panel" aria-label={`${editor.subjectName}の編集`}>
        <EditShell {...editor} onCancel={onRequestClose} className="h-full" />
      </aside>}
    </div>
  </div>;
}

export function EditPage({ onRequestClose, originRef, fallbackFocusRef, ...shell }: Omit<EditShellProps, "modal" | "onCancel"> & {
  onRequestClose: () => void; originRef?: RefObject<HTMLElement | null>; fallbackFocusRef?: RefObject<HTMLElement | null>;
}) {
  useEffect(() => () => restoreFocus(originRef, fallbackFocusRef), [originRef, fallbackFocusRef]);
  return <div className="edit-page mx-auto max-w-4xl overflow-hidden rounded-[var(--radius-l)] border border-line">
    <EditShell {...shell} onCancel={onRequestClose} />
  </div>;
}
