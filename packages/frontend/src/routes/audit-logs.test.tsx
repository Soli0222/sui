import type { AuditLogEntry, AuditLogsResponse } from "@sui/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppLayout } from "../components/layout";
import { AuditLogsPage } from "./audit-logs";

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

function mockFetchWith(handler: (url: string) => Promise<unknown>) {
  globalThis.fetch = vi.fn().mockImplementation((url: string) => handler(url));
}

function createAuditLogEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: "11111111-1111-4111-a111-111111111111",
    createdAt: "2026-07-01T09:00:00.000Z",
    method: "POST",
    path: "/api/accounts",
    status: 201,
    clientSource: "web",
    requestId: "req-1",
    authKind: "session",
    subject: "user-1",
    sessionId: "sess-1",
    apiTokenId: null,
    authMode: "enabled",
    ...overrides,
  };
}

function createResponse(page: number, total: number, items: AuditLogEntry[]): AuditLogsResponse {
  return { page, limit: 50, total, items };
}

function createPagedResponse(page: number, total = 51): AuditLogsResponse {
  if (page === 1) {
    return createResponse(
      1,
      total,
      Array.from({ length: 50 }, (_, index) =>
        createAuditLogEntry({
          id: `log-${index}`,
          createdAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        }),
      ),
    );
  }

  if (page === 2) {
    return createResponse(
      2,
      total,
      [createAuditLogEntry({ id: `log-50`, createdAt: "2026-08-20T00:00:00.000Z" })],
    );
  }

  return createResponse(page, total, []);
}

function extractPage(url: string) {
  const match = url.match(/page=(\d+)/);
  return match ? Number(match[1]) : 1;
}

function renderWithRouter(children: React.ReactNode, initialEntries: string[] = ["/audit-logs"]) {
  return render(<MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>);
}

beforeEach(() => {
  // ResponsiveTable の desktop 表示を保つ。
  // テスト環境では window.matchMedia が存在しないため、デフォルトで desktop になる。
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).matchMedia;
});

