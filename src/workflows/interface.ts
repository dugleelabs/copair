export interface WorkflowInput {
  name: string;
  description: string;
  default?: string;
}

export type StepType = 'prompt' | 'shell' | 'command' | 'condition' | 'output';

export interface WorkflowStep {
  id: string;
  type: StepType;
  message?: string;
  command?: string;
  capture?: string;
  continue_on_error?: boolean;
  if?: string;
  then?: string;
  else?: string;
  max_iterations?: string;
  loop_until?: string;
  on_max_iterations?: string;
}

export interface WorkflowDefinition {
  name: string;
  description: string;
  inputs?: WorkflowInput[];
  steps: WorkflowStep[];
}

export interface StepResult {
  exit_code?: number;
  output?: string;
  jumpTo?: string;
}

export interface WorkflowContext {
  inputs: Record<string, string>;
  steps: Record<string, StepResult>;
}
