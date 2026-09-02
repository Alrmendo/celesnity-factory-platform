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
import { PrismaService } from '../src/prisma/prisma.service';
import { buildBatchScenarios } from '../test/fixtures/batch-scenarios';

const SEED_ORGANIZATION_ID = 'org-seed';

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

    console.log(`Seeded ${Object.keys(scenarios).length} batch scenarios.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
