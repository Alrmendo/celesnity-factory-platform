// Pure functions, no side effects, no DB access — Rule 1-5 (Domain Rules
// v2.2, docs/plan-v4.md). Wiring this into a real DB transaction
// (insert -> recompute -> update canonical_event_sources) is Step 4.

import { getSourceTier } from './source-priority';
import {
  CanonicalEventResult,
  CanonicalizationResult,
  SourceLinkResult,
  SourceRecordInput,
  SourceRelationship,
  Station,
} from './types';

/** Rule 2 — operational/station identity key. */
function operationalKey(batchId: string, station: Station): string {
  return `${batchId}:${station}`;
}

/**
 * Groups records by operational identity, `${batchId}:${station}` (Rule 2).
 * This is the ONLY grouping used for canonicalization — deliberately not by
 * sourceId+sourceRecordId (Rule 1, which is raw/audit identity only).
 */
export function groupByOperationalIdentity(
  records: SourceRecordInput[],
): Map<string, SourceRecordInput[]> {
  const groups = new Map<string, SourceRecordInput[]>();
  for (const record of records) {
    const key = operationalKey(record.batchId, record.station);
    const existing = groups.get(key);
    if (existing) {
      existing.push(record);
    } else {
      groups.set(key, [record]);
    }
  }
  return groups;
}

/**
 * Deterministic "last-observed-wins" pick among candidates that represent
 * the same observation stream: highest receivedAt wins; ties broken by id
 * ascending (Rule 2).
 */
function pickLastObserved(records: SourceRecordInput[]): SourceRecordInput {
  return records.reduce((winner, candidate) => {
    if (candidate.receivedAt.getTime() > winner.receivedAt.getTime()) {
      return candidate;
    }
    if (candidate.receivedAt.getTime() < winner.receivedAt.getTime()) {
      return winner;
    }
    return candidate.id < winner.id ? candidate : winner;
  });
}

function relationshipAgainst(
  record: SourceRecordInput,
  referenceQuantity: number,
): 'DUPLICATE' | 'SUPERSEDED' {
  return record.quantity === referenceQuantity ? 'DUPLICATE' : 'SUPERSEDED';
}

interface SourceSubgroup {
  sourceId: string;
  records: SourceRecordInput[];
  representative: SourceRecordInput;
}

/**
 * Rule 2's assumption: multiple reads from the SAME source under the same
 * operational key are not independent observations — they're an evolving
 * state, collapsed via last-observed-wins BEFORE any cross-source
 * comparison. This groups a batchId+station group by sourceId and picks
 * each source's representative reading.
 */
function buildSourceSubgroups(records: SourceRecordInput[]): SourceSubgroup[] {
  const bySource = new Map<string, SourceRecordInput[]>();
  for (const record of records) {
    const existing = bySource.get(record.sourceId);
    if (existing) {
      existing.push(record);
    } else {
      bySource.set(record.sourceId, [record]);
    }
  }
  return [...bySource.entries()].map(([sourceId, sourceRecords]) => ({
    sourceId,
    records: sourceRecords,
    representative: pickLastObserved(sourceRecords),
  }));
}

function toEvent(
  batchId: string,
  station: Station,
  quantity: number,
  eventTime: Date,
  status: 'ACCEPTED' | 'CONFLICT',
): CanonicalEventResult {
  return {
    batchId,
    station,
    canonicalKey: operationalKey(batchId, station),
    quantity,
    eventTime,
    status,
  };
}

/**
 * Resolves ONE operational-identity group (Rule 5, normalize -> group ->
 * resolve — grouping already done by the caller via
 * groupByOperationalIdentity). `records` must all share the same
 * batchId+station.
 */
