#!/usr/bin/env bash
set -euo pipefail

readonly EXPECTED_ARCHIVE_SHA256="82488317ff72456fb73bc9d206853229eb316a5ecf8b1b8a0fd46e273d0e82af"
readonly RELAY_URL="${OSSR_ACCEPTANCE_RELAY_URL:-http://127.0.0.1:3002}"
readonly FOLLOWER_URL="${OSSR_ACCEPTANCE_FOLLOWER_URL:-http://127.0.0.1:20443}"
readonly REFERENCE_URL="${OSSR_ACCEPTANCE_REFERENCE_URL:-https://api.testnet.hiro.so}"

usage() {
  printf '%s\n' \
    "Usage:" \
    "  $0 preflight --archive PATH [--evidence-dir PATH]" \
    "  $0 verify [--evidence-dir PATH]" \
    "" \
    "Run preflight before opening the desktop. Run verify after installing the" \
    "system service in the desktop and again after reboot, using the same" \
    "evidence directory. This script never reads .env.local or journal contents."
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

record_command() {
  local output_file="$1"
  shift
  {
    printf '$'
    printf ' %q' "$@"
    printf '\n'
    "$@"
  } >"$output_file" 2>&1
}

record_optional_command() {
  local output_file="$1"
  shift
  if ! record_command "$output_file" "$@"; then
    printf 'Command failed; inspect this file for details.\n' >>"$output_file"
    return 1
  fi
}

json_get() {
  local url="$1"
  local output_file="$2"
  curl --fail --silent --show-error --max-time 15 "$url" \
    | jq --sort-keys . >"$output_file"
}

mode="${1:-}"
if [[ "$mode" == "-h" || "$mode" == "--help" ]]; then
  usage
  exit 0
fi
[[ "$mode" == "preflight" || "$mode" == "verify" ]] || {
  usage
  exit 2
}
shift

archive=""
evidence_dir=""
while (($#)); do
  case "$1" in
    --archive)
      (($# >= 2)) || die "--archive requires a path"
      archive="$2"
      shift 2
      ;;
    --evidence-dir)
      (($# >= 2)) || die "--evidence-dir requires a path"
      evidence_dir="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *) die "unknown argument: $1" ;;
  esac
done

if [[ -z "$evidence_dir" ]]; then
  evidence_dir="$PWD/operator-desktop-acceptance-$(date -u +%Y%m%dT%H%M%SZ)"
fi
mkdir -p "$evidence_dir"
evidence_dir="$(cd "$evidence_dir" && pwd)"

require_command date
require_command uname

if [[ "$mode" == "preflight" ]]; then
  [[ -n "$archive" ]] || die "preflight requires --archive PATH"
  [[ -f "$archive" ]] || die "archive not found: $archive"
  require_command sha256sum
  require_command tar
  require_command systemctl
  require_command curl
  require_command jq
  require_command pkexec

  actual_sha256="$(sha256sum "$archive" | cut -d' ' -f1)"
  [[ "$actual_sha256" == "$EXPECTED_ARCHIVE_SHA256" ]] \
    || die "archive checksum mismatch: expected $EXPECTED_ARCHIVE_SHA256, got $actual_sha256"

  printf '%s  %s\n' "$actual_sha256" "$(basename "$archive")" \
    >"$evidence_dir/archive.sha256"
  tar -tzf "$archive" >"$evidence_dir/archive-contents.txt"
  record_command "$evidence_dir/host.txt" uname -a
  {
    printf 'timestamp_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'user_uid=%s\n' "$(id -u)"
    printf 'desktop_session=%s\n' "${XDG_CURRENT_DESKTOP:-unset}"
    printf 'session_type=%s\n' "${XDG_SESSION_TYPE:-unset}"
    printf 'systemd_version=%s\n' "$(systemctl --version | head -n 1)"
    printf 'pkexec=%s\n' "$(command -v pkexec)"
  } >"$evidence_dir/preflight.txt"

  cat >"$evidence_dir/manual-observations.md" <<'EOF'
# OSSR operator desktop independent acceptance observations

- Tester:
- Distribution and version:
- Desktop environment:
- Fresh VM or machine description:
- Archive downloaded from the v0.1.0 GitHub release: yes / no
- Native Polkit prompt appeared: yes / no
- Application received or handled an administrator password directly: yes / no
- Installation completed without undocumented steps: yes / no
- Dashboard showed relay and follower state correctly: yes / no
- Reboot completed: yes / no
- Dashboard opened after graphical login: yes / no
- Relay was active before graphical login: yes / no / not observed
- Sponsored testnet transaction ID:
- Controlled rejection exercised and result:
- Confusing or missing instructions:
- Other observations:
EOF

  printf 'Preflight passed. Evidence: %s\n' "$evidence_dir"
  printf 'Next: extract and open the verified archive, then use Install system service.\n'
  printf 'After installation, run this script in verify mode with the same evidence directory.\n'
  exit 0
fi

require_command systemctl
require_command curl
require_command jq

run_number=1
while [[ -e "$evidence_dir/verify-$run_number" ]]; do
  run_number=$((run_number + 1))
done
verify_dir="$evidence_dir/verify-$run_number"
mkdir -p "$verify_dir"

failures=0
checks=0
check() {
  local label="$1"
  shift
  checks=$((checks + 1))
  if "$@"; then
    printf 'PASS %s\n' "$label" | tee -a "$verify_dir/results.txt"
  else
    printf 'FAIL %s\n' "$label" | tee -a "$verify_dir/results.txt"
    failures=$((failures + 1))
  fi
}

printf 'timestamp_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$verify_dir/context.txt"
printf 'boot_id=%s\n' "$(cat /proc/sys/kernel/random/boot_id)" >>"$verify_dir/context.txt"

check "relay unit is installed" test -f /etc/systemd/system/ossr-relay.service
check "relay unit is enabled" record_optional_command "$verify_dir/relay-enabled.txt" systemctl is-enabled ossr-relay.service
check "relay unit is active" record_optional_command "$verify_dir/relay-active.txt" systemctl is-active ossr-relay.service
check "dashboard unit is installed" test -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/ossr-operator-dashboard.service"
check "dashboard unit is enabled" record_optional_command "$verify_dir/dashboard-enabled.txt" systemctl --user is-enabled ossr-operator-dashboard.service
check "dashboard unit is active" record_optional_command "$verify_dir/dashboard-active.txt" systemctl --user is-active ossr-operator-dashboard.service
check "desktop launcher is installed" test -f "${XDG_DATA_HOME:-$HOME/.local/share}/applications/network.ossr.operator.desktop"
check "relay liveness endpoint responds" json_get "$RELAY_URL/health/live" "$verify_dir/relay-live.json"
check "relay readiness endpoint responds" json_get "$RELAY_URL/health/ready" "$verify_dir/relay-ready.json"
check "relay info endpoint responds" json_get "$RELAY_URL/v1/info" "$verify_dir/relay-info.json"
check "local follower info responds" json_get "$FOLLOWER_URL/v2/info" "$verify_dir/follower-info.json"
check "public reference info responds" json_get "$REFERENCE_URL/v2/info" "$verify_dir/reference-info.json"

if [[ -s "$verify_dir/follower-info.json" && -s "$verify_dir/reference-info.json" ]]; then
  local_height="$(jq -r '.stacks_tip_height // empty' "$verify_dir/follower-info.json")"
  reference_height="$(jq -r '.stacks_tip_height // empty' "$verify_dir/reference-info.json")"
  if [[ "$local_height" =~ ^[0-9]+$ && "$reference_height" =~ ^[0-9]+$ ]]; then
    printf 'local_height=%s\nreference_height=%s\nlag=%s\n' \
      "$local_height" "$reference_height" "$((reference_height - local_height))" \
      >"$verify_dir/chain-heights.txt"
    check "local follower is not behind the reference tip" test "$local_height" -ge "$reference_height"
  else
    printf 'FAIL chain heights were absent or invalid\n' | tee -a "$verify_dir/results.txt"
    failures=$((failures + 1))
  fi
fi

printf '\nSummary: %s checks, %s failures\n' "$checks" "$failures" | tee -a "$verify_dir/results.txt"
printf 'Evidence: %s\n' "$verify_dir"
printf 'Do not mark independent acceptance complete until verify passes both before and after reboot,\n'
printf 'and the manual observations include one transaction ID and one controlled rejection.\n'

((failures == 0))
