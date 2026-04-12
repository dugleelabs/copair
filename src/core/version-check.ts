import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const _dir = dirname(fileURLToPath(import.meta.url));
const _require = createRequire(import.meta.url);
const pkg = (() => {
  for (const rel of ['../package.json', '../../package.json']) {
    try { return _require(resolve(_dir, rel)) as { name: string; version: string }; } catch { /* skip */ }
  }
  return { name: 'copair', version: process.env['COPAIR_VERSION'] ?? '0.0.0-dev' };
})();

const CACHE_DIR = resolve(process.env['HOME'] ?? '~', '.copair');
const CACHE_FILE = join(CACHE_DIR, 'version-check.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface VersionCache {
  latest: string;
  checkedAt: string;
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg.name}/latest`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version: string };
    return data.version;
  } catch {
    return null;
  }
}

async function readCache(): Promise<VersionCache | null> {
  if (!existsSync(CACHE_FILE)) return null;
  try {
    const raw = await readFile(CACHE_FILE, 'utf8');
    return JSON.parse(raw) as VersionCache;
  } catch {
    return null;
  }
}

async function writeCache(latest: string): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(
      CACHE_FILE,
      JSON.stringify({ latest, checkedAt: new Date().toISOString() }),
      'utf8',
    );
  } catch {
    // Non-fatal
  }
}

function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.split('.').map(Number);
  const [lMaj, lMin, lPat] = parse(latest);
  const [cMaj, cMin, cPat] = parse(current);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

/**
 * Non-blocking version check. Runs in the background and prints a notice
 * if a newer version is available. Safe to fire-and-forget.
 */
export function checkForUpdates(): void {
  void (async () => {
    try {
      const cache = await readCache();
      const now = Date.now();

      let latest: string | null = null;

      if (cache && now - new Date(cache.checkedAt).getTime() < CACHE_TTL_MS) {
        latest = cache.latest;
      } else {
        latest = await fetchLatestVersion();
        if (latest) await writeCache(latest);
      }

      if (latest && isNewer(latest, pkg.version)) {
        process.stderr.write(
          `\nUpdate available: ${pkg.version} → ${latest}  (npm i -g ${pkg.name})\n\n`,
        );
      }
    } catch {
      // Never surface version-check errors to the user
    }
  })();
}
