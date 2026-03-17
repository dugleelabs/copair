import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { Command, AgentContext } from './interface.js';
import { interpolate } from './interpolate.js';

interface CommandFrontmatter {
  name: string;
  description?: string;
  args?: Array<{ name: string; description?: string; default?: string; required?: boolean }>;
}

function parseFrontmatter(content: string): { meta: CommandFrontmatter; body: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;

  const yamlLines = match[1].split('\n');
  const meta: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let argsArray: CommandFrontmatter['args'] = [];
  let inArgs = false;

  for (const line of yamlLines) {
    const topLevel = line.match(/^(\w+):\s*(.*)/);
    if (topLevel) {
      currentKey = topLevel[1];
      inArgs = currentKey === 'args';
      if (!inArgs) {
        meta[currentKey] = topLevel[2].trim() || '';
      }
      continue;
    }

    if (inArgs && line.match(/^\s+-\s+name:/)) {
      const nameMatch = line.match(/name:\s*(.+)/);
      if (nameMatch) {
        argsArray = argsArray ?? [];
        argsArray.push({ name: nameMatch[1].trim() });
      }
    }
  }

  if (argsArray.length > 0) meta['args'] = argsArray;

  if (!meta['name']) return null;

  return {
    meta: meta as unknown as CommandFrontmatter,
    body: match[2].trim(),
  };
}

async function loadCommandsFromDir(
  dir: string,
  source: 'global' | 'project',
): Promise<Command[]> {
  if (!existsSync(dir)) return [];

  const commands: Command[] = [];
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const filePath = join(dir, file);
    const content = await readFile(filePath, 'utf8').catch(() => null);
    if (!content) continue;

    const parsed = parseFrontmatter(content);
    if (!parsed) continue;

    const { meta, body } = parsed;
    const command: Command = {
      definition: {
        name: meta.name,
        description: meta.description ?? '',
        args: meta.args,
        source,
      },
      async execute(args: Record<string, string>, context: AgentContext): Promise<void> {
        const expanded = await interpolate(body, args, context);
        // Output the expanded prompt — the REPL will feed it to the agent
        process.stdout.write(expanded + '\n');
      },
    };

    commands.push(command);
  }

  return commands;
}

export async function loadCustomCommands(): Promise<Command[]> {
  const globalDir = resolve(process.env['HOME'] ?? '~', '.copair', 'commands');
  const projectDir = resolve(process.cwd(), '.copair', 'commands');

  const globalCommands = await loadCommandsFromDir(globalDir, 'global');
  const projectCommands = await loadCommandsFromDir(projectDir, 'project');

  return [...globalCommands, ...projectCommands];
}
