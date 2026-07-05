import { Switch } from "./ui/switch";

export function OffsetToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex max-w-full min-w-0 items-center gap-3 rounded-[var(--radius-s)] border border-line bg-surface-2 px-4 py-2 text-sm">
      <span className="min-w-0 truncate">残高オフセットを適用</span>
      <Switch checked={checked} onChange={onChange} aria-label="残高オフセットを適用" />
    </div>
  );
}
