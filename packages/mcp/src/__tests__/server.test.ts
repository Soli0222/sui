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

function getStructuredContent(result: unknown) {
  if (typeof result !== "object" || result === null || !("structuredContent" in result)) {
    return undefined;
  }

  return result.structuredContent;
}

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
    addRoute("GET", "/api/accounts", {
      body: [{
        id: "11111111-1111-4111-a111-111111111111",
        name: "Main",
        balance: 123456,
        sortOrder: 1,
        deletedAt: null,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      }],
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
    addRoute("GET", "/api/recurring-items", { body: [] });
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
    addRoute("GET", "/api/subscriptions", { body: [] });
    addRoute("GET", "/api/credit-cards", { body: [] });
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
    addRoute("GET", "/api/loans", { body: [] });
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

  it("forwards transaction deletes to the REST API", async () => {
    const result = await client.callTool({
      name: "delete_transaction",
      arguments: {
        id: "33333333-3333-4333-a333-333333333333",
      },
    });

    expect(getToolText(result)).toContain("33333333-3333-4333-a333-333333333333");

    const requests = (globalThis as typeof globalThis & {
      __mcpRequests?: Array<{ method: string; path: string; body?: unknown }>;
    }).__mcpRequests ?? [];

    expect(requests).toContainEqual({
      method: "DELETE",
      path: "/api/transactions/33333333-3333-4333-a333-333333333333",
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

  it("builds forecast-analysis with month-scoped dashboard events", async () => {
    const prompt = await client.getPrompt({
      name: "forecast-analysis",
      arguments: { months: "6" },
    });

    const promptText = prompt.messages[0]?.content.type === "text"
      ? prompt.messages[0].content.text
      : "";
    expect(promptText).toContain("今後 6 ヶ月");
    expect(promptText).toContain("\"forecast\": [");
    expect(promptText).not.toContain("\"id\": \"event-2\"");

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
