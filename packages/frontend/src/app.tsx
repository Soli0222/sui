import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/layout";
import { AccountsPage } from "./routes/accounts";
import { CreditCardsPage } from "./routes/credit-cards";
import { DashboardPage } from "./routes/dashboard";
import { LoansPage } from "./routes/loans";
import { RecurringPage } from "./routes/recurring";
import { TransactionsPage } from "./routes/transactions";

export function App() {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="/recurring" element={<RecurringPage />} />
        <Route path="/credit-cards" element={<CreditCardsPage />} />
        <Route path="/loans" element={<LoansPage />} />
        <Route path="/transactions" element={<TransactionsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppLayout>
  );
}
