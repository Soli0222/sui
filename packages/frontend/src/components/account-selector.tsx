import type { Account } from "@sui/shared";
import { Button } from "./ui/button";

export function AccountSelector({
  accounts,
  selected,
  onChange,
}: {
  accounts: Pick<Account, "id" | "name">[];
  selected: string | "total";
  onChange: (id: string | "total") => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant={selected === "total" ? "primary" : "ghost"} onClick={() => onChange("total")}>
        全体
      </Button>
      {accounts.map((account) => (
        <Button
          key={account.id}
          variant={selected === account.id ? "primary" : "ghost"}
          onClick={() => onChange(account.id)}
        >
          {account.name}
        </Button>
      ))}
    </div>
  );
}
