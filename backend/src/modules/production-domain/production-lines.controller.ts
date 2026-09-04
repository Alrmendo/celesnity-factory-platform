import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductionDomainService } from './production-domain.service';
import { STATION_ORDER } from './station-order';
import { BatchStatusResult } from './types';

const DEFAULT_STALE_THRESHOLD_MINUTES = 15;

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

        const batches: Array<BatchStatusResult & { workOrderId: string }> =
          await Promise.all(
            lineWorkOrders.flatMap((wo) =>
              wo.batches.map(async (batch) => {
                const status =
                  await this.productionDomainService.getBatchStatus(
                    batch.batchId,
                    now,
                    staleThresholdMinutes,
                  );
                return { workOrderId: wo.workOrderId, ...status };
              }),
            ),
          );

        // WIP per station = batches currently sitting at that station and
        // not yet COMPLETED — gives the "ID để link tới source records +
        // collection run liên quan" via batchId (GET
        // /canonical-events?batchId=<id> pulls the rest).
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
}
