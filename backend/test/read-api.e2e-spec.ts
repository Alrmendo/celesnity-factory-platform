// Integration test — Step 10, runs against a REAL Postgres, same pattern as
// every other *.e2e-spec.ts file (see batch-lifecycle.e2e-spec.ts's header
// comment). Covers the new read-only endpoints added for the Data Sources +
// Production Lines UI views: GET /sources, GET /collection-runs, GET
// /canonical-events, GET /production-lines. No domain logic is exercised
// here that Step 3/4/5's own specs don't already cover in depth — these
// tests only assert response SHAPE (what the frontend will actually
// consume), reusing the existing B001-B008 fixture set rather than
// inventing new scenarios.

import { Test, TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { CanonicalizationService } from '../src/modules/canonicalization/canonicalization.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { buildBatchScenarios, T0 } from './fixtures/batch-scenarios';
import { truncateAll } from './fixtures/db-utils';

describe('Read APIs for Data Sources + Production Lines views (Step 10, real Postgres)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let canonicalizationService: CanonicalizationService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    canonicalizationService = app.get(CanonicalizationService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  // --- GET /sources -------------------------------------------------------

  it('GET /sources lists all sources, sanitized', async () => {
    await request(app.getHttpServer())
      .post('/sources')
      .send({
        name: 'Application API',
        type: 'API',
        config: { baseUrl: 'http://x' },
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/sources')
      .send({
        name: 'Production Database',
        type: 'DATABASE',
        config: {
          passwordEnvVar: 'PROD_DB_PW',
          password: 'literal-secret-should-be-redacted',
        },
      })
      .expect(201);

    const res = await request(app.getHttpServer()).get('/sources').expect(200);
    const body = res.body as Array<{
      id: string;
      name: string;
      type: string;
      config: Record<string, unknown>;
      verifiedAt: string | null;
      createdAt: string;
      updatedAt: string;
    }>;

    expect(body).toHaveLength(2);
    const names = body.map((s) => s.name).sort();
    expect(names).toEqual(['Application API', 'Production Database']);

    const dbSource = body.find((s) => s.type === 'DATABASE')!;
    expect(dbSource.config.passwordEnvVar).toBe('PROD_DB_PW');
    expect(dbSource.config.password).toBe('[REDACTED]');
    expect(dbSource.verifiedAt).toBeNull();
    expect(typeof dbSource.createdAt).toBe('string');
  });

  // --- GET /collection-runs?sourceId= --------------------------------------

  it('GET /collection-runs?sourceId= returns history with duration, newest first', async () => {
    const source = await prisma.source.create({
      data: { name: 'Production Database', type: 'DATABASE', config: {} },
    });
    const otherSource = await prisma.source.create({
      data: { name: 'Other', type: 'API', config: {} },
    });

    const finished = await prisma.collectionRun.create({
      data: {
        sourceId: source.id,
        startedAt: T0,
        finishedAt: new Date(T0.getTime() + 5_000),
        status: 'SUCCESS',
        recordsRead: 3,
        errorCount: 0,
      },
    });
    const running = await prisma.collectionRun.create({
      data: {
        sourceId: source.id,
        startedAt: new Date(T0.getTime() + 60_000),
        status: 'RUNNING',
      },
    });
    await prisma.collectionRun.create({
      data: { sourceId: otherSource.id, startedAt: T0, status: 'SUCCESS' },
    });

    const res = await request(app.getHttpServer())
      .get(`/collection-runs?sourceId=${source.id}`)
      .expect(200);
    const body = res.body as Array<{
      id: string;
      sourceId: string;
      status: string;
      startedAt: string;
      finishedAt: string | null;
      durationMs: number | null;
      recordsRead: number;
      errorCount: number;
      errorMessage: string | null;
    }>;

    expect(body).toHaveLength(2);
    // newest (running, started later) first
    expect(body[0].id).toBe(running.id);
    expect(body[0].durationMs).toBeNull();
    expect(body[1].id).toBe(finished.id);
    expect(body[1].durationMs).toBe(5_000);
    expect(body[1].recordsRead).toBe(3);
    expect(body.every((r) => r.sourceId === source.id)).toBe(true);
  });

  // --- GET /canonical-events (preview + provenance) ------------------------

  it('GET /canonical-events?batchId= previews the canonical event with source + collection-run provenance', async () => {
    const scenarios = await buildBatchScenarios(prisma);
    await canonicalizationService.ingestBatch(scenarios.B006.sourceRecords);

    const res = await request(app.getHttpServer())
      .get('/canonical-events?batchId=B006')
      .expect(200);
    const body = res.body as Array<{
      batchId: string;
      station: string;
      status: string;
      canonicalKey: string;
      sources: Array<{
        relationship: string;
        sourceId: string;
        sourceName: string;
        sourceType: string;
        collectionRunId: string;
        sourceRecordId: string;
      }>;
    }>;

    const dispatchEvent = body.find((e) => e.station === 'DISPATCH')!;
    expect(dispatchEvent.status).toBe('CONFLICT');
    expect(dispatchEvent.canonicalKey).toBe('B006:DISPATCH');
    // Rule 5.4: same-tier disagreement -> both records marked CONFLICT.
    expect(dispatchEvent.sources).toHaveLength(2);
    expect(
      dispatchEvent.sources.every((s) => s.relationship === 'CONFLICT'),
    ).toBe(true);
    const sourceNames = dispatchEvent.sources.map((s) => s.sourceName).sort();
    expect(sourceNames).toEqual(['Application API', 'Production Database']);
    expect(dispatchEvent.sources.every((s) => !!s.collectionRunId)).toBe(true);

    // Filtering by sourceId (provenance drill-down from the Data Sources
    // view) narrows to only canonical events touched by that source.
    const dbSourceRecord = await prisma.sourceRecord.findFirstOrThrow({
      where: { batchId: 'B006', station: 'DISPATCH' },
    });
    const bySource = await request(app.getHttpServer())
      .get(`/canonical-events?sourceId=${dbSourceRecord.sourceId}`)
      .expect(200);
    const bySourceBody = bySource.body as Array<{ batchId: string }>;
    expect(bySourceBody.some((e) => e.batchId === 'B006')).toBe(true);
  });

  // --- GET /production-lines -----------------------------------------------

  it('GET /production-lines rolls up per-line batch status + per-station WIP, reusing Rule 6/7 unchanged', async () => {
    const scenarios = await buildBatchScenarios(prisma);
    for (const fixture of Object.values(scenarios)) {
      await canonicalizationService.ingestBatch(fixture.sourceRecords);
      if (fixture.managementEvents.length > 0) {
        await prisma.managementEvent.createMany({
          data: fixture.managementEvents.map((event) => ({
            organizationId: 'org-test',
            batchId: event.batchId,
            actor: event.actor,
            action: event.action,
            timestamp: event.timestamp,
          })),
        });
      }
    }

    const res = await request(app.getHttpServer())
      .get('/production-lines')
      .expect(200);
    const body = res.body as Array<{
      lineId: string;
      stations: Array<{ station: string; wip: number; batchIds: string[] }>;
      batches: Array<{
        batchId: string;
        workOrderId: string;
        state: string;
        currentStation: string | null;
      }>;
    }>;

    // Every batch-scenarios.ts fixture uses lineId 'LINE-1' -> exactly one line.
    expect(body).toHaveLength(1);
    const line = body[0];
    expect(line.lineId).toBe('LINE-1');
    expect(line.batches).toHaveLength(10);
    expect(line.batches.every((b) => b.workOrderId.startsWith('WO-'))).toBe(
      true,
    );

    const wipByStation = Object.fromEntries(
      line.stations.map((s) => [
        s.station,
        { wip: s.wip, batchIds: s.batchIds.slice().sort() },
      ]),
    );
    // Derived from batch-lifecycle.e2e-spec.ts's known scenarioExpectations
    // (currentStation/state per batch) — COMPLETED batches (B008) never
    // count as WIP even though their currentStation is DISPATCH.
    expect(wipByStation.RECEIVING).toEqual({ wip: 1, batchIds: ['B002'] });
    expect(wipByStation.SORTING).toEqual({
      wip: 3,
      batchIds: ['B005B', 'B007', 'B007-resume'],
    });
    expect(wipByStation.WASHING).toEqual({
      wip: 3,
      batchIds: ['B003', 'B004', 'B005A'],
    });
    expect(wipByStation.DRYING).toEqual({ wip: 0, batchIds: [] });
    expect(wipByStation.FOLDING).toEqual({ wip: 0, batchIds: [] });
    expect(wipByStation.DISPATCH).toEqual({ wip: 1, batchIds: ['B006'] });

    const byId = Object.fromEntries(line.batches.map((b) => [b.batchId, b]));
    expect(byId.B001.state).toBe('PLANNED');
    expect(byId.B007.state).toBe('BLOCKED');
    expect(byId.B008.state).toBe('COMPLETED');
  });
});

describe('Freshness threshold configurable via STALE_THRESHOLD_MINUTES (Step 10, real Postgres)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let canonicalizationService: CanonicalizationService;
  const originalEnv = process.env.STALE_THRESHOLD_MINUTES;

  beforeAll(async () => {
    // Must be set BEFORE compiling the module — ConfigModule.forRoot()
    // reads process.env at compile time (same pattern
    // collection-runs.e2e-spec.ts already relies on for FIXTURE_API_KEY).
    process.env.STALE_THRESHOLD_MINUTES = '1';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    canonicalizationService = app.get(CanonicalizationService);
  });

  afterAll(async () => {
    await app.close();
    // Restore — process.env is process-global and jest-e2e.json pins
    // maxWorkers to 1, so a leaked override here could affect whichever
    // e2e file runs next in the same worker process.
    if (originalEnv === undefined) {
      delete process.env.STALE_THRESHOLD_MINUTES;
    } else {
      process.env.STALE_THRESHOLD_MINUTES = originalEnv;
    }
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('a batch 2 minutes stale is reported STALE under a 1-minute threshold', async () => {
    const workOrder = await prisma.workOrder.create({
      data: { workOrderId: 'WO-FRESH', lineId: 'LINE-FRESH' },
    });
    await prisma.batch.create({
      data: { batchId: 'FRESH-01', workOrderId: workOrder.id },
    });
    const source = await prisma.source.create({
      data: { name: 'Production Database', type: 'DATABASE', config: {} },
    });
    const run = await prisma.collectionRun.create({
      data: { sourceId: source.id, startedAt: new Date(), status: 'SUCCESS' },
    });

    const eventTime = new Date(Date.now() - 2 * 60_000);
    await canonicalizationService.ingestAndRecompute({
      sourceId: source.id,
      collectionRunId: run.id,
      sourceRecordId: 'FRESH-01-RECEIVING',
      batchId: 'FRESH-01',
      station: 'RECEIVING',
      quantity: 10,
      eventTime,
      receivedAt: eventTime,
    });

    const res = await request(app.getHttpServer())
      .get('/production-lines')
      .expect(200);
    const body = res.body as Array<{
      lineId: string;
      batches: Array<{ batchId: string; freshnessStatus: string }>;
    }>;

    const line = body.find((l) => l.lineId === 'LINE-FRESH')!;
    const batch = line.batches.find((b) => b.batchId === 'FRESH-01')!;
    expect(batch.freshnessStatus).toBe('STALE');
  });
});
