# Headless JSON Schema artifacts

Machine-readable contracts for `copair --headless`, consumed by the benchmark
harness (spec 048). These are **generated** from the authoritative Zod schemas
in [`src/cli/headless/schema.ts`](../src/cli/headless/schema.ts) — do not edit
by hand.

| File | Contract |
| --- | --- |
| `headless-result.schema.json` | The single JSON document written to **stdout** at exit. |
| `headless-event.schema.json` | One line of the JSONL stream written to `--events <path>`. |

Both are JSON Schema draft 2020-12 and carry an `x-schema-version` mirroring the
`schema_version` / event envelope `v` field. Breaking changes bump the version
in `schema.ts`; consumers pin against a specific version.

## Regenerating

```sh
pnpm schemas:export
```

A normal `pnpm test` run compares the committed files against the Zod source and
**fails on drift** (`tests/cli/headless/schema-artifacts.test.ts`), so these
files can never silently fall out of sync with the code.
