// Integration test — Step 8, runs against a REAL Postgres, same as every
// other *.e2e-spec.ts file (see batch-lifecycle.e2e-spec.ts's header
// comment). Spins up the Step 8 supplier-portal fixture ("Supplier Portal"
// mock, supplier-portal/server.js) IN-PROCESS on a random port via plain
// Node `require`, same pattern collection-runs.e2e-spec.ts uses for
// fixture-api — supplier-portal is a zero-dependency CommonJS script
// specifically so it can be started this way, without Docker, wherever
// Postgres itself is reachable. `jest-e2e.json`'s maxWorkers: 1 keeps this
// file from interleaving with the other e2e files against the shared
// `postgres` DB (see test/fixtures/db-utils.ts).

import { Test, TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'net';
import type { Server as HttpServer } from 'http';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { CollectionRunsService } from '../src/modules/collection-runs/collection-runs.service';
import { ProductionDomainService } from '../src/modules/production-domain/production-domain.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { truncateAll } from './fixtures/db-utils';

// supplier-portal is plain JS with no TS types of its own (see its file
// header) — required directly rather than imported so backend's "nodenext"
// module resolution never has to resolve it as a TS/ESM module. Same
// pattern as collection-runs.e2e-spec.ts's fixtureApiServer require.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const supplierPortalServer = require('../../supplier-portal/server') as {
  createServer: (options?: { faultMode?: string }) => HttpServer;
};

function crawlerConfig(
  baseUrl: string,
  fault?: string,
): Record<string, unknown> {
  const config: Record<string, unknown> = { baseUrl };
  if (fault) {
    config.fault = fault;
  }
  return config;
}

