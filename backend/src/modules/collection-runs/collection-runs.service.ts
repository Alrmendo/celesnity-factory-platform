import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionRun, Source } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CanonicalizationService } from '../canonicalization/canonicalization.service';
import { NewSourceRecordInput, Station } from '../canonicalization/types';
import {
  collectFromTable,
  DatabaseSourceConfig,
  DatabaseSourceError,
  isStationValue,
  ProductionTableRow,
} from './database-source-client';
import {
  fetchFixtureEvents,
  FixtureApiError,
  FixtureEvent,
} from './fixture-api-client';
import { redactSecret } from './redact';
import {
  crawlDeliveries,
  SupplierCrawlerError,
} from './supplier-crawler-client';
import { CrawlerSourceConfig, FixtureApiSourceConfig } from './types';

const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 50;
const REQUEST_TIMEOUT_MS = 2000;
// Step 8 pagination-loop guard backstop — see supplier-crawler-client.ts's
// crawlDeliveries comment. 50 is comfortably above any real supplier
// portal's page count for this assessment's scope, while still bounding a
// pathological "always a new next URL" feed.
const MAX_CRAWL_PAGES = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class CollectionRunsService {
  private readonly logger = new Logger(CollectionRunsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly canonicalizationService: CanonicalizationService,
  ) {}

  /**
   * Records exactly one `collection_run` row (RUNNING -> SUCCESS|FAILED)
   * and, on success, reuses `CanonicalizationService.ingestBatch` (Step 5)
   * verbatim to insert source_records + recompute canonical_events — no
   * canonicalization logic lives here. Dispatches on `source.type`: API
   * (Step 6, fixture-api + retry/backoff) or DATABASE (Step 7, Production
   * Database — register/verify/discover/select already happened via
   * SourcesService, this just collects from the selected table).
   */
  async runCollection(sourceId: string): Promise<CollectionRun> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
    });
    if (!source) {
      throw new NotFoundException(`Source ${sourceId} not found`);
    }

    if (source.type === 'DATABASE') {
      return this.runDatabaseCollection(source);
    }
    if (source.type === 'CRAWLER') {
      return this.runCrawlerCollection(source);
    }
    return this.runApiCollection(source);
  }

  /** Step 6 — Application API, via fixture-api-client.ts, with retry/backoff. */
  private async runApiCollection(source: Source): Promise<CollectionRun> {
    const sourceId = source.id;
    const connectionConfig = source.config as unknown as FixtureApiSourceConfig;
    const apiKey = this.config.get<string>(connectionConfig.apiKeyEnvVar);
    if (!apiKey) {
      // Logs only the env var NAME (connectionConfig.apiKeyEnvVar), never a
      // value — there is no value to log, which is the point.
      // BadRequestException, not a plain Error — see sources.service.ts's
      // resolveDatabaseConfig for why (a plain Error becomes a generic
      // "Internal server error" on the wire, hiding this actionable
      // message from the caller/UI).
      throw new BadRequestException(
        `Source ${sourceId} references env var "${connectionConfig.apiKeyEnvVar}" for its API key, but it is not set`,
      );
    }

    const run = await this.prisma.collectionRun.create({
      data: { sourceId, startedAt: new Date(), status: 'RUNNING' },
    });

    let events: FixtureEvent[] | undefined;
    let lastErrorMessage: string | undefined;
    let attemptsMade = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      attemptsMade = attempt;
      try {
        events = await fetchFixtureEvents(
          connectionConfig.baseUrl,
          apiKey,
          attempt,
          connectionConfig.fault,
          REQUEST_TIMEOUT_MS,
        );
        lastErrorMessage = undefined;
        break;
      } catch (err) {
        const fixtureError = err instanceof FixtureApiError ? err : undefined;
        const rawMessage =
          fixtureError?.message ??
          (err instanceof Error ? err.message : 'unknown collection error');
        lastErrorMessage = redactSecret(rawMessage, apiKey);
        this.logger.warn(
          `Collection run ${run.id} (source ${sourceId}) attempt ${attempt}/${MAX_ATTEMPTS} failed: ${lastErrorMessage}`,
        );

        const retryable = fixtureError?.retryable ?? true;
        if (!retryable || attempt === MAX_ATTEMPTS) {
          break;
        }
        await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
      }
    }

    if (events === undefined) {
      return this.prisma.collectionRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorCount: attemptsMade,
          errorMessage: lastErrorMessage ?? 'unknown collection error',
        },
      });
    }

    const records: NewSourceRecordInput[] = events.map((event) => ({
      sourceId,
      collectionRunId: run.id,
      sourceRecordId: event.sourceRecordId,
      batchId: event.batchId,
      station: event.station,
      quantity: event.quantity,
      eventTime: new Date(event.eventTime),
      receivedAt: new Date(),
    }));

    await this.canonicalizationService.ingestBatch(records);

    return this.prisma.collectionRun.update({
      where: { id: run.id },
      data: {
        status: 'SUCCESS',
        finishedAt: new Date(),
        recordsRead: events.length,
        // Attempts before the one that succeeded, e.g. 1 failed attempt
        // then success -> errorCount 1. 0 when it succeeded first try.
        errorCount: attemptsMade - 1,
      },
    });
  }

  /**
   * Step 7 — Production Database. No retry loop here on purpose: unlike
   * Step 6's fixture-api (which the assessment explicitly asks to fault-
   * inject/retry against), the Step 7 task description only asks for
   * register/verify/discover/select/collect — a single connect-query-close
   * attempt per run, success or failure recorded as-is.
   */
  private async runDatabaseCollection(source: Source): Promise<CollectionRun> {
    const sourceId = source.id;
    const connectionConfig = source.config as unknown as DatabaseSourceConfig;
    const password = this.config.get<string>(connectionConfig.passwordEnvVar);
    if (!password) {
      // BadRequestException, not a plain Error — see runApiCollection above.
      throw new BadRequestException(
        `Source ${sourceId} references env var "${connectionConfig.passwordEnvVar}" for its DB password, but it is not set`,
      );
    }
    if (!connectionConfig.selectedTable) {
      throw new BadRequestException(
        `Source ${sourceId} has no selectedTable configured — call POST /sources/${sourceId}/select first`,
      );
    }

    const run = await this.prisma.collectionRun.create({
      data: { sourceId, startedAt: new Date(), status: 'RUNNING' },
    });

    let rows: ProductionTableRow[];
    try {
      rows = await collectFromTable(
        connectionConfig,
        password,
        connectionConfig.selectedTable,
      );
    } catch (err) {
      const rawMessage =
        err instanceof DatabaseSourceError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'unknown collection error';
      const errorMessage = redactSecret(rawMessage, password);
      this.logger.warn(
        `Collection run ${run.id} (source ${sourceId}) failed: ${errorMessage}`,
      );
      return this.prisma.collectionRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorCount: 1,
          errorMessage,
        },
      });
    }

    const records: NewSourceRecordInput[] = rows
      .filter((row) => isStationValue(row.station))
      .map((row) => ({
        sourceId,
        collectionRunId: run.id,
        sourceRecordId: String(row.id),
        batchId: row.batch_id,
        // Safe: the filter above already confirmed row.station is one of
        // the Station literals via the isStationValue type guard — TS just
        // can't carry that narrowing through a wrapped arrow-function
        // predicate (`.filter((row) => isStationValue(row.station))`
        // returns `boolean`, not `row is X`), so it isn't inferred
        // automatically here.
        station: row.station as Station,
        quantity: Number(row.quantity),
        eventTime: new Date(row.event_time),
        receivedAt: new Date(),
      }));

    await this.canonicalizationService.ingestBatch(records);

    return this.prisma.collectionRun.update({
      where: { id: run.id },
      data: {
        status: 'SUCCESS',
        finishedAt: new Date(),
        recordsRead: records.length,
        errorCount: 0,
      },
    });
  }

  /**
   * Step 8 — Supplier Crawler. No retry loop here, same reasoning as Step
   * 7's DB collector: the assessment's Data Crawler requirement only asks
   * for "prevent pagination loops" and "report malformed rows without
   * failing the whole run" — nothing about retrying transient failures
   * (that's stated only for Application API). Every crawl-able record
   * always gets station RECEIVING — the task's mapping table names the
   * crawler as RECEIVING's single source, so station is assigned by this
   * collector, never read off the page.
   */
  private async runCrawlerCollection(source: Source): Promise<CollectionRun> {
    const sourceId = source.id;
    const connectionConfig = source.config as unknown as CrawlerSourceConfig;

    const run = await this.prisma.collectionRun.create({
      data: { sourceId, startedAt: new Date(), status: 'RUNNING' },
    });

    let crawlResult: Awaited<ReturnType<typeof crawlDeliveries>>;
    try {
      crawlResult = await crawlDeliveries(
        connectionConfig.baseUrl,
        connectionConfig.fault,
        MAX_CRAWL_PAGES,
        REQUEST_TIMEOUT_MS,
      );
    } catch (err) {
      const errorMessage =
        err instanceof SupplierCrawlerError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'unknown collection error';
      this.logger.warn(
        `Collection run ${run.id} (source ${sourceId}) failed: ${errorMessage}`,
      );
      // A loop (or the max-pages backstop) means we can no longer trust
      // that what was read so far is the real, complete feed — nothing
      // gathered before the failure is ingested, same invariant as every
      // other FAILED run in this service (recordsRead stays 0).
      return this.prisma.collectionRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorCount: 1,
          errorMessage,
        },
      });
    }

    for (const malformed of crawlResult.malformedRows) {
      this.logger.warn(
        `Collection run ${run.id} (source ${sourceId}) skipped malformed row on page ${malformed.page}: ${malformed.reason}`,
      );
    }

    // Explicit `(r): NewSourceRecordInput =>` return-type annotation
    // (rather than relying on the `const records: NewSourceRecordInput[]`
    // declaration to contextually type the callback) so the literal
    // 'RECEIVING' below is checked against the `Station` union directly —
    // same caution as the Step 7 `let rows;`-without-annotation bug
    // (README's Step 7 log): don't rely on inference reaching into a
    // callback when an explicit annotation removes the question entirely.
    const records: NewSourceRecordInput[] = crawlResult.rows.map(
      (r): NewSourceRecordInput => ({
        sourceId,
        collectionRunId: run.id,
        sourceRecordId: r.sourceRecordId,
        batchId: r.batchId,
        station: 'RECEIVING',
        quantity: r.quantity,
        eventTime: r.deliveryTime,
        receivedAt: new Date(),
        payload: { deliveryNumber: r.deliveryNumber, supplier: r.supplier },
      }),
    );

    await this.canonicalizationService.ingestBatch(records);

    const malformedCount = crawlResult.malformedRows.length;
    return this.prisma.collectionRun.update({
      where: { id: run.id },
      data: {
        status: 'SUCCESS',
        finishedAt: new Date(),
        recordsRead: records.length,
        // Malformed rows don't fail the run (task requirement) but are
        // still "error info" worth recording — reuses errorCount/
        // errorMessage exactly like Step 6 uses errorCount on a SUCCESS
        // run to record failed-attempts-before-success, rather than adding
        // a new schema column for this.
        errorCount: malformedCount,
        errorMessage:
          malformedCount > 0
            ? `skipped ${malformedCount} malformed row(s): ${crawlResult.malformedRows
                .map((m) => `page ${m.page} (${m.reason})`)
                .join('; ')}`
            : null,
      },
    });
  }
}
