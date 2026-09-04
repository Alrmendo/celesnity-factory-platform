'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import styles from './page.module.css';

type HealthResponse = {
  status: string;
  db: boolean;
};

type HealthState =
  | { phase: 'loading' }
  | { phase: 'success'; data: HealthResponse }
  | { phase: 'error'; message: string };

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function Home() {
  const [health, setHealth] = useState<HealthState>({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;

    fetch(`${API_URL}/health`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<HealthResponse>;
      })
      .then((data) => {
        if (!cancelled) setHealth({ phase: 'success', data });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setHealth({
            phase: 'error',
            message: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className={styles.main}>
      <h1>Celesnity Factory Platform</h1>
      <p>Backend health check ({API_URL}/health):</p>

      {health.phase === 'loading' && <p>Checking backend status...</p>}

      {health.phase === 'success' && (
        <pre>{JSON.stringify(health.data, null, 2)}</pre>
      )}

      {health.phase === 'error' && (
        <p style={{ color: 'red' }}>
          Could not reach backend: {health.message}
        </p>
      )}

      <p>
        <Link href="/sources">Data Sources →</Link>
      </p>
      <p>
        <Link href="/production-lines">Production Lines →</Link>
      </p>
    </main>
  );
}
