// Thin HTTP client for the Step 6 fixture-api ("Application API" mock).
// Deliberately isolated from CollectionRunsService: this file only knows
// how to make ONE request and classify its outcome; retry/backoff policy
// lives entirely in the service.

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
