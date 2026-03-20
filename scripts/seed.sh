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

day_shift() {
  local offset="$1"
  local fmt="${2:-%Y-%m-%d}"
  if [[ "$offset" == "0" ]]; then
    TZ=Asia/Tokyo date +"${fmt}"
  elif TZ=Asia/Tokyo date -v"${offset}"d +"${fmt}" >/dev/null 2>&1; then
    TZ=Asia/Tokyo date -v"${offset}"d +"${fmt}"
  else
    TZ=Asia/Tokyo date -d "${offset} day" +"${fmt}"
  fi
}

month_shift() {
  local offset="$1"
  local fmt="${2:-%Y-%m}"
  if [[ "$offset" == "0" ]]; then
    TZ=Asia/Tokyo date +"${fmt}"
  elif TZ=Asia/Tokyo date -v"${offset}"m +"${fmt}" >/dev/null 2>&1; then
    TZ=Asia/Tokyo date -v"${offset}"m +"${fmt}"
  else
    TZ=Asia/Tokyo date -d "${offset} month" +"${fmt}"
  fi
}

month_date() {
  local offset="$1"
  local day="$2"
  printf '%s-%s\n' "$(month_shift "$offset" "%Y-%m")" "$day"
}

post_transaction() {
  local account_id="$1"
  local date="$2"
  local type="$3"
  local description="$4"
  local amount="$5"
  local transfer_to_account_id="${6:-}"

  if [[ -n "$transfer_to_account_id" ]]; then
    post /api/transactions "{\"accountId\":\"${account_id}\",\"transferToAccountId\":\"${transfer_to_account_id}\",\"date\":\"${date}\",\"type\":\"${type}\",\"description\":\"${description}\",\"amount\":${amount}}"
  else
    post /api/transactions "{\"accountId\":\"${account_id}\",\"date\":\"${date}\",\"type\":\"${type}\",\"description\":\"${description}\",\"amount\":${amount}}"
  fi
}

CURRENT_MONTH=$(month_shift 0)
NEXT_MONTH=$(month_shift +1)
PREVIOUS_MONTH=$(month_shift -1)
TWO_MONTHS_AGO=$(month_shift -2)

echo "=== Seeding test data to ${BASE_URL} ==="
echo "    current month: ${CURRENT_MONTH}"
echo "    previous month: ${PREVIOUS_MONTH}"
echo "    two months ago: ${TWO_MONTHS_AGO}"

# --- 口座 ---
echo "[1/7] 口座"
post /api/accounts '{"name":"三菱UFJ銀行","balance":1250000,"sortOrder":1}'
post /api/accounts '{"name":"楽天銀行","balance":680000,"sortOrder":2}'
post /api/accounts '{"name":"住信SBIネット銀行","balance":320000,"sortOrder":3}'

UFJ_ID=$(get_id /api/accounts "三菱UFJ銀行")
RAKUTEN_ID=$(get_id /api/accounts "楽天銀行")
SBI_ID=$(get_id /api/accounts "住信SBIネット銀行")

# --- 固定収支 ---
echo "[2/7] 固定収支"
post /api/recurring-items "{\"name\":\"給料\",\"type\":\"income\",\"amount\":350000,\"dayOfMonth\":25,\"accountId\":\"${UFJ_ID}\",\"enabled\":true,\"sortOrder\":1,\"startDate\":null,\"endDate\":null}"
post /api/recurring-items "{\"name\":\"家賃\",\"type\":\"expense\",\"amount\":95000,\"dayOfMonth\":27,\"accountId\":\"${UFJ_ID}\",\"enabled\":true,\"sortOrder\":2,\"startDate\":null,\"endDate\":null}"
post /api/recurring-items "{\"name\":\"電気代\",\"type\":\"expense\",\"amount\":8500,\"dayOfMonth\":15,\"accountId\":\"${RAKUTEN_ID}\",\"enabled\":true,\"sortOrder\":3,\"startDate\":null,\"endDate\":null}"
post /api/recurring-items "{\"name\":\"ガス代\",\"type\":\"expense\",\"amount\":4200,\"dayOfMonth\":10,\"accountId\":\"${RAKUTEN_ID}\",\"enabled\":true,\"sortOrder\":4,\"startDate\":null,\"endDate\":null}"
post /api/recurring-items "{\"name\":\"水道代\",\"type\":\"expense\",\"amount\":3800,\"dayOfMonth\":20,\"accountId\":\"${RAKUTEN_ID}\",\"enabled\":true,\"sortOrder\":5,\"startDate\":null,\"endDate\":null}"
post /api/recurring-items "{\"name\":\"通信費\",\"type\":\"expense\",\"amount\":5500,\"dayOfMonth\":1,\"accountId\":\"${SBI_ID}\",\"enabled\":true,\"sortOrder\":6,\"startDate\":null,\"endDate\":null}"
post /api/recurring-items "{\"name\":\"サブスク（動画）\",\"type\":\"expense\",\"amount\":1990,\"dayOfMonth\":5,\"accountId\":\"${SBI_ID}\",\"enabled\":true,\"sortOrder\":7,\"startDate\":\"2025-01-05\",\"endDate\":null}"

# --- クレジットカード ---
echo "[3/7] クレジットカード"
post /api/credit-cards "{\"name\":\"三井住友カード\",\"settlementDay\":26,\"accountId\":\"${UFJ_ID}\",\"assumptionAmount\":45000,\"sortOrder\":1}"
post /api/credit-cards "{\"name\":\"楽天カード\",\"settlementDay\":27,\"accountId\":\"${RAKUTEN_ID}\",\"assumptionAmount\":30000,\"sortOrder\":2}"

