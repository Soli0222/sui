import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

function easeOutCubic(progress: number) {
  return 1 - (1 - progress) ** 3;
}

/**
 * 判定数値のカウントアップ（C-2 モーション原則）。0 から目標値まで、マウント後の
 * 一度きり `durationMs` かけてアニメーションする。完了後（`hasAnimated`）は target を
 * そのまま返すだけの派生値になるため、以降の値変更は自動的に即時反映される
 * （初回のみの規約。effect 内で state を props に同期させる必要がない）。
 * `prefers-reduced-motion: reduce` では最初から即時表示にする。
 */
export function useCountUp(target: number, durationMs = 500) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [hasAnimated, setHasAnimated] = useState(prefersReducedMotion);
  const [animatingValue, setAnimatingValue] = useState<number | null>(null);

  useEffect(() => {
    if (hasAnimated) {
      return;
    }

    const start = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const progress = Math.min(1, (now - start) / durationMs);
      setAnimatingValue(Math.round(target * easeOutCubic(progress)));
      if (progress < 1) {
        frame = requestAnimationFrame(step);
      } else {
        setHasAnimated(true);
      }
    });

    return () => cancelAnimationFrame(frame);
    // マウント時の一度きりのアニメーションなので、依存はここで固定する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return hasAnimated ? target : (animatingValue ?? 0);
}
