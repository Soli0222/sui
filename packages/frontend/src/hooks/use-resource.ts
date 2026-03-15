import { startTransition, useEffect, useEffectEvent, useState } from "react";

export function useResource<T>(loader: () => Promise<T>, deps: ReadonlyArray<unknown>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useEffectEvent(loader);

  useEffect(() => {
    let active = true;
    startTransition(() => {
      setLoading(true);
      setError(null);
    });

    load()
      .then((next) => {
        if (active) {
          setData(next);
        }
      })
      .catch((nextError) => {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : "Failed to load");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callers provide the dependency list for refetch timing.
  }, [...deps]);

  return { data, loading, error, setData };
}
