import { Body, Controller, Post } from '@nestjs/common';
import { ManagementEventsService } from './management-events.service';
import type { AddNoteDto, ManagementActionDto } from './types';

// Step 9: route shape (flat POST /management-events/<action>, batchId in
// the body rather than a path param) is this repo's own design — no REST
// contract for management events exists in docs/plan-v4.md or the
// assessment PDF. See types.ts's header comment and README.md's
// "Assessment Assumptions" for the full reasoning. Only POST handlers
// exist here on purpose (append-only — see ManagementEventsService).
@Controller('management-events')
export class ManagementEventsController {
  constructor(
    private readonly managementEventsService: ManagementEventsService,
  ) {}

  @Post('block')
  block(@Body() dto: ManagementActionDto) {
    return this.managementEventsService.block(dto);
  }

  @Post('resume')
  resume(@Body() dto: ManagementActionDto) {
    return this.managementEventsService.resume(dto);
  }

  @Post('ack-exception')
  ackException(@Body() dto: ManagementActionDto) {
    return this.managementEventsService.ackException(dto);
  }

  @Post('note')
  addNote(@Body() dto: AddNoteDto) {
    return this.managementEventsService.addNote(dto);
  }
}