describe('Supplier crawler: register/verify/discover/collect (Step 8, real Postgres)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let collectionRunsService: CollectionRunsService;
  let productionDomainService: ProductionDomainService;
  let portalServer: HttpServer;
  let portalBaseUrl: string;

  beforeAll(async () => {
    portalServer = supplierPortalServer.createServer();
    await new Promise<void>((resolve) => portalServer.listen(0, resolve));
    const address = portalServer.address() as AddressInfo;
    portalBaseUrl = `http://127.0.0.1:${address.port}`;

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    collectionRunsService = app.get(CollectionRunsService);
    productionDomainService = app.get(ProductionDomainService);
  });

  afterAll(async () => {
    // Without this, the last test's `createCrawlerSource()` row (name
    // "Supplier Portal (fixture)", baseUrl http://127.0.0.1:<ephemeral
    // port>) survives past this suite — beforeEach only truncates BEFORE
    // each test, never after the last one. `portalServer` is closed right
    // after, so that baseUrl becomes permanently dead; a stray row exactly
    // like this is what showed up as a real "fetch failed" in the UI when
    // someone later browsed the dev DB (see README's "Step 11 — bổ sung"
    // entry for the full incident).
    await truncateAll(prisma);
    await app.close();
    await new Promise<void>((resolve) => portalServer.close(() => resolve()));
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  async function createCrawlerSource(fault?: string) {
    return prisma.source.create({
      data: {
        name: 'Supplier Portal (fixture)',
        type: 'CRAWLER',
        config: crawlerConfig(portalBaseUrl, fault) as Prisma.InputJsonValue,
      },
    });
  }

  // B002 is the fixture table's own RECEIVING scenario (see
  // batch-scenarios.ts: "single ACCEPTED at RECEIVING -> IN_PROGRESS") —
  // reused rather than inventing a new batch id, per the task instructions.
  async function createB002Batch() {
    const workOrder = await prisma.workOrder.create({
      data: { workOrderId: 'WO-B002', lineId: 'LINE-1' },
    });
    await prisma.batch.create({
      data: { batchId: 'B002', workOrderId: workOrder.id },
    });
  }

  // --- Register + verify --------------------------------------------------

  it.each([
    {
      name: 'reachable portal',
      buildConfig: () => crawlerConfig(portalBaseUrl),
      expectSuccess: true,
    },
    {
      name: 'unreachable portal',
      buildConfig: () => crawlerConfig('http://127.0.0.1:1'),
      expectSuccess: false,
    },
  ])(
    'verify connection ($name) -> $expectSuccess',
    async ({ buildConfig, expectSuccess }) => {
      const source = await prisma.source.create({
        data: {
          name: 'Supplier Portal (verify test)',
          type: 'CRAWLER',
          config: buildConfig() as Prisma.InputJsonValue,
        },
      });

      const res = await request(app.getHttpServer()).post(
        `/sources/${source.id}/verify`,
      );

      if (expectSuccess) {
        expect(res.status).toBe(201);
        const body = res.body as { verifiedAt: string | null };
        expect(body.verifiedAt).not.toBeNull();
      } else {
        expect(res.status).toBeGreaterThanOrEqual(400);
        const stored = await prisma.source.findUniqueOrThrow({
          where: { id: source.id },
        });
        expect(stored.verifiedAt).toBeNull();
      }
    },
    10000,
  );

  // --- Discover (task instructions: reachable + total page count) --------

  it('discover reports the feed is reachable with its real total page count', async () => {
    const source = await createCrawlerSource();

    const res = await request(app.getHttpServer())
      .get(`/sources/${source.id}/discover`)
      .expect(200);

    expect(res.body).toEqual({ reachable: true, totalPages: 2 });
  });

  // --- Crawl N valid pages -------------------------------------------------

  it('crawls all valid pages -> one source_record per row, across pages', async () => {
    await createB002Batch();
    const source = await createCrawlerSource();

    const run = await collectionRunsService.runCollection(source.id);

    expect(run.status).toBe('SUCCESS');
    // supplier-portal's "none" fixture: 2 rows on page 1, 1 row on page 2.
    expect(run.recordsRead).toBe(3);
    expect(run.errorCount).toBe(0);

    const sourceRecords = await prisma.sourceRecord.findMany({
      where: { sourceId: source.id },
    });
    expect(sourceRecords.length).toBe(3);
    expect(sourceRecords.every((r) => r.station === 'RECEIVING')).toBe(true);
  });

  // --- Malformed row handling -----------------------------------------

  it('skips a malformed row (invalid quantity) without failing the run; other rows on the same page are still collected', async () => {
    await createB002Batch();
    const source = await createCrawlerSource('malformed');

    const run = await collectionRunsService.runCollection(source.id);

    // The task requirement is explicit: a malformed row must not fail the
    // whole collection run.
    expect(run.status).toBe('SUCCESS');
    // 3 rows on the fixture's "malformed" page, 1 is malformed -> 2 valid.
    expect(run.recordsRead).toBe(2);
    expect(run.errorCount).toBe(1);
    expect(run.errorMessage).toContain('malformed row');
    expect(run.errorMessage).toContain('invalid quantity');

    const sourceRecords = await prisma.sourceRecord.findMany({
      where: { sourceId: source.id },
    });
    expect(sourceRecords.length).toBe(2);
  });

  // --- Pagination loop protection -----------------------------------------

  it('detects a real pagination loop and stops instead of crawling forever; run ends FAILED, nothing ingested', async () => {
    await createB002Batch();
    const source = await createCrawlerSource('loop');

    const run = await collectionRunsService.runCollection(source.id);

    // Design decision (see collection-runs.service.ts's
    // runCrawlerCollection comment): a loop means the crawl can't be
    // trusted as complete, so — consistent with every other FAILED run in
    // this service — nothing gathered before the loop was detected gets
    // ingested.
    expect(run.status).toBe('FAILED');
    expect(run.recordsRead).toBe(0);
    expect(run.errorMessage).toContain('pagination loop');

    const sourceRecords = await prisma.sourceRecord.findMany({
      where: { sourceId: source.id },
    });
    expect(sourceRecords.length).toBe(0);

    // The failure must not have crashed the app.
    await request(app.getHttpServer()).get('/health').expect(200);
  });

  // --- RECEIVING scenario end-to-end (B002) -------------------------------

  it('B002: crawler-collected RECEIVING -> real ACCEPTED canonical event, batch IN_PROGRESS', async () => {
    await createB002Batch();
    const source = await createCrawlerSource();

    const run = await collectionRunsService.runCollection(source.id);
    expect(run.status).toBe('SUCCESS');

    const canonicalReceiving = await prisma.canonicalEvent.findUniqueOrThrow({
      where: { canonicalKey: 'B002:RECEIVING' },
    });
    expect(canonicalReceiving.status).toBe('ACCEPTED');
    expect(canonicalReceiving.quantity.toNumber()).toBe(100);

    const status = await productionDomainService.getBatchStatus(
      'B002',
      new Date('2026-01-01T00:10:00.000Z'),
    );
    expect(status.state).toBe('IN_PROGRESS');
    expect(status.currentStation).toBe('RECEIVING');
  });
});
