import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SourcesService } from './sources.service';
import type { CreateSourceDto } from './types';

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
}
