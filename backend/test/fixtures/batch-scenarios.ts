// Shared fixture builder — Step 5. Builds the DB-backed version of the same
// 10 scenarios already used as in-memory mocks in
// canonicalization.pipeline.spec.ts (B005A, B005B, B006) and
// batch-state.spec.ts (B001-B004, B006-B008). Used by BOTH the integration
// suite (batch-lifecycle.e2e-spec.ts) and the seed script (prisma/seed.ts)
// — written once, used twice, per the task spec.
//
// Creates real sources/collection_runs/work_orders/batches first (Step 2's
// schema has real FKs now), then returns per-scenario
// NewSourceRecordInput[]/ManagementEventInput[] ready to feed into
// CanonicalizationService.ingestBatch and prisma.managementEvent.createMany
// respectively.

import { PrismaClient } from '@prisma/client';
import {
  NewSourceRecordInput,
  Station,
} from '../../src/modules/canonicalization/types';
import { ManagementEventInput } from '../../src/modules/production-domain/types';

export type ScenarioName =
  | 'B001'
  | 'B002'
  | 'B003'
  | 'B004'
  | 'B005A'
  | 'B005B'
  | 'B006'
  | 'B007'
  | 'B007-resume'
  | 'B008';

export const SCENARIO_NAMES: ScenarioName[] = [
  'B001',
  'B002',
  'B003',
  'B004',
  'B005A',
  'B005B',
  'B006',
  'B007',
  'B007-resume',
  'B008',
];

export interface ScenarioFixture {
  batchId: string;
  sourceRecords: NewSourceRecordInput[];
  managementEvents: ManagementEventInput[];
}

// Exported so callers (integration test, seed script) can compute a `now`
// consistent with these fixtures' timestamps without duplicating the base.
export const T0 = new Date('2026-01-01T00:00:00.000Z');
const t0 = T0;
const minutes = (n: number) => new Date(t0.getTime() + n * 60_000);

