import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductionDomainService } from './production-domain.service';
import { STATION_ORDER } from './station-order';
import { BatchStatusResult } from './types';

const DEFAULT_STALE_THRESHOLD_MINUTES = 15;

interface BatchLineView extends BatchStatusResult {
  workOrderId: string;
  // Real ISO timestamp of the canonical_event currently sitting at
  // currentStation — distinct from freshnessMinutes (Step 4/5's
  // calculateFreshness, unchanged: latest ACCEPTED eventTime across ALL
  // stations for the batch, which can be a different, earlier-in-line
  // station's event — see batch-state.ts's B004-style comment). The UI
  // needs both: this for "updated at <absolute time>", freshnessMinutes/
  // freshnessStatus for "how stale". null when currentStation is null
  // (nothing recorded yet — PLANNED).
  lastEventAt: Date | null;
  // "Links to the contributing source records and collection run" (task
  // spec) — every source_records row (across every station of this
  // batch, not just currentStation) that fed into any of this batch's
  // canonical_events via canonical_event_sources, and the collection_runs
  // that produced them. Lets the UI click through to raw provenance.
  contributingSourceRecordIds: string[];
  contributingCollectionRunIds: string[];
}

// Step 10: Production Lines view. Reuses ProductionDomainService.getBatchStatus
// (Step 4/5, unchanged) per batch — no domain logic (Rule 6/7, freshness)
// lives here, only grouping/serializing. WorkOrder.lineId has no Prisma
// relation to Line (see schema.prisma — it's a plain string column, not a
// FK), so lines are derived as the distinct set of lineId values actually
// in use by work orders, not by listing the (currently unused) `lines`
// table.
@Controller('production-lines')
export class ProductionLinesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly productionDomainService: ProductionDomainService,
  ) {}

  @Get()
  async findAll() {
    // "must be configurable" — read from STALE_THRESHOLD_MINUTES (env var),
    // default 15 (same default ProductionDomainService already used
    // hardcoded pre-Step-10). Env vars are always strings, hence Number().
    const staleThresholdMinutes = Number(
      this.config.get<string>(
        'STALE_THRESHOLD_MINUTES',
        String(DEFAULT_STALE_THRESHOLD_MINUTES),
      ),
    );
    const now = new Date();

    const workOrders = await this.prisma.workOrder.findMany({
      include: { batches: true },
    });
    const lineIds = [...new Set(workOrders.map((wo) => wo.lineId))].sort();

    return Promise.all(
      lineIds.map(async (lineId) => {
        const lineWorkOrders = workOrders.filter((wo) => wo.lineId === lineId);

        const batches: BatchLineView[] = await Promise.all(
          lineWorkOrders.flatMap((wo) =>
            wo.batches.map(async (batch) => {
              const status = await this.productionDomainService.getBatchStatus(
                batch.batchId,
                now,
                staleThresholdMinutes,
              );
              const [lastEventAt, provenance] = await Promise.all([
                this.getLastEventAt(batch.batchId, status.currentStation),
                this.getProvenance(batch.batchId),
              ]);
              return {
                workOrderId: wo.workOrderId,
                ...status,
                lastEventAt,
                ...provenance,
              };
            }),
          ),
        );

        // WIP per station = batches currently sitting at that station and
        // not yet COMPLETED — gives the "ID để link tới source records +
        // collection run liên quan" via batchId (GET
        // /canonical-events?batchId=<id> pulls the rest; each batch entry
        // below also carries the resolved IDs directly).
        const stations = STATION_ORDER.map((station) => {
          const wip = batches.filter(
            (b) => b.currentStation === station && b.state !== 'COMPLETED',
          );
          return {
            station,
            wip: wip.length,
            batchIds: wip.map((b) => b.batchId),
          };
        });

        return { lineId, stations, batches };
      }),
    );
  }

  /**
   * The canonical_event's own eventTime at the batch's currentStation —
   * looked up by canonicalKey (`${batchId}:${station}`, unique). Takes
   * `currentStation` from the already-computed BatchStatusResult (Rule 6,
   * getCurrentStation, unchanged) rather than re-deriving it here — no
   * domain logic duplicated. null when there is no currentStation yet
   * (batch is PLANNED — nothing to look up).
   */
  private async getLastEventAt(
    batchId: string,
    currentStation: BatchStatusResult['currentStation'],
  ): Promise<Date | null> {
    if (!currentStation) return null;
    const event = await this.prisma.canonicalEvent.findUnique({
      where: { canonicalKey: `${batchId}:${currentStation}` },
      select: { eventTime: true },
    });
    return event?.eventTime ?? null;
  }

  /**
   * Every source_records row (across all of this batch's stations) linked
   * into any canonical_event via canonical_event_sources, plus the
   * collection_runs that produced them — "Links to the contributing source
   * records and collection run" (task spec).
   */
  private async getProvenance(batchId: string): Promise<{
    contributingSourceRecordIds: string[];
    contributingCollectionRunIds: string[];
  }> {
    const links = await this.prisma.canonicalEventSource.findMany({
      where: { canonicalEvent: { batchId } },
      select: {
        sourceRecordPk: true,
        sourceRecord: { select: { collectionRunId: true } },
      },
    });
    const contributingSourceRecordIds = [
      ...new Set(links.map((l) => l.sourceRecordPk)),
    ].sort();
    const contributingCollectionRunIds = [
      ...new Set(links.map((l) => l.sourceRecord.collectionRunId)),
    ].sort();
    return { contributingSourceRecordIds, contributingCollectionRunIds };
  }
}
