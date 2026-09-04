#!/usr/bin/env bash
# Final pre-submission check — run ONLY on a machine with Docker actually
# working (this repo was largely written on one that didn't; see
# README.md's "Việc cần làm ở máy có Docker"). Written on that machine (no
# Docker) — never run there, only `bash -n` syntax-checked offline. The
# real run has NOT happened yet.
#
# Mirrors scripts/verify-step6.sh/verify-step8.sh's structure and
# reasoning exactly (see those files' headers for the full rationale
# behind each design choice reused here unchanged): not using `set -e`,
# writing a real untruncated log file, extracting JSON fields with `node
# -e` instead of adding a `jq` dependency, preflight rebuild + health-poll
# to avoid the "stale image" 404 trap from Step 6.
#
# DESTRUCTIVE ON PURPOSE (Step 12 "chuẩn bị rà soát cuối cùng" prompt,
# Việc 3, mục 1): stage 0 below runs `docker compose down -v`, which wipes
# EVERY Docker volume this compose project owns — Postgres AND
# production-db's data are gone after this script runs, unconditionally,
# no confirmation prompt. This is intentional: it is the only way to
# actually simulate a grader's fresh `git clone` + `docker compose up`,
# not a machine with weeks of accumulated dev-DB state (stray rows,
# manually-created Sources, etc. — see README's Step 11 "bổ sung" entry
# for a real example of exactly that kind of accumulated state causing a
# confusing bug). Do not run this against a machine whose current DB
# state you still need.
#
# Usage: bash scripts/final-check.sh   (from anywhere — paths below are
#   resolved relative to this file's location, not the caller's cwd)
#
# Does 12 things, all real, all logged verbatim to
# final-check-<timestamp>.log at the repo root (not summarized):
#   0. `docker compose down -v` + `docker compose up -d --build` (backend,
#      postgres, fixture-api, production-db, supplier-portal) + wait for
#      backend's real GET /health to answer 200.
#   1. `cd backend && npm run seed` — real, against the now-empty DB. This
#      alone creates B001-B008/B005A/B005B/B006 for real via
#      CanonicalizationService.ingestAndRecompute (see README's Step 5) —
#      B006 is a real CONFLICT the moment seed finishes, no collector run
#      needed to produce it.
#   2. GET /sources — assert a Source named "Supplier Portal" exists with
#      config.baseUrl exactly "http://supplier-portal:4200" (the Step 11
#      "bổ sung" seed fix — internal Docker network address, never an
#      ephemeral 127.0.0.1 port).
#   3. POST /sources/:id/verify then POST /collection-runs on that same
#      Supplier Portal source — assert the run's status is "SUCCESS".
#   4. POST /sources with a DATABASE-type config that has NO
#      selectedTable, then POST /collection-runs immediately — assert a
#      real, specific 400 message (Step 11 "bổ sung" fix: no longer a
#      generic "Internal server error").
#   5. GET /production-lines — assert B006 has a non-empty
#      qualityIndicators with acknowledged: false (fresh from seed, never
#      acknowledged).
#   6. POST /management-events/ack-exception for B006 — assert HTTP 201.
#   7. GET /production-lines again — assert B006's qualityIndicators is
#      now acknowledged: true.
#   8. GET /canonical-events?batchId=B006 — assert at least one event's
#      status is STILL "CONFLICT" (Rule 5b: acknowledging never changes
#      canonical status, only the derived acknowledged flag).
#   9. GET /production-lines — assert B004's missingStations is non-empty
#      (backend/test/fixtures/batch-scenarios.ts's own comment: "B004
#      (Rule 6): WASHING reached first, RECEIVING arrives late ->
#      currentStation stays WASHING" — the repo's one deliberate
#      late-event/missing-upstream-data illustration; confirmed against
#      batch-lifecycle.e2e-spec.ts's known scenarioExpectations
#      (missingStations: ['SORTING']), not guessed).
#   10. On B002 (a batch untouched by steps 5-9, to avoid entangling
#       assertions): POST /management-events/block, then /resume, then
#       /note — assert HTTP 201 for each.
#   11. Conclusion — every check above increments $FAILED_CHECKS on
#       failure; the final line is PASS only if $FAILED_CHECKS is 0.
#
# NOT a source of truth for the PASS/FAIL verdict on its own: this script
# deliberately does NOT `set -e`, so one failed stage doesn't abort the
# rest — every remaining check still runs and gets logged, and the
# CONCLUSION at the end is the honest sum of every individual check.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$ROOT_DIR/final-check-${TIMESTAMP}.log"

