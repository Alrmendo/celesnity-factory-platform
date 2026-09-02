import {
  groupByOperationalIdentity,
  resolveAll,
  resolveGroup,
} from './canonicalization.pipeline';
import { deriveQualityIndicators } from './quality-indicators';
import { SourceRecordInput } from './types';

const t0 = new Date('2026-01-01T00:00:00.000Z');
const minutes = (n: number) => new Date(t0.getTime() + n * 60_000);

describe('canonicalization pipeline — Domain Rules v2.2 (Rule 1-5b)', () => {
  describe('resolveGroup', () => {
    it('Baseline: a single source record resolves to ACCEPTED / PRIMARY', () => {
      const record: SourceRecordInput = {
        id: 'sr-1',
        sourceId: 'db-1',
        sourceType: 'DATABASE',
        sourceRecordId: 'biz-1',
        batchId: 'B000',
        station: 'RECEIVING',
        quantity: 100,
        eventTime: minutes(0),
        receivedAt: minutes(0),
      };

      const result = resolveGroup([record]);

      expect(result.event.status).toBe('ACCEPTED');
      expect(result.event.quantity).toBe(100);
      expect(result.event.canonicalKey).toBe('B000:RECEIVING');
      expect(result.sources).toEqual([
        { sourceRecordPk: 'sr-1', relationship: 'PRIMARY' },
      ]);
    });

    it('B005A (Rule 1 + 5.2): same source, same sourceRecordId, raw re-read -> one ACCEPTED event, earlier reading DUPLICATE', () => {
      const firstRead: SourceRecordInput = {
        id: 'sr-1',
        sourceId: 'db-1',
        sourceType: 'DATABASE',
        sourceRecordId: 'biz-1',
        batchId: 'B005A',
        station: 'WASHING',
        quantity: 50,
        eventTime: minutes(0),
        receivedAt: minutes(0),
      };
      const reRead: SourceRecordInput = {
        ...firstRead,
        id: 'sr-2',
        receivedAt: minutes(5),
      };

      const result = resolveGroup([firstRead, reRead]);

      expect(result.event.status).toBe('ACCEPTED');
      expect(result.event.quantity).toBe(50);
      expect(result.sources).toEqual(
        expect.arrayContaining([
          { sourceRecordPk: 'sr-2', relationship: 'PRIMARY' },
          { sourceRecordPk: 'sr-1', relationship: 'DUPLICATE' },
        ]),
      );
    });

    it('B005B (Rule 2 + 5.2): same source, different sourceRecordId, same batch+station+quantity -> grouped by operational identity, one ACCEPTED event', () => {
      const a: SourceRecordInput = {
        id: 'sr-1',
        sourceId: 'db-1',
        sourceType: 'DATABASE',
        sourceRecordId: 'biz-a',
        batchId: 'B005B',
        station: 'SORTING',
        quantity: 30,
        eventTime: minutes(0),
        receivedAt: minutes(0),
      };
      const b: SourceRecordInput = {
        id: 'sr-2',
        sourceId: 'db-1',
        sourceType: 'DATABASE',
        sourceRecordId: 'biz-b',
        batchId: 'B005B',
        station: 'SORTING',
        quantity: 30,
        eventTime: minutes(3),
        receivedAt: minutes(3),
      };

      const result = resolveGroup([a, b]);

      expect(result.event.status).toBe('ACCEPTED');
      expect(result.event.canonicalKey).toBe('B005B:SORTING');
      expect(result.sources).toEqual(
        expect.arrayContaining([
          { sourceRecordPk: 'sr-2', relationship: 'PRIMARY' },
          { sourceRecordPk: 'sr-1', relationship: 'DUPLICATE' },
        ]),
      );
    });

    it('Cross-tier resolve (Rule 5.3, synthetic): DATABASE (tier 1) outranks CRAWLER (tier 2) -> ACCEPTED, CRAWLER SUPERSEDED', () => {
      // Doesn't occur naturally in the 8-batch plan-v4.md fixture (single-source
      // per station by design) — this exercises the Rule 5.3 branch directly.
      const dbRecord: SourceRecordInput = {
        id: 'sr-db',
        sourceId: 'db-1',
        sourceType: 'DATABASE',
        sourceRecordId: 'biz-db',
        batchId: 'B-XTIER',
        station: 'DRYING',
        quantity: 200,
        eventTime: minutes(0),
        receivedAt: minutes(0),
      };
      const crawlerRecord: SourceRecordInput = {
        id: 'sr-crawler',
        sourceId: 'crawler-1',
        sourceType: 'CRAWLER',
        sourceRecordId: 'biz-crawler',
        batchId: 'B-XTIER',
        station: 'DRYING',
        quantity: 190,
        eventTime: minutes(1),
        receivedAt: minutes(1),
      };

      const result = resolveGroup([dbRecord, crawlerRecord]);

      expect(result.event.status).toBe('ACCEPTED');
      expect(result.event.quantity).toBe(200);
      expect(result.sources).toEqual(
        expect.arrayContaining([
          { sourceRecordPk: 'sr-db', relationship: 'PRIMARY' },
          { sourceRecordPk: 'sr-crawler', relationship: 'SUPERSEDED' },
        ]),
      );
    });

    it('B006 (Rule 4 + 5.4): same-tier DISPATCH disagreement (DATABASE vs API) -> CONFLICT, both records marked CONFLICT', () => {
      const dbRecord: SourceRecordInput = {
        id: 'sr-db',
        sourceId: 'db-1',
        sourceType: 'DATABASE',
        sourceRecordId: 'biz-db',
        batchId: 'B006',
        station: 'DISPATCH',
        quantity: 500,
        eventTime: minutes(0),
        receivedAt: minutes(0),
      };
      const apiRecord: SourceRecordInput = {
        id: 'sr-api',
        sourceId: 'api-1',
        sourceType: 'API',
        sourceRecordId: 'biz-api',
        batchId: 'B006',
        station: 'DISPATCH',
        quantity: 480,
        eventTime: minutes(0),
        receivedAt: minutes(0),
      };

      const result = resolveGroup([dbRecord, apiRecord]);

      expect(result.event.status).toBe('CONFLICT');
      expect(result.event.canonicalKey).toBe('B006:DISPATCH');
      expect(result.sources).toEqual(
        expect.arrayContaining([
          { sourceRecordPk: 'sr-db', relationship: 'CONFLICT' },
          { sourceRecordPk: 'sr-api', relationship: 'CONFLICT' },
        ]),
      );
    });

    it('Same-tier corroboration (Rule 5.5): DATABASE and API agree -> ACCEPTED, not CONFLICT', () => {
      const dbRecord: SourceRecordInput = {
        id: 'sr-db',
        sourceId: 'db-1',
        sourceType: 'DATABASE',
        sourceRecordId: 'biz-db',
        batchId: 'B-CORROB',
        station: 'DISPATCH',
        quantity: 300,
        eventTime: minutes(0),
        receivedAt: minutes(0),
      };
      const apiRecord: SourceRecordInput = {
        id: 'sr-api',
        sourceId: 'api-1',
        sourceType: 'API',
        sourceRecordId: 'biz-api',
        batchId: 'B-CORROB',
        station: 'DISPATCH',
        quantity: 300,
        eventTime: minutes(2),
        receivedAt: minutes(2),
      };

      const result = resolveGroup([dbRecord, apiRecord]);

      expect(result.event.status).toBe('ACCEPTED');
      expect(result.event.quantity).toBe(300);
      expect(result.sources).toEqual(
        expect.arrayContaining([
          { sourceRecordPk: 'sr-api', relationship: 'PRIMARY' },
          { sourceRecordPk: 'sr-db', relationship: 'DUPLICATE' },
        ]),
      );
    });
  });

  describe('groupByOperationalIdentity + resolveAll (Rule 2)', () => {
    it('groups strictly by batchId:station, independent of sourceRecordId', () => {
      const records: SourceRecordInput[] = [
        {
          id: 'sr-1',
          sourceId: 'db-1',
          sourceType: 'DATABASE',
          sourceRecordId: 'biz-a',
          batchId: 'B001',
          station: 'RECEIVING',
          quantity: 10,
          eventTime: minutes(0),
          receivedAt: minutes(0),
        },
        {
          id: 'sr-2',
          sourceId: 'db-1',
          sourceType: 'DATABASE',
          sourceRecordId: 'biz-b',
          batchId: 'B001',
          station: 'SORTING',
          quantity: 20,
          eventTime: minutes(0),
          receivedAt: minutes(0),
        },
      ];

      const groups = groupByOperationalIdentity(records);

      expect(groups.size).toBe(2);
      expect(groups.get('B001:RECEIVING')).toHaveLength(1);
      expect(groups.get('B001:SORTING')).toHaveLength(1);
      expect(resolveAll(records)).toHaveLength(2);
    });
  });

  describe('deriveQualityIndicators (Rule 5b — generation only)', () => {
    it('Quality indicator: B006 CONFLICT produces exactly one unacknowledged DISPATCH_CONFLICT indicator', () => {
      const dbRecord: SourceRecordInput = {
        id: 'sr-db',
        sourceId: 'db-1',
        sourceType: 'DATABASE',
        sourceRecordId: 'biz-db',
        batchId: 'B006',
        station: 'DISPATCH',
        quantity: 500,
        eventTime: minutes(0),
        receivedAt: minutes(0),
      };
      const apiRecord: SourceRecordInput = {
        id: 'sr-api',
        sourceId: 'api-1',
        sourceType: 'API',
        sourceRecordId: 'biz-api',
        batchId: 'B006',
        station: 'DISPATCH',
        quantity: 480,
        eventTime: minutes(0),
        receivedAt: minutes(0),
      };

      const result = resolveGroup([dbRecord, apiRecord]);
      const indicators = deriveQualityIndicators([result.event]);

      expect(indicators).toEqual([
        {
          canonicalKey: 'B006:DISPATCH',
          code: 'DISPATCH_CONFLICT',
          acknowledged: false,
        },
      ]);
    });

    it('no indicator is produced for ACCEPTED results', () => {
      const record: SourceRecordInput = {
        id: 'sr-1',
        sourceId: 'db-1',
        sourceType: 'DATABASE',
        sourceRecordId: 'biz-1',
        batchId: 'B000',
        station: 'RECEIVING',
        quantity: 100,
        eventTime: minutes(0),
        receivedAt: minutes(0),
      };

      const result = resolveGroup([record]);

      expect(deriveQualityIndicators([result.event])).toEqual([]);
    });
  });
});