export async function buildBatchScenarios(
  prisma: PrismaClient,
): Promise<Record<ScenarioName, ScenarioFixture>> {
  const databaseSource = await prisma.source.create({
    data: { name: 'Production Database', type: 'DATABASE', config: {} },
  });
  const apiSource = await prisma.source.create({
    data: { name: 'Application API', type: 'API', config: {} },
  });

  const databaseRun = await prisma.collectionRun.create({
    data: { sourceId: databaseSource.id, startedAt: t0, status: 'SUCCESS' },
  });
  const apiRun = await prisma.collectionRun.create({
    data: { sourceId: apiSource.id, startedAt: t0, status: 'SUCCESS' },
  });

  for (const batchId of SCENARIO_NAMES) {
    const workOrder = await prisma.workOrder.create({
      data: { workOrderId: `WO-${batchId}`, lineId: 'LINE-1' },
    });
    await prisma.batch.create({ data: { batchId, workOrderId: workOrder.id } });
  }

  function dbRecord(
    batchId: string,
    station: Station,
    quantity: number,
    eventTime: Date,
    receivedAt: Date,
    sourceRecordId: string,
  ): NewSourceRecordInput {
    return {
      sourceId: databaseSource.id,
      collectionRunId: databaseRun.id,
      sourceRecordId,
      batchId,
      station,
      quantity,
      eventTime,
      receivedAt,
    };
  }

  function apiRecord(
    batchId: string,
    station: Station,
    quantity: number,
    eventTime: Date,
    receivedAt: Date,
    sourceRecordId: string,
  ): NewSourceRecordInput {
    return {
      sourceId: apiSource.id,
      collectionRunId: apiRun.id,
      sourceRecordId,
      batchId,
      station,
      quantity,
      eventTime,
      receivedAt,
    };
  }

  // A full RECEIVING..FOLDING accepted run, reused by B006/B008 so DISPATCH
  // isn't the only station on record (matches the Step 4 mock fixtures).
  function upstreamStations(batchId: string): NewSourceRecordInput[] {
    return [
      dbRecord(
        batchId,
        'RECEIVING',
        100,
        minutes(0),
        minutes(0),
        `${batchId}-RECEIVING`,
      ),
      dbRecord(
        batchId,
        'SORTING',
        100,
        minutes(1),
        minutes(1),
        `${batchId}-SORTING`,
      ),
      dbRecord(
        batchId,
        'WASHING',
        98,
        minutes(2),
        minutes(2),
        `${batchId}-WASHING`,
      ),
      dbRecord(
        batchId,
        'DRYING',
        98,
        minutes(3),
        minutes(3),
        `${batchId}-DRYING`,
      ),
      dbRecord(
        batchId,
        'FOLDING',
        97,
        minutes(4),
        minutes(4),
        `${batchId}-FOLDING`,
      ),
    ];
  }

  return {
    // B001 (Rule 7): no source data at all -> PLANNED.
    B001: { batchId: 'B001', sourceRecords: [], managementEvents: [] },

    // B002 (Rule 6+7): single ACCEPTED at RECEIVING -> IN_PROGRESS.
    B002: {
      batchId: 'B002',
      sourceRecords: [
        dbRecord(
          'B002',
          'RECEIVING',
          100,
          minutes(0),
          minutes(0),
          'B002-RECEIVING',
        ),
      ],
      managementEvents: [],
    },

    // B003 (Rule 6): RECEIVING+WASHING accepted, SORTING never seen.
    B003: {
      batchId: 'B003',
      sourceRecords: [
        dbRecord(
          'B003',
          'RECEIVING',
          100,
          minutes(0),
          minutes(0),
          'B003-RECEIVING',
        ),
        dbRecord(
          'B003',
          'WASHING',
          95,
          minutes(10),
          minutes(10),
          'B003-WASHING',
        ),
      ],
      managementEvents: [],
    },

    // B004 (Rule 6): WASHING reached first, RECEIVING arrives late ->
    // currentStation stays WASHING.
    B004: {
      batchId: 'B004',
      sourceRecords: [
        dbRecord('B004', 'WASHING', 95, minutes(0), minutes(0), 'B004-WASHING'),
        dbRecord(
          'B004',
          'RECEIVING',
          100,
          minutes(10),
          minutes(10),
          'B004-RECEIVING',
        ),
      ],
      managementEvents: [],
    },

    // B005A (Rule 1+5.2): same sourceId+sourceRecordId re-read at a later
    // receivedAt -> one canonical event, earlier reading DUPLICATE.
    B005A: {
      batchId: 'B005A',
      sourceRecords: [
        dbRecord(
          'B005A',
          'WASHING',
          50,
          minutes(0),
          minutes(0),
          'B005A-SAME-ID',
        ),
        dbRecord(
          'B005A',
          'WASHING',
          50,
          minutes(0),
          minutes(5),
          'B005A-SAME-ID',
        ),
      ],
      managementEvents: [],
    },

    // B005B (Rule 2+5.2): same source, different sourceRecordId, same
    // batch+station+quantity -> still grouped into one canonical event.
    B005B: {
      batchId: 'B005B',
      sourceRecords: [
        dbRecord('B005B', 'SORTING', 30, minutes(0), minutes(0), 'B005B-ID-A'),
        dbRecord('B005B', 'SORTING', 30, minutes(3), minutes(3), 'B005B-ID-B'),
      ],
      managementEvents: [],
    },

    // B006 (Rule 4+5.4): DISPATCH disagreement between DATABASE and API
    // (same tier) -> CONFLICT; batch stays IN_PROGRESS, never COMPLETED.
    B006: {
      batchId: 'B006',
      sourceRecords: [
        ...upstreamStations('B006'),
        dbRecord(
          'B006',
          'DISPATCH',
          500,
          minutes(5),
          minutes(5),
          'B006-DISPATCH-DB',
        ),
        apiRecord(
          'B006',
          'DISPATCH',
          480,
          minutes(5),
          minutes(5),
          'B006-DISPATCH-API',
        ),
      ],
      managementEvents: [],
    },

    // B007 (Rule 7): BLOCK with no later RESUME -> BLOCKED.
    B007: {
      batchId: 'B007',
      sourceRecords: [
        dbRecord(
          'B007',
          'RECEIVING',
          100,
          minutes(0),
          minutes(0),
          'B007-RECEIVING',
        ),
        dbRecord(
          'B007',
          'SORTING',
          100,
          minutes(1),
          minutes(1),
          'B007-SORTING',
        ),
      ],
      managementEvents: [
        {
          batchId: 'B007',
          action: 'BLOCK',
          actor: 'ops-1',
          timestamp: minutes(30),
        },
      ],
    },

    // B007-resume: same as B007 but with a later RESUME -> back to
    // IN_PROGRESS.
    'B007-resume': {
      batchId: 'B007-resume',
      sourceRecords: [
        dbRecord(
          'B007-resume',
          'RECEIVING',
          100,
          minutes(0),
          minutes(0),
          'B007R-RECEIVING',
        ),
        dbRecord(
          'B007-resume',
          'SORTING',
          100,
          minutes(1),
          minutes(1),
          'B007R-SORTING',
        ),
      ],
      managementEvents: [
        {
          batchId: 'B007-resume',
          action: 'BLOCK',
          actor: 'ops-1',
          timestamp: minutes(30),
        },
        {
          batchId: 'B007-resume',
          action: 'RESUME',
          actor: 'ops-1',
          timestamp: minutes(45),
        },
      ],
    },

    // B008 (Rule 7): DISPATCH ACCEPTED -> COMPLETED.
    B008: {
      batchId: 'B008',
      sourceRecords: [
        ...upstreamStations('B008'),
        dbRecord(
          'B008',
          'DISPATCH',
          97,
          minutes(5),
          minutes(5),
          'B008-DISPATCH',
        ),
      ],
      managementEvents: [],
    },
  };
}
