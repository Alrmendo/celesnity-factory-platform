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
import {
  checkReachable,
  discoverFeed,
  SupplierCrawlerError,
} from '../collection-runs/supplier-crawler-client';
import { CrawlerSourceConfig } from '../collection-runs/types';
import { sanitizeSourceConfig } from './sanitize-config';
import type { CreateSourceDto, SourceResponse } from './types';

const VERIFY_TIMEOUT_MS = 2000;

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

  // Step 10: Data Sources view needs a list, not just single-source lookup.
  // Same sanitization as findOne/create — never returns a raw secret.
  async findAll(): Promise<SourceResponse[]> {
    const sources = await this.prisma.source.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return sources.map((source) => this.toResponse(source));
  }

  /**
   * "Register and verify [the source] before use" — Step 7 (DATABASE): a
   * real `SELECT 1` against the target DB. Step 8 (CRAWLER): a real GET
   * against the supplier portal's deliveries feed. On success, records
   * `verifiedAt`. On failure, throws — deliberately does NOT touch
   * `verifiedAt` (a failed verify never claims a past success).
   */
  async verifyConnection(id: string): Promise<SourceResponse> {
    const source = await this.getRawOrThrow(id);

    if (source.type === 'CRAWLER') {
      const config = this.resolveCrawlerConfig(source);
      try {
        await checkReachable(config.baseUrl, VERIFY_TIMEOUT_MS);
      } catch (err) {
        const message =
          err instanceof SupplierCrawlerError ? err.message : String(err);
        throw new BadRequestException(message);
      }
      const updated = await this.prisma.source.update({
        where: { id },
        data: { verifiedAt: new Date() },
      });
      return this.toResponse(updated);
    }

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

  /**
   * "Discover [the source's schema]" — Step 7 (DATABASE): real
   * information_schema introspection (tables/columns). Step 8 (CRAWLER):
   * simpler, per the task instructions — no tables/columns to choose
   * between (the portal exposes exactly one deliveries feed), so this just
   * confirms the feed is reachable and reports how many pages it has.
   */
  async discoverSchema(
    id: string,
  ): Promise<DiscoveredTable[] | { reachable: true; totalPages: number }> {
    const source = await this.getRawOrThrow(id);

    if (source.type === 'CRAWLER') {
      const config = this.resolveCrawlerConfig(source);
      try {
        return await discoverFeed(config.baseUrl, VERIFY_TIMEOUT_MS);
      } catch (err) {
        const message =
          err instanceof SupplierCrawlerError ? err.message : String(err);
        throw new BadRequestException(message);
      }
    }

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
        `Source ${source.id} is type ${source.type}, not DATABASE — select (and verify/discover for non-CRAWLER types) only applies to DATABASE sources`,
      );
    }
    const config = source.config as unknown as DatabaseSourceConfig;
    const password = this.config.get<string>(config.passwordEnvVar);
    if (!password) {
      // BadRequestException (not a plain Error): a plain Error propagates
      // uncaught into Nest's default filter, which replaces its message
      // with a generic "Internal server error" in the HTTP response (by
      // design, to avoid leaking internals) — this is a caller/deployment
      // config mistake (missing env var), not an unexpected internal fault,
      // so the real reason should reach the client/UI. Found via real UI
      // testing (Step 11's "bổ sung" entry) showing this exact message
      // hidden behind a generic 500.
      throw new BadRequestException(
        `Source ${source.id} references env var "${config.passwordEnvVar}" for its DB password, but it is not set`,
      );
    }
    return { config, password };
  }

  // Step 8: CRAWLER sources carry no secret (see CrawlerSourceConfig's
  // comment) — nothing to resolve from env, unlike resolveDatabaseConfig.
  private resolveCrawlerConfig(source: Source): CrawlerSourceConfig {
    if (source.type !== 'CRAWLER') {
      throw new BadRequestException(
        `Source ${source.id} is type ${source.type}, not CRAWLER`,
      );
    }
    return source.config as unknown as CrawlerSourceConfig;
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
