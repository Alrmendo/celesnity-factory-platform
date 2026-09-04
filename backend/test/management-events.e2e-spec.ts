// Integration test — Step 9, runs against a REAL Postgres, same as every
// other *.e2e-spec.ts file (see batch-lifecycle.e2e-spec.ts's header
// comment). No new fixture service needed (management_events already
// exists since Step 2, no migration for Step 9) — this only exercises the
// 4 new POST /management-events/* routes against Prisma directly.

import { Test, TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { CanonicalizationService } from '../src/modules/canonicalization/canonicalization.service';
import { SEED_ORGANIZATION_ID } from '../src/modules/management-events/constants';
import { ProductionDomainService } from '../src/modules/production-domain/production-domain.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { truncateAll } from './fixtures/db-utils';

const T0 = new Date('2026-02-01T00:00:00.000Z');

interface ManagementEventRow {
  action: string;
  organizationId: string;
  actor: string;
  timestamp: string;
  batchId: string;
  note: string | null;
}

describe('Management events: block/resume/ack-exception/note (Step 9, real Postgres)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let canonicalizationService: CanonicalizationService;
  let productionDomainService: ProductionDomainService;
  let dbSourceId: string;
  let dbRunId: string;
  let apiSourceId: string;
  let apiRunId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    canonicalizationService = app.get(CanonicalizationService);
    productionDomainService = app.get(ProductionDomainService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);

    const dbSource = await prisma.source.create({
      data: { name: 'Production Database', type: 'DATABASE', config: {} },
    });
    const dbRun = await prisma.collectionRun.create({
      data: { sourceId: dbSource.id, startedAt: T0, status: 'SUCCESS' },
    });
    const apiSource = await prisma.source.create({
      data: { name: 'Application API', type: 'API', config: {} },
    });
    const apiRun = await prisma.collectionRun.create({
      data: { sourceId: apiSource.id, startedAt: T0, status: 'SUCCESS' },
    });

    dbSourceId = dbSource.id;
    dbRunId = dbRun.id;
    apiSourceId = apiSource.id;
    apiRunId = apiRun.id;
  });

  async function createBatch(batchId: string) {
    const workOrder = await prisma.workOrder.create({
      data: { workOrderId: `WO-${batchId}`, lineId: 'LINE-1' },
    });
    await prisma.batch.create({
      data: { batchId, workOrderId: workOrder.id },
    });
  }

  async function acceptReceiving(batchId: string, eventTime: Date) {
    await canonicalizationService.ingestAndRecompute({
      sourceId: dbSourceId,
      collectionRunId: dbRunId,
      sourceRecordId: `${batchId}-RECEIVING`,
      batchId,
      station: 'RECEIVING',
      quantity: 100,
      eventTime,
      receivedAt: eventTime,
    });
  }

  // Same-tier (DATABASE + API, both Tier 1) disagreeing DISPATCH values at
  // the same eventTime -> Rule 5.4 CONFLICT. Mirrors
  // collection-runs.e2e-spec.ts's B006 setup exactly.
  async function createDispatchConflict(batchId: string, eventTime: Date) {
    await canonicalizationService.ingestAndRecompute({
      sourceId: dbSourceId,
      collectionRunId: dbRunId,
      sourceRecordId: `${batchId}-DISPATCH-DB`,
      batchId,
      station: 'DISPATCH',
      quantity: 500,
      eventTime,
      receivedAt: eventTime,
    });
    await canonicalizationService.ingestAndRecompute({
      sourceId: apiSourceId,
      collectionRunId: apiRunId,
      sourceRecordId: `${batchId}-DISPATCH-API`,
      batchId,
      station: 'DISPATCH',
      quantity: 480,
      eventTime,
      receivedAt: eventTime,
    });
  }

  // --- All 4 actions write a properly-shaped, append-only row -----------

  describe('all 4 actions write a properly-shaped row', () => {
    let created: Record<
      'BLOCK' | 'RESUME' | 'ACK_EXCEPTION' | 'ADD_NOTE',
      ManagementEventRow
    >;

    beforeEach(async () => {
      await createBatch('B940');
      const blockRes = await request(app.getHttpServer())
        .post('/management-events/block')
        .send({ batchId: 'B940', actor: 'ops-1' })
        .expect(201);
      const resumeRes = await request(app.getHttpServer())
        .post('/management-events/resume')
        .send({ batchId: 'B940', actor: 'ops-1' })
        .expect(201);
      const noteRes = await request(app.getHttpServer())
        .post('/management-events/note')
        .send({ batchId: 'B940', actor: 'ops-1', note: 'inspected batch' })
        .expect(201);

      await createBatch('B941');
      await createDispatchConflict('B941', T0);
      const ackRes = await request(app.getHttpServer())
        .post('/management-events/ack-exception')
        .send({ batchId: 'B941', actor: 'ops-2' })
        .expect(201);

      created = {
        BLOCK: blockRes.body as ManagementEventRow,
        RESUME: resumeRes.body as ManagementEventRow,
        ACK_EXCEPTION: ackRes.body as ManagementEventRow,
        ADD_NOTE: noteRes.body as ManagementEventRow,
      };
    });

    it.each(['BLOCK', 'RESUME', 'ACK_EXCEPTION', 'ADD_NOTE'] as const)(
      '%s row has organizationId/actor/timestamp',
      (action) => {
        const row = created[action];
        expect(row.action).toBe(action);
        expect(row.organizationId).toBe(SEED_ORGANIZATION_ID);
        expect(row.actor).toBeTruthy();
        expect(row.timestamp).toBeTruthy();
      },
    );
  });

  // --- ACK_EXCEPTION on B006: status stays CONFLICT, only acknowledged flips ---

  it('B006: ACK_EXCEPTION leaves canonical_event.status CONFLICT, only flips quality indicator acknowledged', async () => {
    await createBatch('B006');
    await createDispatchConflict('B006', T0);

    const before = await productionDomainService.getBatchStatus(
      'B006',
      new Date(T0.getTime() + 60_000),
    );
    expect(before.qualityIndicators).toHaveLength(1);
    expect(before.qualityIndicators[0].code).toBe('DISPATCH_CONFLICT');
    expect(before.qualityIndicators[0].acknowledged).toBe(false);

    await request(app.getHttpServer())
      .post('/management-events/ack-exception')
      .send({ batchId: 'B006', actor: 'ops-1' })
      .expect(201);

    const canonicalDispatch = await prisma.canonicalEvent.findUniqueOrThrow({
      where: { canonicalKey: 'B006:DISPATCH' },
    });
    expect(canonicalDispatch.status).toBe('CONFLICT');

    const after = await productionDomainService.getBatchStatus(
      'B006',
      new Date(T0.getTime() + 120_000),
    );
    expect(after.qualityIndicators).toHaveLength(1);
    expect(after.qualityIndicators[0].acknowledged).toBe(true);
    expect(after.state).not.toBe('COMPLETED');
  });

  it('ack-exception is rejected when the batch has no CONFLICT canonical event', async () => {
    await createBatch('B942');
    await acceptReceiving('B942', T0);

    await request(app.getHttpServer())
      .post('/management-events/ack-exception')
      .send({ batchId: 'B942', actor: 'ops-1' })
      .expect(400);
  });

  // --- BLOCK: state becomes BLOCKED even with an accepted upstream event ---

  it('BLOCK: batch state becomes BLOCKED even with an accepted event upstream', async () => {
    await createBatch('B950');
    await acceptReceiving('B950', T0);

    const before = await productionDomainService.getBatchStatus(
      'B950',
      new Date(T0.getTime() + 60_000),
    );
    expect(before.state).toBe('IN_PROGRESS');

    await request(app.getHttpServer())
      .post('/management-events/block')
      .send({ batchId: 'B950', actor: 'ops-1' })
      .expect(201);

    const after = await productionDomainService.getBatchStatus(
      'B950',
      new Date(T0.getTime() + 120_000),
    );
    expect(after.state).toBe('BLOCKED');
  });

  it('resume is rejected when the batch is not currently blocked', async () => {
    await createBatch('B951');

    await request(app.getHttpServer())
      .post('/management-events/resume')
      .send({ batchId: 'B951', actor: 'ops-1' })
      .expect(400);
  });

  // --- RESUME after BLOCK -> state per Rule 7 -----------------------------

  describe('resume after block', () => {
    it.each([
      {
        name: 'batch has an accepted event -> IN_PROGRESS after resume',
        seedEvent: true,
        expected: 'IN_PROGRESS',
      },
      {
        name: 'batch has no event at all -> PLANNED after resume',
        seedEvent: false,
        expected: 'PLANNED',
      },
    ])('$name', async ({ seedEvent, expected }) => {
      const batchId = seedEvent ? 'B960' : 'B961';
      await createBatch(batchId);
      if (seedEvent) {
        await acceptReceiving(batchId, T0);
      }

      // Inserted directly with a fixed, clearly-earlier timestamp rather
      // than through the HTTP endpoint here — avoids a real race on
      // wall-clock timestamps between this setup BLOCK and the RESUME call
      // under test. batch-state.ts's resolveIsBlocked (Step 4, unchanged)
      // treats a same-millisecond RESUME as still-blocked (its own
      // documented tie-break) — that's existing pure-function behavior to
      // respect, not something to paper over by weakening this test.
      await prisma.managementEvent.create({
        data: {
          organizationId: SEED_ORGANIZATION_ID,
          batchId,
          actor: 'ops-1',
          action: 'BLOCK',
          timestamp: T0,
        },
      });

      const blockedStatus = await productionDomainService.getBatchStatus(
        batchId,
        new Date(T0.getTime() + 60_000),
      );
      expect(blockedStatus.state).toBe('BLOCKED');

      await request(app.getHttpServer())
        .post('/management-events/resume')
        .send({ batchId, actor: 'ops-1' })
        .expect(201);

      const status = await productionDomainService.getBatchStatus(
        batchId,
        new Date(T0.getTime() + 120_000),
      );
      expect(status.state).toBe(expected);
    });
  });

  // --- Add note: requires non-empty note, no batch-state side effect -----

  it('note is rejected when empty/missing', async () => {
    await createBatch('B970');

    await request(app.getHttpServer())
      .post('/management-events/note')
      .send({ batchId: 'B970', actor: 'ops-1', note: '   ' })
      .expect(400);
  });

  // --- Append-only: no update/delete route exists -------------------------

  it.each([
    { method: 'put' as const },
    { method: 'patch' as const },
    { method: 'delete' as const },
  ])(
    '$method /management-events/block has no route (append-only)',
    async ({ method }) => {
      const req = request(app.getHttpServer());
      const res =
        method === 'put'
          ? await req.put('/management-events/block')
          : method === 'patch'
            ? await req.patch('/management-events/block')
            : await req.delete('/management-events/block');
      expect(res.status).toBe(404);
    },
  );
});
