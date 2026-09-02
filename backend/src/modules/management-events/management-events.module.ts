import { Module } from '@nestjs/common';
import { ManagementEventsController } from './management-events.controller';
import { ManagementEventsService } from './management-events.service';

@Module({
  controllers: [ManagementEventsController],
  providers: [ManagementEventsService],
})
export class ManagementEventsModule {}
