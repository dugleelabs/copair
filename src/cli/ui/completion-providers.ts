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
