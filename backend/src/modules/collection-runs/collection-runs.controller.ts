import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
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
