// Integration test — Step 6, runs against a REAL Postgres, same as
// batch-lifecycle.e2e-spec.ts (see that file's header comment). Additionally
// spins up the Step 6 fixture-api ("Application API" mock,
// fixture-api/server.js) IN-PROCESS on a random port via plain Node
// `require` — fixture-api is a zero-dependency CommonJS script specifically
// so it can be started this way, without Docker, wherever Postgres itself
// is reachable. `jest-e2e.json` pins maxWorkers to 1 so this file and
// batch-lifecycle.e2e-spec.ts never interleave against the same DB (both
// truncate the same tables in their own beforeEach) — see
// test/fixtures/db-utils.ts.

import { Test, TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'net';
import type { Server as HttpServer } from 'http';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { CanonicalizationService } from '../src/modules/canonicalization/canonicalization.service';
import { CollectionRunsService } from '../src/modules/collection-runs/collection-runs.service';
import { ProductionDomainService } from '../src/modules/production-domain/production-domain.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { T0 } from './fixtures/batch-scenarios';
import { truncateAll } from './fixtures/db-utils';

// fixture-api is plain JS with no TS types of its own (see its file header)
// — required directly rather than imported so backend's "nodenext" module
// resolution never has to resolve it as a TS/ESM module.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fixtureApiServer = require('../../fixture-api/server') as {
  createServer: (options?: {
    apiKey?: string;
    faultMode?: string;
    timeoutDelayMs?: number;
  }) => HttpServer;
};

const FIXTURE_API_KEY_ENV_VAR = 'FIXTURE_API_KEY';

function sourceConfig(
  baseUrl: string,
  fault?: string,
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    baseUrl,
    apiKeyEnvVar: FIXTURE_API_KEY_ENV_VAR,
  };
  if (fault) {
    config.fault = fault;
  }
  return config;
}

