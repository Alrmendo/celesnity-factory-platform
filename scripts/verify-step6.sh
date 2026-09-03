#!/usr/bin/env bash
# Single-command Step 6 Docker verification — run ONLY on a machine with
# Docker actually working (this repo was largely written on one that
# didn't; see README.md's "Việc cần làm ở máy có Docker"). Requires
# `docker compose up -d --build` already running for postgres/backend/
# fixture-api before this script is invoked — it verifies, it doesn't
# start the stack (starting it can take a while and belongs under the
# user's own control, not silently inside a "verify" script).
#
# Usage: npm run verify:step6   (from backend/, or `bash scripts/verify-step6.sh`
#         from anywhere — paths below are resolved relative to this file,
#         not the caller's cwd)
#
# Does 3 things, all real, all logged verbatim to
# step6-verification-<timestamp>.log at the repo root (not summarized):
#   1. `docker compose ps` — health of all 3 Step 6 services.
#   2. `npm run test:e2e` (backend/) — full output, real exit code decides
#      the final PASS/FAILED line.
#   3. One real fault-injection call: POST /collection-runs against a
#      REAL source (created via the real POST /sources) whose config has
#      fault: "500-once" (docs/plan-v4.md §6), with `docker compose logs -f
#      backend --since 1s` tailing in the background during the call to
#      capture CollectionRunsService's real retry-warning log line.
#
# NOT a source of the final verdict: docker compose ps output and the
# fault-injection call are diagnostic evidence attached to the log. Only
# `npm run test:e2e`'s own exit code decides PASS/FAILED (see "Conclusion"
# below) — this script deliberately does NOT `set -e`, so a hiccup in
# stage 1 or 3 doesn't abort stage 2, and a stage-3 problem doesn't get
# silently reported as if it were a test failure or vice versa.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$ROOT_DIR/step6-verification-${TIMESTAMP}.log"

# Real values, all read from actual repo files, not guessed:
#   - route/body shape: backend/src/modules/collection-runs/collection-runs.controller.ts
#     (POST /collection-runs, body { sourceId }) and
#     backend/src/modules/sources/sources.controller.ts (POST /sources).
#   - Source.config shape: backend/src/modules/collection-runs/types.ts's
#     FixtureApiSourceConfig ({ baseUrl, apiKeyEnvVar, fault? }).
#   - fixture-api's INTERNAL docker-network base URL and the env var name
#     holding its API key: docker-compose.yml's "backend" service
#     (FIXTURE_API_BASE_URL / FIXTURE_API_KEY) — internal hostname:port,
#     because CollectionRunsService calls fixture-api from INSIDE the
#     backend container, over the docker network, not from this script's
#     host shell.
#   - Docker Compose service name for the backend container's own logs:
#     docker-compose.yml's top-level "backend:" key (not container_name).
#
# No seeded/fixture source in the repo already has this config shape —
# backend/test/fixtures/batch-scenarios.ts's "Application API" source has
# config: {} (it's only ever used for direct-insert canonicalization
# tests, never for a real HTTP collection run) — so there is no existing
# sourceId to read off disk here. This script creates a real Source via
# the real POST /sources endpoint at run time and uses ITS real returned
# id, rather than hardcoding a placeholder UUID (which would also go stale
# immediately, since seeded ids are `@default(uuid())` and differ every
# time prisma/seed.ts runs anyway).
BACKEND_PORT="${PORT:-3001}"
BACKEND_URL="http://localhost:${BACKEND_PORT}"
FIXTURE_API_INTERNAL_BASE_URL="http://fixture-api:4000"
FIXTURE_API_KEY_ENV_VAR="FIXTURE_API_KEY"
BACKEND_COMPOSE_SERVICE="backend"

extract_json_id() {
  # Reads a JSON object from stdin, prints its "id" field, or nothing (and
  # a non-zero exit) if that fails — used instead of `jq` since this repo
  # already requires Node, so this has no new external dependency.
  node -e '
    let data = "";
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => {
      try {
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed.id === "string") {
          process.stdout.write(parsed.id);
        } else {
          process.exit(1);
        }
      } catch {
        process.exit(1);
      }
    });
  '
}

# From here on, everything written to stdout/stderr is BOTH shown live and
# appended to $LOG_FILE verbatim (no summarizing) — background children
# (the log-tail in stage 3) inherit these redirected fds too.
exec > >(tee -a "$LOG_FILE") 2>&1

echo "==================================================================="
echo "Step 6 verification run — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Log file: $LOG_FILE"
echo "==================================================================="

# --- 1. docker compose ps -------------------------------------------------
echo
echo "--- [1/3] docker compose ps (backend, postgres, fixture-api) -------"
(cd "$ROOT_DIR" && docker compose ps)

# --- 2. npm run test:e2e ---------------------------------------------------
echo
echo "--- [2/3] npm run test:e2e (backend/) -------------------------------"
(cd "$BACKEND_DIR" && npm run test:e2e)
TEST_E2E_EXIT_CODE=$?
echo
echo "npm run test:e2e exit code: ${TEST_E2E_EXIT_CODE}"

# --- 3. Real fault-injection call + backend log tail ------------------------
echo
echo "--- [3/3] Real fault-injection call (POST /collection-runs, fault=500-once) + backend log tail ---"

SOURCE_RESPONSE=$(curl -sS -X POST "${BACKEND_URL}/sources" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Application API (verify-step6)\",\"type\":\"API\",\"config\":{\"baseUrl\":\"${FIXTURE_API_INTERNAL_BASE_URL}\",\"apiKeyEnvVar\":\"${FIXTURE_API_KEY_ENV_VAR}\",\"fault\":\"500-once\"}}")
echo "POST /sources response: ${SOURCE_RESPONSE}"

SOURCE_ID="$(printf '%s' "$SOURCE_RESPONSE" | extract_json_id || true)"

if [ -z "$SOURCE_ID" ]; then
  echo "!!! Could not extract a sourceId from the POST /sources response above — skipping the fault-injection call. This does NOT affect the PASS/FAILED conclusion below (only npm run test:e2e's exit code does)."
else
  echo "Created source id: ${SOURCE_ID}"

  # Tail the REAL backend container's logs in the background, starting
  # just before the call, so we capture CollectionRunsService's real
  # retry-warning log line as it's written.
  (cd "$ROOT_DIR" && docker compose logs -f "$BACKEND_COMPOSE_SERVICE" --since 1s) &
  LOGS_PID=$!
  sleep 1

  RUN_RESPONSE=$(curl -sS -X POST "${BACKEND_URL}/collection-runs" \
    -H 'Content-Type: application/json' \
    -d "{\"sourceId\":\"${SOURCE_ID}\"}")
  echo "POST /collection-runs response: ${RUN_RESPONSE}"

  RUN_ID="$(printf '%s' "$RUN_RESPONSE" | extract_json_id || true)"
  if [ -n "$RUN_ID" ]; then
    sleep 1
    RUN_STATUS_RESPONSE=$(curl -sS "${BACKEND_URL}/collection-runs/${RUN_ID}")
    echo "GET /collection-runs/${RUN_ID} response: ${RUN_STATUS_RESPONSE}"
  else
    echo "!!! Could not extract a run id from the POST /collection-runs response above — skipping the follow-up GET."
  fi

  # Give the tail a moment to flush any trailing lines (500-once's own
  # retry backoff is ~50ms, this is just to catch Nest's log write/flush),
  # then stop it.
  sleep 2
  kill "$LOGS_PID" 2>/dev/null || true
  wait "$LOGS_PID" 2>/dev/null || true
fi

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
