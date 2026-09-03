#!/usr/bin/env bash
# Single-command Step 8 Docker verification — run ONLY on a machine with
# Docker actually working (this repo was largely written on one that
# didn't; see README.md's "Việc cần làm ở máy có Docker"). Written on that
# machine (no Docker) — never run there. Only `bash -n` syntax-checked
# offline; the real run (docker compose up, npm run test:e2e against real
# Postgres, real HTTP calls) has NOT happened yet. See README.md's Step 8
# entry for the exact offline verification that WAS done instead.
#
# Mirrors scripts/verify-step6.sh's structure and reasoning exactly — see
# that file's header for the full rationale behind each design choice
# reused here unchanged (preflight force-rebuild + health-poll to avoid the
# "stale image" 404 trap from Step 6; not using `set -e`; writing a real
# untruncated log file; extracting ids from real JSON responses with `node
# -e` instead of adding a `jq` dependency).
#
# Usage: npm run verify:step8   (from backend/, or `bash scripts/verify-step8.sh`
#         from anywhere — paths below are resolved relative to this file,
#         not the caller's cwd)
#
# Does 3 things, all real, all logged verbatim to
# step8-verification-<timestamp>.log at the repo root (not summarized):
#   1. `docker compose ps` — health of all 5 services (backend, postgres,
#      fixture-api, production-db, supplier-portal).
#   2. `npm run test:e2e` (backend/) — full output, real exit code decides
#      the final PASS/FAILED line. This is the suite that actually proves
#      Step 8 (crawler-collector.e2e-spec.ts's malformed-row/pagination-
#      loop/RECEIVING-scenario cases), same as every prior step's script.
#   3. One real crawl call: POST /collection-runs against a REAL source
#      (created via the real POST /sources) whose config points at the
#      REAL Docker supplier-portal container with fault: "malformed", with
#      `docker compose logs -f backend --since 1s` tailing in the
#      background during the call to capture
#      CollectionRunsService.runCrawlerCollection's real
#      "skipped malformed row" warning log line.
#
# NOT a source of the final verdict: docker compose ps output and the
# crawl call are diagnostic evidence attached to the log. Only `npm run
# test:e2e`'s own exit code decides PASS/FAILED (see "Conclusion" below) —
# this script deliberately does NOT `set -e`, so a hiccup in stage 1 or 3
# doesn't abort stage 2, and a stage-3 problem doesn't get silently
# reported as if it were a test failure or vice versa.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$ROOT_DIR/step8-verification-${TIMESTAMP}.log"

# Real values, all read from actual repo files, not guessed:
#   - route/body shape: backend/src/modules/collection-runs/collection-runs.controller.ts
#     (POST /collection-runs, body { sourceId }) and
#     backend/src/modules/sources/sources.controller.ts (POST /sources).
#   - Source.config shape: backend/src/modules/collection-runs/types.ts's
#     CrawlerSourceConfig ({ baseUrl, fault? }) — no secret/env-var field
#     (see that file's comment: the supplier portal is unauthenticated).
#   - supplier-portal's INTERNAL docker-network base URL:
#     docker-compose.yml's "supplier-portal:" service (hostname
#     "supplier-portal", internal container port 4200 — NOT the 4300
#     host-side remap, because CollectionRunsService calls it from INSIDE
#     the backend container, over the docker network).
#   - Docker Compose service name for the backend container's own logs:
#     docker-compose.yml's top-level "backend:" key (not container_name).
BACKEND_PORT="${PORT:-3001}"
BACKEND_URL="http://localhost:${BACKEND_PORT}"
SUPPLIER_PORTAL_INTERNAL_BASE_URL="http://supplier-portal:4200"
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
echo "Step 8 verification run — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
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

# --- 3. Real crawl call (malformed-row fault) + backend log tail -----------
echo
echo "--- [3/3] Real crawl call (POST /collection-runs, CRAWLER source, fault=malformed) + backend log tail ---"

SOURCE_RESPONSE=$(curl -sS -X POST "${BACKEND_URL}/sources" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Supplier Portal (verify-step8)\",\"type\":\"CRAWLER\",\"config\":{\"baseUrl\":\"${SUPPLIER_PORTAL_INTERNAL_BASE_URL}\",\"fault\":\"malformed\"}}")
echo "POST /sources response: ${SOURCE_RESPONSE}"

SOURCE_ID="$(printf '%s' "$SOURCE_RESPONSE" | extract_json_id || true)"

if [ -z "$SOURCE_ID" ]; then
  echo "!!! Could not extract a sourceId from the POST /sources response above — skipping the crawl call. This does NOT affect the PASS/FAILED conclusion below (only npm run test:e2e's exit code does)."
else
  echo "Created source id: ${SOURCE_ID}"

  # Tail the REAL backend container's logs in the background, starting
  # just before the call, so we capture
  # CollectionRunsService.runCrawlerCollection's real "skipped malformed
  # row" warning log line as it's written.
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

  # Give the tail a moment to flush any trailing lines, then stop it.
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