export function resolveGroup(
  records: SourceRecordInput[],
): CanonicalizationResult {
  if (records.length === 0) {
    throw new Error('resolveGroup requires at least one record');
  }

  const { batchId, station } = records[0];
  const subgroups = buildSourceSubgroups(records);

  // Relationship for every non-representative (superseded intra-source
  // re-read). This holds regardless of the cross-source outcome below — it
  // only describes a record's standing within its own source's history.
  const intraSourceLinks = new Map<string, SourceRelationship>();
  for (const subgroup of subgroups) {
    for (const record of subgroup.records) {
      if (record === subgroup.representative) continue;
      intraSourceLinks.set(
        record.id,
        relationshipAgainst(record, subgroup.representative.quantity),
      );
    }
  }

  // Rule 5.2 — single source for this batchId+station: the subgroup
  // representative IS the canonical event, no cross-source comparison
  // needed. Covers both the raw re-read case (B005A) and the
  // different-sourceRecordId-same-source case (B005B) — both collapse here
  // because grouping is by batchId+station, not by sourceRecordId.
  if (subgroups.length === 1) {
    const [{ representative }] = subgroups;
    const sources: SourceLinkResult[] = records.map((record) => ({
      sourceRecordPk: record.id,
      relationship:
        record === representative
          ? 'PRIMARY'
          : (intraSourceLinks.get(record.id) as SourceRelationship),
    }));
    return {
      event: toEvent(
        batchId,
        station,
        representative.quantity,
        representative.eventTime,
        'ACCEPTED',
      ),
      sources,
    };
  }

  // Multiple sources — Rule 4 tier lookup per source representative, then
  // Rule 5.3 (cross-tier) / 5.4 (same-tier conflict) / 5.5 (corroboration).
  const withTier = subgroups.map((subgroup) => ({
    subgroup,
    tier: getSourceTier(subgroup.representative.sourceType),
  }));
  const topTier = Math.min(...withTier.map((entry) => entry.tier));
  const topEntries = withTier.filter((entry) => entry.tier === topTier);
  const lowerEntries = withTier.filter((entry) => entry.tier !== topTier);

  const topRepresentatives = topEntries.map(
    (entry) => entry.subgroup.representative,
  );
  const distinctTopQuantities = new Set(
    topRepresentatives.map((r) => r.quantity),
  );

  let winner: SourceRecordInput;
  let status: 'ACCEPTED' | 'CONFLICT';
  const topRelationships = new Map<string, SourceRelationship>();

  if (topRepresentatives.length === 1) {
    // Only one source at the top tier — Rule 5.3, nothing to disagree with.
    winner = topRepresentatives[0];
    status = 'ACCEPTED';
    topRelationships.set(winner.id, 'PRIMARY');
  } else if (distinctTopQuantities.size > 1) {
    // Rule 5.4 — same (top) tier, disagreeing quantities -> CONFLICT.
    // Representative quantity/eventTime: most-recently-observed top-tier
    // reading. All top-tier records are marked CONFLICT.
    winner = pickLastObserved(topRepresentatives);
    status = 'CONFLICT';
    for (const rep of topRepresentatives) {
      topRelationships.set(rep.id, 'CONFLICT');
    }
  } else {
    // Rule 5.5 — same (top) tier, corroborating quantities -> ACCEPTED.
    winner = pickLastObserved(topRepresentatives);
    status = 'ACCEPTED';
    for (const rep of topRepresentatives) {
      topRelationships.set(rep.id, rep === winner ? 'PRIMARY' : 'DUPLICATE');
    }
  }

  // Rule 5.3 — lower-tier representatives never outrank the top-tier
  // outcome; recorded as DUPLICATE/SUPERSEDED against the winning quantity.
  const lowerRelationships = new Map<string, SourceRelationship>();
  for (const entry of lowerEntries) {
    lowerRelationships.set(
      entry.subgroup.representative.id,
      relationshipAgainst(entry.subgroup.representative, winner.quantity),
    );
  }

  const sources: SourceLinkResult[] = records.map((record) => {
    const relationship: SourceRelationship =
      topRelationships.get(record.id) ??
      lowerRelationships.get(record.id) ??
      (intraSourceLinks.get(record.id) as SourceRelationship);
    return { sourceRecordPk: record.id, relationship };
  });

  return {
    event: toEvent(batchId, station, winner.quantity, winner.eventTime, status),
    sources,
  };
}

/** Groups (Rule 2) then resolves (Rule 5) an arbitrary batch of source records. */
export function resolveAll(
  records: SourceRecordInput[],
): CanonicalizationResult[] {
  const groups = groupByOperationalIdentity(records);
  return [...groups.values()].map((group) => resolveGroup(group));
}
