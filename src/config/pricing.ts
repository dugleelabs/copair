// Pricing per million tokens (USD)
export const DEFAULT_PRICING = new Map<string, { input: number; output: number }>([
  // OpenAI
  ['gpt-4o', { input: 2.50, output: 10.00 }],
  ['gpt-4o-mini', { input: 0.15, output: 0.60 }],
  ['gpt-4-turbo', { input: 10.00, output: 30.00 }],
  ['o1', { input: 15.00, output: 60.00 }],
  ['o1-mini', { input: 3.00, output: 12.00 }],
  ['o3-mini', { input: 1.10, output: 4.40 }],

  // Anthropic
  ['claude-opus', { input: 15.00, output: 75.00 }],
  ['claude-sonnet', { input: 3.00, output: 15.00 }],
  ['claude-haiku', { input: 0.80, output: 4.00 }],

  // Google
  ['gemini-2.0-flash', { input: 0.10, output: 0.40 }],
  ['gemini-2.5-pro', { input: 1.25, output: 10.00 }],
  ['gemini-2.5-flash', { input: 0.15, output: 0.60 }],
]);
