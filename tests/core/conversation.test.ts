import { describe, it, expect } from 'vitest';
import { ConversationManager } from '../../src/core/conversation.js';

describe('ConversationManager', () => {
  it('starts empty', () => {
    const conv = new ConversationManager();
    expect(conv.getHistory()).toEqual([]);
    expect(conv.length).toBe(0);
  });

  it('appends messages', () => {
    const conv = new ConversationManager();
    conv.appendText('user', 'Hello');
    conv.appendText('assistant', 'Hi there');
    expect(conv.length).toBe(2);
    expect(conv.getHistory()[0].role).toBe('user');
    expect(conv.getHistory()[1].role).toBe('assistant');
  });

  it('returns a copy of history', () => {
    const conv = new ConversationManager();
    conv.appendText('user', 'Hello');
    const history = conv.getHistory();
    history.pop();
    expect(conv.length).toBe(1);
  });

  it('clears history', () => {
    const conv = new ConversationManager();
    conv.appendText('user', 'Hello');
    conv.clear();
    expect(conv.length).toBe(0);
  });

  describe('JSONL serialization', () => {
    it('round-trips messages through JSONL', () => {
      const conv = new ConversationManager();
      conv.appendText('user', 'Hello');
      conv.appendText('assistant', 'Hi there');
      conv.append('assistant', [
        { type: 'tool_use', id: 'call_1', name: 'read', input: { path: '/tmp/test' } },
      ]);

      const jsonl = conv.toJSONL();
      const parsed = ConversationManager.fromJSONL(jsonl);

      expect(parsed).toHaveLength(3);
      expect(parsed[0].role).toBe('user');
      expect(parsed[1].role).toBe('assistant');
      expect(parsed[2].content[0]).toMatchObject({ type: 'tool_use', name: 'read' });
    });

    it('produces one JSON object per line', () => {
      const conv = new ConversationManager();
      conv.appendText('user', 'Hello');
      conv.appendText('assistant', 'World');

      const lines = conv.toJSONL().trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(() => JSON.parse(lines[0])).not.toThrow();
      expect(() => JSON.parse(lines[1])).not.toThrow();
    });

    it('skips malformed JSONL lines gracefully', () => {
      const data = '{"role":"user","content":[{"type":"text","text":"ok"}]}\nBAD LINE\n{"role":"assistant","content":[{"type":"text","text":"hi"}]}\n';
      const messages = ConversationManager.fromJSONL(data);
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
      expect(messages[1].role).toBe('assistant');
    });

    it('handles empty input', () => {
      expect(ConversationManager.fromJSONL('')).toEqual([]);
      expect(ConversationManager.fromJSONL('\n\n')).toEqual([]);
    });
  });
});
