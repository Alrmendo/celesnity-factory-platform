// Defense in depth for the secret-regression requirement (docs/plan-v4.md
// §6, "POST /sources, GET /sources/:id ... assert secret không xuất hiện").
// The real guarantee is architectural: Source.config is only ever supposed
// to hold connection metadata (baseUrl, the NAME of an env var to read the
// real key from — see collection-runs/types.ts's FixtureApiSourceConfig),
// never a literal secret value, per the schema.prisma comment on
// Source.config. This redacts any config value whose KEY looks
// secret-shaped anyway, in case a caller puts a literal secret in config by
// mistake — except a key ending in "envvar", which by convention holds an
// env var NAME (not a secret) and is meant to be visible.
const SECRET_KEY_PATTERN = /key|secret|token|password|credential/i;

export function sanitizeSourceConfig(config: unknown): unknown {
  if (config === null || typeof config !== 'object') {
    return config;
  }
  if (Array.isArray(config)) {
    return config.map(sanitizeSourceConfig);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(
    config as Record<string, unknown>,
  )) {
    const looksSecret =
      SECRET_KEY_PATTERN.test(key) && !key.toLowerCase().endsWith('envvar');
    result[key] =
      looksSecret && typeof value === 'string'
        ? '[REDACTED]'
        : sanitizeSourceConfig(value);
  }
  return result;
}
