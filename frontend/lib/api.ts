// Shared fetch helper + types for the backend REST API (see backend/README.md
// "Nhật ký triển khai", Step 6-10, for the ground-truth shapes these mirror).
// Client-side fetch against NEXT_PUBLIC_API_URL, same pattern app/page.tsx
// (Step 1) already established — no server components/actions here, kept
// consistent with the one page that already existed before Step 11.

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

  if (!res.ok) {
    // Nest's default HttpException body shape: { statusCode, message, error }
    // (see e.g. README's ManagementEvents 400 example) — message is always a
    // plain string here (no class-validator/ValidationPipe anywhere in this
    // backend, per Step 6's "Quyết định phát sinh").
    let message = `HTTP ${res.status}`;
    try {
      const body: unknown = await res.json();
      if (
        body &&
        typeof body === 'object' &&
        'message' in body &&
        typeof (body as { message: unknown }).message === 'string'
      ) {
        message = (body as { message: string }).message;
      }
    } catch {
      // Non-JSON error body — fall back to the HTTP status message above.
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// --- Sources (Step 6/7/8/10) ---------------------------------------------

// MQTT is a valid Prisma SourceType but no collector/config shape for it
// exists anywhere in the backend (Step 6-8 only implement API/DATABASE/
// CRAWLER) — deliberately excluded from the creatable types this UI offers.
export type CreatableSourceType = 'API' | 'DATABASE' | 'CRAWLER';
export type SourceType = CreatableSourceType | 'MQTT';

export interface Source {
  id: string;
  name: string;
  type: SourceType;
  config: Record<string, unknown>;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function listSources(): Promise<Source[]> {
  return apiFetch<Source[]>('/sources');
}

export function getSource(id: string): Promise<Source> {
  return apiFetch<Source>(`/sources/${id}`);
}

export function createSource(dto: {
  name: string;
  type: CreatableSourceType;
  config: Record<string, unknown>;
}): Promise<Source> {
  return apiFetch<Source>('/sources', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export function verifySource(id: string): Promise<Source> {
  return apiFetch<Source>(`/sources/${id}/verify`, { method: 'POST' });
}

// Step 7 (DATABASE): DiscoveredTable[]. Step 8 (CRAWLER): reachable+totalPages.
// API-type sources reject both calls with 400 (SourcesService only branches
// CRAWLER vs DATABASE) — this UI never shows Verify/Discover for API.
export interface DiscoveredColumn {
  name: string;
  dataType: string;
}
export interface DiscoveredTable {
  table: string;
  columns: DiscoveredColumn[];
}
export interface CrawlerDiscoverResult {
  reachable: true;
  totalPages: number;
}
export type DiscoverResult = DiscoveredTable[] | CrawlerDiscoverResult;

export function discoverSource(id: string): Promise<DiscoverResult> {
  return apiFetch<DiscoverResult>(`/sources/${id}/discover`);
}

export function isDiscoveredTables(
  result: DiscoverResult,
): result is DiscoveredTable[] {
  return Array.isArray(result);
}

export function selectSourceTable(id: string, table: string): Promise<Source> {
  return apiFetch<Source>(`/sources/${id}/select`, {
    method: 'POST',
    body: JSON.stringify({ table }),
  });
}

// --- Collection runs (Step 6/10) -----------------------------------------

export type CollectionRunStatus = 'RUNNING' | 'SUCCESS' | 'FAILED';

export interface CollectionRun {
  id: string;
  sourceId: string;
  status: CollectionRunStatus;
  startedAt: string;
  finishedAt: string | null;
  recordsRead: number;
  errorCount: number;
  errorMessage: string | null;
}

// GET /collection-runs?sourceId= (Step 10) response — has durationMs, which
// the POST /collection-runs response below does not.
export interface CollectionRunHistoryEntry extends CollectionRun {
  durationMs: number | null;
}

export function runCollection(sourceId: string): Promise<CollectionRun> {
  return apiFetch<CollectionRun>('/collection-runs', {
    method: 'POST',
    body: JSON.stringify({ sourceId }),
  });
}

export function listCollectionRuns(
  sourceId: string,
): Promise<CollectionRunHistoryEntry[]> {
  return apiFetch<CollectionRunHistoryEntry[]>(
    `/collection-runs?sourceId=${encodeURIComponent(sourceId)}`,
  );
}

// --- Canonical events preview + provenance (Step 10) ----------------------

export type SourceRelationship =
  | 'PRIMARY'
  | 'DUPLICATE'
  | 'SUPERSEDED'
  | 'CONFLICT';

export interface CanonicalEventSourceLink {
  relationship: SourceRelationship;
  sourceRecordPk: string;
  sourceRecordId: string;
  sourceId: string;
  sourceName: string;
  sourceType: SourceType;
  collectionRunId: string;
  eventTime: string;
  receivedAt: string;
}

export interface CanonicalEvent {
  id: string;
  batchId: string;
  station: string;
  quantity: number;
  eventTime: string;
  status: 'ACCEPTED' | 'CONFLICT';
  canonicalKey: string;
  updatedAt: string;
  sources: CanonicalEventSourceLink[];
}

export function listCanonicalEvents(filters: {
  batchId?: string;
  sourceId?: string;
  collectionRunId?: string;
}): Promise<CanonicalEvent[]> {
  const params = new URLSearchParams();
  if (filters.batchId) params.set('batchId', filters.batchId);
  if (filters.sourceId) params.set('sourceId', filters.sourceId);
  if (filters.collectionRunId)
    params.set('collectionRunId', filters.collectionRunId);
  const qs = params.toString();
  return apiFetch<CanonicalEvent[]>(`/canonical-events${qs ? `?${qs}` : ''}`);
}

// --- Production lines (Step 10) -------------------------------------------

export type Station =
  | 'RECEIVING'
  | 'SORTING'
  | 'WASHING'
  | 'DRYING'
  | 'FOLDING'
  | 'DISPATCH';
export type BatchState = 'PLANNED' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED';
export type FreshnessStatus = 'NO_DATA' | 'OK' | 'STALE';

export interface QualityIndicator {
  code: string;
  acknowledged: boolean;
}

// One entry of GET /production-lines's batches[] — BatchStatusResult
// (backend/src/modules/production-domain/types.ts) plus the Step 10/Step
// 11-bổ-sung additions (workOrderId, lastEventAt, contributing*Ids). See
// backend/src/modules/production-domain/production-lines.controller.ts's
// BatchLineView — this mirrors it field-for-field.
export interface ProductionLineBatch {
  batchId: string;
  workOrderId: string;
  state: BatchState;
  currentStation: Station | null;
  completedQuantity: number | null;
  missingStations: Station[];
  freshnessStatus: FreshnessStatus;
  freshnessMinutes: number | null;
  qualityIndicators: QualityIndicator[];
  lastEventAt: string | null;
  contributingSourceRecordIds: string[];
  contributingCollectionRunIds: string[];
}

export interface ProductionLineStation {
  station: Station;
  wip: number;
  batchIds: string[];
}

export interface ProductionLine {
  lineId: string;
  stations: ProductionLineStation[];
  batches: ProductionLineBatch[];
}

export function listProductionLines(): Promise<ProductionLine[]> {
  return apiFetch<ProductionLine[]>('/production-lines');
}

// --- Management events (Step 9) --------------------------------------------

export type ManagementAction = 'BLOCK' | 'RESUME' | 'ACK_EXCEPTION' | 'ADD_NOTE';

// Response shape of all 4 POST /management-events/* endpoints — the raw
// created row (ManagementEventsService.create returns
// prisma.managementEvent.create(...) directly, no extra serialization).
export interface ManagementEvent {
  id: string;
  organizationId: string;
  batchId: string;
  actor: string;
  action: ManagementAction;
  timestamp: string;
  note: string | null;
}

// `actor` required on every action (backend/src/modules/management-events/
// types.ts's ManagementActionDto/AddNoteDto — no seeded default, always
// from the caller). `note` optional for block/resume/ack-exception,
// required (enforced backend-side, non-empty) for addNote.
export function blockBatch(
  batchId: string,
  actor: string,
  note?: string,
): Promise<ManagementEvent> {
  return apiFetch<ManagementEvent>('/management-events/block', {
    method: 'POST',
    body: JSON.stringify({ batchId, actor, note }),
  });
}

export function resumeBatch(
  batchId: string,
  actor: string,
  note?: string,
): Promise<ManagementEvent> {
  return apiFetch<ManagementEvent>('/management-events/resume', {
    method: 'POST',
    body: JSON.stringify({ batchId, actor, note }),
  });
}

export function ackException(
  batchId: string,
  actor: string,
  note?: string,
): Promise<ManagementEvent> {
  return apiFetch<ManagementEvent>('/management-events/ack-exception', {
    method: 'POST',
    body: JSON.stringify({ batchId, actor, note }),
  });
}

export function addNote(
  batchId: string,
  actor: string,
  note: string,
): Promise<ManagementEvent> {
  return apiFetch<ManagementEvent>('/management-events/note', {
    method: 'POST',
    body: JSON.stringify({ batchId, actor, note }),
  });
}
