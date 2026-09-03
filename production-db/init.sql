-- Step 7 fixture: seed data for the "Production Database" — a genuinely
-- separate Postgres instance (docker-compose service `production-db`,
-- image postgres:16-alpine, no custom Dockerfile needed) standing in for
-- the factory's own production line database, per the assessment's
-- required-sources list ("a locally hosted PostgreSQL or MySQL database
-- provided through Docker Compose"). Auto-runs on first container start
-- via Postgres's own /docker-entrypoint-initdb.d/ mechanism (mounted
-- read-only in docker-compose.yml) — no application code involved.
--
-- `station_readings` is the ONE real production table the Step 7 collector
-- is meant to discover + select + collect from (docs/plan-v4.md's Rule 4:
-- SORTING/WASHING/DRYING/FOLDING are single-source via Production
-- Database in this implementation's scope; RECEIVING is out of scope here
-- per the same scope decision, DISPATCH is Tier 1 shared with Application
-- API). `machines`/`employees` are deliberate decoys with no relation to
-- collection — they exist so "discover tables" and "select ONE table" are
-- genuinely meaningful (more than 1 table to choose from), not hardcoded
-- to "the only table that exists".
--
-- batch_id values are namespaced (PDB-*) to stay clearly separate from
-- backend/test/fixtures/batch-scenarios.ts's B001-B008 fixture set — these
-- are two independent fixture systems (this one seeds a real external DB
-- for the collector to query; that one seeds source_records directly via
-- Prisma to test canonicalization) and were never meant to share batch ids.

CREATE TABLE station_readings (
  id         SERIAL PRIMARY KEY,
  batch_id   VARCHAR(64) NOT NULL,
  station    VARCHAR(32) NOT NULL,
  quantity   INTEGER NOT NULL,
  event_time TIMESTAMPTZ NOT NULL
);

CREATE TABLE machines (
  id      SERIAL PRIMARY KEY,
  name    VARCHAR(64) NOT NULL,
  line_id VARCHAR(32) NOT NULL
);

CREATE TABLE employees (
  id        SERIAL PRIMARY KEY,
  full_name VARCHAR(128) NOT NULL,
  role      VARCHAR(64) NOT NULL
);

INSERT INTO station_readings (batch_id, station, quantity, event_time) VALUES
  ('PDB-B001', 'SORTING', 100, '2026-01-01T00:01:00Z'),
  ('PDB-B001', 'WASHING', 98,  '2026-01-01T00:02:00Z'),
  ('PDB-B001', 'DRYING',  98,  '2026-01-01T00:03:00Z'),
  ('PDB-B001', 'FOLDING', 97,  '2026-01-01T00:04:00Z'),
  ('PDB-B002', 'SORTING', 50,  '2026-01-01T00:01:00Z'),
  ('PDB-B002', 'WASHING', 50,  '2026-01-01T00:02:00Z');

INSERT INTO machines (name, line_id) VALUES
  ('Sorter-1', 'LINE-1'),
  ('Washer-1', 'LINE-1');

INSERT INTO employees (full_name, role) VALUES
  ('Nguyen Van A', 'Operator');
