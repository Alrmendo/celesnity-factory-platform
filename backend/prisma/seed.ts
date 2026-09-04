// Manual dev-data seed — Step 5. Not run automatically, not used by any
// test. Ingests all 10 fixture scenarios (same builder as the integration
// suite, backend/test/fixtures/batch-scenarios.ts) into whatever DB
// DATABASE_URL points at. Does NOT truncate first — this is a one-off
// script for a fresh dev DB, re-running it against already-seeded data will
// fail on unique constraints (work_order_id/batch_id), which is expected.
//
// Run with: npm run seed

import 'dotenv/config';
import { CanonicalizationService } from '../src/modules/canonicalization/canonicalization.service';
import { SEED_ORGANIZATION_ID } from '../src/modules/management-events/constants';
import { PrismaService } from '../src/prisma/prisma.service';
import { buildBatchScenarios } from '../test/fixtures/batch-scenarios';

async function main(): Promise<void> {
  const prisma = new PrismaService();
  await prisma.$connect();

  try {
    const canonicalizationService = new CanonicalizationService(prisma);
    const scenarios = await buildBatchScenarios(prisma);

    for (const fixture of Object.values(scenarios)) {
      await canonicalizationService.ingestBatch(fixture.sourceRecords);
      if (fixture.managementEvents.length > 0) {
        await prisma.managementEvent.createMany({
          data: fixture.managementEvents.map((event) => ({
            ...event,
            organizationId: SEED_ORGANIZATION_ID,
          })),
        });
      }
    }

    // A real, working CRAWLER Source for manual UI testing (Step 11's Data
    // Sources view) — buildBatchScenarios() above never creates one (only
    // DATABASE "Production Database" and API "Application API", both with
    // config: {}, which aren't wired for Verify/Discover either). baseUrl
    // is the FIXED Docker-network hostname:port (`supplier-portal:4200`,
    // matching fixture-api's `fixture-api:4000` pattern in
    // docker-compose.yml — the container's own listening port, not the
    // 4300 host-side remap) — never an ephemeral 127.0.0.1 port. Without
    // this, the only "Supplier Portal"-named Source anyone would ever see
    // was one leaked into the DB by crawler-collector.e2e-spec.ts's
    // in-process test server (baseUrl 127.0.0.1:<ephemeral>, dead the
    // moment that test run ends) — see README's "Step 11 — bổ sung" entry
    // for the real "fetch failed" bug this caused.
    await prisma.source.create({
      data: {
        name: 'Supplier Portal',
        type: 'CRAWLER',
        config: { baseUrl: 'http://supplier-portal:4200' },
      },
    });

    console.log(`Seeded ${Object.keys(scenarios).length} batch scenarios.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
