import type { Person, SplitMethod, SplitResponse, SplitSharePayloadItem } from "@sui/shared";
import { useMemo, useState } from "react";
import { Button } from "./ui/button";
import { FormField } from "./ui/form-field";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { useResource } from "../hooks/use-resource";
import { apiFetch } from "../lib/api";
import { useToast } from "../hooks/use-toast";
import { getTodayDate } from "../lib/utils";

type MemberShare = {
  included?: boolean;
  ratio?: string;
  amount?: string;
};

type FormOverrides = {
  date?: string;
  description?: string;
  memo?: string;
  amount?: string;
  method?: SplitMethod;
  ownRatio?: string;
  shares?: Record<string, MemberShare>;
};

function describeError(error: unknown) {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}

function emptyMemberShares(people: Person[]): Record<string, MemberShare> {
  const map: Record<string, MemberShare> = {};
  for (const person of people) {
    map[person.id] = { included: false, ratio: "", amount: "" };
  }
  return map;
}

export function SplitTransactionForm({
  splitId,
  people,
  onSaved,
  onCancel,
}: {
  splitId?: string;
  people: Person[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const { data: splitData, loading } = useResource(
    () => (splitId ? apiFetch<SplitResponse>(`/api/splits/${splitId}`).catch(() => null) : Promise.resolve(null)),
    [splitId],
  );
  const [overrides, setOverrides] = useState<FormOverrides>({});

  const date = overrides.date ?? splitData?.split.date ?? getTodayDate();
  const description = overrides.description ?? splitData?.split.description ?? "";
  const memo = overrides.memo ?? splitData?.split.memo ?? "";
  const amount = overrides.amount ?? splitData?.split.amount?.toString() ?? "";
  const method = overrides.method ?? splitData?.split.method ?? "equal";
  const ownRatio = overrides.ownRatio ?? splitData?.split.ownRatio?.toString() ?? "";

  const defaultShares = useMemo(() => {
    const map = emptyMemberShares(people);
    if (splitData) {
      for (const share of splitData.shares) {
        map[share.personId] = {
          included: true,
          ratio: share.ratio?.toString() ?? "",
          amount: share.amount?.toString() ?? "",
        };
      }
    }
    return map;
  }, [splitData, people]);

  const shares = useMemo(() => {
    const result: Record<string, MemberShare> = {};
    for (const person of people) {
      result[person.id] = { ...defaultShares[person.id], ...overrides.shares?.[person.id] };
    }
    return result;
  }, [defaultShares, overrides.shares, people]);

  const setDate = (next: string) => setOverrides((current) => ({ ...current, date: next }));
  const setDescription = (next: string) => setOverrides((current) => ({ ...current, description: next }));
  const setMemo = (next: string) => setOverrides((current) => ({ ...current, memo: next }));
  const setAmount = (next: string) => setOverrides((current) => ({ ...current, amount: next }));
  const setMethod = (next: SplitMethod) => setOverrides((current) => ({ ...current, method: next }));
  const setOwnRatio = (next: string) => setOverrides((current) => ({ ...current, ownRatio: next }));

  const updateShare = (personId: string, patch: MemberShare) => {
    setOverrides((current) => ({
      ...current,
      shares: {
        ...current.shares,
        [personId]: { ...current.shares?.[personId], ...patch },
      },
    }));
  };

  const buildPayload = ():
    | {
        date: string;
        description: string;
        memo: string | null;
        amount: number;
        method: SplitMethod;
        ownRatio: number | null;
        shares: SplitSharePayloadItem[];
      }
    | null => {
    if (!date.trim()) {
      toast({ title: "日付を入力してください", variant: "error" });
      return null;
    }
    if (!description.trim()) {
      toast({ title: "内容を入力してください", variant: "error" });
      return null;
    }
    const parsedAmount = Number(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      toast({ title: "金額を入力してください", variant: "error" });
      return null;
    }
    const selected = people.filter((person) => shares[person.id]?.included);
    if (selected.length === 0) {
      toast({ title: "メンバーを1人以上選択してください", variant: "error" });
      return null;
    }

    const payloadShares: SplitSharePayloadItem[] = selected.map((person) => ({
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
      for (const person of selected) {
        if (!Number(shares[person.id].ratio) || Number(shares[person.id].ratio) < 1) {
          toast({ title: "メンバーの重みを入力してください", variant: "error" });
          return null;
        }
      }
      return {
        date,
        description: description.trim(),
        memo: memo.trim() || null,
        amount: parsedAmount,
        method,
        ownRatio: parsedOwnRatio,
        shares: payloadShares,
      };
    }

    if (method === "amount") {
      for (const person of selected) {
        if (!Number(shares[person.id].amount) || Number(shares[person.id].amount) <= 0) {
          toast({ title: "メンバーの金額を入力してください", variant: "error" });
          return null;
        }
      }
    }

    return {
      date,
      description: description.trim(),
      memo: memo.trim() || null,
      amount: parsedAmount,
      method,
      ownRatio: null,
      shares: payloadShares,
    };
  };

  const handleSave = async () => {
    const payload = buildPayload();
    if (!payload) {
      return;
    }
    try {
      if (splitId) {
        await apiFetch(`/api/splits/${splitId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        toast({ title: "割り勘取引を更新しました" });
      } else {
        await apiFetch("/api/splits", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast({ title: "割り勘取引を追加しました" });
      }
      onSaved();
    } catch (saveError) {
      toast({ title: "保存に失敗しました", description: describeError(saveError), variant: "error" });
    }
  };

  const handleDelete = async () => {
    if (!splitId) {
      return;
    }
    try {
      await apiFetch(`/api/splits/${splitId}`, { method: "DELETE" });
      toast({ title: "割り勘取引を削除しました" });
      onSaved();
    } catch (deleteError) {
      toast({ title: "削除に失敗しました", description: describeError(deleteError), variant: "error" });
    }
  };

  if (loading) {
    return <p className="text-sm text-ink-3">読み込み中...</p>;
  }

  return (
    <form
      className="mt-6 grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        handleSave();
      }}
    >
      <FormField label="日付" required>
        <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      </FormField>

      <FormField label="内容" required>
        <Input value={description} onChange={(event) => setDescription(event.target.value)} />
      </FormField>

      <FormField label="メモ">
        <Input value={memo} onChange={(event) => setMemo(event.target.value)} />
      </FormField>

      <FormField label="金額" required>
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </FormField>

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
        <p className="text-sm font-medium">メンバー</p>
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

      <div className="flex flex-wrap justify-end gap-3 border-t border-line pt-4">
        {splitId ? (
          <Button type="button" variant="danger" onClick={handleDelete}>
            削除
          </Button>
        ) : null}
        <Button type="button" variant="ghost" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit">{splitId ? "保存" : "追加"}</Button>
      </div>
    </form>
  );
}
