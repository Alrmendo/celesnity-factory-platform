import { CanonicalEventResult, Station } from '../canonicalization/types';
import { calculateFreshness } from './freshness';

const now = new Date('2026-01-01T00:00:00.000Z');
const minutesAgo = (n: number) => new Date(now.getTime() - n * 60_000);

const BATCH_ID = 'BXXX';
const THRESHOLD = 15;

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

describe('production-domain freshness (Rule 6 supporting concept)', () => {
  it('no ACCEPTED events at all -> NO_DATA', () => {
    const result = calculateFreshness([], now, THRESHOLD);

    expect(result).toEqual({ status: 'NO_DATA', minutes: null });
  });

  it('most recent ACCEPTED event 5 minutes old, threshold 15 -> OK', () => {
    const events = [event('WASHING', 'ACCEPTED', 100, minutesAgo(5))];

    const result = calculateFreshness(events, now, THRESHOLD);

    expect(result).toEqual({ status: 'OK', minutes: 5 });
  });

  it('most recent ACCEPTED event 20 minutes old, threshold 15 -> STALE', () => {
    const events = [event('WASHING', 'ACCEPTED', 100, minutesAgo(20))];

    const result = calculateFreshness(events, now, THRESHOLD);

    expect(result).toEqual({ status: 'STALE', minutes: 20 });
  });

  it('a lone CONFLICT event does not count as "most recent ACCEPTED" -> NO_DATA, not time-based OK/STALE', () => {
    // Freshness is based on eventTime of the most recent ACCEPTED event
    // only — a disputed (CONFLICT) reading is excluded even though it has
    // a perfectly recent eventTime of its own.
    const events = [event('DISPATCH', 'CONFLICT', 480, minutesAgo(5))];

    const result = calculateFreshness(events, now, THRESHOLD);

    expect(result).toEqual({ status: 'NO_DATA', minutes: null });
  });
});