# Real values, all read from actual repo files, not guessed — see each
# stage's comment below for exactly which file confirmed which value.
BACKEND_PORT="${PORT:-3001}"
BACKEND_URL="http://localhost:${BACKEND_PORT}"
SUPPLIER_PORTAL_INTERNAL_BASE_URL="http://supplier-portal:4200"

# From here on, everything written to stdout/stderr is BOTH shown live and
# appended to $LOG_FILE verbatim (no summarizing).
exec > >(tee -a "$LOG_FILE") 2>&1

TOTAL_CHECKS=0
FAILED_CHECKS=0

# Usage: check "description" "true"|"false"
check() {
  local description="$1" ok="$2"
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
  if [ "$ok" = "true" ]; then
    echo "  [PASS] ${description}"
  else
    echo "  [FAIL] ${description}"
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
  fi
}

# HTTP call helper — sets CALL_BODY and CALL_STATUS as globals (avoids the
# fragility of parsing a mixed body+status-code single stdout stream).
# Usage: call METHOD URL [JSON_DATA]
call() {
  local method="$1" url="$2" data="${3:-}"
  local tmp
  tmp="$(mktemp)"
  if [ -n "$data" ]; then
    CALL_STATUS="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" "$url" \
      -H 'Content-Type: application/json' -d "$data")"
  else
    CALL_STATUS="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" "$url")"
  fi
  CALL_BODY="$(cat "$tmp")"
  rm -f "$tmp"
}

# Reads JSON from stdin, prints the value at a dot-separated path (numeric
# segments index into arrays), or nothing + exit 1 if the path doesn't
# resolve or the input isn't valid JSON. Same "no jq dependency" reasoning
# as verify-step8.sh's extract_json_id.
json_get() {
  node -e '
    let data = "";
    process.stdin.on("data", (c) => { data += c; });
    process.stdin.on("end", () => {
      try {
        let cur = JSON.parse(data);
        for (const key of process.argv[1].split(".")) {
          if (cur === undefined || cur === null) break;
          cur = cur[key];
        }
        if (cur === undefined || cur === null) process.exit(1);
        process.stdout.write(typeof cur === "string" ? cur : JSON.stringify(cur));
      } catch {
        process.exit(1);
      }
    });
  ' "$1"
}

# Finds a source by name in a GET /sources array response (stdin), prints
# it as one JSON line, or exits 1 if not found.
find_source_by_name() {
  node -e '
    let data = "";
    process.stdin.on("data", (c) => { data += c; });
    process.stdin.on("end", () => {
      try {
        const sources = JSON.parse(data);
        const found = sources.find((s) => s.name === process.argv[1]);
        if (!found) process.exit(1);
        process.stdout.write(JSON.stringify(found));
      } catch {
        process.exit(1);
      }
    });
  ' "$1"
}

# Finds a batch by batchId inside a GET /production-lines array response
# (stdin, one entry per line), searching every line's batches[]. Prints it
# as one JSON line, or exits 1 if not found.
find_batch() {
  node -e '
    let data = "";
    process.stdin.on("data", (c) => { data += c; });
    process.stdin.on("end", () => {
      try {
        const lines = JSON.parse(data);
        for (const line of lines) {
          const found = (line.batches || []).find((b) => b.batchId === process.argv[1]);
          if (found) { process.stdout.write(JSON.stringify(found)); return; }
        }
        process.exit(1);
      } catch {
        process.exit(1);
      }
    });
  ' "$1"
}

echo "==================================================================="
echo "Final check run — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Log file: $LOG_FILE"
echo "==================================================================="

# --- 0. Fresh state: down -v, then up --build, then wait for /health -----
echo
echo "--- [0/11] docker compose down -v (WIPES all volumes — Postgres + production-db data gone) ---"
(cd "$ROOT_DIR" && docker compose down -v)

echo
echo "--- [0/11] docker compose up -d --build (backend, postgres, fixture-api, production-db, supplier-portal) ---"
(cd "$ROOT_DIR" && docker compose up -d --build backend postgres fixture-api production-db supplier-portal)

