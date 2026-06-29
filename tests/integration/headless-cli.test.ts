/**
 * Integration tests — headless CLI as a spawned child process (spec 047,
 * T-15 no-TTY + T-17 ablation). This is the exact consumption pattern spec 048
 * uses: spawn `copair --headless`, read the result JSON off stdout, read the
 * mechanism-event JSONL off `--events`.
 *
 * Requires a built dist/ — run `pnpm build` first (same as tests/e2e).
 *
 * A local fake server speaks the OpenAI-compatible streaming (SSE) wire format
 * so the run completes without any real API. Each test scripts the turns the
 * "model" emits.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { spawnSync, spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  HeadlessResultSchema,
  HeadlessEventSchema,
  type HeadlessResult,
} from '../../src/cli/headless/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(__dirname, '../../dist/index.js');

beforeAll(() => {
  if (!existsSync(BIN)) {
    throw new Error(`dist build missing at ${BIN} — run \`pnpm build\` before the integration suite`);
  }
  // Each test boots node + several provider round-trips against the in-process
  // fake server; the 5s default is too tight.
  vi.setConfig({ testTimeout: 20_000 });
});

interface Turn {
  /** Full assistant text body for this turn (may contain tool-call markup). */
  text: string;
  usage?: { input: number; output: number };
}

/** Start a fake OpenAI-compatible SSE server that replays `turns` in order. */
function startServer(turns: Turn[]): Promise<{ port: number; close: () => void }> {
  let i = 0;
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const turn = turns[Math.min(i, turns.length - 1)];
      i++;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      send({ choices: [{ delta: { content: turn.text } }] });
      send({
        choices: [{ delta: {} }],
        usage: {
          prompt_tokens: turn.usage?.input ?? 10,
          completion_tokens: turn.usage?.output ?? 5,
        },
      });
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  return new Promise((res) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      res({ port, close: () => server.close() });
    });
  });
}

interface SandboxOpts {
  port: number;
  toolCalling?: boolean;
  tier?: 'small' | 'large';
  preferredFormat?: string;
  smallModels?: Record<string, unknown>;
}

/** Build a temp HOME + git-initialised project with a config pointing at the fake server. */
function sandbox(opts: SandboxOpts): { home: string; project: string } {
  const home = mkdtempSync(join(tmpdir(), 'copair-hl-home-'));
  const project = mkdtempSync(join(tmpdir(), 'copair-hl-proj-'));
  mkdirSync(join(home, '.copair'), { recursive: true });
  mkdirSync(join(project, '.copair'), { recursive: true });
  // Init git so detectGitContext stays quiet.
  spawnSync('git', ['init', '-q'], { cwd: project });

  const overrides: Record<string, unknown> = { tier: opts.tier ?? 'large' };
  if (opts.preferredFormat) overrides.preferred_format = opts.preferredFormat;

  const config: Record<string, unknown> = {
    version: 1,
    default_model: 'local',
    providers: {
      local: {
        type: 'openai-compatible',
        base_url: `http://127.0.0.1:${opts.port}/v1`,
        models: {
          local: {
            id: 'test-model',
            max_tokens: 200,
            context_window: 8192,
            supports_tool_calling: opts.toolCalling ?? false,
          },
        },
      },
    },
    model_overrides: { local: overrides },
    permissions: { mode: 'auto-approve' },
  };
  if (opts.smallModels) config.small_models = opts.smallModels;

  writeFileSync(join(home, '.copair', 'config.yaml'), JSON.stringify(config));
  return { home, project };
}

