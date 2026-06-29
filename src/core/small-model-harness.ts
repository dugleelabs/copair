import type { ToolCallFormatter } from './formats/interface.js';
import type { SmallModelsConfig } from '../config/schema.js';
import { getCapabilities } from './model-capabilities.js';

export { type SmallModelsConfig as SmallModelConfig };

// Rule list built into the small-model system prompt. Kept as discrete entries
// so spec 047 (T-11) can drop the inspect-before-act rule cleanly when the
// `enable_inspect_before_act` toggle is off. Order is the documented numbering.
const SMALL_MODEL_RULES = {
  oneAtATime: 'Call tools one at a time. Wait for the result before chaining the next call.',
  unclear:
    'If the task or a required detail is unclear, emit `UNCLEAR: <your question>` on its own line before calling any tool.',
  taskComplete: 'Call the `task_complete` tool with a one-sentence summary when the task is finished.',
  askUser: 'Use the `ask_user` tool to collect information you cannot infer from context.',
  inspectBeforeAct:
    'Before editing a file, read it first. Before calling a tool with a path, id, or name, verify it exists via list/search. Never invent identifiers.',
} as const;

/** Assemble the small-model system prompt from a rule list, renumbering 1..N. */
function buildSmallModelSystemPrompt(rules: string[]): string {
  const numbered = rules.map((r, i) => `${i + 1}. ${r}`).join('\n');
  return `Small model operating rules:\n${numbered}`;
}

const SMALL_MODEL_PER_TURN_REMINDER =
  'Reminder: one tool call at a time; call task_complete when the task is done.';

/** Final hardcoded fallback when no other source has a value. Matches spec 028's documented default. */
const HARDCODED_MAX_TOOL_CALLS = 20;

/**
 * Resolve `max_tool_calls` per the spec 029 design §10 fallback chain:
 *   1. Per-model user override: `model_overrides[id].recommended_harness.max_tool_calls`
 *      (folded into the capabilities lookup automatically)
 *   2. Tier-derived default from `getCapabilities` (currently `undefined` for
 *      both tiers — see `resolveHarnessDefaults` in model-capabilities.ts)
 *   3. Global config: `config.small_models.max_tool_calls` (spec 028 backwards-compat)
 *   4. Hardcoded fallback: 20
 *
 * Because step 2 currently returns `undefined`, steps 3 + 4 are the active
 * path unless a user has set a per-model override. This preserves spec 028's
 * global-config behavior unchanged.
 */
export function resolveMaxToolCalls(modelId: string, config: SmallModelsConfig): number {
  const caps = getCapabilities(modelId);
  if (caps.recommended_harness.max_tool_calls !== undefined) {
    return caps.recommended_harness.max_tool_calls;
  }
  return config.max_tool_calls ?? HARDCODED_MAX_TOOL_CALLS;
}

export class SmallModelHarness {
  readonly isSmallModel: boolean;
  private readonly modelId: string;
  private readonly config: SmallModelsConfig;

  constructor(modelId: string, config: SmallModelsConfig = {}, forceOverride?: boolean) {
    this.modelId = modelId;
    this.config = config;

    if (forceOverride !== undefined) {
      this.isSmallModel = forceOverride;
    } else if (config.tier_overrides?.[modelId] !== undefined) {
      // Spec 028 backwards-compat fast-path: when the caller passes a config
      // with tier_overrides directly (e.g. unit tests, or callers that don't
      // route through the config-loader), respect it without requiring the
      // loader-side fold-in. Production callers route through loadConfig,
      // which also folds tier_overrides into model_overrides — both paths
      // produce equivalent behaviour.
      this.isSmallModel = config.tier_overrides[modelId] === 'small';
    } else {
      // Spec 029: capabilities lookup unifies model_overrides + tier
      // classifier (spec 028 F-24) into a single resolution.
      this.isSmallModel = getCapabilities(modelId).recommended_harness.enable_small_model_harness;
    }
  }

  get maxToolCalls(): number {
    return resolveMaxToolCalls(this.modelId, this.config);
  }

  // ── Spec 047 (T-11): per-feature harness toggles. All default to the shipped
  //    behavior so an absent `small_models` config changes nothing. ──

  /** Result-aware loop guard enabled? Default: true. */
  get enableLoopGuard(): boolean {
    return this.config.enable_loop_guard ?? true;
  }

  /** Tool-call format-error repair loop enabled? Default: true. */
  get enableFormatRepair(): boolean {
    return this.config.enable_format_repair ?? true;
  }

  /** Inspect-before-act system-prompt rule included? Default: true. */
  get enableInspectBeforeAct(): boolean {
    return this.config.enable_inspect_before_act ?? true;
  }

  /** Max format-repair retries before giving up. Default: 2. */
  get maxRepairRetries(): number {
    return this.config.max_repair_retries ?? 2;
  }

  getSystemPromptAddition(): string | null {
    if (!this.isSmallModel) return null;
    const rules: string[] = [
      SMALL_MODEL_RULES.oneAtATime,
      SMALL_MODEL_RULES.unclear,
      SMALL_MODEL_RULES.taskComplete,
      SMALL_MODEL_RULES.askUser,
    ];
    // Spec 047 (T-11): drop rule #5 (inspect-before-act) when the toggle is off.
    if (this.enableInspectBeforeAct) {
      rules.push(SMALL_MODEL_RULES.inspectBeforeAct);
    }
    return buildSmallModelSystemPrompt(rules);
  }

  getPerTurnReminder(): string | null {
    if (!this.isSmallModel) return null;
    return SMALL_MODEL_PER_TURN_REMINDER;
  }

  getFormatHint(formatter: ToolCallFormatter): string | null {
    if (!this.isSmallModel) return null;
    return `Format reminder — tool calls must use this exact syntax:\n${formatter.exampleCall()}`;
  }
}
