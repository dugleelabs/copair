import type { Message } from '../providers/interface.js';
import type { Provider, ProviderOptions } from '../providers/interface.js';

const SUMMARIZATION_PROMPT =
  'Summarize this coding session. Include:\n' +
  '- Task description (what was the user trying to do)\n' +
  '- Key decisions made\n' +
  '- Files modified\n' +
  '- Current state (what is done, what remains)\n' +
  '- Suggested next steps\n\n' +
  'Use markdown formatting. Be concise — stay under 500 words.\n' +
  'Do NOT include code snippets unless they are critical to understanding a decision.';

export interface Summarizer {
  summarize(messages: Message[]): Promise<string | null>;
}

export class SessionSummarizer implements Summarizer {
  private provider: Provider;
  private model: string;
  private timeoutMs: number;

  constructor(provider: Provider, model: string, timeoutMs = 30_000) {
    this.provider = provider;
    this.model = model;
    this.timeoutMs = timeoutMs;
  }

  async summarize(messages: Message[]): Promise<string | null> {
    if (messages.length < 4) return null;

    try {
      const result = await Promise.race([
        this.doSummarize(messages),
        this.timeout(),
      ]);
      return result;
    } catch {
      return null;
    }
  }

  private async doSummarize(messages: Message[]): Promise<string> {
    const summaryMessages: Message[] = [
      ...messages,
      {
        role: 'user',
        content: [{ type: 'text', text: SUMMARIZATION_PROMPT }],
      },
    ];

    const options: ProviderOptions = {
      model: this.model,
      maxTokens: 1024,
      temperature: 0.3,
      systemPrompt: 'You are a concise session summarizer. Output markdown only.',
      stream: true,
    };

    let text = '';
    for await (const chunk of this.provider.chat(summaryMessages, [], options)) {
      if (chunk.type === 'text' && chunk.text) {
        text += chunk.text;
      }
    }

    return text.trim();
  }

  private timeout(): Promise<null> {
    return new Promise((resolve) => {
      setTimeout(() => resolve(null), this.timeoutMs);
    });
  }
}

// ---------------------------------------------------------------------------
// Model resolution for summarization
// ---------------------------------------------------------------------------

export async function resolveSummarizationModel(
  configModel?: string,
  activeModel?: string,
): Promise<{ model: string; source: string } | null> {
  // 1. Configured model
  if (configModel) {
    return { model: configModel, source: 'config' };
  }

  // 2. Probe Ollama for available models
  try {
    const response = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      const data = (await response.json()) as { models?: Array<{ name: string }> };
      if (data.models && data.models.length > 0) {
        // Prefer smaller models for summarization
        const preferred = data.models.find(
          (m) =>
            m.name.includes('7b') ||
            m.name.includes('8b') ||
            m.name.includes('qwen') ||
            m.name.includes('mistral'),
        );
        const model = preferred?.name ?? data.models[0].name;
        return { model, source: 'ollama' };
      }
    }
  } catch {
    // Ollama not available
  }

  // 3. Use active model
  if (activeModel) {
    return { model: activeModel, source: 'active' };
  }

  // 4. Skip
  return null;
}
