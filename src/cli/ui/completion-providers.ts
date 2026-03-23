// ── Completion Provider Interface ────────────────────────────────────────────

export interface CompletionItem {
  value: string;
  label: string;
  description?: string;
}

export interface CompletionProvider {
  id: string;
  /** Return true if this provider handles the given input. */
  matches(input: string): boolean;
  /** Return completion items for the given input. */
  complete(input: string): CompletionItem[];
}

// ── SlashCommandProvider ────────────────────────────────────────────────────

export class SlashCommandProvider implements CompletionProvider {
  readonly id = 'slash-commands';
  private commands: Map<string, string>;

  constructor(commands: Map<string, string>) {
    this.commands = commands;
  }

  matches(input: string): boolean {
    return input.startsWith('/');
  }

  complete(input: string): CompletionItem[] {
    const prefix = input.slice(1).toLowerCase();
    const items: CompletionItem[] = [];
    for (const [name, description] of this.commands) {
      if (name.toLowerCase().startsWith(prefix)) {
        items.push({
          value: `/${name}`,
          label: `/${name}`,
          description,
        });
      }
    }
    return items;
  }
}

// ── SubcommandProvider ──────────────────────────────────────────────────────

interface SubcommandDef {
  command: string;
  subcommands: Map<string, string>;
}

export class SubcommandProvider implements CompletionProvider {
  readonly id = 'subcommands';
  private defs: SubcommandDef[];

  constructor(defs: SubcommandDef[]) {
    this.defs = defs;
  }

  matches(input: string): boolean {
    if (!input.startsWith('/')) return false;
    return this.defs.some((d) => input.startsWith(`/${d.command} `));
  }

  complete(input: string): CompletionItem[] {
    for (const def of this.defs) {
      const cmdPrefix = `/${def.command} `;
      if (input.startsWith(cmdPrefix)) {
        const subPrefix = input.slice(cmdPrefix.length).toLowerCase();
        const items: CompletionItem[] = [];
        for (const [name, description] of def.subcommands) {
          if (name.toLowerCase().startsWith(subPrefix)) {
            items.push({
              value: `/${def.command} ${name}`,
              label: name,
              description,
            });
          }
        }
        return items;
      }
    }
    return [];
  }
}

// ── FilePathProvider ────────────────────────────────────────────────────────

export class FilePathProvider implements CompletionProvider {
  readonly id = 'file-paths';
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  matches(input: string): boolean {
    // Trigger on path-like tokens (contains / or starts with .)
    const lastToken = input.split(/\s+/).pop() ?? '';
    return lastToken.includes('/') || lastToken.startsWith('.');
  }

  complete(input: string): CompletionItem[] {
    const lastToken = input.split(/\s+/).pop() ?? '';
    try {
      const { readdirSync } = require('node:fs') as typeof import('node:fs');
      const { join, dirname, basename } = require('node:path') as typeof import('node:path');

      const dir = lastToken.endsWith('/')
        ? join(this.cwd, lastToken)
        : join(this.cwd, dirname(lastToken));
      const prefix = lastToken.endsWith('/') ? '' : basename(lastToken);
      const beforeToken = input.slice(0, input.length - lastToken.length);

      const entries = readdirSync(dir, { withFileTypes: true });
      const items: CompletionItem[] = [];
      for (const entry of entries) {
        if (entry.name.startsWith('.') && !prefix.startsWith('.')) continue;
        if (entry.name.toLowerCase().startsWith(prefix.toLowerCase())) {
          const suffix = entry.isDirectory() ? '/' : '';
          const relativePath = lastToken.endsWith('/')
            ? lastToken + entry.name + suffix
            : dirname(lastToken) + '/' + entry.name + suffix;
          items.push({
            value: beforeToken + relativePath,
            label: entry.name + suffix,
          });
        }
        if (items.length >= 20) break;
      }
      return items;
    } catch {
      return [];
    }
  }
}

// ── ModelNameProvider ────────────────────────────────────────────────────────

export class ModelNameProvider implements CompletionProvider {
  readonly id = 'model-names';
  private models: string[];

  constructor(models: string[]) {
    this.models = models;
  }

  matches(input: string): boolean {
    return input.startsWith('/model ');
  }

  complete(input: string): CompletionItem[] {
    const prefix = input.slice('/model '.length).toLowerCase();
    return this.models
      .filter((m) => m.toLowerCase().startsWith(prefix))
      .map((m) => ({ value: `/model ${m}`, label: m }));
  }
}

// ── SessionIdProvider ───────────────────────────────────────────────────────

export class SessionIdProvider implements CompletionProvider {
  readonly id = 'session-ids';
  private getSessions: () => Array<{ id: string; identifier: string }>;

  constructor(getSessions: () => Array<{ id: string; identifier: string }>) {
    this.getSessions = getSessions;
  }

  matches(input: string): boolean {
    return input.startsWith('/session resume ');
  }

  complete(input: string): CompletionItem[] {
    const prefix = input.slice('/session resume '.length).toLowerCase();
    return this.getSessions()
      .filter((s) => s.identifier.toLowerCase().startsWith(prefix) || s.id.startsWith(prefix))
      .map((s) => ({
        value: `/session resume ${s.identifier}`,
        label: s.identifier,
        description: s.id.slice(0, 8),
      }));
  }
}

// ── Completion Engine ───────────────────────────────────────────────────────

export class CompletionEngine {
  private providers: CompletionProvider[] = [];

  addProvider(provider: CompletionProvider): void {
    this.providers.push(provider);
  }

  /** Get completions for the input. Returns items from the first matching provider. */
  complete(input: string): CompletionItem[] {
    for (const provider of this.providers) {
      if (provider.matches(input)) {
        return provider.complete(input);
      }
    }
    return [];
  }

  /** Get the common prefix of all completions (for single-tab behavior). */
  commonPrefix(items: CompletionItem[]): string {
    if (items.length === 0) return '';
    if (items.length === 1) return items[0].value;
    let prefix = items[0].value;
    for (let i = 1; i < items.length; i++) {
      const val = items[i].value;
      let j = 0;
      while (j < prefix.length && j < val.length && prefix[j] === val[j]) j++;
      prefix = prefix.slice(0, j);
    }
    return prefix;
  }
}
