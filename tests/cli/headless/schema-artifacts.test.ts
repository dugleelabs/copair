/**
 * Schema-artifact export + drift guard (spec 047, T-20 / T-R2).
 *
 * The benchmark harness (spec 048) does not import copair's TypeScript — it
 * pins committed JSON Schema files. This test is the single mechanism that both
 * (a) regenerates those files from the authoritative Zod schemas in
 * `headless/schema.ts`, and (b) fails if the committed files drift from the Zod
 * source. Regenerate with:
 *
 *   UPDATE_SCHEMAS=1 pnpm test -- schema-artifacts   (or: pnpm schemas:export)
 *
 * A normal `pnpm test` run only compares — it never writes — so a forgotten
 * regeneration after a schema change surfaces as a red test, not silent drift.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  HeadlessResultSchema,
  HeadlessEventSchema,
  RESULT_SCHEMA_VERSION,
  EVENT_SCHEMA_VERSION,
} from '../../../src/cli/headless/schema.js';

/** Repo-root `schemas/` — the directory spec 048 pins against. */
function artifactPath(file: string): string {
  return fileURLToPath(new URL(`../../../schemas/${file}`, import.meta.url));
}

interface Artifact {
  file: string;
  schema: z.ZodTypeAny;
  id: string;
  title: string;
  description: string;
  version: number;
}

const ARTIFACTS: Artifact[] = [
  {
    file: 'headless-result.schema.json',
    schema: HeadlessResultSchema,
    id: 'https://copair.dev/schemas/headless-result.schema.json',
    title: 'Copair headless result document',
    description:
      'The single JSON document copair --headless writes to stdout at exit. ' +
      `Result schema version ${RESULT_SCHEMA_VERSION}.`,
    version: RESULT_SCHEMA_VERSION,
  },
  {
    file: 'headless-event.schema.json',
    schema: HeadlessEventSchema,
    id: 'https://copair.dev/schemas/headless-event.schema.json',
    title: 'Copair headless mechanism event',
    description:
      'One line of the JSONL stream copair --headless writes to --events <path>. ' +
      `Event envelope version ${EVENT_SCHEMA_VERSION}.`,
    version: EVENT_SCHEMA_VERSION,
  },
];

/** Stable JSON Schema (draft 2020-12) for a Zod schema, with artifact metadata. */
function build(a: Artifact): Record<string, unknown> {
  const base = z.toJSONSchema(a.schema, { target: 'draft-2020-12' }) as Record<string, unknown>;
  // Prepend identity fields in a fixed order so the serialized output is stable
  // and reviewable in diffs.
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: a.id,
    title: a.title,
    description: a.description,
    'x-schema-version': a.version,
    ...base,
  };
}

/** Canonical on-disk form: 2-space indent, trailing newline. */
function serialize(schema: Record<string, unknown>): string {
  return JSON.stringify(schema, null, 2) + '\n';
}

const UPDATE = process.env.UPDATE_SCHEMAS === '1';

describe('headless JSON Schema artifacts (T-20)', () => {
  for (const a of ARTIFACTS) {
    it(`${a.file} matches the Zod source`, () => {
      const expected = serialize(build(a));
      const path = artifactPath(a.file);

      if (UPDATE) {
        writeFileSync(path, expected);
        return;
      }

      expect(existsSync(path), `${a.file} missing — run \`pnpm schemas:export\``).toBe(true);
      const actual = readFileSync(path, 'utf8');
      expect(actual, `${a.file} is stale — run \`pnpm schemas:export\``).toBe(expected);
    });
  }
});
