import { Module } from '@nestjs/common';
import { ProductionDomainController } from './production-domain.controller';
import { ProductionDomainService } from './production-domain.service';
import { ProductionLinesController } from './production-lines.controller';

@Module({
  controllers: [ProductionDomainController, ProductionLinesController],
  providers: [ProductionDomainService],
})
export class ProductionDomainModule {}
