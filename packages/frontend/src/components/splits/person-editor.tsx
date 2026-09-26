import type { Person } from "@sui/shared";
import { useId } from "react";
import { EditModal, type EditChange } from "../editing/edit-surface";
import { FormField } from "../ui/form-field";
import { Input } from "../ui/input";
import { useEditSession, type EditErrors } from "../../hooks/use-edit-session";
import { useFieldValidation } from "../../hooks/use-field-validation";
import { useToast } from "../../hooks/use-toast";
import { apiFetch } from "../../lib/api";
type PersonForm = {
  name: string;
  memo: string;
  sortOrder: number;
};

const emptyForm: PersonForm = { name: "", memo: "", sortOrder: 0 };

export function PersonEditModal({ person, onCancel, onSaved, onRefreshed }: {
  person?: Person; onCancel: () => void; onSaved: () => void; onRefreshed: (people: Person[]) => void;
}) {
  const nameId = useId();
  const memoId = useId();
  const sortOrderId = useId();
  const { toast } = useToast();
  const initial: PersonForm = person ? { name: person.name, memo: person.memo ?? "", sortOrder: person.sortOrder } : emptyForm;
  const validate = (value: PersonForm): EditErrors => {
    const errors: EditErrors = {};
    if (!value.name.trim()) errors.name = "名前を入力してください";
    if (!Number.isSafeInteger(value.sortOrder)) errors.sortOrder = "整数で入力してください";
    return errors;
  };
  const fieldIds = { name: nameId, sortOrder: sortOrderId };
  const session = useEditSession({ identity: `person:${person?.id ?? "new"}`, initial, validate, fieldIds });
  const form = session.draft;
  const fields = useFieldValidation(form, validate, fieldIds);
  const refresh = async () => {
    const people = await apiFetch<Person[]>("/api/people");
    onRefreshed(people);
    const saved = person ? people.find((item) => item.id === person.id) : null;
    if (person && !saved) throw new Error("保存したメンバーを再取得できませんでした");
    return saved ? { name: saved.name, memo: saved.memo ?? "", sortOrder: saved.sortOrder } : form;
  };
  const save = async () => {
    fields.showAll();
    const ok = await session.save((value) => apiFetch(person ? `/api/people/${person.id}` : "/api/people", {
      method: person ? "PUT" : "POST", body: JSON.stringify({ ...value, name: value.name.trim(), memo: value.memo.trim() || null }),
    }), refresh);
    if (ok) { toast({ title: `${form.name} を${person ? "更新" : "追加"}しました` }); onSaved(); }
  };
  const changes: EditChange[] = [];
  if (session.snapshot.name !== form.name) changes.push({ label: "名前", before: session.snapshot.name || "未入力", after: form.name || "未入力" });
  if (session.snapshot.memo !== form.memo) changes.push({ label: "メモ", before: session.snapshot.memo || "未入力", after: form.memo || "未入力" });
  if (session.snapshot.sortOrder !== form.sortOrder) changes.push({ label: "表示順", before: String(session.snapshot.sortOrder), after: String(form.sortOrder) });
  return <EditModal open subjectType="割り勘のメンバー" subjectName={person?.name ?? "メンバー"} mode={person ? "edit" : "create"}
    status={session.status} error={session.error} changes={changes} saveLabel={person ? "変更を保存" : "メンバーを追加"}
    impact="割り勘で選べるメンバーの基本情報を更新します。既存の持分額は変更しません。"
    onRequestClose={() => session.requestClose(onCancel)} onSave={() => void save()}
    onRetryRefresh={() => void session.retryRefresh().then((ok) => { if (ok) onSaved(); })}>
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <FormField label="名前" htmlFor={nameId} required error={fields.visibleErrors.name}>
        <Input id={nameId} value={form.name} onBlur={() => fields.touch("name")} onChange={(event) => session.setDraft({ ...form, name: event.target.value })} />
      </FormField>
      <FormField label="メモ" htmlFor={memoId}><Input id={memoId} value={form.memo} onChange={(event) => session.setDraft({ ...form, memo: event.target.value })} /></FormField>
      <FormField label="表示順" htmlFor={sortOrderId} error={fields.visibleErrors.sortOrder}>
        <Input id={sortOrderId} type="number" inputMode="numeric" value={form.sortOrder} onBlur={() => fields.touch("sortOrder")}
          onChange={(event) => session.setDraft({ ...form, sortOrder: Number(event.target.value) })} />
      </FormField>
      <button type="submit" className="sr-only" aria-hidden="true" tabIndex={-1}>保存</button>
    </form>
  </EditModal>;
}
