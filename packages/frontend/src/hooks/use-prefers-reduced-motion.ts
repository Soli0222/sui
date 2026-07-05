import { useEffect, useState } from "react";

function getPrefersReducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

/**
 * `prefers-reduced-motion: reduce` の購読。カウントアップやチャート描線など、
 * JS で駆動するモーションを CSS の `@media` だけでは制御できない箇所で使う。
 */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(getPrefersReducedMotion);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const listener = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  return reduced;
}
