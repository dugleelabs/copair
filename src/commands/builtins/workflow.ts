import type { Command, AgentContext } from '../interface.js';
import { loadWorkflows, WorkflowEngine } from '../../workflows/index.js';

export function createWorkflowCommand(
  agentRunner: (prompt: string) => Promise<void>,
  commandRunner: (input: string) => Promise<boolean>,
  shellApprover?: (command: string) => Promise<boolean>,
): Command {
  return {
    definition: {
      name: 'workflow',
      description: 'List or run a workflow',
      args: [
        { name: 'name', description: 'Workflow name to run', required: false },
      ],
      source: 'builtin',
    },
    async execute(args: Record<string, string>, context: AgentContext): Promise<void> {
      const workflows = await loadWorkflows();

      const workflowName = args['name'];
      if (!workflowName) {
        if (workflows.size === 0) {
          console.log('No workflows found.');
          console.log('Add .yaml files to ~/.copair/workflows/ or .copair/workflows/');
        } else {
          console.log('\nAvailable workflows:');
          for (const [name, def] of workflows) {
            console.log(`  ${name.padEnd(20)} ${def.description}`);
          }
          console.log('');
        }
        return;
      }

      const workflow = workflows.get(workflowName);
      if (!workflow) {
        console.log(`Workflow "${workflowName}" not found.`);
        return;
      }

      // Parse remaining args as input overrides (key=value pairs)
      const inputOverrides: Record<string, string> = {};
      for (const [key, val] of Object.entries(args)) {
        if (key !== 'name') {
          inputOverrides[key] = val;
        }
      }

      const engine = new WorkflowEngine({
        agentRunner,
        commandRunner,
        agentContext: context,
        shellApprover,
      });

      await engine.execute(workflow, inputOverrides);
    },
  };
}
