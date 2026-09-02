// Pure TypeScript types for the canonicalization pipeline — deliberately NOT
// derived from/dependent on the generated Prisma Client, so the pipeline can
// be unit-tested without a database connection or `prisma generate`.
// Ground truth: docs/plan-v4.md, Domain Rules v2.2.

export type SourceType = 'DATABASE' | 'API' | 'CRAWLER' | 'MQTT';

export type Station =
  'RECEIVING' | 'SORTING' | 'WASHING' | 'DRYING' | 'FOLDING' | 'DISPATCH';

export interface SourceRecordInput {
  /** Internal identifier of this raw record (maps to source_records.id). */
  id: string;
  sourceId: string;
  sourceType: SourceType;
  /** Business identifier from the external source (Rule 1) — not unique. */
  sourceRecordId: string;
  batchId: string;
  station: Station;
  quantity: number;
  eventTime: Date;
  receivedAt: Date;
}

export type CanonicalEventStatus = 'ACCEPTED' | 'CONFLICT';

export interface CanonicalEventResult {
  batchId: string;
  station: Station;
  /** `${batchId}:${station}` (Rule 2). */
  canonicalKey: string;
  quantity: number;
  eventTime: Date;
  status: CanonicalEventStatus;
}

export type SourceRelationship =
  'PRIMARY' | 'DUPLICATE' | 'SUPERSEDED' | 'CONFLICT';

export interface SourceLinkResult {
  // Identifies the raw record this relationship applies to. Populated from
  // SourceRecordInput.id (internal PK), never from the business
  // sourceRecordId — the latter is not guaranteed unique within a group
  // (see B005B) and can't identify one specific physical row. This mirrors
  // canonical_event_sources.source_record_pk -> source_records.id in
  // plan-v4.md (schema fix #2).
  sourceRecordId: string;
  relationship: SourceRelationship;
}

export interface CanonicalizationResult {
  event: CanonicalEventResult;
  sources: SourceLinkResult[];
}
