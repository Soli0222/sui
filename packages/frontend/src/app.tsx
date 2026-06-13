import { Navigate, Route, Routes } from "react-router-dom";
import { useRegisterSW } from "virtual:pwa-register/react";
import { AppLayout } from "./components/layout";
import { Button } from "./components/ui/button";
import { AccountsPage } from "./routes/accounts";
import { CreditCardsPage } from "./routes/credit-cards";
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppLayout>
      <PwaUpdatePrompt />
    </>
  );
}

function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) {
    return null;
  }

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-xl flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-card/95 p-3 text-sm shadow-glow backdrop-blur">
      <span className="min-w-0 break-words text-white/80">新しいバージョンがあります。</span>
      <Button className="min-h-10" onClick={() => void updateServiceWorker(true)}>
        更新
      </Button>
    </div>
  );
}
