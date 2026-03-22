import type { Message, ContentBlock } from '../providers/interface.js';

export class ConversationManager {
  private messages: Message[] = [];

  append(role: Message['role'], content: ContentBlock[]): void {
    this.messages.push({ role, content });
  }

  appendText(role: Message['role'], text: string): void {
    this.append(role, [{ type: 'text', text }]);
  }

  getHistory(): Message[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
  }

  get length(): number {
    return this.messages.length;
  }

  toJSONL(): string {
    return this.messages.map((msg) => JSON.stringify(msg)).join('\n') + '\n';
  }

  static fromJSONL(data: string): Message[] {
    const messages: Message[] = [];
    for (const line of data.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        messages.push(JSON.parse(trimmed) as Message);
      } catch {
        process.stderr.write(`[session] Skipping malformed JSONL line\n`);
      }
    }
    return messages;
  }
}
