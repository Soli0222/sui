#!/usr/bin/env bash
set -euo pipefail

DEFAULT_BASE_URL="http://localhost:3000"

PHASE="${1:-phase1}"
BASE_URL="${2:-$DEFAULT_BASE_URL}"

if [[ "$PHASE" =~ ^https?:// ]]; then
  BASE_URL="$PHASE"
  PHASE="phase1"
fi

usage() {
  cat <<EOF
Usage:
  bash scripts/seed.sh [phase1|phase2|phase3|all] [base_url]
  bash scripts/seed.sh [base_url]

Examples:
  bash scripts/seed.sh
  bash scripts/seed.sh phase2
  bash scripts/seed.sh all http://localhost:3000

Phases:
  phase1: 一切の不足が発生しない基本データ
  phase2: オフセット不足のみが発生する追加データ
  phase3: 実残高マイナスが発生する追加データ
  all:    phase1 -> phase2 -> phase3 を順に投入
EOF
}

case "$PHASE" in
  phase1|1|phase2|2|phase3|3|all)
    ;;
  *)
    usage
    exit 1
    ;;
esac

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

trigger_dashboard() {
  curl -sf "${BASE_URL}/api/dashboard" > /dev/null
  echo "  GET  /api/dashboard"
}

CURRENT_MONTH="$(month_shift 0)"
NEXT_MONTH="$(month_shift +1)"
PREVIOUS_MONTH="$(month_shift -1)"
TWO_MONTHS_AGO="$(month_shift -2)"
NEXT_MONTH_START="${NEXT_MONTH}-01"
NEXT_MONTH_END="${NEXT_MONTH}-28"

