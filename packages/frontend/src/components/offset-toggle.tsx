export function OffsetToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm">
      <input
        type="checkbox"
        className="h-4 w-4 accent-[var(--color-primary)]"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>残高オフセットを適用</span>
    </label>
  );
}
