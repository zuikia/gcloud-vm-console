#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UI_DIR="${ROOT_DIR}/ui"
PORT="${PORT:-8787}"
URL="http://127.0.0.1:${PORT}"
HEALTH_URL="${URL}/api/health"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed or not in PATH."
  echo "Install Node.js first, then run this script again."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not installed or not in PATH."
  echo "Install Node.js/npm first, then run this script again."
  exit 1
fi

if ! command -v lsof >/dev/null 2>&1; then
  echo "lsof is required to check whether port ${PORT} is already in use."
  exit 1
fi

EXPECTED_REVISION="$(node "${UI_DIR}/scripts/runtime-revision.mjs")"

has_current_health() {
  command -v curl >/dev/null 2>&1 || return 1
  local body
  body="$(curl --noproxy '*' -fsS "${HEALTH_URL}" 2>/dev/null || true)"
    [[ "${body}" == *'"mode":"gcloud-only"'* || "${body}" == *'"mode": "gcloud-only"'* ]] &&
    [[ "${body}" == *"\"runtimeRevision\":\"${EXPECTED_REVISION}\""* ]] &&
    [[ "${body}" == *'"regionCatalog":true'* || "${body}" == *'"regionCatalog": true'* ]] &&
    [[ "${body}" == *'"freeRuleCalibration":true'* || "${body}" == *'"freeRuleCalibration": true'* ]] &&
    [[ "${body}" == *'"externalInstanceRecognition":true'* || "${body}" == *'"externalInstanceRecognition": true'* ]] &&
    [[ "${body}" == *'"localAdoption":true'* || "${body}" == *'"localAdoption": true'* ]] &&
    [[ "${body}" == *'"persistentJobHistory":true'* || "${body}" == *'"persistentJobHistory": true'* ]] &&
    [[ "${body}" == *'"runtimeOptimization":true'* || "${body}" == *'"runtimeOptimization": true'* ]] &&
    [[ "${body}" == *'"networkResilience":true'* || "${body}" == *'"networkResilience": true'* ]] &&
    [[ "${body}" == *'"resilientInventory":true'* || "${body}" == *'"resilientInventory": true'* ]] &&
    [[ "${body}" == *'"firewallGovernance":true'* || "${body}" == *'"firewallGovernance": true'* ]] &&
    [[ "${body}" == *'"localSecretStore":true'* || "${body}" == *'"localSecretStore": true'* ]] &&
    [[ "${body}" == *'"sshDualEntry":true'* || "${body}" == *'"sshDualEntry": true'* ]] &&
    [[ "${body}" == *'"portExposureGovernance":true'* || "${body}" == *'"portExposureGovernance": true'* ]] &&
    [[ "${body}" == *'"metadataSafeReadOnlySsh":true'* || "${body}" == *'"metadataSafeReadOnlySsh": true'* ]] &&
    [[ "${body}" == *'"warpEgressManagement":true'* || "${body}" == *'"warpEgressManagement": true'* ]]
}

stop_matched_pids() {
  local pids=("$@")
  kill "${pids[@]}"
  for _ in {1..20}; do
    local any_running=0
    for pid in "${pids[@]}"; do
      if kill -0 "${pid}" 2>/dev/null; then
        any_running=1
      fi
    done
    if [[ "${any_running}" -eq 0 ]]; then
      return 0
    fi
    sleep 0.2
  done
  kill -9 "${pids[@]}" 2>/dev/null || true
}

print_skipped_pids() {
  if [[ "${#SKIPPED_PIDS[@]}" -eq 0 ]]; then
    return 0
  fi
  for skipped in "${SKIPPED_PIDS[@]}"; do
    echo "Refusing to reuse a process on ${URL}; PID ${skipped%%:*}; cwd: ${skipped#*:}"
  done
}

PIDS="$(lsof -tiTCP:"${PORT}" -sTCP:LISTEN || true)"
if [[ -n "${PIDS}" ]]; then
  MATCHED_PIDS=()
  SKIPPED_PIDS=()
  for pid in ${PIDS}; do
    cwd="$(lsof -a -p "${pid}" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1 || true)"
    if [[ "${cwd}" == "${UI_DIR}" ]]; then
      MATCHED_PIDS+=("${pid}")
    else
      SKIPPED_PIDS+=("${pid}:${cwd:-unknown cwd}")
    fi
  done

  if [[ "${#MATCHED_PIDS[@]}" -eq 0 ]]; then
    echo "Found a process on ${URL}, but it is not this project's UI server."
    print_skipped_pids
    exit 1
  fi

  print_skipped_pids
  if [[ "${#SKIPPED_PIDS[@]}" -gt 0 ]]; then
    exit 1
  fi

  if has_current_health; then
    echo "UI is already running:"
    echo "  ${URL}"
    exit 0
  fi

  echo "Restarting stale project UI server on ${URL}..."
  stop_matched_pids "${MATCHED_PIDS[@]}"
fi

echo "Starting GCP VM Console..."
echo "URL: ${URL}"
echo
cd "${UI_DIR}"
PORT="${PORT}" npm start
