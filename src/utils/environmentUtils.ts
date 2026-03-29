/**
 * Detect whether copair is running in a CI / non-interactive environment.
 *
 * Returns true when any of:
 *   - stdin is not a TTY (piped or redirected)
 *   - the CI env var is set (standard for most CI providers)
 *   - COPAIR_CI=1 is explicitly set
 */
export function isCI(): boolean {
  return (
    !process.stdin.isTTY ||
    !!process.env['CI'] ||
    process.env['COPAIR_CI'] === '1'
  );
}
