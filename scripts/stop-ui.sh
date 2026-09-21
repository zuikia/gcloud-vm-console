#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UI_DIR="${ROOT_DIR}/ui"
PORT="${PORT:-8787}"
URL="http://127.0.0.1:${PORT}"

if ! command -v lsof >/dev/null 2>&1; then
  echo "lsof is required to find the UI process on port ${PORT}."
  exit 1
fi

PIDS="$(lsof -tiTCP:"${PORT}" -sTCP:LISTEN || true)"

if [[ -z "${PIDS}" ]]; then
  echo "UI is not running on ${URL}."
  exit 0
fi

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

print_skipped_pids() {
  if [[ "${#SKIPPED_PIDS[@]}" -eq 0 ]]; then
    return 0
  fi
  for skipped in "${SKIPPED_PIDS[@]}"; do
    echo "Refusing to stop PID ${skipped%%:*}; cwd: ${skipped#*:}"
  done
}

if [[ "${#MATCHED_PIDS[@]}" -eq 0 ]]; then
  echo "Found a process on ${URL}, but it is not this project's UI server."
  print_skipped_pids
  exit 1
fi

print_skipped_pids

echo "Stopping UI on ${URL}..."
kill "${MATCHED_PIDS[@]}"

matched_pids_still_running() {
  for pid in "${MATCHED_PIDS[@]}"; do
    if kill -0 "${pid}" 2>/dev/null; then
      return 0
    fi
  done
  return 1
}

for _ in {1..20}; do
  if ! matched_pids_still_running; then
    echo "UI stopped."
    exit 0
  fi
  sleep 0.2
done

echo "UI did not stop after SIGTERM; forcing shutdown..."
kill -9 "${MATCHED_PIDS[@]}" 2>/dev/null || true
echo "UI stopped."
