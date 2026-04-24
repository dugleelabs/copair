/**
 * Append-only audit log for a single copair session.
 *
 * Each session produces one audit.jsonl file at:
 *   .copair/sessions/<id>/audit.jsonl
 *
 * Every line is a JSON-serialized AuditEntry. The file is created with mode
 * 0o600 on first write and is append-only — existing entries are never
 * modified or deleted by this module.
 *
 * input_summary is always redacted and truncated to ≤ 200 chars before
 * writing so that raw secrets never appear in the audit log.
 */

import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { redact } from './redactor.js';

const INPUT_SUMMARY_MAX = 200;

export type AuditEvent =
  | 'session_start'
  | 'session_end'
  | 'tool_call'
  | 'approval'
  | 'denial'
  | 'path_block'
  | 'schema_rejection'
  | 'bash_sensitive_path'
  | 'bash_cross_repo';

export type AuditOutcome = 'allowed' | 'denied' | 'error' | 'flagged';

export interface AuditEntry {
  ts: string;
  event: AuditEvent;
  tool?: string;
  /** Truncated (≤ 200 chars) and redacted summary of tool input. Never contains raw secrets. */
  input_summary?: string;
  approved_by?: 'user' | 'allow_list' | 'auto';
  outcome: AuditOutcome;
  detail?: string;
}

/** Input to append() — ts is added automatically; input_summary is raw (will be redacted). */
export type AuditEntryInput = Omit<AuditEntry, 'ts'>;

export class AuditLog {
  private readonly logPath: string;

  constructor(sessionDir: string) {
    this.logPath = join(sessionDir, 'audit.jsonl');
  }

  /** Append one entry. input_summary is redacted and truncated before writing. */
  async append(input: AuditEntryInput): Promise<void> {
    const entry: AuditEntry = {
      ...input,
      ts: new Date().toISOString(),
      input_summary: input.input_summary != null
        ? redact(input.input_summary).slice(0, INPUT_SUMMARY_MAX)
        : undefined,
    };

    // Remove undefined fields so the JSONL stays compact.
    const clean = Object.fromEntries(
      Object.entries(entry).filter(([, v]) => v !== undefined),
    );

    appendFileSync(this.logPath, JSON.stringify(clean) + '\n', { mode: 0o600 });
  }

  getLogPath(): string {
    return this.logPath;
  }
}
