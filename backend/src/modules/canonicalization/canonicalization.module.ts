import { Module } from '@nestjs/common';
import { CanonicalizationController } from './canonicalization.controller';
import { CanonicalizationService } from './canonicalization.service';

@Module({
  controllers: [CanonicalizationController],
  providers: [CanonicalizationService],
})
export class CanonicalizationModule {}
