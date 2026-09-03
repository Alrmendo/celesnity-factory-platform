'use strict';

// Mock "Application API" fixture service — Step 6. Plain Node http, zero
// dependencies on purpose: this is a throwaway stand-in for a real external
// API, not production code, so it stays trivially Dockerizable (no
// npm install layer) and directly `require`-able from backend e2e tests to
// run in-process without Docker (see backend/test/collection-runs.e2e-spec.ts).
//
// Auth: requires header `x-api-key` to match `apiKey` (constructor option,
// falls back to env FIXTURE_API_KEY, falls back to a dev default). This
// exists so backend/src/modules/collection-runs can exercise real
// secret-handling (the real key lives only in env, never in the DB —
// see CollectionRunsService) end-to-end against something that actually
// rejects a missing/wrong key.
//
// Fault injection (docs/plan-v4.md §6): `fault` query param, or env
// FIXTURE_FAULT_MODE as the default when the query param is absent.
//   - "none" (default): always 200 with the fixture events below.
//   - "500-once": 500 on the first attempt (`x-attempt` header <= 1, set by
//     the collector on each retry), 200 from the 2nd attempt on.
//   - "500-always": always 500.
//   - "timeout": holds the response open past any sane client timeout, to
//     exercise the collector's own request-timeout/abort handling.

const http = require('http');
const { URL } = require('url');

// Mirrors docs/plan-v4.md's fixture scenario table under this
// implementation's Rule 4 scope decision: Application API only supplies
// DISPATCH (Tier 1) events. RECEIVING..FOLDING stay a single-source
// (Production Database) canonical path, so those scenarios (B001-B005B,
// B007) have no Application-API-sourced data here.
//
// B006's quantity (480) deliberately disagrees with the Production DB's
// value (500, inserted separately — see batch-scenarios.ts) to exercise the
// DISPATCH conflict scenario end-to-end. eventTime must stay in sync with
// `minutes(5)` in backend/test/fixtures/batch-scenarios.ts (T0 + 5 minutes,
// T0 = 2026-01-01T00:00:00.000Z) for the "same moment, same tier" scenario
// in Rule 4/5.4 to hold.
const EVENTS = [
  {
    sourceRecordId: 'B006-DISPATCH-API',
    batchId: 'B006',
    station: 'DISPATCH',
    quantity: 480,
    eventTime: '2026-01-01T00:05:00.000Z',
  },
  {
    sourceRecordId: 'B008-DISPATCH-API',
    batchId: 'B008',
    station: 'DISPATCH',
    quantity: 97,
    eventTime: '2026-01-01T00:05:00.000Z',
  },
];

const DEFAULT_PORT = 4000;
const DEFAULT_API_KEY = 'fixture-secret-key';
const DEFAULT_TIMEOUT_DELAY_MS = 30000;

function createServer(options = {}) {
  const apiKey = options.apiKey ?? process.env.FIXTURE_API_KEY ?? DEFAULT_API_KEY;
  const defaultFault =
    options.faultMode ?? process.env.FIXTURE_FAULT_MODE ?? 'none';
  const timeoutDelayMs =
    options.timeoutDelayMs ??
    Number(process.env.FIXTURE_TIMEOUT_DELAY_MS) ??
    DEFAULT_TIMEOUT_DELAY_MS;

  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (url.pathname !== '/events') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    // Never log the presented key, valid or not — only whether it matched.
    const providedKey = req.headers['x-api-key'];
    if (providedKey !== apiKey) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    const fault = url.searchParams.get('fault') || defaultFault;
    const attempt = Number(req.headers['x-attempt']) || 1;

    if (fault === '500-always' || (fault === '500-once' && attempt <= 1)) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'injected fault: 500' }));
      return;
    }

    if (fault === 'timeout') {
      // Deliberately don't respond within any realistic client timeout.
      // `.unref()` so a lingering fixture-api process doesn't block Node
      // from exiting once every other handle is done.
      setTimeout(() => {
        if (!res.writableEnded) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(EVENTS));
        }
      }, timeoutDelayMs).unref();
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(EVENTS));
  });
}

function start() {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const server = createServer();
  server.listen(port, () => {
    console.log(`fixture-api listening on port ${port}`);
  });
  return server;
}

if (require.main === module) {
  start();
}

module.exports = { createServer, start, EVENTS };
