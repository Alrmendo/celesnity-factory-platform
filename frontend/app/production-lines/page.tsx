'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ApiError,
  ManagementEvent,
  ProductionLine,
  ProductionLineBatch,
  ackException,
  addNote,
  blockBatch,
  listProductionLines,
  resumeBatch,
} from '@/lib/api';

// Same LoadState/Action split as app/sources/[id]/page.tsx (Step 11) —
// LoadState for the mount-fetched line list (no 'idle', avoids
// react-hooks/set-state-in-effect by never setState-ing synchronously in
// the effect body), Action for each management button's own result.
type LoadState<T> =
  | { phase: 'loading' }
  | { phase: 'success'; data: T }
  | { phase: 'error'; message: string };

type Action<T> =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'success'; data: T }
  | { phase: 'error'; message: string };

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Request thất bại';
}

export default function ProductionLinesPage() {
  const [lines, setLines] = useState<LoadState<ProductionLine[]>>({
    phase: 'loading',
  });

  function fetchLines() {
    listProductionLines()
      .then((data) => setLines({ phase: 'success', data }))
      .catch((err: unknown) =>
        setLines({ phase: 'error', message: errorMessage(err) }),
      );
  }
  function refreshLines() {
    setLines({ phase: 'loading' });
    fetchLines();
  }

  useEffect(fetchLines, []);

  return (
    <main style={{ padding: '2rem', maxWidth: 1100, margin: '0 auto' }}>
      <p>
        <Link href="/">← Home</Link>
      </p>
      <h1>Production Lines</h1>

      {lines.phase === 'loading' && <p>Đang tải...</p>}
      {lines.phase === 'error' && (
        <p style={{ color: 'red' }}>Lỗi: {lines.message}</p>
      )}
      {lines.phase === 'success' && (
        <>
          {lines.data.length === 0 && (
            <p>Chưa có line nào (chưa có work order/batch nào trong DB).</p>
          )}
          {lines.data.map((line) => (
            <section key={line.lineId} style={{ marginBottom: '2.5rem' }}>
              <h2>Line: {line.lineId}</h2>

              <h3>WIP theo trạm</h3>
              <table
                border={1}
                cellPadding={6}
                style={{ borderCollapse: 'collapse', marginBottom: '1.5rem' }}
              >
                <thead>
                  <tr>
                    <th>Station</th>
                    <th>WIP</th>
                    <th>Batches</th>
                  </tr>
                </thead>
                <tbody>
                  {line.stations.map((s) => (
                    <tr key={s.station}>
                      <td>{s.station}</td>
                      <td>{s.wip}</td>
                      <td>{s.batchIds.join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h3>Batches</h3>
              {line.batches.length === 0 && <p>Không có batch nào trên line này.</p>}
              {line.batches.map((batch) => (
                <BatchCard
                  key={batch.batchId}
                  batch={batch}
                  onActionSuccess={refreshLines}
                />
              ))}
            </section>
          ))}
        </>
      )}
    </main>
  );
}

// One card per batch — progress/WIP/freshness/exceptions/provenance
// (checklist item 1) plus the 4 management actions (item 2), each with its
// own success/error line right under the button, same pattern as Verify/
// Select in app/sources/[id]/page.tsx (Step 11) — no toast/modal.
function BatchCard({
  batch,
  onActionSuccess,
}: {
  batch: ProductionLineBatch;
  onActionSuccess: () => void;
}) {
  const [actor, setActor] = useState('');
  const [noteText, setNoteText] = useState('');
  const [block, setBlock] = useState<Action<ManagementEvent>>({ phase: 'idle' });
  const [resume, setResume] = useState<Action<ManagementEvent>>({
    phase: 'idle',
  });
  const [ack, setAck] = useState<Action<ManagementEvent>>({ phase: 'idle' });
  const [note, setNote] = useState<Action<ManagementEvent>>({ phase: 'idle' });

  async function handleBlock() {
    setBlock({ phase: 'loading' });
    try {
      const data = await blockBatch(batch.batchId, actor);
      setBlock({ phase: 'success', data });
      onActionSuccess();
    } catch (err) {
      setBlock({ phase: 'error', message: errorMessage(err) });
    }
  }

  async function handleResume() {
    setResume({ phase: 'loading' });
    try {
      // Backend rejects (400) when the batch was never blocked — Step 9's
      // validation, surfaced with a real message since Step 11's "bổ sung"
      // fix (BadRequestException, not a plain Error).
      const data = await resumeBatch(batch.batchId, actor);
      setResume({ phase: 'success', data });
      onActionSuccess();
    } catch (err) {
      setResume({ phase: 'error', message: errorMessage(err) });
    }
  }

  async function handleAck() {
    setAck({ phase: 'loading' });
    try {
      const data = await ackException(batch.batchId, actor);
      setAck({ phase: 'success', data });
      onActionSuccess();
    } catch (err) {
      setAck({ phase: 'error', message: errorMessage(err) });
    }
  }

  async function handleNote() {
    setNote({ phase: 'loading' });
    try {
      const data = await addNote(batch.batchId, actor, noteText);
      setNote({ phase: 'success', data });
      setNoteText('');
      onActionSuccess();
    } catch (err) {
      setNote({ phase: 'error', message: errorMessage(err) });
    }
  }

  // "Acknowledge an exception" only makes sense (and only succeeds
  // backend-side) when the batch actually has a quality indicator —
  // ManagementEventsService.ackException 400s otherwise (Step 9). Hiding
  // the button when there's nothing to acknowledge, per the task spec.
  const hasExceptions = batch.qualityIndicators.length > 0;

  return (
    <section
      style={{ border: '1px solid #ccc', padding: '1rem', marginBottom: '1rem' }}
    >
      <h4>
        {batch.batchId} (work order {batch.workOrderId}){' '}
        <span
          style={{
            color:
              batch.state === 'BLOCKED'
                ? 'red'
                : batch.state === 'COMPLETED'
                  ? 'green'
                  : 'inherit',
          }}
        >
          [{batch.state}]
        </span>
      </h4>
      <p>
        currentStation: {batch.currentStation ?? '—'} · completedQuantity:{' '}
        {batch.completedQuantity ?? '—'}
      </p>
      {batch.missingStations.length > 0 && (
        <p>Thiếu dữ liệu tại: {batch.missingStations.join(', ')}</p>
      )}
      <p>
        Freshness: <strong>{batch.freshnessStatus}</strong>
        {batch.freshnessMinutes !== null && ` (${batch.freshnessMinutes} phút)`}{' '}
        · lastEventAt:{' '}
        {batch.lastEventAt ? new Date(batch.lastEventAt).toLocaleString() : '—'}
      </p>

      {hasExceptions && (
        <div>
          <strong>Exceptions:</strong>
          <ul>
            {batch.qualityIndicators.map((qi) => (
              <li key={qi.code}>
                {qi.code} — {qi.acknowledged ? 'đã acknowledge' : 'CHƯA acknowledge'}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p>
        Provenance ({batch.contributingSourceRecordIds.length} source record,{' '}
        {batch.contributingCollectionRunIds.length} collection run):{' '}
        <Link href={`/canonical-events?batchId=${batch.batchId}`}>
          xem chi tiết →
        </Link>
      </p>

      <div style={{ marginTop: '0.75rem' }}>
        <label>
          Actor:{' '}
          <input
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            placeholder="ví dụ: ops-1"
          />
        </label>
      </div>

      <div style={{ marginTop: '0.5rem' }}>
        <button onClick={handleBlock} disabled={!actor || block.phase === 'loading'}>
          {block.phase === 'loading' ? 'Đang block...' : 'Block'}
        </button>{' '}
        <button
          onClick={handleResume}
          disabled={!actor || resume.phase === 'loading'}
        >
          {resume.phase === 'loading' ? 'Đang resume...' : 'Resume'}
        </button>{' '}
        {hasExceptions && (
          <button onClick={handleAck} disabled={!actor || ack.phase === 'loading'}>
            {ack.phase === 'loading' ? 'Đang acknowledge...' : 'Acknowledge exception'}
          </button>
        )}
      </div>
      {block.phase === 'success' && (
        <p style={{ color: 'green' }}>
          Block thành công lúc {new Date(block.data.timestamp).toLocaleString()}
        </p>
      )}
      {block.phase === 'error' && (
        <p style={{ color: 'red' }}>Block thất bại: {block.message}</p>
      )}
      {resume.phase === 'success' && (
        <p style={{ color: 'green' }}>
          Resume thành công lúc {new Date(resume.data.timestamp).toLocaleString()}
        </p>
      )}
      {resume.phase === 'error' && (
        <p style={{ color: 'red' }}>Resume thất bại: {resume.message}</p>
      )}
      {ack.phase === 'success' && (
        <p style={{ color: 'green' }}>
          Acknowledge thành công lúc {new Date(ack.data.timestamp).toLocaleString()}
        </p>
      )}
      {ack.phase === 'error' && (
        <p style={{ color: 'red' }}>Acknowledge thất bại: {ack.message}</p>
      )}

      <div style={{ marginTop: '0.75rem' }}>
        <label>
          Note:{' '}
          <input
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="nội dung ghi chú"
          />
        </label>{' '}
        <button
          onClick={handleNote}
          disabled={!actor || !noteText || note.phase === 'loading'}
        >
          {note.phase === 'loading' ? 'Đang lưu...' : 'Add note'}
        </button>
      </div>
      {note.phase === 'success' && (
        <p style={{ color: 'green' }}>
          Note đã lưu lúc {new Date(note.data.timestamp).toLocaleString()}
        </p>
      )}
      {note.phase === 'error' && (
        <p style={{ color: 'red' }}>Add note thất bại: {note.message}</p>
      )}
    </section>
  );
}
