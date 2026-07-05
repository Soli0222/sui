import type { DashboardResponse } from "@sui/shared";
import type { PropsWithChildren } from "react";
import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { OfflineBanner } from "./offline-banner";
import { apiFetch } from "../lib/api";
import { cn } from "../lib/utils";
import {
  BarChart3,
  Landmark,
  LayoutGrid,
  ListChecks,
  Repeat,
  Settings,
  Wallet,
} from "lucide-react";

type NavItem = { to: string; label: string; icon: typeof Wallet };
type NavGroup = { heading: string; items: NavItem[]; muted?: boolean };

const navGroups: NavGroup[] = [
  { heading: "毎日見る", items: [{ to: "/", label: "ダッシュボード", icon: LayoutGrid }] },
  { heading: "記録", items: [{ to: "/transactions", label: "取引履歴", icon: ListChecks }] },
  {
    heading: "資産と負債",
    items: [
      { to: "/accounts", label: "口座管理", icon: Wallet },
      { to: "/credit-cards", label: "クレカ管理", icon: Landmark },
      { to: "/loans", label: "ローン管理", icon: Landmark },
    ],
  },
  {
    heading: "定期",
    items: [
      { to: "/recurring", label: "固定収支", icon: Repeat },
      { to: "/subscriptions", label: "サブスク", icon: Repeat },
    ],
  },
  { heading: "システム", items: [{ to: "/data", label: "データ管理", icon: Settings }], muted: true },
];

const allNavItems = navGroups.flatMap((group) => group.items);

// モバイル下部タブバー。ハンバーガー＋2 列グリッドの代わりに、週次ループに沿う 4 項目のみを常設する。
const mobileTabs: Array<{ key: string; label: string; icon: typeof Wallet; to?: string; groupItems?: NavItem[] }> = [
  { key: "dashboard", label: "ダッシュボード", icon: LayoutGrid, to: "/" },
  { key: "transactions", label: "取引", icon: ListChecks, to: "/transactions" },
  {
    key: "assets",
    label: "資産",
    icon: Wallet,
    groupItems: navGroups.find((group) => group.heading === "資産と負債")?.items,
  },
  {
    key: "more",
    label: "その他",
    icon: BarChart3,
    groupItems: [
      ...(navGroups.find((group) => group.heading === "定期")?.items ?? []),
      ...(navGroups.find((group) => group.heading === "システム")?.items ?? []),
    ],
  },
];

/** サイドバーのダッシュボード項目に出す未確定（予定日超過）件数。取得失敗時は静かに省略する。 */
function useOverdueCount(pathname: string) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    apiFetch<DashboardResponse>("/api/dashboard?applyOffset=true")
      .then((response) => {
        if (active) {
          setCount(response.overdueForecast.length);
        }
      })
      .catch(() => {
        // バッジは補助情報なので、失敗しても画面を邪魔しない。
      });

    return () => {
      active = false;
    };
    // ページ遷移のたびに件数を追随させる（確定操作後の反映のため）。
  }, [pathname]);

  return count;
}

export function AppLayout({ children }: PropsWithChildren) {
  const [openTabKey, setOpenTabKey] = useState<string | null>(null);
  const { pathname } = useLocation();
  const overdueCount = useOverdueCount(pathname);
  const currentItem =
    allNavItems.find((item) => (item.to === "/" ? pathname === "/" : pathname.startsWith(item.to))) ?? allNavItems[0];

  return (
    <>
      <OfflineBanner />
      <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-4 px-3 py-3 pb-20 sm:px-4 sm:py-4 lg:flex-row lg:gap-6 lg:px-6 lg:py-6 lg:pb-6">
        <header className="rounded-[var(--radius-m)] border border-line bg-surface-1 p-3 lg:hidden">
          <div className="text-xs tracking-[0.24em] text-brand">sui</div>
          <div className="mt-1 truncate text-base font-semibold">{currentItem.label}</div>
        </header>

        <aside className="hidden w-60 shrink-0 rounded-[var(--radius-l)] border border-line bg-surface-1 p-5 lg:block">
          <div className="mb-6 text-xs tracking-[0.3em] text-brand">sui</div>
          <nav className="grid gap-5">
            {navGroups.map((group) => (
              <div key={group.heading} className="grid gap-1.5">
                <div className={cn("px-1 text-xs font-medium tracking-wide", group.muted ? "text-ink-3/70" : "text-ink-3")}>
                  {group.heading}
                </div>
                <div className="grid gap-1">
                  {group.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) =>
                        cn(
                          "flex min-w-0 items-center gap-2.5 rounded-[var(--radius-s)] px-3 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                          isActive
                            ? "bg-brand text-[#0B0E13]"
                            : group.muted
                              ? "text-ink-3 hover:bg-surface-2/70 hover:text-ink-2"
                              : "text-ink-2 hover:bg-surface-2/70 hover:text-ink",
                        )
                      }
                    >
                      <item.icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                      {item.to === "/" && overdueCount > 0 ? (
                        <span
                          aria-label={`未確定 ${overdueCount} 件`}
                          className="font-data ml-auto inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-warning/20 px-1.5 py-0.5 text-xs font-semibold text-warning"
                        >
                          {overdueCount}
                        </span>
                      ) : null}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">{children}</main>

        <nav
          aria-label="モバイルナビゲーション"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface-1 pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          <div className="grid grid-cols-4">
            {mobileTabs.map((tab) => {
              const isActive = tab.to
                ? tab.to === "/"
                  ? pathname === "/"
                  : pathname.startsWith(tab.to)
                : (tab.groupItems ?? []).some((item) => pathname.startsWith(item.to));

              if (tab.to) {
                return (
                  <NavLink
                    key={tab.key}
                    to={tab.to}
                    onClick={() => setOpenTabKey(null)}
                    className={cn(
                      "flex min-h-14 flex-col items-center justify-center gap-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset",
                      isActive ? "text-brand" : "text-ink-2",
                    )}
                  >
                    <span className="relative">
                      <tab.icon aria-hidden="true" className="h-5 w-5" />
                      {tab.to === "/" && overdueCount > 0 ? (
                        <span
                          aria-label={`未確定 ${overdueCount} 件`}
                          className="font-data absolute -right-2.5 -top-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-semibold leading-4 text-[#0B0E13]"
                        >
                          {overdueCount}
                        </span>
                      ) : null}
                    </span>
                    {tab.label}
                  </NavLink>
                );
              }

              return (
                <button
                  key={tab.key}
                  type="button"
                  aria-expanded={openTabKey === tab.key}
                  onClick={() => setOpenTabKey((current) => (current === tab.key ? null : tab.key))}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center gap-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset",
                    isActive || openTabKey === tab.key ? "text-brand" : "text-ink-2",
                  )}
                >
                  <tab.icon aria-hidden="true" className="h-5 w-5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
          {openTabKey ? (
            <div className="absolute inset-x-3 bottom-[calc(100%+0.5rem)] grid gap-1 rounded-[var(--radius-m)] border border-line bg-surface-1 p-2 shadow-[var(--elev-1)]">
              {mobileTabs
                .find((tab) => tab.key === openTabKey)
                ?.groupItems?.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setOpenTabKey(null)}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-2.5 rounded-[var(--radius-s)] px-3 py-2.5 text-sm font-medium transition",
                        isActive ? "bg-brand text-[#0B0E13]" : "text-ink-2 hover:bg-surface-2",
                      )
                    }
                  >
                    <item.icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                    {item.label}
                  </NavLink>
                ))}
            </div>
          ) : null}
        </nav>
      </div>
    </>
  );
}
