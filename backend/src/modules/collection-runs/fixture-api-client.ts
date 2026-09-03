// Thin HTTP client for the Step 6 fixture-api ("Application API" mock).
// Deliberately isolated from CollectionRunsService: this file only knows
// how to make ONE request and classify its outcome; retry/backoff policy
// lives entirely in the service.
//
// Uses Node's ambient global `fetch` (no import — see README.md's Step 6
// log for the full story, condensed here). This file briefly imported
// `fetch` from the standalone `undici` npm package instead, to work around
// a "fetch is not defined" failure seen on the Docker machine. That was
// reverted:
//  - The real Docker build log confirms `backend/Dockerfile` runs on
//    `node:22-alpine`. Node's fetch has been stable (no flag, no warning)
//    since Node 21 — Node 22 always has it. There's no version gap here to
//    work around.
//  - The ORIGINAL "fetch is not defined" report and the separately-found
//    "Cannot POST /sources" 404 (see collection-runs.controller.ts / the
//    Step 6 log) turned out to share one root cause: the running `backend`
//    container was serving an image built BEFORE this Step 6 code existed.
//    `scripts/verify-step6.sh` now force-rebuilds before verifying, which
//    addresses this directly — no fetch workaround needed.
//  - Explicitly importing `undici` made things WORSE: it crashed 2 of the
//    3 e2e suites at module-load time (`TypeError: webidl.util.
//    markAsUncloneable is not a function`, thrown from undici's own
//    `CacheStorage` setup code, executed as a side effect of merely
//    importing the package) — specifically `app.e2e-spec.ts` and
//    `collection-runs.e2e-spec.ts`, both of which import `AppModule` (or
//    `CollectionRunsService` directly), pulling this file in transitively;
//    `batch-lifecycle.e2e-spec.ts` imports neither and was unaffected —
//    exactly the "2/3" failure pattern reported. The SAME code, in the
//    SAME Docker container's real `node dist/main.js` process, ran the
//    `fetch()` call successfully — so this was specific to loading the
//    `undici` package inside Jest's `node` test environment (a separate vm
//    realm from the main process), not a problem with fetch itself.
import { Station } from '../canonicalization/types';

export interface FixtureEvent {
  sourceRecordId: string;
  batchId: string;
  station: Station;
  quantity: number;
  eventTime: string;
}

// `retryable: false` short-circuits CollectionRunsService's retry loop —
// e.g. a bad API key won't self-heal by retrying.
export class FixtureApiError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'FixtureApiError';
  }
}

export async function fetchFixtureEvents(
  baseUrl: string,
  apiKey: string,
  attempt: number,
  fault: string | undefined,
  timeoutMs: number,
): Promise<FixtureEvent[]> {
  const url = new URL('/events', baseUrl);
  if (fault) {
    url.searchParams.set('fault', fault);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        // Never log this header — see CollectionRunsService.
        'x-api-key': apiKey,
        'x-attempt': String(attempt),
      },
      signal: controller.signal,
    });

    if (response.status === 401) {
      throw new FixtureApiError(
        'fixture API rejected credentials (401)',
        false,
      );
    }
    if (response.status >= 500) {
      throw new FixtureApiError(
        `fixture API returned ${response.status}`,
        true,
      );
    }
    if (!response.ok) {
      throw new FixtureApiError(
        `fixture API returned unexpected status ${response.status}`,
        false,
      );
    }

    const body: unknown = await response.json();
    if (!Array.isArray(body)) {
      throw new FixtureApiError('fixture API returned a non-array body', false);
    }
    return body as FixtureEvent[];
  } catch (err) {
    if (err instanceof FixtureApiError) {
      throw err;
    }
    if (err instanceof Error && err.name === 'AbortError') {
      throw new FixtureApiError('fixture API request timed out', true);
    }
    throw new FixtureApiError(
      `fixture API request failed: ${err instanceof Error ? err.message : String(err)}`,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}
