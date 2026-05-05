import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
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
  let currentKey: string | null;
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

    if (inArgs) {
      // Start of a new arg item: "  - name: foo"
      const newArgMatch = line.match(/^\s+-\s+name:\s*(.+)/);
      if (newArgMatch) {
        argsArray = argsArray ?? [];
        argsArray.push({ name: newArgMatch[1].trim() });
        continue;
      }
      // Properties of the current arg item
      const current = argsArray && argsArray[argsArray.length - 1];
      if (current) {
        const descMatch = line.match(/^\s+description:\s*(.*)/);
        if (descMatch) {
          current.description = descMatch[1].replace(/^["']|["']$/g, '').trim();
          continue;
        }
        const reqMatch = line.match(/^\s+required:\s*(true|false)/);
        if (reqMatch) {
          (current as Record<string, unknown>).required = reqMatch[1] === 'true';
          continue;
        }
        const defMatch = line.match(/^\s+default:\s*(.*)/);
        if (defMatch) {
          current.default = defMatch[1].replace(/^["']|["']$/g, '').trim();
          continue;
        }
      }
    }
  }

  if (argsArray.length > 0) meta['args'] = argsArray;

  // argument-hint shim: if no args: block but argument-hint is present,
  // synthesize a single non-required arg from the hint text.
  if (argsArray.length === 0 && typeof meta['argument-hint'] === 'string') {
    const hint = (meta['argument-hint'] as string).replace(/[<>[\]|]/g, '').trim().split(/\s+/)[0];
    if (hint) {
      meta['args'] = [{ name: hint, description: meta['argument-hint'] as string, required: false }];
    }
  }

  // name is no longer required in frontmatter — caller derives from path
  return {
    meta: meta as unknown as CommandFrontmatter,
    body: match[2].trim(),
  };
}

/**
 * Derive a slash-separated command name from a file path relative to the
 * commands directory. e.g. `dugleelabs/spec/status.md` → `dugleelabs/spec/status`
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
