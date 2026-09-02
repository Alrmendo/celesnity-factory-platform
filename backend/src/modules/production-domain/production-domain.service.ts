import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CanonicalEventResult } from '../canonicalization/types';
import { deriveQualityIndicators } from '../canonicalization/quality-indicators';
import {
  getCompletedQuantity,
  getCurrentStation,
  getMissingStations,
  resolveBatchState,
} from './batch-state';
import { calculateFreshness } from './freshness';
import {
  BatchStatusResult,
  ManagementEventInput,
  QualityIndicatorView,
} from './types';

const DEFAULT_STALE_THRESHOLD_MINUTES = 15;

// Thin wrapper over the pure batch-state/freshness functions (Step 4,
// unchanged) plus real DB reads (Step 5).
//
// Note on the method split below: Step 4 originally named the pure
// orchestration method `getBatchStatus`. That name is now taken by the
// DB-backed method (the one callers actually want), so the pure version
// was renamed to `computeBatchStatus` — a plain rename, no logic changed.
// No spec ever called it by name (Step 4's required tests only exercise
// batch-state.ts/freshness.ts directly), so this didn't touch any passing
// test.
@Injectable()
export class ProductionDomainService {
  constructor(private readonly prisma: PrismaService) {}

  /** Pure orchestration over already-fetched, already-filtered-by-batchId data — no DB access. */
  computeBatchStatus(
    batchId: string,
    events: CanonicalEventResult[],
    managementEvents: ManagementEventInput[],
    qualityIndicators: QualityIndicatorView[],
    now: Date,
    staleThresholdMinutes: number = DEFAULT_STALE_THRESHOLD_MINUTES,
  ): BatchStatusResult {
    const currentStation = getCurrentStation(events);
    const missingStations = getMissingStations(events, currentStation);
    const state = resolveBatchState(events, managementEvents);
    const completedQuantity = getCompletedQuantity(events, currentStation);
    const freshness = calculateFreshness(events, now, staleThresholdMinutes);

    return {
      batchId,
      state,
      currentStation,
      completedQuantity,
      missingStations,
      freshnessStatus: freshness.status,
      freshnessMinutes: freshness.minutes,
      qualityIndicators,
    };
  }

  /**
   * Real DB-backed status read, Step 5. `acknowledged` has no dedicated
   * column anywhere in the schema — it's derived from management_events:
   * a CONFLICT indicator counts as acknowledged when there's an
   * ACK_EXCEPTION on the batch timestamped at/after that canonical_event's
   * `updated_at`. management_events has no per-station column, so "cùng
   * station" (task spec) is approximated as "same batch, timestamp after
   * this specific conflict's updated_at" — in every scenario in scope here
   * a batch has at most one live conflict at a time, so this is exact in
   * practice, not just an approximation of convenience.
   */
  async getBatchStatus(
    batchId: string,
    now: Date,
    staleThresholdMinutes: number = DEFAULT_STALE_THRESHOLD_MINUTES,
  ): Promise<BatchStatusResult> {
    const batch = await this.prisma.batch.findUnique({ where: { batchId } });
    if (!batch) {
      throw new NotFoundException(`Batch not found: ${batchId}`);
    }

    const [canonicalEventRows, managementEventRows] = await Promise.all([
      this.prisma.canonicalEvent.findMany({ where: { batchId } }),
      this.prisma.managementEvent.findMany({ where: { batchId } }),
    ]);

    const events: CanonicalEventResult[] = canonicalEventRows.map((row) => ({
      batchId: row.batchId,
      station: row.station,
      canonicalKey: row.canonicalKey,
      quantity: row.quantity.toNumber(),
      eventTime: row.eventTime,
      status: row.status,
    }));

    const managementEvents: ManagementEventInput[] = managementEventRows.map(
      (row) => ({
        batchId: row.batchId,
        action: row.action,
        actor: row.actor,
        timestamp: row.timestamp,
      }),
    );

    // deriveQualityIndicators filters `events` down to the CONFLICT ones,
    // preserving relative order — filtering canonicalEventRows by the same
    // predicate over the same underlying sequence yields matching order,
    // so zipping index-by-index below is safe.
    const conflictRows = canonicalEventRows.filter(
      (row) => row.status === 'CONFLICT',
    );
    const baseIndicators = deriveQualityIndicators(events);

    const qualityIndicators: QualityIndicatorView[] = baseIndicators.map(
      (indicator, i) => {
        const row = conflictRows[i];
        const acknowledged = managementEventRows.some(
          (mgmt) =>
            mgmt.action === 'ACK_EXCEPTION' &&
            mgmt.timestamp.getTime() >= row.updatedAt.getTime(),
        );
        return { code: indicator.code, acknowledged };
      },
    );

    return this.computeBatchStatus(
      batchId,
      events,
      managementEvents,
      qualityIndicators,
      now,
      staleThresholdMinutes,
    );
  }
}