echo
echo "Waiting for backend to answer GET ${BACKEND_URL}/health ..."
BACKEND_READY=0
for i in $(seq 1 90); do
  HEALTH_CODE="$(curl -sS -o /dev/null -w '%{http_code}' "${BACKEND_URL}/health" 2>/dev/null || true)"
  if [ "$HEALTH_CODE" = "200" ]; then
    BACKEND_READY=1
    echo "backend answered 200 on /health after ${i}s"
    break
  fi
  sleep 1
done
check "backend answered GET /health with 200 within 90s" "$([ "$BACKEND_READY" -eq 1 ] && echo true || echo false)"

# --- 1. npm run seed -------------------------------------------------------
echo
echo "--- [1/11] cd backend && npm run seed (fresh DB from stage 0 — B001-B008/B005A/B005B/B006 created for real) ---"
(cd "$BACKEND_DIR" && npm run seed)
SEED_EXIT_CODE=$?
echo "npm run seed exit code: ${SEED_EXIT_CODE}"
check "npm run seed exited 0" "$([ "$SEED_EXIT_CODE" -eq 0 ] && echo true || echo false)"

# --- 2. GET /sources: real "Supplier Portal" with the fixed baseUrl ------
echo
echo "--- [2/11] GET /sources — Supplier Portal has the fixed Docker-network baseUrl ---"
call GET "${BACKEND_URL}/sources"
echo "GET /sources response: ${CALL_BODY}"
check "GET /sources returned 200" "$([ "$CALL_STATUS" = "200" ] && echo true || echo false)"

SUPPLIER_SOURCE_JSON="$(printf '%s' "$CALL_BODY" | find_source_by_name "Supplier Portal" || true)"
check "a Source named \"Supplier Portal\" exists" "$([ -n "$SUPPLIER_SOURCE_JSON" ] && echo true || echo false)"

SUPPLIER_SOURCE_ID=""
SUPPLIER_BASE_URL=""
if [ -n "$SUPPLIER_SOURCE_JSON" ]; then
  SUPPLIER_SOURCE_ID="$(printf '%s' "$SUPPLIER_SOURCE_JSON" | json_get "id" || true)"
  SUPPLIER_BASE_URL="$(printf '%s' "$SUPPLIER_SOURCE_JSON" | json_get "config.baseUrl" || true)"
fi
echo "Supplier Portal id=${SUPPLIER_SOURCE_ID} config.baseUrl=${SUPPLIER_BASE_URL}"
check "Supplier Portal config.baseUrl is exactly \"${SUPPLIER_PORTAL_INTERNAL_BASE_URL}\" (not 127.0.0.1/ephemeral)" \
  "$([ "$SUPPLIER_BASE_URL" = "$SUPPLIER_PORTAL_INTERNAL_BASE_URL" ] && echo true || echo false)"

# --- 3. Verify + real Run collection on that Supplier Portal source ------
echo
echo "--- [3/11] POST /sources/:id/verify + POST /collection-runs on Supplier Portal (real crawl) ---"
if [ -n "$SUPPLIER_SOURCE_ID" ]; then
  call POST "${BACKEND_URL}/sources/${SUPPLIER_SOURCE_ID}/verify"
  echo "POST /sources/${SUPPLIER_SOURCE_ID}/verify response (${CALL_STATUS}): ${CALL_BODY}"
  check "verify Supplier Portal returned 201" "$([ "$CALL_STATUS" = "201" ] && echo true || echo false)"

  call POST "${BACKEND_URL}/collection-runs" "{\"sourceId\":\"${SUPPLIER_SOURCE_ID}\"}"
  echo "POST /collection-runs response (${CALL_STATUS}): ${CALL_BODY}"
  RUN_STATUS="$(printf '%s' "$CALL_BODY" | json_get "status" || true)"
  check "real crawl collection run status is SUCCESS" "$([ "$RUN_STATUS" = "SUCCESS" ] && echo true || echo false)"
else
  echo "!!! No Supplier Portal source id — skipping verify/run (already counted as FAIL above)."
fi

