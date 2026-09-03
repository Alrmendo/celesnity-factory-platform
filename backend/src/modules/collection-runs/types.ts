// Shape of Source.config (jsonb) for a fixture-api-backed source (Step 6).
// `apiKeyEnvVar` is the NAME of the env var holding the real secret, never
// the secret itself — see CollectionRunsService.runCollection. `fault` is
// optional fault-injection config (docs/plan-v4.md §6), not sensitive.
export interface FixtureApiSourceConfig {
  baseUrl: string;
  apiKeyEnvVar: string;
  fault?: string;
}
