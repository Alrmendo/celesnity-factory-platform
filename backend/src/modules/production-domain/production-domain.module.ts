import { Module } from '@nestjs/common';
import { ProductionDomainController } from './production-domain.controller';
import { ProductionDomainService } from './production-domain.service';

@Module({
  controllers: [ProductionDomainController],
  providers: [ProductionDomainService],
})
export class ProductionDomainModule {}
