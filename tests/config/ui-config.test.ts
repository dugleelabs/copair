import { describe, it, expect } from 'vitest';
import { UIConfigSchema } from '../../src/config/schema.js';

describe('UIConfigSchema', () => {
  it('returns correct defaults', () => {
    const defaults = UIConfigSchema.parse({});
    expect(defaults).toEqual({
      bordered_input: true,
      status_bar: true,
      syntax_highlight: true,
      output_collapsing: true,
      vi_mode: false,
      suggestions: true,
      tab_completion: true,
    });
  });

  it('vi_mode defaults to false', () => {
    const config = UIConfigSchema.parse({});
    expect(config.vi_mode).toBe(false);
  });

  it('accepts partial overrides', () => {
    const config = UIConfigSchema.parse({ status_bar: false, vi_mode: true });
    expect(config.status_bar).toBe(false);
    expect(config.vi_mode).toBe(true);
    expect(config.bordered_input).toBe(true); // unchanged default
  });

  it('all toggles can be disabled', () => {
    const config = UIConfigSchema.parse({
      bordered_input: false,
      status_bar: false,
      syntax_highlight: false,
      output_collapsing: false,
      vi_mode: false,
      suggestions: false,
      tab_completion: false,
    });
    expect(Object.values(config).every((v) => v === false)).toBe(true);
  });
});
