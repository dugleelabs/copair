import type { ToolCallFormatter } from './formats/interface.js';
import type { SmallModelsConfig } from '../config/schema.js';

export { type SmallModelsConfig as SmallModelConfig };

export const DEFAULT_SMALL_MODELS = [
  'qwen',
  'llama-3.1-8b',
  'llama-3.2-1b',
  'llama-3.2-3b',
  'mistral-7b',
  'phi-3',
  'deepseek-coder-1.3b',
];

const SMALL_MODEL_SYSTEM_PROMPT = `Small model operating rules:
1. Call tools one at a time. Wait for the result before chaining the next call.
2. If the task or a required detail is unclear, emit \`UNCLEAR: <your question>\` on its own line before calling any tool.
3. Call the \`task_complete\` tool with a one-sentence summary when the task is finished.
4. Use the \`ask_user\` tool to collect information you cannot infer from context.`;

const SMALL_MODEL_PER_TURN_REMINDER =
  'Reminder: one tool call at a time; call task_complete when the task is done.';

export class SmallModelHarness {
  readonly isSmallModel: boolean;
  private config: SmallModelsConfig;

  constructor(modelId: string, config: SmallModelsConfig = {}, forceOverride?: boolean) {
    if (forceOverride !== undefined) {
      this.isSmallModel = forceOverride;
    } else {
      const ids = config.model_ids ?? DEFAULT_SMALL_MODELS;
      const lowerModel = modelId.toLowerCase();
      this.isSmallModel = ids.some((id) => lowerModel.includes(id.toLowerCase()));
    }
    this.config = config;
  }

  get maxToolCalls(): number {
    return this.config.max_tool_calls ?? 20;
  }

  getSystemPromptAddition(): string | null {
    if (!this.isSmallModel) return null;
    return SMALL_MODEL_SYSTEM_PROMPT;
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
