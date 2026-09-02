import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveAll, resolveGroup } from './canonicalization.pipeline';
import {
  deriveQualityIndicators,
  QualityIndicator,
} from './quality-indicators';
import {
  CanonicalizationResult,
  NewSourceRecordInput,
  SourceRecordInput,
} from './types';

export interface CanonicalizeOutput {
  results: CanonicalizationResult[];
  qualityIndicators: QualityIndicator[];
}

@Injectable()
export class CanonicalizationService {
  constructor(private readonly prisma: PrismaService) {}

  // Pure, in-memory — no DB access. Kept from Step 3 unchanged in behavior.
  canonicalize(records: SourceRecordInput[]): CanonicalizeOutput {
    const results = resolveAll(records);
    const qualityIndicators = deriveQualityIndicators(
      results.map((result) => result.event),
    );
    return { results, qualityIndicators };
  }

  /**
   * Real DB-backed ingest, Step 5: insert one raw reading, then recompute
   * the canonical_event for its batchId+station from ALL matching
   * source_records (not just the new one — Rule 2 requires the full
   * history to resolve last-observed-wins/tier comparisons correctly), in
   * a single transaction so no reader ever observes a half-updated state.
   * Reuses `resolveGroup` from Step 3 verbatim — no canonicalization logic
   * lives here, only DB plumbing around it.
   */
  async ingestAndRecompute(
    record: NewSourceRecordInput,
  ): Promise<CanonicalizationResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.sourceRecord.create({
        data: {
          sourceId: record.sourceId,
          sourceRecordId: record.sourceRecordId,
          collectionRunId: record.collectionRunId,
          batchId: record.batchId,
          station: record.station,
          // source_records has no dedicated quantity column — the raw
          // payload carries it (mirrors what a real collector would store;
          // {quantity} is the minimal faithful shape for this step's
          // scope, since no real collector exists yet).
          payload: { quantity: record.quantity },
          eventTime: record.eventTime,
          receivedAt: record.receivedAt,
        },
      });

      const rows = await tx.sourceRecord.findMany({
        where: { batchId: record.batchId, station: record.station },
        include: { source: true },
      });

      const inputs: SourceRecordInput[] = rows.map((row) => ({
        id: row.id,
        sourceId: row.sourceId,
        sourceType: row.source.type,
        sourceRecordId: row.sourceRecordId,
        batchId: row.batchId,
        station: row.station,
        quantity: (row.payload as { quantity: number }).quantity,
        eventTime: row.eventTime,
        receivedAt: row.receivedAt,
      }));

      const result = resolveGroup(inputs);

      const canonicalEvent = await tx.canonicalEvent.upsert({
        where: { canonicalKey: result.event.canonicalKey },
        create: {
          batchId: result.event.batchId,
          station: result.event.station,
          quantity: result.event.quantity,
          eventTime: result.event.eventTime,
          status: result.event.status,
          canonicalKey: result.event.canonicalKey,
        },
        update: {
          quantity: result.event.quantity,
          eventTime: result.event.eventTime,
          status: result.event.status,
        },
      });

      // Simplest-correct approach per the task spec: wipe and rebuild all
      // links for this canonical event rather than upserting each one —
      // a record's relationship can flip entirely between recomputes
      // (e.g. PRIMARY -> DUPLICATE when a newer record wins), so there's
      // no stable per-row identity to upsert against anyway.
      await tx.canonicalEventSource.deleteMany({
        where: { canonicalEventId: canonicalEvent.id },
      });
      await tx.canonicalEventSource.createMany({
        data: result.sources.map((source) => ({
          canonicalEventId: canonicalEvent.id,
          sourceRecordPk: source.sourceRecordPk,
          relationship: source.relationship,
        })),
      });

      return result;
    });
  }

  /** Sequential ingest — fixture/seed scale, correctness over throughput. */
  async ingestBatch(
    records: NewSourceRecordInput[],
  ): Promise<CanonicalizationResult[]> {
    const results: CanonicalizationResult[] = [];
    for (const record of records) {
      results.push(await this.ingestAndRecompute(record));
    }
    return results;
  }
}
