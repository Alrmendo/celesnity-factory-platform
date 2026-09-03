import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Source } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DatabaseSourceConfig,
  DatabaseSourceError,
  discoverSchema,
  DiscoveredTable,
  verifyConnection,
} from '../collection-runs/database-source-client';
import { redactSecret } from '../collection-runs/redact';
import { sanitizeSourceConfig } from './sanitize-config';
import type { CreateSourceDto, SourceResponse } from './types';

@Injectable()
export class SourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async create(dto: CreateSourceDto): Promise<SourceResponse> {
    const source = await this.prisma.source.create({
      data: {
        name: dto.name,
        type: dto.type,
        config: dto.config as Prisma.InputJsonValue,
      },
    });
    return this.toResponse(source);
  }

  async findOne(id: string): Promise<SourceResponse> {
    const source = await this.getRawOrThrow(id);
    return this.toResponse(source);
  }

  /**
   * Step 7 "Register and verify the database connection before use": a
   * real `SELECT 1` against the target DB. On success, records
   * `verifiedAt`. On failure, throws — deliberately does NOT touch
   * `verifiedAt` (a failed verify never claims a past success).
   */
  async verifyConnection(id: string): Promise<SourceResponse> {
    const source = await this.getRawOrThrow(id);
    const { config, password } = this.resolveDatabaseConfig(source);

    try {
      await verifyConnection(config, password);
    } catch (err) {
      const message =
        err instanceof DatabaseSourceError ? err.message : String(err);
      throw new BadRequestException(redactSecret(message, password));
    }

    const updated = await this.prisma.source.update({
      where: { id },
      data: { verifiedAt: new Date() },
    });
    return this.toResponse(updated);
  }

  /** Step 7 "Discover available tables and columns" — real introspection. */
  async discoverSchema(id: string): Promise<DiscoveredTable[]> {
    const source = await this.getRawOrThrow(id);
    const { config, password } = this.resolveDatabaseConfig(source);

    try {
      return await discoverSchema(config, password);
    } catch (err) {
      const message =
        err instanceof DatabaseSourceError ? err.message : String(err);
      throw new BadRequestException(redactSecret(message, password));
    }
  }

  /**
   * Step 7 "Select a production table for collection" — re-runs discovery
   * to confirm `table` is real before persisting it, rather than trusting
   * the client-supplied name outright (defense in depth alongside the
   * identifier check in database-source-client.ts's collectFromTable).
   */
  async selectTable(id: string, table: string): Promise<SourceResponse> {
    const source = await this.getRawOrThrow(id);
    const { config, password } = this.resolveDatabaseConfig(source);

    let discovered: DiscoveredTable[];
    try {
      discovered = await discoverSchema(config, password);
    } catch (err) {
      const message =
        err instanceof DatabaseSourceError ? err.message : String(err);
      throw new BadRequestException(redactSecret(message, password));
    }

    if (!discovered.some((t) => t.table === table)) {
      throw new BadRequestException(
        `Table "${table}" was not found on source ${id} (see GET /sources/${id}/discover for the real list)`,
      );
    }

    const updatedConfig: DatabaseSourceConfig = {
      ...config,
      selectedTable: table,
    };
    const updated = await this.prisma.source.update({
      where: { id },
      data: { config: updatedConfig as unknown as Prisma.InputJsonValue },
    });
    return this.toResponse(updated);
  }

  private async getRawOrThrow(id: string): Promise<Source> {
    const source = await this.prisma.source.findUnique({ where: { id } });
    if (!source) {
      throw new NotFoundException(`Source ${id} not found`);
    }
    return source;
  }

  private resolveDatabaseConfig(source: Source): {
    config: DatabaseSourceConfig;
    password: string;
  } {
    if (source.type !== 'DATABASE') {
      throw new BadRequestException(
        `Source ${source.id} is type ${source.type}, not DATABASE — verify/discover/select only apply to DATABASE sources`,
      );
    }
    const config = source.config as unknown as DatabaseSourceConfig;
    const password = this.config.get<string>(config.passwordEnvVar);
    if (!password) {
      throw new Error(
        `Source ${source.id} references env var "${config.passwordEnvVar}" for its DB password, but it is not set`,
      );
    }
    return { config, password };
  }

  private toResponse(source: Source): SourceResponse {
    return {
      id: source.id,
      name: source.name,
      type: source.type,
      config: sanitizeSourceConfig(source.config),
      verifiedAt: source.verifiedAt,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
    };
  }
}
