import type { Person, SplitMethod, SplitResponse, SplitSharePayloadItem } from "@sui/shared";
import { useMemo, useState } from "react";
import { Button } from "./ui/button";
import { FormField } from "./ui/form-field";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { useResource } from "../hooks/use-resource";
import { apiFetch } from "../lib/api";
import { useToast } from "../hooks/use-toast";

type ShareOverride = {
  included?: boolean;
  ratio?: string;
  amount?: string;
};

function describeError(error: unknown) {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}

export function TransactionSplitForm({
  transactionId,
  people,
  onSaved,
  onCancel,
}: {
  transactionId: string;
  people: Person[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const { data: splitData, loading } = useResource(
    () => apiFetch<SplitResponse>(`/api/transactions/${transactionId}/split`).catch(() => null),
    [transactionId],
  );
  const [overrides, setOverrides] = useState<{
    method?: SplitMethod;
    ownRatio?: string;
    shares?: Record<string, ShareOverride>;
  }>({});

  const method = overrides.method ?? splitData?.split.method ?? "equal";
  const ownRatio = overrides.ownRatio ?? splitData?.split.ownRatio?.toString() ?? "";

  const defaultShares = useMemo(() => {
    const map: Record<string, ShareOverride> = {};
    for (const person of people) {
      const share = splitData?.shares.find((s) => s.personId === person.id);
      map[person.id] = {
        included: Boolean(share),
        ratio: share?.ratio?.toString() ?? "",
        amount: share?.amount?.toString() ?? "",
      };
    }
    return map;
  }, [splitData, people]);

  const shares = useMemo(() => {
    const result: Record<string, ShareOverride> = {};
    for (const person of people) {
      result[person.id] = { ...defaultShares[person.id], ...overrides.shares?.[person.id] };
    }
    return result;
  }, [defaultShares, overrides.shares, people]);

  const setMethod = (next: SplitMethod) => setOverrides((current) => ({ ...current, method: next }));
  const setOwnRatio = (next: string) => setOverrides((current) => ({ ...current, ownRatio: next }));
  const updateShare = (personId: string, patch: ShareOverride) => {
    setOverrides((current) => ({
      ...current,
      shares: { ...current.shares, [personId]: { ...current.shares?.[personId], ...patch } },
    }));
  };

  const buildPayload = ():
    | { method: SplitMethod; ownRatio?: number | null; shares: SplitSharePayloadItem[] }
    | null => {
    const selectedPeople = people.filter((person) => shares[person.id]?.included);
    if (selectedPeople.length === 0) {
      toast({ title: "メンバーを1人以上選択してください", variant: "error" });
      return null;
    }

    const payloadShares: SplitSharePayloadItem[] = selectedPeople.map((person) => ({
      personId: person.id,
      ratio: method === "ratio" ? Number(shares[person.id].ratio) || null : null,
      amount: method === "amount" ? Number(shares[person.id].amount) || undefined : undefined,
    }));

    if (method === "ratio") {
      const parsedOwnRatio = Number(ownRatio);
      if (!parsedOwnRatio || parsedOwnRatio < 1) {
        toast({ title: "自分の重みを入力してください", variant: "error" });
        return null;
      }
      return { method, ownRatio: parsedOwnRatio, shares: payloadShares };
    }

    return { method, shares: payloadShares };
  };

  const handleSave = async () => {
    const payload = buildPayload();
    if (!payload) {
      return;
    }
    try {
      await apiFetch(`/api/transactions/${transactionId}/split`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      toast({ title: "割り勘を設定しました" });
      onSaved();
    } catch (saveError) {
      toast({ title: "割り勘の設定に失敗しました", description: describeError(saveError), variant: "error" });
    }
  };

  const handleDelete = async () => {
    try {
      await apiFetch(`/api/transactions/${transactionId}/split`, { method: "DELETE" });
      toast({ title: "割り勘を解除しました" });
      onSaved();
    } catch (deleteError) {
      toast({ title: "割り勘の解除に失敗しました", description: describeError(deleteError), variant: "error" });
    }
  };

  if (loading) {
    return <p className="text-sm text-ink-3">読み込み中...</p>;
  }

  return (
    <div className="grid gap-4 border-t border-line pt-4">
      <h3 className="text-sm font-semibold">割り勘</h3>
      <FormField label="方法">
        <Select value={method} onChange={(event) => setMethod(event.target.value as SplitMethod)}>
          <option value="equal">均等割り</option>
          <option value="ratio">比率</option>
          <option value="amount">金額指定</option>
        </Select>
      </FormField>

      {method === "ratio" ? (
        <FormField label="自分の重み">
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            value={ownRatio}
            onChange={(event) => setOwnRatio(event.target.value)}
          />
        </FormField>
      ) : null}

      <div className="grid gap-2">
        {people.map((person) => (
          <div key={person.id} className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={shares[person.id]?.included ?? false}
              onChange={(event) => updateShare(person.id, { included: event.target.checked })}
            />
            <span className="min-w-0 flex-1 text-sm">{person.name}</span>
            {method === "ratio" ? (
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                className="w-24"
                placeholder="重み"
                value={shares[person.id]?.ratio ?? ""}
                onChange={(event) => updateShare(person.id, { ratio: event.target.value })}
              />
            ) : null}
            {method === "amount" ? (
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                className="w-28"
                placeholder="金額"
                value={shares[person.id]?.amount ?? ""}
                onChange={(event) => updateShare(person.id, { amount: event.target.value })}
              />
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="ghost" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="button" variant="danger" onClick={handleDelete}>
          解除
        </Button>
        <Button type="button" onClick={handleSave}>
          割り勘を設定
        </Button>
      </div>
    </div>
  );
}
