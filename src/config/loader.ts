import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import { CopairConfigSchema, type CopairConfig } from './schema.js';
import {
  normalizeModelId,
  setModelOverrides,
  type ModelOverride,
} from '../core/model-capabilities.js';
import { setBashOverflowTokens } from '../tools/bash.js';
import { setReadOverflowLines } from '../tools/read.js';
import { setGrepDefaultMaxResults } from '../tools/grep.js';

const CURRENT_CONFIG_VERSION = 1;

/**
 * Lenient interpolation: leaves ${VAR} as-is when the variable is not set.
 * Used at config load time so that unconfigured providers don't block startup.
 */
function interpolateEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)}/g, (match, varName) => {
    const envValue = process.env[varName];
    return envValue !== undefined ? envValue : match;
  });
}

/**
 * Strict interpolation: throws when a referenced variable is not set.
 * Used at provider instantiation time so the error is reported only when the
 * provider is actually needed.
 */
export function resolveEnvVarString(value: string): string {
  return value.replace(/\$\{([^}]+)}/g, (_, varName) => {
    const envValue = process.env[varName];
    if (envValue === undefined) {
      throw new Error(
        `Environment variable "${varName}" is not set (referenced in config)`,
      );
    }
    return envValue;
  });
}

function interpolateDeep(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return interpolateEnvVars(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(interpolateDeep);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateDeep(value);
    }
    return result;
  }
  return obj;
}

function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      result[key] !== null &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

function loadYamlFile(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, 'utf-8');
  return parseYaml(content) as Record<string, unknown>;
}

/**
 * Spec 047 (T-13): options for the config loader. All optional — when omitted
 * the loader behaves exactly as the legacy `loadConfig(projectDir?)` form.
 */
export interface LoadConfigOptions {
  /** Directory whose `.copair/config.yaml` is the project-layer source. */
  projectDir?: string;
  /**
   * When true, skip the global (`~/.copair`) and project (`.copair`) layers
   * entirely. Only built-in defaults plus an explicit `-c` file contribute.
   * Used by the benchmark harness for reproducible, machine-state-free runs.
   */
  isolated?: boolean;
  /** Absolute path to an explicit config file (the `-c`/`--config` flag). */
  explicitConfigPath?: string;
}

/**
 * Spec 047 (T-13): `loadConfig` + a record of which layers contributed, in
 * precedence order (low → high). The headless reporter surfaces `sources` as
 * `resolved_config.config_sources`. Examples:
 *   - `["defaults"]`                         — no files found
 *   - `["defaults","global","project"]`      — both layers present
 *   - `["defaults","-c:/abs/path"]`          — isolated run with explicit file
 */
export function loadConfigWithSources(
  options: LoadConfigOptions = {},
): { config: CopairConfig; sources: string[] } {
  const { projectDir, isolated = false, explicitConfigPath } = options;

  const sources: string[] = ['defaults'];
  const layers: Record<string, unknown>[] = [];

  if (isolated) {
    // Isolated: ignore global + project. Only an explicit `-c` file may layer
    // on top of the built-in defaults.
    if (explicitConfigPath) {
      const explicit = loadYamlFile(resolve(explicitConfigPath));
      if (explicit) {
        layers.push(explicit);
        sources.push(`-c:${resolve(explicitConfigPath)}`);
      }
    }
  } else {
    const globalPath = resolve(homedir(), '.copair', 'config.yaml');
    const projectPath = projectDir
      ? resolve(projectDir, '.copair', 'config.yaml')
      : resolve(process.cwd(), '.copair', 'config.yaml');

    const globalConfig = loadYamlFile(globalPath);
    const projectConfig = loadYamlFile(projectPath);

    if (globalConfig) {
      layers.push(globalConfig);
      sources.push('global');
    }
    if (projectConfig) {
      layers.push(projectConfig);
      sources.push('project');
    }

    // Explicit `-c` file layers on top of global + project when supplied.
    if (explicitConfigPath) {
      const explicit = loadYamlFile(resolve(explicitConfigPath));
      if (explicit) {
        layers.push(explicit);
        sources.push(`-c:${resolve(explicitConfigPath)}`);
      }
    }
  }

  if (layers.length === 0) {
    // Return minimal default config — no file layers contributed. Mirrors the
    // legacy early-return: capabilities/tool-overflow side effects are NOT
    // applied here (no user overrides to push), preserving existing behavior.
    const config = CopairConfigSchema.parse({ version: CURRENT_CONFIG_VERSION });
    return { config, sources };
  }

  // Deep-merge layers in precedence order (later wins).
  let merged: Record<string, unknown> = layers[0];
  for (let i = 1; i < layers.length; i++) {
    merged = deepMerge(merged, layers[i]);
  }

  // Default version when absent — allows minimal project configs (e.g. only
  // overriding default_model) to omit version without failing schema validation.
  if (merged.version === undefined) {
    merged = { ...merged, version: CURRENT_CONFIG_VERSION };
  }

  // Check version before interpolation
  const version = merged.version;
  if (typeof version === 'number' && version > CURRENT_CONFIG_VERSION) {
    throw new Error(
      `Config version ${version} is not supported. ` +
        `This CLI supports config version ${CURRENT_CONFIG_VERSION}. ` +
        `Please upgrade copair: npm i -g copair`,
    );
  }

  // Interpolate environment variables
  const interpolated = interpolateDeep(merged) as Record<string, unknown>;

  // Validate with Zod
  const config = CopairConfigSchema.parse(interpolated);

  // Spec 029: build the normalized model-overrides map and push it into the
  // capabilities module so `getCapabilities(modelId)` can apply user overrides.
  //
  // Merge order (matters for backwards-compat with spec 028's tier_overrides):
  //   1. Seed with `small_models.tier_overrides` (older field, deprecated path).
  //      Each entry becomes `{ tier: <value> }` on the normalized key.
  //   2. Layer `model_overrides` ON TOP. On conflict, the newer field wins
  //      because it's both more expressive and the recommended path.
  applyModelOverridesToCapabilities(config);
  applyToolOverflowConfig(config);

  return { config, sources };
}

