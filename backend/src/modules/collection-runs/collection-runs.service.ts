import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionRun } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CanonicalizationService } from '../canonicalization/canonicalization.service';
import { NewSourceRecordInput } from '../canonicalization/types';
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
   * Calls the source's fixture-api endpoint (with retry/backoff), records
   * exactly one `collection_run` row (RUNNING -> SUCCESS|FAILED), and on
   * success reuses `CanonicalizationService.ingestBatch` (Step 5) verbatim
   * to insert source_records + recompute canonical_events — no
   * canonicalization logic lives here.
   */
  async runCollection(sourceId: string): Promise<CollectionRun> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
    });
    if (!source) {
      throw new NotFoundException(`Source ${sourceId} not found`);
    }

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
}
