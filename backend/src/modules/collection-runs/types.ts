// Shape of Source.config (jsonb) for a fixture-api-backed source (Step 6).
// `apiKeyEnvVar` is the NAME of the env var holding the real secret, never
// the secret itself — see CollectionRunsService.runCollection. `fault` is
// optional fault-injection config (docs/plan-v4.md §6), not sensitive.
export interface FixtureApiSourceConfig {
  baseUrl: string;
  apiKeyEnvVar: string;
  fault?: string;
}

// Shape of Source.config (jsonb) for a supplier-portal-backed source (Step
// 8). No secret/env-var field here at all — unlike FixtureApiSourceConfig
// and DatabaseSourceConfig, the supplier portal is an unauthenticated
// public page per the assessment's own wording ("a locally hosted,
// paginated supplier page"), so there is nothing to keep out of DB/logs.
// `fault` mirrors FixtureApiSourceConfig.fault — fixture-only fault
// injection, not sensitive.
export interface CrawlerSourceConfig {
  baseUrl: string;
  fault?: string;
}
