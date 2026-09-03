'use strict';

// Mock "Supplier Portal" fixture service — Step 8. Plain Node http, zero
// dependencies, same rationale as fixture-api/server.js (Step 6): trivially
// Dockerizable (no npm install layer) and directly `require`-able from
// backend e2e tests to run in-process without Docker.
//
// Unlike fixture-api (a clean JSON REST API), this deliberately serves real
// HTML — the assessment's own wording is "a locally hosted, paginated
// supplier page" (a page, not an API), specifically so the Step 8 collector
// has to parse HTML that can be malformed, and so pagination-loop
// protection is testable against a page that actually links back to itself.
// A clean JSON API can't exercise either risk honestly.
//
// No auth/secret here on purpose: the assessment describes this as a public
// supplier page, not a credentialed API — unlike Step 6 (Application API,
// x-api-key) and Step 7 (Production Database, password), Step 8's Source
// config carries no secret at all (see collection-runs/types.ts's
// CrawlerSourceConfig), and there is no secret-regression test for Step 8.
//
// Required fields per row (assessment PDF, not in docs/plan-v4.md): Delivery
// number, Supplier, Batch ID, Quantity, Delivery time, a stable
// source-record identifier. The stable identifier is the `<tr
// data-source-record-id="...">` attribute (conceptually separate from the
// business "delivery number" cell, per the PDF listing them as two distinct
// fields); the other four are `<td class="...">` cells inside the row.
//
// Fault injection (mirrors fixture-api's `fault` query param / env default
// pattern): `fault` query param on `/deliveries`, or env
// SUPPLIER_PORTAL_FAULT_MODE as the default when absent.
//   - "none" (default): 2 real pages, all rows well-formed.
//   - "malformed": 1 page with a well-formed row, a row with an invalid
//     `quantity` cell ("N/A" — not a parseable number), and another
//     well-formed row — proves malformed rows are skipped individually,
//     not the whole page/run.
//   - "loop": page 1's "next" link points to page 2, and page 2's "next"
//     link points BACK to page 1 (a real pagination loop) — proves the
//     crawler detects and stops instead of crawling forever.
// Every page in a given fault mode carries `&fault=<mode>` in its own
// "next" href, so the crawler naturally stays in that fixture's page set
// across the whole crawl without needing to re-specify `fault` itself past
// the first request.

const http = require('http');
const { URL } = require('url');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function row({ sourceRecordId, deliveryNumber, supplier, batchId, quantity, deliveryTime }) {
  return `    <tr data-source-record-id="${escapeHtml(sourceRecordId)}">
      <td class="delivery-number">${escapeHtml(deliveryNumber)}</td>
      <td class="supplier">${escapeHtml(supplier)}</td>
      <td class="batch-id">${escapeHtml(batchId)}</td>
      <td class="quantity">${escapeHtml(quantity)}</td>
      <td class="delivery-time">${escapeHtml(deliveryTime)}</td>
    </tr>`;
}

function page({ rows, nextHref, totalPages }) {
  return `<!doctype html>
<html>
<body>
  <table id="deliveries">
${rows.join('\n')}
  </table>
  <div id="pagination" data-total-pages="${totalPages}">
    ${nextHref ? `<a rel="next" href="${escapeHtml(nextHref)}">Next</a>` : ''}
  </div>
</body>
</html>`;
}