# --- 4. A DATABASE source with no selectedTable -> real 400 message ------
echo
echo "--- [4/11] POST /sources (DATABASE, no selectedTable) + POST /collection-runs -> real 400 message ---"
# host/port/database/user are placeholders — this call never actually
# connects (SourcesService/CollectionRunsService check for a missing
# selectedTable BEFORE calling collectFromTable), only passwordEnvVar
# needs to resolve to something real so execution reaches that check —
# PRODUCTION_DB_PASSWORD is set on the real backend container
# (docker-compose.yml), matching Step 7's secret-handling design.
call POST "${BACKEND_URL}/sources" '{"name":"final-check DATABASE (no select)","type":"DATABASE","config":{"host":"production-db","port":5432,"database":"production","user":"prod_reader","passwordEnvVar":"PRODUCTION_DB_PASSWORD"}}'
echo "POST /sources (DATABASE) response (${CALL_STATUS}): ${CALL_BODY}"
NO_SELECT_SOURCE_ID="$(printf '%s' "$CALL_BODY" | json_get "id" || true)"
check "created the no-selectedTable DATABASE source" "$([ -n "$NO_SELECT_SOURCE_ID" ] && echo true || echo false)"

if [ -n "$NO_SELECT_SOURCE_ID" ]; then
  call POST "${BACKEND_URL}/collection-runs" "{\"sourceId\":\"${NO_SELECT_SOURCE_ID}\"}"
  echo "POST /collection-runs (no selectedTable) response (${CALL_STATUS}): ${CALL_BODY}"
  NO_SELECT_MESSAGE="$(printf '%s' "$CALL_BODY" | json_get "message" || true)"
  check "response is HTTP 400 (not a swallowed 500)" "$([ "$CALL_STATUS" = "400" ] && echo true || echo false)"
  check "message is NOT the generic \"Internal server error\"" \
    "$([ "$NO_SELECT_MESSAGE" != "Internal server error" ] && [ -n "$NO_SELECT_MESSAGE" ] && echo true || echo false)"
  check "message mentions the real reason (selectedTable)" \
    "$(printf '%s' "$NO_SELECT_MESSAGE" | grep -qi "selectedTable" && echo true || echo false)"
else
  echo "!!! No source id from stage 4's POST /sources — skipping the collection-run call (already counted as FAIL above)."
fi

# --- 5. GET /production-lines: B006 has an unacknowledged exception ------
echo
echo "--- [5/11] GET /production-lines — B006 has a real, unacknowledged CONFLICT quality indicator ---"
call GET "${BACKEND_URL}/production-lines"
echo "GET /production-lines response: ${CALL_BODY}"
check "GET /production-lines returned 200" "$([ "$CALL_STATUS" = "200" ] && echo true || echo false)"

B006_JSON="$(printf '%s' "$CALL_BODY" | find_batch "B006" || true)"
check "batch B006 found in GET /production-lines" "$([ -n "$B006_JSON" ] && echo true || echo false)"

if [ -n "$B006_JSON" ]; then
  B006_INDICATOR_COUNT="$(printf '%s' "$B006_JSON" | json_get "qualityIndicators.length" || echo 0)"
  B006_ACKNOWLEDGED_BEFORE="$(printf '%s' "$B006_JSON" | json_get "qualityIndicators.0.acknowledged" || true)"
  echo "B006 qualityIndicators.length=${B006_INDICATOR_COUNT} qualityIndicators[0].acknowledged=${B006_ACKNOWLEDGED_BEFORE}"
  check "B006 has a non-empty qualityIndicators" "$([ "${B006_INDICATOR_COUNT:-0}" -gt 0 ] 2>/dev/null && echo true || echo false)"
  check "B006's quality indicator is NOT acknowledged yet (fresh from seed)" \
    "$([ "$B006_ACKNOWLEDGED_BEFORE" = "false" ] && echo true || echo false)"
fi

# --- 6. Acknowledge B006's exception --------------------------------------
echo
echo "--- [6/11] POST /management-events/ack-exception for B006 ---"
call POST "${BACKEND_URL}/management-events/ack-exception" '{"batchId":"B006","actor":"final-check-script"}'
echo "POST /management-events/ack-exception response (${CALL_STATUS}): ${CALL_BODY}"
check "ack-exception for B006 returned 201" "$([ "$CALL_STATUS" = "201" ] && echo true || echo false)"

# --- 7. GET /production-lines again: B006 now acknowledged ---------------
echo
echo "--- [7/11] GET /production-lines — B006's quality indicator is now acknowledged ---"
call GET "${BACKEND_URL}/production-lines"
B006_JSON_AFTER="$(printf '%s' "$CALL_BODY" | find_batch "B006" || true)"
B006_ACKNOWLEDGED_AFTER=""
if [ -n "$B006_JSON_AFTER" ]; then
  B006_ACKNOWLEDGED_AFTER="$(printf '%s' "$B006_JSON_AFTER" | json_get "qualityIndicators.0.acknowledged" || true)"
