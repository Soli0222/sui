import { Switch } from "./ui/switch";

const label = "可処分残高で表示";
const description = "オフセット分を差し引いた可処分残高で計算します（オフのときは実残高で計算します）。";

/**
 * 用語統一（P9）: 「残高オフセットを適用」という、何が起きるか分からない文言をやめ、
 * 何が表示されるかを言い切る（可処分残高／実残高の切替であることを明示する）。
 */
export function OffsetToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div
      className="flex max-w-full min-w-0 items-center gap-3 rounded-[var(--radius-s)] border border-line bg-surface-2 px-4 py-2 text-sm"
      title={description}
    >
      <span className="min-w-0 truncate">{label}</span>
      <Switch checked={checked} onChange={onChange} aria-label={`${label}。${description}`} />
    </div>
  );
}
