import type { DashboardExplainResponse } from "@sui/shared";
import { Badge } from "../ui/badge";
import { CardList } from "../ui/card-list";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { Table, TableWrapper } from "../ui/table";
import { formatCurrency, formatDateWithYear, formatTypedAmount } from "../../lib/format";
import { StateMessage, formatSignedCurrency, getExplainSourceTotals, getForecastSourceLabel, getForecastTypeClassName, getForecastTypeLabel } from "./dashboard-display";

export type ExplainDialogState = {
  title: string; date: string; accountId?: string;
  data: DashboardExplainResponse | null; loading: boolean; error: string | null;
};

export function DashboardExplainDialog({ explainDialog, onClose }: {
  explainDialog: ExplainDialogState | null; onClose: () => void;
}) {
  return <>
      <Dialog
        open={Boolean(explainDialog)}
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
      >
        <DialogContent className="w-[min(96vw,64rem)]">
          <DialogTitle className="text-lg font-semibold">
            {explainDialog?.title ?? "寄与分解"}
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm text-ink-2">
            {explainDialog ? `${formatDateWithYear(explainDialog.date)} までの予測残高` : ""}
          </DialogDescription>
          <div className="mt-6">
            {explainDialog?.loading ? (
              <StateMessage message="読み込み中..." />
            ) : explainDialog?.error ? (
              <StateMessage message={explainDialog.error} tone="danger" />
            ) : explainDialog?.data ? (
              <div className="grid gap-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-line bg-surface-2 p-3">
                    <div className="text-xs font-medium text-ink-3">起点残高</div>
                    <div className="mt-2 font-data overflow-x-auto whitespace-nowrap text-lg font-semibold">
                      {formatCurrency(explainDialog.data.startBalance)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-line bg-surface-2 p-3">
                    <div className="text-xs font-medium text-ink-3">指定日残高</div>
                    <div className="mt-2 font-data overflow-x-auto whitespace-nowrap text-lg font-semibold">
                      {formatCurrency(explainDialog.data.finalBalance)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-line bg-surface-2 p-3">
                    <div className="text-xs font-medium text-ink-3">仮定値</div>
                    <div className="mt-2 text-lg font-semibold">
                      {explainDialog.data.assumptionEventCount} 件
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="mb-3 text-sm font-semibold text-ink-2">source 別小計</h3>
                  <div className="grid gap-2 sm:grid-cols-5">
                    {getExplainSourceTotals(explainDialog.data.sourceTotals).map((item) => (
                      <div key={item.label} className="rounded-xl border border-line bg-surface-2 p-3">
                        <div className="break-words text-xs text-ink-3">{item.label}</div>
                        <div className="mt-1 font-data overflow-x-auto whitespace-nowrap text-sm font-semibold">
                          {formatSignedCurrency(item.value)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="mb-3 text-sm font-semibold text-ink-2">寄与イベント</h3>
                  {explainDialog.data.events.length === 0 ? (
                    <StateMessage message="対象期間の寄与イベントはありません。" />
                  ) : (
                    <><TableWrapper className="hidden max-h-[45dvh] overflow-y-auto rounded-xl border border-line lg:block">
                      <Table className="min-w-[52rem]">
                        <thead>
                          <tr className="border-b border-line text-left text-xs font-medium text-ink-3">
                            <th scope="col" className="px-3 py-3">日付</th>
                            <th scope="col" className="px-3 py-3">種別</th>
                            <th scope="col" className="px-3 py-3">source</th>
                            <th scope="col" className="px-3 py-3">内容</th>
                            <th scope="col" className="px-3 py-3 text-right">金額</th>
                            <th scope="col" className="px-3 py-3 text-right">残高</th>
                          </tr>
                        </thead>
                        <tbody>
                          {explainDialog.data.events.map((event) => (
                            <tr key={event.id} className="border-b border-line">
                              <td className="whitespace-nowrap px-3 py-3 text-ink-2">
                                {formatDateWithYear(event.date)}
                              </td>
                              <td className="whitespace-nowrap px-3 py-3">
                                <span className={getForecastTypeClassName(event.type)}>
                                  {getForecastTypeLabel(event.type)}
                                </span>
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 text-ink-2">
                                {getForecastSourceLabel(event.source)}
                              </td>
                              <td className="min-w-48 px-3 py-3">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                  <span className="break-words">{event.description}</span>
                                  {event.isAssumption ? <Badge tone="warning">仮定</Badge> : null}
                                </div>
                              </td>
                              <td className="font-data whitespace-nowrap px-3 py-3 text-right">
                                {formatTypedAmount(event.type, event.amountJpy)}
                              </td>
                              <td className="font-data whitespace-nowrap px-3 py-3 text-right">
                                {formatCurrency(event.runningBalance)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </TableWrapper><div className="lg:hidden"><CardList rows={explainDialog.data.events} rowKey={(event) => event.id}
                      renderItem={(event) => <>
                        <div className="flex min-w-0 flex-wrap items-center gap-2"><span className="break-words font-medium">{event.description}</span>{event.isAssumption && <Badge tone="warning">仮定</Badge>}</div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-3"><span>{formatDateWithYear(event.date)}</span><span>{getForecastTypeLabel(event.type)}</span><span>source {getForecastSourceLabel(event.source)}</span></div>
                        <div className="flex flex-wrap justify-between gap-2 font-data text-xs"><span className="whitespace-nowrap">金額 {formatTypedAmount(event.type, event.amountJpy)}</span><span className="whitespace-nowrap">残高 {formatCurrency(event.runningBalance)}</span></div>
                      </>} /></div></>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

  </>;
}
