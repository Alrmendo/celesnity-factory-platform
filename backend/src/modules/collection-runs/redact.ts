// Defense in depth for the secret-regression requirement (docs/plan-v4.md
// §6): fetchFixtureEvents never puts the API key into an error string by
// construction, so this should be a no-op in practice. Applied anyway
// before persisting/logging errorMessage in case a future error path (e.g.
// a lower-level network error echoing request details) starts doing so.
export function redactSecret(text: string, secret: string | undefined): string {
  if (!secret) {
    return text;
  }
  return text.split(secret).join('[REDACTED]');
}
