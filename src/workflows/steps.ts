import { execSync } from 'node:child_process';
import type { WorkflowStep, StepResult, WorkflowContext } from './interface.js';
import { interpolate } from '../commands/interpolate.js';
import type { AgentContext } from '../commands/interface.js';

type AgentRunner = (prompt: string) => Promise<void>;
type CommandRunner = (input: string) => Promise<boolean>;

export interface StepExecutors {
  agentRunner: AgentRunner;
  commandRunner: CommandRunner;
  agentContext: AgentContext;
}

async function resolveVars(
  text: string,
  wfContext: WorkflowContext,
  agentContext: AgentContext,
): Promise<string> {
  // First interpolate workflow context variables (steps.X.output etc.)
  let result = text.replace(/\{\{steps\.([^.}]+)\.([^}]+)\}\}/g, (_m, stepId: string, field: string) => {
    const step = wfContext.steps[stepId];
    if (!step) return '';
    if (field === 'exit_code') return String(step.exit_code ?? '');
    if (field === 'output') return step.output ?? '';
    return '';
  });
  result = result.replace(/\{\{([^}]+)\}\}/g, (_m, key: string) => {
    const k = key.trim();
    if (k in wfContext.inputs) return wfContext.inputs[k];
    return _m;
  });
  return interpolate(result, wfContext.inputs, agentContext);
}

function evaluateCondition(expr: string): boolean {
  // Simple equality check: "value == 0"
  const match = expr.match(/^(.+?)\s*==\s*(.+)$/);
  if (match) {
    return match[1].trim() === match[2].trim();
  }
  return false;
}

export async function executeStep(
  step: WorkflowStep,
  wfContext: WorkflowContext,
  executors: StepExecutors,
): Promise<StepResult> {
  switch (step.type) {
    case 'prompt': {
      const message = await resolveVars(step.message ?? '', wfContext, executors.agentContext);
      await executors.agentRunner(message);
      return {};
    }

    case 'shell': {
      const command = await resolveVars(step.command ?? '', wfContext, executors.agentContext);
      try {
        const output = execSync(command, {
          cwd: executors.agentContext.cwd,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const result: StepResult = { exit_code: 0, output };
        if (step.capture) {
          wfContext.inputs[step.capture] = output;
        }
        return result;
      } catch (err: unknown) {
        const exitCode =
          err instanceof Error && 'status' in err ? (err as { status?: number }).status ?? 1 : 1;
        const stderr =
          err instanceof Error && 'stderr' in err ? String((err as { stderr?: unknown }).stderr) : '';
        const result: StepResult = { exit_code: exitCode, output: stderr };
        if (step.capture) {
          wfContext.inputs[step.capture] = stderr;
        }
        if (!step.continue_on_error) {
          throw new Error(`Shell command failed (exit ${exitCode}): ${command}`);
        }
        return result;
      }
    }

    case 'command': {
      const commandInput = await resolveVars(step.command ?? '', wfContext, executors.agentContext);
      await executors.commandRunner(commandInput);
      return {};
    }

    case 'condition': {
      const expr = await resolveVars(step.if ?? '', wfContext, executors.agentContext);
      const isTrue = evaluateCondition(expr);
      const jumpTo = isTrue ? step.then : step.else;
      return { jumpTo };
    }

    case 'output': {
      const message = await resolveVars(step.message ?? '', wfContext, executors.agentContext);
      console.log(message);
      return {};
    }

    default:
      return {};
  }
}
