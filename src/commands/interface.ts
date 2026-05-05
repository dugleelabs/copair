export interface ArgDefinition {
  name: string;
  description?: string;
  default?: string;
  required?: boolean;
}

export interface CommandDefinition {
  name: string;
  description: string;
  args?: ArgDefinition[];
  source: 'builtin' | 'global' | 'project';
}

export interface AgentContext {
  cwd: string;
  model: string;
  branch?: string;
  /** Run a named workflow directly, bypassing the model. */
  runWorkflow?: (name: string, overrides?: Record<string, string>) => Promise<void>;
}

export interface Command {
  definition: CommandDefinition;
  /** Return a string to have it sent to the agent as a message. */
  execute(args: Record<string, string>, context: AgentContext): Promise<string | void>;
}
