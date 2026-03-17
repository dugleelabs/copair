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
});
