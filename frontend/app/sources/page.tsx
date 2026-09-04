'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ApiError,
  CreatableSourceType,
  Source,
  createSource,
  listSources,
} from '@/lib/api';

type ListState =
  | { phase: 'loading' }
  | { phase: 'success'; data: Source[] }
  | { phase: 'error'; message: string };

// Config field shape per type — mirrors backend/src/modules/collection-runs/
// types.ts's FixtureApiSourceConfig/CrawlerSourceConfig and
// database-source-client.ts's DatabaseSourceConfig exactly. No field ever
// holds a literal secret — only *EnvVar fields (the NAME of an env var the
// backend resolves the real secret from at call time), per the secret
// handling design documented in README's Step 6/7 "Quyết định phát sinh".
const DEFAULT_CONFIG_BY_TYPE: Record<CreatableSourceType, Record<string, string>> = {
  API: { baseUrl: '', apiKeyEnvVar: '', fault: '' },
  DATABASE: {
    host: '',
    port: '',
    database: '',
    user: '',
    passwordEnvVar: '',
  },
  CRAWLER: { baseUrl: '', fault: '' },
};

export default function SourcesPage() {
  const [list, setList] = useState<ListState>({ phase: 'loading' });
  const [name, setName] = useState('');
  const [type, setType] = useState<CreatableSourceType>('API');
  const [config, setConfig] = useState<Record<string, string>>(
    DEFAULT_CONFIG_BY_TYPE.API,
  );
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // fetchList vs refresh: the mount effect below must not call setState
  // synchronously in its own body (react-hooks/set-state-in-effect) — the
  // initial useState value is already 'loading', so fetchList (fetch, then
  // setState only inside .then/.catch) is enough there. refresh() (used
  // after a mutation, from event handlers, not an effect) explicitly resets
  // to 'loading' first since it may be re-fetching from a non-loading state.
  function fetchList() {
    listSources()
      .then((data) => setList({ phase: 'success', data }))
      .catch((err: unknown) =>
        setList({
          phase: 'error',
          message: err instanceof ApiError ? err.message : 'Không kết nối được backend',
        }),
      );
  }

  function refresh() {
    setList({ phase: 'loading' });
    fetchList();
  }

  useEffect(fetchList, []);

  function handleTypeChange(next: CreatableSourceType) {
    setType(next);
    setConfig(DEFAULT_CONFIG_BY_TYPE[next]);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      // Strip empty optional fields (fault) so they aren't sent as ''.
      const cleanedConfig: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(config)) {
        if (value === '') continue;
        cleanedConfig[key] = key === 'port' ? Number(value) : value;
      }
      await createSource({ name, type, config: cleanedConfig });
      setName('');
      setConfig(DEFAULT_CONFIG_BY_TYPE[type]);
      refresh();
    } catch (err) {
      setCreateError(
        err instanceof ApiError ? err.message : 'Tạo source thất bại',
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <main style={{ padding: '2rem', maxWidth: 960, margin: '0 auto' }}>
      <p>
        <Link href="/">← Health check</Link>
      </p>
      <h1>Data Sources</h1>

      <section style={{ marginBottom: '2rem' }}>
        <h2>Sources</h2>
        {list.phase === 'loading' && <p>Đang tải...</p>}
        {list.phase === 'error' && (
          <p style={{ color: 'red' }}>Lỗi: {list.message}</p>
        )}
        {list.phase === 'success' && (
          <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Verified</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.data.length === 0 && (
                <tr>
                  <td colSpan={4}>Chưa có source nào.</td>
                </tr>
              )}
              {list.data.map((source) => (
                <tr key={source.id}>
                  <td>{source.name}</td>
                  <td>{source.type}</td>
                  <td>
                    {source.verifiedAt
                      ? new Date(source.verifiedAt).toLocaleString()
                      : 'chưa verify'}
                  </td>
                  <td>
                    <Link href={`/sources/${source.id}`}>Manage</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Register new source</h2>
        <form onSubmit={handleCreate}>
          <div style={{ marginBottom: '0.5rem' }}>
            <label>
              Name{' '}
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          </div>
          <div style={{ marginBottom: '0.5rem' }}>
            <label>
              Type{' '}
              <select
                value={type}
                onChange={(e) =>
                  handleTypeChange(e.target.value as CreatableSourceType)
                }
              >
                <option value="API">API (Application API)</option>
                <option value="DATABASE">DATABASE (Production Database)</option>
                <option value="CRAWLER">CRAWLER (Supplier Portal)</option>
              </select>
            </label>
          </div>

          {Object.keys(config).map((field) => (
            <div key={field} style={{ marginBottom: '0.5rem' }}>
              <label>
                {field}
                {field === 'passwordEnvVar' || field === 'apiKeyEnvVar'
                  ? ' (tên biến môi trường chứa secret, KHÔNG nhập giá trị thật)'
                  : ''}
                {field === 'fault' ? ' (optional)' : ''}
                {' '}
                <input
                  required={field !== 'fault'}
                  type={field === 'port' ? 'number' : 'text'}
                  value={config[field]}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, [field]: e.target.value }))
                  }
                />
              </label>
            </div>
          ))}

          <button type="submit" disabled={creating}>
            {creating ? 'Đang tạo...' : 'Register source'}
          </button>
          {createError && (
            <p style={{ color: 'red' }}>Lỗi: {createError}</p>
          )}
        </form>
      </section>
    </main>
  );
}
