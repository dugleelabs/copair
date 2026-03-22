/**
 * Backward-compatible facade — delegates to pluggable formatters.
 *
 * Existing callers (agent.ts, tests) continue to import from here unchanged.
 * New code should import from './formats/index.js' directly.
 */
import type { ToolDefinition } from '../providers/interface.js';
import { FencedBlockFormatter } from './formats/fenced-block.js';
import { DsmlFormatter } from './formats/dsml.js';
import { QwenXmlFormatter } from './formats/qwen-xml.js';

export type { ParsedToolCall } from './formats/interface.js';

const fencedBlock = new FencedBlockFormatter();
const dsml = new DsmlFormatter();
const qwenXml = new QwenXmlFormatter();

/**
 * Builds a system prompt injection describing available tools for models
 * that don't natively support tool calling.
 */
export function buildToolSystemPrompt(tools: ToolDefinition[]): string {
  return fencedBlock.buildSystemPrompt(tools);
}

/**
 * Parses text output from a non-tool-calling model for embedded tool call blocks.
 *
 * Tries all formatters in priority order:
 *   1. DeepSeek DSML
 *   2. Qwen XML
 *   3. Fenced blocks (canonical, json, bare)
 */
export function parseToolCallsFromText(text: string): {
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  remainingText: string;
} {
  // Try DSML first
  const dsmlResult = dsml.parse(text);
  if (dsmlResult.toolCalls.length > 0) return dsmlResult;

  // Try Qwen XML
  const qwenResult = qwenXml.parse(text);
  if (qwenResult.toolCalls.length > 0) return qwenResult;

  // Fall back to fenced blocks
  return fencedBlock.parse(text);
}
