// Entirely synthetic fixtures. Never derived from a user's MF export.
import type { SpendingRequest, SpendingDetail } from "@sui/shared";
export function syntheticRequest(
  id = "request",
  amount = 12000,
): SpendingRequest {
  return {
    id,
    version: 1,
    status: "draft",
    approvedAmount: 0,
    expiresAt: null,
    closedRemainder: false,
    createdAt: "2026-09-06T00:00:00Z",
    deletedAt: null,
    purchases: [],
    fundingLinks: [],
    history: [],
    input: {
      name: "架空の書架",
      reason: "学習用資料の収納",
      purchaseDate: "2026-09-06",
      payment: "架空カード",
      kind: "normal",
      currency: "JPY",
      rateToJpy: 1,
      rateAt: "2026-09-06",
      urgency: "",
      replacement: "",
      alternatives: "",
      relatedIds: [],
      funding: null,
      items: [
        {
          id: "item-" + id,
          name: "架空の書架",
          amount,
          category: "学習",
          month: "2026-09",
          forecastId: null,
          forecastAmount: 0,
        },
      ],
    },
  };
}
export function syntheticDetail(
  id = "detail",
  amount = -20000,
  date = "2026-09-01",
): SpendingDetail {
  return {
    id,
    sourceId: id,
    raw: { ID: id },
    date,
    description: "架空店舗",
    amount,
    categorySource: "教養/学習",
    paymentSource: "架空カード",
    included: true,
    transfer: false,
    version: 1,
    deletedAt: null,
    oneOff: false,
    classificationReason: "",
    fixedId: null,
    refundOf: null,
  };
}
