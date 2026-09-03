// Pure TypeScript types for the canonicalization pipeline — deliberately NOT
// derived from/dependent on the generated Prisma Client, so the pipeline can
// be unit-tested without a database connection or `prisma generate`.
// Ground truth: docs/plan-v4.md, Domain Rules v2.2.

export type SourceType = 'API' | 'DATABASE' | 'CRAWLER' | 'MQTT';

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
  // (see B005B) and can't identify one specific physical row. Name matches
  // canonical_event_sources.source_record_pk -> source_records.id in
  // plan-v4.md (schema fix #2) exactly, to avoid confusion with
  // SourceRecordInput.sourceRecordId (a different field, different meaning).
  sourceRecordPk: string;
  relationship: SourceRelationship;
}

export interface CanonicalizationResult {
  event: CanonicalEventResult;
  sources: SourceLinkResult[];
}

// Input for CanonicalizationService.ingestAndRecompute (Step 5) — a new raw
// reading not yet written to source_records. Deliberately NOT just
// `Omit<SourceRecordInput, 'id'>`:
//  - no `sourceType`: that's derived by joining source_records.source_id ->
//    sources.type when read back, never stored redundantly on the row
//    itself (it isn't a source_records column at all).
//  - adds `collectionRunId`: source_records.collection_run_id is a required
//    FK (Step 2 schema) with no other way to supply it; the pure
//    SourceRecordInput type has no notion of it since collection runs are
//    irrelevant to canonicalization logic itself.
export interface NewSourceRecordInput {
  sourceId: string;
  sourceRecordId: string;
  collectionRunId: string;
  batchId: string;
  station: Station;
  quantity: number;
  eventTime: Date;
  receivedAt: Date;
  // Optional extra raw fields to merge into source_records.payload
  // alongside `quantity` (Step 8 addition). Step 6/7 collectors never set
  // this, so their persisted payload is byte-identical to before ({
  // quantity } only) — see ingestAndRecompute. Step 8's crawler collector
  // uses it to keep deliveryNumber/supplier (fields the task requires
  // extracting from each row but that have no dedicated column anywhere in
  // the schema) on the raw record for audit, rather than discarding them.
  payload?: Record<string, unknown>;
}
