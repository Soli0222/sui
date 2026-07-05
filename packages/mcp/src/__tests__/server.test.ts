import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { FetchLike } from "../api-client";
import { SuiApiClient } from "../api-client";
import { buildServer } from "../server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

interface RouteResponse {
  status?: number;
  body?: unknown;
}

function getResourceText(
  content: { uri: string; text: string } | { uri: string; blob: string } | undefined,
) {
  if (!content || !("text" in content)) {
    return "";
  }
  return content.text;
}

function getToolText(result: unknown) {
  if (
    typeof result !== "object" ||
    result === null ||
    !("content" in result) ||
    !Array.isArray(result.content) ||
    result.content.length === 0 ||
    typeof result.content[0] !== "object" ||
    result.content[0] === null ||
    !("text" in result.content[0]) ||
    typeof result.content[0].text !== "string"
  ) {
    return "";
  }

  return result.content[0].text;
}

function getPromptText(result: unknown) {
  if (
    typeof result !== "object" ||
    result === null ||
    !("messages" in result) ||
    !Array.isArray(result.messages) ||
    result.messages.length === 0
  ) {
    return "";
  }

  const message = result.messages[0];
  if (
    typeof message !== "object" ||
    message === null ||
    !("content" in message) ||
    typeof message.content !== "object" ||
    message.content === null ||
    !("type" in message.content) ||
    message.content.type !== "text" ||
    !("text" in message.content) ||
    typeof message.content.text !== "string"
  ) {
    return "";
  }

  return message.content.text;
}

function getStructuredContent(result: unknown) {
  if (typeof result !== "object" || result === null || !("structuredContent" in result)) {
    return undefined;
  }

  return result.structuredContent;
}

const rawJsonKeyPattern = /"[^"\n]+":/;

const deleteToolCases = [
  {
    tool: "delete_account",
    id: "11111111-1111-4111-a111-111111111111",
    previewPath: "/api/accounts",
    deletePath: "/api/accounts/11111111-1111-4111-a111-111111111111",
    summary: "Main",
  },
  {
    tool: "delete_transaction",
    id: "33333333-3333-4333-a333-333333333333",
    previewPath: "/api/transactions?page=1&limit=100",
    deletePath: "/api/transactions/33333333-3333-4333-a333-333333333333",
    summary: "ランチ",
  },
  {
    tool: "delete_recurring_item",
    id: "66666666-6666-4666-a666-666666666666",
    previewPath: "/api/recurring-items",
    deletePath: "/api/recurring-items/66666666-6666-4666-a666-666666666666",
    summary: "家賃",
  },
  {
    tool: "delete_subscription",
    id: "77777777-7777-4777-a777-777777777777",
    previewPath: "/api/subscriptions",
    deletePath: "/api/subscriptions/77777777-7777-4777-a777-777777777777",
    summary: "Cloud",
  },
  {
    tool: "delete_credit_card",
    id: "44444444-4444-4444-8444-444444444444",
    previewPath: "/api/credit-cards",
    deletePath: "/api/credit-cards/44444444-4444-4444-8444-444444444444",
    summary: "Visa",
  },
  {
    tool: "delete_loan",
    id: "55555555-5555-4555-8555-555555555555",
    previewPath: "/api/loans",
    deletePath: "/api/loans/55555555-5555-4555-8555-555555555555",
    summary: "PCローン",
  },
] as const;

