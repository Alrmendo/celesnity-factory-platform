'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { ApiError, CanonicalEvent, listCanonicalEvents } from '@/lib/api';

type State =
  | { phase: 'loading' }
  | { phase: 'success'; data: CanonicalEvent[] }
  | { phase: 'error'; message: string };

// Preview normalized records (= canonical_events, Rule 2/5's output) with
// their source + collection-run provenance — item 6 of the "Required
// Collection Workflow" checklist. Filters come from the URL
// (?batchId=&sourceId=&collectionRunId=), typically arrived at by clicking
// "Preview" on a collection run row in /sources/[id] — no filter form here
// per the task spec ("có thể chỉ cần link đơn giản").
export default function CanonicalEventsPage({
  searchParams,
}: {
  searchParams: Promise<{
    batchId?: string;
    sourceId?: string;
    collectionRunId?: string;
  }>;
}) {
  const filters = use(searchParams);
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    // No synchronous setState here (react-hooks/set-state-in-effect) —
    // initial state is already 'loading'; setState only happens inside
    // .then/.catch below.
    listCanonicalEvents(filters)
      .then((data) => setState({ phase: 'success', data }))
      .catch((err: unknown) =>
        setState({
          phase: 'error',
          message: err instanceof ApiError ? err.message : 'Request thất bại',
        }),
      );
    // filters is a plain object from the URL — re-run whenever any of the 3
    // values actually change, not on every render (new object identity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.batchId, filters.sourceId, filters.collectionRunId]);

  const hasFilter = filters.batchId || filters.sourceId || filters.collectionRunId;

  return (
    <main style={{ padding: '2rem', maxWidth: 960, margin: '0 auto' }}>
      <p>
        <Link href="/sources">← Sources</Link>
      </p>
      <h1>Normalized record preview</h1>
      <p>
        Filter:{' '}
        {hasFilter
          ? [
              filters.batchId && `batchId=${filters.batchId}`,
              filters.sourceId && `sourceId=${filters.sourceId}`,
              filters.collectionRunId && `collectionRunId=${filters.collectionRunId}`,
            ]
              .filter(Boolean)
              .join(', ')
          : '(không có — hiển thị toàn bộ canonical_events)'}
      </p>

      {state.phase === 'loading' && <p>Đang tải...</p>}
      {state.phase === 'error' && (
        <p style={{ color: 'red' }}>Lỗi: {state.message}</p>
      )}
      {state.phase === 'success' && (
        <>
          {state.data.length === 0 && <p>Không có canonical event nào khớp filter.</p>}
          {state.data.map((event) => (
            <section
              key={event.id}
              style={{ border: '1px solid #ccc', padding: '1rem', marginBottom: '1rem' }}
            >
              <h2>
                {event.canonicalKey}{' '}
                <span
                  style={{
                    color: event.status === 'CONFLICT' ? 'red' : 'green',
                  }}
                >
                  [{event.status}]
                </span>
              </h2>
              <p>
                batchId={event.batchId} · station={event.station} · quantity=
                {event.quantity} · eventTime=
                {new Date(event.eventTime).toLocaleString()} · updatedAt=
                {new Date(event.updatedAt).toLocaleString()}
              </p>

              <h3>Provenance (source records + collection runs)</h3>
              <table border={1} cellPadding={4} style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    <th>Relationship</th>
                    <th>Source</th>
                    <th>Source type</th>
                    <th>Source record id</th>
                    <th>Collection run</th>
                    <th>Event time</th>
                    <th>Received at</th>
                  </tr>
                </thead>
                <tbody>
                  {event.sources.map((s) => (
                    <tr key={s.sourceRecordPk}>
                      <td>{s.relationship}</td>
                      <td>
                        <Link href={`/sources/${s.sourceId}`}>{s.sourceName}</Link>
                      </td>
                      <td>{s.sourceType}</td>
                      <td>{s.sourceRecordId}</td>
                      <td>
                        <Link
                          href={`/canonical-events?collectionRunId=${s.collectionRunId}`}
                        >
                          {s.collectionRunId}
                        </Link>
                      </td>
                      <td>{new Date(s.eventTime).toLocaleString()}</td>
                      <td>{new Date(s.receivedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
