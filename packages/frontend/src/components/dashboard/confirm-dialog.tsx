import type { Account, ForecastEvent } from "@sui/shared";
import { Button } from "../ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { MoneyInput } from "../ui/money-input";
import { Select } from "../ui/select";
import { formatDateWithYear, formatTypedAmount } from "../../lib/format";
import { formatForecastAccounts, isTransferEvent } from "./dashboard-display";

export function DashboardConfirmDialog({ selectedEvent, accounts, confirmAmount, confirmRaw, accountId,
  isConfirming, updateConfirmDraft, handleConfirm, closeConfirm }: {
  selectedEvent: ForecastEvent | null; accounts: Account[]; confirmAmount: number | null;
  confirmRaw: string; accountId: string; isConfirming: boolean;
  updateConfirmDraft: (draft: { amountRaw?: string; accountId?: string }) => void;
  handleConfirm: () => Promise<void>; closeConfirm: () => void;
}) {
  return <>
      <Dialog
        open={Boolean(selectedEvent)}
        onOpenChange={(open) => {
          if (!open) {
            closeConfirm();
          }
        }}
      >
        <DialogContent className="inset-x-0 bottom-0 left-0 top-auto w-full max-w-none translate-x-0 translate-y-0 rounded-b-none rounded-t-[var(--radius-l)] pb-[max(1rem,env(safe-area-inset-bottom))] sm:inset-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[min(94vw,32rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[var(--radius-l)]">
          <DialogTitle className="text-lg font-semibold">予測イベントを確定</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-ink-2">
            予定額と実績額が一致するとは限らないため、自動確定せず手動で確認します。必要なら金額を変更できます。
            収入・支出イベントでは口座も変更できます。
          </DialogDescription>
          <div className="mt-6 grid gap-4">
            <div className="rounded-2xl bg-surface-2 p-4 text-sm">
              {selectedEvent && (
                <>
                  <div>{selectedEvent.description}</div>
                  <div className="mt-1 text-ink-2">
                    {formatDateWithYear(selectedEvent.date)} /{" "}
                    {selectedEvent.currencyCode === "JPY"
                      ? formatTypedAmount(selectedEvent.type, selectedEvent.amount, selectedEvent.currencyCode)
                      : `${formatTypedAmount(selectedEvent.type, selectedEvent.amount, selectedEvent.currencyCode)}（${formatTypedAmount(selectedEvent.type, selectedEvent.amountJpy, "JPY")}）`}
                  </div>
                </>
              )}
            </div>
            <label className="grid gap-2 text-sm">
              <span>実際の金額</span>
              <MoneyInput
                key={selectedEvent?.id}
                value={confirmAmount}
                draftValue={confirmRaw}
                draftKey={selectedEvent?.id}
                currencyCode={selectedEvent?.currencyCode}
                onDraftChange={(draft) => updateConfirmDraft({ amountRaw: draft.raw })}
                onChange={() => {}}
                disabled={isConfirming}
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span>対象口座</span>
              {isTransferEvent(selectedEvent) && selectedEvent ? (
                <Select value="fixed" disabled>
                  <option value="fixed">{formatForecastAccounts(selectedEvent, accounts)}</option>
                </Select>
              ) : (
                <Select value={accountId} onChange={(event) => updateConfirmDraft({ accountId: event.target.value })}>
                  <option value="">イベント設定口座を使用</option>
                  {accounts
                    .filter((account) => !selectedEvent || account.currencyCode === selectedEvent.currencyCode)
                    .map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                </Select>
              )}
            </label>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <DialogClose asChild>
                <Button variant="ghost" className="w-full sm:w-auto">
                  閉じる
                </Button>
              </DialogClose>
              <Button onClick={handleConfirm} disabled={isConfirming} className="w-full sm:w-auto">
                確定する
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
  </>;
}
