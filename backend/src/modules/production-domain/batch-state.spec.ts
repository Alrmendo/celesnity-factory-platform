import { CanonicalEventResult, Station } from '../canonicalization/types';
import {
  getCompletedQuantity,
  getCurrentStation,
  getMissingStations,
  resolveBatchState,
} from './batch-state';
import { ManagementEventInput } from './types';

const t0 = new Date('2026-01-01T00:00:00.000Z');
const minutes = (n: number) => new Date(t0.getTime() + n * 60_000);

const BATCH_ID = 'BXXX';

function event(
  station: Station,
  status: 'ACCEPTED' | 'CONFLICT',
  quantity: number,
  eventTime: Date,
): CanonicalEventResult {
  return {
    batchId: BATCH_ID,
    station,
    canonicalKey: `${BATCH_ID}:${station}`,
    quantity,
    eventTime,
    status,
  };
}

function managementEvent(
  action: ManagementEventInput['action'],
  timestamp: Date,
): ManagementEventInput {
  return { batchId: BATCH_ID, action, actor: 'ops-1', timestamp };
}

describe('production-domain batch-state — Domain Rules v2.2 (Rule 6-7)', () => {
  it('B001: no canonical events at all -> PLANNED', () => {
    // Rule 7 — PLANNED: no event, no block.
    expect(resolveBatchState([], [])).toBe('PLANNED');
    expect(getCurrentStation([])).toBeNull();
  });

  it('B002: single ACCEPTED at RECEIVING -> IN_PROGRESS, currentStation=RECEIVING, no missing stations', () => {
    // Rule 6 (current station) + Rule 7 (IN_PROGRESS).
    const events = [event('RECEIVING', 'ACCEPTED', 100, minutes(0))];

    const currentStation = getCurrentStation(events);

    expect(currentStation).toBe('RECEIVING');
    expect(getMissingStations(events, currentStation)).toEqual([]);
    expect(resolveBatchState(events, [])).toBe('IN_PROGRESS');
  });

  it('B003: ACCEPTED at RECEIVING + WASHING, SORTING never seen -> currentStation=WASHING, missing=[SORTING]', () => {
    // Rule 6 — furthest station reached, with a genuine gap in between.
    const events = [
      event('RECEIVING', 'ACCEPTED', 100, minutes(0)),
      event('WASHING', 'ACCEPTED', 95, minutes(10)),
    ];

    const currentStation = getCurrentStation(events);

    expect(currentStation).toBe('WASHING');
    expect(getMissingStations(events, currentStation)).toEqual(['SORTING']);
    expect(resolveBatchState(events, [])).toBe('IN_PROGRESS');
  });

  it('B004: late RECEIVING event arriving after WASHING was already accepted -> currentStation stays WASHING, RECEIVING no longer missing', () => {
    // Rule 6 — a late event never pulls currentStation backwards. Station
    // order alone decides current station, not eventTime/receivedAt.
    const events = [
      event('WASHING', 'ACCEPTED', 95, minutes(0)), // reached WASHING first
      event('RECEIVING', 'ACCEPTED', 100, minutes(10)), // late-arriving RECEIVING record
    ];

    const currentStation = getCurrentStation(events);

    expect(currentStation).toBe('WASHING');
    const missing = getMissingStations(events, currentStation);
    expect(missing).not.toContain('RECEIVING');
    expect(missing).toEqual(['SORTING']); // still genuinely never observed
  });

  it('B006: DISPATCH CONFLICT (not ACCEPTED) -> NOT COMPLETED, stays IN_PROGRESS, completedQuantity=null', () => {
    // Rule 7 — only an ACCEPTED DISPATCH event completes a batch; a
    // CONFLICT one still counts toward "reached DISPATCH" (Rule 6) but
    // never toward COMPLETED. Rule 3 — completedQuantity is null while the
    // reading at currentStation is disputed.
    const events = [
      event('RECEIVING', 'ACCEPTED', 100, minutes(0)),
      event('SORTING', 'ACCEPTED', 100, minutes(1)),
      event('WASHING', 'ACCEPTED', 98, minutes(2)),
      event('DRYING', 'ACCEPTED', 98, minutes(3)),
      event('FOLDING', 'ACCEPTED', 97, minutes(4)),
      event('DISPATCH', 'CONFLICT', 480, minutes(5)),
    ];

    const currentStation = getCurrentStation(events);

    expect(currentStation).toBe('DISPATCH');
    expect(resolveBatchState(events, [])).toBe('IN_PROGRESS');
    expect(getCompletedQuantity(events, currentStation)).toBeNull();
  });

  it('B007: BLOCK with no later RESUME -> BLOCKED, even though currentStation is still resolvable', () => {
    // Rule 7 — BLOCKED outranks IN_PROGRESS in priority.
    const events = [
      event('RECEIVING', 'ACCEPTED', 100, minutes(0)),
      event('SORTING', 'ACCEPTED', 100, minutes(1)),
    ];
    const managementEvents = [managementEvent('BLOCK', minutes(30))];

    expect(getCurrentStation(events)).toBe('SORTING');
    expect(resolveBatchState(events, managementEvents)).toBe('BLOCKED');
  });

  it('B007-resume: BLOCK followed by a later RESUME -> no longer BLOCKED, falls back to IN_PROGRESS', () => {
    const events = [
      event('RECEIVING', 'ACCEPTED', 100, minutes(0)),
      event('SORTING', 'ACCEPTED', 100, minutes(1)),
    ];
    const managementEvents = [
      managementEvent('BLOCK', minutes(30)),
      managementEvent('RESUME', minutes(45)),
    ];

    expect(resolveBatchState(events, managementEvents)).toBe('IN_PROGRESS');
  });

  it('B008: DISPATCH ACCEPTED -> COMPLETED', () => {
    const events = [
      event('RECEIVING', 'ACCEPTED', 100, minutes(0)),
      event('SORTING', 'ACCEPTED', 100, minutes(1)),
      event('WASHING', 'ACCEPTED', 100, minutes(2)),
      event('DRYING', 'ACCEPTED', 100, minutes(3)),
      event('FOLDING', 'ACCEPTED', 100, minutes(4)),
      event('DISPATCH', 'ACCEPTED', 100, minutes(5)),
    ];

    expect(resolveBatchState(events, [])).toBe('COMPLETED');
  });
});
