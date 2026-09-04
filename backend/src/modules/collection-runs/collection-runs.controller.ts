import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CollectionRunsService } from './collection-runs.service';

class RunCollectionDto {
  sourceId!: string;
}

@Controller('collection-runs')
export class CollectionRunsController {
  constructor(
    private readonly collectionRunsService: CollectionRunsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  run(@Body() dto: RunCollectionDto) {
    return this.collectionRunsService.runCollection(dto.sourceId);
  }

  // Step 10: Data Sources view — collection history for one source (or all,
  // when sourceId is omitted), newest first. Adds `durationMs` (derived from
  // startedAt/finishedAt, null while still RUNNING) since the UI needs
  // duration and there's no stored column for it. Same no-secret guarantee
  // as findOne below (collection_runs has no secret-shaped column at all).
  @Get()
  async findAll(@Query('sourceId') sourceId?: string) {
    const runs = await this.prisma.collectionRun.findMany({
      where: sourceId ? { sourceId } : undefined,
      orderBy: { startedAt: 'desc' },
    });
    return runs.map((run) => ({
      id: run.id,
      sourceId: run.sourceId,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: run.finishedAt
        ? run.finishedAt.getTime() - run.startedAt.getTime()
        : null,
      recordsRead: run.recordsRead,
      errorCount: run.errorCount,
      errorMessage: run.errorMessage,
    }));
  }

  // `collection_runs` has no secret-shaped column at all (id, sourceId,
  // timestamps, status, recordsRead, errorCount, errorMessage) — returning
  // the row as-is can't leak a source's API key; see secret-regression test.
  @Get(':id')
  async findOne(@Param('id') id: string) {
    const run = await this.prisma.collectionRun.findUnique({ where: { id } });
    if (!run) {
      throw new NotFoundException(`Collection run ${id} not found`);
    }
    return run;
  }
}
