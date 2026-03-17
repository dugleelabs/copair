import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { WorkflowDefinition } from './interface.js';

const WorkflowStepSchema = z.object({
  id: z.string(),
  type: z.enum(['prompt', 'shell', 'command', 'condition', 'output']),
  message: z.string().optional(),
  command: z.string().optional(),
  capture: z.string().optional(),
  continue_on_error: z.boolean().optional(),
  if: z.string().optional(),
  then: z.string().optional(),
  else: z.string().optional(),
  max_iterations: z.string().optional(),
  loop_until: z.string().optional(),
  on_max_iterations: z.string().optional(),
});

const WorkflowSchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  inputs: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().default(''),
        default: z.string().optional(),
      }),
    )
    .optional(),
  steps: z.array(WorkflowStepSchema),
});

async function loadWorkflowsFromDir(dir: string): Promise<WorkflowDefinition[]> {
  if (!existsSync(dir)) return [];

  const workflows: WorkflowDefinition[] = [];
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  for (const file of files) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
    const filePath = join(dir, file);
    const content = await readFile(filePath, 'utf8').catch(() => null);
    if (!content) continue;

    try {
      const raw = parseYaml(content) as unknown;
      const parsed = WorkflowSchema.parse(raw);
      workflows.push(parsed as WorkflowDefinition);
    } catch (err) {
      process.stderr.write(`[workflows] Failed to parse ${file}: ${String(err)}\n`);
    }
  }

  return workflows;
}

export async function loadWorkflows(): Promise<Map<string, WorkflowDefinition>> {
  const globalDir = resolve(process.env['HOME'] ?? '~', '.copair', 'workflows');
  const projectDir = resolve(process.cwd(), '.copair', 'workflows');

  const globalWorkflows = await loadWorkflowsFromDir(globalDir);
  const projectWorkflows = await loadWorkflowsFromDir(projectDir);

  const map = new Map<string, WorkflowDefinition>();
  // Project workflows override global
  for (const w of [...globalWorkflows, ...projectWorkflows]) {
    map.set(w.name, w);
  }

  return map;
}