// --- "none" (clean): 2 pages, 3 well-formed rows total, all batchId B002 —
// the RECEIVING scenario already defined in
// backend/test/fixtures/batch-scenarios.ts ("single ACCEPTED at RECEIVING
// -> IN_PROGRESS"), reused rather than inventing a new batch id. ----------
const CLEAN_PAGES = {
  1: page({
    rows: [
      row({
        sourceRecordId: 'CRAWL-B002-001',
        deliveryNumber: 'DN-1001',
        supplier: 'Acme Textiles',
        batchId: 'B002',
        quantity: 100,
        deliveryTime: '2026-01-01T00:00:00.000Z',
      }),
      row({
        sourceRecordId: 'CRAWL-B002-002',
        deliveryNumber: 'DN-1002',
        supplier: 'Acme Textiles',
        batchId: 'B002',
        quantity: 100,
        deliveryTime: '2026-01-01T00:01:00.000Z',
      }),
    ],
    nextHref: '/deliveries?page=2&fault=none',
    totalPages: 2,
  }),
  2: page({
    rows: [
      row({
        sourceRecordId: 'CRAWL-B002-003',
        deliveryNumber: 'DN-1003',
        supplier: 'Acme Textiles',
        batchId: 'B002',
        quantity: 100,
        deliveryTime: '2026-01-01T00:02:00.000Z',
      }),
    ],
    nextHref: null,
    totalPages: 2,
  }),
};

// --- "malformed": 1 page, 3 rows — row 2 has an invalid quantity cell
// ("N/A", not a parseable number). Rows 1 and 3 are well-formed. ----------
const MALFORMED_PAGES = {
  1: page({
    rows: [
      row({
        sourceRecordId: 'CRAWL-B002-101',
        deliveryNumber: 'DN-2001',
        supplier: 'Acme Textiles',
        batchId: 'B002',
        quantity: 100,
        deliveryTime: '2026-01-01T00:00:00.000Z',
      }),
      row({
        sourceRecordId: 'CRAWL-B002-102',
        deliveryNumber: 'DN-2002',
        supplier: 'Acme Textiles',
        batchId: 'B002',
        quantity: 'N/A',
        deliveryTime: '2026-01-01T00:01:00.000Z',
      }),
      row({
        sourceRecordId: 'CRAWL-B002-103',
        deliveryNumber: 'DN-2003',
        supplier: 'Acme Textiles',
        batchId: 'B002',
        quantity: 100,
        deliveryTime: '2026-01-01T00:02:00.000Z',
      }),
    ],
    nextHref: null,
    totalPages: 1,
  }),
};

// --- "loop": page 1 -> page 2 -> page 1 (real pagination loop). ----------
const LOOP_PAGES = {
  1: page({
    rows: [
      row({
        sourceRecordId: 'CRAWL-B002-201',
        deliveryNumber: 'DN-3001',
        supplier: 'Acme Textiles',
        batchId: 'B002',
        quantity: 100,
        deliveryTime: '2026-01-01T00:00:00.000Z',
      }),
    ],
    nextHref: '/deliveries?page=2&fault=loop',
    totalPages: 2,
  }),
  2: page({
    rows: [
      row({
        sourceRecordId: 'CRAWL-B002-202',
        deliveryNumber: 'DN-3002',
        supplier: 'Acme Textiles',
        batchId: 'B002',
        quantity: 100,
        deliveryTime: '2026-01-01T00:01:00.000Z',
      }),
    ],
    // Loops back to page 1 instead of terminating or advancing.
    nextHref: '/deliveries?page=1&fault=loop',
    totalPages: 2,
  }),
};

const FAULT_PAGES = {
  none: CLEAN_PAGES,
  malformed: MALFORMED_PAGES,
  loop: LOOP_PAGES,
};

const DEFAULT_PORT = 4200;

function createServer(options = {}) {
  const defaultFault =
    options.faultMode ?? process.env.SUPPLIER_PORTAL_FAULT_MODE ?? 'none';

  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (url.pathname !== '/deliveries') {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<!doctype html><html><body>not found</body></html>');
      return;
    }

    const fault = url.searchParams.get('fault') || defaultFault;
    const pageNum = Number(url.searchParams.get('page')) || 1;
    const pages = FAULT_PAGES[fault] ?? CLEAN_PAGES;
    const html =
      pages[pageNum] ??
      page({ rows: [], nextHref: null, totalPages: Object.keys(pages).length });

    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
  });
}

function start() {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const server = createServer();
  server.listen(port, () => {
    console.log(`supplier-portal listening on port ${port}`);
  });
  return server;
}

if (require.main === module) {
  start();
}

module.exports = { createServer, start };
