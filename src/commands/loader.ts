import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve, relative, basename } from 'node:path';
import { existsSync } from 'node:fs';
import type { Command, AgentContext } from './interface.js';
import { interpolate } from './interpolate.js';

interface CommandFrontmatter {
  name: string;
  description?: string;
  args?: Array<{ name: string; description?: string; default?: string; required?: boolean }>;
}

/**
 * Parse frontmatter from a command file.
 *
 * Accepts both copair-native format (name, description, args) and
 * Claude Code format (allowed-tools, description). When `name` is
 * missing from frontmatter, it can be derived from the file path
 * by the caller.
 */
function parseFrontmatter(content: string): { meta: CommandFrontmatter; body: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;

  const yamlLines = match[1].split('\n');
  const meta: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let argsArray: CommandFrontmatter['args'] = [];
  let inArgs = false;

  for (const line of yamlLines) {
    // Match top-level keys including hyphenated ones (e.g. allowed-tools)
    const topLevel = line.match(/^([\w-]+):\s*(.*)/);
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

  // name is no longer required in frontmatter — caller derives from path
  return {
    meta: meta as unknown as CommandFrontmatter,
    body: match[2].trim(),
  };
}

/**
 * Derive a colon-separated command name from a file path relative to the
 * commands directory. e.g. `dugleelabs/spec/status.md` → `dugleelabs:spec:status`
 */
function nameFromPath(relPath: string): string {
  return relPath.replace(/\.md$/, '');
}

/**
 * Recursively collect all .md files under a directory.
 */
async function collectMarkdownFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const s = await stat(full).catch(() => null);
    if (!s) continue;
    if (s.isDirectory()) {
      results.push(...(await collectMarkdownFiles(full)));
    } else if (entry.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

async function loadCommandsFromDir(
  dir: string,
  source: 'global' | 'project',
): Promise<Command[]> {
  const mdFiles = await collectMarkdownFiles(dir);
  const commands: Command[] = [];

  for (const filePath of mdFiles) {
    const content = await readFile(filePath, 'utf8').catch(() => null);
    if (!content) continue;

    const parsed = parseFrontmatter(content);
    if (!parsed) continue;

    const { meta, body } = parsed;

    // Derive name from relative path if not in frontmatter
    const name = meta.name || nameFromPath(relative(dir, filePath));

    const command: Command = {
      definition: {
        name,
        description: meta.description ?? '',
        args: meta.args,
        source,
      },
      async execute(args: Record<string, string>, context: AgentContext): Promise<string> {
        return interpolate(body, args, context);
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
