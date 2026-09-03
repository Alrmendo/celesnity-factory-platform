import { Module } from '@nestjs/common';
import { CanonicalizationModule } from '../canonicalization/canonicalization.module';
import { CollectionRunsController } from './collection-runs.controller';
import { CollectionRunsService } from './collection-runs.service';

@Module({
  imports: [CanonicalizationModule],
  controllers: [CollectionRunsController],
  providers: [CollectionRunsService],
})
export class CollectionRunsModule {}
