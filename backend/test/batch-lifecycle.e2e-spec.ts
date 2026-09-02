// Integration test — Step 5, runs against a REAL Postgres (docker compose,
// host port 5433; DATABASE_URL from backend/.env). Run via `npm run
// test:e2e`. Deliberately separate from `npm run test` (Step 3/4 unit
// tests, pure functions, no DB, must stay fast and Docker-free) — this
// suite is the only place in the repo that touches a live database.

import { ConfigModule } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CanonicalizationModule } from '../src/modules/canonicalization/canonicalization.module';
import { CanonicalizationService } from '../src/modules/canonicalization/canonicalization.service';
import { NewSourceRecordInput } from '../src/modules/canonicalization/types';
import { ProductionDomainModule } from '../src/modules/production-domain/production-domain.module';
import { ProductionDomainService } from '../src/modules/production-domain/production-domain.service';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { buildBatchScenarios, T0 } from './fixtures/batch-scenarios';

// A few minutes past the fixtures' latest eventTime (max is T0+10min, in
// B003/B004) so every scenario except the event-less B001 reads OK, not
// STALE, under the default 15-minute threshold.
const NOW = new Date(T0.getTime() + 11 * 60_000);

// management_events.organization_id is a required DB column that Rule 6-7's
// pure ManagementEventInput type (Step 4) has no reason to carry — none of
// the batch-state functions look at it. Used only when writing test data
// directly via Prisma below.
const TEST_ORGANIZATION_ID = 'org-test';

