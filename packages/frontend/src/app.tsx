import { useEffect, useRef } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useRegisterSW } from "virtual:pwa-register/react";
import { AppLayout } from "./components/layout";
import { Toaster } from "./components/ui/toast";
import { useToast } from "./hooks/use-toast";
import { AccountsPage } from "./routes/accounts";
import { CreditCardsPage } from "./routes/credit-cards";
import { DataManagementPage } from "./routes/data-management";
import { DashboardPage } from "./routes/dashboard";
import { LoansPage } from "./routes/loans";
import { RecurringPage } from "./routes/recurring";
import { SubscriptionsPage } from "./routes/subscriptions";
import { TransactionsPage } from "./routes/transactions";

export function App() {
  return (
    <>
      <AppLayout>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/recurring" element={<RecurringPage />} />
          <Route path="/subscriptions" element={<SubscriptionsPage />} />
          <Route path="/credit-cards" element={<CreditCardsPage />} />
          <Route path="/loans" element={<LoansPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/data" element={<DataManagementPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppLayout>
      <PwaUpdatePrompt />
      <Toaster />
    </>
  );
}

/**
 * PWA 更新プロンプト。ステージ1のトースト基盤に統合し、専用の固定バナーは持たない
 * （B-1「更新プロンプト」）。新バージョン検知は一度きりのイベントなので、toast 発火も
 * hasNotifiedRef で一度だけに絞る。
 */
function PwaUpdatePrompt() {
  const { toast } = useToast();
  const hasNotifiedRef = useRef(false);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    if (!needRefresh || hasNotifiedRef.current) {
      return;
    }

    hasNotifiedRef.current = true;
    toast({
      title: "新しいバージョンがあります。",
      variant: "info",
      action: { label: "更新", onClick: () => void updateServiceWorker(true) },
    });
  }, [needRefresh, toast, updateServiceWorker]);

  return null;
}
