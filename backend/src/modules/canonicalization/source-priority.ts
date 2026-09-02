import { SourceType } from './types';

/**
 * Rule 4 — source priority tier. Lower number = higher priority.
 *
 * Tier 1: Production Database, Application API — the assessment describes
 * both as equally valid sources for DISPATCH ("Application API or
 * production database"), so they're ranked at the same trust level.
 * Tier 2: Supplier Crawler.
 *
 * MQTT has no collector/fixture in this project's scope — placed at tier 2
 * as a forward-compatible placeholder only; there is no test case for it
 * because MQTT is out of scope for this assessment.
 */
export const SOURCE_TIER: Record<SourceType, number> = {
  DATABASE: 1,
  API: 1,
  CRAWLER: 2,
  MQTT: 2,
};

export function getSourceTier(sourceType: SourceType): number {
  return SOURCE_TIER[sourceType];
}