async function truncateAll(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      canonical_event_sources,
      canonical_events,
      source_records,
      collection_runs,
      sources,
      management_events,
      batches,
      work_orders
    RESTART IDENTITY CASCADE
  `);
}

async function createSingleSourceContext(
  prisma: PrismaService,
  batchId: string,
): Promise<{ sourceId: string; collectionRunId: string }> {
  const source = await prisma.source.create({
    data: { name: 'Test Database Source', type: 'DATABASE', config: {} },
  });
  const run = await prisma.collectionRun.create({
    data: { sourceId: source.id, startedAt: T0, status: 'SUCCESS' },
  });
  const workOrder = await prisma.workOrder.create({
    data: { workOrderId: `WO-${batchId}`, lineId: 'LINE-1' },
  });
  await prisma.batch.create({ data: { batchId, workOrderId: workOrder.id } });
  return { sourceId: source.id, collectionRunId: run.id };
}

describe('Batch lifecycle (Step 5, real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let canonicalizationService: CanonicalizationService;
  let productionDomainService: ProductionDomainService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        CanonicalizationModule,
        ProductionDomainModule,
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    canonicalizationService = moduleRef.get(CanonicalizationService);
    productionDomainService = moduleRef.get(ProductionDomainService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('resolves all 10 fixture scenarios (B001-B008, B005A, B005B, B006) to the expected batch status', async () => {
    const scenarios = await buildBatchScenarios(prisma);

    for (const fixture of Object.values(scenarios)) {
      await canonicalizationService.ingestBatch(fixture.sourceRecords);
      if (fixture.managementEvents.length > 0) {
        await prisma.managementEvent.createMany({
          data: fixture.managementEvents.map((event) => ({
            ...event,
            organizationId: TEST_ORGANIZATION_ID,
          })),
        });
      }
    }

    const expectations = {
      B001: {
        state: 'PLANNED',
        currentStation: null,
        completedQuantity: null,
        missingStations: [],
        freshnessStatus: 'NO_DATA',
        qualityIndicatorCount: 0,
      },
      B002: {
        state: 'IN_PROGRESS',
        currentStation: 'RECEIVING',
        completedQuantity: 100,
        missingStations: [],
        freshnessStatus: 'OK',
        qualityIndicatorCount: 0,
      },
      B003: {
        state: 'IN_PROGRESS',
        currentStation: 'WASHING',
        completedQuantity: 95,
        missingStations: ['SORTING'],
        freshnessStatus: 'OK',
        qualityIndicatorCount: 0,
      },
      B004: {
        state: 'IN_PROGRESS',
        currentStation: 'WASHING',
        completedQuantity: 95,
        missingStations: ['SORTING'],
        freshnessStatus: 'OK',
        qualityIndicatorCount: 0,
      },
      B005A: {
        state: 'IN_PROGRESS',
        currentStation: 'WASHING',
        completedQuantity: 50,
        missingStations: ['RECEIVING', 'SORTING'],
        freshnessStatus: 'OK',
        qualityIndicatorCount: 0,
      },
      B005B: {
        state: 'IN_PROGRESS',
        currentStation: 'SORTING',
        completedQuantity: 30,
        missingStations: ['RECEIVING'],
        freshnessStatus: 'OK',
        qualityIndicatorCount: 0,
      },
      B006: {
        state: 'IN_PROGRESS',
        currentStation: 'DISPATCH',
        completedQuantity: null,
        missingStations: [],
        freshnessStatus: 'OK',
        qualityIndicatorCount: 1,
      },
      B007: {
        state: 'BLOCKED',
        currentStation: 'SORTING',
        completedQuantity: 100,
        missingStations: [],
        freshnessStatus: 'OK',
        qualityIndicatorCount: 0,
      },
      'B007-resume': {
        state: 'IN_PROGRESS',
        currentStation: 'SORTING',
        completedQuantity: 100,
        missingStations: [],
        freshnessStatus: 'OK',
        qualityIndicatorCount: 0,
      },
      B008: {
        state: 'COMPLETED',
        currentStation: 'DISPATCH',
        completedQuantity: 97,
        missingStations: [],
        freshnessStatus: 'OK',
        qualityIndicatorCount: 0,
      },
    } as const;

    for (const [batchId, expected] of Object.entries(expectations)) {
      const result = await productionDomainService.getBatchStatus(batchId, NOW);
      expect(result.state).toBe(expected.state);
      expect(result.currentStation).toBe(expected.currentStation);
      expect(result.completedQuantity).toBe(expected.completedQuantity);
      expect(result.missingStations).toEqual(expected.missingStations);
      expect(result.freshnessStatus).toBe(expected.freshnessStatus);
      expect(result.qualityIndicators).toHaveLength(
        expected.qualityIndicatorCount,
      );
    }
  });

  it('idempotent recompute: re-running ingestAndRecompute with the same record does not duplicate the canonical event', async () => {
    const batchId = 'B-IDEMPOTENT';
    const { sourceId, collectionRunId } = await createSingleSourceContext(
      prisma,
      batchId,
    );
    const record: NewSourceRecordInput = {
      sourceId,
      collectionRunId,
      sourceRecordId: 'idem-1',
      batchId,
      station: 'RECEIVING',
      quantity: 42,
      eventTime: T0,
      receivedAt: T0,
    };

    await canonicalizationService.ingestAndRecompute(record);
    await canonicalizationService.ingestAndRecompute(record);

    const rows = await prisma.canonicalEvent.findMany({
      where: { canonicalKey: `${batchId}:RECEIVING` },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity.toNumber()).toBe(42);
    expect(rows[0].status).toBe('ACCEPTED');

    // Append-only (Rule 1): re-running still creates a new raw row each
    // time, even though the canonical event stays singular.
    const rawRows = await prisma.sourceRecord.findMany({ where: { batchId } });
    expect(rawRows).toHaveLength(2);
  });

  it('recompute considers full history: a later, larger reading from the same source supersedes the earlier one and updates the SAME canonical event', async () => {
    const batchId = 'B-HISTORY';
    const { sourceId, collectionRunId } = await createSingleSourceContext(
      prisma,
      batchId,
    );

    const recordA: NewSourceRecordInput = {
      sourceId,
      collectionRunId,
      sourceRecordId: 'hist-a',
      batchId,
      station: 'WASHING',
      quantity: 100,
      eventTime: T0,
      receivedAt: T0,
    };
    const resultA = await canonicalizationService.ingestAndRecompute(recordA);
    expect(resultA.event.status).toBe('ACCEPTED');
    expect(resultA.event.quantity).toBe(100);

    const later = new Date(T0.getTime() + 5 * 60_000);
    const recordB: NewSourceRecordInput = {
      sourceId,
      collectionRunId,
      sourceRecordId: 'hist-b',
      batchId,
      station: 'WASHING',
      quantity: 150,
      eventTime: later,
      receivedAt: later,
    };
    const resultB = await canonicalizationService.ingestAndRecompute(recordB);
    expect(resultB.event.quantity).toBe(150);

    const canonicalRows = await prisma.canonicalEvent.findMany({
      where: { canonicalKey: `${batchId}:WASHING` },
    });
    expect(canonicalRows).toHaveLength(1);
    expect(canonicalRows[0].quantity.toNumber()).toBe(150);

    const links = await prisma.canonicalEventSource.findMany({
      where: { canonicalEventId: canonicalRows[0].id },
      include: { sourceRecord: true },
    });
    const linkFor = (sourceRecordId: string) =>
      links.find((link) => link.sourceRecord.sourceRecordId === sourceRecordId);

    expect(linkFor('hist-b')?.relationship).toBe('PRIMARY');
    expect(linkFor('hist-a')?.relationship).toBe('SUPERSEDED');
  });

  it('B006 + ACK_EXCEPTION: acknowledging a CONFLICT indicator flips acknowledged but never the batch state (Rule 5b)', async () => {
    const scenarios = await buildBatchScenarios(prisma);
    await canonicalizationService.ingestBatch(scenarios.B006.sourceRecords);

    const canonicalDispatch = await prisma.canonicalEvent.findUniqueOrThrow({
      where: { canonicalKey: 'B006:DISPATCH' },
    });
    expect(canonicalDispatch.status).toBe('CONFLICT');

    const ackTimestamp = new Date(
      canonicalDispatch.updatedAt.getTime() + 60_000,
    );
    await prisma.managementEvent.create({
      data: {
        batchId: 'B006',
        action: 'ACK_EXCEPTION',
        actor: 'ops-1',
        timestamp: ackTimestamp,
        organizationId: TEST_ORGANIZATION_ID,
      },
    });

    const status = await productionDomainService.getBatchStatus(
      'B006',
      ackTimestamp,
    );

    expect(status.qualityIndicators).toHaveLength(1);
    expect(status.qualityIndicators[0].acknowledged).toBe(true);
    expect(status.state).not.toBe('COMPLETED');
    expect(status.state).toBe('IN_PROGRESS');
  });

  it('getBatchStatus throws NotFoundException for an unknown batchId', async () => {
    await expect(
      productionDomainService.getBatchStatus('DOES-NOT-EXIST', NOW),
    ).rejects.toThrow(NotFoundException);
  });
});
