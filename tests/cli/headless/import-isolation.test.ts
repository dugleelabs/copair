/**
 * Regression — headless import isolation (spec 047, T-R1 / T-15 / US-4).
 *
 * The headless path must never pull in a TTY/UI surface: a no-TTY run that
 * transitively loaded ink/React/readline/tty-prompt could touch `/dev/tty` and
 * hang. This statically scans every module under `src/cli/headless/` and fails
 * if any imports a forbidden UI module. (Phase 1 also runtime-verified the
 * loaded module graph; this guards against a regression at edit time.)
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HEADLESS_DIR = join(__dirname, '../../../src/cli/headless');

// Match the module specifier of an `import ... from '<spec>'` statement only —
// docstrings that merely *name* a forbidden module (index.ts documents the
// isolation rule) must not trip the scan.
const FORBIDDEN = [
  /\bink\b/,
  /^ink-/,
  /\breact\b/,
  /readline/,
  /tty-prompt/,
  /\.tsx$/,
];

/** Extract every `from '<spec>'` / `import '<spec>'` module specifier. */
function importSpecifiers(src: string): string[] {
  const specs: string[] = [];
  const re = /(?:from|import)\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) specs.push(m[1]);
  return specs;
}

describe('headless module import isolation', () => {
  const files = readdirSync(HEADLESS_DIR).filter((f) => f.endsWith('.ts'));

  it('scans every headless source file', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s imports no TTY/UI module', (file) => {
    const specs = importSpecifiers(readFileSync(join(HEADLESS_DIR, file), 'utf-8'));
    for (const spec of specs) {
      const hit = FORBIDDEN.find((p) => p.test(spec));
      expect(hit, `${file} imports forbidden module "${spec}"`).toBeUndefined();
    }
  });
});
