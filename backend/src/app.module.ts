import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { PrismaModule } from './prisma/prisma.module';
import { SourcesModule } from './modules/sources/sources.module';
import { CollectionRunsModule } from './modules/collection-runs/collection-runs.module';
import { CanonicalizationModule } from './modules/canonicalization/canonicalization.module';
import { ProductionDomainModule } from './modules/production-domain/production-domain.module';
import { ManagementEventsModule } from './modules/management-events/management-events.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    PrismaModule,
    SourcesModule,
    CollectionRunsModule,
    CanonicalizationModule,
    ProductionDomainModule,
    ManagementEventsModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
