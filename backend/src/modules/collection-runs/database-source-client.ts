// Thin client for the Step 7 "Production Database" collector — mirrors
// fixture-api-client.ts's role for Step 6 (Application API): this file
// only knows how to talk to the target Postgres database (connect once,
// do one thing, close); connection lifecycle and error handling for the
// collection run itself live in SourcesService/CollectionRunsService.
//
// Deliberately NOT Prisma: Prisma Client is bound to a schema fixed at
// `prisma generate` time, but "Discover available tables and columns" (the
// assessment's own wording) requires genuine runtime introspection of a
// database whose shape isn't known until the operator registers it — so
// this uses the `pg` driver directly (already a dependency, used by
// DatabaseModule for /health) against `information_schema`.

import { Pool } from 'pg';
import { Station } from '../canonicalization/types';

// Shape of Source.config (jsonb) for a Production-Database-backed source
// (Step 7). `passwordEnvVar` is the NAME of the env var holding the real
// credential, never the credential itself — same pattern as Step 6's
// FixtureApiSourceConfig.apiKeyEnvVar. `selectedTable` is set by
// SourcesService.selectTable() after a real discoverSchema() call
// confirms it's a real table — never trusted from raw client input at
// collect time (see collectFromTable below).
export interface DatabaseSourceConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  passwordEnvVar: string;
  selectedTable?: string;
}

export class DatabaseSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseSourceError';
  }
}

// Only letters/digits/underscore, not starting with a digit — same
// identifier shape Postgres itself requires for an unquoted table name.
// `selectedTable` only ever reaches here after SourcesService.selectTable
// validated it against a real discoverSchema() result, but this is
// defense in depth against any future caller that skips that step: never
// interpolate an unvalidated string into SQL.
const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function buildPool(config: DatabaseSourceConfig, password: string): Pool {
  // A fresh, tiny pool per call — this connects on demand for a single
  // verify/discover/collect operation against a source the operator just
  // registered, not a long-lived shared connection.
  return new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password,
    max: 1,
    connectionTimeoutMillis: 3000,
  });
}

export interface DiscoveredColumn {
  name: string;
  dataType: string;
}

export interface DiscoveredTable {
  table: string;
  columns: DiscoveredColumn[];
}

export interface ProductionTableRow {
  id: number | string;
  batch_id: string;
  station: string;
  quantity: number;
  event_time: Date;
}

export async function verifyConnection(
  config: DatabaseSourceConfig,
  password: string,
): Promise<void> {
  const pool = buildPool(config, password);
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    throw new DatabaseSourceError(
      `connection failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    await pool.end();
  }
}

export async function discoverSchema(
  config: DatabaseSourceConfig,
  password: string,
): Promise<DiscoveredTable[]> {
  const pool = buildPool(config, password);
  try {
    const tablesResult = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );

    const tables: DiscoveredTable[] = [];
    for (const row of tablesResult.rows) {
      const columnsResult = await pool.query<{
        column_name: string;
        data_type: string;
      }>(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position`,
        [row.table_name],
      );
      tables.push({
        table: row.table_name,
        columns: columnsResult.rows.map((c) => ({
          name: c.column_name,
          dataType: c.data_type,
        })),
      });
    }
    return tables;
  } catch (err) {
    if (err instanceof DatabaseSourceError) {
      throw err;
    }
    throw new DatabaseSourceError(
      `discover failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    await pool.end();
  }
}

export async function collectFromTable(
  config: DatabaseSourceConfig,
  password: string,
  tableName: string,
): Promise<ProductionTableRow[]> {
  if (!SAFE_IDENTIFIER.test(tableName)) {
    throw new DatabaseSourceError(`invalid table name "${tableName}"`);
  }

  const pool = buildPool(config, password);
  try {
    // Table name is validated above; quoted+escaped defensively even
    // though SAFE_IDENTIFIER already rules out injection-shaped input.
    const result = await pool.query<ProductionTableRow>(
      `SELECT * FROM "${tableName.replace(/"/g, '""')}"`,
    );
    return result.rows;
  } catch (err) {
    if (err instanceof DatabaseSourceError) {
      throw err;
    }
    throw new DatabaseSourceError(
      `collect failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    await pool.end();
  }
}

// station_readings' `station` column is trusted as a valid Station value
// (seeded data, see production-db/init.sql) — same trust level as
// fixture-api's fixed event shape in Step 6, no runtime validation added
// here for the same reason: this is a fixture standing in for a real
// production DB, not user input.
export function isStationValue(value: string): value is Station {
  return (
    value === 'RECEIVING' ||
    value === 'SORTING' ||
    value === 'WASHING' ||
    value === 'DRYING' ||
    value === 'FOLDING' ||
    value === 'DISPATCH'
  );
}