# --- ローン ---
echo "[4/7] ローン"
post /api/loans "{\"name\":\"MacBook Pro 分割\",\"totalAmount\":360000,\"startDate\":\"2026-01-15\",\"paymentCount\":24,\"accountId\":\"${SBI_ID}\"}"

# --- ビリング ---
echo "[5/7] ビリング"
SMBC_CARD_ID=$(get_id /api/credit-cards "三井住友カード")
RAKUTEN_CARD_ID=$(get_id /api/credit-cards "楽天カード")

put "/api/billings/${CURRENT_MONTH}" "{\"settlementDate\":\"${CURRENT_MONTH}-26\",\"items\":[{\"creditCardId\":\"${SMBC_CARD_ID}\",\"amount\":42300},{\"creditCardId\":\"${RAKUTEN_CARD_ID}\",\"amount\":28500}]}"
put "/api/billings/${NEXT_MONTH}" "{\"items\":[{\"creditCardId\":\"${SMBC_CARD_ID}\",\"amount\":38900}]}"

# --- 取引履歴 ---
echo "[6/7] 取引履歴"
echo "  default 3 monthsに20件超、さらに6ヶ月/1年/全期間用の古い取引も投入"

post_transaction "${UFJ_ID}" "$(day_shift -1)" "expense" "今週 外食" 4800
post_transaction "${RAKUTEN_ID}" "$(day_shift -2)" "expense" "今週 食料品まとめ買い" 7600
post_transaction "${SBI_ID}" "$(day_shift -3)" "expense" "今週 コンビニ" 1320
post_transaction "${UFJ_ID}" "$(day_shift -4)" "expense" "今週 ドラッグストア" 2860
post_transaction "${RAKUTEN_ID}" "$(day_shift -5)" "income" "立替精算" 12000
post_transaction "${UFJ_ID}" "$(day_shift -6)" "transfer" "今月 生活費振替" 100000 "${RAKUTEN_ID}"
post_transaction "${SBI_ID}" "$(day_shift -7)" "expense" "今週 カフェ" 980
post_transaction "${UFJ_ID}" "$(day_shift -8)" "expense" "今週 書籍購入" 3200

post_transaction "${RAKUTEN_ID}" "$(month_date -1 03)" "expense" "先月 食料品" 5400
post_transaction "${UFJ_ID}" "$(month_date -1 05)" "expense" "先月 書籍購入" 2800
post_transaction "${UFJ_ID}" "$(month_date -1 07)" "transfer" "先月 生活費振替" 90000 "${RAKUTEN_ID}"
post_transaction "${RAKUTEN_ID}" "$(month_date -1 10)" "expense" "先月 日用品" 3200
post_transaction "${SBI_ID}" "$(month_date -1 12)" "expense" "先月 コンビニ" 1280
post_transaction "${UFJ_ID}" "$(month_date -1 16)" "expense" "先月 外食" 4500
post_transaction "${RAKUTEN_ID}" "$(month_date -1 19)" "expense" "先月 クリーニング" 2100
post_transaction "${SBI_ID}" "$(month_date -1 24)" "expense" "先月 サブスク課金" 1590

post_transaction "${UFJ_ID}" "$(month_date -2 02)" "income" "2ヶ月前 フリマ売上" 6800
post_transaction "${RAKUTEN_ID}" "$(month_date -2 04)" "expense" "2ヶ月前 食料品" 4980
post_transaction "${SBI_ID}" "$(month_date -2 06)" "expense" "2ヶ月前 コンビニ" 940
post_transaction "${UFJ_ID}" "$(month_date -2 09)" "expense" "2ヶ月前 家具小物" 7200
post_transaction "${UFJ_ID}" "$(month_date -2 13)" "transfer" "2ヶ月前 貯蓄振替" 60000 "${SBI_ID}"
post_transaction "${RAKUTEN_ID}" "$(month_date -2 17)" "expense" "2ヶ月前 医療費" 3600
post_transaction "${SBI_ID}" "$(month_date -2 21)" "expense" "2ヶ月前 ガジェット小物" 2450
post_transaction "${UFJ_ID}" "$(month_date -2 26)" "expense" "2ヶ月前 交際費" 8300

post_transaction "${RAKUTEN_ID}" "$(month_date -4 05)" "expense" "4ヶ月前 旅行積立" 15000
post_transaction "${UFJ_ID}" "$(month_date -4 11)" "income" "4ヶ月前 臨時収入" 50000
post_transaction "${SBI_ID}" "$(month_date -4 18)" "expense" "4ヶ月前 ソフトウェア更新" 6200

post_transaction "${UFJ_ID}" "$(month_date -9 08)" "expense" "9ヶ月前 冠婚葬祭" 30000
post_transaction "${RAKUTEN_ID}" "$(month_date -9 20)" "expense" "9ヶ月前 家電修理" 12800

post_transaction "${UFJ_ID}" "$(month_date -15 12)" "expense" "15ヶ月前 引っ越し初期費用" 180000

# --- ダッシュボード読み込みで自動確定を発火 ---
echo "[7/7] 自動確定トリガー"
curl -sf "${BASE_URL}/api/dashboard" > /dev/null
echo "  GET  /api/dashboard (過去の予測イベントを自動確定)"

echo ""
echo "=== Done ==="
