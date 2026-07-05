export function OffsetToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex max-w-full min-w-0 cursor-pointer items-center gap-3 rounded-[var(--radius-s)] border border-line bg-surface-2 px-4 py-2 text-sm">
      <input
        type="checkbox"
        className="h-4 w-4 shrink-0 accent-[var(--color-brand)]"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="min-w-0 truncate">残高オフセットを適用</span>
    </label>
  );
}
