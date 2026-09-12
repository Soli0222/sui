import type { CreditCardAssumptionSuggestionResponse } from "@sui/shared";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api";

export function useAssumptionSuggestion() {
  const generation = useRef(0);
  const [suggestion, setSuggestion] = useState<CreditCardAssumptionSuggestionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => { generation.current += 1; }, []);

  const reset = () => {
    generation.current += 1;
    setSuggestion(null);
    setLoading(false);
    setError(null);
  };

  const load = async (cardId: string) => {
    const request = ++generation.current;
    setSuggestion(null);
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<CreditCardAssumptionSuggestionResponse>(
        `/api/credit-cards/${cardId}/assumption-suggestion?months=6`,
      );
      if (request === generation.current) setSuggestion(response);
    } catch (cause) {
      if (request === generation.current) {
        setError(cause instanceof Error ? cause.message : "提案を取得できませんでした");
      }
    } finally {
      if (request === generation.current) setLoading(false);
    }
  };

  return { suggestion, loading, error, reset, load };
}
