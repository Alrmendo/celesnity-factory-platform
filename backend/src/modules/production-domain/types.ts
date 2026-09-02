// Pure TypeScript types for production-domain logic (Rule 6-7,
// docs/plan-v4.md). Reuses Station/CanonicalEventResult from the
// canonicalization module instead of redefining equivalent types —
// canonical events ARE this module's input, not a separate concept.

import { Station } from '../canonicalization/types';

export type ManagementActionType =
  'BLOCK' | 'RESUME' | 'ACK_EXCEPTION' | 'ADD_NOTE';

export interface ManagementEventInput {
  batchId: string;
  action: ManagementActionType;
  actor: string;
  timestamp: Date;
}

export type BatchState = 'PLANNED' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED';

export type FreshnessStatus = 'NO_DATA' | 'OK' | 'STALE';

// Rule 5b indicator shape as consumed here — acknowledged is a real boolean
// (already resolved by ManagementEventsModule/ACK_EXCEPTION upstream), not
// the always-false shape produced fresh by
// canonicalization/quality-indicators.ts.
export interface QualityIndicatorView {
  code: string;
  acknowledged: boolean;
}

export interface BatchStatusResult {
  batchId: string;
  state: BatchState;
  currentStation: Station | null;
  completedQuantity: number | null;
  missingStations: Station[];
  freshnessStatus: FreshnessStatus;
  freshnessMinutes: number | null;
  qualityIndicators: QualityIndicatorView[];
}
