// Pure functions, no side effects, no DB access — Rule 6-7 (Domain Rules
// v2.2, docs/plan-v4.md). All inputs are already filtered to a single
// batchId by the caller. Wiring real DB reads is Step 5.

import { CanonicalEventResult, Station } from '../canonicalization/types';
import { STATION_ORDER, stationIndex } from './station-order';
import { ManagementEventInput } from './types';

/**
 * Rule 6 — current station: the furthest station (by STATION_ORDER) that
 * has a canonical event ACCEPTED or CONFLICT. A CONFLICT still counts —
 * the batch "reached" that station even though the value is disputed. Late
 * events at earlier stations never pull this back (there's nothing here
 * that looks at eventTime/receivedAt at all — only station order).
 */
export function getCurrentStation(
  events: CanonicalEventResult[],
): Station | null {
  let current: Station | null = null;
  let currentIdx = -1;
  for (const event of events) {
    if (event.status !== 'ACCEPTED' && event.status !== 'CONFLICT') continue;
    const idx = stationIndex(event.station);
    if (idx > currentIdx) {
      currentIdx = idx;
      current = event.station;
    }
  }
  return current;
}

/**
 * Stations strictly before currentStation (by order) that have no
 * canonical event at all yet. `null` currentStation -> nothing has been
 * reached -> no "missing" stations to report (that's just PLANNED).
 */
export function getMissingStations(
  events: CanonicalEventResult[],
  currentStation: Station | null,
): Station[] {
  if (currentStation === null) return [];
  const presentStations = new Set(events.map((e) => e.station));
  const currentIdx = stationIndex(currentStation);
  return STATION_ORDER.filter(
    (station, idx) => idx < currentIdx && !presentStations.has(station),
  );
}

/**
 * Block-without-resume: true when the most recent BLOCK has no RESUME
 * strictly after it. Comparing the two global maxima is sufficient — if any
 * RESUME occurred after the latest BLOCK, it is necessarily also the latest
 * RESUME overall.
 */
export function resolveIsBlocked(
  managementEvents: ManagementEventInput[],
): boolean {
  let lastBlockAt: number | null = null;
  let lastResumeAt: number | null = null;
  for (const event of managementEvents) {
    const at = event.timestamp.getTime();
    if (
      event.action === 'BLOCK' &&
      (lastBlockAt === null || at > lastBlockAt)
    ) {
      lastBlockAt = at;
    } else if (
      event.action === 'RESUME' &&
      (lastResumeAt === null || at > lastResumeAt)
    ) {
      lastResumeAt = at;
    }
  }
  if (lastBlockAt === null) return false;
  return lastResumeAt === null || lastResumeAt <= lastBlockAt;
}

/**
 * Rule 7 — batch state, evaluated in this exact priority order: COMPLETED,
 * then BLOCKED, then IN_PROGRESS, then PLANNED. A CONFLICT at DISPATCH does
 * NOT count as COMPLETED (only ACCEPTED does) — it falls through to the
 * BLOCKED/IN_PROGRESS checks like any other non-accepted station.
 *
 * IN_PROGRESS only looks at RECEIVING..FOLDING (excludes DISPATCH, which is
 * already fully handled by the COMPLETED check above) — per this module's
 * spec. A batch whose ONLY canonical event is a DISPATCH CONFLICT (no
 * earlier station ever recorded) would therefore read PLANNED here, an
 * edge case that doesn't occur in the 8-batch fixture (every DISPATCH
 * batch has upstream station events) and isn't covered by a required test.
 */
export function resolveBatchState(
  events: CanonicalEventResult[],
  managementEvents: ManagementEventInput[],
): 'PLANNED' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED' {
  const dispatchEvent = events.find((e) => e.station === 'DISPATCH');
  if (dispatchEvent && dispatchEvent.status === 'ACCEPTED') {
    return 'COMPLETED';
  }

  if (resolveIsBlocked(managementEvents)) {
    return 'BLOCKED';
  }

  const hasProgress = events.some(
    (e) =>
      e.station !== 'DISPATCH' &&
      (e.status === 'ACCEPTED' || e.status === 'CONFLICT'),
  );
  if (hasProgress) {
    return 'IN_PROGRESS';
  }

  return 'PLANNED';
}

/**
 * Rule 3 — completedQuantity is the ACCEPTED canonical event's quantity at
 * currentStation; `null` when there's no current station or that event is
 * still CONFLICT (a disputed value has no settled quantity).
 */
export function getCompletedQuantity(
  events: CanonicalEventResult[],
  currentStation: Station | null,
): number | null {
  if (currentStation === null) return null;
  const event = events.find((e) => e.station === currentStation);
  if (!event || event.status !== 'ACCEPTED') return null;
  return event.quantity;
}
