// Thin client for the Step 8 "Supplier Crawler" collector — mirrors
// fixture-api-client.ts (Step 6) and database-source-client.ts (Step 7)'s
// role: this file only knows how to talk to the supplier portal (fetch a
// page, parse it, follow "next"); collection-run bookkeeping (creating the
// row, deciding SUCCESS/FAILED) lives in CollectionRunsService.
//
// Deliberately NOT a full HTML parser/DOM library: the assessment describes
// "a locally hosted, paginated supplier page" that THIS repo also builds
// (supplier-portal/server.js) — both ends of the wire are under our
// control and the page format is intentionally simple/regular (one <tr
// data-source-record-id="..."> per delivery, fixed <td class="..."> cells
// inside), so a couple of regexes are sufficient and honest here. Per the
// Step 8 task instructions: if a real HTML-parsing dependency (e.g.
// cheerio) ever looks necessary, stop and confirm before adding it — not
// needed for this fixture's shape.
//
// Uses Node's ambient global `fetch`, same as fixture-api-client.ts (see
// that file's header for why: Node 22's fetch is stable, no import needed).

const ROW_REGEX = /<tr data-source-record-id="([^"]*)">([\s\S]*?)<\/tr>/g;
const NEXT_HREF_REGEX = /<a[^>]*rel="next"[^>]*href="([^"]*)"/;
const TOTAL_PAGES_REGEX = /data-total-pages="(-?\d+)"/;

function unescapeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function extractCell(rowHtml: string, cssClass: string): string | undefined {
  const match = new RegExp(`<td class="${cssClass}">([\\s\\S]*?)<\\/td>`).exec(
    rowHtml,
  );
  return match ? unescapeHtml(match[1]).trim() : undefined;
}

export interface CrawledDeliveryRow {
  sourceRecordId: string;
  deliveryNumber: string;
  supplier: string;
  batchId: string;
  quantity: number;
  deliveryTime: Date;
}

export interface MalformedRow {
  page: number;
  reason: string;
}

export interface CrawlResult {
  rows: CrawledDeliveryRow[];
  malformedRows: MalformedRow[];
  pagesCrawled: number;
}

export class SupplierCrawlerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupplierCrawlerError';
  }
}

