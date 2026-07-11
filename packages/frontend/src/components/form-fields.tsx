import type { Account, DateShiftPolicy, SupportedCurrencyCode } from "@sui/shared";
import { FormField } from "./ui/form-field";
import { Input } from "./ui/input";
import { Select } from "./ui/select";

const dayOfWeekOptions = [
  { value: 0, label: "日曜日" },
  { value: 1, label: "月曜日" },
  { value: 2, label: "火曜日" },
  { value: 3, label: "水曜日" },
  { value: 4, label: "木曜日" },
  { value: 5, label: "金曜日" },
  { value: 6, label: "土曜日" },
];

/**
 * 毎月の日付入力。同一概念に 3 つのラベル（「毎月の発生日」「引落日 (1-31)」「課金日 (1-31)」）が
 * あった揺れを解消し、「毎月の発生日」に統一する。制約は placeholder ではなくヘルプテキストで示す。
 */
export function DayOfMonthField({
  id,
  value,
  onChange,
  required = true,
  error,
}: {
  id: string;
  value: number | null;
  onChange: (value: number | null) => void;
  required?: boolean;
  error?: string | null;
}) {
  return (
    <FormField label="毎月の発生日" htmlFor={id} required={required} help="1〜31 の範囲で指定します。" error={error}>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={31}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
      />
    </FormField>
  );
}

/**
 * 曜日選択。週次の固定収支・サブスクで使う。
 */
export function DayOfWeekField({
  id,
  value,
  onChange,
  required = true,
  error,
}: {
  id: string;
  value: number | null;
  onChange: (value: number | null) => void;
  required?: boolean;
  error?: string | null;
}) {
  return (
    <FormField label="曜日" htmlFor={id} required={required} help="0=日曜、6=土曜" error={error}>
      <Select
        id={id}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
      >
        <option value="">選択</option>
        {dayOfWeekOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </FormField>
  );
}

/**
 * 開始日・終了日の対フィールド。「空欄で無期限」ヘルプを一体化する。
 */
export function PeriodFields({
  idPrefix,
  startDate,
  endDate,
  onChangeStartDate,
  onChangeEndDate,
  startRequired = false,
  error,
}: {
  idPrefix: string;
  startDate: string;
  endDate: string;
  onChangeStartDate: (value: string) => void;
  onChangeEndDate: (value: string) => void;
  startRequired?: boolean;
  error?: string | null;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <div className="grid min-w-0 grid-cols-2 gap-3">
        <FormField label="開始日" htmlFor={`${idPrefix}-start`} required={startRequired}>
          <Input
            id={`${idPrefix}-start`}
            type="date"
            value={startDate}
            onChange={(event) => onChangeStartDate(event.target.value)}
          />
        </FormField>
        <FormField label="終了日" htmlFor={`${idPrefix}-end`}>
          <Input
            id={`${idPrefix}-end`}
            type="date"
            value={endDate}
            onChange={(event) => onChangeEndDate(event.target.value)}
          />
        </FormField>
      </div>
      <p className="text-xs text-ink-3">空欄で無期限になります。</p>
      {error ? (
        <p role="alert" className="text-xs font-medium text-critical">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * 口座選択。未選択プレースホルダと通貨フィルタを内蔵する。
 */
export function AccountSelect({
  id,
  label,
  accounts,
  value,
  onChange,
  currencyFilter,
  excludeAccountId,
  required = true,
  disabled = false,
  placeholder = "口座を選択",
}: {
  id: string;
  label: string;
  accounts: Account[];
  value: string;
  onChange: (accountId: string) => void;
  currencyFilter?: SupportedCurrencyCode;
  excludeAccountId?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const options = accounts.filter(
    (account) =>
      (!currencyFilter || account.currencyCode === currencyFilter) && account.id !== excludeAccountId,
  );

  return (
    <FormField label={label} htmlFor={id} required={required}>
      <Select id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </Select>
    </FormField>
  );
}

/**
 * 土日祝の扱い。固定収支/ローン/クレカの 3 複製を解消する共有部品。
 */
export function DateShiftField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: DateShiftPolicy;
  onChange: (value: DateShiftPolicy) => void;
}) {
  return (
    <FormField label="土日祝の扱い" htmlFor={id}>
      <Select id={id} value={value} onChange={(event) => onChange(event.target.value as DateShiftPolicy)}>
        <option value="none">シフトなし</option>
        <option value="previous">前営業日</option>
        <option value="next">後営業日</option>
      </Select>
    </FormField>
  );
}
