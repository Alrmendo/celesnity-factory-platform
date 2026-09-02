import { CanonicalEventResult } from './types';

export interface QualityIndicator {
  canonicalKey: string;
  code: string;
  acknowledged: false;
}

/**
 * Rule 5b — data-generation half only. Every CONFLICT canonical event gets
 * one unacknowledged quality indicator. Setting `acknowledged: false ->
 * true` (ACK_EXCEPTION) is a ManagementEventsModule/ProductionDomainService
 * concern and does NOT happen here — see plan-v4.md Rule 5b: ACK_EXCEPTION
 * only flips the indicator's acknowledged flag, it never changes
 * canonical_event.status.
 *
 * Takes CanonicalEventResult[] directly rather than CanonicalizationResult[]
 * — this never looks at `.sources`, only `.event`, so the wrapper type
 * would just be dead weight for every caller (Step 5's DB-backed callers
 * read canonical_events rows directly, with no CanonicalizationResult in
 * sight).
 */
export function deriveQualityIndicators(
  events: CanonicalEventResult[],
): QualityIndicator[] {
  return events
    .filter((event) => event.status === 'CONFLICT')
    .map((event) => ({
      canonicalKey: event.canonicalKey,
      code: `${event.station}_CONFLICT`,
      acknowledged: false,
    }));
}
