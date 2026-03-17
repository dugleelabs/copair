import chalk from 'chalk';
import type { WorkflowDefinition, WorkflowContext } from './interface.js';
import { executeStep, type StepExecutors } from './steps.js';

export class WorkflowEngine {
  private cancelled = false;

  constructor(private executors: StepExecutors) {}

  async execute(
    workflow: WorkflowDefinition,
    inputOverrides: Record<string, string> = {},
  ): Promise<void> {
    this.cancelled = false;

    // Build initial inputs from workflow defaults + overrides
    const inputs: Record<string, string> = {};
    for (const input of workflow.inputs ?? []) {
      if (input.default !== undefined) {
        inputs[input.name] = input.default;
      }
    }
    for (const [key, val] of Object.entries(inputOverrides)) {
      inputs[key] = val;
    }

    const context: WorkflowContext = { inputs, steps: {} };

    // Handle Ctrl+C
    const sigintHandler = () => {
      this.cancelled = true;
    };
    process.on('SIGINT', sigintHandler);

    try {
      let stepIndex = 0;
      const stepsById = new Map(workflow.steps.map((s) => [s.id, s]));
      const stepOrder = workflow.steps.map((s) => s.id);

      while (stepIndex < workflow.steps.length) {
        if (this.cancelled) {
          console.log(chalk.yellow('\nWorkflow cancelled.'));
          break;
        }

        const step = workflow.steps[stepIndex];
        const stepNum = stepIndex + 1;
        const total = workflow.steps.length;
        process.stderr.write(
          chalk.gray(`\n[step ${stepNum}/${total}] ${step.id}\n`),
        );

        let iterCount = 0;
        const maxIter = step.max_iterations ? parseInt(step.max_iterations, 10) : 1;

        while (iterCount < maxIter) {
          if (this.cancelled) break;

          const result = await executeStep(step, context, this.executors);
          context.steps[step.id] = result;

          // Handle loop_until
          if (step.loop_until && iterCount < maxIter - 1) {
            const loopExprRaw = step.loop_until.replace(
              /\{\{exit_code\}\}/g,
              String(result.exit_code ?? ''),
            );
            const shouldStop = loopExprRaw.includes('== 0')
              ? result.exit_code === 0
              : false;
            if (shouldStop) break;
          }

          iterCount++;

          if (iterCount >= maxIter && step.on_max_iterations === 'report') {
            const reportStep = stepsById.get('report');
            if (reportStep) {
              await executeStep(reportStep, context, this.executors);
            }
            break;
          }
        }

        // Handle condition jump
        const stepResult = context.steps[step.id];
        if (stepResult?.jumpTo) {
          const jumpId = stepResult.jumpTo;
          if (jumpId === 'done') break;
          const jumpIdx = stepOrder.indexOf(jumpId);
          if (jumpIdx !== -1) {
            stepIndex = jumpIdx;
            continue;
          }
        }

        stepIndex++;
      }
    } finally {
      process.removeListener('SIGINT', sigintHandler);
    }
  }
}
