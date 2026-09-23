import { useCallback, useMemo, useState } from "react";
import type { EditErrors } from "./use-edit-session";

/** Error keys follow validation order. Map keys to DOM ids when names and ids differ. */
export function focusFirstInvalidField(errors: EditErrors, fieldIds: Record<string, string> = {}) {
  for (const field of Object.keys(errors)) {
    const control = document.getElementById(fieldIds[field] ?? field);
    if (control instanceof HTMLElement && !control.hasAttribute("disabled")) {
      control.focus();
      return true;
    }
  }
  return false;
}

/** Show errors after a field is visited, and show all errors on submit. */
export function useFieldValidation<T>(draft: T, validate: (draft: T) => EditErrors, fieldIds?: Record<string, string>) {
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);
  const errors = useMemo(() => validate(draft), [draft, validate]);
  const visibleErrors = useMemo(() => Object.fromEntries(Object.entries(errors)
    .filter(([field]) => submitted || touched.has(field))), [errors, submitted, touched]);
  const touch = useCallback((field: string) => setTouched((previous) => new Set(previous).add(field)), []);
  const showAll = useCallback(() => {
    setSubmitted(true);
    focusFirstInvalidField(errors, fieldIds);
    return Object.keys(errors).length === 0;
  }, [errors, fieldIds]);
  const reset = useCallback(() => { setTouched(new Set()); setSubmitted(false); }, []);
  return { errors, visibleErrors, touch, showAll, reset, submitted };
}