seed_phase1() {
  echo ""
  echo "=== Phase 1: 一切の不足が発生しない基本データ ==="
  echo "    current month: ${CURRENT_MONTH}"
  echo "    previous month: ${PREVIOUS_MONTH}"
  echo "    two months ago: ${TWO_MONTHS_AGO}"

  echo "[phase1 1/7] 口座"
  post /api/accounts '{"name":"三菱UFJ銀行","balance":1250000,"balanceOffset":0,"sortOrder":1}'
  post /api/accounts '{"name":"楽天銀行","balance":680000,"balanceOffset":0,"sortOrder":2}'
  post /api/accounts '{"name":"住信SBIネット銀行","balance":320000,"balanceOffset":0,"sortOrder":3}'

  local ufj_id rakuten_id sbi_id
  ufj_id="$(get_id /api/accounts "三菱UFJ銀行")"
  rakuten_id="$(get_id /api/accounts "楽天銀行")"
  sbi_id="$(get_id /api/accounts "住信SBIネット銀行")"

  echo "[phase1 2/7] 固定収支"
  post /api/recurring-items "{\"name\":\"給料\",\"type\":\"income\",\"amount\":350000,\"dayOfMonth\":25,\"accountId\":\"${ufj_id}\",\"enabled\":true,\"sortOrder\":1,\"startDate\":null,\"endDate\":null}"
  post /api/recurring-items "{\"name\":\"家賃\",\"type\":\"expense\",\"amount\":95000,\"dayOfMonth\":27,\"accountId\":\"${ufj_id}\",\"enabled\":true,\"sortOrder\":2,\"startDate\":null,\"endDate\":null}"
  post /api/recurring-items "{\"name\":\"生活費入金\",\"type\":\"income\",\"amount\":70000,\"dayOfMonth\":8,\"accountId\":\"${rakuten_id}\",\"enabled\":true,\"sortOrder\":3,\"startDate\":null,\"endDate\":null}"
  post /api/recurring-items "{\"name\":\"電気代\",\"type\":\"expense\",\"amount\":8500,\"dayOfMonth\":15,\"accountId\":\"${rakuten_id}\",\"enabled\":true,\"sortOrder\":4,\"startDate\":null,\"endDate\":null}"
  post /api/recurring-items "{\"name\":\"ガス代\",\"type\":\"expense\",\"amount\":4200,\"dayOfMonth\":10,\"accountId\":\"${rakuten_id}\",\"enabled\":true,\"sortOrder\":5,\"startDate\":null,\"endDate\":null}"
  post /api/recurring-items "{\"name\":\"水道代\",\"type\":\"expense\",\"amount\":3800,\"dayOfMonth\":20,\"accountId\":\"${rakuten_id}\",\"enabled\":true,\"sortOrder\":6,\"startDate\":null,\"endDate\":null}"
  post /api/recurring-items "{\"name\":\"積立入金\",\"type\":\"income\",\"amount\":30000,\"dayOfMonth\":3,\"accountId\":\"${sbi_id}\",\"enabled\":true,\"sortOrder\":7,\"startDate\":null,\"endDate\":null}"
  post /api/recurring-items "{\"name\":\"通信費\",\"type\":\"expense\",\"amount\":5500,\"dayOfMonth\":1,\"accountId\":\"${sbi_id}\",\"enabled\":true,\"sortOrder\":8,\"startDate\":null,\"endDate\":null}"
  post /api/recurring-items "{\"name\":\"サブスク（動画）\",\"type\":\"expense\",\"amount\":1990,\"dayOfMonth\":5,\"accountId\":\"${sbi_id}\",\"enabled\":true,\"sortOrder\":9,\"startDate\":\"2025-01-05\",\"endDate\":null}"

  echo "[phase1 3/7] クレジットカード"
  post /api/credit-cards "{\"name\":\"三井住友カード\",\"settlementDay\":26,\"accountId\":\"${ufj_id}\",\"assumptionAmount\":45000,\"sortOrder\":1}"
  post /api/credit-cards "{\"name\":\"楽天カード\",\"settlementDay\":27,\"accountId\":\"${rakuten_id}\",\"assumptionAmount\":30000,\"sortOrder\":2}"

  echo "[phase1 4/7] ローン"
  post /api/loans "{\"name\":\"MacBook Pro 分割\",\"totalAmount\":360000,\"startDate\":\"2026-01-15\",\"paymentCount\":24,\"accountId\":\"${sbi_id}\"}"

  echo "[phase1 5/7] ビリング"
  local smbc_card_id rakuten_card_id
  smbc_card_id="$(get_id /api/credit-cards "三井住友カード")"
  rakuten_card_id="$(get_id /api/credit-cards "楽天カード")"

  put "/api/billings/${CURRENT_MONTH}" "{\"settlementDate\":\"${CURRENT_MONTH}-26\",\"items\":[{\"creditCardId\":\"${smbc_card_id}\",\"amount\":42300},{\"creditCardId\":\"${rakuten_card_id}\",\"amount\":28500}]}"
  put "/api/billings/${NEXT_MONTH}" "{\"items\":[{\"creditCardId\":\"${smbc_card_id}\",\"amount\":38900}]}"

  echo "[phase1 6/7] 取引履歴"
  echo "  default 3 monthsに20件超、さらに6ヶ月/1年/全期間用の古い取引も投入"

  post_transaction "${ufj_id}" "$(day_shift -1)" "expense" "今週 外食" 4800
  post_transaction "${rakuten_id}" "$(day_shift -2)" "expense" "今週 食料品まとめ買い" 7600
  post_transaction "${sbi_id}" "$(day_shift -3)" "expense" "今週 コンビニ" 1320
  post_transaction "${ufj_id}" "$(day_shift -4)" "expense" "今週 ドラッグストア" 2860
  post_transaction "${rakuten_id}" "$(day_shift -5)" "income" "立替精算" 12000
  post_transaction "${ufj_id}" "$(day_shift -6)" "transfer" "今月 生活費振替" 100000 "${rakuten_id}"
  post_transaction "${sbi_id}" "$(day_shift -7)" "expense" "今週 カフェ" 980
  post_transaction "${ufj_id}" "$(day_shift -8)" "expense" "今週 書籍購入" 3200

  post_transaction "${rakuten_id}" "$(month_date -1 03)" "expense" "先月 食料品" 5400
  post_transaction "${ufj_id}" "$(month_date -1 05)" "expense" "先月 書籍購入" 2800
  post_transaction "${ufj_id}" "$(month_date -1 07)" "transfer" "先月 生活費振替" 90000 "${rakuten_id}"
  post_transaction "${rakuten_id}" "$(month_date -1 10)" "expense" "先月 日用品" 3200
  post_transaction "${sbi_id}" "$(month_date -1 12)" "expense" "先月 コンビニ" 1280
  post_transaction "${ufj_id}" "$(month_date -1 16)" "expense" "先月 外食" 4500
  post_transaction "${rakuten_id}" "$(month_date -1 19)" "expense" "先月 クリーニング" 2100
  post_transaction "${sbi_id}" "$(month_date -1 24)" "expense" "先月 サブスク課金" 1590

  post_transaction "${ufj_id}" "$(month_date -2 02)" "income" "2ヶ月前 フリマ売上" 6800
  post_transaction "${rakuten_id}" "$(month_date -2 04)" "expense" "2ヶ月前 食料品" 4980
  post_transaction "${sbi_id}" "$(month_date -2 06)" "expense" "2ヶ月前 コンビニ" 940
  post_transaction "${ufj_id}" "$(month_date -2 09)" "expense" "2ヶ月前 家具小物" 7200
  post_transaction "${ufj_id}" "$(month_date -2 13)" "transfer" "2ヶ月前 貯蓄振替" 60000 "${sbi_id}"
  post_transaction "${rakuten_id}" "$(month_date -2 17)" "expense" "2ヶ月前 医療費" 3600
  post_transaction "${sbi_id}" "$(month_date -2 21)" "expense" "2ヶ月前 ガジェット小物" 2450
  post_transaction "${ufj_id}" "$(month_date -2 26)" "expense" "2ヶ月前 交際費" 8300

  post_transaction "${rakuten_id}" "$(month_date -4 05)" "expense" "4ヶ月前 旅行積立" 15000
  post_transaction "${ufj_id}" "$(month_date -4 11)" "income" "4ヶ月前 臨時収入" 50000
  post_transaction "${sbi_id}" "$(month_date -4 18)" "expense" "4ヶ月前 ソフトウェア更新" 6200

  post_transaction "${ufj_id}" "$(month_date -9 08)" "expense" "9ヶ月前 冠婚葬祭" 30000
  post_transaction "${rakuten_id}" "$(month_date -9 20)" "expense" "9ヶ月前 家電修理" 12800

  post_transaction "${ufj_id}" "$(month_date -15 12)" "expense" "15ヶ月前 引っ越し初期費用" 180000

  echo "[phase1 7/7] 自動確定トリガー"
  trigger_dashboard
  echo "  過去の予測イベントを自動確定"
}

