import { INT4_MAX, type Account, type CreditCard, type SpendingApplicationInput, type SpendingRequest, type SpendingResponse } from "@sui/shared";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { EditPage, type EditChange } from "../components/editing/edit-surface";
import { Button } from "../components/ui/button";
import { Disclosure } from "../components/ui/disclosure";
import { FormField } from "../components/ui/form-field";
import { Input } from "../components/ui/input";
import { MoneyInput } from "../components/ui/money-input";
import { Select } from "../components/ui/select";
import { useEditSession, type EditErrors } from "../hooks/use-edit-session";
import { useFieldValidation } from "../hooks/use-field-validation";
import { ApiError, apiFetch } from "../lib/api";
import { formatCurrency } from "../lib/format";
import { getTodayDate } from "../lib/utils";

type Draft = Omit<SpendingApplicationInput, "amount" | "rateToJpy"> & { amount: string; rateMajor: string };
type CurrencyScale = { digits: number; known: boolean; factor: number };
const listedCurrencies = new Set(Intl.supportedValuesOf("currency"));
export function currencyScale(currency: string): CurrencyScale {
  if (!listedCurrencies.has(currency)) return { digits: 0, known: false, factor: 1 };
  const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return { digits, known: true, factor: 10 ** digits };
}
export function formatMinorDraft(amount: number, currency: string) {
  const { digits, factor } = currencyScale(currency);
  return digits === 0 ? String(amount) : (amount / factor).toFixed(digits);
}
export function parseMajorDraft(raw: string, currency: string): number | null {
  const { digits, factor } = currencyScale(currency);
  const trimmed = raw.replaceAll(",", "");
  if (trimmed.length > 16) return null;
  const pattern = digits === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`);
  if (!pattern.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  const result = Number(BigInt(whole) * BigInt(factor) + BigInt((fraction || "0").padEnd(digits, "0")));
  return Number.isSafeInteger(result) && result > 0 && result <= INT4_MAX ? result : null;
}
export function majorRateToMinor(raw: string, currency: string): number | null {
  const number = Number(raw);
  return raw.trim().length > 0 && Number.isFinite(number) && number > 0 ? number / currencyScale(currency).factor : null;
}
export function amountOnCurrencyChange(raw: string, previousCurrency: string, nextCurrency: string) {
  const minor = parseMajorDraft(raw, previousCurrency);
  return minor === null ? raw : formatMinorDraft(minor, nextCurrency);
}
function initialInput(): SpendingApplicationInput {
  const date = getTodayDate();
  return { name: "", amount: 0, category: "", reason: "", purchaseDate: date, payment: "", kind: "normal", currency: "JPY",
    rateToJpy: 1, rateAt: date, urgency: "", replacement: "", alternatives: "", relatedIds: [], funding: null };
}
function inputFromRequest(request: SpendingRequest): SpendingApplicationInput {
  const { items, ...rest } = request.input;
  return { ...rest, amount: items.reduce((sum, item) => sum + item.amount, 0), category: items[0]?.category ?? "" };
}
function toDraft(input: SpendingApplicationInput): Draft {
  return { ...input, amount: formatMinorDraft(input.amount, input.currency),
    rateMajor: input.rateToJpy === null ? "" : String(input.rateToJpy * currencyScale(input.currency).factor) };
}
function toInput(draft: Draft): SpendingApplicationInput {
  const { amount, rateMajor, ...rest } = draft;
  const minor = parseMajorDraft(amount, draft.currency)!;
  return { ...rest, rateAt: draft.rateAt || null, amount: minor, rateToJpy: draft.currency === "JPY" ? 1 : majorRateToMinor(rateMajor, draft.currency),
    funding: draft.kind === "supplemental" && draft.funding ? { ...draft.funding, amount: minor } : null };
}
function realDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function validate(draft: Draft): EditErrors {
  const errors: EditErrors = {};
  for (const key of ["name", "category", "reason", "payment"] as const) {
    if (!draft[key].trim() || draft[key].length > 2000) errors[key] = "必須項目を2000文字以内で入力してください。";
  }
  if (!realDate(draft.purchaseDate)) errors.purchaseDate = "実在する購入予定日を入力してください。";
  if ((draft.subcategory ?? "").length > 200) errors.subcategory = "中項目は200文字以下で入力してください。";
  for (const key of ["urgency", "replacement", "alternatives"] as const) if (draft[key].length > 2000) errors[key] = "2000文字以下で入力してください。";
  if (draft.relatedIds.length > 100) errors.relatedIds = "関連申請は100件以下にしてください。";
  if (!/^[A-Z]{3}$/.test(draft.currency)) errors.currency = "通貨コードは英大文字3文字で入力してください。";
  if (parseMajorDraft(draft.amount, draft.currency) === null) errors.amount = "金額を正の整数と通貨の小数桁で入力してください。";
  if (draft.currency !== "JPY" && draft.rateMajor.trim() && majorRateToMinor(draft.rateMajor, draft.currency) === null) errors.rateMajor = "主要単位あたりの換算率を正の数で入力してください。";
  if (draft.currency !== "JPY" && draft.rateAt && !realDate(draft.rateAt)) errors.rateAt = "実在する換算基準日を入力してください。";
  const minor = parseMajorDraft(draft.amount, draft.currency);
  const rate = draft.currency === "JPY" ? 1 : majorRateToMinor(draft.rateMajor, draft.currency);
  if (minor !== null && rate !== null && (!Number.isSafeInteger(Math.round(minor * rate)) || Math.round(minor * rate) > INT4_MAX)) {
    errors.amount = "JPY換算後の金額が上限を超えています。";
  }
  if (draft.kind === "supplemental") {
    if (!draft.funding?.sourceId) errors.sourceId = "資金元口座を選択してください。";
    if (!draft.funding?.destinationId || draft.funding.destinationId === draft.funding.sourceId) errors.destinationId = "異なる振替先口座を選択してください。";
    if (!realDate(draft.funding?.date ?? "")) errors.fundingDate = "実在する振替日を入力してください。";
  }
  return errors;
}

export function SpendingRequestEditorPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const backSearch = new URLSearchParams(search);
  const back = () => navigate(`/spending?${backSearch.toString()}`);
  return <EditorLoader key={id ?? "new"} id={id} back={back} />;
}

function EditorLoader({ id, back }: { id: string | undefined; back: () => void }) {
  const [loaded, setLoaded] = useState<{ state: SpendingResponse; accounts: Account[]; cards: CreditCard[] } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => { setLoading(true); setError(""); setReloadKey((key) => key + 1); };
  useEffect(() => {
    let active = true;
    Promise.all([apiFetch<SpendingResponse>("/api/spending"), apiFetch<Account[]>("/api/accounts"), apiFetch<CreditCard[]>("/api/credit-cards")])
      .then(([state, accounts, cards]) => { if (active) setLoaded({ state, accounts, cards }); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadKey]);
  if (loading) return <p role="status">読み込み中…</p>;
  if (error) return <div className="grid gap-3"><p role="alert">{error}</p><Button onClick={reload}>再試行</Button><Button variant="ghost" onClick={back}>支出決裁に戻る</Button></div>;
  if (!loaded) return null;
  const request = id ? loaded.state.ledger.requests.find((item) => item.id === id && !item.deletedAt) ?? null : null;
  if (id && !request) return <div className="grid gap-3"><p role="alert">申請が見つかりません。</p><Button variant="ghost" onClick={back}>支出決裁に戻る</Button></div>;
  if (request && request.input.items.length !== 1) return <div className="grid gap-3"><p role="alert">旧形式の複数内訳申請は編集できません。新しい申請を作成してください。</p><Button variant="ghost" onClick={back}>支出決裁に戻る</Button></div>;
  return <Editor key={`${id ?? "new"}:${reloadKey}`} request={request} loaded={loaded} back={back}
    reopenLatest={reload} />;
}

const fieldLabels: Record<keyof Draft, string> = {
  name: "買うもの", amount: "金額", category: "カテゴリ", subcategory: "中項目", reason: "購入理由",
  purchaseDate: "購入予定日", payment: "支払手段", kind: "使う予算", currency: "通貨", rateMajor: "換算率",
  rateAt: "換算基準日", urgency: "緊急性", replacement: "買い替え／追加購入", alternatives: "延期・代替案",
  relatedIds: "関連申請", funding: "補正予算の振替",
};
const statusLabels: Record<string, string> = {
  draft: "下書き", reviewing: "審査中", conditional: "条件付き", held: "保留", denied: "否認",
  approved: "承認済み", purchased: "購入記録済み", completed: "完了", cancelled: "取消", expired: "期限切れ",
};

function Editor({ request, loaded, back, reopenLatest }: { request: SpendingRequest | null;
  loaded: { state: SpendingResponse; accounts: Account[]; cards: CreditCard[] }; back: () => void; reopenLatest: () => void }) {
  const identity = request ? `spending-request:${request.id}` : "spending-request:new";
  const initial = toDraft(request ? inputFromRequest(request) : initialInput());
  const version = useRef(loaded.state.version);
  const savedId = useRef(request?.id ?? null);
  const [conflict, setConflict] = useState(false);
  const [supplementOpen, setSupplementOpen] = useState(Boolean(initial.urgency || initial.replacement || initial.alternatives || initial.relatedIds.length || initial.currency !== "JPY"));
  const purchased = Boolean(request?.purchaseRecord || request?.purchases.length);
  const fundingUsed = Boolean(request && loaded.state.requestStates[request.id]?.funding.some((funding) => funding.transactionId));
  const classificationLocked = purchased || fundingUsed;
  const validateDraft = (value: Draft) => {
    const errors = validate(value);
    if (purchased && value.purchaseDate.slice(0, 7) !== request?.input.purchaseDate.slice(0, 7)) {
      errors.purchaseDate = "購入記録後は対象月を変更できません。";
    }
    return errors;
  };
  const session = useEditSession({ identity, initial, validate: validateDraft });
  const validation = useFieldValidation(session.draft, validateDraft);
  const draft = session.draft;
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => session.setDraft((previous) => ({ ...previous, [key]: value }));
  const minor = parseMajorDraft(draft.amount, draft.currency);
  const rate = draft.currency === "JPY" ? 1 : majorRateToMinor(draft.rateMajor, draft.currency);
  const describe = (key: keyof Draft, value: Draft[keyof Draft], currency: string) => {
    if (key === "funding") {
      const funding = value as Draft["funding"];
      if (!funding) return "なし";
      const accountName = (id: string) => loaded.accounts.find((account) => account.id === id)?.name ?? id;
      return `${accountName(funding.sourceId)} → ${accountName(funding.destinationId)}・${funding.date}・${formatMinorDraft(funding.amount, currency)} ${currency}`;
    }
    if (key === "relatedIds") return (value as string[]).map((id) => loaded.state.ledger.requests.find((item) => item.id === id)?.input.name ?? id).join("、") || "なし";
    if (key === "rateMajor") return `${value || "未設定"} JPY / ${currency}`;
    if (key === "amount") return `${value} ${currency}${currencyScale(currency).known ? "" : "（最小通貨単位）"}`;
    if (key === "kind") return value === "normal" ? "通常予算" : "補正予算";
    return String(value ?? "—") || "—";
  };
  const changes: EditChange[] = request ? (Object.keys(draft) as (keyof Draft)[])
    .filter((key) => JSON.stringify(draft[key]) !== JSON.stringify(initial[key]))
    .map((key) => ({ label: fieldLabels[key], before: describe(key, initial[key], initial.currency), after: describe(key, draft[key], draft.currency) })) : [];
  const save = async () => {
    const errors = validateDraft(draft);
    if (["currency", "rateMajor", "rateAt", "urgency", "replacement", "alternatives", "relatedIds"].some((key) => errors[key])) {
      flushSync(() => setSupplementOpen(true));
    }
    validation.showAll();
    const success = await session.save(async (value) => {
      try {
        const response = await apiFetch<SpendingResponse>("/api/spending/commands", { method: "POST", body: JSON.stringify({ version: version.current,
          command: { action: "request", ...(request ? { id: request.id } : {}), input: toInput(value) } }) });
        const beforeIds = new Set(loaded.state.ledger.requests.map((item) => item.id));
        savedId.current = request?.id ?? response.ledger.requests.find((item) => !beforeIds.has(item.id))?.id ?? null;
        version.current = response.version;
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          setConflict(true);
          throw new Error("更新が競合しました。入力内容を残しています。最新状態を確認して再編集してください。", { cause: error });
        }
        throw error;
      }
    }, async () => {
      const response = await apiFetch<SpendingResponse>("/api/spending");
      const saved = response.ledger.requests.find((item) => item.id === savedId.current);
      if (!saved) throw new Error("保存後の申請を確認できません。");
      return toDraft(inputFromRequest(saved));
    });
    if (success) back();
  };
  const retry = async () => { if (await session.retryRefresh()) back(); };
  const supportedMoney = ["JPY", "USD", "EUR"].includes(draft.currency);
  const amountLabel = draft.currency === "JPY" ? "金額（円）" : currencyScale(draft.currency).known ? `金額（${draft.currency}）` : "金額（最小通貨単位）";
  return <EditPage subjectType="支出申請" subjectName={request?.input.name || "新規申請"}
    title={request ? `${request.input.name}（${statusLabels[request.status] ?? request.status}）を変更` : "買い物の申請"} mode={request ? "edit" : "create"}
    status={session.status} error={session.error} changes={changes} saveLabel={request ? "変更を保存" : "下書きを保存"}
    impact="申請の下書きだけを保存します。AI審査、購入記録、予算更新、口座残高の変更は行いません。"
    onRequestClose={() => session.requestClose(back)} onSave={save} onRetryRefresh={retry}>
    <Button variant="ghost" className="mb-4" onClick={() => session.requestClose(back)}>支出決裁に戻る</Button>
    {conflict && <div className="mb-4 rounded-lg border border-critical p-3 text-sm">
      <p>保存前の入力は残っています。最新の申請を読み直すと、この入力は破棄されます。</p>
      <Button type="button" variant="secondary" className="mt-2" onClick={() => session.requestClose(reopenLatest)}>最新状態を確認して再編集</Button>
    </div>}
    {classificationLocked && <p className="mb-4 text-sm text-ink-2">購入記録または確定済み振替があるため、予算区分・分類・通貨・換算率は変更できません。</p>}
    <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="grid gap-5">
      <section className="grid gap-4"><h3 className="font-semibold">買うもの・金額・MFカテゴリ・理由</h3>
        <FormField label="買うもの" htmlFor="name" required error={validation.visibleErrors.name ?? session.errors.name}>
          <Input id="name" value={draft.name} onChange={(event) => update("name", event.target.value)} onBlur={() => validation.touch("name")} /></FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={amountLabel} htmlFor="amount" required error={validation.visibleErrors.amount ?? session.errors.amount}
            help={currencyScale(draft.currency).known ? `${draft.currency} の主要単位で入力（小数${currencyScale(draft.currency).digits}桁まで）。` : `${draft.currency} の小数桁を確認できないため、最小通貨単位で入力します。`}>
            {supportedMoney ? <MoneyInput id="amount" currencyCode={draft.currency as "JPY" | "USD" | "EUR"} value={minor}
              draftValue={draft.amount} draftKey={identity + draft.currency} disabled={fundingUsed} onChange={() => {}} onDraftChange={(value) => update("amount", value.raw)} onBlur={() => validation.touch("amount")} />
              : <Input id="amount" inputMode={currencyScale(draft.currency).digits > 0 ? "decimal" : "numeric"} value={draft.amount} disabled={fundingUsed} onChange={(event) => update("amount", event.target.value)} onBlur={() => validation.touch("amount")} />}
          </FormField>
          <FormField label="カテゴリ" htmlFor="category" required error={validation.visibleErrors.category ?? session.errors.category}>
            <Input id="category" list="editor-categories" value={draft.category} disabled={classificationLocked} onChange={(event) => { update("category", event.target.value); update("subcategory", ""); }} onBlur={() => validation.touch("category")} /></FormField>
        </div>
        <datalist id="editor-categories">{[...new Set([
          ...loaded.state.ledger.details.map((item) => item.raw["大項目"] || item.categorySource.split("/")[0]),
          ...(loaded.state.ledger.budgetProposals ?? []).flatMap((proposal) => proposal.categories.map((category) => category.category)),
        ])].map((value) => <option key={value} value={value} />)}</datalist>
        <FormField label="中項目（任意）" htmlFor="subcategory"><Input id="subcategory" list="editor-subcategories" value={draft.subcategory ?? ""} disabled={classificationLocked} onChange={(event) => update("subcategory", event.target.value)} /></FormField>
        <datalist id="editor-subcategories">{[...new Set([
          ...loaded.state.ledger.details.filter((item) => !item.deletedAt && item.raw["大項目"] === draft.category).map((item) => item.raw["中項目"]),
          ...(loaded.state.ledger.settings.supplementalLimits ?? []).filter((rule) => rule.category === draft.category).map((rule) => rule.subcategory),
        ].filter((value): value is string => Boolean(value)))].map((value) => <option key={value} value={value} />)}</datalist>
        <FormField label="購入理由" htmlFor="reason" required error={validation.visibleErrors.reason ?? session.errors.reason}><Input id="reason" value={draft.reason} onChange={(event) => update("reason", event.target.value)} onBlur={() => validation.touch("reason")} /></FormField>
      </section>
      <section className="grid gap-4 border-t border-line pt-4"><h3 className="font-semibold">支払手段・購入予定日・使う予算</h3>
        <FormField label="支払手段" htmlFor="payment" required error={validation.visibleErrors.payment ?? session.errors.payment}><Input id="payment" list="editor-payments" value={draft.payment} onChange={(event) => update("payment", event.target.value)} onBlur={() => validation.touch("payment")} /></FormField>
        <datalist id="editor-payments">{[...new Set([...loaded.accounts.map((account) => account.name), ...loaded.cards.map((card) => card.name), ...loaded.state.ledger.details.map((item) => item.paymentSource)])].map((value) => <option key={value} value={value} />)}</datalist>
        <div className="grid gap-4 sm:grid-cols-2"><FormField label="購入予定日" htmlFor="purchaseDate" required help={purchased ? "購入記録後は対象月を変更できません。" : undefined} error={validation.visibleErrors.purchaseDate ?? session.errors.purchaseDate}><Input id="purchaseDate" type="date" value={draft.purchaseDate} onChange={(event) => update("purchaseDate", event.target.value)} /></FormField>
          <FormField label="使う予算" htmlFor="kind"><Select id="kind" value={draft.kind} disabled={classificationLocked} onChange={(event) => {
            const kind = event.target.value as Draft["kind"];
            session.setDraft((previous) => ({ ...previous, kind, funding: kind === "normal" ? null : previous.funding ?? { sourceId: "", destinationId: "", date: previous.purchaseDate, amount: 0 } }));
          }}><option value="normal">通常予算</option><option value="supplemental">補正予算</option></Select></FormField></div>
      </section>
      {draft.kind === "supplemental" && <section className="grid gap-4 border-t border-line pt-4"><h3 className="font-semibold">補正予算の振替</h3>
        <FormField label="資金元口座" htmlFor="sourceId" required error={validation.visibleErrors.sourceId ?? session.errors.sourceId}><Select id="sourceId" value={draft.funding?.sourceId ?? ""} disabled={fundingUsed} onChange={(event) => update("funding", { ...draft.funding!, sourceId: event.target.value })}><option value="">選択してください</option>{loaded.accounts.filter((account) => account.supplementalBudgetEnabled).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</Select></FormField>
        <FormField label="振替先口座" htmlFor="destinationId" required error={validation.visibleErrors.destinationId ?? session.errors.destinationId}><Select id="destinationId" value={draft.funding?.destinationId ?? ""} disabled={fundingUsed} onChange={(event) => update("funding", { ...draft.funding!, destinationId: event.target.value })}><option value="">選択してください</option>{loaded.accounts.filter((account) => account.id !== draft.funding?.sourceId).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</Select></FormField>
        <FormField label="振替日" htmlFor="fundingDate" required error={validation.visibleErrors.fundingDate ?? session.errors.fundingDate}><Input id="fundingDate" type="date" value={draft.funding?.date ?? ""} disabled={fundingUsed} onChange={(event) => update("funding", { ...draft.funding!, date: event.target.value })} /></FormField>
        <p>振替額：{minor?.toLocaleString() ?? "未入力"} {draft.currency}（最小通貨単位）</p>
      </section>}
      <Disclosure summary="補足情報・外貨設定" open={supplementOpen} onOpenChange={setSupplementOpen}>
        <FormField label="緊急性" htmlFor="urgency"><Input id="urgency" value={draft.urgency} onChange={(event) => update("urgency", event.target.value)} /></FormField>
        <FormField label="買い替え／追加購入" htmlFor="replacement"><Input id="replacement" value={draft.replacement} onChange={(event) => update("replacement", event.target.value)} /></FormField>
        <FormField label="延期・代替案" htmlFor="alternatives"><Input id="alternatives" value={draft.alternatives} onChange={(event) => update("alternatives", event.target.value)} /></FormField>
        <FormField label="関連申請を追加" htmlFor="related"><Select id="related" value="" onChange={(event) => event.target.value && update("relatedIds", [...new Set([...draft.relatedIds, event.target.value])])}><option value="">選択</option>{loaded.state.ledger.requests.filter((item) => !item.deletedAt && item.id !== request?.id).map((item) => <option key={item.id} value={item.id}>{item.input.name}</option>)}</Select></FormField>
        {draft.relatedIds.map((id) => <Button key={id} type="button" variant="ghost" onClick={() => update("relatedIds", draft.relatedIds.filter((item) => item !== id))}>{loaded.state.ledger.requests.find((item) => item.id === id)?.input.name ?? id} を外す</Button>)}
        <FormField label="通貨" htmlFor="currency" error={validation.visibleErrors.currency ?? session.errors.currency}><Input id="currency" maxLength={3} value={draft.currency} disabled={classificationLocked} onChange={(event) => {
          const currency = event.target.value.toUpperCase();
          session.setDraft((previous) => {
            return { ...previous, currency, amount: amountOnCurrencyChange(previous.amount, previous.currency, currency),
              rateMajor: currency === "JPY" ? "1" : "", rateAt: currency === "JPY" ? previous.purchaseDate : null };
          });
        }} /></FormField>
        {draft.currency !== "JPY" && <><FormField label={currencyScale(draft.currency).known ? `1 ${draft.currency} あたりのJPY換算率` : "最小通貨単位からJPYへの換算率"} htmlFor="rateMajor" error={validation.visibleErrors.rateMajor ?? session.errors.rateMajor}>
          <Input id="rateMajor" inputMode="decimal" value={draft.rateMajor} disabled={classificationLocked} onChange={(event) => update("rateMajor", event.target.value)} /></FormField>
          <FormField label="換算基準日" htmlFor="rateAt" error={validation.visibleErrors.rateAt ?? session.errors.rateAt}><Input id="rateAt" type="date" value={draft.rateAt ?? ""} onChange={(event) => update("rateAt", event.target.value)} /></FormField></>}
      </Disclosure>
      <p className="text-sm text-ink-2">{minor !== null && rate !== null && minor * rate >= (loaded.state.ledger.settings.threshold ?? Infinity) ? "決裁対象の金額です" : "任意申請です"}{minor !== null && rate !== null ? ` · JPY換算 ${formatCurrency(Math.round(minor * rate), "JPY")}` : ""}</p>
      <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
    </form>
  </EditPage>;
}
