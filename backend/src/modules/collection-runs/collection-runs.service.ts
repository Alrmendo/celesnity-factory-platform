import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
import { FixtureApiSourceConfig } from './types';

const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 50;
const REQUEST_TIMEOUT_MS = 2000;

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
      throw new Error(
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
      throw new Error(
        `Source ${sourceId} references env var "${connectionConfig.passwordEnvVar}" for its DB password, but it is not set`,
      );
    }
    if (!connectionConfig.selectedTable) {
      throw new Error(
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
}
