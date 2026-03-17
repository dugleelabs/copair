export interface TokenUsageRecord {
  timestamp: Date;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost?: number;
}

export class TokenTracker {
  private records: TokenUsageRecord[] = [];
  private pricing: Map<string, { input: number; output: number }>;

  constructor(pricing?: Map<string, { input: number; output: number }>) {
    this.pricing = pricing ?? new Map();
  }

  setPricing(pricing: Map<string, { input: number; output: number }>): void {
    this.pricing = pricing;
  }

  record(
    inputTokens: number,
    outputTokens: number,
    model: string,
    provider: string,
  ): void {
    const cost = this.estimateCost(inputTokens, outputTokens, model);
    this.records.push({
      timestamp: new Date(),
      model,
      provider,
      inputTokens,
      outputTokens,
      estimatedCost: cost,
    });
  }

  getSessionSummary(): {
    totalInput: number;
    totalOutput: number;
    totalCost: number;
    byModel: Map<string, { input: number; output: number; cost: number }>;
  } {
    const byModel = new Map<string, { input: number; output: number; cost: number }>();
    let totalInput = 0;
    let totalOutput = 0;
    let totalCost = 0;

    for (const r of this.records) {
      totalInput += r.inputTokens;
      totalOutput += r.outputTokens;
      totalCost += r.estimatedCost ?? 0;

      const existing = byModel.get(r.model) ?? { input: 0, output: 0, cost: 0 };
      existing.input += r.inputTokens;
      existing.output += r.outputTokens;
      existing.cost += r.estimatedCost ?? 0;
      byModel.set(r.model, existing);
    }

    return { totalInput, totalOutput, totalCost, byModel };
  }

  private estimateCost(
    inputTokens: number,
    outputTokens: number,
    model: string,
  ): number | undefined {
    const price = this.pricing.get(model);
    if (!price) return undefined;

    return (
      (inputTokens / 1_000_000) * price.input +
      (outputTokens / 1_000_000) * price.output
    );
  }
}
