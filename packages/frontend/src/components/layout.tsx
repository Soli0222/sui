import type { PropsWithChildren } from "react";
import { NavLink } from "react-router-dom";
import { cn } from "../lib/utils";

const navItems = [
  { to: "/", label: "ダッシュボード" },
  { to: "/accounts", label: "口座管理" },
  { to: "/recurring", label: "固定収支" },
  { to: "/subscriptions", label: "サブスク" },
  { to: "/credit-cards", label: "クレカ管理" },
  { to: "/loans", label: "ローン管理" },
  { to: "/transactions", label: "取引履歴" },
];

export function AppLayout({ children }: PropsWithChildren) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-6 px-4 py-6 lg:flex-row lg:px-6">
      <aside className="w-full shrink-0 rounded-3xl border border-white/10 bg-black/20 p-5 backdrop-blur lg:w-72">
        <div className="mb-8">
          <div className="text-xs uppercase tracking-[0.3em] text-primary">sui</div>
          <h1 className="mt-3 text-3xl font-semibold">可処分資産予測</h1>
          <p className="mt-2 text-sm text-white/60">固定収支とクレカ請求を基準に残高推移を管理します。</p>
        </div>
        <nav className="grid gap-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "rounded-2xl px-4 py-3 text-sm font-medium transition",
                  isActive ? "bg-primary text-black" : "bg-white/5 text-white/75 hover:bg-white/10",
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
