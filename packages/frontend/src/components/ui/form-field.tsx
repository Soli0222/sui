import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Input } from "./input";
import { MoneyInput } from "./money-input";
import { Select } from "./select";
import { SegmentedControl } from "./segmented-control";

/**
 * 共有フィールド部品（C-5 規約 5）。ラベル、必須マーク、コントロール、ヘルプ、
 * エラーの 5 スロットを持つ。placeholder をラベル代わりに使うことを禁止する。
 */
export function FormField({
  label,
  htmlFor,
  required = false,
  help,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  help?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  const generatedId = useId();
  const element = isValidElement(children) ? children as ReactElement<Record<string, unknown>> : null;
  const controlId = htmlFor ?? (typeof element?.props.id === "string" ? element.props.id : generatedId);
  const helpId = `${controlId}-help`;
  const errorId = `${controlId}-error`;
  const labelId = `${controlId}-label`;
  const describedBy = [element?.props["aria-describedby"], help && helpId, error && errorId].filter(Boolean).join(" ") || undefined;
  const isSegmented = element?.type === SegmentedControl;
  // Unknown composite children may not forward control props. Groups use FieldGroup.
  const isControl = element && (element.type === Input || element.type === Select || element.type === MoneyInput ||
    (typeof element.type === "string" && ["input", "select", "textarea"].includes(element.type)));
  const control = isSegmented ? cloneElement(element, {
    id: controlId, "aria-labelledby": labelId, "aria-describedby": describedBy,
    "aria-invalid": error ? true : undefined,
  }) : isControl ? cloneElement(element, {
    id: controlId,
    required: required || element.props.required || undefined,
    "aria-required": required || element.props["aria-required"] || undefined,
    "aria-invalid": error ? true : element.props["aria-invalid"],
    "aria-describedby": describedBy,
  }) : children;
  return (
    <div className={cn("grid min-w-0 content-start gap-1.5 text-sm", className)}>
      {isSegmented ? <span id={labelId} className="break-words text-ink-2">{label}{required && <span className="text-critical"> *</span>}</span> : <label htmlFor={controlId} className="break-words text-ink-2">
        {label}
        {required ? <span className="text-critical"> *</span> : null}
      </label>}
      {control}
      {help ? <p id={helpId} className="text-xs text-ink-3">{help}</p> : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-critical">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function FieldGroup({ legend, required = false, help, error, children, className }: {
  legend: string; required?: boolean; help?: ReactNode; error?: string | null;
  children: ReactNode; className?: string;
}) {
  const id = useId();
  return <fieldset aria-describedby={[help && `${id}-help`, error && `${id}-error`].filter(Boolean).join(" ") || undefined}
    aria-invalid={error ? true : undefined} className={cn("min-w-0", className)}>
    <legend className="mb-1.5 break-words text-sm text-ink-2">{legend}{required && <span className="text-critical"> *</span>}</legend>
    {children}
    {help && <p id={`${id}-help`} className="mt-1.5 text-xs text-ink-3">{help}</p>}
    {error && <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs font-medium text-critical">{error}</p>}
  </fieldset>;
}
