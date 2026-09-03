import { Module } from '@nestjs/common';
import { CanonicalizationController } from './canonicalization.controller';
import { CanonicalizationService } from './canonicalization.service';

@Module({
  controllers: [CanonicalizationController],
  providers: [CanonicalizationService],
  // Step 6: CollectionRunsModule injects this to reuse ingestBatch() rather
  // than re-implementing canonicalization.
  exports: [CanonicalizationService],
})
export class CanonicalizationModule {}
