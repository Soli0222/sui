import type { Account, ForecastEvent } from "@sui/shared";
import type { Dispatch, SetStateAction } from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { CardList } from "../ui/card-list";
import { MoneyInput } from "../ui/money-input";
import { Select } from "../ui/select";
import { Switch } from "../ui/switch";
import { formatCurrency, formatDateWithYear } from "../../lib/format";
import { confirmationAmount, type ConfirmationDraft } from "../../routes/dashboard-confirmation";
import { createOverdueConfirmDraft } from "../../hooks/use-dashboard-confirmation";
import { formatForecastAccounts, getForecastTypeClassName, getForecastTypeLabel } from "./dashboard-display";

export function OverdueQueue({ accounts, visibleOverdueForecast, staleOverdueIds, overdueDrafts,
  setOverdueDrafts, optimisticConfirmedIds, isBatchConfirming, isQueueCollapsed, setIsQueueCollapsed,
  selectedOverdueCount, updateOverdueDraft, openConfirm, handleBatchConfirm }: {
  accounts: Account[]; visibleOverdueForecast: ForecastEvent[]; staleOverdueIds: string[];
  overdueDrafts: Record<string, ConfirmationDraft>;
  setOverdueDrafts: Dispatch<SetStateAction<Record<string, ConfirmationDraft>>>;
  optimisticConfirmedIds: string[]; isBatchConfirming: boolean;
  isQueueCollapsed: boolean; setIsQueueCollapsed: Dispatch<SetStateAction<boolean>>;
  selectedOverdueCount: number;
  updateOverdueDraft: (event: ForecastEvent, draft: Partial<Omit<ConfirmationDraft, "error">>) => void;
  openConfirm: (event: ForecastEvent) => void; handleBatchConfirm: () => Promise<void>;
}) {
  return <>
      {staleOverdueIds.length > 0 ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-warning">
        {staleOverdueIds.length} 件の確定draftで予定が変更または表示対象外になりました。金額と口座を再確認してください。
        <Button variant="ghost" onClick={() => setOverdueDrafts((current) => {
          const next = { ...current };
          for (const id of staleOverdueIds) delete next[id];
          return next;
        })}>該当行の入力を破棄して予定額に戻す</Button>
      </div> : null}
      {visibleOverdueForecast.length > 0 ? (
        <Card className="reveal-stage-3">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">確定キュー</h2>
              <Badge tone="warning">{visibleOverdueForecast.length} 件</Badge>
            </div>
            <Button variant="ghost" onClick={() => setIsQueueCollapsed((value) => !value)}>
              {isQueueCollapsed ? "開く" : "閉じる"}
            </Button>
          </div>
          <p className="mb-4 max-w-4xl text-sm text-ink-2">
            予定日を過ぎた未確定イベントです。予定額と実績額が一致するとは限らないため、実際の金額と対象口座を確認して確定してください。
          </p>
          {isQueueCollapsed ? null : (
            <>
              <CardList rows={visibleOverdueForecast} rowKey={(event) => event.id}
                renderItem={(event) => {
                  const draft = overdueDrafts[event.id] ?? createOverdueConfirmDraft(event, accounts);
                  const isConfirmed = optimisticConfirmedIds.includes(event.id);
                  return <>
                    <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                      <div className="min-w-0">
                        <div className="break-words font-medium">{event.description}</div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2">
                          <span className="whitespace-nowrap">予定日 {formatDateWithYear(event.date)}</span>
                          <span className={getForecastTypeClassName(event.type)}>{getForecastTypeLabel(event.type)}</span>
                        </div>
                      </div>
                      <div className="sm:text-right"><div className="text-xs text-ink-3">予定額</div>
                        <div className="font-data whitespace-nowrap font-semibold">{formatCurrency(event.amount, event.currencyCode)}</div></div>
                    </div>
                    <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:items-end">
                      <label className="grid min-w-0 gap-1"><span className="text-xs text-ink-3">実額入力</span>
                        <MoneyInput aria-label={`${event.description} の実際の金額`}
                          value={confirmationAmount(draft.amountRaw, event.currencyCode)} draftValue={draft.amountRaw}
                          draftKey={event.id} currencyCode={event.currencyCode}
                          onDraftChange={(next) => updateOverdueDraft(event, { amountRaw: next.raw })}
                          onChange={() => {}} disabled={isBatchConfirming || isConfirmed} />
                      </label>
                      <label className="grid min-w-0 gap-1"><span className="text-xs text-ink-3">対象口座</span>
                        {event.type === "transfer" ? (
                          <Select aria-label={`${event.description} の対象口座`} value="fixed" className="min-w-0" disabled>
                            <option value="fixed">{formatForecastAccounts(event, accounts)}</option>
                          </Select>
                        ) : (
                          <Select aria-label={`${event.description} の対象口座`} value={draft.accountId}
                            onChange={(changeEvent) => updateOverdueDraft(event, { accountId: changeEvent.target.value })}
                            className="min-w-0" disabled={isBatchConfirming || isConfirmed}>
                            <option value="">イベント設定口座を使用</option>
                            {accounts.filter((account) => account.currencyCode === event.currencyCode).map((account) =>
                              <option key={account.id} value={account.id}>{account.name}</option>)}
                          </Select>
                        )}
                      </label>
                    </div>
                    <div className="break-words text-xs text-ink-2">{event.type === "transfer" ? "振替元・先" : "予定の対象口座"} {formatForecastAccounts(event, accounts)}</div>
                    {draft.error && !isConfirmed ? <div role="alert" className="break-words text-xs text-critical">{draft.error}</div> : null}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                      <label className="flex items-center gap-2 text-xs text-ink-2">選択
                        <Switch aria-label={`${event.description} を確定対象にする`} checked={draft.selected}
                          onChange={(selected) => updateOverdueDraft(event, { selected })}
                          disabled={isBatchConfirming || isConfirmed} />
                      </label>
                      {isConfirmed ? <span className="text-xs text-ink-3">確定済み</span> :
                        <Button variant="ghost" disabled={isBatchConfirming} onClick={() => openConfirm(event)}>
                          {event.description}を確認
                        </Button>}
                    </div>
                  </>;
                }} />
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-ink-2">
                  選択中 {selectedOverdueCount} / {visibleOverdueForecast.length} 件
                </div>
                <Button onClick={handleBatchConfirm} disabled={isBatchConfirming || selectedOverdueCount === 0}>
                  選択した {selectedOverdueCount} 件を確定
                </Button>
              </div>
            </>
          )}
        </Card>
      ) : null}

  </>;
}
