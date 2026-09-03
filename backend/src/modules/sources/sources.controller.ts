import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SourcesService } from './sources.service';
import type { CreateSourceDto, SelectTableDto } from './types';

@Controller('sources')
export class SourcesController {
  constructor(private readonly sourcesService: SourcesService) {}

  @Post()
  create(@Body() dto: CreateSourceDto) {
    return this.sourcesService.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sourcesService.findOne(id);
  }

  // Step 7: DATABASE sources only — register/verify/discover/select flow.
  @Post(':id/verify')
  verify(@Param('id') id: string) {
    return this.sourcesService.verifyConnection(id);
  }

  @Get(':id/discover')
  discover(@Param('id') id: string) {
    return this.sourcesService.discoverSchema(id);
  }

  @Post(':id/select')
  select(@Param('id') id: string, @Body() dto: SelectTableDto) {
    return this.sourcesService.selectTable(id, dto.table);
  }
}
