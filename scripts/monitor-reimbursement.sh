#!/usr/bin/env bash
set -eu
# Usage: monitor-reimbursement.sh <sponsorship_id> [timeout_seconds]
SPONSOR_ID=${1:-}
if [ -z "$SPONSOR_ID" ]; then
  echo "Usage: $0 <sponsorship_id> [timeout_seconds]" >&2
  exit 2
fi
TIMEOUT=${2:-300}
API_BASE=${API_BASE:-http://127.0.0.1:3000}
EXPLORER=${EXPLORER:-https://api.testnet.hiro.so}
DEADLINE=$((SECONDS + TIMEOUT))

echo "Monitoring reimbursement $SPONSOR_ID until REIMBURSED or timeout=${TIMEOUT}s"
while [ $SECONDS -le $DEADLINE ]; do
  rec=$(curl -sS "$API_BASE/v1/reimbursements/$SPONSOR_ID" || true)
  if [ -z "$rec" ]; then
    echo "No reimbursement record yet.";
    sleep 5; continue
  fi
  status=$(echo "$rec" | jq -r '.status // empty')
  op_tx=$(echo "$rec" | jq -r '.reimbursement_tx_id // empty')
  proto_tx=$(echo "$rec" | jq -r '.protocol_fee_tx_id // empty')
  echo "status=$status op_tx=$op_tx proto_tx=$proto_tx"
  if [ "$status" = "REIMBURSED" ] || [ "$status" = "REIMBURSEMENT_FAILED" ]; then
    echo "Terminal status: $status"; echo "$rec" | jq .; exit 0
  fi

  confirmed=0
  need=0
  for tx in "$op_tx" "$proto_tx"; do
    if [ -z "$tx" ] || [ "$tx" = "null" ]; then
      continue
    fi
    need=$((need+1))
    # Add 0x prefix for explorer
    txid="$tx"
    if [[ "$txid" != 0x* ]]; then txid="0x$txid"; fi
    resp=$(curl -sS "$EXPLORER/extended/v1/tx/$txid" || true)
    if [ -n "$resp" ] && echo "$resp" | jq -e '.tx_status? == "success"' >/dev/null 2>&1; then
      confirmed=$((confirmed+1))
    fi
  done

  echo "payments_confirmed=$confirmed of $need"
  if [ $need -gt 0 ] && [ $confirmed -eq $need ]; then
    echo "Both payment txs confirmed. Fetching final record..."
    curl -sS "$API_BASE/v1/reimbursements/$SPONSOR_ID" | jq .
    exit 0
  fi

  sleep 5
done

echo "Timeout waiting for reimbursement to finalize." >&2
exit 1