function createFetchStub() {
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  const routes = new Map<string, RouteResponse>();

  const addRoute = (method: string, path: string, response: RouteResponse) => {
    routes.set(`${method} ${path}`, response);
  };

  const fetchImpl: FetchLike = async (input, init) => {
    const url = typeof input === "string" || input instanceof URL ? new URL(input.toString()) : new URL(input.url);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;

    requests.push({
      method,
      path: `${url.pathname}${url.search}`,
      body,
    });

    const response = routes.get(`${method} ${url.pathname}${url.search}`);
    if (!response) {
      return new Response(JSON.stringify({ error: `Unhandled route: ${method} ${url.pathname}${url.search}` }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(response.body === undefined ? null : JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: response.body === undefined ? undefined : { "content-type": "application/json" },
    });
  };

  return { addRoute, fetchImpl, requests };
}

describe("MCP server", () => {
  let client: Client;
  let server: ReturnType<typeof buildServer>;
  let addRoute: (method: string, path: string, response: RouteResponse) => void;

  beforeEach(async () => {
    const fetchStub = createFetchStub();
    addRoute = fetchStub.addRoute;
    const { fetchImpl, requests } = fetchStub;
    addRoute("GET", "/api/dashboard", {
      body: {
        totalBalance: 123456,
        minBalance: 34567,
        nextIncome: {
          id: "recurring:income",
          date: "2026-03-25",
          description: "給与",
          amount: 250000,
        },
        nextExpense: {
          id: "credit-card:expense",
          date: "2026-03-27",
          description: "家賃",
          amount: 80000,
        },
        overdueForecast: [
          {
            id: "overdue-1",
            date: "2026-03-01",
            type: "expense",
            description: "水道代",
            amount: 8000,
            amountJpy: 8000,
            balance: 115456,
            balanceJpy: 115456,
            currencyCode: "JPY",
            accountId: "11111111-1111-4111-a111-111111111111",
          },
          {
            id: "overdue-2",
            date: "2026-03-05",
            type: "income",
            description: "立替精算",
            amount: 12000,
            amountJpy: 12000,
            balance: 127456,
            balanceJpy: 127456,
            currencyCode: "JPY",
            accountId: "22222222-2222-4222-a222-222222222222",
          },
        ],
        forecast: [
          {
            id: "event-1",
            date: "2026-03-25",
            type: "income",
            description: "給与",
            amount: 250000,
            balance: 373456,
            accountId: "11111111-1111-4111-a111-111111111111",
          },
          {
            id: "event-2",
            date: "2026-06-27",
            type: "expense",
            description: "家賃",
            amount: 338889,
            balance: 34567,
            accountId: "11111111-1111-4111-a111-111111111111",
          },
        ],
        accountForecasts: [
          {
            accountId: "11111111-1111-4111-a111-111111111111",
            accountName: "三菱UFJ銀行",
            currentBalance: 123456,
            events: [
              {
                id: "event-2",
                date: "2026-06-27",
                type: "expense",
                description: "家賃",
                amount: 338889,
                balance: -1000,
                accountId: "11111111-1111-4111-a111-111111111111",
              },
            ],
            minBalance: -1000,
            minBalanceDate: "2026-08-27",
            warningLevel: "red",
          },
        ],
      },
    });
    addRoute("GET", "/api/dashboard?applyOffset=true", {
      body: {
        totalBalance: 123456,
        minBalance: 34567,
        nextIncome: {
          id: "recurring:income",
          date: "2026-03-25",
          description: "給与",
          amount: 250000,
        },
        nextExpense: {
          id: "credit-card:expense",
          date: "2026-03-27",
          description: "家賃",
          amount: 80000,
        },
        forecast: [
          {
            id: "event-1",
            date: "2026-03-25",
            type: "income",
            description: "給与",
            amount: 250000,
            balance: 373456,
            accountId: "11111111-1111-4111-a111-111111111111",
          },
          {
            id: "event-2",
            date: "2026-06-27",
            type: "expense",
            description: "家賃",
            amount: 338889,
            balance: 34567,
            accountId: "11111111-1111-4111-a111-111111111111",
          },
        ],
        accountForecasts: [
          {
            accountId: "11111111-1111-4111-a111-111111111111",
            accountName: "三菱UFJ銀行",
            currentBalance: 123456,
            events: [
              {
                id: "event-2",
                date: "2026-06-27",
                type: "expense",
                description: "家賃",
                amount: 338889,
                balance: -1000,
                accountId: "11111111-1111-4111-a111-111111111111",
              },
            ],
            minBalance: -1000,
            minBalanceDate: "2026-08-27",
            warningLevel: "red",
          },
        ],
      },
    });
    addRoute("GET", "/api/dashboard/events?months=6&applyOffset=true", {
      body: {
        forecast: [
          {
            id: "event-1",
            date: "2026-03-25",
            type: "income",
            description: "給与",
            amount: 250000,
            balance: 373456,
            accountId: "11111111-1111-4111-a111-111111111111",
          },
        ],
        accountForecasts: [
          {
            accountId: "11111111-1111-4111-a111-111111111111",
            accountName: "三菱UFJ銀行",
            events: [
              {
                id: "event-1",
                date: "2026-03-25",
                type: "income",
                description: "給与",
                amount: 250000,
                balance: 373456,
                accountId: "11111111-1111-4111-a111-111111111111",
              },
            ],
          },
        ],
      },
    });
    addRoute("GET", "/api/dashboard/events?months=3&applyOffset=true", {
      body: {
        forecast: [],
        accountForecasts: [
          {
            accountId: "11111111-1111-4111-a111-111111111111",
            accountName: "三菱UFJ銀行",
            events: [],
          },
        ],
      },
    });
    addRoute("GET", "/api/dashboard/explain?date=2026-06-27&applyOffset=true", {
      body: {
        date: "2026-06-27",
        accountId: null,
        startBalance: 123456,
        events: [
          {
            id: "event-2",
            date: "2026-06-27",
            description: "家賃",
            type: "expense",
            source: "credit-card",
            isAssumption: true,
            amountJpy: 338889,
            runningBalance: 34567,
          },
        ],
        sourceTotals: {
          recurringIncomeJpy: 0,
          recurringExpenseJpy: 0,
          creditCardJpy: -338889,
          loanJpy: 0,
          transferJpy: 0,
        },
        finalBalance: 34567,
        assumptionEventCount: 1,
      },
    });
    addRoute("POST", "/api/dashboard/simulate", {
      body: {
        baseline: {
          minBalance: 34567,
          minBalanceDate: "2026-06-27",
          finalBalance: 34567,
          warningAccountCount: 1,
        },
        simulated: {
          minBalance: 84567,
          minBalanceDate: "2026-06-27",
          finalBalance: 94567,
          warningAccountCount: 0,
        },
        delta: {
          minBalance: 50000,
          finalBalance: 60000,
          warningAccountCount: -1,
        },
      },
    });
    addRoute("GET", "/api/accounts", {
      body: [{
        id: "11111111-1111-4111-a111-111111111111",
        name: "Main",
        balance: 123456,
        balanceOffset: 0,
        currencyCode: "JPY",
        exchangeRateToJpy: 1,
        exchangeRateUpdatedAt: "2026-03-01T00:00:00.000Z",
        sortOrder: 1,
        deletedAt: null,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      }],
    });
    addRoute("DELETE", "/api/accounts/11111111-1111-4111-a111-111111111111", {
      status: 204,
    });
    addRoute("POST", "/api/accounts", {
      status: 201,
      body: {
        id: "account-usd",
        name: "USD Wallet",
        balance: 12345,
        balanceOffset: 100,
        currencyCode: "USD",
        exchangeRateToJpy: 150.5,
        sortOrder: 2,
      },
    });
    addRoute("POST", "/api/accounts/11111111-1111-4111-a111-111111111111/reconcile", {
      body: {
        diff: 6544,
        adjustment: {
          id: "adjustment-1",
          accountId: "11111111-1111-4111-a111-111111111111",
          transferToAccountId: null,
          forecastEventId: null,
          date: "2026-03-20",
          type: "adjustment",
          description: "残高照合",
          amount: 6544,
          deletedAt: null,
          createdAt: "2026-03-20T00:00:00.000Z",
        },
        account: {
          id: "11111111-1111-4111-a111-111111111111",
          name: "Main",
          balance: 130000,
          balanceOffset: 0,
          lastReconciledAt: "2026-03-20T00:00:00.000Z",
          currencyCode: "JPY",
          exchangeRateToJpy: 1,
          exchangeRateUpdatedAt: "2026-03-01T00:00:00.000Z",
          sortOrder: 1,
          deletedAt: null,
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-20T00:00:00.000Z",
        },
      },
    });
    addRoute("GET", "/api/recurring-items", {
      body: [{
        id: "66666666-6666-4666-a666-666666666666",
        name: "家賃",
        type: "expense",
        amount: 80000,
        dayOfMonth: 31,
        startDate: null,
        endDate: null,
        dateShiftPolicy: "previous",
        accountId: "11111111-1111-4111-a111-111111111111",
        account: { name: "Main" },
        transferToAccountId: null,
        transferToAccount: null,
        enabled: true,
        sortOrder: 3,
        deletedAt: null,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      }],
    });
    addRoute("POST", "/api/recurring-items", {
      status: 201,
      body: {
        id: "recurring-1",
        name: "家賃",
        type: "expense",
        amount: 80000,
        dayOfMonth: 31,
        startDate: null,
        endDate: null,
        dateShiftPolicy: "previous",
        accountId: "11111111-1111-4111-a111-111111111111",
        enabled: true,
        sortOrder: 3,
      },
    });
    addRoute("DELETE", "/api/recurring-items/66666666-6666-4666-a666-666666666666", {
      status: 204,
    });
    addRoute("GET", "/api/subscriptions", {
      body: [{
        id: "77777777-7777-4777-a777-777777777777",
        name: "Cloud",
        amount: 1200,
        intervalMonths: 1,
        startDate: "2026-01-01",
        dayOfMonth: 10,
        endDate: null,
        paymentSource: "Visa",
        deletedAt: null,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      }],
    });
    addRoute("DELETE", "/api/subscriptions/77777777-7777-4777-a777-777777777777", {
      status: 204,
    });
    addRoute("GET", "/api/credit-cards", {
      body: [{
        id: "44444444-4444-4444-8444-444444444444",
        name: "Visa",
        settlementDay: 27,
        dateShiftPolicy: "next",
        accountId: "11111111-1111-4111-a111-111111111111",
        account: { name: "Main" },
        assumptionAmount: 50000,
        sortOrder: 4,
        deletedAt: null,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      }],
    });
    addRoute("POST", "/api/credit-cards", {
      status: 201,
      body: {
        id: "44444444-4444-4444-8444-444444444444",
        name: "Visa",
        settlementDay: 27,
        dateShiftPolicy: "next",
        accountId: "11111111-1111-4111-a111-111111111111",
        assumptionAmount: 50000,
        sortOrder: 4,
      },
    });
    addRoute("GET", "/api/credit-cards/44444444-4444-4444-8444-444444444444/assumption-suggestion?months=12", {
      body: {
        creditCardId: "44444444-4444-4444-8444-444444444444",
        method: "median",
        months: 12,
        sampleCount: 3,
        sourceYearMonths: ["2026-01", "2026-02", "2026-03"],
        suggestedAmount: 42000,
      },
    });
    addRoute("DELETE", "/api/credit-cards/44444444-4444-4444-8444-444444444444", {
      status: 204,
    });
    addRoute("GET", "/api/loans", {
      body: [{
        id: "55555555-5555-4555-8555-555555555555",
        name: "PCローン",
        totalAmount: 240000,
        startDate: "2026-04-30",
        paymentCount: 12,
        dateShiftPolicy: "previous",
        paymentMethod: "account_withdrawal",
        accountId: "11111111-1111-4111-a111-111111111111",
        account: { name: "Main" },
        remainingBalance: 200000,
        remainingPayments: 10,
        nextPaymentAmount: 20000,
        deletedAt: null,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      }],
    });
    addRoute("PUT", "/api/loans/55555555-5555-4555-8555-555555555555", {
      body: {
        id: "55555555-5555-4555-8555-555555555555",
        name: "PCローン",
        totalAmount: 240000,
        startDate: "2026-04-30",
        paymentCount: 12,
        dateShiftPolicy: "previous",
        paymentMethod: "account_withdrawal",
        accountId: "11111111-1111-4111-a111-111111111111",
      },
    });
    addRoute("DELETE", "/api/loans/55555555-5555-4555-8555-555555555555", {
      status: 204,
    });
    addRoute("GET", "/api/audit-logs?limit=20", {
      body: {
        items: [{
          id: "audit-1",
          createdAt: "2026-07-05T01:02:03.000Z",
          method: "DELETE",
          path: "/api/transactions/33333333-3333-4333-a333-333333333333",
          status: 204,
          clientSource: "mcp",
          requestId: "request-1",
        }],
        page: 1,
        limit: 20,
        total: 1,
      },
    });
    addRoute("GET", "/api/audit-logs?limit=2", {
      body: {
        items: [
          {
            id: "audit-2",
            createdAt: "2026-07-05T02:02:03.000Z",
            method: "POST",
            path: "/api/accounts",
            status: 201,
            clientSource: "web",
            requestId: "request-2",
          },
          {
            id: "audit-1",
            createdAt: "2026-07-05T01:02:03.000Z",
            method: "DELETE",
            path: "/api/transactions/33333333-3333-4333-a333-333333333333",
            status: 204,
            clientSource: "mcp",
            requestId: "request-1",
          },
        ],
        page: 1,
        limit: 2,
        total: 2,
      },
    });
    addRoute("GET", "/api/billings?month=2026-03", {
      body: {
        yearMonth: "2026-03",
        settlementDate: "2026-03-27",
        resolvedSettlementDate: "2026-03-27",
        items: [],
        total: 0,
        appliedTotal: 0,
        safetyValveActive: false,
        sourceType: "actual",
        monthOffset: 0,
      },
    });
    addRoute("GET", "/api/transactions?page=1", {
      body: {
        items: [],
        page: 1,
        limit: 50,
        total: 0,
      },
    });
    addRoute("GET", "/api/transactions?page=1&limit=100&startDate=2026-03-01&endDate=2026-03-31", {
      body: {
        items: [],
        page: 1,
        limit: 100,
        total: 0,
      },
    });
    addRoute("GET", "/api/transactions?page=2&limit=10", {
      body: {
        items: [],
        page: 2,
        limit: 10,
        total: 0,
      },
    });
    addRoute("GET", "/api/transactions?page=1&limit=100", {
      body: {
        items: [{
          id: "33333333-3333-4333-a333-333333333333",
          accountId: "11111111-1111-4111-a111-111111111111",
          transferToAccountId: null,
          forecastEventId: null,
          date: "2026-03-20",
          type: "expense",
          description: "ランチ",
          amount: 1200,
          amountJpy: 1200,
          currencyCode: "JPY",
          createdAt: "2026-03-20T00:00:00.000Z",
          accountName: "Main",
          transferToAccountCurrencyCode: null,
          transferToAccountName: null,
        }],
        page: 1,
        limit: 100,
        total: 1,
      },
    });
    addRoute("GET", "/api/transactions?page=2&limit=10&startDate=2026-03-01&endDate=2026-03-31", {
      body: {
        items: [],
        page: 2,
        limit: 10,
        total: 0,
      },
    });
    addRoute("GET", "/api/transactions?page=3&startDate=2026-02-01&endDate=2026-02-28", {
      body: {
        items: [],
        page: 3,
        limit: 20,
        total: 0,
      },
    });
    addRoute(
      "GET",
      "/api/transactions?page=3&limit=10&accountId=11111111-1111-4111-a111-111111111111&startDate=2026-02-01&endDate=2026-02-28",
      {
        body: {
          items: [],
          page: 3,
          limit: 10,
          total: 0,
        },
      },
    );
    addRoute(
      "GET",
      "/api/transactions/balance-history?accountId=11111111-1111-4111-a111-111111111111&startDate=2026-03-01&endDate=2026-03-31&applyOffset=true",
      {
        body: {
          points: [
            {
              date: "2026-03-01",
              balance: 123456,
              description: "月初残高",
            },
            {
              date: "2026-03-31",
              balance: 140000,
              description: "月末残高",
            },
          ],
        },
      },
    );
    addRoute("POST", "/api/transactions", {
      status: 201,
      body: {
        id: "tx-1",
        accountId: "11111111-1111-4111-a111-111111111111",
        transferToAccountId: null,
        forecastEventId: null,
        date: "2026-03-20",
        type: "expense",
        description: "ランチ",
        amount: 1200,
        createdAt: "2026-03-20T00:00:00.000Z",
      },
    });
    addRoute("DELETE", "/api/transactions/33333333-3333-4333-a333-333333333333", {
      status: 204,
    });
    addRoute("PUT", "/api/transactions/22222222-2222-4222-a222-222222222222", {
      body: {
        id: "22222222-2222-4222-a222-222222222222",
        accountId: "11111111-1111-4111-a111-111111111111",
        transferToAccountId: null,
        forecastEventId: null,
        date: "2026-03-21",
        type: "expense",
        description: "ディナー",
        amount: 3200,
        createdAt: "2026-03-20T00:00:00.000Z",
      },
    });

    server = buildServer({
      apiClient: new SuiApiClient("http://example.test", fetchImpl),
      name: "test-server",
      version: "1.0.0",
    });

    client = new Client({
      name: "test-client",
      version: "1.0.0",
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    Object.assign(globalThis, { __mcpRequests: requests });
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    delete (globalThis as typeof globalThis & { __mcpRequests?: unknown }).__mcpRequests;
  });

  it("lists capabilities and serves resources, tools, and prompts", async () => {
    const tools = await client.listTools();
    const resources = await client.listResources();
    const resourceTemplates = await client.listResourceTemplates();
    const prompts = await client.listPrompts();

    expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "get_dashboard",
      "review_overdue_events",
      "explain_forecast",
      "simulate_forecast",
      "list_accounts",
      "reconcile_account",
      "list_subscriptions",
      "create_transaction",
      "update_transaction",
      "delete_transaction",
      "get_balance_history",
      "update_billing",
      "confirm_forecast",
      "get_credit_card_assumption_suggestion",
      "list_recent_changes",
    ]));
    expect(resources.resources.map((resource) => resource.uri)).toEqual(expect.arrayContaining([
      "sui://dashboard",
      "sui://accounts",
      "sui://subscriptions",
      "sui://forecast/summary",
    ]));
    expect(resourceTemplates.resourceTemplates.map((resource) => resource.uriTemplate)).toEqual(expect.arrayContaining([
      "sui://billings/{yearMonth}",
      "sui://transactions{?page,limit,accountId,startDate,endDate}",
      "sui://balance-history{?accountId,startDate,endDate,applyOffset}",
    ]));
    expect(prompts.prompts.map((prompt) => prompt.name)).toEqual(expect.arrayContaining([
      "monthly-report",
      "budget-advice",
      "forecast-analysis",
      "expense-breakdown",
    ]));
    expect(tools.tools.find((tool) => tool.name === "review_overdue_events")).toMatchObject({
      annotations: { readOnlyHint: true },
    });

    const summary = await client.readResource({ uri: "sui://forecast/summary" });
    expect(getResourceText(summary.contents[0])).toContain("=== sui 資産予測サマリー ===");
    expect(getResourceText(summary.contents[0])).toContain("三菱UFJ銀行");

    const dashboard = await client.callTool({
      name: "get_dashboard",
      arguments: {},
    });
    expect(getToolText(dashboard)).toContain("合計残高:");

    const explain = await client.callTool({
      name: "explain_forecast",
      arguments: { date: "2026-06-27" },
    });
    expect(getToolText(explain)).toContain("起点残高:");
    expect(getToolText(explain)).toContain("仮定");
    expect(getToolText(explain)).toContain("source 別小計:");
    expect(getStructuredContent(explain)).toMatchObject({
      finalBalance: 34567,
      assumptionEventCount: 1,
    });

    const simulation = await client.callTool({
      name: "simulate_forecast",
      arguments: {
        months: 1,
        cardAssumptionOverrides: [{
          creditCardId: "44444444-4444-4444-8444-444444444444",
          assumptionAmount: 50000,
        }],
      },
    });
    expect(getToolText(simulation)).toContain("baseline: 最小残高");
    expect(getToolText(simulation)).toContain("simulated: 最小残高");
    expect(getToolText(simulation)).toContain("delta: 最小残高 +￥50,000");
    expect(getStructuredContent(simulation)).toMatchObject({
      delta: {
        minBalance: 50000,
        finalBalance: 60000,
        warningAccountCount: -1,
      },
    });

    const billing = await client.readResource({ uri: "sui://billings/2026-03" });
    expect(getResourceText(billing.contents[0])).toContain("\"yearMonth\": \"2026-03\"");

    const transactions = await client.readResource({
      uri: "sui://transactions?page=3&startDate=2026-02-01&endDate=2026-02-28",
    });
    expect(getResourceText(transactions.contents[0])).toContain("\"page\": 3");

    const balanceHistory = await client.readResource({
      uri: "sui://balance-history?accountId=11111111-1111-4111-a111-111111111111&startDate=2026-03-01&endDate=2026-03-31&applyOffset=true",
    });
    expect(getResourceText(balanceHistory.contents[0])).toContain("\"points\": [");

    const monthlyReport = await client.getPrompt({
      name: "monthly-report",
      arguments: { month: "2026-03" },
    });
    const reportText = monthlyReport.messages[0]?.content.type === "text"
      ? monthlyReport.messages[0].content.text
      : "";
    expect(reportText).toContain("2026-03 の月次収支レポート");
  });

  it("publishes annotations for every tool", async () => {
    const tools = await client.listTools();
    const annotationsByName = new Map(tools.tools.map((tool) => [tool.name, tool.annotations]));
    const readOnlyTools = [
      "get_dashboard",
      "review_overdue_events",
      "explain_forecast",
      "simulate_forecast",
      "list_accounts",
      "list_transactions",
      "get_balance_history",
      "list_recurring_items",
      "list_subscriptions",
      "list_credit_cards",
      "get_credit_card_assumption_suggestion",
      "get_billing",
      "list_loans",
      "list_recent_changes",
    ];
    const createTools = [
      "create_account",
      "create_transaction",
      "create_recurring_item",
      "create_subscription",
      "create_credit_card",
      "create_loan",
    ];
    const updateTools = [
      "confirm_forecast",
      "update_account",
      "reconcile_account",
      "update_transaction",
      "update_recurring_item",
      "update_subscription",
      "update_credit_card",
      "update_billing",
      "update_loan",
    ];
    const deleteTools = deleteToolCases.map((item) => item.tool);
    const expectedTools = [
      ...readOnlyTools,
      ...createTools,
      ...updateTools,
      ...deleteTools,
    ].sort();

    expect([...annotationsByName.keys()].sort()).toEqual(expectedTools);
    for (const name of readOnlyTools) {
      expect(annotationsByName.get(name)).toMatchObject({ readOnlyHint: true });
    }
    for (const name of createTools) {
      expect(annotationsByName.get(name)).toMatchObject({
        destructiveHint: false,
        idempotentHint: false,
      });
    }
    for (const name of updateTools) {
      expect(annotationsByName.get(name)).toMatchObject({
        destructiveHint: false,
        idempotentHint: false,
      });
    }
    for (const name of deleteTools) {
      expect(annotationsByName.get(name)).toMatchObject({
        destructiveHint: true,
        idempotentHint: false,
      });
    }
  });

  it("forwards tool arguments to the REST API", async () => {
    const result = await client.callTool({
      name: "create_transaction",
      arguments: {
        accountId: "11111111-1111-4111-a111-111111111111",
        date: "2026-03-20",
        type: "expense",
        description: "ランチ",
        amount: 1200,
      },
    });

    expect(getToolText(result)).toContain("ランチ");

    const requests = (globalThis as typeof globalThis & {
      __mcpRequests?: Array<{ method: string; path: string; body?: unknown }>;
    }).__mcpRequests ?? [];

    expect(requests).toContainEqual({
      method: "POST",
      path: "/api/transactions",
      body: {
        accountId: "11111111-1111-4111-a111-111111111111",
        date: "2026-03-20",
        type: "expense",
        description: "ランチ",
        amount: 1200,
      },
    });
  });

  it("forwards transaction updates to the REST API", async () => {
    const result = await client.callTool({
      name: "update_transaction",
      arguments: {
        id: "22222222-2222-4222-a222-222222222222",
        accountId: "11111111-1111-4111-a111-111111111111",
        date: "2026-03-21",
        type: "expense",
        description: "ディナー",
        amount: 3200,
      },
    });

    expect(getToolText(result)).toContain("ディナー");

    const requests = (globalThis as typeof globalThis & {
      __mcpRequests?: Array<{ method: string; path: string; body?: unknown }>;
    }).__mcpRequests ?? [];

    expect(requests).toContainEqual({
      method: "PUT",
      path: "/api/transactions/22222222-2222-4222-a222-222222222222",
      body: {
        accountId: "11111111-1111-4111-a111-111111111111",
        date: "2026-03-21",
        type: "expense",
        description: "ディナー",
        amount: 3200,
      },
    });
  });

  it.each(deleteToolCases)("previews $tool without calling DELETE when confirm is absent", async ({ tool, id, previewPath, deletePath, summary }) => {
    const result = await client.callTool({
      name: tool,
      arguments: {
        id,
      },
    });

    expect(getToolText(result)).toContain(summary);
    expect(getToolText(result)).toContain("削除するには confirm: true");

    const requests = (globalThis as typeof globalThis & {
      __mcpRequests?: Array<{ method: string; path: string; body?: unknown }>;
    }).__mcpRequests ?? [];

    expect(requests).toContainEqual({
      method: "GET",
      path: previewPath,
      body: undefined,
    });
    expect(requests).not.toContainEqual({
      method: "DELETE",
      path: deletePath,
      body: undefined,
    });
  });

  it.each(deleteToolCases)("forwards $tool deletes when confirm is true", async ({ tool, id, previewPath, deletePath }) => {
    const result = await client.callTool({
      name: tool,
      arguments: {
        id,
        confirm: true,
      },
    });

    expect(getToolText(result)).toContain(id);

    const requests = (globalThis as typeof globalThis & {
      __mcpRequests?: Array<{ method: string; path: string; body?: unknown }>;
    }).__mcpRequests ?? [];

    expect(requests).toContainEqual({
      method: "DELETE",
      path: deletePath,
      body: undefined,
    });
    expect(requests).not.toContainEqual({
      method: "GET",
      path: previewPath,
      body: undefined,
    });
  });

  it("forwards account reconciliation to the REST API", async () => {
    const result = await client.callTool({
      name: "reconcile_account",
      arguments: {
        accountId: "11111111-1111-4111-a111-111111111111",
        actualBalance: 130000,
      },
    });

    expect(getToolText(result)).toContain("差分 +6,544");
    expect(getToolText(result)).toContain("新残高 130,000");

    const requests = (globalThis as typeof globalThis & {
      __mcpRequests?: Array<{ method: string; path: string; body?: unknown }>;
    }).__mcpRequests ?? [];

    expect(requests).toContainEqual({
      method: "POST",
      path: "/api/accounts/11111111-1111-4111-a111-111111111111/reconcile",
      body: {
        actualBalance: 130000,
      },
    });
  });

  it("lists recent changes from audit logs", async () => {
    const result = await client.callTool({
      name: "list_recent_changes",
      arguments: {
        limit: 2,
      },
    });

    const text = getToolText(result);
    expect(text).toContain("2026-07-05T02:02:03.000Z POST /api/accounts web");
    expect(text).toContain("2026-07-05T01:02:03.000Z DELETE /api/transactions/33333333-3333-4333-a333-333333333333 mcp");

    const requests = (globalThis as typeof globalThis & {
      __mcpRequests?: Array<{ method: string; path: string; body?: unknown }>;
    }).__mcpRequests ?? [];

    expect(requests).toContainEqual({
      method: "GET",
      path: "/api/audit-logs?limit=2",
      body: undefined,
    });
  });

  it("forwards current API fields from MCP tools", async () => {
    await client.callTool({
      name: "create_account",
      arguments: {
        name: "USD Wallet",
        balance: 12345,
        balanceOffset: 100,
        currencyCode: "USD",
        exchangeRateToJpy: 150.5,
        sortOrder: 2,
      },
    });
    await client.callTool({
      name: "create_recurring_item",
      arguments: {
        name: "家賃",
        type: "expense",
        amount: 80000,
        dayOfMonth: 31,
        startDate: null,
        endDate: null,
        dateShiftPolicy: "previous",
        accountId: "11111111-1111-4111-a111-111111111111",
        enabled: true,
        sortOrder: 3,
      },
    });
    await client.callTool({
      name: "create_credit_card",
      arguments: {
        name: "Visa",
        settlementDay: 27,
        dateShiftPolicy: "next",
        accountId: "11111111-1111-4111-a111-111111111111",
        assumptionAmount: 50000,
        sortOrder: 4,
      },
    });
    const suggestion = await client.callTool({
      name: "get_credit_card_assumption_suggestion",
      arguments: {
        id: "44444444-4444-4444-8444-444444444444",
        months: 12,
      },
    });
    await client.callTool({
      name: "update_loan",
      arguments: {
        id: "55555555-5555-4555-8555-555555555555",
        name: "PCローン",
        totalAmount: 240000,
        paymentCount: 12,
        startDate: "2026-04-30",
        dateShiftPolicy: "previous",
        paymentMethod: "account_withdrawal",
        accountId: "11111111-1111-4111-a111-111111111111",
      },
    });

    expect(getToolText(suggestion)).toContain("¥42,000");

    const requests = (globalThis as typeof globalThis & {
      __mcpRequests?: Array<{ method: string; path: string; body?: unknown }>;
    }).__mcpRequests ?? [];

    expect(requests).toContainEqual({
      method: "POST",
      path: "/api/accounts",
      body: {
        name: "USD Wallet",
        balance: 12345,
        balanceOffset: 100,
        currencyCode: "USD",
        exchangeRateToJpy: 150.5,
        sortOrder: 2,
      },
    });
    expect(requests).toContainEqual({
      method: "POST",
      path: "/api/recurring-items",
      body: {
        name: "家賃",
        type: "expense",
        amount: 80000,
        dayOfMonth: 31,
        startDate: null,
        endDate: null,
        dateShiftPolicy: "previous",
        accountId: "11111111-1111-4111-a111-111111111111",
        enabled: true,
        sortOrder: 3,
      },
    });
    expect(requests).toContainEqual({
      method: "POST",
      path: "/api/credit-cards",
      body: {
        name: "Visa",
        settlementDay: 27,
        dateShiftPolicy: "next",
        accountId: "11111111-1111-4111-a111-111111111111",
        assumptionAmount: 50000,
        sortOrder: 4,
      },
    });
    expect(requests).toContainEqual({
      method: "GET",
      path: "/api/credit-cards/44444444-4444-4444-8444-444444444444/assumption-suggestion?months=12",
      body: undefined,
    });
    expect(requests).toContainEqual({
      method: "PUT",
      path: "/api/loans/55555555-5555-4555-8555-555555555555",
      body: {
        name: "PCローン",
        totalAmount: 240000,
        paymentCount: 12,
        startDate: "2026-04-30",
        dateShiftPolicy: "previous",
        paymentMethod: "account_withdrawal",
        accountId: "11111111-1111-4111-a111-111111111111",
      },
    });
  });

  it("forwards recurring transfer payloads to the REST API", async () => {
    addRoute("POST", "/api/recurring-items", {
      status: 201,
      body: {
        id: "recurring-transfer",
        name: "資金移動",
        type: "transfer",
        amount: 50000,
        dayOfMonth: 20,
        startDate: null,
        endDate: null,
        dateShiftPolicy: "none",
        accountId: "11111111-1111-4111-a111-111111111111",
        transferToAccountId: "22222222-2222-4222-a222-222222222222",
        enabled: true,
        sortOrder: 5,
      },
    });

    const result = await client.callTool({
      name: "create_recurring_item",
      arguments: {
        name: "資金移動",
        type: "transfer",
        amount: 50000,
        dayOfMonth: 20,
        startDate: null,
        endDate: null,
        dateShiftPolicy: "none",
        accountId: "11111111-1111-4111-a111-111111111111",
        transferToAccountId: "22222222-2222-4222-a222-222222222222",
        enabled: true,
        sortOrder: 5,
      },
    });

    expect(getToolText(result)).toContain("資金移動");

    const requests = (globalThis as typeof globalThis & {
      __mcpRequests?: Array<{ method: string; path: string; body?: unknown }>;
    }).__mcpRequests ?? [];

    expect(requests).toContainEqual({
      method: "POST",
      path: "/api/recurring-items",
      body: {
        name: "資金移動",
        type: "transfer",
        amount: 50000,
        dayOfMonth: 20,
        startDate: null,
        endDate: null,
        dateShiftPolicy: "none",
        accountId: "11111111-1111-4111-a111-111111111111",
        transferToAccountId: "22222222-2222-4222-a222-222222222222",
        enabled: true,
        sortOrder: 5,
      },
    });
  });

  it("formats transfer forecast labels in dashboard tools", async () => {
    const transferEvent = {
      id: "transfer-event",
      date: "2026-03-10",
      type: "transfer",
      description: "資金移動",
      amount: 50000,
      amountJpy: 50000,
      balance: 123456,
      balanceJpy: 123456,
      currencyCode: "JPY",
      accountId: "11111111-1111-4111-a111-111111111111",
      transferToAccountId: "22222222-2222-4222-a222-222222222222",
    };
    addRoute("GET", "/api/dashboard?applyOffset=true", {
      body: {
        totalBalance: 123456,
        minBalance: 123456,
        nextIncome: null,
        nextExpense: null,
        overdueForecast: [transferEvent],
        forecast: [transferEvent],
        accountForecasts: [],
      },
    });
    addRoute("GET", "/api/dashboard", {
      body: {
        overdueForecast: [transferEvent],
      },
    });
    addRoute("GET", "/api/accounts", {
      body: [
        { id: "11111111-1111-4111-a111-111111111111", name: "Source" },
        { id: "22222222-2222-4222-a222-222222222222", name: "Destination" },
      ],
    });

    const dashboard = await client.callTool({
      name: "get_dashboard",
      arguments: {},
    });
    const review = await client.callTool({
      name: "review_overdue_events",
      arguments: {},
    });

    expect(getToolText(dashboard)).toContain("振替");
    expect(getToolText(review)).toContain("振替");
    expect(getToolText(review)).toContain("Source → Destination");
  });

  it("uses the events API when get_dashboard is called with months", async () => {
    const result = await client.callTool({
      name: "get_dashboard",
      arguments: { months: 3 },
    });

    expect(getToolText(result)).toContain("未確定イベント総数: 0件");

    const requests = (globalThis as typeof globalThis & {
      __mcpRequests?: Array<{ method: string; path: string; body?: unknown }>;
    }).__mcpRequests ?? [];

    expect(requests).toContainEqual({
      method: "GET",
      path: "/api/dashboard?applyOffset=true",
      body: undefined,
    });
    expect(requests).toContainEqual({
      method: "GET",
      path: "/api/dashboard/events?months=3&applyOffset=true",
      body: undefined,
    });
  });

  it("reviews overdue events with account names and structured content", async () => {
    const result = await client.callTool({
      name: "review_overdue_events",
      arguments: {},
    });

    const text = getToolText(result);
    expect(text).toContain("予定日超過の未確定イベント: 2件");
    expect(text).toContain("[overdue-1]");
    expect(text).toContain("Main");
    expect(text).toContain("各イベントについてユーザーに実際の金額と口座を確認し");
    expect(getStructuredContent(result)).toEqual({
      overdueCount: 2,
      events: [
        {
          id: "overdue-1",
          date: "2026-03-01",
          type: "expense",
          description: "水道代",
          amount: 8000,
          amountJpy: 8000,
          currencyCode: "JPY",
          accountId: "11111111-1111-4111-a111-111111111111",
          accountName: "Main",
          transferToAccountId: null,
          transferToAccountName: null,
        },
        {
          id: "overdue-2",
          date: "2026-03-05",
          type: "income",
          description: "立替精算",
          amount: 12000,
          amountJpy: 12000,
          currencyCode: "JPY",
          accountId: "22222222-2222-4222-a222-222222222222",
          accountName: null,
          transferToAccountId: null,
          transferToAccountName: null,
        },
      ],
    });

    const requests = (globalThis as typeof globalThis & {
      __mcpRequests?: Array<{ method: string; path: string; body?: unknown }>;
    }).__mcpRequests ?? [];

    expect(requests).toContainEqual({
      method: "GET",
      path: "/api/dashboard",
      body: undefined,
    });
    expect(requests).toContainEqual({
      method: "GET",
      path: "/api/accounts",
      body: undefined,
    });
  });

  it("reports when there are no overdue events to review", async () => {
    addRoute("GET", "/api/dashboard", {
      body: { overdueForecast: [] },
    });

    const result = await client.callTool({
      name: "review_overdue_events",
      arguments: {},
    });

    expect(getToolText(result)).toBe("予定日超過の未確定イベントはありません。");
    expect(getStructuredContent(result)).toEqual({
      overdueCount: 0,
      events: [],
    });
  });

  it("forwards transaction list filters to the REST API", async () => {
    await client.callTool({
      name: "list_transactions",
      arguments: {
        page: 2,
        limit: 10,
        startDate: "2026-03-01",
        endDate: "2026-03-31",
      },
    });

    const requests = (globalThis as typeof globalThis & {
      __mcpRequests?: Array<{ method: string; path: string; body?: unknown }>;
    }).__mcpRequests ?? [];

    expect(requests).toContainEqual({
      method: "GET",
      path: "/api/transactions?page=2&limit=10&startDate=2026-03-01&endDate=2026-03-31",
      body: undefined,
    });
  });

  it("forwards transaction resource filters to the REST API", async () => {
    await client.readResource({
      uri: "sui://transactions?page=3&limit=10&accountId=11111111-1111-4111-a111-111111111111&startDate=2026-02-01&endDate=2026-02-28",
    });

    const requests = (globalThis as typeof globalThis & {
      __mcpRequests?: Array<{ method: string; path: string; body?: unknown }>;
    }).__mcpRequests ?? [];

    expect(requests).toContainEqual({
      method: "GET",
      path: "/api/transactions?page=3&limit=10&accountId=11111111-1111-4111-a111-111111111111&startDate=2026-02-01&endDate=2026-02-28",
      body: undefined,
    });
  });

  it("forwards balance history filters to the REST API", async () => {
    const result = await client.callTool({
      name: "get_balance_history",
      arguments: {
        accountId: "11111111-1111-4111-a111-111111111111",
        startDate: "2026-03-01",
        endDate: "2026-03-31",
      },
    });

    expect(getToolText(result)).toContain("残高推移 (2026-03-01 〜 2026-03-31)");

    const requests = (globalThis as typeof globalThis & {
      __mcpRequests?: Array<{ method: string; path: string; body?: unknown }>;
    }).__mcpRequests ?? [];

    expect(requests).toContainEqual({
      method: "GET",
      path: "/api/transactions/balance-history?accountId=11111111-1111-4111-a111-111111111111&startDate=2026-03-01&endDate=2026-03-31&applyOffset=true",
      body: undefined,
    });
  });

  it("builds expense-breakdown with month-scoped transactions", async () => {
    const prompt = await client.getPrompt({
      name: "expense-breakdown",
      arguments: { month: "2026-03" },
    });

    const promptText = prompt.messages[0]?.content.type === "text"
      ? prompt.messages[0].content.text
      : "";
    expect(promptText).toContain("2026-03 の支出内訳を日本語で分析してください。");

    const requests = (globalThis as typeof globalThis & {
      __mcpRequests?: Array<{ method: string; path: string; body?: unknown }>;
    }).__mcpRequests ?? [];

    expect(requests).toContainEqual({
      method: "GET",
      path: "/api/transactions?page=1&limit=100&startDate=2026-03-01&endDate=2026-03-31",
      body: undefined,
    });
  });

  it("builds monthly-report with month-scoped transaction details", async () => {
    const items = Array.from({ length: 100 }, (_, index) => ({
      id: `monthly-tx-${index + 1}`,
      accountId: "11111111-1111-4111-a111-111111111111",
      transferToAccountId: null,
      forecastEventId: null,
      date: index === 0 ? "2026-03-25" : "2026-03-20",
      type: index === 0 ? "income" : "expense",
      description: index === 0 ? "給与" : `支出${index}`,
      amount: index === 0 ? 250000 : 1000 + index,
      amountJpy: index === 0 ? 250000 : 1000 + index,
      createdAt: "2026-03-20T00:00:00.000Z",
      currencyCode: "JPY",
      accountName: "Main",
    }));
    addRoute("GET", "/api/transactions?page=1&limit=100&startDate=2026-03-01&endDate=2026-03-31", {
      body: {
        items,
        page: 1,
        limit: 100,
        total: 101,
      },
    });

    const prompt = await client.getPrompt({
      name: "monthly-report",
      arguments: { month: "2026-03" },
    });

    const promptText = getPromptText(prompt);
    expect(promptText).toContain("【取引履歴（対象月）】");
    expect(promptText).toContain("2026-03-25 収入 給与 ￥250,000 / 口座 Main");
    expect(promptText).toContain("2026-03-20 支出 支出1 ￥1,001 / 口座 Main");
    expect(promptText).toContain("他 1 件省略");

    const requests = (globalThis as typeof globalThis & {
      __mcpRequests?: Array<{ method: string; path: string; body?: unknown }>;
    }).__mcpRequests ?? [];

    expect(requests).toContainEqual({
      method: "GET",
      path: "/api/transactions?page=1&limit=100&startDate=2026-03-01&endDate=2026-03-31",
      body: undefined,
    });
  });

  it("builds prompts without raw JSON key notation", async () => {
    const prompts = await Promise.all([
      client.getPrompt({ name: "monthly-report", arguments: { month: "2026-03" } }),
      client.getPrompt({ name: "budget-advice", arguments: {} }),
      client.getPrompt({ name: "forecast-analysis", arguments: { months: "6" } }),
      client.getPrompt({ name: "expense-breakdown", arguments: { month: "2026-03" } }),
    ]);

    for (const prompt of prompts) {
      const promptText = getPromptText(prompt);
      expect(promptText).not.toContain("\"totalBalance\":");
      expect(promptText).not.toMatch(rawJsonKeyPattern);
    }
  });

  it("keeps prompt text substantially shorter than legacy JSON dumps", async () => {
    const dateFor = (index: number) =>
      `2026-${String(3 + (index % 9)).padStart(2, "0")}-${String(1 + (index % 27)).padStart(2, "0")}`;
    const accounts = Array.from({ length: 4 }, (_, index) => ({
      id: `account-${index + 1}`,
      name: `口座${index + 1}`,
      balance: 120000 + index * 30000,
      balanceOffset: index * 1000,
      lastReconciledAt: null,
      currencyCode: "JPY",
      exchangeRateToJpy: 1,
      exchangeRateUpdatedAt: "2026-03-01T00:00:00.000Z",
      sortOrder: index + 1,
      deletedAt: null,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    }));
    const forecast = Array.from({ length: 48 }, (_, index) => {
      const type = index % 5 === 0 ? "income" : index % 7 === 0 ? "transfer" : "expense";
      const amount = type === "income" ? 250000 : 18000 + index * 700;
      const balance = 480000 - index * 8500 + (type === "income" ? amount : -amount);
      return {
        id: `forecast-${index + 1}`,
        date: dateFor(index),
        type,
        description: `予測イベント${index + 1} ${"詳細".repeat(8)}`,
        amount,
        amountJpy: amount,
        balance,
        balanceJpy: balance,
        currencyCode: "JPY",
        accountId: accounts[index % accounts.length].id,
        transferToAccountId: type === "transfer" ? accounts[(index + 1) % accounts.length].id : null,
      };
    });
    const accountForecasts = accounts.map((account, accountIndex) => ({
      accountId: account.id,
      accountName: account.name,
      currentBalance: account.balance,
      currentBalanceJpy: account.balance,
      currencyCode: "JPY",
      exchangeRateToJpy: 1,
      events: forecast.map((event, eventIndex) => ({
        ...event,
        id: `${account.id}-${event.id}`,
        accountId: account.id,
        description: `${event.description} ${account.name}側の重複明細`,
        balance: event.balance - accountIndex * 25000 - eventIndex * 300,
        balanceJpy: event.balance - accountIndex * 25000 - eventIndex * 300,
      })),
      minBalance: -50000 - accountIndex * 10000,
      minBalanceJpy: -50000 - accountIndex * 10000,
      minBalanceDate: "2026-10-27",
      warningLevel: accountIndex % 2 === 0 ? "red" : "yellow",
    }));
    const dashboard = {
      totalBalance: 540000,
      minBalance: -50000,
      nextIncome: forecast.find((event) => event.type === "income") ?? null,
      nextExpense: forecast.find((event) => event.type === "expense") ?? null,
      overdueForecast: forecast.slice(0, 4),
      forecast,
      accountForecasts,
    };
    const recurring = Array.from({ length: 20 }, (_, index) => ({
      id: `recurring-${index + 1}`,
      name: `固定費${index + 1}`,
      type: index % 6 === 0 ? "income" : "expense",
      amount: 5000 + index * 2000,
      dayOfMonth: (index % 27) + 1,
      startDate: "2026-01-01",
      endDate: null,
      dateShiftPolicy: index % 2 === 0 ? "previous" : "next",
      accountId: accounts[index % accounts.length].id,
      account: accounts[index % accounts.length],
      transferToAccountId: null,
      transferToAccount: null,
      enabled: true,
      sortOrder: index + 1,
      deletedAt: null,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    }));
    const creditCards = Array.from({ length: 8 }, (_, index) => ({
      id: `card-${index + 1}`,
      name: `カード${index + 1}`,
      settlementDay: (index % 27) + 1,
      accountId: accounts[index % accounts.length].id,
      account: accounts[index % accounts.length],
      assumptionAmount: 30000 + index * 5000,
      dateShiftPolicy: "next",
      sortOrder: index + 1,
      deletedAt: null,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    }));
    const loans = Array.from({ length: 6 }, (_, index) => ({
      id: `loan-${index + 1}`,
      name: `ローン${index + 1}`,
      totalAmount: 240000 + index * 100000,
      startDate: "2026-01-31",
      paymentCount: 24,
      dateShiftPolicy: "previous",
      paymentMethod: index % 2 === 0 ? "account_withdrawal" : "credit_card",
      accountId: accounts[index % accounts.length].id,
      account: accounts[index % accounts.length],
      remainingBalance: 180000 + index * 80000,
      remainingPayments: 18 - index,
      nextPaymentAmount: 10000 + index * 2500,
      deletedAt: null,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    }));
    const billing = {
      yearMonth: "2026-03",
      settlementDate: "2026-03-27",
      resolvedSettlementDate: "2026-03-27",
      items: creditCards.map((card, index) => ({
        creditCardId: card.id,
        amount: 25000 + index * 3500,
      })),
      total: 298000,
      appliedTotal: 298000,
      safetyValveActive: false,
      sourceType: "actual",
      monthOffset: 0,
    };
    const transactions = {
      items: Array.from({ length: 100 }, (_, index) => ({
        id: `tx-${index + 1}`,
        accountId: accounts[index % accounts.length].id,
        transferToAccountId: index % 11 === 0 ? accounts[(index + 1) % accounts.length].id : null,
        forecastEventId: index % 3 === 0 ? `forecast-${(index % forecast.length) + 1}` : null,
        date: dateFor(index),
        type: index % 13 === 0 ? "income" : index % 11 === 0 ? "transfer" : "expense",
        description: `取引${index + 1} ${"メモ".repeat(10)}`,
        amount: 1000 + index * 120,
        amountJpy: 1000 + index * 120,
        createdAt: "2026-03-01T00:00:00.000Z",
        currencyCode: "JPY",
        accountName: accounts[index % accounts.length].name,
        transferToAccountName: index % 11 === 0 ? accounts[(index + 1) % accounts.length].name : null,
        transferToAccountCurrencyCode: index % 11 === 0 ? "JPY" : null,
      })),
      page: 1,
      limit: 100,
      total: 125,
    };
    const dashboardEvents = {
      forecast: forecast.slice(0, 36),
      accountForecasts: accountForecasts.map((forecastItem) => ({
        accountId: forecastItem.accountId,
        accountName: forecastItem.accountName,
        events: forecastItem.events.slice(0, 36),
      })),
    };
    const scopedDashboard = {
      ...dashboard,
      forecast: dashboardEvents.forecast,
      accountForecasts: dashboard.accountForecasts.map((forecastItem) => ({
        ...forecastItem,
        events: dashboardEvents.accountForecasts.find((item) => item.accountId === forecastItem.accountId)?.events ?? [],
      })),
    };

    addRoute("GET", "/api/dashboard?applyOffset=true", { body: dashboard });
    addRoute("GET", "/api/dashboard/events?months=6&applyOffset=true", { body: dashboardEvents });
    addRoute("GET", "/api/accounts", { body: accounts });
    addRoute("GET", "/api/recurring-items", { body: recurring });
    addRoute("GET", "/api/credit-cards", { body: creditCards });
    addRoute("GET", "/api/loans", { body: loans });
    addRoute("GET", "/api/billings?month=2026-03", { body: billing });
    addRoute("GET", "/api/transactions?page=1&limit=100&startDate=2026-03-01&endDate=2026-03-31", {
      body: transactions,
    });

    const [monthly, budget, forecastPrompt, expense] = await Promise.all([
      client.getPrompt({ name: "monthly-report", arguments: { month: "2026-03" } }),
      client.getPrompt({ name: "budget-advice", arguments: {} }),
      client.getPrompt({ name: "forecast-analysis", arguments: { months: "6" } }),
      client.getPrompt({ name: "expense-breakdown", arguments: { month: "2026-03" } }),
    ]);

    const legacyMonthly = [
      "【ダッシュボードデータ】",
      JSON.stringify(dashboard, null, 2),
      "【請求データ】",
      JSON.stringify(billing, null, 2),
      "【口座一覧】",
      JSON.stringify(accounts, null, 2),
    ].join("\n");
    const legacyBudget = [
      JSON.stringify(dashboard, null, 2),
      JSON.stringify(recurring, null, 2),
      JSON.stringify(creditCards, null, 2),
      JSON.stringify(loans, null, 2),
    ].join("\n");
    const legacyForecast = JSON.stringify(scopedDashboard, null, 2);
    const legacyExpense = [
      JSON.stringify(transactions, null, 2),
      JSON.stringify(billing, null, 2),
      JSON.stringify(recurring, null, 2),
    ].join("\n");

    expect(getPromptText(monthly).length).toBeLessThan(legacyMonthly.length / 2);
    expect(getPromptText(budget).length).toBeLessThan(legacyBudget.length / 2);
    expect(getPromptText(forecastPrompt).length).toBeLessThan(legacyForecast.length / 2);
    expect(getPromptText(expense).length).toBeLessThan(legacyExpense.length / 2);
  });

  it("builds forecast-analysis with month-scoped dashboard events", async () => {
    const prompt = await client.getPrompt({
      name: "forecast-analysis",
      arguments: { months: "6" },
    });

    const promptText = getPromptText(prompt);
    expect(promptText).toContain("今後 6 ヶ月");
    expect(promptText).toContain("【合計残高予測イベント】");
    expect(promptText).toContain("2026-03-25 収入 給与 ￥250,000 残高 ￥373,456");
    expect(promptText).not.toContain("\"id\": \"event-2\"");
    expect(promptText).not.toMatch(rawJsonKeyPattern);

    const requests = (globalThis as typeof globalThis & {
      __mcpRequests?: Array<{ method: string; path: string; body?: unknown }>;
    }).__mcpRequests ?? [];

    expect(requests).toContainEqual({
      method: "GET",
      path: "/api/dashboard?applyOffset=true",
      body: undefined,
    });
    expect(requests).toContainEqual({
      method: "GET",
      path: "/api/dashboard/events?months=6&applyOffset=true",
      body: undefined,
    });
  });
});
