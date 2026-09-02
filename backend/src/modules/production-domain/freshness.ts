// Pure function, no side effects — Rule 6 supporting concept (freshness),
// docs/plan-v4.md. `now` is always passed in, never read via `new Date()`
// internally, so this stays deterministic under test.

import { CanonicalEventResult } from '../canonicalization/types';
import { FreshnessStatus } from './types';

export interface FreshnessResult {
  status: FreshnessStatus;
  minutes: number | null;
}

/**
 * Freshness is based on the eventTime of the most recent ACCEPTED canonical
 * event — NOT currentStation, and NOT received_at (received_at is
 * ingestion/platform time, not "how current is the production data").
 * CONFLICT events are excluded: a disputed reading isn't confirmed data, so
 * it can't establish freshness. No ACCEPTED event at all -> NO_DATA.
 */
export function calculateFreshness(
  events: CanonicalEventResult[],
  now: Date,
  staleThresholdMinutes: number,
): FreshnessResult {
  const acceptedEvents = events.filter((e) => e.status === 'ACCEPTED');
  if (acceptedEvents.length === 0) {
    return { status: 'NO_DATA', minutes: null };
  }

  const latestEventTime = acceptedEvents.reduce(
    (latest, e) =>
      e.eventTime.getTime() > latest ? e.eventTime.getTime() : latest,
    acceptedEvents[0].eventTime.getTime(),
  );

  const minutes = Math.round((now.getTime() - latestEventTime) / 60_000);
  const status: FreshnessStatus =
    minutes > staleThresholdMinutes ? 'STALE' : 'OK';
  return { status, minutes };
}
