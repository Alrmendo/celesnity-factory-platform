import { Module } from '@nestjs/common';
import { CollectionRunsController } from './collection-runs.controller';
import { CollectionRunsService } from './collection-runs.service';

@Module({
  controllers: [CollectionRunsController],
  providers: [CollectionRunsService],
})
export class CollectionRunsModule {}