fi
echo "B006 qualityIndicators[0].acknowledged (after ack)=${B006_ACKNOWLEDGED_AFTER}"
check "B006's quality indicator is acknowledged: true after ack-exception" \
  "$([ "$B006_ACKNOWLEDGED_AFTER" = "true" ] && echo true || echo false)"

# --- 8. GET /canonical-events?batchId=B006 — status STILL CONFLICT -------
echo
echo "--- [8/11] GET /canonical-events?batchId=B006 — canonical status unchanged by ack (Rule 5b) ---"
call GET "${BACKEND_URL}/canonical-events?batchId=B006"
echo "GET /canonical-events?batchId=B006 response: ${CALL_BODY}"
check "GET /canonical-events?batchId=B006 returned 200" "$([ "$CALL_STATUS" = "200" ] && echo true || echo false)"
STILL_CONFLICT="$(printf '%s' "$CALL_BODY" | node -e '
  let data = "";
  process.stdin.on("data", (c) => { data += c; });
  process.stdin.on("end", () => {
    try {
      const events = JSON.parse(data);
      process.stdout.write(events.some((e) => e.status === "CONFLICT") ? "true" : "false");
    } catch {
      process.stdout.write("false");
    }
  });
')"
check "at least one B006 canonical_event is still status CONFLICT (ack does not resolve it)" "$STILL_CONFLICT"

# --- 9. GET /production-lines — B004 illustrates missing upstream data ---
echo
echo "--- [9/11] GET /production-lines — B004 (late RECEIVING) has a real missingStations entry ---"
call GET "${BACKEND_URL}/production-lines"
B004_JSON="$(printf '%s' "$CALL_BODY" | find_batch "B004" || true)"
check "batch B004 found in GET /production-lines" "$([ -n "$B004_JSON" ] && echo true || echo false)"
if [ -n "$B004_JSON" ]; then
  B004_MISSING="$(printf '%s' "$B004_JSON" | json_get "missingStations" || echo '[]')"
  echo "B004 missingStations=${B004_MISSING}"
  check "B004's missingStations is non-empty (expected: [\"SORTING\"])" \
    "$([ "$B004_MISSING" != "[]" ] && [ -n "$B004_MISSING" ] && echo true || echo false)"
fi

# --- 10. Block -> Resume -> Add note on B002 (untouched by steps above) --
echo
echo "--- [10/11] Block -> Resume -> Add note on B002 ---"
call POST "${BACKEND_URL}/management-events/block" '{"batchId":"B002","actor":"final-check-script"}'
echo "POST /management-events/block (B002) response (${CALL_STATUS}): ${CALL_BODY}"
check "block B002 returned 201" "$([ "$CALL_STATUS" = "201" ] && echo true || echo false)"

call POST "${BACKEND_URL}/management-events/resume" '{"batchId":"B002","actor":"final-check-script"}'
echo "POST /management-events/resume (B002) response (${CALL_STATUS}): ${CALL_BODY}"
check "resume B002 returned 201" "$([ "$CALL_STATUS" = "201" ] && echo true || echo false)"

call POST "${BACKEND_URL}/management-events/note" '{"batchId":"B002","actor":"final-check-script","note":"final-check smoke note"}'
echo "POST /management-events/note (B002) response (${CALL_STATUS}): ${CALL_BODY}"
check "add note on B002 returned 201" "$([ "$CALL_STATUS" = "201" ] && echo true || echo false)"

# --- 11. Conclusion --------------------------------------------------------
echo
echo "==================================================================="
echo "TOTAL_CHECKS=${TOTAL_CHECKS} FAILED_CHECKS=${FAILED_CHECKS}"
if [ "$FAILED_CHECKS" -eq 0 ]; then
  echo "CONCLUSION: PASS (0/${TOTAL_CHECKS} checks failed)"
  CONCLUSION_EXIT_CODE=0
else
  echo "CONCLUSION: FAILED (${FAILED_CHECKS}/${TOTAL_CHECKS} checks failed — see [FAIL] lines above)"
  CONCLUSION_EXIT_CODE=1
fi
echo "==================================================================="

exit "$CONCLUSION_EXIT_CODE"
