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
}
