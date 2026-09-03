// Thin HTTP client for the Step 6 fixture-api ("Application API" mock).
// Deliberately isolated from CollectionRunsService: this file only knows
// how to make ONE request and classify its outcome; retry/backoff policy
// lives entirely in the service.
//
// Uses `fetch` explicitly imported from `undici`, NOT the ambient global
// `fetch` (Node 18+ exposes one, and — this is exactly what made the bug
// pass review — it typechecks fine, since @types/node declares the global
// unconditionally regardless of whether the runtime value is actually
// bound in a given realm). See README.md's Step 6 log for what's actually
// verified about the "fetch is not defined" failure vs. what isn't: it did
// NOT reproduce locally under this repo's exact `npm run test:e2e` config
// (Node 24.16.0, Jest 29.7.0 — `fetch` was defined there), so the specific
// Node/Jest version combination that hit it on the Docker machine is
// unconfirmed. What's true regardless of that mechanism: Node's global
// `fetch` is still documented as experimental and is a per-realm global,
// not a language guarantee — relying on it being bound in whatever
// process/environment ends up running this (a real container, a `vm`
// sandbox, a differently-versioned host) is inherently fragile in a way an
// explicit import isn't. `undici` is Node's own reference fetch
// implementation as an installable package — same API, but a real
// imported function rather than a global lookup, so it can't be missing
// regardless of realm or Node/Jest version.
import { fetch } from 'undici';
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