describe("AuditLogsPage", () => {
  it("ページパラメータを URL から読み取り、page=2 を API に送る", async () => {
    mockFetchWith((url) =>
      url.startsWith("/api/audit-logs")
        ? Promise.resolve(jsonResponse(createPagedResponse(extractPage(url))))
        : Promise.resolve(jsonResponse({ error: "not found" }, 404)),
    );

    renderWithRouter(<AuditLogsPage />, ["/audit-logs?page=2"]);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/audit-logs?page=2&limit=50",
        expect.any(Object),
      );
    });

    expect(screen.getByText("2 / 2 ページ")).toBeVisible();
  });

  it("ステータス・メソッド・パス・認証情報を表示し、null 項目は - とする", async () => {
    mockFetchWith(() =>
      Promise.resolve(
        jsonResponse(
          createResponse(1, 1, [
            createAuditLogEntry({
              requestId: null,
              sessionId: null,
              apiTokenId: null,
              authKind: null,
              authMode: null,
              subject: null,
            }),
          ]),
        ),
      ),
    );

    renderWithRouter(<AuditLogsPage />);

    await waitFor(() => {
      expect(screen.getByText("POST")).toBeVisible();
    });

    expect(screen.getByText("/api/accounts")).toBeVisible();
    expect(screen.getByText("201")).toBeVisible();
    expect(screen.getByText("web")).toBeVisible();

    const dashes = screen.getAllByText("-");
    expect(dashes.length).toBeGreaterThanOrEqual(6);
  });

  it("createdAt を JST の ja-JP 形式で表示する", async () => {
    mockFetchWith(() =>
      Promise.resolve(jsonResponse(createResponse(1, 1, [createAuditLogEntry()]))),
    );

    renderWithRouter(<AuditLogsPage />);

    await waitFor(() => {
      expect(screen.getByText("2026年7月1日 18:00:00")).toBeVisible();
    });
  });

  it("不正な createdAt でもクラッシュせず、生の値を表示する", async () => {
    mockFetchWith(() =>
      Promise.resolve(
        jsonResponse(
          createResponse(1, 1, [createAuditLogEntry({ createdAt: "not-a-date" })]),
        ),
      ),
    );

    renderWithRouter(<AuditLogsPage />);

    await waitFor(() => {
      expect(screen.getByText("not-a-date")).toBeVisible();
    });

    expect(screen.queryByText("監査ログはありません。")).not.toBeInTheDocument();
  });

  it("読み込み中は読み込み中と表示し、読み終わると一覧を表示する", async () => {
    let resolve!: (value: unknown) => void;
    const promise = new Promise<unknown>((nextResolve) => {
      resolve = nextResolve;
    });

    mockFetchWith(() => promise);

    renderWithRouter(<AuditLogsPage />);

    await waitFor(() => {
      expect(screen.getByText("読み込み中...")).toBeVisible();
    });

    resolve(jsonResponse(createResponse(1, 1, [createAuditLogEntry()])));

    await waitFor(() => {
      expect(screen.getByText("POST")).toBeVisible();
    });

    expect(screen.queryByText("読み込み中...")).not.toBeInTheDocument();
  });

  it("エラー時はエラーメッセージを表示し、再試行できる", async () => {
    mockFetchWith(() => Promise.resolve(jsonResponse({ error: "取得に失敗しました" }, 500)));

    renderWithRouter(<AuditLogsPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("取得に失敗しました");
    });

    expect(screen.queryByText("監査ログはありません。")).not.toBeInTheDocument();

    mockFetchWith(() =>
      Promise.resolve(jsonResponse(createResponse(1, 1, [createAuditLogEntry()]))),
    );

    fireEvent.click(screen.getByRole("button", { name: "再試行" }));

    await waitFor(() => {
      expect(screen.getByText("POST")).toBeVisible();
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("空の場合は空のメッセージを表示する", async () => {
    mockFetchWith(() => Promise.resolve(jsonResponse(createResponse(1, 0, []))));

    renderWithRouter(<AuditLogsPage />);

    await waitFor(() => {
      expect(screen.getByText("監査ログはありません。")).toBeVisible();
    });

    expect(screen.getByText("1 / 1 ページ")).toBeVisible();
  });

  it("51 件以上でページネーションの境界が正しく動作し、前へで戻れる", async () => {
    mockFetchWith((url) =>
      Promise.resolve(jsonResponse(createPagedResponse(extractPage(url)))),
    );

    renderWithRouter(<AuditLogsPage />);

    await waitFor(() => {
      expect(screen.getByText("1 / 2 ページ")).toBeVisible();
    });

    expect(screen.getByRole("button", { name: "前へ" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "次へ" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "次へ" }));

    await waitFor(() => {
      expect(screen.getByText("2 / 2 ページ")).toBeVisible();
    });

    expect(screen.getByRole("button", { name: "前へ" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "次へ" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "前へ" }));

    await waitFor(() => {
      expect(screen.getByText("1 / 2 ページ")).toBeVisible();
    });

    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      "/api/audit-logs?page=1&limit=50",
      expect.any(Object),
    );
  });

  it("モバイル表示でも全フィールドを表示する", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).matchMedia = vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    mockFetchWith(() =>
      Promise.resolve(
        jsonResponse(
          createResponse(1, 1, [
            createAuditLogEntry({
              method: "DELETE",
              path: "/api/accounts/11111111-1111-4111-a111-111111111111",
              status: 204,
              clientSource: "mcp",
              requestId: null,
              sessionId: "long-session-id-that-needs-wrapping",
              apiTokenId: null,
            }),
          ]),
        ),
      ),
    );

    renderWithRouter(<AuditLogsPage />);

    await waitFor(() => {
      expect(screen.getByText("DELETE")).toBeVisible();
    });

    expect(screen.getByText("/api/accounts/11111111-1111-4111-a111-111111111111")).toBeVisible();
    expect(screen.getByText("mcp")).toBeVisible();
    expect(screen.getByText("long-session-id-that-needs-wrapping")).toBeVisible();
    expect(screen.getByText("204")).toBeVisible();
  });
});

describe("navigation", () => {
  it("サイドバーとモバイル その他 メニューに 監査ログ へのリンクがある", async () => {
    render(
      <MemoryRouter initialEntries={["/audit-logs"]}>
        <AppLayout>
          <div data-testid="page" />
        </AppLayout>
      </MemoryRouter>,
    );

    const moreButton = screen.getByRole("button", { name: "その他" });
    fireEvent.click(moreButton);

    const links = await waitFor(() => screen.getAllByRole("link", { name: "監査ログ" }));
    expect(links.length).toBeGreaterThanOrEqual(1);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/audit-logs");
    }
  });
});