describe('Collector fault injection + secret handling (Step 6, real Postgres)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let canonicalizationService: CanonicalizationService;
  let collectionRunsService: CollectionRunsService;
  let productionDomainService: ProductionDomainService;
  let fixtureServer: HttpServer;
  let fixtureApiBaseUrl: string;

  const RUN_TEST_API_KEY = 'test-fixture-secret-for-retry-tests-do-not-log';

  beforeAll(async () => {
    process.env[FIXTURE_API_KEY_ENV_VAR] = RUN_TEST_API_KEY;

    fixtureServer = fixtureApiServer.createServer({
      apiKey: RUN_TEST_API_KEY,
    });
    await new Promise<void>((resolve) => fixtureServer.listen(0, resolve));
    const address = fixtureServer.address() as AddressInfo;
    fixtureApiBaseUrl = `http://127.0.0.1:${address.port}`;

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    canonicalizationService = app.get(CanonicalizationService);
    collectionRunsService = app.get(CollectionRunsService);
    productionDomainService = app.get(ProductionDomainService);
  });

  afterAll(async () => {
    // Same leak this suite would otherwise cause as
    // crawler-collector.e2e-spec.ts's "Supplier Portal (fixture)" (see that
    // file's afterAll comment) — the last test's Source row (e.g.
    // "Application API (fixture)"/"Application API (secret regression
    // test)") points at fixtureServer's ephemeral 127.0.0.1 port, which is
    // about to close below and never listen again.
    await truncateAll(prisma);
    await app.close();
    await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  async function createFixtureSource(fault?: string) {
    return prisma.source.create({
      data: {
        name: 'Application API (fixture)',
        type: 'API',
        config: sourceConfig(fixtureApiBaseUrl, fault) as Prisma.InputJsonValue,
      },
    });
  }

  // --- Fault injection / retry (docs/plan-v4.md §6) --------------------

  const faultScenarios = [
    {
      name: '500 once then success',
      fault: '500-once',
      expectedStatus: 'SUCCESS' as const,
    },
    {
      name: '500 always',
      fault: '500-always',
      expectedStatus: 'FAILED' as const,
    },
  ];

  it.each(faultScenarios)(
    '$name -> collection run ends $expectedStatus',
    async ({ fault, expectedStatus }) => {
      const source = await createFixtureSource(fault);
      const run = await collectionRunsService.runCollection(source.id);

      expect(run.status).toBe(expectedStatus);

      if (expectedStatus === 'FAILED') {
        expect(run.errorMessage).toBeTruthy();
        expect(run.errorCount).toBeGreaterThan(0);
        expect(run.recordsRead).toBe(0);

        // The rest of the app must still work — the failure must not have
        // crashed the Nest process or left it in a broken state.
        await request(app.getHttpServer()).get('/health').expect(200);
      } else {
        expect(run.recordsRead).toBeGreaterThan(0);
        // 500-once means exactly 1 failed attempt before the success.
        expect(run.errorCount).toBe(1);
      }
    },
  );

  // --- Secret regression (docs/plan-v4.md §6) ---------------------------

  describe('secret regression', () => {
    // Reuses the same key the shared fixture-api instance was started with
    // (RUN_TEST_API_KEY, from the outer beforeAll) rather than a separate
    // value — that instance's accepted key is fixed at creation, so a
    // different key here would make every collection run in this block
    // fail with a real 401 (wrong credentials), AND — since
    // process.env.FIXTURE_API_KEY is process-global — leak into whichever
    // test runs next in this file (the B006 test below) with no way to
    // restore it. Reusing the same key sidesteps both problems entirely.
    let postSourcesBody: unknown;
    let getSourceBody: unknown;
    let getRunBody: unknown;
    let logOutput: string;

    beforeEach(async () => {
      const logChunks: string[] = [];
      const stdoutSpy = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk: unknown) => {
          logChunks.push(String(chunk));
          return true;
        });
      const stderrSpy = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation((chunk: unknown) => {
          logChunks.push(String(chunk));
          return true;
        });

      try {
        const sourceRes = await request(app.getHttpServer())
          .post('/sources')
          .send({
            name: 'Application API (secret regression test)',
            type: 'API',
            config: {
              baseUrl: fixtureApiBaseUrl,
              apiKeyEnvVar: FIXTURE_API_KEY_ENV_VAR,
              // Deliberately-misconfigured literal secret value — a correct
              // integration never puts this here (config should only ever
              // hold the *name* of the env var, see
              // collection-runs/types.ts's FixtureApiSourceConfig). Included
              // on purpose so this test proves sanitizeSourceConfig's
              // redaction actually does something, not just that the
              // happy-path integration "chooses" not to store the secret.
              apiKey: RUN_TEST_API_KEY,
              fault: '500-once',
            },
          });
        postSourcesBody = sourceRes.body as unknown;

        const sourceId = (sourceRes.body as { id: string }).id;
        const getSourceRes = await request(app.getHttpServer()).get(
          `/sources/${sourceId}`,
        );
        getSourceBody = getSourceRes.body as unknown;

        const runRes = await request(app.getHttpServer())
          .post('/collection-runs')
          .send({ sourceId });
        const runId = (runRes.body as { id: string }).id;

        const getRunRes = await request(app.getHttpServer()).get(
          `/collection-runs/${runId}`,
        );
        getRunBody = getRunRes.body as unknown;
      } finally {
        stdoutSpy.mockRestore();
        stderrSpy.mockRestore();
      }

      logOutput = logChunks.join('\n');
    });

    it.each([
      { name: 'POST /sources response', getBody: () => postSourcesBody },
      { name: 'GET /sources/:id response', getBody: () => getSourceBody },
      {
        name: 'GET /collection-runs/:id response',
        getBody: () => getRunBody,
      },
    ])('secret does not appear in $name', ({ getBody }) => {
      expect(JSON.stringify(getBody())).not.toContain(RUN_TEST_API_KEY);
    });

    it('secret does not appear in application logs from the collection run', () => {
      expect(logOutput).not.toContain(RUN_TEST_API_KEY);
    });
  });

  // --- B006 end-to-end through the real collector -----------------------

  it('B006: Application API (real collector) + Production DB, same tier, disagreeing values at the same eventTime -> real CONFLICT, not auto-resolved', async () => {
    const dispatchEventTime = new Date(T0.getTime() + 5 * 60_000);

    const workOrder = await prisma.workOrder.create({
      data: { workOrderId: 'WO-B006', lineId: 'LINE-1' },
    });
    await prisma.batch.create({
      data: { batchId: 'B006', workOrderId: workOrder.id },
    });

    // Production DB side — Step 7's real DB collector doesn't exist yet, so
    // this direct-insert mirrors batch-scenarios.ts's B006 fixture exactly
    // (quantity 500, same eventTime), simulating "the Production DB
    // collector already ran".
    const dbSource = await prisma.source.create({
      data: { name: 'Production Database', type: 'DATABASE', config: {} },
    });
    const dbRun = await prisma.collectionRun.create({
      data: { sourceId: dbSource.id, startedAt: T0, status: 'SUCCESS' },
    });
    await canonicalizationService.ingestAndRecompute({
      sourceId: dbSource.id,
      collectionRunId: dbRun.id,
      sourceRecordId: 'B006-DISPATCH-DB',
      batchId: 'B006',
      station: 'DISPATCH',
      quantity: 500,
      eventTime: dispatchEventTime,
      receivedAt: dispatchEventTime,
    });

    // Application API side — the REAL collector, over real HTTP to the
    // (in-process) fixture-api, exercising CollectionRunsService end to
    // end. fixture-api's built-in B006 entry is quantity 480, same
    // eventTime (see fixture-api/server.js) — same tier (Rule 4), disagreeing
    // value, same moment -> Rule 5.4 CONFLICT.
    const apiSource = await createFixtureSource();
    const run = await collectionRunsService.runCollection(apiSource.id);
    expect(run.status).toBe('SUCCESS');

    const canonicalDispatch = await prisma.canonicalEvent.findUniqueOrThrow({
      where: { canonicalKey: 'B006:DISPATCH' },
    });
    expect(canonicalDispatch.status).toBe('CONFLICT');

    const status = await productionDomainService.getBatchStatus(
      'B006',
      new Date(dispatchEventTime.getTime() + 5 * 60_000),
    );
    expect(status.state).not.toBe('COMPLETED');
    expect(status.qualityIndicators).toHaveLength(1);
    expect(status.qualityIndicators[0].code).toBe('DISPATCH_CONFLICT');
    expect(status.qualityIndicators[0].acknowledged).toBe(false);
  });
});
