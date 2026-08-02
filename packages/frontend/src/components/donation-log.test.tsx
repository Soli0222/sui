import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Donation } from "@sui/shared";
import { DonationLog } from "./donation-log";

vi.mock("../hooks/use-resource", () => ({
  useResource: vi.fn(),
}));

import { useResource } from "../hooks/use-resource";

const baseDonations: Donation[] = [
  {
    id: "11111111-1111-4111-a111-111111111111",
    recipient: "自治体A",
    amount: 50000,
    memo: "感謝状",
    donatedOn: "2025-04-10",
    deletedAt: null,
    createdAt: "2025-04-10T00:00:00.000Z",
    updatedAt: "2025-04-10T00:00:00.000Z",
  },
  {
    id: "22222222-2222-4222-a222-222222222222",
    recipient: "自治体B",
    amount: 30000,
    memo: null,
    donatedOn: "2025-08-20",
    deletedAt: null,
    createdAt: "2025-08-20T00:00:00.000Z",
    updatedAt: "2025-08-20T00:00:00.000Z",
  },
];

function mockUseResource(data: Donation[]) {
  vi.mocked(useResource).mockReturnValue({
    data,
    loading: false,
    error: null,
    setData: vi.fn(),
  });
}

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: true,
      media: "",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
});

describe("DonationLog", () => {
  it("renders the memo column on desktop with content or a placeholder", () => {
    mockUseResource(baseDonations);
    render(<DonationLog />);

    expect(screen.getByRole("columnheader", { name: "メモ" })).toBeVisible();

    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("感謝状");
    expect(table).toHaveTextContent("—");
  });

  it("uses calendar-year wording in the lead copy", () => {
    mockUseResource([]);
    render(<DonationLog />);

    expect(screen.getByText("寄付の記録を年ごとに管理します。")).toBeVisible();
  });
});
