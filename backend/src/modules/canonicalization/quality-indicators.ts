import { CanonicalizationResult } from './types';

export interface QualityIndicator {
  canonicalKey: string;
  code: string;
  acknowledged: false;
}

/**
 * Rule 5b — data-generation half only. Every CONFLICT canonicalization
 * result gets one unacknowledged quality indicator. Setting
 * `acknowledged: false -> true` (ACK_EXCEPTION) is a ManagementEventsModule
 * concern and does NOT happen here — see plan-v4.md Rule 5b: ACK_EXCEPTION
 * only flips the indicator's acknowledged flag, it never changes
 * canonical_event.status.
 */
export function deriveQualityIndicators(
  results: CanonicalizationResult[],
): QualityIndicator[] {
  return results
    .filter((result) => result.event.status === 'CONFLICT')
    .map((result) => ({
      canonicalKey: result.event.canonicalKey,
      code: `${result.event.station}_CONFLICT`,
      acknowledged: false,
    }));
}