/**
 * Load the merged copair config. Backwards-compatible: a `string | undefined`
 * first argument is treated as `projectDir` (the legacy signature); an options
 * object selects the spec 047 isolated/explicit-path behavior.
 */
export function loadConfig(projectDirOrOptions?: string | LoadConfigOptions): CopairConfig {
  const options: LoadConfigOptions =
    typeof projectDirOrOptions === 'string'
      ? { projectDir: projectDirOrOptions }
      : projectDirOrOptions ?? {};
  return loadConfigWithSources(options).config;
}

/**
 * spec 029 (F-15b): apply `config.tools.{read,bash,grep}` knobs to the per-tool
 * runtime defaults. No-op when the user hasn't set them.
 */
export function applyToolOverflowConfig(config: CopairConfig): void {
  const tools = config.tools;
  if (!tools) return;
  if (tools.read?.overflow_lines !== undefined) setReadOverflowLines(tools.read.overflow_lines);
  if (tools.bash?.overflow_tokens !== undefined) setBashOverflowTokens(tools.bash.overflow_tokens);
  if (tools.grep?.default_max_results !== undefined) setGrepDefaultMaxResults(tools.grep.default_max_results);
}

/**
 * Spec 029 helper. Normalizes keys via `normalizeModelId` so users can write
 * the model ID in whatever host form they have (Bedrock-prefixed,
 * OpenRouter-prefixed, plain) and lookups still resolve. Merges the older
 * `small_models.tier_overrides` field into the newer `model_overrides`
 * shape, with `model_overrides` winning on conflict.
 */
export function applyModelOverridesToCapabilities(config: CopairConfig): void {
  const normalized: Record<string, ModelOverride> = {};

  // Step 1: seed from tier_overrides (older field — backwards compat)
  for (const [key, tier] of Object.entries(config.small_models?.tier_overrides ?? {})) {
    normalized[normalizeModelId(key)] = { tier };
  }

  // Step 2: layer model_overrides ON TOP (newer field wins on conflict)
  for (const [key, value] of Object.entries(config.model_overrides ?? {})) {
    const normalizedKey = normalizeModelId(key);
    const existing = normalized[normalizedKey];
    if (existing) {
      // Shallow merge — every top-level key in `value` wins over `existing`.
      // (Deep merge with `recommended_harness` is handled later by `deepMerge`
      // inside `getCapabilities` against the registry's base. At this layer
      // we only combine override entries; the nested `recommended_harness`
      // from a `value` replaces any tier-only seed, which is exactly what
      // we want for "model_overrides wins on conflict".)
      normalized[normalizedKey] = { ...existing, ...value };
    } else {
      normalized[normalizedKey] = value;
    }
  }

  setModelOverrides(normalized);
}
