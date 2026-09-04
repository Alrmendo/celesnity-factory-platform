import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// Step 10: Data Sources view — "Preview normalized records with their
// source and collection-run provenance". "Normalized record" = a
// canonical_events row (Rule 2/5's output); route name matches that
// directly ("canonical-events") rather than the source_records the task
// text mentions, since a canonical event is what the UI actually previews,
// and it already carries provenance (source_records -> sources) through
// canonical_event_sources. This module was otherwise unused (no routes
// registered here through Step 9), so repurposing its empty controller
// doesn't touch any existing route.
@Controller('canonical-events')
export class CanonicalizationController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async findAll(
    @Query('batchId') batchId?: string,
    @Query('sourceId') sourceId?: string,
    @Query('collectionRunId') collectionRunId?: string,
  ) {
    const events = await this.prisma.canonicalEvent.findMany({
      where: {
        batchId,
        ...(sourceId || collectionRunId
          ? {
              sources: {
                some: { sourceRecord: { sourceId, collectionRunId } },
              },
            }
          : {}),
      },
      include: {
        sources: { include: { sourceRecord: { include: { source: true } } } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return events.map((event) => ({
      id: event.id,
      batchId: event.batchId,
      station: event.station,
      quantity: event.quantity.toNumber(),
      eventTime: event.eventTime,
      status: event.status,
      canonicalKey: event.canonicalKey,
      updatedAt: event.updatedAt,
      // Provenance: which raw source_records (and, through them, which
      // source + collection run) this canonical event was derived from.
      sources: event.sources.map((link) => ({
        relationship: link.relationship,
        sourceRecordPk: link.sourceRecordPk,
        sourceRecordId: link.sourceRecord.sourceRecordId,
        sourceId: link.sourceRecord.sourceId,
        sourceName: link.sourceRecord.source.name,
        sourceType: link.sourceRecord.source.type,
        collectionRunId: link.sourceRecord.collectionRunId,
        eventTime: link.sourceRecord.eventTime,
        receivedAt: link.sourceRecord.receivedAt,
      })),
    }));
  }
}
