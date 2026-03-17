export interface ArgDefinition {
  name: string;
  description: string;
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
}

export interface Command {
  definition: CommandDefinition;
  execute(args: Record<string, string>, context: AgentContext): Promise<void>;
}
