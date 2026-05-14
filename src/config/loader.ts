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

export function loadConfig(projectDir?: string): CopairConfig {
  const globalPath = resolve(homedir(), '.copair', 'config.yaml');
  const projectPath = projectDir
    ? resolve(projectDir, '.copair', 'config.yaml')
    : resolve(process.cwd(), '.copair', 'config.yaml');

  const globalConfig = loadYamlFile(globalPath);
  const projectConfig = loadYamlFile(projectPath);

  if (!globalConfig && !projectConfig) {
    // Return minimal default config
    return CopairConfigSchema.parse({ version: CURRENT_CONFIG_VERSION });
  }

  let merged: Record<string, unknown>;
  if (globalConfig && projectConfig) {
    merged = deepMerge(globalConfig, projectConfig);
  } else {
    merged = (globalConfig ?? projectConfig)!;
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

  return config;
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
