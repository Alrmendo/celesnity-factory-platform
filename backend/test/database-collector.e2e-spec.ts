// Integration test — Step 7, runs against TWO real Postgres instances:
// this app's own `postgres` (same as every other *.e2e-spec.ts file — see
// batch-lifecycle.e2e-spec.ts's header comment) AND the separate
// `production-db` docker-compose service (docs: docker-compose.yml, Step 7
// note; production-db/init.sql seeds it). Unlike fixture-api in Step 6,
// production-db is a REAL Postgres server, not a zero-dependency script —
// it can't be spun up in-process, so this file genuinely requires
// `docker compose up` to have started `production-db` first. Host-side
// port 5434 (docker-compose.yml maps "5434:5432"); credentials/DB name
// default to production-db/init.sql's seed (`prod_reader` /
// `PRODUCTION_DB_PASSWORD` env var / `production`) — override via env if
// `.env`'s PRODUCTION_DB_USER/PRODUCTION_DB_NAME were changed from
// defaults. `jest-e2e.json`'s maxWorkers: 1 keeps this file from
// interleaving with the other e2e files against the shared `postgres` DB
// (see test/fixtures/db-utils.ts).

import { Test, TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { CollectionRunsService } from '../src/modules/collection-runs/collection-runs.service';
import type { DatabaseSourceConfig } from '../src/modules/collection-runs/database-source-client';
import { PrismaService } from '../src/prisma/prisma.service';
import { truncateAll } from './fixtures/db-utils';

const PRODUCTION_DB_HOST = process.env.PRODUCTION_DB_TEST_HOST ?? 'localhost';
const PRODUCTION_DB_PORT = Number(process.env.PRODUCTION_DB_TEST_PORT ?? 5434);
const PRODUCTION_DB_NAME = process.env.PRODUCTION_DB_NAME ?? 'production';
const PRODUCTION_DB_USER = process.env.PRODUCTION_DB_USER ?? 'prod_reader';
const PRODUCTION_DB_PASSWORD_ENV_VAR = 'PRODUCTION_DB_PASSWORD';

function validDbSourceConfig(): DatabaseSourceConfig {
  return {
    host: PRODUCTION_DB_HOST,
    port: PRODUCTION_DB_PORT,
    database: PRODUCTION_DB_NAME,
    user: PRODUCTION_DB_USER,
    passwordEnvVar: PRODUCTION_DB_PASSWORD_ENV_VAR,
  };
}

describe('Database collector: register/verify/discover/select/collect (Step 7, real Postgres x2)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let collectionRunsService: CollectionRunsService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    collectionRunsService = app.get(CollectionRunsService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  async function createDbSource(config: DatabaseSourceConfig) {
    return prisma.source.create({
      data: {
        name: 'Production Database (fixture)',
        type: 'DATABASE',
        config: config as unknown as Prisma.InputJsonValue,
      },
    });
  }

  // --- Register + verify (docs/plan-v4.md ground truth; task spec's
  // "Register and verify the database connection before use") -----------

  it.each([
    {
      name: 'valid credentials',
      buildConfig: () => validDbSourceConfig(),
      expectSuccess: true,
    },
    {
      name: 'wrong password',
      buildConfig: () => {
        process.env.PRODUCTION_DB_TEST_WRONG_PASSWORD = 'definitely-wrong';
        return {
          ...validDbSourceConfig(),
          passwordEnvVar: 'PRODUCTION_DB_TEST_WRONG_PASSWORD',
        };
      },
      expectSuccess: false,
    },
  ])(
    'verify connection ($name) -> $expectSuccess',
    async ({ buildConfig, expectSuccess }) => {
      const source = await createDbSource(buildConfig());

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
  );

  // --- Discover (task spec's "Discover available tables and columns") ---

  it('discover returns the real tables/columns from production-db (not hardcoded)', async () => {
    const source = await createDbSource(validDbSourceConfig());

    const res = await request(app.getHttpServer())
      .get(`/sources/${source.id}/discover`)
      .expect(200);

    const tables = res.body as {
      table: string;
      columns: { name: string; dataType: string }[];
    }[];
    const byName = Object.fromEntries(tables.map((t) => [t.table, t]));

    // More than one table -- proves "select ONE table" is a real choice,
    // not the only option available.
    expect(Object.keys(byName).length).toBeGreaterThanOrEqual(3);
    expect(byName).toHaveProperty('station_readings');
    expect(byName).toHaveProperty('machines');
    expect(byName).toHaveProperty('employees');

    const stationReadingsColumns = byName.station_readings.columns.map(
      (c) => c.name,
    );
    expect(stationReadingsColumns).toEqual(
      expect.arrayContaining([
        'id',
        'batch_id',
        'station',
        'quantity',
        'event_time',
      ]),
    );
  });

  // --- Select + collect (task spec's "Select a production table for
  // collection" / "Collect records from the selected table") ------------

  it('select station_readings then collect -> real source_records + canonical_events via ingestBatch()', async () => {
    const source = await createDbSource(validDbSourceConfig());

    await request(app.getHttpServer())
      .post(`/sources/${source.id}/select`)
      .send({ table: 'station_readings' })
      .expect(201);

    const run = await collectionRunsService.runCollection(source.id);
    expect(run.status).toBe('SUCCESS');
    expect(run.recordsRead).toBeGreaterThan(0);

    // production-db/init.sql seeds PDB-B001 WASHING=98 -- assert the real
    // canonical_events row ingestBatch() produced, not just the run status.
    const canonicalWashing = await prisma.canonicalEvent.findUniqueOrThrow({
      where: { canonicalKey: 'PDB-B001:WASHING' },
    });
    expect(canonicalWashing.status).toBe('ACCEPTED');
    expect(canonicalWashing.quantity.toNumber()).toBe(98);

    const sourceRecords = await prisma.sourceRecord.findMany({
      where: { sourceId: source.id },
    });
    expect(sourceRecords.length).toBe(run.recordsRead);
  });

  it('collect without a prior select -> FAILED, does not crash the app', async () => {
    const source = await createDbSource(validDbSourceConfig());

    await expect(
      collectionRunsService.runCollection(source.id),
    ).rejects.toThrow();

    await request(app.getHttpServer()).get('/health').expect(200);
  });

  // --- Secret regression (same pattern as Step 6's collection-runs.e2e-spec.ts) ---

  describe('secret regression (DATABASE source)', () => {
    let postSourcesBody: unknown;
    let getSourceBody: unknown;
    let getRunBody: unknown;
    let logOutput: string;

    beforeEach(async () => {
      const realPassword = process.env[PRODUCTION_DB_PASSWORD_ENV_VAR];
      if (!realPassword) {
        throw new Error(
          `${PRODUCTION_DB_PASSWORD_ENV_VAR} must be set to run this test`,
        );
      }

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
            name: 'Production Database (secret regression test)',
            type: 'DATABASE',
            config: {
              ...validDbSourceConfig(),
              // Deliberately-misconfigured literal secret value, same
              // rationale as Step 6's equivalent test: proves
              // sanitizeSourceConfig's redaction fires, not just that the
              // happy path "chooses" not to store the secret.
              password: realPassword,
            },
          });
        postSourcesBody = sourceRes.body as unknown;

        const sourceId = (sourceRes.body as { id: string }).id;
        const getSourceRes = await request(app.getHttpServer()).get(
          `/sources/${sourceId}`,
        );
        getSourceBody = getSourceRes.body as unknown;

        await request(app.getHttpServer())
          .post(`/sources/${sourceId}/select`)
          .send({ table: 'station_readings' });

        const run = await collectionRunsService.runCollection(sourceId);
        const getRunRes = await request(app.getHttpServer()).get(
          `/collection-runs/${run.id}`,
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
      const realPassword = process.env[PRODUCTION_DB_PASSWORD_ENV_VAR] ?? '';
      expect(JSON.stringify(getBody())).not.toContain(realPassword);
    });

    it('secret does not appear in application logs', () => {
      const realPassword = process.env[PRODUCTION_DB_PASSWORD_ENV_VAR] ?? '';
      expect(logOutput).not.toContain(realPassword);
    });
  });
});