async function fetchPage(pageUrl: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(pageUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new SupplierCrawlerError(
        `supplier portal returned ${response.status} for ${pageUrl}`,
      );
    }
    return await response.text();
  } catch (err) {
    if (err instanceof SupplierCrawlerError) {
      throw err;
    }
    if (err instanceof Error && err.name === 'AbortError') {
      throw new SupplierCrawlerError(
        `supplier portal request timed out: ${pageUrl}`,
      );
    }
    throw new SupplierCrawlerError(
      `supplier portal request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

function firstPageUrl(baseUrl: string, fault: string | undefined): string {
  const url = new URL('/deliveries', baseUrl);
  if (fault) {
    url.searchParams.set('fault', fault);
  }
  return url.toString();
}

function resolveNextUrl(html: string, currentUrl: string): string | undefined {
  const match = NEXT_HREF_REGEX.exec(html);
  if (!match) {
    return undefined;
  }
  // The href attribute is HTML-escaped in the page (server.js's
  // escapeHtml turns "&" into "&amp;" for a multi-param href like
  // "?page=2&fault=loop"). Caught via a manual smoke test against the real
  // fixture before this was wired into CollectionRunsService: without
  // unescaping first, URL/URLSearchParams sees a literal "&amp;" — which
  // still contains a real "&" partway through — and mis-splits the query
  // string, silently dropping/corrupting the "fault" param on every
  // followed link.
  return new URL(unescapeHtml(match[1]), currentUrl).toString();
}

function parseRows(
  html: string,
  pageNumber: number,
): { rows: CrawledDeliveryRow[]; malformedRows: MalformedRow[] } {
  const rows: CrawledDeliveryRow[] = [];
  const malformedRows: MalformedRow[] = [];

  for (const rowMatch of html.matchAll(ROW_REGEX)) {
    const sourceRecordId = unescapeHtml(rowMatch[1]).trim();
    const rowHtml = rowMatch[2];

    const deliveryNumber = extractCell(rowHtml, 'delivery-number');
    const supplier = extractCell(rowHtml, 'supplier');
    const batchId = extractCell(rowHtml, 'batch-id');
    const quantityRaw = extractCell(rowHtml, 'quantity');
    const deliveryTimeRaw = extractCell(rowHtml, 'delivery-time');

    const quantity = quantityRaw !== undefined ? Number(quantityRaw) : NaN;
    const deliveryTime =
      deliveryTimeRaw !== undefined ? new Date(deliveryTimeRaw) : undefined;

    const problems: string[] = [];
    if (!sourceRecordId) problems.push('missing source-record identifier');
    if (!deliveryNumber) problems.push('missing delivery number');
    if (!supplier) problems.push('missing supplier');
    if (!batchId) problems.push('missing batch id');
    if (quantityRaw === undefined) problems.push('missing quantity');
    else if (!Number.isFinite(quantity) || quantity < 0)
      problems.push(`invalid quantity "${quantityRaw}"`);
    if (deliveryTimeRaw === undefined) problems.push('missing delivery time');
    else if (!deliveryTime || Number.isNaN(deliveryTime.getTime()))
      problems.push(`invalid delivery time "${deliveryTimeRaw}"`);

    if (problems.length > 0) {
      malformedRows.push({
        page: pageNumber,
        reason: `row ${sourceRecordId || '(no id)'}: ${problems.join(', ')}`,
      });
      continue;
    }

    rows.push({
      sourceRecordId,
      // Non-null assertions below are safe: the problems[] check above
      // already confirmed each of these is present/valid for any row that
      // reaches here — TS just can't carry that narrowing through the
      // problems.length check (same limitation noted in
      // database-source-client.ts's isStationValue usage).
      deliveryNumber: deliveryNumber!,
      supplier: supplier!,
      batchId: batchId!,
      quantity,
      deliveryTime: deliveryTime!,
    });
  }

  return { rows, malformedRows };
}

/** Step 8 "Register and verify the supplier portal is reachable" — a real GET. */
export async function checkReachable(
  baseUrl: string,
  timeoutMs: number,
): Promise<void> {
  await fetchPage(firstPageUrl(baseUrl, undefined), timeoutMs);
}

/**
 * Step 8 discover — simpler than Step 7's (no tables/columns to introspect,
 * the portal exposes exactly one deliveries feed): confirms the feed is
 * reachable and reports how many pages it currently has, per the task
 * instructions ("xác nhận endpoint reachable + tổng số trang phát hiện
 * được").
 */
export async function discoverFeed(
  baseUrl: string,
  timeoutMs: number,
): Promise<{ reachable: true; totalPages: number }> {
  const html = await fetchPage(firstPageUrl(baseUrl, undefined), timeoutMs);
  const match = TOTAL_PAGES_REGEX.exec(html);
  return { reachable: true, totalPages: match ? Number(match[1]) : 1 };
}

/**
 * Crawls every page of the deliveries feed starting at page 1, following
 * each page's `rel="next"` link.
 *
 * Pagination-loop protection (task requirement) is two-layered:
 *  1. Primary: a `Set` of every page URL already fetched. If the next URL
 *     to fetch is already in that set (a real loop, e.g. page 2 linking
 *     back to page 1), abort immediately rather than fetching it again.
 *  2. Backstop: a hard `maxPages` cap, in case a pathological feed keeps
 *     producing genuinely NEW "next" URLs forever (no repeat to catch, but
 *     still never terminates) — defense in depth, same spirit as
 *     database-source-client.ts's SAFE_IDENTIFIER check.
 * Either case throws SupplierCrawlerError; CollectionRunsService maps that
 * to a FAILED run (see its comment for why: unlike a malformed row, a loop
 * means we can no longer trust that what's been read so far is the real,
 * complete feed, so nothing gathered from it is ingested).
 *
 * Malformed rows (task requirement) never throw — parseRows() collects
 * them separately and the crawl continues; the caller decides what to do
 * with malformedRows (CollectionRunsService reports them via
 * collection_runs.errorCount/errorMessage without failing the run).
 */
export async function crawlDeliveries(
  baseUrl: string,
  fault: string | undefined,
  maxPages: number,
  timeoutMs: number,
): Promise<CrawlResult> {
  const visited = new Set<string>();
  const rows: CrawledDeliveryRow[] = [];
  const malformedRows: MalformedRow[] = [];

  let nextUrl: string | undefined = firstPageUrl(baseUrl, fault);
  let pagesCrawled = 0;

  while (nextUrl) {
    if (visited.has(nextUrl)) {
      throw new SupplierCrawlerError(
        `pagination loop detected: "${nextUrl}" was already crawled in this run`,
      );
    }
    if (pagesCrawled >= maxPages) {
      throw new SupplierCrawlerError(
        `pagination loop guard: exceeded max page count (${maxPages}) without the feed reporting an end`,
      );
    }

    visited.add(nextUrl);
    const html = await fetchPage(nextUrl, timeoutMs);
    pagesCrawled += 1;

    const parsed = parseRows(html, pagesCrawled);
    rows.push(...parsed.rows);
    malformedRows.push(...parsed.malformedRows);

    nextUrl = resolveNextUrl(html, nextUrl);
  }

  return { rows, malformedRows, pagesCrawled };
}
