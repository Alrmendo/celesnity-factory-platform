'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import {
  ApiError,
  CollectionRun,
  CollectionRunHistoryEntry,
  DiscoverResult,
  Source,
  discoverSource,
  getSource,
  isDiscoveredTables,
  listCollectionRuns,
  runCollection,
  selectSourceTable,
  verifySource,
} from '@/lib/api';

// Async action wrapper: 'idle' before first click, then loading/success/error
// per click. Each of Verify/Discover/Select/Run has its own independent one
// below — simplest thing that shows a basic loading state per the task spec
// ("loading state cơ bản"), no shared reducer/state machine given how little
// time is left.
type Action<T> =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'success'; data: T }
  | { phase: 'error'; message: string };

// Same shape minus 'idle' — used for data fetched automatically on mount
// (source, history), which is always 'loading' first, never 'idle'.
type LoadState<T> =
  | { phase: 'loading' }
  | { phase: 'success'; data: T }
  | { phase: 'error'; message: string };

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Request thất bại';
}

export default function SourceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [source, setSource] = useState<LoadState<Source>>({ phase: 'loading' });
  const [verify, setVerify] = useState<Action<Source>>({ phase: 'idle' });
  const [discover, setDiscover] = useState<Action<DiscoverResult>>({
    phase: 'idle',
  });
  const [selectedTable, setSelectedTable] = useState('');
  const [select, setSelect] = useState<Action<Source>>({ phase: 'idle' });
  const [run, setRun] = useState<Action<CollectionRun>>({ phase: 'idle' });
  const [history, setHistory] = useState<LoadState<CollectionRunHistoryEntry[]>>({
    phase: 'loading',
  });

  // fetchX vs refreshX: the mount effect below must not call setState
  // synchronously in its own body (react-hooks/set-state-in-effect) — the
  // initial useState values are already 'loading', so fetchSource/
  // fetchHistory (fetch, then setState only inside .then/.catch) are enough
  // there. refreshSource/refreshHistory (used after a mutation, from event
  // handlers, not an effect) explicitly reset to 'loading' first.
  function fetchSource() {
    getSource(id)
      .then((data) => setSource({ phase: 'success', data }))
      .catch((err: unknown) =>
        setSource({ phase: 'error', message: errorMessage(err) }),
      );
  }
  function refreshSource() {
    setSource({ phase: 'loading' });
    fetchSource();
  }

  function fetchHistory() {
    listCollectionRuns(id)
      .then((data) => setHistory({ phase: 'success', data }))
      .catch((err: unknown) =>
        setHistory({ phase: 'error', message: errorMessage(err) }),
      );
  }
  function refreshHistory() {
    setHistory({ phase: 'loading' });
    fetchHistory();
  }

  useEffect(() => {
    fetchSource();
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleVerify() {
    setVerify({ phase: 'loading' });
    try {
      const data = await verifySource(id);
      setVerify({ phase: 'success', data });
      refreshSource();
    } catch (err) {
      setVerify({ phase: 'error', message: errorMessage(err) });
    }
  }

  async function handleDiscover() {
    setDiscover({ phase: 'loading' });
    try {
      const data = await discoverSource(id);
      setDiscover({ phase: 'success', data });
    } catch (err) {
      setDiscover({ phase: 'error', message: errorMessage(err) });
    }
  }

  async function handleSelect() {
    if (!selectedTable) return;
    setSelect({ phase: 'loading' });
    try {
      const data = await selectSourceTable(id, selectedTable);
      setSelect({ phase: 'success', data });
      refreshSource();
    } catch (err) {
      setSelect({ phase: 'error', message: errorMessage(err) });
    }
  }

  async function handleRun() {
    setRun({ phase: 'loading' });
    try {
      const data = await runCollection(id);
      setRun({ phase: 'success', data });
      refreshHistory();
    } catch (err) {
      setRun({ phase: 'error', message: errorMessage(err) });
    }
  }

  if (source.phase === 'loading') {
    return (
      <main style={{ padding: '2rem' }}>
        <p>Đang tải...</p>
      </main>
    );
  }
  if (source.phase === 'error') {
    return (
      <main style={{ padding: '2rem' }}>
        <p style={{ color: 'red' }}>Lỗi: {source.message}</p>
      </main>
    );
  }

  const current = source.data;
  // Verify/Discover only apply to DATABASE (Step 7) and CRAWLER (Step 8) —
  // SourcesService.verifyConnection/discoverSchema reject API/MQTT with a
  // 400 (see resolveDatabaseConfig's type check), so this UI never offers
  // those buttons for API sources.
  const supportsVerifyDiscover =
    current.type === 'DATABASE' || current.type === 'CRAWLER';
  // Select ("choose a table to collect from") only applies to DATABASE —
  // CRAWLER has exactly one deliveries feed, nothing to choose between.
  const supportsSelect = current.type === 'DATABASE';

  return (
    <main style={{ padding: '2rem', maxWidth: 960, margin: '0 auto' }}>
      <p>
        <Link href="/sources">← Sources</Link>
      </p>
      <h1>{current.name}</h1>
      <p>
        Type: <strong>{current.type}</strong> · Verified:{' '}
        {current.verifiedAt
          ? new Date(current.verifiedAt).toLocaleString()
          : 'chưa verify'}
      </p>
      <pre style={{ background: '#f4f4f4', padding: '0.5rem' }}>
        {JSON.stringify(current.config, null, 2)}
      </pre>

      {supportsVerifyDiscover && (
        <section style={{ marginBottom: '1.5rem' }}>
          <h2>Verify connection</h2>
          <button onClick={handleVerify} disabled={verify.phase === 'loading'}>
            {verify.phase === 'loading' ? 'Đang verify...' : 'Verify'}
          </button>
          {verify.phase === 'success' && (
            <p style={{ color: 'green' }}>
              Verify thành công lúc{' '}
              {verify.data.verifiedAt
                ? new Date(verify.data.verifiedAt).toLocaleString()
                : '—'}
            </p>
          )}
          {verify.phase === 'error' && (
            <p style={{ color: 'red' }}>Verify thất bại: {verify.message}</p>
          )}
        </section>
      )}

      {supportsVerifyDiscover && (
        <section style={{ marginBottom: '1.5rem' }}>
          <h2>Discover schema</h2>
          <button onClick={handleDiscover} disabled={discover.phase === 'loading'}>
            {discover.phase === 'loading' ? 'Đang discover...' : 'Discover'}
          </button>
          {discover.phase === 'error' && (
            <p style={{ color: 'red' }}>Discover thất bại: {discover.message}</p>
          )}
          {discover.phase === 'success' &&
            (isDiscoveredTables(discover.data) ? (
              <table border={1} cellPadding={4} style={{ borderCollapse: 'collapse', marginTop: '0.5rem' }}>
                <thead>
                  <tr>
                    <th>Table</th>
                    <th>Columns</th>
                  </tr>
                </thead>
                <tbody>
                  {discover.data.map((t) => (
                    <tr key={t.table}>
                      <td>{t.table}</td>
                      <td>
                        {t.columns.map((c) => `${c.name} (${c.dataType})`).join(', ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>
                Reachable: {String(discover.data.reachable)} · Total pages:{' '}
                {discover.data.totalPages}
              </p>
            ))}
        </section>
      )}

      {supportsSelect && (
        <section style={{ marginBottom: '1.5rem' }}>
          <h2>Select table to collect</h2>
          {discover.phase !== 'success' || !isDiscoveredTables(discover.data) ? (
            <p>Chạy Discover ở trên trước để xem danh sách bảng.</p>
          ) : (
            <>
              <select
                value={selectedTable}
                onChange={(e) => setSelectedTable(e.target.value)}
              >
                <option value="">-- chọn bảng --</option>
                {discover.data.map((t) => (
                  <option key={t.table} value={t.table}>
                    {t.table}
                  </option>
                ))}
              </select>{' '}
              <button
                onClick={handleSelect}
                disabled={!selectedTable || select.phase === 'loading'}
              >
                {select.phase === 'loading' ? 'Đang chọn...' : 'Select'}
              </button>
            </>
          )}
          {typeof current.config.selectedTable === 'string' && (
            <p>Bảng đang chọn hiện tại: {String(current.config.selectedTable)}</p>
          )}
          {select.phase === 'error' && (
            <p style={{ color: 'red' }}>Select thất bại: {select.message}</p>
          )}
        </section>
      )}

      <section style={{ marginBottom: '1.5rem' }}>
        <h2>Run collection</h2>
        <button onClick={handleRun} disabled={run.phase === 'loading'}>
          {run.phase === 'loading' ? 'Đang chạy...' : 'Run collection'}
        </button>
        {run.phase === 'success' && (
          <p>
            Kết quả: <strong>{run.data.status}</strong> · recordsRead=
            {run.data.recordsRead} · errorCount={run.data.errorCount}
            {run.data.errorMessage ? ` · errorMessage=${run.data.errorMessage}` : ''}
          </p>
        )}
        {run.phase === 'error' && (
          <p style={{ color: 'red' }}>Chạy collection thất bại: {run.message}</p>
        )}
      </section>

      <section>
        <h2>Collection run history</h2>
        {history.phase === 'loading' && <p>Đang tải...</p>}
        {history.phase === 'error' && (
          <p style={{ color: 'red' }}>Lỗi: {history.message}</p>
        )}
        {history.phase === 'success' && (
          <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th>Started</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Records</th>
                <th>Errors</th>
                <th>Error message</th>
                <th>Preview</th>
              </tr>
            </thead>
            <tbody>
              {history.data.length === 0 && (
                <tr>
                  <td colSpan={7}>Chưa chạy lần nào.</td>
                </tr>
              )}
              {history.data.map((run) => (
                <tr key={run.id}>
                  <td>{new Date(run.startedAt).toLocaleString()}</td>
                  <td>{run.status}</td>
                  <td>
                    {run.durationMs === null ? '—' : `${run.durationMs} ms`}
                  </td>
                  <td>{run.recordsRead}</td>
                  <td>{run.errorCount}</td>
                  <td>{run.errorMessage ?? '—'}</td>
                  <td>
                    <Link
                      href={`/canonical-events?sourceId=${current.id}&collectionRunId=${run.id}`}
                    >
                      Preview
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
