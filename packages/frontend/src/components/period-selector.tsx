import { Select } from "./ui/select";

export function PeriodSelector<TValue extends string>({
  presets,
  selected,
  onChange,
  ariaLabel = "期間を選択",
  className,
}: {
  presets: Array<{ value: TValue; label: string }>;
  selected: TValue;
  onChange: (value: TValue) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <Select
      aria-label={ariaLabel}
      className={className}
      value={selected}
      onChange={(event) => onChange(event.target.value as TValue)}
    >
      {presets.map((preset) => (
        <option key={preset.value} value={preset.value}>
          {preset.label}
        </option>
      ))}
    </Select>
  );
}
