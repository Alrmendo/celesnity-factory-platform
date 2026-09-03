// Shared by every *.e2e-spec.ts file that touches the real Postgres DB.
// Extracted in Step 6 when a second DB-touching spec file
// (collection-runs.e2e-spec.ts) was added alongside batch-lifecycle's —
// both need the exact same table list, and jest-e2e.json now pins
// maxWorkers to 1 (see its comment) specifically so these files run
// strictly sequentially: each file's own beforeEach truncates before every
// test, which only isolates test state correctly if no other file's tests
// can interleave and observe/wipe it mid-run.
import { PrismaService } from '../../src/prisma/prisma.service';

export async function truncateAll(prisma: PrismaService): Promise<void> {
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
