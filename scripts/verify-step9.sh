#!/usr/bin/env bash
# Single-command Step 9 Docker verification — run ONLY on a machine with
# Docker actually working (this repo was largely written on one that
# didn't; see README.md's "Việc cần làm ở máy có Docker"). Written on that
# machine (no Docker) — never run there. Only `bash -n` syntax-checked
# offline; the real run (docker compose up, npm run test:e2e against real
# Postgres, real HTTP calls) has NOT happened yet. See README.md's Step 9
# entry for the exact offline verification that WAS done instead.
#
# Mirrors scripts/verify-step6.sh/verify-step8.sh's structure and
# reasoning exactly — see verify-step6.sh's header for the full rationale
# behind each design choice reused here unchanged (preflight force-rebuild
# + health-poll to avoid the "stale image" 404 trap from Step 6; not using
# `set -e`; writing a real untruncated log file; extracting ids from real
# JSON responses with `node -e` instead of adding a `jq` dependency).
#
# Usage: npm run verify:step9   (from backend/, or `bash scripts/verify-step9.sh`
#         from anywhere — paths below are resolved relative to this file,
#         not the caller's cwd)
#
# Does 3 things, all real, all logged verbatim to
# step9-verification-<timestamp>.log at the repo root (not summarized):
#   1. `docker compose ps` — health of all 5 services (backend, postgres,
#      fixture-api, production-db, supplier-portal — Step 9 adds no new
#      service, but `npm run test:e2e` now also runs
#      management-events.e2e-spec.ts alongside every prior step's suite,
#      so the whole stack still needs to be up for the backend container
#      itself to start).
#   2. `npm run test:e2e` (backend/) — full output, real exit code decides
#      the final PASS/FAILED line. This is the suite that actually proves
#      Step 9 (management-events.e2e-spec.ts's block/resume/ack-exception/
#      note/append-only cases), same as every prior step's script.
#   3. Two real calls: POST /management-events/block then POST
#      /management-events/resume against a FRESH, never-before-seen
#      batchId (management_events has no FK to batches — see
#      management-events.service.ts's comment — so this needs no prior
#      seed/registration step at all), plus one real POST
#      /management-events/resume against a DIFFERENT fresh batchId that
#      was never blocked, to capture the real 400 validation response.
#
# NOT a source of the final verdict: docker compose ps output and the 3
# real calls are diagnostic evidence attached to the log. Only `npm run
# test:e2e`'s own exit code decides PASS/FAILED (see "Conclusion" below) —
# this script deliberately does NOT `set -e`, so a hiccup in stage 1 or 3
# doesn't abort stage 2, and a stage-3 problem doesn't get silently
# reported as if it were a test failure or vice versa.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$ROOT_DIR/step9-verification-${TIMESTAMP}.log"

# Real values, read from actual repo files, not guessed:
#   - route/body shape: backend/src/modules/management-events/
#     management-events.controller.ts (POST /management-events/block|
#     resume|ack-exception|note, body { batchId, actor, note? }).
BACKEND_PORT="${PORT:-3001}"
BACKEND_URL="http://localhost:${BACKEND_PORT}"
VERIFY_BATCH_ID="verify-step9-$(date +%s)"
VERIFY_BATCH_ID_UNBLOCKED="verify-step9-unblocked-$(date +%s)"

# From here on, everything written to stdout/stderr is BOTH shown live and
# appended to $LOG_FILE verbatim (no summarizing).
exec > >(tee -a "$LOG_FILE") 2>&1

echo "==================================================================="
echo "Step 9 verification run — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Log file: $LOG_FILE"
echo "==================================================================="

# --- Preflight: force-rebuild + wait for backend to actually be ready ----
echo
echo "--- [preflight] docker compose up -d --build (backend, postgres, fixture-api, production-db, supplier-portal) ---"
(cd "$ROOT_DIR" && docker compose up -d --build backend postgres fixture-api production-db supplier-portal)

echo
echo "Waiting for backend to answer GET ${BACKEND_URL}/health ..."
BACKEND_READY=0
for i in $(seq 1 60); do
  HEALTH_CODE="$(curl -sS -o /dev/null -w '%{http_code}' "${BACKEND_URL}/health" 2>/dev/null || true)"
  if [ "$HEALTH_CODE" = "200" ]; then
    BACKEND_READY=1
    echo "backend answered 200 on /health after ${i}s"
    break
  fi
  sleep 1
done
if [ "$BACKEND_READY" -ne 1 ]; then
  echo "!!! backend did not answer 200 on ${BACKEND_URL}/health within 60s — continuing to the 3 stages below anyway; whatever they report is the real, honest result of that (not swallowed here)."
fi

# --- 1. docker compose ps -------------------------------------------------
echo
echo "--- [1/3] docker compose ps (backend, postgres, fixture-api, production-db, supplier-portal) ---"
(cd "$ROOT_DIR" && docker compose ps)

# --- 2. npm run test:e2e ---------------------------------------------------
echo
echo "--- [2/3] npm run test:e2e (backend/) -------------------------------"
(cd "$BACKEND_DIR" && npm run test:e2e)
TEST_E2E_EXIT_CODE=$?
echo
echo "npm run test:e2e exit code: ${TEST_E2E_EXIT_CODE}"

# --- 3. Real block -> resume calls + real 400 on an unblocked batch --------
echo
echo "--- [3/3] Real POST /management-events/block -> resume, and a real 400 on an unblocked batch ---"

BLOCK_RESPONSE=$(curl -sS -X POST "${BACKEND_URL}/management-events/block" \
  -H 'Content-Type: application/json' \
  -d "{\"batchId\":\"${VERIFY_BATCH_ID}\",\"actor\":\"verify-step9-script\",\"note\":\"real verification call\"}")
echo "POST /management-events/block response: ${BLOCK_RESPONSE}"

RESUME_RESPONSE=$(curl -sS -X POST "${BACKEND_URL}/management-events/resume" \
  -H 'Content-Type: application/json' \
  -d "{\"batchId\":\"${VERIFY_BATCH_ID}\",\"actor\":\"verify-step9-script\"}")
echo "POST /management-events/resume response (should be 201, batch was just blocked above): ${RESUME_RESPONSE}"

REJECTED_RESUME_HTTP_CODE=$(curl -sS -o /tmp/verify-step9-rejected-resume.json -w '%{http_code}' -X POST "${BACKEND_URL}/management-events/resume" \
  -H 'Content-Type: application/json' \
  -d "{\"batchId\":\"${VERIFY_BATCH_ID_UNBLOCKED}\",\"actor\":\"verify-step9-script\"}")
echo "POST /management-events/resume on a NEVER-blocked batch -> HTTP ${REJECTED_RESUME_HTTP_CODE} (expected 400), body: $(cat /tmp/verify-step9-rejected-resume.json 2>/dev/null || true)"

# --- Conclusion --------------------------------------------------------------
echo
echo "==================================================================="
if [ "$TEST_E2E_EXIT_CODE" -eq 0 ]; then
  echo "CONCLUSION: PASS (npm run test:e2e exit code 0)"
else
  echo "CONCLUSION: FAILED (npm run test:e2e exit code ${TEST_E2E_EXIT_CODE})"
fi
echo "==================================================================="

exit "$TEST_E2E_EXIT_CODE"
