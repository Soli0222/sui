#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"

post() {
  local path="$1"
  local data="$2"
  curl -sf -X POST "${BASE_URL}${path}" \
    -H 'Content-Type: application/json' \
    -d "$data" > /dev/null
  echo "  POST ${path}"
}

put() {
  local path="$1"
  local data="$2"
  curl -sf -X PUT "${BASE_URL}${path}" \
    -H 'Content-Type: application/json' \
    -d "$data" > /dev/null
  echo "  PUT  ${path}"
}

get_id() {
  local path="$1"
  local name="$2"
  curl -sf "${BASE_URL}${path}" | grep -o "\"id\":\"[^\"]*\",\"name\":\"${name}\"" | head -1 | grep -o '"id":"[^"]*"' | cut -d'"' -f4
}

echo "=== Seeding test data to ${BASE_URL} ==="

# --- 口座 ---
echo "[1/5] 口座"
post /api/accounts '{"name":"三菱UFJ銀行","balance":1250000,"sortOrder":1}'
post /api/accounts '{"name":"楽天銀行","balance":680000,"sortOrder":2}'
post /api/accounts '{"name":"住信SBIネット銀行","balance":320000,"sortOrder":3}'

UFJ_ID=$(get_id /api/accounts "三菱UFJ銀行")
RAKUTEN_ID=$(get_id /api/accounts "楽天銀行")
SBI_ID=$(get_id /api/accounts "住信SBIネット銀行")

# --- 固定収支 ---
echo "[2/5] 固定収支"
post /api/recurring-items "{\"name\":\"給料\",\"type\":\"income\",\"amount\":350000,\"dayOfMonth\":25,\"accountId\":\"${UFJ_ID}\",\"enabled\":true,\"sortOrder\":1,\"startDate\":null,\"endDate\":null}"
post /api/recurring-items "{\"name\":\"家賃\",\"type\":\"expense\",\"amount\":95000,\"dayOfMonth\":27,\"accountId\":\"${UFJ_ID}\",\"enabled\":true,\"sortOrder\":2,\"startDate\":null,\"endDate\":null}"
post /api/recurring-items "{\"name\":\"電気代\",\"type\":\"expense\",\"amount\":8500,\"dayOfMonth\":15,\"accountId\":\"${RAKUTEN_ID}\",\"enabled\":true,\"sortOrder\":3,\"startDate\":null,\"endDate\":null}"
post /api/recurring-items "{\"name\":\"ガス代\",\"type\":\"expense\",\"amount\":4200,\"dayOfMonth\":10,\"accountId\":\"${RAKUTEN_ID}\",\"enabled\":true,\"sortOrder\":4,\"startDate\":null,\"endDate\":null}"
post /api/recurring-items "{\"name\":\"水道代\",\"type\":\"expense\",\"amount\":3800,\"dayOfMonth\":20,\"accountId\":\"${RAKUTEN_ID}\",\"enabled\":true,\"sortOrder\":5,\"startDate\":null,\"endDate\":null}"
post /api/recurring-items "{\"name\":\"通信費\",\"type\":\"expense\",\"amount\":5500,\"dayOfMonth\":1,\"accountId\":\"${SBI_ID}\",\"enabled\":true,\"sortOrder\":6,\"startDate\":null,\"endDate\":null}"
post /api/recurring-items "{\"name\":\"サブスク（動画）\",\"type\":\"expense\",\"amount\":1990,\"dayOfMonth\":5,\"accountId\":\"${SBI_ID}\",\"enabled\":true,\"sortOrder\":7,\"startDate\":\"2025-01-05\",\"endDate\":null}"

# --- クレジットカード ---
echo "[3/5] クレジットカード"
post /api/credit-cards "{\"name\":\"三井住友カード\",\"settlementDay\":26,\"accountId\":\"${UFJ_ID}\",\"assumptionAmount\":45000,\"sortOrder\":1}"
post /api/credit-cards "{\"name\":\"楽天カード\",\"settlementDay\":27,\"accountId\":\"${RAKUTEN_ID}\",\"assumptionAmount\":30000,\"sortOrder\":2}"

# --- ローン ---
echo "[4/5] ローン"
post /api/loans "{\"name\":\"MacBook Pro 分割\",\"totalAmount\":360000,\"startDate\":\"2026-01-15\",\"paymentCount\":24,\"accountId\":\"${SBI_ID}\"}"

# --- 取引履歴 ---
echo "[5/5] 取引履歴"
post /api/transactions "{\"accountId\":\"${UFJ_ID}\",\"date\":\"2026-03-10\",\"type\":\"expense\",\"description\":\"書籍購入\",\"amount\":2800}"
post /api/transactions "{\"accountId\":\"${RAKUTEN_ID}\",\"date\":\"2026-03-08\",\"type\":\"expense\",\"description\":\"食料品\",\"amount\":5400}"
post /api/transactions "{\"accountId\":\"${UFJ_ID}\",\"transferToAccountId\":\"${RAKUTEN_ID}\",\"date\":\"2026-03-05\",\"type\":\"transfer\",\"description\":\"生活費振替\",\"amount\":100000}"

echo ""
echo "=== Done ==="