function cleanup(...dirs: string[]): void {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Spawn the headless binary asynchronously and await its exit. ASYNC (not
 * spawnSync) is mandatory here: the fake provider server runs in THIS process,
 * and spawnSync would block the event loop so the server could never answer the
 * child's request — deadlock. `spawn` keeps the loop live so the server responds.
 */
function runHeadless(
  args: string[],
  env: { home: string; project: string },
  input?: string,
): Promise<RunResult> {
  return new Promise((resolveRun) => {
    const child = spawn('node', [BIN, '--headless', ...args], {
      cwd: env.project,
      env: { ...process.env, HOME: env.home, USERPROFILE: env.home },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 12_000);
    // Close stdin (empty) unless input is supplied — mirrors a piped run.
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
    child.on('exit', (status) => {
      clearTimeout(timer);
      resolveRun({ status, stdout, stderr });
    });
  });
}

const servers: Array<() => void> = [];
afterEach(() => {
  for (const close of servers.splice(0)) close();
});

async function server(turns: Turn[]): Promise<number> {
  const s = await startServer(turns);
  servers.push(s.close);
  return s.port;
}

// ── T-15: no-TTY result + exit codes + event stream ───────────────────────────

describe('headless CLI — happy path (T-15)', () => {
  it('emits a schema-valid result JSON on stdout and exits 0', async () => {
    const port = await server([{ text: 'Nothing to change. Done.', usage: { input: 30, output: 12 } }]);
    const env = sandbox({ port });
    try {
      const { status, stdout } = await runHeadless(['look around'], env);
      expect(status).toBe(0);
      const result = JSON.parse(stdout) as HeadlessResult;
      expect(() => HeadlessResultSchema.parse(result)).not.toThrow();
      expect(result.schema_version).toBe(1);
      expect(result.termination_reason).toBe('model-declared-done');
      expect(result.usage.input_tokens).toBe(30);
      expect(result.turns.assistant_messages).toBe(1);
      expect(result.resolved_config.permissions).toBe('headless-terminate');
    } finally {
      cleanup(env.home, env.project);
    }
  });

  it('writes a valid JSONL event stream with monotonic seq', async () => {
    const port = await server([{ text: 'done' }]);
    const env = sandbox({ port });
    const eventsPath = join(env.project, 'events.jsonl');
    try {
      const { status } = await runHeadless(['go', '--events', eventsPath], env);
      expect(status).toBe(0);
      const lines = readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean);
      const events = lines.map((l) => HeadlessEventSchema.parse(JSON.parse(l)));
      events.forEach((e, i) => expect(e.seq).toBe(i));
      expect(events.at(-1)?.event).toBe('run_terminated');
      // The stream opened a turn and recorded usage (the turn-boundary signal).
      expect(events.some((e) => e.event === 'usage')).toBe(true);
      expect(events.some((e) => e.event === 'turn_started')).toBe(true);
    } finally {
      cleanup(env.home, env.project);
    }
  });
});

describe('headless CLI — exit codes & no-hang (T-15)', () => {
  it('exits 1 with an error when no task is provided (empty stdin, no positional/file)', async () => {
    const port = await server([{ text: 'done' }]);
    const env = sandbox({ port });
    try {
      // Empty stdin via input '' so readStdin() returns nothing.
      const { status, stderr } = await runHeadless([], env, '');
      expect(status).toBe(1);
      expect(stderr).toMatch(/no task/i);
    } finally {
      cleanup(env.home, env.project);
    }
  });

  it('exits 1 on an unknown model before any result is written', async () => {
    const port = await server([{ text: 'done' }]);
    const env = sandbox({ port });
    try {
      const { status, stdout } = await runHeadless(['go', '--model', 'definitely-not-a-real-model'], env);
      expect(status).toBe(1);
      expect(stdout.trim()).toBe(''); // pre-result failure: no JSON document
    } finally {
      cleanup(env.home, env.project);
    }
  });

  it('does not hang on a no-TTY run (completes within the timeout)', async () => {
    const port = await server([{ text: 'done' }]);
    const env = sandbox({ port });
    try {
      const { status } = await runHeadless(['go', '--quiet'], env);
      // A hang would surface as spawnSync timeout → status null.
      expect(status).toBe(0);
    } finally {
      cleanup(env.home, env.project);
    }
  });
});

describe('headless CLI — kill -9 mid-run leaves parseable partial JSONL (T-15)', () => {
  it('every flushed event line is valid JSON up to the kill', async () => {
    // Slow server: delay the response so we can SIGKILL while the run is live,
    // after the event file has been created/truncated.
    let i = 0;
    const srv = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        i++;
        // Never respond — hold the request open so the child blocks on the
        // provider call while the (empty, truncated) events file already exists.
        void res;
      });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const addr = srv.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const env = sandbox({ port });
    const eventsPath = join(env.project, 'events.jsonl');

    try {
      const child = spawn('node', [BIN, '--headless', 'go', '--events', eventsPath, '--quiet'], {
        cwd: env.project,
        env: { ...process.env, HOME: env.home, USERPROFILE: env.home },
      });
      // Wait until the child has booted far enough to create the events file
      // AND issue the provider call (`i > 0`), then SIGKILL. Polling instead of
      // a fixed sleep keeps this deterministic on slower-booting platforms
      // (Windows CI) rather than racing a hard-coded delay.
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && !(existsSync(eventsPath) && i > 0)) {
        await new Promise((r) => setTimeout(r, 100));
      }
      child.kill('SIGKILL');
      await new Promise((r) => child.on('exit', r));

      // The file exists (truncated on construction). Whatever lines are present
      // must each be valid JSON (per-line flush guarantee).
      expect(existsSync(eventsPath)).toBe(true);
      const lines = readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean);
      for (const line of lines) {
        expect(() => HeadlessEventSchema.parse(JSON.parse(line))).not.toThrow();
      }
      expect(i).toBeGreaterThan(0); // the provider call was actually issued
    } finally {
      srv.close();
      cleanup(env.home, env.project);
    }
  });
});

// ── ask_user must not break headless I/O isolation (regression) ───────────────

