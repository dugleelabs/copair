/**
 * Headless mode — shared schema + types (spec 047, T-01).
 *
 * Single source of truth for the two machine-readable contracts the benchmark
 * harness (spec 048) consumes:
 *   1. the result JSON written once to stdout at exit, and
 *   2. the mechanism-event JSONL stream written to `--events <path>`.
 *
 * Both carry an explicit version. Breaking changes bump it; 048 pins against
 * the exported JSON Schema artifacts (see T-20). Nothing here imports ink,
 * readline, or any TTY surface — the headless path stays import-isolated.
 */
import { z } from 'zod';

/** Result-document schema version. Bump on any breaking change to the result shape. */
export const RESULT_SCHEMA_VERSION = 1 as const;
/** Event-envelope schema version. Bump on any breaking change to the event shape. */
export const EVENT_SCHEMA_VERSION = 1 as const;

// ── Enums (string-literal unions — the canonical lists for tests + 048) ───────

/**
 * Why a headless run ended. Maps from the agent loop's internal break states
 * (design §4). `aborted` covers loop-guard halt and format-repair exhaustion —
 * the event stream disambiguates which, and 048 maps those to its own failure
 * classes.
 */
export const TERMINATION_REASONS = [
  'completed', // task_complete tool called
  'model-declared-done', // turn ended without task_complete
  'approval-required', // a tool needed approval in terminate-mode
  'context-exhausted', // context-limit reached (no interactive compaction)
  'max-tool-calls', // --max-tool-calls cap hit
  'max-tokens', // --max-tokens cap hit
  'aborted', // loop-guard halt / format-repair exhausted
  'error', // a thrown error (see `error.message`)
] as const;
export type TerminationReason = (typeof TERMINATION_REASONS)[number];

/** Where the task prompt came from. */
export const TASK_SOURCES = ['arg', 'file', 'stdin'] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

/** Tool-call formatter actually in effect for the run. */
export const FORMATTERS = ['dsml', 'qwen-xml', 'fenced-block', 'native'] as const;
export type Formatter = (typeof FORMATTERS)[number];

/** Model tier classification (spec 029). */
export const TIERS = ['small', 'large', 'unknown'] as const;
export type Tier = (typeof TIERS)[number];

/** Approval policy in force for the run. */
export const PERMISSION_MODES = ['headless-terminate', 'headless-auto-approve'] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** Names of every mechanism event emitted to the JSONL stream (design §5). */
export const HEADLESS_EVENTS = [
  'turn_started',
  'turn_completed',
  'tool_call_parsed',
  'format_repair',
  'format_repair_exhausted',
  'loop_nudge',
  'loop_halt',
  'output_truncated',
  'tool_started',
  'tool_completed',
  'approval_required',
  'usage',
  'run_terminated',
] as const;
export type HeadlessEventName = (typeof HEADLESS_EVENTS)[number];

// ── Result JSON (stdout) ──────────────────────────────────────────────────────

export const ResolvedTogglesSchema = z.object({
  loop_guard: z.boolean(),
  format_repair: z.boolean(),
  inspect_before_act: z.boolean(),
  truncation: z.boolean(),
});
export type ResolvedToggles = z.infer<typeof ResolvedTogglesSchema>;

export const ResolvedConfigSchema = z.object({
  model: z.string(),
  provider: z.string(),
  tier: z.enum(TIERS),
  formatter: z.enum(FORMATTERS),
  toggles: ResolvedTogglesSchema,
  permissions: z.enum(PERMISSION_MODES),
  limits: z.object({
    max_tool_calls: z.number().int().positive().nullable(),
    max_tokens: z.number().int().positive().nullable(),
  }),
  /** Which config layers contributed, in precedence order (e.g. ["defaults","-c:/abs"]). */
  config_sources: z.array(z.string()),
});
export type ResolvedConfig = z.infer<typeof ResolvedConfigSchema>;

export const HeadlessResultSchema = z.object({
  schema_version: z.literal(RESULT_SCHEMA_VERSION),
  run: z.object({
    task_source: z.enum(TASK_SOURCES),
    cwd: z.string(),
    started_at: z.string(), // ISO-8601
    duration_ms: z.number().int().nonnegative(),
  }),
  termination_reason: z.enum(TERMINATION_REASONS),
  turns: z.object({
    tool_calls: z.number().int().nonnegative(),
    assistant_messages: z.number().int().nonnegative(),
  }),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    estimated_cost_usd: z.number().nonnegative().nullable(),
  }),
  resolved_config: ResolvedConfigSchema,
  events_file: z.string().nullable(),
  session_id: z.string(),
  error: z.object({ message: z.string() }).nullable(),
});
export type HeadlessResult = z.infer<typeof HeadlessResultSchema>;

// ── Mechanism event stream (JSONL) ────────────────────────────────────────────

/** Fields every event carries. Each concrete event extends this with a payload. */
const EventBase = {
  v: z.literal(EVENT_SCHEMA_VERSION),
  seq: z.number().int().nonnegative(),
  ts: z.string(), // ISO-8601
};

/**
 * Discriminated union over `event`. Counting semantics that matter for 048:
 * every `tool_call_parsed` is one parse *attempt* (repairs add attempts), so
 * format-validity = valid ÷ attempts and first-try validity = valid-on-first ÷
 * tool calls (design §10 risk table).
 */
export const HeadlessEventSchema = z.discriminatedUnion('event', [
  z.object({ ...EventBase, event: z.literal('turn_started'), turn_index: z.number().int().nonnegative() }),
  z.object({ ...EventBase, event: z.literal('turn_completed'), turn_index: z.number().int().nonnegative() }),
  z.object({
    ...EventBase,
    event: z.literal('tool_call_parsed'),
    valid: z.boolean(),
    formatter: z.enum(FORMATTERS),
    tool: z.string().optional(),
  }),
  z.object({ ...EventBase, event: z.literal('format_repair'), attempt: z.number().int().positive() }),
  z.object({ ...EventBase, event: z.literal('format_repair_exhausted'), attempts: z.number().int().positive() }),
  z.object({ ...EventBase, event: z.literal('loop_nudge'), tool: z.string(), repeats: z.number().int().positive() }),
  z.object({ ...EventBase, event: z.literal('loop_halt'), tool: z.string(), repeats: z.number().int().positive() }),
  z.object({
    ...EventBase,
    event: z.literal('output_truncated'),
    tool: z.string(),
    kind: z.enum(['bash', 'read', 'grep']),
  }),
  z.object({ ...EventBase, event: z.literal('tool_started'), tool: z.string() }),
  z.object({
    ...EventBase,
    event: z.literal('tool_completed'),
    tool: z.string(),
    ok: z.boolean(),
    denied: z.boolean(),
  }),
  z.object({ ...EventBase, event: z.literal('approval_required'), tool: z.string() }),
  z.object({
    ...EventBase,
    event: z.literal('usage'),
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
  z.object({ ...EventBase, event: z.literal('run_terminated'), reason: z.enum(TERMINATION_REASONS) }),
]);
export type HeadlessEvent = z.infer<typeof HeadlessEventSchema>;
