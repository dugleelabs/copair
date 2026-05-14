/**
 * Pretty-printer for `--explain-model <id>` CLI flag (spec 029, T-C02).
 *
 * Two output modes:
 *   - pretty (default): human-readable trace of how getCapabilities resolved
 *     each field — useful for "why did copair pick X for this model?"
 *   - JSON (--json): single-line ResolvedCapabilities-shape, for scripts.
 *
 * Imports `explainCapabilities` from the capabilities module. This file is
 * the CLI presentation layer only; resolution logic lives in
 * `src/core/model-capabilities.ts`.
 */
import { explainCapabilities, type ResolvedCapabilities } from '../core/model-capabilities.js';

export interface ExplainModelOptions {
  /** When true, emit single-line JSON instead of the pretty-print format. */
  json: boolean;
}

/**
 * Resolve and print the capabilities trace for `modelId`. Writes to stdout.
 * Caller is responsible for process.exit; this function does not exit on its own.
 *
 * Returns the `ResolvedCapabilities` value so callers (tests) can assert
 * against it programmatically without re-parsing the output.
 */
export function printExplainModel(
  modelId: string,
  opts: ExplainModelOptions,
): ResolvedCapabilities {
  const resolved = explainCapabilities(modelId);

  if (opts.json) {
    process.stdout.write(JSON.stringify(resolved) + '\n');
    return resolved;
  }

  process.stdout.write(formatPretty(resolved) + '\n');
  return resolved;
}

function formatPretty(r: ResolvedCapabilities): string {
  const lines: string[] = [];
  lines.push(`Model ID:           ${r.modelId}`);
  lines.push(`Normalized ID:      ${r.normalizedId}`);
  lines.push('');
  lines.push(`Tier:               ${r.tier.value}  (source: ${r.tier.source})`);
  lines.push(
    `Preferred format:   ${r.preferred_format.value}  (source: ${r.preferred_format.source})`,
  );
  lines.push(`Context window:     ${r.finalCapabilities.context_window}`);
  lines.push(`Native tool calls:  ${r.finalCapabilities.native_tool_calling}`);
  lines.push('');
  lines.push('Recommended harness:');
  const h = r.finalCapabilities.recommended_harness;
  lines.push(`  enable_small_model_harness:        ${h.enable_small_model_harness}`);
  lines.push(`  max_turns:                         ${h.max_turns}`);
  lines.push(
    `  max_tool_calls:                    ${h.max_tool_calls ?? '(falls through to config.small_models.max_tool_calls)'}`,
  );
  lines.push(`  inject_format_reminder_every_turn: ${h.inject_format_reminder_every_turn}`);
  lines.push('');
  if (r.overrideApplied) {
    lines.push('User override applied:');
    lines.push('  ' + JSON.stringify(r.overrideApplied, null, 2).replace(/\n/g, '\n  '));
  } else {
    lines.push('User override applied: none');
  }
  return lines.join('\n');
}
