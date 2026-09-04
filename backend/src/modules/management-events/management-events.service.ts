import { BadRequestException, Injectable } from '@nestjs/common';
import { ManagementAction, ManagementEvent } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveIsBlocked } from '../production-domain/batch-state';
import { ManagementEventInput } from '../production-domain/types';
import { SEED_ORGANIZATION_ID } from './constants';
import { AddNoteDto, ManagementActionDto } from './types';

@Injectable()
export class ManagementEventsService {
  constructor(private readonly prisma: PrismaService) {}

  /** "Block a batch" — no precondition; a manager may re-block for a new reason. */
  async block(dto: ManagementActionDto): Promise<ManagementEvent> {
    return this.create(dto.batchId, 'BLOCK', dto.actor, dto.note);
  }

  /**
   * "Resume a batch" — rejected when the batch isn't currently blocked
   * (reuses `resolveIsBlocked`, Step 4's pure function, unchanged, rather
   * than re-deriving the same block/resume logic here). Not strictly
   * required by Rule 7 itself (resolveBatchState already tolerates a
   * "phantom" resume-without-block harmlessly — it just never reads
   * BLOCKED), but a manager "resuming" a batch that was never blocked is
   * almost certainly a UI bug or duplicate click; surfacing a clear error
   * is more honest than silently appending a meaningless event into the
   * permanent audit log.
   */
  async resume(dto: ManagementActionDto): Promise<ManagementEvent> {
    const history = await this.history(dto.batchId);
    if (!resolveIsBlocked(history)) {
      throw new BadRequestException(
        `Batch ${dto.batchId} is not currently blocked — nothing to resume`,
      );
    }
    return this.create(dto.batchId, 'RESUME', dto.actor, dto.note);
  }

  /**
   * "Acknowledge an exception" — rejected when the batch has no CONFLICT
   * canonical event at all (nothing to acknowledge). Deliberately does NOT
   * check whether an existing CONFLICT is already "acknowledged" in the
   * derived sense (ProductionDomainService.getBatchStatus) — re-acking an
   * already-acknowledged conflict is harmless and append-only (just one
   * more audit row), e.g. legitimate if the same station recurs into
   * CONFLICT again later.
   */
  async ackException(dto: ManagementActionDto): Promise<ManagementEvent> {
    const hasConflict = await this.prisma.canonicalEvent.findFirst({
      where: { batchId: dto.batchId, status: 'CONFLICT' },
    });
    if (!hasConflict) {
      throw new BadRequestException(
        `Batch ${dto.batchId} has no CONFLICT canonical event to acknowledge`,
      );
    }
    return this.create(dto.batchId, 'ACK_EXCEPTION', dto.actor, dto.note);
  }

  /** "Add a note" — the only action requiring a non-empty `note`. */
  async addNote(dto: AddNoteDto): Promise<ManagementEvent> {
    if (!dto.note || !dto.note.trim()) {
      throw new BadRequestException('note must be a non-empty string');
    }
    return this.create(dto.batchId, 'ADD_NOTE', dto.actor, dto.note);
  }

  private async history(batchId: string): Promise<ManagementEventInput[]> {
    const rows = await this.prisma.managementEvent.findMany({
      where: { batchId },
    });
    // Same row -> ManagementEventInput mapping as
    // ProductionDomainService.getBatchStatus (Step 5) — Prisma's generated
    // ManagementAction enum is structurally a string-literal union, so
    // `row.action` assigns directly into ManagementEventInput.action
    // (ManagementActionType) with no cast, exactly as that existing code
    // already does.
    return rows.map((row) => ({
      batchId: row.batchId,
      action: row.action,
      actor: row.actor,
      timestamp: row.timestamp,
    }));
  }

  // Append-only by construction: this is the ONLY place anywhere in the
  // module that writes a management_events row, and it only ever calls
  // `.create()` — no `.update()`/`.delete()` on this table exists in this
  // service (or anywhere else in the codebase). `timestamp` is always
  // `new Date()` here, never taken from the caller (see types.ts's
  // comment) — an append-only audit log loses its meaning if callers can
  // backdate entries.
  private async create(
    batchId: string,
    action: ManagementAction,
    actor: string,
    note: string | undefined,
  ): Promise<ManagementEvent> {
    if (!actor || !actor.trim()) {
      throw new BadRequestException('actor must be a non-empty string');
    }
    return this.prisma.managementEvent.create({
      data: {
        organizationId: SEED_ORGANIZATION_ID,
        batchId,
        actor,
        action,
        timestamp: new Date(),
        note: note ?? null,
      },
    });
  }
}