seed_phase2() {
  echo ""
  echo "=== Phase 2: オフセット不足のみが発生する追加データ ==="

  echo "[phase2 1/3] 口座"
  post /api/accounts '{"name":"JRE BANK","balance":533000,"balanceOffset":500000,"sortOrder":10}'

  local jre_id
  jre_id="$(get_id /api/accounts "JRE BANK")"

  echo "[phase2 2/3] 単発支出"
  post /api/recurring-items "{\"name\":\"推し活 遠征積立\",\"type\":\"expense\",\"amount\":40000,\"dayOfMonth\":10,\"accountId\":\"${jre_id}\",\"enabled\":true,\"sortOrder\":10,\"startDate\":\"${NEXT_MONTH_START}\",\"endDate\":\"${NEXT_MONTH_END}\"}"

  echo "[phase2 3/3] ダッシュボード反映"
  trigger_dashboard
  echo "  JRE BANK が yellow 警告になる想定"
}

seed_phase3() {
  echo ""
  echo "=== Phase 3: 実残高マイナスが発生する追加データ ==="

  echo "[phase3 1/3] 口座"
  post /api/accounts '{"name":"赤字テスト口座","balance":30000,"balanceOffset":0,"sortOrder":11}'

  local red_id
  red_id="$(get_id /api/accounts "赤字テスト口座")"

  echo "[phase3 2/3] 単発支出"
  post /api/recurring-items "{\"name\":\"家電買い替え\",\"type\":\"expense\",\"amount\":50000,\"dayOfMonth\":12,\"accountId\":\"${red_id}\",\"enabled\":true,\"sortOrder\":11,\"startDate\":\"${NEXT_MONTH_START}\",\"endDate\":\"${NEXT_MONTH_END}\"}"

  echo "[phase3 3/3] ダッシュボード反映"
  trigger_dashboard
  echo "  赤字テスト口座 が red 警告になる想定"
}

echo "=== Seeding test data to ${BASE_URL} (${PHASE}) ==="

case "$PHASE" in
  phase1|1)
    seed_phase1
    ;;
  phase2|2)
    seed_phase2
    ;;
  phase3|3)
    seed_phase3
    ;;
  all)
    seed_phase1
    seed_phase2
    seed_phase3
    ;;
esac

echo ""
echo "=== Done ==="
