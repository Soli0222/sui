import type { PropsWithChildren } from "react";
import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "../lib/utils";

const navItems = [
  // 総合
  { to: "/", label: "ダッシュボード" },
  { to: "/transactions", label: "取引履歴" },
  // 資産
  { to: "/accounts", label: "口座管理" },
  // 負債
  { to: "/credit-cards", label: "クレカ管理" },
  { to: "/loans", label: "ローン管理" },
  // 定期
  { to: "/recurring", label: "固定収支" },
  { to: "/subscriptions", label: "サブスク" },
  { to: "/data", label: "データ管理" },
];

export function AppLayout({ children }: PropsWithChildren) {
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();
  const currentItem =
    navItems.find((item) => (item.to === "/" ? pathname === "/" : pathname.startsWith(item.to))) ?? navItems[0];

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-4 px-3 py-3 sm:px-4 sm:py-4 lg:flex-row lg:gap-6 lg:px-6 lg:py-6">
      <header className="rounded-[var(--radius-m)] border border-line bg-surface-1 p-3 lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs tracking-[0.24em] text-brand">sui</div>
            <div className="mt-1 truncate text-base font-semibold">{currentItem.label}</div>
          </div>
          <button
            type="button"
            aria-controls="mobile-nav"
            aria-expanded={navOpen}
            className="shrink-0 rounded-[var(--radius-s)] border border-line bg-surface-2 px-3 py-2 text-sm font-semibold text-ink transition hover:bg-surface-2/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            onClick={() => setNavOpen((value) => !value)}
          >
            メニュー
          </button>
        </div>
        {navOpen ? (
          <nav id="mobile-nav" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setNavOpen(false)}
                className={({ isActive }) =>
                  cn(
                    "min-w-0 rounded-[var(--radius-s)] px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                    isActive ? "bg-brand text-[#0B0E13]" : "bg-surface-2 text-ink-2 hover:bg-surface-2/70 hover:text-ink",
                  )
                }
              >
                <span className="block truncate">{item.label}</span>
              </NavLink>
            ))}
          </nav>
        ) : null}
      </header>
      <aside className="hidden w-72 shrink-0 rounded-[var(--radius-l)] border border-line bg-surface-1 p-5 lg:block">
        <div className="mb-8">
          <div className="text-xs tracking-[0.3em] text-brand">sui</div>
          <h1 className="mt-3 text-3xl font-semibold">可処分資産予測</h1>
          <p className="mt-2 text-sm text-ink-2">固定収支とクレカ請求を基準に残高推移を管理します。</p>
        </div>
        <nav className="grid gap-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "block min-w-0 rounded-[var(--radius-m)] px-4 py-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                  isActive ? "bg-brand text-[#0B0E13]" : "bg-surface-2 text-ink-2 hover:bg-surface-2/70 hover:text-ink",
                )
              }
            >
              <span className="block truncate">{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