describe('headless CLI — ask_user routes through the no-hang handler (regression)', () => {
  it('does not pollute stdout or hang when a small model calls ask_user', async () => {
    // ask_user is injected for small models only. Before the fix it was answered
    // by writing the question to STDOUT and reading stdin directly — which both
    // corrupted the single-JSON-document contract and hung in a non-interactive
    // run (stdin at EOF). It must instead go through the bridge `input-request`
    // handler, which answers empty in headless. Turn 1 calls ask_user; turn 2
    // ends the run.
    const askCall =
      '<tool_call>\n' +
      JSON.stringify({ name: 'ask_user', arguments: { question: 'Which file should I edit?' } }) +
      '\n</tool_call>'
    const port = await server([
      { text: askCall, usage: { input: 20, output: 8 } },
      { text: 'All done.', usage: { input: 22, output: 6 } },
    ])
    const env = sandbox({ port, tier: 'small', preferredFormat: 'qwen-xml' })
    try {
      const res = await runHeadless(['go'], env)
      // The run completed (exit 0) rather than hanging until the 12s SIGKILL.
      expect(res.status).toBe(0)
      // STDOUT carries exactly one JSON document — the interactive prompt text
      // never leaked there.
      expect(res.stdout).not.toContain('[copair]')
      const lines = res.stdout.trim().split('\n').filter(Boolean)
      expect(lines).toHaveLength(1)
      const result = HeadlessResultSchema.parse(JSON.parse(lines[0]))
      expect(result.termination_reason).toBe('model-declared-done')
    } finally {
      cleanup(env.home, env.project)
    }
  })
})

// ── T-17: ablation smoke — toggles take effect in resolved_config ─────────────

describe('headless CLI — ablation: toggles surface in resolved_config (T-17)', () => {
  const toggleKeys = [
    ['enable_loop_guard', 'loop_guard'],
    ['enable_format_repair', 'format_repair'],
    ['enable_inspect_before_act', 'inspect_before_act'],
  ] as const;

  it('default (no ablation): every small-model toggle reads true', async () => {
    const port = await server([{ text: 'done' }]);
    const env = sandbox({ port, tier: 'small', preferredFormat: 'qwen-xml' });
    try {
      const { status, stdout } = await runHeadless(['go'], env);
      expect(status).toBe(0);
      const { resolved_config } = JSON.parse(stdout) as HeadlessResult;
      expect(resolved_config.tier).toBe('small');
      expect(resolved_config.toggles).toMatchObject({
        loop_guard: true,
        format_repair: true,
        inspect_before_act: true,
        truncation: true,
      });
    } finally {
      cleanup(env.home, env.project);
    }
  });

  it.each(toggleKeys)('config %s:false → resolved_config.toggles.%s is false', async (cfgKey, resolvedKey) => {
    const port = await server([{ text: 'done' }]);
    const env = sandbox({
      port,
      tier: 'small',
      preferredFormat: 'qwen-xml',
      smallModels: { [cfgKey]: false },
    });
    try {
      const { status, stdout } = await runHeadless(['go'], env);
      expect(status).toBe(0);
      const { resolved_config } = JSON.parse(stdout) as HeadlessResult;
      expect(resolved_config.toggles[resolvedKey]).toBe(false);
      // The other toggles stay on — one-at-a-time ablation.
      for (const [, otherKey] of toggleKeys) {
        if (otherKey !== resolvedKey) expect(resolved_config.toggles[otherKey]).toBe(true);
      }
    } finally {
      cleanup(env.home, env.project);
    }
  });
});

describe('headless CLI — ablation: loop-guard off suppresses loop events (T-17)', () => {
  /** A qwen-xml tool call the small-model text path parses + repeats. */
  const repeatCall = '<tool_call>\n{"name": "bash", "arguments": {"command": "echo hi"}}\n</tool_call>';

  it('loop guard ON: a repeated tool call emits loop_nudge', async () => {
    // Same call every turn → loop guard nudges (2nd) then halts (3rd).
    const port = await server(Array.from({ length: 6 }, () => ({ text: repeatCall })));
    const env = sandbox({ port, tier: 'small', preferredFormat: 'qwen-xml' });
    const eventsPath = join(env.project, 'events.jsonl');
    try {
      await runHeadless(['go', '--events', eventsPath, '--auto-approve'], env);
      const events = readFileSync(eventsPath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      expect(events.some((e) => e.event === 'loop_nudge' || e.event === 'loop_halt')).toBe(true);
    } finally {
      cleanup(env.home, env.project);
    }
  });

  it('loop guard OFF: the same repetition emits no loop_nudge / loop_halt', async () => {
    const port = await server(Array.from({ length: 6 }, () => ({ text: repeatCall })));
    const env = sandbox({
      port,
      tier: 'small',
      preferredFormat: 'qwen-xml',
      smallModels: { enable_loop_guard: false },
    });
    const eventsPath = join(env.project, 'events.jsonl');
    try {
      // Cap tool calls so the loop-guard-off run still terminates.
      await runHeadless(['go', '--events', eventsPath, '--auto-approve', '--max-tool-calls', '4'], env);
      const events = readFileSync(eventsPath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      expect(events.some((e) => e.event === 'loop_nudge' || e.event === 'loop_halt')).toBe(false);
    } finally {
      cleanup(env.home, env.project);
    }
  });
});
