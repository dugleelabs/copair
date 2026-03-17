export type { ToolDefinition, ToolResult, Tool } from './interface.js';
export { ToolRegistry } from './registry.js';
export { readTool } from './read.js';
export { writeTool } from './write.js';
export { editTool } from './edit.js';
export { grepTool } from './grep.js';
export { globTool } from './glob.js';
export { bashTool } from './bash.js';
export { gitTool } from './git.js';

import { ToolRegistry } from './registry.js';
import { readTool } from './read.js';
import { writeTool } from './write.js';
import { editTool } from './edit.js';
import { grepTool } from './grep.js';
import { globTool } from './glob.js';
import { bashTool } from './bash.js';
import { gitTool } from './git.js';

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readTool);
  registry.register(writeTool);
  registry.register(editTool);
  registry.register(grepTool);
  registry.register(globTool);
  registry.register(bashTool);
  registry.register(gitTool);
  return registry;
}
